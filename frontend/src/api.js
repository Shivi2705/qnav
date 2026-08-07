// Talks to the FastAPI backend. If it's unreachable (e.g. you're only
// running the frontend), transparently falls back to an in-browser mock
// generator that runs the same 4-step math, so the UI still works standalone.
import { buildMockDataset } from "./mockPipeline.js";

const BASE = ""; // proxied to http://localhost:8000 in dev (see vite.config.js)

async function tryFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

let mockCache = null;
function getMock() {
  if (!mockCache) mockCache = buildMockDataset(60, 5);
  return mockCache;
}

export async function fetchFullDataset() {
  const real = await tryFetch(`${BASE}/api/data/full`);
  if (real && Array.isArray(real) && real.length) {
    return { data: real, source: "backend" };
  }
  return { data: getMock(), source: "mock" };
}

export async function fetchLatest() {
  const real = await tryFetch(`${BASE}/api/data/latest`);
  if (real) return { data: real, source: "backend" };
  const mock = getMock();
  return { data: mock[mock.length - 1], source: "mock" };
}

export function csvExportUrl(start, end) {
  return `${BASE}/api/data/csv?start=${start}&end=${end}`;
}

// Live WebSocket subscription; returns an unsubscribe function.
// Falls back to a local interval tick over mock data if the socket fails.
export function subscribeLive(onRow) {
  let closed = false;
  let ws;
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/live`);
    ws.onmessage = (evt) => {
      if (closed) return;
      onRow(JSON.parse(evt.data), "backend");
    };
    ws.onerror = () => startMockLoop();
  } catch {
    startMockLoop();
  }

  let mockInterval;
  let mockIdx = 0;
  function startMockLoop() {
    if (mockInterval) return;
    const mock = getMock();
    mockInterval = setInterval(() => {
      if (closed) return;
      onRow(mock[mockIdx % mock.length], "mock");
      mockIdx += 1;
    }, 1000);
  }

  // if the socket never opens within 2.5s, assume no backend and go mock
  const guard = setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) startMockLoop();
  }, 2500);

  return () => {
    closed = true;
    clearTimeout(guard);
    if (mockInterval) clearInterval(mockInterval);
    if (ws) ws.close();
  };
}
