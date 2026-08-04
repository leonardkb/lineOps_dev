// components/merchant/MerchantPlanner.jsx
//
// Merchant planning board — the production Plan Board's model, one level up.
//
//   • Each production order is split into one "job" per COLOR, carrying that
//     color's estilo and its talla × cantidad breakdown (like the PlanBoard pool).
//   • WEEK view is a compact grid spanning 6 MONTHS AHEAD (26 week columns,
//     scroll right for more). You assign a color into a week CELL — drag it in,
//     or tap the color then tap an empty cell. The cell shows that color's
//     equivalent pieces.
//   • A color that is ALREADY on the board can be REASSIGNED without removing it
//     first, three ways: (a) drag the tile from its week onto any other week,
//     (b) tap the tile to pick it up, then tap the destination week, (c) open its
//     detail and use the "Mover a otra semana" selector. Dragging a tile back to
//     the "Colores por asignar" pool takes it off the board. Moving hits the same
//     upsert endpoint — UNIQUE(work_order_id, color) means the row's week_start is
//     updated in place, so no duplicate rows and no backend change needed.
//   • MONTH and YEAR views are read-only visibility: they aggregate the weekly
//     assignments into month / year totals.
//
// Equivalencia factor (default 10) normalizes workload:
//     eq/pza              = SAM ÷ equivalencia
//     piezas equivalentes = cantidad(color) × (SAM ÷ equivalencia)
//
// A job's assignment is stored as its week's Monday (YYYY-MM-DD), so it stays
// correct across week/month/year. Persisted per browser under `merchant_plan_v2`.
// To move server-side later, swap loadStore/saveStore for GET/POST.
//
// Controlled vs uncontrolled: pass `orders` (+ loading/apiOnline/onRefresh) to
// share a parent's data (MerchantDashboard tab); omit them to self-fetch.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  format, addDays, addMonths,
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear,
  eachMonthOfInterval, getWeek,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Table2, Search,
  RefreshCw, Timer, Package, Boxes, X, Check, AlertCircle, Info, GripVertical, Lock, Trash2,
} from "lucide-react";
import { API_URL, TALLAS } from "../../lib/masterCodeCatalog";

/* ------------------------------------------------------------------ config */

const STORE_KEY = "merchant_plan_v2";
const EQUIV_DEFAULT = 10;
const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const WEEKS_AHEAD = 26;   // ~6 months
const CELL_W = 104;       // px — week column / cell width
const CELL_H = 46;        // px — cell height
const GAP = 8;            // px
const MIN_ROWS = 10;      // keep the empty grid looking full

// Per-job color (full literal Tailwind strings so the compiler keeps them).
const PALETTE = [
  { solid: "bg-blue-500",    soft: "bg-blue-50",    text: "text-blue-700",    ring: "ring-blue-300",    dot: "bg-blue-500" },
  { solid: "bg-violet-500",  soft: "bg-violet-50",  text: "text-violet-700",  ring: "ring-violet-300",  dot: "bg-violet-500" },
  { solid: "bg-emerald-500", soft: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-300", dot: "bg-emerald-500" },
  { solid: "bg-amber-500",   soft: "bg-amber-50",   text: "text-amber-700",   ring: "ring-amber-300",   dot: "bg-amber-500" },
  { solid: "bg-rose-500",    soft: "bg-rose-50",    text: "text-rose-700",    ring: "ring-rose-300",    dot: "bg-rose-500" },
  { solid: "bg-cyan-500",    soft: "bg-cyan-50",    text: "text-cyan-700",    ring: "ring-cyan-300",    dot: "bg-cyan-500" },
  { solid: "bg-fuchsia-500", soft: "bg-fuchsia-50", text: "text-fuchsia-700", ring: "ring-fuchsia-300", dot: "bg-fuchsia-500" },
  { solid: "bg-lime-500",    soft: "bg-lime-50",    text: "text-lime-700",    ring: "ring-lime-300",    dot: "bg-lime-500" },
];
const NEUTRAL = { solid: "bg-slate-400", soft: "bg-slate-50", text: "text-slate-600", ring: "ring-slate-300", dot: "bg-slate-400" };
const colorForKey = (key) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const DEMO_ORDERS = [
  { id: 1, work_order_no: "OP-2026-0001", customer_name: "Inverdibol", customer_po: "PO-5521",
    style_code: "DAMPAN01", estilo: "FN2808", style_description: "Pantalón dama invierno franela",
    sam_minutes: 12.5, status: "in_progress",
    lines: [
      { color: "NEG", estilo: "FN2808", talla: "128", quantity: 200 },
      { color: "NEG", estilo: "FN2808", talla: "130", quantity: 240 },
      { color: "NEG", estilo: "FN2808", talla: "132", quantity: 160 },
      { color: "BLA", estilo: "FN2809", talla: "130", quantity: 180 },
    ] },
  { id: 2, work_order_no: "OP-2026-0002", customer_name: "Zara México", customer_po: "ZR-118",
    style_code: "NNALEG03", estilo: "KD1201", style_description: "Legging niña licra rosada",
    sam_minutes: 6.75, status: "pending",
    lines: [{ color: "ROS", estilo: "KD1201", talla: "006", quantity: 300 }] },
  { id: 3, work_order_no: "OP-2026-0003", customer_name: "Suburbia", customer_po: "SB-7742",
    style_code: "CABTSH02", estilo: "FN3110", style_description: "T-shirt caballero algodón peinado",
    sam_minutes: 8.2, status: "assigned",
    lines: [
      { color: "BLA", estilo: "FN3110", talla: "M", quantity: 400 },
      { color: "BLA", estilo: "FN3110", talla: "G", quantity: 350 },
      { color: "AZU", estilo: "FN3111", talla: "M", quantity: 300 },
    ] },
];

/* --------------------------------------------------------------- utilities */

const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const fmtInt = (n) => Math.round(num(n)).toLocaleString();
const fmt2 = (n) => num(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const woId = (o) => o.id ?? o.work_order_no;

const ymd = (v) => {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mondayOf = (dateStr) => ymd(startOfWeek(new Date(`${ymd(dateStr)}T00:00:00`), { weekStartsOn: 1 }));
const sizeRank = (code) => { const i = TALLAS.findIndex((t) => t.code === code); return i === -1 ? 999 : i; };

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      assignments: raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {},
      equivalence: Number(raw.equivalence) > 0 ? Number(raw.equivalence) : EQUIV_DEFAULT,
    };
  } catch { return { assignments: {}, equivalence: EQUIV_DEFAULT }; }
}
function saveStore(next) { try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch {} }

