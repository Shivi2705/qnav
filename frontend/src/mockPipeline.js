// Browser-side fallback implementation of the same 4-step pipeline as
// backend/pipeline.py, producing rows with IDENTICAL field names so the UI
// components don't care whether data came from FastAPI or this fallback.

const GAMMA_E = 0.02802495;
const D0 = 2870.0;
const dD_dT = -0.074;
const B_BASE = [22.84, 5.42, 42.15];

const U = [
  [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
].map((v) => v.map((c) => c / Math.sqrt(3)));

const M_PINV = [
  [1, 1, -1, -1],
  [1, -1, 1, -1],
  [1, -1, -1, 1],
].map((row) => row.map((c) => (Math.sqrt(3) / 4) * c));

const V_HARD = [0.52, -0.31, 0.85];
const A_SOFT = [
  [1.002, 0.005, 0.001],
  [0.005, 0.998, -0.003],
  [0.001, -0.003, 1.001],
];
const A_SOFT_INV = inv3(A_SOFT);

function gauss(std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function matVec3(m, v) { return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]); }
function transpose3(m) { return m[0].map((_, j) => m.map((row) => row[j])); }
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  return [[A, D, G], [B, E, H], [C, F, I]].map((row) => row.map((v) => v / det));
}

function attitude(t) {
  const roll = ((2.0 * Math.sin((2 * Math.PI * t) / 120)) * Math.PI) / 180;
  const pitch = ((1.5 * Math.cos((2 * Math.PI * t) / 180)) * Math.PI) / 180;
  const yaw = ((15.0 + 0.005 * t) * Math.PI) / 180;
  return [roll, pitch, yaw];
}
function rotBodyToNed(roll, pitch, yaw) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
}

function geoField(x, y, z) {
  const kx = (2 * Math.PI) / 300, ky = (2 * Math.PI) / 260;
  const ampN = 3.5, ampE = 2.8, ampD = 4.0;
  return [
    B_BASE[0] + ampN * Math.sin(kx * x) * Math.cos(ky * y),
    B_BASE[1] + ampE * Math.cos(kx * x) * Math.sin(ky * y),
    B_BASE[2] + ampD * Math.sin(kx * x + ky * y) - 0.001 * z,
  ];
}
function geoJacobian(x, y) {
  const kx = (2 * Math.PI) / 300, ky = (2 * Math.PI) / 260;
  const ampN = 3.5, ampE = 2.8, ampD = 4.0;
  const dBn_dx = ampN * kx * Math.cos(kx * x) * Math.cos(ky * y);
  const dBn_dy = -ampN * ky * Math.sin(kx * x) * Math.sin(ky * y);
  const dBe_dx = -ampE * kx * Math.sin(kx * x) * Math.sin(ky * y);
  const dBe_dy = ampE * ky * Math.cos(kx * x) * Math.cos(ky * y);
  const dBd_dx = ampD * kx * Math.cos(kx * x + ky * y);
  const dBd_dy = ampD * ky * Math.cos(kx * x + ky * y);
  return [
    [dBn_dx, dBn_dy, 0, 0, 0, 0],
    [dBe_dx, dBe_dy, 0, 0, 0, 0],
    [dBd_dx, dBd_dy, -0.001, 0, 0, 0],
  ];
}

