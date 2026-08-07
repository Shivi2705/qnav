"""
NV-center diamond quantum navigation pipeline.

Step 1  ODMR scalar extraction      (Zeeman splitting -> B1..B4)
Step 2  3D vector reconstruction    (Moore-Penrose pseudoinverse)
Step 3  Calibration + IMU rotation  (hard/soft-iron, body -> NED)
Step 4  EKF map-matching            (geomagnetic anomaly map -> position)
"""
import numpy as np

# ---- physical constants -----------------------------------------------
GAMMA_E = 0.02802495      # MHz / uT
D0 = 2870.000              # zero-field splitting @ 25C, MHz
dD_dT = -0.074              # MHz / K
B_BASE = np.array([22.840, 5.420, 42.150])   # nominal NED field, uT (SF Bay Area)
LAT, LON, ALT = 37.7749, -122.4194, 15.0

# tetrahedral NV axes
U1 = np.array([1, 1, 1]) / np.sqrt(3)
U2 = np.array([1, -1, -1]) / np.sqrt(3)
U3 = np.array([-1, 1, -1]) / np.sqrt(3)
U4 = np.array([-1, -1, 1]) / np.sqrt(3)
AXES = [U1, U2, U3, U4]

M = (1.0 / np.sqrt(3)) * np.array([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
])
M_PINV = (np.sqrt(3) / 4.0) * np.array([
    [1, 1, -1, -1],
    [1, -1, 1, -1],
    [1, -1, -1, 1],
])

V_HARD = np.array([0.52, -0.31, 0.85])
A_SOFT = np.array([
    [1.002, 0.005, 0.001],
    [0.005, 0.998, -0.003],
    [0.001, -0.003, 1.001],
])
A_SOFT_INV = np.linalg.inv(A_SOFT)


def step1_odmr(t: float, rng: np.random.Generator, b_body: np.ndarray):
    """Simulate raw ODMR resonance pairs and extract scalar projections.

    b_body is the true magnetic field already expressed in the sensor/body
    frame (i.e. the NED field rotated by the vehicle's current attitude and
    passed through the hard/soft-iron distortion) — this is what the NV
    axes actually see.
    """
    temp_c = 25.0 + 1.35 * (1 - np.exp(-t / 1200)) + rng.normal(0, 0.005)
    d_val = D0 + dD_dT * (temp_c - 25.0)

    b_noise = rng.normal(0, 0.03, 3)
    b_actual = b_body + b_noise

    b_true_proj = [float(np.dot(b_actual, u)) for u in AXES]

    f_minus = [d_val - GAMMA_E * b + rng.normal(0, 0.002) for b in b_true_proj]
    f_plus = [d_val + GAMMA_E * b + rng.normal(0, 0.002) for b in b_true_proj]
    extracted = [(f_plus[i] - f_minus[i]) / (2 * GAMMA_E) for i in range(4)]

    return {
        "t": t, "temperature_C": temp_c, "D_ZFS_MHz": d_val,
        "f_minus": f_minus, "f_plus": f_plus,
        "B_proj": extracted,
    }


def step2_vector(b_proj):
    b_proj = np.asarray(b_proj)
    b_sensor = M_PINV @ b_proj
    b_mag = float(np.linalg.norm(b_sensor))
    residual = b_proj - M @ b_sensor
    r_norm = float(np.linalg.norm(residual))
    return b_sensor, b_mag, r_norm


def attitude(t):
    roll = np.radians(2.0 * np.sin(2 * np.pi * t / 120))
    pitch = np.radians(1.5 * np.cos(2 * np.pi * t / 180))
    yaw = np.radians(15.0 + 0.005 * t)
    return roll, pitch, yaw