/* -------- server sync (falls back to the localStorage cache when offline) -- */
const PLAN_URL = `${API_URL}/api/merchant-plan`;
const splitKey = (key) => { const i = key.indexOf(":"); return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)]; };

// A job + its week, in the shape the API expects (snapshot of the detail).
const planItem = (j, weekStart, equivalence) => ({
  workOrderId: j.workOrderId, color: j.color || "", weekStart,
  workOrderNo: j.work_order_no, customerName: j.customer_name, customerPo: j.customer_po,
  styleCode: j.style_code, estilo: j.estilo, styleDescription: j.style_description,
  cantidad: j.cantidad, samMinutes: j.sam, equivalence,
  eqPerPiece: j.eqPerPiece, eqPieces: j.eqPieces, sizes: j.sizes,
});

async function apiGetPlan() {
  const r = await fetch(PLAN_URL, { headers: authHeaders() });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("401"); }
  if (!r.ok) throw new Error(`GET ${r.status}`);
  return r.json();
}
async function apiUpsert(item) {
  const r = await fetch(PLAN_URL, { method: "POST", headers: authHeaders(), body: JSON.stringify(item) });
  if (!r.ok) throw new Error(`POST ${r.status}`);
  return r.json();
}
async function apiDeleteOne(workOrderId, color) {
  const r = await fetch(`${PLAN_URL}?workOrderId=${encodeURIComponent(workOrderId)}&color=${encodeURIComponent(color || "")}`,
    { method: "DELETE", headers: authHeaders() });
  if (!r.ok) throw new Error(`DELETE ${r.status}`);
  return r.json();
}
async function apiBulk(items, equivalence) {
  const r = await fetch(PLAN_URL, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ items, equivalence }) });
  if (!r.ok) throw new Error(`PUT ${r.status}`);
  return r.json();
}

// One job per work-order + color, with that color's size breakdown + estilo.
function buildJobs(orders, eq) {
  const factor = eq > 0 ? eq : EQUIV_DEFAULT;
  const jobs = [];
  for (const o of orders) {
    if (["cancelled"].includes(o.status)) continue;
    const sam = num(o.sam_minutes);
    const eqPerPiece = sam / factor;
    const base = {
      workOrderId: woId(o), work_order_no: o.work_order_no,
      customer_name: o.customer_name || "—", customer_po: o.customer_po || "",
      style_code: o.style_code || o.estilo || "—", style_description: o.style_description || "",
      photo: o.master_code_photo_url || null, status: o.status,
      sam, eqPerPiece, commitment_date: o.commitment_date || null,
    };
    const mk = (color, qty, sizes, estilo) => ({
      ...base, key: `${base.workOrderId}:${color || ""}`, color: color || null,
      estilo: estilo || o.estilo || "",
      sizes: (sizes || []).slice().sort((a, b) => sizeRank(a.talla) - sizeRank(b.talla)),
      cantidad: qty, eqPieces: qty * eqPerPiece,
    });
    const lines = Array.isArray(o.lines) ? o.lines.filter((l) => l && l.color != null) : [];
    const colors = Array.isArray(o.colors) ? o.colors.filter((c) => c && c.color != null) : [];
    if (lines.length) {
      const byColor = new Map();
      for (const l of lines) {
        const cur = byColor.get(l.color) || { color: l.color, qty: 0, sizeMap: new Map(), estilos: new Set() };
        const q = num(l.quantity);
        cur.qty += q;
        if (l.talla) cur.sizeMap.set(l.talla, (cur.sizeMap.get(l.talla) || 0) + q);
        if (l.estilo) cur.estilos.add(l.estilo);
        byColor.set(l.color, cur);
      }
      for (const c of byColor.values())
        jobs.push(mk(c.color, c.qty, [...c.sizeMap.entries()].map(([talla, quantity]) => ({ talla, quantity })), [...c.estilos].join(", ")));
    } else if (colors.length) {
      for (const c of colors) jobs.push(mk(c.color, num(c.quantity), [], o.estilo));
    } else {
      jobs.push(mk(o.color || null, num(o.total_to_produce ?? o.quantity ?? 0), [], o.estilo));
    }
  }
  return jobs.sort((a, b) => {
    const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
    const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
    if (da !== db) return da - db;
    const c = String(a.work_order_no).localeCompare(String(b.work_order_no));
    return c !== 0 ? c : String(a.color || "").localeCompare(String(b.color || ""));
  });
}

