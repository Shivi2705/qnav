# QNAV — Quantum Navigation Console

A research-instrument-style web dashboard for an NV-diamond quantum
magnetometry navigation pipeline: ODMR scalar extraction → 3D vector
reconstruction → IMU calibration/NED rotation → EKF geomagnetic map-matching.

```
qnav/
├── backend/     FastAPI service running the real 4-step pipeline (NumPy)
└── frontend/    React 18 + Vite dashboard (Recharts, Three.js)
```

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

This generates a 60-minute, 1 Hz (3600-row) synthetic-but-physically-modeled
dataset at startup and serves it at:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/data/latest` | Most recent row (JSON) |
| `GET /api/data/full` | Entire 3600-row dataset (JSON) |
| `GET /api/data/range?start=&end=` | Slice by second-offset index |
| `GET /api/data/csv?start=&end=` | Same slice as a downloadable CSV |
| `WS /ws/live` | Pushes one row per second (loops the dataset) |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`). Vite proxies
`/api/*` and `/ws/*` to `http://localhost:8000` (see `vite.config.js`), so
just run both processes side by side.

**No backend running?** The frontend still works — `src/api.js` detects the
failed fetch/WebSocket within ~2.5s and transparently falls back to
`src/mockPipeline.js`, an in-browser copy of the exact same 4-step math. A
small "live API" / "mock data" indicator in the header tells you which one
is active.

## What's real vs. simplified here

- **The physics/math is real**, not decorative: both `backend/pipeline.py`
  and `frontend/src/mockPipeline.js` implement the actual Zeeman-splitting
  extraction, Moore-Penrose pseudoinverse reconstruction, hard/soft-iron
  calibration + Euler rotation, and an Extended Kalman Filter against a
  synthetic geomagnetic anomaly map — the two implementations were checked
  against each other and produce matching convergence behavior.
- **The dataset is synthetic**, generated from a physical noise model, not
  real ODMR hardware output — there is no real diamond, laser, or DAQ behind
  this. Swap `pipeline.generate_dataset()` for a real acquisition loop to go
  from simulation to instrument.
- **The geomagnetic map is synthetic and idealized.** A real deployment
  needs a genuine high-resolution magnetic-anomaly survey of the area; the
  built-in sine-wave map is only there to make the EKF demo converge
  sensibly. Position error grows over long stretches once the trajectory
  covers several map periods (spatial aliasing) — this is a known, expected
  limitation of single-point EKF map-matching, not a bug, and is why the
  original design brief suggested a particle filter as a future option for
  non-linear/multi-modal maps.
- **CesiumJS globe / TanStack Table are not included.** This build uses the
  library set available in the environment it was authored in (Three.js,
  Recharts, lucide-react). The Globe Viewer panel in the "3D Lab" tab is a
  labeled placeholder — wiring in Cesium or MapLibre is a drop-in addition
  once you have API tokens for a tile provider.
- **WebSocket in this build just loops the pre-generated 3600-row dataset**
  once per second. Point it at a real acquisition loop to make it truly
  live.

## Extending

- **New sensor location**: change `B_BASE`, `LAT`, `LON`, `ALT` in
  `backend/pipeline.py` (and the matching constants in
  `frontend/src/mockPipeline.js` if you want the offline fallback to match).
- **24-hour dataset**: `generate_dataset(duration_minutes=1440, ...)` — no
  code changes needed, just more rows and a longer initial load.
- **Real hardware**: replace the body of `generate_dataset`'s per-sample
  loop with a read from your DAQ/ODMR controller, feed it through
  `step1_odmr → step2_vector → step3_ned → EKF.step` unchanged.
