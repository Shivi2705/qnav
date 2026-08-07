import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import * as THREE from "three";
import {
  Activity, Thermometer, Compass, MapPin, Gauge, Radio, Box, Table2,
  ChevronRight, Play, Pause, Download, RotateCw, Zap, Waves, Settings2, Wifi, WifiOff,
} from "lucide-react";
import { fetchFullDataset, subscribeLive, csvExportUrl } from "./api.js";

/* ---------------------------------------------------------------------- */
const T = {
  bg: "#0f172a", bg2: "#111c33", panel: "#131f38", panelBorder: "#22304d",
  grid: "#1e2c47", text: "#e6edf7", textDim: "#8092b3", textFaint: "#4d5d80",
  teal: "#0ea5e9", tealSoft: "rgba(14,165,233,0.15)",
  amber: "#f59e0b", amberSoft: "rgba(245,158,11,0.15)",
  axisRed: "#ef4444", axisGreen: "#22c55e", axisBlue: "#3b82f6", axisYellow: "#eab308",
  danger: "#f43f5e", ok: "#22c55e",
};
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const FONT_SANS = "'Inter', ui-sans-serif, system-ui";

const U = [
  [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
].map((v) => v.map((c) => c / Math.sqrt(3)));

/* ---------------------------------------------------------------------- */
function Panel({ title, icon: Icon, right, children }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${T.panelBorder}`, background: "linear-gradient(180deg, rgba(255,255,255,0.02), transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {Icon && <Icon size={14} color={T.teal} strokeWidth={2} />}
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: T.textDim, fontWeight: 600 }}>{title}</span>
          </div>
          {right}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

function MetricCard({ label, value, unit, icon: Icon, accent = T.teal, sub, pulse }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Icon size={13} color={accent} />
        <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
        {pulse && <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.ok, marginLeft: "auto", boxShadow: `0 0 0 3px ${T.ok}22`, animation: "pulse 2s infinite" }} />}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 26, fontWeight: 600, color: T.text, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 13, color: T.textDim, marginLeft: 4, fontWeight: 400 }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6, fontFamily: FONT_SANS }}>{sub}</div>}
    </div>
  );
}

function CustomTooltip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0a1120", border: `1px solid ${T.panelBorder}`, borderRadius: 8, padding: "8px 10px", fontFamily: FONT_MONO, fontSize: 11, color: T.text }}>
      <div style={{ color: T.textDim, marginBottom: 4 }}>t = {label}s</div>
      {payload.map((p, i) => (<div key={i} style={{ color: p.color }}>{p.name}: {Number(p.value).toFixed(3)} {unit}</div>))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
function NVDiamond3D({ point, showReconstructed = true }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = mount.clientWidth, height = mount.clientHeight || 260;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(3.2, 2.4, 3.6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(4, 6, 4);
    scene.add(dl);

    const diaGeo = new THREE.OctahedronGeometry(1.05, 0);
    const diaMat = new THREE.MeshPhysicalMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, transmission: 0.6, thickness: 1 });
    const dia = new THREE.Mesh(diaGeo, diaMat);
    scene.add(dia);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(diaGeo), new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.5 }));
    scene.add(wire);

    const axisColors = [0xef4444, 0x22c55e, 0x3b82f6, 0xeab308];
    const axes = U.map((u) => new THREE.Vector3(...u));
    const axisArrows = axes.map((dir, i) => {
      const arrow = new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(0, 0, 0), 1.5, axisColors[i], 0.22, 0.12);
      scene.add(arrow);
      return arrow;
    });

    const bArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, 0xf59e0b, 0.25, 0.14);
    scene.add(bArrow);

    const grid = new THREE.GridHelper(6, 12, 0x22304d, 0x1a2540);
    grid.position.y = -1.6;
    scene.add(grid);

    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      dia.rotation.y += 0.0025;
      wire.rotation.y += 0.0025;
      axisArrows.forEach((a) => (a.rotation = dia.rotation));
      renderer.render(scene, camera);
    };
    animate();

    stateRef.current = { bArrow };

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight || 260;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (!s.bArrow || !point) return;
    const v = new THREE.Vector3(point.Bx_sensor_uT, point.Bz_sensor_uT, point.By_sensor_uT);
    const mag = v.length() || 0.001;
    s.bArrow.setDirection(v.clone().normalize());
    s.bArrow.setLength(Math.min(2.2, 0.9 + mag / 30), 0.25, 0.14);
    s.bArrow.visible = showReconstructed;
  }, [point, showReconstructed]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", minHeight: 260 }} />;
}

function PipelineFlow({ active = 0 }) {
  const steps = [
    { n: "01", t: "ODMR Spectrum", s: "4× Zeeman splittings → scalar projections", icon: Waves },
    { n: "02", t: "Vector Reconstruction", s: "Pseudoinverse → Bx, By, Bz", icon: Box },
    { n: "03", t: "Calibration + IMU", s: "Hard/soft-iron, rotate to NED frame", icon: Compass },
    { n: "04", t: "EKF Map-Matching", s: "Fuse with anomaly map → position", icon: MapPin },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
      {steps.map((st, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, padding: 16, borderRadius: 10, border: `1px solid ${active === i ? T.teal : T.panelBorder}`, background: active === i ? T.tealSoft : "rgba(255,255,255,0.015)", transition: "all 0.4s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: active === i ? T.teal : T.textFaint }}>{st.n}</span>
              <st.icon size={14} color={active === i ? T.teal : T.textDim} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: T.text, marginBottom: 4 }}>{st.t}</div>
            <div style={{ fontSize: 11.5, color: T.textDim, lineHeight: 1.4 }}>{st.s}</div>
          </div>
          {i < steps.length - 1 && <ChevronRight size={16} color={T.textFaint} style={{ margin: "0 4px", flexShrink: 0 }} />}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
function OverviewPage({ latest, onEnter }) {
  const [flowStep, setFlowStep] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setFlowStep((s) => (s + 1) % 4), 1400);
    return () => clearInterval(iv);
  }, []);
  if (!latest) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, alignItems: "stretch" }}>
        <div style={{ borderRadius: 14, border: `1px solid ${T.panelBorder}`, background: `radial-gradient(circle at 20% 20%, ${T.tealSoft}, transparent 60%), ${T.bg2}`, padding: 32, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.amber, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Quantum Magnetometry · Instrument Panel</div>
          <h1 style={{ fontFamily: FONT_SANS, fontSize: 34, fontWeight: 700, color: T.text, lineHeight: 1.15, margin: 0, marginBottom: 14, maxWidth: 480 }}>NV-Diamond Vector Navigation</h1>
          <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.6, maxWidth: 460, marginBottom: 22 }}>
            A single diamond with four tetrahedral nitrogen-vacancy axes converts scalar ODMR readings into a full 3D magnetic vector, then fuses it with an IMU and a geomagnetic anomaly map to localize the receiver in real time.
          </p>
          <button onClick={onEnter} style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "fit-content", background: T.teal, color: "#04121f", fontWeight: 600, fontSize: 13.5, padding: "10px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: FONT_SANS }}>
            Open Live Dashboard <ChevronRight size={15} />
          </button>
        </div>
        <Panel title="Live NV Diamond" icon={Box} right={<span style={{ fontFamily: FONT_MONO, fontSize: 10, color: T.textFaint }}>4 tetrahedral axes</span>}>
          <NVDiamond3D point={latest} />
        </Panel>
      </div>

      <Panel title="Processing Pipeline"><div style={{ padding: 18 }}><PipelineFlow active={flowStep} /></div></Panel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <MetricCard label="Sensor Temp" value={latest.temperature_C.toFixed(3)} unit="°C" icon={Thermometer} accent={T.teal} pulse />
        <MetricCard label="Zero-Field Split" value={latest.D_ZFS_MHz.toFixed(2)} unit="MHz" icon={Radio} accent={T.amber} />
        <MetricCard label="Field Magnitude" value={latest.B_mag_uT.toFixed(3)} unit="μT" icon={Gauge} accent={T.teal} />
        <MetricCard label="Position Error" value={latest.pos_error_m.toFixed(3)} unit="m" icon={MapPin} accent={T.amber} pulse />
      </div>
    </div>
  );
}

function RealTimeDashboard({ history, latest }) {
  const chartData = useMemo(() => history.map((r) => ({ t: r.t, B1: r.B1_proj_uT, B2: r.B2_proj_uT, B3: r.B3_proj_uT, B4: r.B4_proj_uT })), [history]);
  const nedData = useMemo(() => history.map((r) => ({ t: r.t, BN: r.BN_uT, BE: r.BE_uT, BD: r.BD_uT })), [history]);
  const trajData = useMemo(() => history.map((r) => ({ x: r.est_pos_x_m, y: r.est_pos_y_m, tx: r.true_x_m, ty: r.true_y_m })), [history]);
  if (!latest) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <MetricCard label="Temperature" value={latest.temperature_C.toFixed(3)} unit="°C" icon={Thermometer} pulse />
        <MetricCard label="|B| Magnitude" value={latest.B_mag_uT.toFixed(3)} unit="μT" icon={Gauge} accent={T.amber} />
        <MetricCard label="Position Error" value={latest.pos_error_m.toFixed(3)} unit="m" icon={MapPin} pulse />
        <MetricCard label="Residual Norm" value={latest.r_norm_uT.toFixed(4)} unit="μT" icon={Activity} accent={T.amber} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, minHeight: 320 }}>
        <Panel title="Scalar Projections B₁–B₄ (recent window)" icon={Waves}>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} />
              <YAxis stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip unit="μT" />} />
              <Legend wrapperStyle={{ fontFamily: FONT_MONO, fontSize: 11 }} />
              <Line type="monotone" dataKey="B1" stroke={T.axisRed} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line type="monotone" dataKey="B2" stroke={T.axisGreen} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line type="monotone" dataKey="B3" stroke={T.axisBlue} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line type="monotone" dataKey="B4" stroke={T.axisYellow} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Reconstructed Vector" icon={Box}><NVDiamond3D point={latest} /></Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, minHeight: 300 }}>
        <Panel title="NED Components (BN, BE, BD)" icon={Compass}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={nedData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.teal} stopOpacity={0.5} /><stop offset="100%" stopColor={T.teal} stopOpacity={0} /></linearGradient>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.amber} stopOpacity={0.5} /><stop offset="100%" stopColor={T.amber} stopOpacity={0} /></linearGradient>
                <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} /><stop offset="100%" stopColor="#a78bfa" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke={T.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} />
              <YAxis stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip unit="μT" />} />
              <Legend wrapperStyle={{ fontFamily: FONT_MONO, fontSize: 11 }} />
              <Area type="monotone" dataKey="BN" stroke={T.teal} fill="url(#gN)" isAnimationActive={false} />
              <Area type="monotone" dataKey="BE" stroke={T.amber} fill="url(#gE)" isAnimationActive={false} />
              <Area type="monotone" dataKey="BD" stroke="#a78bfa" fill="url(#gD)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Position Trajectory (x, y)" icon={MapPin}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.grid} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="x" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name="y" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} width={40} />
              <Tooltip content={<CustomTooltip unit="m" />} />
              <Legend wrapperStyle={{ fontFamily: FONT_MONO, fontSize: 11 }} />
              <Line data={trajData} dataKey="ty" name="Ground truth" stroke={T.textFaint} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line data={trajData} dataKey="y" name="EKF estimate" stroke={T.amber} dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

function HistoricalExplorer({ dataset }) {
  const [range, setRange] = useState([0, dataset.length - 1]);
  const [sortKey, setSortKey] = useState("t");
  const [sortDir, setSortDir] = useState(1);
  const slice = dataset.slice(range[0], range[1] + 1);
  const cols = ["t", "temperature_C", "B1_proj_uT", "B2_proj_uT", "B3_proj_uT", "B4_proj_uT", "B_mag_uT", "BN_uT", "BE_uT", "BD_uT", "pos_error_m"];
  const sorted = useMemo(() => [...slice].sort((a, b) => (a[sortKey] - b[sortKey]) * sortDir).slice(0, 40), [slice, sortKey, sortDir]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel title="Time Range" icon={Settings2} right={
        <a href={csvExportUrl(dataset[range[0]]?.t ?? 0, dataset[range[1]]?.t ?? 0)} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${T.panelBorder}`, color: T.teal, fontSize: 11.5, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontFamily: FONT_SANS, textDecoration: "none" }}>
          <Download size={13} /> Export CSV
        </a>
      }>
        <div style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: T.textDim, marginBottom: 8 }}>
            t = {dataset[range[0]]?.t}s → {dataset[range[1]]?.t}s &nbsp;({slice.length} samples)
          </div>
          <input type="range" min={0} max={dataset.length - 1} value={range[0]} onChange={(e) => setRange([Math.min(+e.target.value, range[1]), range[1]])} style={{ width: "100%", accentColor: T.teal }} />
          <input type="range" min={0} max={dataset.length - 1} value={range[1]} onChange={(e) => setRange([range[0], Math.max(+e.target.value, range[0])])} style={{ width: "100%", accentColor: T.amber }} />
        </div>
      </Panel>

      <Panel title="Data Table (first 40 rows of selection)" icon={Table2}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_MONO, fontSize: 11.5 }}>
            <thead><tr>{cols.map((c) => (
              <th key={c} onClick={() => { setSortKey(c); setSortDir((d) => (sortKey === c ? -d : 1)); }} style={{ textAlign: "left", padding: "8px 12px", color: T.textDim, cursor: "pointer", borderBottom: `1px solid ${T.panelBorder}`, whiteSpace: "nowrap", background: T.bg2 }}>
                {c}{sortKey === c ? (sortDir === 1 ? " ↑" : " ↓") : ""}
              </th>
            ))}</tr></thead>
            <tbody>{sorted.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${T.grid}` }}>{cols.map((c) => (
                <td key={c} style={{ padding: "6px 12px", color: T.text, whiteSpace: "nowrap" }}>{typeof r[c] === "number" ? r[c].toFixed(3) : r[c]}</td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Lab3D({ latest }) {
  const [showRecon, setShowRecon] = useState(true);
  if (!latest) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Panel title="NV Diamond Lattice — 4 Tetrahedral Axes" icon={Box} right={
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.textDim, fontFamily: FONT_SANS }}>
          <input type="checkbox" checked={showRecon} onChange={(e) => setShowRecon(e.target.checked)} /> Show B_sensor
        </label>
      }>
        <div style={{ height: 420 }}><NVDiamond3D point={latest} showReconstructed={showRecon} /></div>
      </Panel>
      <Panel title="Axis Legend & Live Projections" icon={Waves}>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { c: T.axisRed, label: "Axis 1 · [1,1,1]/√3", v: latest.B1_proj_uT },
            { c: T.axisGreen, label: "Axis 2 · [1,-1,-1]/√3", v: latest.B2_proj_uT },
            { c: T.axisBlue, label: "Axis 3 · [-1,1,-1]/√3", v: latest.B3_proj_uT },
            { c: T.axisYellow, label: "Axis 4 · [-1,-1,1]/√3", v: latest.B4_proj_uT },
          ].map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: row.c, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, color: T.textDim, fontFamily: FONT_SANS }}>{row.label}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: T.text }}>{row.v?.toFixed(3)} μT</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${T.panelBorder}`, marginTop: 4, paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: T.amber, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, color: T.textDim, fontFamily: FONT_SANS }}>Reconstructed B_sensor</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 13, color: T.text }}>{latest.B_mag_uT?.toFixed(3)} μT</span>
            </div>
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.6, fontFamily: FONT_SANS }}>
              Baseline location: San Francisco Bay Area (37.7749°N, 122.4194°W). Globe / geomagnetic
              contour overlay (CesiumJS) is a planned future-phase feature — see README.
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Gauge3({ label, value, min, max, unit }) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -120 + pct * 240;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 120, height: 70 }}>
        <svg viewBox="0 0 120 70" width="120" height="70">
          <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke={T.grid} strokeWidth="8" strokeLinecap="round" />
          <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke={T.teal} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${pct * 157} 157`} />
          <line x1="60" y1="65" x2={60 + 40 * Math.cos((angle * Math.PI) / 180)} y2={65 + 40 * Math.sin((angle * Math.PI) / 180)} stroke={T.amber} strokeWidth="2" />
          <circle cx="60" cy="65" r="3" fill={T.amber} />
        </svg>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 15, color: T.text, marginTop: -18 }}>{value.toFixed(2)}{unit}</div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.textDim, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function Diagnostics({ history, latest, playing, setPlaying, scrub, setScrub, maxScrub }) {
  const rNormData = useMemo(() => history.map((r) => ({ t: r.t, r: r.r_norm_uT })), [history]);
  const errData = useMemo(() => history.map((r) => ({ t: r.t, e: r.pos_error_m })), [history]);
  const threshold = 0.15;
  if (!latest) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <Panel title="Attitude — Roll / Pitch / Yaw" icon={Compass}>
          <div style={{ display: "flex", justifyContent: "space-around", padding: "18px 8px" }}>
            <Gauge3 label="Roll" value={latest.roll_deg} min={-4} max={4} unit="°" />
            <Gauge3 label="Pitch" value={latest.pitch_deg} min={-3} max={3} unit="°" />
            <Gauge3 label="Yaw" value={latest.yaw_deg % 360} min={0} max={360} unit="°" />
          </div>
        </Panel>
        <Panel title="Residual Norm (r_norm)" icon={Activity}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rNormData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} />
              <YAxis stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} width={36} />
              <Tooltip content={<CustomTooltip unit="μT" />} />
              <ReferenceLine y={threshold} stroke={T.danger} strokeDasharray="4 3" label={{ value: "alert", fill: T.danger, fontSize: 10 }} />
              <Line type="monotone" dataKey="r" stroke={T.teal} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="EKF Convergence — Position Error" icon={MapPin}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={errData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} />
              <YAxis stroke={T.textFaint} tick={{ fontFamily: FONT_MONO, fontSize: 10 }} width={36} />
              <Tooltip content={<CustomTooltip unit="m" />} />
              <Line type="monotone" dataKey="e" stroke={T.amber} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="Replay Mode" icon={Play} right={
        <button onClick={() => setPlaying((p) => !p)} style={{ display: "flex", alignItems: "center", gap: 6, background: playing ? T.amberSoft : T.tealSoft, border: "none", color: playing ? T.amber : T.teal, fontSize: 11.5, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontFamily: FONT_SANS }}>
          {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? "Pause" : "Play"}
        </button>
      }>
        <div style={{ padding: 18 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: T.textDim, marginBottom: 10 }}>t = {latest.t}s</div>
          <input type="range" min={0} max={maxScrub} value={scrub} onChange={(e) => setScrub(+e.target.value)} style={{ width: "100%", accentColor: T.teal }} />
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
export default function App() {
  const [dataset, setDataset] = useState([]);
  const [source, setSource] = useState("loading");
  const [liveRow, setLiveRow] = useState(null);
  const [liveSource, setLiveSource] = useState("connecting");
  const [scrub, setScrub] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState("overview");

  // initial historical load
  useEffect(() => {
    fetchFullDataset().then(({ data, source }) => {
      setDataset(data);
      setSource(source);
      setScrub(data.length - 1);
    });
  }, []);

  // live subscription (websocket, or mock ticker fallback)
  useEffect(() => {
    const unsub = subscribeLive((row, src) => {
      setLiveRow(row);
      setLiveSource(src);
    });
    return unsub;
  }, []);

  // replay ticker
  useEffect(() => {
    if (!playing || dataset.length === 0) return;
    const iv = setInterval(() => setScrub((s) => (s + 1) % dataset.length), 120);
    return () => clearInterval(iv);
  }, [playing, dataset.length]);

  const latest = tab === "dashboard" || tab === "overview" ? (liveRow ?? dataset[dataset.length - 1]) : dataset[scrub];
  const history = dataset.slice(0, scrub + 1);
  const historyWindow = (history.length > 20 ? history : dataset).slice(-120);

  const tabs = [
    { id: "overview", label: "Overview", icon: Zap },
    { id: "dashboard", label: "Live Dashboard", icon: Activity },
    { id: "historical", label: "Historical Explorer", icon: Table2 },
    { id: "lab3d", label: "3D Lab", icon: Box },
    { id: "diagnostics", label: "Diagnostics", icon: Gauge },
  ];

  if (!dataset.length) {
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.textDim, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_MONO }}>
        Loading pipeline data…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(circle at 80% 0%, ${T.tealSoft}, transparent 40%), ${T.bg}`, color: T.text, fontFamily: FONT_SANS, padding: "20px 24px 60px" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${T.panelBorder}; border-radius: 4px; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: T.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.teal}44` }}>
            <RotateCw size={17} color={T.teal} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>QNAV — Quantum Navigation Console</div>
            <div style={{ fontSize: 10.5, color: T.textFaint, fontFamily: FONT_MONO, display: "flex", alignItems: "center", gap: 6 }}>
              NV-diamond magnetometry · San Francisco Bay Area baseline
              {liveSource === "backend" ? <Wifi size={11} color={T.ok} /> : <WifiOff size={11} color={T.textFaint} />}
              <span>{liveSource === "backend" ? "live API" : "mock data"}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, background: T.panel, border: `1px solid ${T.panelBorder}`, borderRadius: 10, padding: 4 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: FONT_SANS, fontSize: 12.5, fontWeight: 500, background: tab === t.id ? T.teal : "transparent", color: tab === t.id ? "#04121f" : T.textDim, transition: "all 0.15s" }}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <OverviewPage latest={latest} onEnter={() => setTab("dashboard")} />}
      {tab === "dashboard" && <RealTimeDashboard history={historyWindow} latest={latest} />}
      {tab === "historical" && <HistoricalExplorer dataset={dataset} />}
      {tab === "lab3d" && <Lab3D latest={latest} />}
      {tab === "diagnostics" && (
        <Diagnostics history={historyWindow} latest={latest} playing={playing} setPlaying={setPlaying} scrub={scrub} setScrub={setScrub} maxScrub={dataset.length - 1} />
      )}
    </div>
  );
}