/* =================================================================== board */

export default function MerchantPlanner({
  orders: ordersProp, loading: loadingProp, apiOnline: apiOnlineProp, onRefresh,
} = {}) {
  const controlled = Array.isArray(ordersProp);
  const [ordersState, setOrdersState] = useState([]);
  const [loadingState, setLoadingState] = useState(true);
  const [apiOnlineState, setApiOnlineState] = useState(false);
  const orders = controlled ? ordersProp : ordersState;
  const loading = controlled ? !!loadingProp : loadingState;
  const apiOnline = controlled ? apiOnlineProp !== false : apiOnlineState;

  const [viewMode, setViewMode] = useState("week");
  const [layout, setLayout] = useState("board");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [query, setQuery] = useState("");

  const initial = loadStore();
  const [assignments, setAssignments] = useState(initial.assignments);
  const [equivalence, setEquivalence] = useState(initial.equivalence);

  const [armed, setArmed] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [poolDrop, setPoolDrop] = useState(false);   // dragging an assigned color back to the pool
  const [poolOpen, setPoolOpen] = useState(true);
  const [showEqInfo, setShowEqInfo] = useState(false);
  const [aggModal, setAggModal] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [planOnline, setPlanOnline] = useState(false);
  const [toast, setToast] = useState(null);
  const hydratedRef = useRef(false);       // guards the factor-change re-save
  const skipFactorSaveRef = useRef(false); // don't re-save when the factor is set by the initial load
  const jobsRef = useRef([]);              // latest jobs, for async save callbacks

  const active = dragKey ?? armed;
  const assignable = viewMode === "week";

  useEffect(() => { saveStore({ assignments, equivalence }); }, [assignments, equivalence]);

  // Load the saved board from the server once; localStorage already gave an
  // instant first paint, and stays as the offline cache if the API is down.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiGetPlan();
        if (!alive) return;
        if (data?.success) {
          const map = {};
          for (const row of data.plan || []) map[`${row.work_order_id}:${row.color || ""}`] = row.week_start;
          setAssignments(map);
          if (Number(data.equivalence) > 0) { skipFactorSaveRef.current = true; setEquivalence(Number(data.equivalence)); }
          setPlanOnline(true);
        }
      } catch (err) {
        console.warn("merchant-plan load failed, using local cache:", err.message);
        if (alive) setPlanOnline(false);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!controlled) fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fetchOrders = async () => {
    if (controlled) { onRefresh?.(); return; }
    setLoadingState(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      if (!res.ok) { if (res.status === 401) { window.location.href = "/login"; return; } throw new Error(`API ${res.status}`); }
      const data = await res.json();
      setOrdersState(data.workOrders || []);
      setApiOnlineState(true);
    } catch (err) {
      console.error("Planner fetch error:", err);
      setOrdersState(DEMO_ORDERS); setApiOnlineState(false);
      showToast("Sin conexión al servidor — mostrando datos de demostración", true);
    } finally { setLoadingState(false); }
  };
  const showToast = (msg, isError = false) => { setToast({ msg, isError }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setArmed(null); setDragKey(null); setDropTarget(null); setPoolDrop(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const jobs = useMemo(() => buildJobs(orders, equivalence), [orders, equivalence]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  const filteredJobs = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      `${j.work_order_no} ${j.customer_name} ${j.customer_po} ${j.style_code} ${j.style_description} ${j.color || ""} ${j.estilo}`.toUpperCase().includes(q));
  }, [jobs, query]);

  const periods = useMemo(() => {
    if (viewMode === "week") {
      const first = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
        const s = addDays(first, i * 7), e = endOfWeek(s, { weekStartsOn: 1 });
        return { key: ymd(s), top: `SEM ${getWeek(s, { weekStartsOn: 1 })}`, bottom: format(s, "dd/MM"), start: ymd(s), end: ymd(e) };
      });
    }
    if (viewMode === "month") {
      const s0 = startOfYear(currentDate);
      return eachMonthOfInterval({ start: s0, end: endOfMonth(addMonths(s0, 11)) }).map((m) => ({
        key: format(m, "yyyy-MM"), top: MES[m.getMonth()].toUpperCase(), bottom: format(m, "yyyy"),
        start: ymd(startOfMonth(m)), end: ymd(endOfMonth(m)),
      }));
    }
    const y0 = currentDate.getFullYear();
    return Array.from({ length: 6 }, (_, i) => ({ key: String(y0 + i), top: "AÑO", bottom: String(y0 + i), start: `${y0 + i}-01-01`, end: `${y0 + i}-12-31` }));
  }, [viewMode, currentDate]);

  const periodOfDate = (dateStr) => (dateStr ? periods.find((p) => p.start <= dateStr && dateStr <= p.end) || null : null);

  const board = useMemo(() => {
    const pool = [];
    const byPeriod = new Map(periods.map((p) => [p.key, []]));
    let outOfRange = 0;
    for (const j of filteredJobs) {
      const date = assignments[j.key];
      if (!date) { pool.push(j); continue; }
      const p = periodOfDate(date);
      if (p) byPeriod.get(p.key).push(j);
      else outOfRange++;
    }
    return { pool, byPeriod, outOfRange };
  }, [filteredJobs, periods, assignments]);

  const totalsFor = (list) => list.reduce((a, j) => ({ real: a.real + j.cantidad, eq: a.eq + j.eqPieces }), { real: 0, eq: 0 });

  const assignToWeek = (jobKey, period) => {
    if (!assignable) return;
    // Dropped back onto its current week — nothing to do (matches PlanBoard).
    if (assignments[jobKey] === period.start) { setArmed(null); setDragKey(null); setDropTarget(null); return; }
    setAssignments((prev) => ({ ...prev, [jobKey]: period.start }));
    setArmed(null); setDragKey(null); setDropTarget(null);
    const j = jobs.find((x) => x.key === jobKey);
    showToast(`${j?.work_order_no || "Orden"}${j?.color ? " · " + j.color : ""} → ${period.top} · ${fmtInt(j?.eqPieces)} pzas eq`);
    if (planOnline && j) apiUpsert(planItem(j, period.start, equivalence))
      .catch((err) => { console.warn("save failed:", err.message); showToast("No se pudo guardar en el servidor (queda local)", true); });
  };
  const unassign = (jobKey) => {
    setAssignments((prev) => { const n = { ...prev }; delete n[jobKey]; return n; });
    setArmed(null); setDragKey(null); setSelectedJob(null);
    if (planOnline) { const [woId2, color] = splitKey(jobKey); apiDeleteOne(woId2, color).catch((err) => console.warn("delete failed:", err.message)); }
  };
  const clearAll = () => {
    if (!Object.keys(assignments).length) return;
    if (!window.confirm("¿Quitar todas las asignaciones del tablero?")) return;
    setAssignments({});
    if (planOnline) apiBulk([], equivalence).catch((err) => console.warn("clear failed:", err.message));
  };
  const tapCard = (jobKey) => { if (assignable) setArmed((c) => (c === jobKey ? null : jobKey)); };

  // When the equivalencia factor changes, the stored eq snapshots go stale.
  // Debounce-resave every assigned color so the DB matches what's on screen.
  useEffect(() => {
    if (!hydratedRef.current || !planOnline) return;
    if (skipFactorSaveRef.current) { skipFactorSaveRef.current = false; return; }
    const t = setTimeout(() => {
      const items = jobsRef.current
        .filter((j) => assignments[j.key])
        .map((j) => planItem(j, assignments[j.key], equivalence));
      apiBulk(items, equivalence).catch((err) => console.warn("factor re-save failed:", err.message));
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equivalence]);

  const step = (dir) => {
    if (viewMode === "week") return setCurrentDate((d) => addDays(d, dir * 7 * WEEKS_AHEAD));
    if (viewMode === "month") return setCurrentDate((d) => addMonths(d, dir * 12));
    return setCurrentDate((d) => addMonths(d, dir * 12 * 6));
  };
  const rangeLabel = () => {
    if (viewMode === "week") {
      const s = startOfWeek(currentDate, { weekStartsOn: 1 });
      const e = endOfWeek(addDays(s, (WEEKS_AHEAD - 1) * 7), { weekStartsOn: 1 });
      return `${format(s, "dd/MM/yyyy")} – ${format(e, "dd/MM/yyyy")} · 6 meses`;
    }
    if (viewMode === "month") return `Año ${currentDate.getFullYear()}`;
    const y = currentDate.getFullYear();
    return `${y} – ${y + 5}`;
  };

  const grandAssigned = totalsFor(filteredJobs.filter((j) => assignments[j.key]));
  const assignedCount = filteredJobs.filter((j) => assignments[j.key]).length;

  /* ================================================================ render */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-auto">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0"><CalendarDays size={18} /></div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 leading-tight">Planeación por color</h2>
              <p className="text-xs text-slate-500">Asigna cada color a una semana · 6 meses de horizonte</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Equivalencia</label>
            <input type="number" min="0.1" step="0.1" value={equivalence}
              onChange={(e) => setEquivalence(Number(e.target.value) || EQUIV_DEFAULT)}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900"
              title="Minutos SAM de una prenda base = 1 pieza equivalente" />
            <button type="button" onClick={() => setShowEqInfo((s) => !s)} className="p-1 rounded text-slate-400 hover:text-slate-700" title="¿Cómo se calcula?"><Info size={15} /></button>
          </div>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {[["week", "Semana"], ["month", "Mes"], ["year", "Año"]].map(([v, label]) => (
              <button key={v} type="button" onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-semibold ${viewMode === v ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>{label}</button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            <button type="button" onClick={() => setLayout("board")} title="Tablero"
              className={`p-2 ${layout === "board" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}><LayoutGrid size={16} /></button>
            <button type="button" onClick={() => setLayout("table")} title="Tabla"
              className={`p-2 ${layout === "table" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}><Table2 size={16} /></button>
          </div>
        </div>

        {showEqInfo && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 flex gap-2">
            <Info size={15} className="shrink-0 mt-0.5 text-slate-400" />
            <span>Con equivalencia <b>{fmt2(equivalence)}</b>: por color <b>eq/pza = SAM ÷ {fmt2(equivalence)}</b> y{" "}
              <b>piezas equivalentes = cantidad × (SAM ÷ {fmt2(equivalence)})</b>. Carga normalizada, comparable entre estilos.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por N° de orden, cliente, estilo, color…"
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => step(-1)} className="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></button>
            <span className="text-xs font-medium text-slate-600 min-w-56 text-center">{rangeLabel()}</span>
            <button type="button" onClick={() => step(1)} className="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></button>
            <button type="button" onClick={() => setCurrentDate(new Date())} className="ml-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100">Hoy</button>
          </div>
          <button type="button" onClick={fetchOrders} disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
          <span className="inline-flex items-center gap-1.5"><Package size={14} className="text-slate-400" />{assignedCount} de {filteredJobs.length} colores asignados</span>
          <span className="inline-flex items-center gap-1.5"><Boxes size={14} className="text-slate-400" /><b className="text-slate-700">{fmtInt(grandAssigned.real)}</b> pzas reales</span>
          <span className="inline-flex items-center gap-1.5"><Timer size={14} className="text-slate-400" /><b className="text-slate-700">{fmtInt(grandAssigned.eq)}</b> pzas equivalentes</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${planOnline ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}
            title={planOnline ? "Los cambios se guardan en el servidor" : "Sin conexión al plan — los cambios quedan en este navegador"}>
            {planOnline ? "☁️ Guardado en servidor" : "💾 Solo local"}
          </span>
          {!!assignedCount && <button type="button" onClick={clearAll} className="ml-auto text-rose-600 hover:underline">Limpiar asignaciones</button>}
          {!apiOnline && !loading && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">⚠️ Demo</span>}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-slate-400 text-sm"><RefreshCw size={24} className="animate-spin mx-auto mb-2" /> Cargando órdenes…</div>
      ) : layout === "table" ? (
        <PlannerTable jobs={filteredJobs} weeks={assignable ? periods : null} currentDate={currentDate}
          assignments={assignments} onAssign={assignToWeek} onUnassign={unassign} />
      ) : assignable ? (
        <>
          {/* Pool of colors to place (week view only). It doubles as a drop
              zone: dragging a placed color back here unassigns it. */}
          <div
            className={`bg-white border rounded-xl shadow-sm transition ${poolDrop ? "border-rose-300 ring-2 ring-rose-200 bg-rose-50/40" : "border-slate-200"}`}
            onDragOver={(e) => { if (dragKey && assignments[dragKey]) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setPoolDrop(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPoolDrop(false); }}
            onDrop={(e) => {
              e.preventDefault(); setPoolDrop(false);
              const k = dragKey ?? e.dataTransfer.getData("text/plain");
              if (k && assignments[k]) unassign(k);
              setDragKey(null);
            }}
          >
            <button onClick={() => setPoolOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Package size={15} className="text-slate-500" /> Colores por asignar ({board.pool.length})</span>
              <span className="text-xs text-slate-500">
                {poolDrop ? <b className="text-rose-600">Suelta aquí para quitar del tablero</b> : (poolOpen ? "Ocultar" : "Mostrar")}
              </span>
            </button>
            {poolOpen && (
              <div className="px-4 pb-3">
                {board.pool.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">{poolDrop ? "Suelta aquí para quitarlo del tablero" : "Todo asignado 🎉"}</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {board.pool.map((j) => (
                      <JobCard key={j.key} j={j} armed={armed === j.key}
                        onTap={() => tapCard(j.key)} onDragStart={() => setDragKey(j.key)} onDragEnd={() => setDragKey(null)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {active != null && (() => {
            const moving = !!assignments[active];
            const j = filteredJobs.find((x) => x.key === active);
            return (
              <div className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <Info size={14} className="text-blue-600" />
                <span>
                  <b>{j ? `${j.work_order_no}${j.color ? " · " + j.color : ""}` : "Color"}</b>{" "}
                  {moving
                    ? "en movimiento — toca una celda de la semana destino para moverlo, o suéltalo en «Colores por asignar» para quitarlo."
                    : "listo — toca una celda vacía de la semana para asignarlo."} (Esc para cancelar)
                </span>
              </div>
            );
          })()}

          <WeekGrid
            periods={periods} board={board} active={active} dragKey={dragKey} armed={armed}
            dropTarget={dropTarget} setDropTarget={setDropTarget} setDragKey={setDragKey}
            assignToWeek={assignToWeek} onOpenJob={setSelectedJob} onArmJob={setArmed}
          />

          {board.outOfRange > 0 && (
            <p className="text-[11px] text-amber-600">{board.outOfRange} color(es) fuera de las {WEEKS_AHEAD} semanas visibles — usa ‹ › para verlos.</p>
          )}
        </>
      ) : (
        <>
          <div className="text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 inline-flex items-center gap-2">
            <Lock size={13} className="text-slate-400" /> Vista de solo lectura — cambia a <b>Semana</b> para asignar o mover.
          </div>
          <AggGrid periods={periods} board={board} totalsFor={totalsFor}
            onOpen={(p, list) => { const t = totalsFor(list); setAggModal({ label: `${p.top} ${p.bottom}`, jobs: list, ...t }); }} />
        </>
      )}

      {/* Month / year breakdown */}
      {aggModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={() => setAggModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">{aggModal.label}</h3>
              <p className="text-sm text-slate-500">{fmtInt(aggModal.eq)} pzas eq · {fmtInt(aggModal.real)} pzas reales · {aggModal.jobs.length} color(es)</p>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {aggModal.jobs.slice().sort((a, b) => b.eqPieces - a.eqPieces).map((j) => (
                <div key={j.key} className="py-2 flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForKey(j.key).dot}`} />
                  <span className="font-mono text-sm font-medium text-slate-800 truncate">{j.work_order_no}{j.color ? ` · ${j.color}` : ""}</span>
                  <span className="ml-auto text-sm text-slate-600 whitespace-nowrap">{fmtInt(j.eqPieces)} eq</span>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
              <button onClick={() => setAggModal(null)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Single job detail (click a filled week cell) */}
      {selectedJob && (
        <JobDetailModal job={selectedJob} assignedWeek={assignments[selectedJob.key]}
          weeks={assignable ? periods : null}
          onMove={(weekStart) => { const p = periods.find((x) => x.start === weekStart); if (p) { assignToWeek(selectedJob.key, p); setSelectedJob(null); } }}
          onClose={() => setSelectedJob(null)} onRemove={() => unassign(selectedJob.key)} />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw] ${toast.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}>
          {toast.isError ? <AlertCircle size={14} className="shrink-0" /> : <Check size={14} className="text-emerald-400 shrink-0" />}
          <span className="truncate">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

/* ============================================================= week grid */

function WeekGrid({ periods, board, active, dragKey, armed, dropTarget, setDropTarget, setDragKey, assignToWeek, onOpenJob, onArmJob }) {
  const maxAssigned = Math.max(0, ...periods.map((p) => (board.byPeriod.get(p.key) || []).length));
  const rows = Math.max(MIN_ROWS, maxAssigned + 1);
  // A drag that ends on a valid target still emits a click on the source tile in
  // some browsers. Stamp the drag end and swallow clicks that land right after.
  const draggedAtRef = useRef(0);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto" style={{ maxHeight: "68vh" }}>
      <div className="inline-flex gap-2 p-3" style={{ gap: GAP }}>
        {periods.map((p) => {
          const list = board.byPeriod.get(p.key) || [];
          const isDrop = dropTarget === p.key && active != null;
          const colTotalEq = list.reduce((s, j) => s + j.eqPieces, 0);
          // The whole column is the drop zone, so a color can be dropped onto an
          // empty slot OR onto a tile that is already sitting in that week.
          // dragleave only counts when the pointer truly exits the column —
          // otherwise crossing between child cells clears the highlight.
          return (
            <div key={p.key} style={{ width: CELL_W }}
              className={`shrink-0 rounded-lg transition ${isDrop ? "ring-2 ring-blue-400 bg-blue-50/50" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(p.key); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((t) => (t === p.key ? null : t)); }}
              onDrop={(e) => { e.preventDefault(); setDropTarget(null); const k = dragKey ?? e.dataTransfer.getData("text/plain"); if (k) assignToWeek(k, p); setDragKey(null); }}
            >
              {/* Week header */}
              <div className="sticky top-0 z-10 bg-white text-center pb-1.5">
                <div className="text-[11px] font-bold text-slate-500 leading-tight">{p.top}</div>
                <div className="text-[11px] text-slate-400 leading-tight">{p.bottom}</div>
                {colTotalEq > 0 && <div className="text-[10px] font-mono font-semibold text-blue-600 leading-tight">{fmtInt(colTotalEq)}</div>}
              </div>

              {/* Cells */}
              <div className="flex flex-col" style={{ gap: GAP }}>
                {Array.from({ length: rows }).map((_, r) => {
                  const j = list[r];
                  if (j) {
                    const c = colorForKey(j.key);
                    const isArmed = armed === j.key;
                    const isDragging = dragKey === j.key;
                    // Placed tiles are draggable (move to another week) and tappable:
                    // first tap picks the tile up for touch users, second opens detail.
                    return (
                      <div key={j.key} draggable
                        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.key); setDragKey(j.key); onArmJob(null); }}
                        onDragEnd={() => { draggedAtRef.current = Date.now(); setDragKey(null); setDropTarget(null); }}
                        onClick={() => {
                          if (Date.now() - draggedAtRef.current < 300) return;
                          if (isArmed) { onArmJob(null); onOpenJob(j); } else onArmJob(j.key);
                        }}
                        title={`${j.work_order_no}${j.color ? " · " + j.color : ""} · ${j.estilo || ""} · ${fmtInt(j.eqPieces)} pzas eq — arrástrala a otra semana, o tócala y luego toca la semana destino`}
                        style={{ height: CELL_H }}
                        className={`rounded-lg ${c.solid} text-white flex flex-col items-center justify-center cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition leading-none px-1
                          ${isDragging ? "opacity-40" : ""}
                          ${isArmed ? "ring-2 ring-offset-1 ring-slate-900 shadow-md" : ""}`}>
                        <span className="text-[9px] font-mono opacity-90 truncate max-w-full">{j.work_order_no.replace(/^OP-\d+-/, "")}{j.color ? "·" + j.color : ""}</span>
                        <span className="text-sm font-bold font-mono">{fmtInt(j.eqPieces)}</span>
                      </div>
                    );
                  }
                  // empty slot — first empty row is the primary drop/click target
                  const isPrimary = r === list.length;
                  return (
                    <button key={`e${r}`} type="button" style={{ height: CELL_H }}
                      onClick={() => { if (active != null) assignToWeek(active, p); }}
                      className={`rounded-lg border transition ${
                        isDrop && isPrimary ? "border-blue-400 bg-blue-100 ring-2 ring-blue-300"
                        : active != null ? "border-blue-200 bg-blue-50/40 hover:bg-blue-50 cursor-pointer"
                        : "border-slate-200 bg-slate-50"}`} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===================================================== month / year grid */

function AggGrid({ periods, board, totalsFor, onOpen }) {
  const maxEq = Math.max(1, ...periods.map((p) => totalsFor(board.byPeriod.get(p.key) || []).eq));
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto">
      <div className="inline-flex p-3" style={{ gap: GAP }}>
        {periods.map((p) => {
          const list = board.byPeriod.get(p.key) || [];
          const t = totalsFor(list);
          const has = t.eq > 0;
          const intensity = has ? Math.max(0.18, t.eq / maxEq) : 0;
          return (
            <div key={p.key} style={{ width: CELL_W }} className="shrink-0">
              <div className="text-center pb-1.5">
                <div className="text-[11px] font-bold text-slate-500 leading-tight">{p.top}</div>
                <div className="text-[11px] text-slate-400 leading-tight">{p.bottom}</div>
              </div>
              <button type="button" disabled={!has} onClick={() => has && onOpen(p, list)}
                title={has ? `${list.length} color(es) · ${fmtInt(t.eq)} pzas eq` : "Sin asignaciones"}
                style={{ height: CELL_H * 2, backgroundColor: has ? `rgba(37,99,235,${intensity})` : undefined }}
                className={`w-full rounded-lg border flex flex-col items-center justify-center transition ${
                  has ? "border-blue-300 text-blue-900 hover:ring-2 hover:ring-blue-300" : "border-slate-200 bg-slate-50 text-slate-300"}`}>
                {has ? (
                  <>
                    <span className="text-base font-bold font-mono">{fmtInt(t.eq)}</span>
                    <span className="text-[10px]">{list.length} color(es)</span>
                  </>
                ) : <span className="text-xs">—</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================= pieces */

function JobCard({ j, armed, onTap, onDragStart, onDragEnd }) {
  const c = colorForKey(j.key);
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.key); onDragStart?.(); }} onDragEnd={onDragEnd} onClick={onTap}
      title="Arrástrala a una semana, o tócala y luego toca una celda"
      className={`shrink-0 w-60 rounded-xl border bg-white px-2.5 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition group
        ${armed ? "ring-2 ring-slate-900 border-transparent" : "border-slate-200"}`}>
      <div className="flex items-center gap-1.5">
        <GripVertical size={13} className="text-slate-300 shrink-0" />
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${c.dot}`} />
        <span className="font-mono text-xs font-bold text-slate-800 truncate">{j.work_order_no}</span>
        {j.color && <span className="ml-auto text-[10px] rounded-full bg-slate-100 text-slate-700 px-1.5 py-0.5 font-mono">{j.color}</span>}
      </div>
      <p className="text-[11px] text-slate-500 truncate mt-0.5">{j.customer_name}{j.customer_po ? ` · ${j.customer_po}` : ""}</p>
      <p className="text-[11px] text-slate-600 truncate">
        <span className="font-mono text-slate-500">{j.style_code}</span>
        {j.estilo ? <> · <span className="text-slate-400">Estilo</span> <span className="font-mono">{j.estilo}</span></> : null}
      </p>
      {j.sizes.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {j.sizes.map((s) => (
            <span key={s.talla} className="text-[10px] rounded bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 font-mono">{s.talla}: {fmtInt(s.quantity)}</span>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono">
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-600 px-1.5 py-0.5"><Package size={10} />{fmtInt(j.cantidad)}</span>
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-600 px-1.5 py-0.5"><Timer size={10} />{fmt2(j.sam)}</span>
        <span className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold ${c.soft} ${c.text}`}
          title="Piezas equivalentes = cantidad × (SAM ÷ equivalencia)">{fmtInt(j.eqPieces)} eq</span>
      </div>
    </div>
  );
}

function JobDetailModal({ job, assignedWeek, weeks, onMove, onClose, onRemove }) {
  const c = colorForKey(job.key);
  const curWeek = assignedWeek ? mondayOf(assignedWeek) : "";
  const Row = ({ k, v, mono }) => (
    <div className="flex justify-between gap-3 py-1 border-b border-slate-50 last:border-0">
      <span className="text-slate-500 text-sm">{k}</span>
      <span className={`text-sm text-slate-800 text-right ${mono ? "font-mono" : ""}`}>{v == null || v === "" ? "—" : v}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${c.dot}`} />
          <div className="min-w-0">
            <h3 className="font-mono font-bold text-slate-900 truncate">{job.work_order_no}{job.color ? ` · ${job.color}` : ""}</h3>
            <p className="text-xs text-slate-500 truncate">{job.style_description || job.style_code}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-1">
          <Row k="Cliente" v={job.customer_name} />
          {job.customer_po && <Row k="PO cliente" v={job.customer_po} mono />}
          <Row k="Estilo (code)" v={job.style_code} mono />
          <Row k="Estilo N°" v={job.estilo} mono />
          <Row k="Cantidad" v={`${fmtInt(job.cantidad)} pzas`} mono />
          <Row k="SAM" v={`${fmt2(job.sam)} min`} mono />
          <Row k="eq/pza" v={fmt2(job.eqPerPiece)} mono />
          <Row k="Piezas equivalentes" v={`${fmtInt(job.eqPieces)} eq`} mono />
          <Row k="Semana asignada" v={curWeek ? curWeek.split("-").reverse().join("/") : "—"} mono />
          {weeks && onMove && (
            <div className="pt-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mover a otra semana</label>
              <select
                value={weeks.some((w) => w.start === curWeek) ? curWeek : ""}
                onChange={(e) => e.target.value && onMove(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                <option value="">Elige la semana destino…</option>
                {weeks.map((w) => <option key={w.key} value={w.start}>{w.top} · {w.bottom}</option>)}
              </select>
            </div>
          )}
          {job.sizes.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Tallas · cantidad</p>
              <div className="flex flex-wrap gap-1">
                {job.sizes.map((s) => (
                  <span key={s.talla} className="text-[11px] rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-slate-700">{s.talla} × {fmtInt(s.quantity)}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-between">
          <button onClick={onRemove} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 border border-rose-200"><Trash2 size={14} /> Quitar del tablero</button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================== table view */

function PlannerTable({ jobs, weeks, currentDate, assignments, onAssign, onUnassign }) {
  const weekOptions = useMemo(() => {
    if (weeks) return weeks;
    const first = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
      const s = addDays(first, i * 7), e = endOfWeek(s, { weekStartsOn: 1 });
      return { key: ymd(s), top: `SEM ${getWeek(s, { weekStartsOn: 1 })}`, bottom: `${format(s, "dd/MM")} – ${format(e, "dd/MM")}`, start: ymd(s), end: ymd(e) };
    });
  }, [weeks, currentDate]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-4 py-3">N° orden</th><th className="px-4 py-3">Cliente</th><th className="px-4 py-3">Estilo</th>
            <th className="px-4 py-3">Color</th><th className="px-4 py-3">Tallas · cantidad</th>
            <th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3 text-right">SAM</th>
            <th className="px-4 py-3 text-right">eq/pza</th><th className="px-4 py-3 text-right">Pzas eq</th>
            <th className="px-4 py-3">Asignar a semana</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400">No hay órdenes que coincidan.</td></tr>}
          {jobs.map((j) => {
            const assignedWeek = assignments[j.key] ? mondayOf(assignments[j.key]) : "";
            const known = weekOptions.some((w) => w.start === assignedWeek);
            const c = colorForKey(j.key);
            return (
              <tr key={j.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-top">
                <td className="px-4 py-2 whitespace-nowrap font-mono font-bold text-slate-800"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${c.dot}`} />{j.work_order_no}</span></td>
                <td className="px-4 py-2 whitespace-nowrap text-slate-600">{j.customer_name}</td>
                <td className="px-4 py-2 whitespace-nowrap font-mono text-slate-600">{j.estilo || j.style_code}</td>
                <td className="px-4 py-2 whitespace-nowrap font-mono text-slate-700">{j.color || "—"}</td>
                <td className="px-4 py-2">
                  {j.sizes.length ? (
                    <div className="flex flex-wrap gap-1 max-w-64">
                      {j.sizes.map((s) => (<span key={s.talla} className="text-[10px] rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-slate-700">{s.talla}<span className="text-slate-400">×</span>{fmtInt(s.quantity)}</span>))}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{fmtInt(j.cantidad)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">{fmt2(j.sam)}</td>
                <td className="px-4 py-2 text-right font-mono text-slate-500">{fmt2(j.eqPerPiece)}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">{fmtInt(j.eqPieces)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <select value={known ? assignedWeek : ""}
                      onChange={(e) => { const w = weekOptions.find((x) => x.start === e.target.value); if (w) onAssign(j.key, w); else onUnassign(j.key); }}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                      <option value="">Sin asignar</option>
                      {weekOptions.map((w) => <option key={w.key} value={w.start}>{w.top} · {w.bottom}</option>)}
                    </select>
                    {assignedWeek && !known && <span className="text-[10px] text-amber-600" title={`Semana del ${assignedWeek}, fuera del rango`}>fuera de rango</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}