function identity(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
function diag(v) { return v.map((d, i) => v.map((_, j) => (i === j ? d : 0))); }
function matMul(a, b) {
  const r = a.length, c = b[0].length, k = b.length;
  const out = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { let s = 0; for (let m = 0; m < k; m++) s += a[i][m] * b[m][j]; out[i][j] = s; }
  return out;
}
function matVec(a, v) { return a.map((row) => row.reduce((s, x, i) => s + x * v[i], 0)); }
function matAdd(a, b) { return a.map((row, i) => row.map((x, j) => x + b[i][j])); }
function matSub(a, b) { return a.map((row, i) => row.map((x, j) => x - b[i][j])); }
function transpose(a) { return a[0].map((_, j) => a.map((row) => row[j])); }
function inv3g(m) { return inv3(m); }

export function buildMockDataset(minutes = 60, strideSec = 1) {
  const n = Math.floor((minutes * 60) / strideSec);
  const dt = strideSec;

  let ekfX = [6.0, -4.0, 0.0, 0.45, 0.18, 0.0];
  let P = diag([36, 36, 4, 0.04, 0.04, 0.01]);
  const F = identity(6); F[0][3] = dt; F[1][4] = dt; F[2][5] = dt;
  const Q = diag([2e-3, 2e-3, 1e-4, 4e-3, 4e-3, 1e-4]);
  const R = diag([0.03 ** 2 * 4, 0.03 ** 2 * 4, 0.03 ** 2 * 4]);

  let trueX = 0, trueY = 0;
  const rows = [];

  for (let i = 0; i < n; i++) {
    const t = i * strideSec;
    trueX += 0.5 * dt; trueY += 0.2 * dt;

    const [roll, pitch, yaw] = attitude(t);
    const rBn = rotBodyToNed(roll, pitch, yaw);
    const bNedTrue = geoField(trueX, trueY, 0);
    const bBodyTrue = matVec3(transpose3(rBn), bNedTrue);
    const bBodyDistorted = matVec3(A_SOFT_INV, bBodyTrue).map((v, i2) => v + V_HARD[i2]);

    // Step 1
    const tempC = 25.0 + 1.35 * (1 - Math.exp(-t / 1200)) + gauss(0.005);
    const D = D0 + dD_dT * (tempC - 25.0);
    const bActual = bBodyDistorted.map((b) => b + gauss(0.03));
    const bProjTrue = U.map((u) => u[0] * bActual[0] + u[1] * bActual[1] + u[2] * bActual[2]);
    const extracted = bProjTrue.map((b) => {
      const fMinus = D - GAMMA_E * b + gauss(0.002);
      const fPlus = D + GAMMA_E * b + gauss(0.002);
      return (fPlus - fMinus) / (2 * GAMMA_E);
    });

    // Step 2
    const bSensor = M_PINV.map((row) => row[0] * extracted[0] + row[1] * extracted[1] + row[2] * extracted[2] + row[3] * extracted[3]);
    const bMag = Math.hypot(...bSensor);
    const reproj = U.map((u) => u[0] * bSensor[0] + u[1] * bSensor[1] + u[2] * bSensor[2]);
    const rNorm = Math.hypot(...extracted.map((b, idx) => b - reproj[idx]));

    // Step 3
    const bCal = matVec3(A_SOFT, bSensor.map((v, idx) => v - V_HARD[idx]));
    const bNed = matVec3(rBn, bCal);

    // Step 4 (EKF)
    const xPred = matVec(F, ekfX);
    const pPred = matAdd(matMul(matMul(F, P), transpose(F)), Q);
    const zMap = geoField(xPred[0], xPred[1], xPred[2]);
    const H = geoJacobian(xPred[0], xPred[1]);
    const yRes = bNed.map((v, idx) => v - zMap[idx]);
    const S = matAdd(matMul(matMul(H, pPred), transpose(H)), R);
    const K = matMul(matMul(pPred, transpose(H)), inv3g(S));
    ekfX = xPred.map((v, idx) => v + (K[idx][0] * yRes[0] + K[idx][1] * yRes[1] + K[idx][2] * yRes[2]));
    P = matSub(pPred, matMul(K, matMul(H, pPred)));
    const posErr = Math.hypot(ekfX[0] - trueX, ekfX[1] - trueY);

    rows.push({
      t, timestamp: t,
      latitude: 37.7749, longitude: -122.4194, altitude_m: 15.0,
      temperature_C: tempC, D_ZFS_MHz: D,
      B1_proj_uT: extracted[0], B2_proj_uT: extracted[1], B3_proj_uT: extracted[2], B4_proj_uT: extracted[3],
      Bx_sensor_uT: bSensor[0], By_sensor_uT: bSensor[1], Bz_sensor_uT: bSensor[2],
      B_mag_uT: bMag, r_norm_uT: rNorm,
      roll_deg: (roll * 180) / Math.PI, pitch_deg: (pitch * 180) / Math.PI, yaw_deg: (yaw * 180) / Math.PI,
      BN_uT: bNed[0], BE_uT: bNed[1], BD_uT: bNed[2],
      est_pos_x_m: ekfX[0], est_pos_y_m: ekfX[1], est_pos_z_m: ekfX[2],
      true_x_m: trueX, true_y_m: trueY, pos_error_m: posErr,
    });
  }
  return rows;
}