def rotation_body_to_ned(roll, pitch, yaw):
    cp, sp = np.cos(pitch), np.sin(pitch)
    cr, sr = np.cos(roll), np.sin(roll)
    cy, sy = np.cos(yaw), np.sin(yaw)
    return np.array([
        [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
        [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
        [-sp, sr * cp, cr * cp],
    ])


def step3_ned(t, b_sensor):
    """Undo hard/soft-iron distortion, then rotate body-frame -> NED."""
    roll, pitch, yaw = attitude(t)
    b_cal = A_SOFT @ (b_sensor - V_HARD)
    r_bn = rotation_body_to_ned(roll, pitch, yaw)
    b_ned = r_bn @ b_cal
    return b_ned, np.degrees(roll), np.degrees(pitch), np.degrees(yaw)


class GeomagneticMap:
    def __init__(self, b0=B_BASE):
        self.b0 = b0
        self.kx = 2 * np.pi / 300.0
        self.ky = 2 * np.pi / 260.0
        self.amp_n, self.amp_e, self.amp_d = 3.5, 2.8, 4.0

    def field(self, x, y, z=0.0):
        bn = self.b0[0] + self.amp_n * np.sin(self.kx * x) * np.cos(self.ky * y)
        be = self.b0[1] + self.amp_e * np.cos(self.kx * x) * np.sin(self.ky * y)
        bd = self.b0[2] + self.amp_d * np.sin(self.kx * x + self.ky * y) - 0.001 * z
        return np.array([bn, be, bd])

    def jacobian(self, x, y, z=0.0):
        dbn_dx = self.amp_n * self.kx * np.cos(self.kx * x) * np.cos(self.ky * y)
        dbn_dy = -self.amp_n * self.ky * np.sin(self.kx * x) * np.sin(self.ky * y)
        dbe_dx = -self.amp_e * self.kx * np.sin(self.kx * x) * np.sin(self.ky * y)
        dbe_dy = self.amp_e * self.ky * np.cos(self.kx * x) * np.cos(self.ky * y)
        dbd_dx = self.amp_d * self.kx * np.cos(self.kx * x + self.ky * y)
        dbd_dy = self.amp_d * self.ky * np.cos(self.kx * x + self.ky * y)
        h = np.zeros((3, 6))
        h[0, 0], h[0, 1] = dbn_dx, dbn_dy
        h[1, 0], h[1, 1] = dbe_dx, dbe_dy
        h[2, 0], h[2, 1], h[2, 2] = dbd_dx, dbd_dy, -0.001
        return h


class EKF:
    """Step 4: constant-velocity EKF fused with the geomagnetic anomaly map."""

    def __init__(self, dt=1.0):
        self.dt = dt
        self.geo = GeomagneticMap()
        # Start from a modest (8 m) dead-reckoning offset, as a real IMU/INS
        # initialization would provide, rather than an unconstrained guess.
        self.x = np.array([6.0, -4.0, 0.0, 0.45, 0.18, 0.0])
        self.P = np.diag([36.0, 36.0, 4.0, 0.04, 0.04, 0.01])
        self.F = np.eye(6)
        self.F[0, 3] = dt
        self.F[1, 4] = dt
        self.F[2, 5] = dt
        # Small process noise: the magnetic gradient is weak/aliased relative
        # to sensor noise, so we lean mainly on the kinematic (IMU) model and
        # let the magnetic map apply only a gentle correction each step.
        self.Q = np.diag([2e-3, 2e-3, 1e-4, 4e-3, 4e-3, 1e-4])
        self.R = np.eye(3) * (0.03 ** 2) * 4.0
        self.true_x, self.true_y = 0.0, 0.0
        self.true_vx, self.true_vy = 0.5, 0.2

    def step(self, b_ned, true_x, true_y):
        x_pred = self.F @ self.x
        p_pred = self.F @ self.P @ self.F.T + self.Q

        z_map = self.geo.field(x_pred[0], x_pred[1], x_pred[2])
        h = self.geo.jacobian(x_pred[0], x_pred[1], x_pred[2])

        y_res = b_ned - z_map
        s = h @ p_pred @ h.T + self.R
        k = p_pred @ h.T @ np.linalg.inv(s)

        self.x = x_pred + k @ y_res
        self.P = (np.eye(6) - k @ h) @ p_pred

        pos_err = float(np.hypot(self.x[0] - true_x, self.x[1] - true_y))
        return {
            "est_pos_x_m": float(self.x[0]), "est_pos_y_m": float(self.x[1]),
            "est_pos_z_m": float(self.x[2]), "true_x_m": true_x,
            "true_y_m": true_y, "pos_error_m": pos_err,
        }


def generate_dataset(duration_minutes=60, sample_rate_hz=1, seed=42):
    """Run the full 4-step pipeline and return a list of row dicts.

    Ground truth is built "backwards" for physical self-consistency: a true
    vehicle trajectory moves through the geomagnetic anomaly map, giving a
    true NED field at each instant; that field is rotated into the body
    frame by the vehicle's attitude and passed through hard/soft-iron
    distortion — *that* is what the NV diamond actually senses. Steps 1-3
    then have to recover the true NED field from scratch, and Step 4 (EKF)
    has to recover the true position from that, exactly as real hardware
    would.
    """
    rng = np.random.default_rng(seed)
    num_samples = int(duration_minutes * 60 * sample_rate_hz)
    dt = 1.0 / sample_rate_hz
    geo = GeomagneticMap()
    ekf = EKF(dt=dt)

    true_x, true_y = 0.0, 0.0
    true_vx, true_vy = 0.5, 0.2

    rows = []
    for i in range(num_samples):
        t = i / sample_rate_hz
        true_x += true_vx * dt
        true_y += true_vy * dt

        roll, pitch, yaw = attitude(t)
        r_bn = rotation_body_to_ned(roll, pitch, yaw)
        b_ned_true = geo.field(true_x, true_y, 0.0)
        b_body_true = r_bn.T @ b_ned_true            # NED -> body
        b_body_distorted = A_SOFT_INV @ b_body_true + V_HARD  # forward hard/soft-iron

        s1 = step1_odmr(t, rng, b_body_distorted)
        b_sensor, b_mag, r_norm = step2_vector(s1["B_proj"])
        b_ned, roll_deg, pitch_deg, yaw_deg = step3_ned(t, b_sensor)
        s4 = ekf.step(b_ned, true_x, true_y)

        rows.append({
            "t": t,
            "timestamp": t,  # seconds offset; frontend formats as needed
            "latitude": LAT, "longitude": LON, "altitude_m": ALT,
            "temperature_C": round(float(s1["temperature_C"]), 4),
            "D_ZFS_MHz": round(float(s1["D_ZFS_MHz"]), 4),
            "B1_proj_uT": round(float(s1["B_proj"][0]), 4),
            "B2_proj_uT": round(float(s1["B_proj"][1]), 4),
            "B3_proj_uT": round(float(s1["B_proj"][2]), 4),
            "B4_proj_uT": round(float(s1["B_proj"][3]), 4),
            "Bx_sensor_uT": round(float(b_sensor[0]), 4),
            "By_sensor_uT": round(float(b_sensor[1]), 4),
            "Bz_sensor_uT": round(float(b_sensor[2]), 4),
            "B_mag_uT": round(float(b_mag), 4),
            "r_norm_uT": round(float(r_norm), 5),
            "roll_deg": round(float(np.degrees(roll)), 3),
            "pitch_deg": round(float(np.degrees(pitch)), 3),
            "yaw_deg": round(float(np.degrees(yaw)), 3),
            "BN_uT": round(float(b_ned[0]), 4),
            "BE_uT": round(float(b_ned[1]), 4),
            "BD_uT": round(float(b_ned[2]), 4),
            **{k: round(v, 4) if isinstance(v, float) else v for k, v in s4.items()},
        })
    return rows
