"""
QNAV backend — FastAPI service exposing the 4-step NV-diamond navigation
pipeline as REST endpoints (and a WebSocket for live push updates).

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
"""
import asyncio
import io
import csv
from datetime import datetime, timedelta

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pipeline import generate_dataset

app = FastAPI(title="QNAV Quantum Navigation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pre-generate a 60-minute, 1 Hz dataset at startup (3600 rows).
# In production this would stream from the real ODMR hardware / DAQ instead.
DATASET = generate_dataset(duration_minutes=60, sample_rate_hz=1, seed=42)
START_TIME = datetime(2026, 8, 7, 14, 0, 0)


def with_wallclock(row: dict) -> dict:
    ts = START_TIME + timedelta(seconds=row["t"])
    return {**row, "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S")}


@app.get("/api/health")
def health():
    return {"status": "ok", "rows": len(DATASET)}


@app.get("/api/data/latest")
def latest():
    return with_wallclock(DATASET[-1])


@app.get("/api/data/full")
def full():
    return [with_wallclock(r) for r in DATASET]


@app.get("/api/data/range")
def data_range(
    start: int = Query(0, ge=0, description="start index (seconds offset)"),
    end: int = Query(3599, ge=0, description="end index (seconds offset)"),
):
    start = max(0, min(start, len(DATASET) - 1))
    end = max(start, min(end, len(DATASET) - 1))
    return [with_wallclock(r) for r in DATASET[start : end + 1]]


@app.get("/api/data/csv")
def csv_export(
    start: int = Query(0, ge=0),
    end: int = Query(3599, ge=0),
):
    start = max(0, min(start, len(DATASET) - 1))
    end = max(start, min(end, len(DATASET) - 1))
    rows = [with_wallclock(r) for r in DATASET[start : end + 1]]

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=nv_navigation_dataset.csv"},
    )


@app.websocket("/ws/live")
async def live_feed(ws: WebSocket):
    """Pushes one row per second, looping over the pre-generated dataset —
    swap this loop for a real DAQ read in production."""
    await ws.accept()
    i = 0
    try:
        while True:
            await ws.send_json(with_wallclock(DATASET[i % len(DATASET)]))
            i += 1
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
