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
  Tag, CheckSquare, Square, ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL, TALLAS } from "../../lib/masterCodeCatalog";

/* ------------------------------------------------------------------ config */

const STORE_KEY = "merchant_plan_v2";
const EQUIV_DEFAULT = 10;
const WEEK_CAP = 50000;   // máximo de PIEZAS REALES (cantidad) asignables por semana
const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const WEEKS_AHEAD = 26;   // ~6 months
const CELL_W = 104;       // px — week column / cell width
const CELL_H = 46;        // px — cell height
const GAP = 8;            // px
const MIN_ROWS = 10;      // keep the empty grid looking full

// Pre-order accent: a distinct DASHED violet border + "PRE" badge, chosen so it
// never collides with the board's other signal colors (blue = drop target,
// rose = over-cap / remove, emerald = saved, amber = near cap).
const PREORDER_ACCENT = "#7c3aed";   // violet-600
const PREORDER_SOFT   = "#ede9fe";   // violet-100

// Color is keyed on the STYLE CODE (tipo·modelo·correlativo — e.g. "DAMBOD08"),
// so every job that shares a style code shares one color, and distinct style
// codes get entirely different colors. Colors are computed as inline HSL (not
// Tailwind classes) so we're not capped at a small fixed palette.
const styleKeyOf = (j) => String(j.style_code || j.estilo || j.key || "");

// HSL → sRGB (0-255), used to pick a legible text color on the solid chip.
const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
};
const readableOn = ([r, g, b]) =>
  (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1e293b" : "#ffffff";

// Distinct color for the i-th style code. Golden-angle hue spacing (≈137.5°)
// keeps consecutive codes (DAMBOD08 vs DAMBOD09) maximally far apart in hue.
const styleColorAt = (i) => {
  const hue = Math.round((i * 137.508) % 360);
  return {
    solidBg: `hsl(${hue}, 62%, 45%)`,
    onSolid: readableOn(hslToRgb(hue, 62, 45)),
    dotBg:   `hsl(${hue}, 62%, 45%)`,
    softBg:  `hsl(${hue}, 72%, 94%)`,
    textFg:  `hsl(${hue}, 55%, 30%)`,
  };
};
const NEUTRAL = { solidBg: "#94a3b8", onSolid: "#ffffff", dotBg: "#94a3b8", softBg: "#f8fafc", textFg: "#475569" };

// Build a stable style-code → color map for a set of jobs. Sorting the distinct
// style codes makes the assignment deterministic for a given dataset.
const buildStyleColors = (jobs) => {
  const keys = [...new Set(jobs.map(styleKeyOf).filter(Boolean))].sort();
  const map = new Map(keys.map((k, i) => [k, styleColorAt(i)]));
  return (j) => map.get(styleKeyOf(j)) || NEUTRAL;
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
const fmtDate = (v) => { const s = ymd(v); return s ? s.split("-").reverse().join("/") : "—"; };
const sizeRank = (code) => { const i = TALLAS.findIndex((t) => t.code === code); return i === -1 ? 999 : i; };

// PO cliente → estilo → talla×cantidad, from an order's lines. Pass a `color`
// to scope it to a single color (as the color-cards / detail do). Mirrors the
// planner board so both sides show the exact same breakdown.
function buildBreakdownFromLines(lines, color) {
  const detail = new Map(); // `${po}\u0000${estilo}` -> { customerPo, estilo, sizeMap, total }
  (Array.isArray(lines) ? lines : []).forEach((l) => {
    if (!l || l.color == null) return;
    if (color !== undefined && String(l.color || "") !== String(color || "")) return;
    const po = l.customerPo || l.customer_po || "";
    const est = l.estilo || "";
    const dk = `${po}\u0000${est}`;
    let d = detail.get(dk);
    if (!d) { d = { customerPo: po, estilo: est, sizeMap: new Map(), total: 0 }; detail.set(dk, d); }
    const q = num(l.quantity);
    if (l.talla) d.sizeMap.set(l.talla, (d.sizeMap.get(l.talla) || 0) + q);
    d.total += q;
  });
  const poMap = new Map();
  for (const d of detail.values()) {
    let g = poMap.get(d.customerPo);
    if (!g) { g = { customerPo: d.customerPo, total: 0, styles: [] }; poMap.set(d.customerPo, g); }
    g.total += d.total;
    g.styles.push({
      estilo: d.estilo,
      total: d.total,
      sizes: [...d.sizeMap.entries()]
        .map(([talla, quantity]) => ({ talla, quantity }))
        .sort((a, b) => sizeRank(a.talla) - sizeRank(b.talla)),
    });
  }
  return [...poMap.values()]
    .sort((a, b) => String(a.customerPo).localeCompare(String(b.customerPo)))
    .map((g) => ({ ...g, styles: g.styles.sort((a, b) => String(a.estilo).localeCompare(String(b.estilo))) }));
}

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return {
      assignments: raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {},
      equivalence: Number(raw.equivalence) > 0 ? Number(raw.equivalence) : EQUIV_DEFAULT,
      preOrders: Array.isArray(raw.preOrders) ? raw.preOrders : [],
    };
  } catch { return { assignments: {}, equivalence: EQUIV_DEFAULT, preOrders: [] }; }
}
function saveStore(next) { try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch {} }

/* -------- server sync (falls back to the localStorage cache when offline) -- */
const PLAN_URL = `${API_URL}/api/merchant-plan`;
const splitKey = (key) => { const i = key.indexOf(":"); return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)]; };

// A job + its week, in the shape the API expects (snapshot of the detail).
const planItem = (j, weekStart, equivalence, isPreOrder = false) => ({
  // Una fila del tablero es de PO real o de PRE-ORDEN, nunca de las dos.
  workOrderId: j.preOrderId ? null : j.workOrderId,
  preOrderId: j.preOrderId ?? null,
  color: j.color || "", weekStart,
  workOrderNo: j.work_order_no, customerName: j.customer_name, customerPo: j.customer_po,
  styleCode: j.style_code, estilo: j.estilo, styleDescription: j.style_description,
  cantidad: j.cantidad, samMinutes: j.sam, equivalence,
  eqPerPiece: j.eqPerPiece, eqPieces: j.eqPieces, sizes: j.sizes,
  // Las pre-órdenes van marcadas siempre: por eso no hay que taggearlas a mano.
  isPreOrder: !!isPreOrder || !!j.preOrderId,
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
async function apiDeleteOne({ workOrderId, preOrderId, color }) {
  const owner = preOrderId != null
    ? `preOrderId=${encodeURIComponent(preOrderId)}`
    : `workOrderId=${encodeURIComponent(workOrderId)}`;
  const r = await fetch(`${PLAN_URL}?${owner}&color=${encodeURIComponent(color || "")}`,
    { method: "DELETE", headers: authHeaders() });
  if (!r.ok) throw new Error(`DELETE ${r.status}`);
  return r.json();
}
// Respaldo de la semana EN la pre-orden misma. El tablero ya la guarda en
// merchant_week_plan, pero esa fila desaparece al convertir: esta copia es la
// que garantiza que la PO nueva aterrice en la semana donde estaba la PRE####.
async function apiSetPreWeek(preOrderId, weekStart) {
  const r = await fetch(`${API_URL}/api/pre-orders/${encodeURIComponent(preOrderId)}/week`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ weekStart: weekStart || null }),
  });
  if (!r.ok) throw new Error(`POST week ${r.status}`);
  return r.json();
}

async function apiBulk(items, equivalence) {
  const r = await fetch(PLAN_URL, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ items, equivalence }) });
  if (!r.ok) throw new Error(`PUT ${r.status}`);
  return r.json();
}

/* --------------------------------------------------------- pre-order jobs */
// Una PRE#### todavía no tiene PO, color, tallas ni SAM: solo estilo, cliente
// y piezas. Aun así entra al tablero como una ficha más — marcada como
// pre-orden desde que nace — para que el merchant vea la carga comprometida
// junto a las órdenes reales. Al convertirla, su ficha desaparece y las POs
// reales heredan la semana (lo hace el backend en /convert).
const PRE_PREFIX = "pre:";
const preJobKey = (id) => `${PRE_PREFIX}${id}`;
const isPreJobKey = (key) => String(key).startsWith(PRE_PREFIX);

function buildPreJobs(preOrders, eq) {
  const factor = eq > 0 ? eq : EQUIV_DEFAULT;
  return (preOrders || []).map((p) => {
    // El SAM llega con la PO; mientras tanto la carga equivalente es 0 y la
    // ficha lo dice en vez de fingir un número.
    const sam = num(p.sam_minutes);
    const eqPerPiece = sam / factor;
    const cantidad = num(p.pieces);
    const date = p.target_date || null;
    return {
      key: preJobKey(p.id),
      preOrderId: p.id,
      workOrderId: null,
      isPreOrderRow: true,
      work_order_no: p.pre_order_no,
      customer_name: p.customer_name || "—",
      customer_po: p.customer_po || "",
      style_code: p.style_code || "—",
      estilo: p.estilo || "",
      style_description: p.style_description || "",
      photo: null,
      status: "pre_order",
      sam, eqPerPiece,
      commitment_date: date,
      color: null,
      sizes: [],
      breakdown: [],
      cantidad,
      eqPieces: cantidad * eqPerPiece,
      deliveryDate: date,
      deliveryDateMax: date,
      deliveryDates: date ? [date] : [],
    };
  });
}

// Orden del tablero: por fecha comprometida, luego por número.
const byDateThenNo = (a, b) => {
  const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
  const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
  if (da !== db) return da - db;
  const c = String(a.work_order_no).localeCompare(String(b.work_order_no));
  return c !== 0 ? c : String(a.color || "").localeCompare(String(b.color || ""));
};

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
    // A line/color may carry its own delivery date (fecha de entrega); fall
    // back to the order header's commitment_date when it doesn't.
    const pickDate = (x) => {
      const d = x && (x.commitmentDate ?? x.commitment_date ?? x.deliveryDate ?? x.delivery_date);
      return d ? ymd(d) : "";
    };
    const mk = (color, qty, sizes, estilo, breakdown, dates) => {
      const src = (dates && dates.length ? dates : (base.commitment_date ? [ymd(base.commitment_date)] : [])).filter(Boolean);
      const uniq = [...new Set(src)].sort();
      return {
        ...base, key: `${base.workOrderId}:${color || ""}`, color: color || null,
        estilo: estilo || o.estilo || "",
        sizes: (sizes || []).slice().sort((a, b) => sizeRank(a.talla) - sizeRank(b.talla)),
        // PO cliente → estilo → talla×cantidad for this color ([] when no line detail).
        breakdown: breakdown || [],
        cantidad: qty, eqPieces: qty * eqPerPiece,
        // Delivery date(s) for this color: earliest is the binding one.
        deliveryDate: uniq[0] || null,
        deliveryDateMax: uniq[uniq.length - 1] || null,
        deliveryDates: uniq,
      };
    };
    const lines = Array.isArray(o.lines) ? o.lines.filter((l) => l && l.color != null) : [];
    const colors = Array.isArray(o.colors) ? o.colors.filter((c) => c && c.color != null) : [];
    if (lines.length) {
      const byColor = new Map();
      for (const l of lines) {
        const cur = byColor.get(l.color) || { color: l.color, qty: 0, sizeMap: new Map(), estilos: new Set(), dates: new Set() };
        const q = num(l.quantity);
        cur.qty += q;
        if (l.talla) cur.sizeMap.set(l.talla, (cur.sizeMap.get(l.talla) || 0) + q);
        if (l.estilo) cur.estilos.add(l.estilo);
        const dd = pickDate(l); if (dd) cur.dates.add(dd);
        byColor.set(l.color, cur);
      }
      for (const c of byColor.values())
        jobs.push(mk(c.color, c.qty, [...c.sizeMap.entries()].map(([talla, quantity]) => ({ talla, quantity })), [...c.estilos].join(", "), buildBreakdownFromLines(lines, c.color), [...c.dates]));
    } else if (colors.length) {
      for (const c of colors) jobs.push(mk(c.color, num(c.quantity), [], o.estilo, undefined, pickDate(c) ? [pickDate(c)] : undefined));
    } else {
      jobs.push(mk(o.color || null, num(o.total_to_produce ?? o.quantity ?? 0), [], o.estilo));
    }
  }
  jobs.sort((a, b) => {
    const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
    const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
    if (da !== db) return da - db;
    const c = String(a.work_order_no).localeCompare(String(b.work_order_no));
    return c !== 0 ? c : String(a.color || "").localeCompare(String(b.color || ""));
  });
  // Same color for the same tipo·modelo·correlativo; different codes → different color.
  const colorFor = buildStyleColors(jobs);
  for (const j of jobs) j.styleColor = colorFor(j);
  return jobs;
}

/* =================================================================== board */

export default function MerchantPlanner({
  orders: ordersProp, loading: loadingProp, apiOnline: apiOnlineProp, onRefresh,
} = {}) {
  const controlled = Array.isArray(ordersProp);
  const [ordersState, setOrdersState] = useState([]);
  const [preOrderRows, setPreOrderRows] = useState([]);   // PRE#### pendientes
  const [loadingState, setLoadingState] = useState(true);
  const [apiOnlineState, setApiOnlineState] = useState(false);
  const orders = controlled ? ordersProp : ordersState;
  const loading = controlled ? !!loadingProp : loadingState;
  const apiOnline = controlled ? apiOnlineProp !== false : apiOnlineState;

  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState("week");
  const [layout, setLayout] = useState("board");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [query, setQuery] = useState("");

  const initial = loadStore();
  const [assignments, setAssignments] = useState(initial.assignments);
  const [equivalence, setEquivalence] = useState(initial.equivalence);
  // Pre-orders: a Set of job keys (`${workOrderId}:${color}`) flagged as pre-order.
  const [preOrders, setPreOrders] = useState(() => new Set(initial.preOrders));
  // Selection mode: pick several jobs on the board, then one action marks/unmarks
  // them all as pre-orders at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

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
  const preSeedRef = useRef({});           // semana guardada en cada pre-orden pendiente

  const active = dragKey ?? armed;
  const assignable = viewMode === "week";

  useEffect(() => { saveStore({ assignments, equivalence, preOrders: [...preOrders] }); }, [assignments, equivalence, preOrders]);

  // Carga el tablero guardado en el servidor. localStorage ya pintó algo al
  // instante y queda como caché sin conexión.
  //
  // Se vuelve a llamar en cada "Actualizar" — no solo al montar — porque una
  // pre-orden pudo haberse convertido mientras el tablero estaba abierto: el
  // backend ya movió su semana a las POs nuevas y aquí es donde eso se ve.
  const loadPlan = async (alive = () => true) => {
      try {
        const data = await apiGetPlan();
        if (!alive()) return;
        if (data?.success) {
          const map = {};
          const serverPre = new Map();   // key -> boolean, server's view of each assigned row
          for (const row of data.plan || []) {
            const key = row.pre_order_id != null
              ? `${PRE_PREFIX}${row.pre_order_id}`
              : `${row.work_order_id}:${row.color || ""}`;
            map[key] = row.week_start;
            serverPre.set(key, !!row.is_pre_order);
          }
          // Las semanas guardadas en las pre-órdenes rellenan lo que el tablero
          // no tenga; una fila del servidor siempre gana.
          setAssignments({ ...preSeedRef.current, ...map });
          // Server is source-of-truth for assigned rows; keep any purely-local
          // pre-order flags on jobs the server doesn't have a row for.
          setPreOrders((prev) => {
            const n = new Set(prev);
            // Solo los flags manuales viven en este Set; las PRE#### se derivan.
            for (const [key, isPre] of serverPre) {
              if (isPreJobKey(key)) continue;
              if (isPre) n.add(key); else n.delete(key);
            }
            return n;
          });
          if (Number(data.equivalence) > 0) { skipFactorSaveRef.current = true; setEquivalence(Number(data.equivalence)); }
          setPlanOnline(true);
        }
      } catch (err) {
        console.warn("merchant-plan load failed, using local cache:", err.message);
        if (alive()) setPlanOnline(false);
      } finally {
        hydratedRef.current = true;
      }
  };

  useEffect(() => {
    let alive = true;
    loadPlan(() => alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!controlled) fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Pre-órdenes pendientes: se piden siempre (aunque `orders` venga del padre),
  // porque el dashboard no las carga. Si el endpoint no existe todavía, el
  // tablero sigue funcionando sin ellas.
  const fetchPreOrders = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pre-orders?status=pending`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const rows = Array.isArray(data.preOrders) ? data.preOrders : [];
      setPreOrderRows(rows);
      // Limpia del caché local las fichas PRE que ya no están pendientes
      // (convertidas o canceladas). Sin esto, una pre-orden convertida dejaría
      // su celda ocupada en este navegador aunque el servidor ya no la tenga.
      const alive = new Set(rows.map((r) => preJobKey(r.id)));
      const seeds = {};
      for (const r of rows) if (r.planned_week) seeds[preJobKey(r.id)] = r.planned_week;
      preSeedRef.current = seeds;
      setAssignments((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const k of Object.keys(next)) {
          if (isPreJobKey(k) && !alive.has(k)) { delete next[k]; changed = true; }
        }
        // Restaura la celda de una pre-orden que sí tiene semana guardada.
        for (const [k, week] of Object.entries(seeds)) {
          if (!next[k]) { next[k] = week; changed = true; }
        }
        return changed ? next : prev;
      });
    } catch { /* sin pre-órdenes, el tablero muestra solo POs */ }
  };
  useEffect(() => { fetchPreOrders(); }, []);

  const fetchOrders = async () => {
    fetchPreOrders();
    loadPlan();          // re-sincroniza semanas (incluye pre-órdenes convertidas)
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

  const jobs = useMemo(() => {
    const all = [...buildPreJobs(preOrderRows, equivalence), ...buildJobs(orders, equivalence)];
    all.sort(byDateThenNo);
    // Un solo mapa de colores para POs y pre-órdenes: el mismo estilo se ve
    // igual antes y después de convertirse.
    const colorFor = buildStyleColors(all);
    for (const j of all) j.styleColor = colorFor(j);
    return all;
  }, [orders, preOrderRows, equivalence]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  // Marcadas a mano (POs reales) + las pre-órdenes, que lo son por naturaleza.
  const preOrderKeys = useMemo(() => {
    const s = new Set(preOrders);
    for (const j of jobs) if (j.isPreOrderRow) s.add(j.key);
    return s;
  }, [preOrders, jobs]);

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

  // Real pieces (cantidad) already committed to each period — computed from ALL
  // jobs (not the search-filtered board) so the weekly cap can't be side-stepped
  // by filtering. Keyed by period.key; used for both enforcement and the header.
  const realByPeriod = useMemo(() => {
    const m = new Map(periods.map((p) => [p.key, 0]));
    for (const j of jobs) {
      const date = assignments[j.key];
      if (!date) continue;
      const p = periodOfDate(date);
      if (p && m.has(p.key)) m.set(p.key, m.get(p.key) + num(j.cantidad));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, assignments, periods]);

  // Committed real pieces in a period, optionally excluding one job (the one
  // being moved), so re-dropping a tile inside its own week never double-counts.
  const weekRealTotal = (period, excludeKey) => {
    const base = realByPeriod.get(period.key) || 0;
    const exDate = excludeKey ? assignments[excludeKey] : null;
    const exInWeek = exDate && exDate >= period.start && exDate <= period.end;
    const exQty = exInWeek ? num(jobs.find((x) => x.key === excludeKey)?.cantidad) : 0;
    return base - exQty;
  };

  const assignToWeek = (jobKey, period) => {
    if (!assignable) return;
    // Dropped back onto its current week — nothing to do (matches PlanBoard).
    if (assignments[jobKey] === period.start) { setArmed(null); setDragKey(null); setDropTarget(null); return; }
    // Enforce the weekly cap on real pieces: block anything that would push the
    // destination week past WEEK_CAP, and explain why.
    const job = jobs.find((x) => x.key === jobKey);
    const incoming = num(job?.cantidad);
    const current = weekRealTotal(period, jobKey);
    if (current + incoming > WEEK_CAP) {
      const remaining = Math.max(0, WEEK_CAP - current);
      showToast(
        `${period.top} llegaría a ${fmtInt(current + incoming)} pzas — supera el límite de ${fmtInt(WEEK_CAP)}/semana. ` +
        `Ya tiene ${fmtInt(current)}; solo caben ${fmtInt(remaining)} más.`,
        true,
      );
      setArmed(null); setDragKey(null); setDropTarget(null);
      return;
    }
    setAssignments((prev) => ({ ...prev, [jobKey]: period.start }));
    setArmed(null); setDragKey(null); setDropTarget(null);
    const j = jobs.find((x) => x.key === jobKey);
    showToast(`${j?.work_order_no || "Orden"}${j?.color ? " · " + j.color : ""} → ${period.top} · ${fmtInt(j?.eqPieces)} pzas eq`);
    if (planOnline && j) apiUpsert(planItem(j, period.start, equivalence, preOrderKeys.has(jobKey)))
      .catch((err) => { console.warn("save failed:", err.message); showToast("No se pudo guardar en el servidor (queda local)", true); });
    // Pre-orden: además del tablero, la semana se sella en la pre-orden. Es lo
    // que lee /convert para que la PO nueva nazca ya asignada a esta semana.
    if (j?.preOrderId) {
      preSeedRef.current = { ...preSeedRef.current, [jobKey]: period.start };
      apiSetPreWeek(j.preOrderId, period.start).catch((err) => {
        console.warn("pre-order week save failed:", err.message);
        showToast("La semana no se guardó en la pre-orden — al convertirla habrá que reasignarla", true);
      });
    }
  };
  const unassign = (jobKey) => {
    setAssignments((prev) => { const n = { ...prev }; delete n[jobKey]; return n; });
    setArmed(null); setDragKey(null); setSelectedJob(null);
    if (isPreJobKey(jobKey)) {
      const { [jobKey]: _drop, ...restSeeds } = preSeedRef.current;
      preSeedRef.current = restSeeds;
      apiSetPreWeek(jobKey.slice(PRE_PREFIX.length), null)
        .catch((err) => console.warn("pre-order week clear failed:", err.message));
    }
    if (planOnline) {
      if (isPreJobKey(jobKey)) {
        apiDeleteOne({ preOrderId: jobKey.slice(PRE_PREFIX.length), color: "" })
          .catch((err) => console.warn("delete failed:", err.message));
      } else {
        const [woId2, color] = splitKey(jobKey);
        apiDeleteOne({ workOrderId: woId2, color }).catch((err) => console.warn("delete failed:", err.message));
      }
    }
  };
  const clearAll = () => {
    if (!Object.keys(assignments).length) return;
    if (!window.confirm("¿Quitar todas las asignaciones del tablero?")) return;
    // Las pre-órdenes también sueltan su semana, o volverían a aparecer sembradas.
    for (const k of Object.keys(assignments)) {
      if (isPreJobKey(k)) apiSetPreWeek(k.slice(PRE_PREFIX.length), null).catch(() => {});
    }
    preSeedRef.current = {};
    setAssignments({});
    if (planOnline) apiBulk([], equivalence).catch((err) => console.warn("clear failed:", err.message));
  };
  const tapCard = (jobKey) => { if (assignable) setArmed((c) => (c === jobKey ? null : jobKey)); };

  /* -------------------------------------------------- pre-orders (selection) */
  const enterSelect = () => { setSelectMode(true); setSelected(new Set()); setArmed(null); };
  const cancelSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSelect = (jobKey) =>
    setSelected((prev) => { const n = new Set(prev); n.has(jobKey) ? n.delete(jobKey) : n.add(jobKey); return n; });

  // Persist one job's pre-order flag to the server (only if it has a board row).
  const savePreFlag = (jobKey, isPre) => {
    if (!planOnline) return;
    const j = jobs.find((x) => x.key === jobKey);
    if (j && assignments[jobKey])
      apiUpsert(planItem(j, assignments[jobKey], equivalence, isPre)).catch((err) => console.warn("pre-order save failed:", err.message));
  };

  // Mark / unmark every selected job in one action. Las PRE#### no se pueden
  // desmarcar: son pre-órdenes de verdad, no una etiqueta del tablero.
  const applyPreOrder = (makePre) => {
    if (!selected.size) return;
    const native = [...selected].filter(isPreJobKey);
    const keys = [...selected].filter((k) => !isPreJobKey(k));
    if (!keys.length) {
      showToast(native.length ? "Las PRE#### ya son pre-órdenes — no se pueden desmarcar" : "Nada seleccionado", true);
      cancelSelect();
      return;
    }
    setPreOrders((prev) => {
      const n = new Set(prev);
      for (const k of keys) (makePre ? n.add(k) : n.delete(k));
      return n;
    });
    keys.forEach((k) => savePreFlag(k, makePre));
    cancelSelect();
    showToast(makePre
      ? `${keys.length} marcada(s) como pre-orden`
      : `Se quitó la marca de pre-orden a ${keys.length}`);
  };

  // Completar la pre-orden: abre el wizard con sus datos ya cargados. Al crear
  // las POs, el backend hereda la semana de esta ficha a las órdenes nuevas
  // (POST /api/pre-orders/:id/convert), así que al volver al tablero la celda
  // ya trae la PO real — no hay que reasignarla.
  const goConvert = (job) => {
    setSelectedJob(null);
    setArmed(null);
    navigate(`/nuevo-orden-wizard?preOrderId=${job.preOrderId}`);
  };

  // Single-job toggle (used from the detail modal).
  const togglePreOne = (jobKey) => {
    if (isPreJobKey(jobKey)) return;   // una PRE#### siempre es pre-orden
    const makePre = !preOrders.has(jobKey);
    setPreOrders((prev) => { const n = new Set(prev); (makePre ? n.add(jobKey) : n.delete(jobKey)); return n; });
    savePreFlag(jobKey, makePre);
    showToast(makePre ? "Marcada como pre-orden" : "Se quitó la marca de pre-orden");
  };

  // When the equivalencia factor changes, the stored eq snapshots go stale.
  // Debounce-resave every assigned color so the DB matches what's on screen.
  useEffect(() => {
    if (!hydratedRef.current || !planOnline) return;
    if (skipFactorSaveRef.current) { skipFactorSaveRef.current = false; return; }
    const t = setTimeout(() => {
      const items = jobsRef.current
        .filter((j) => assignments[j.key])
        .map((j) => planItem(j, assignments[j.key], equivalence, j.isPreOrderRow || preOrders.has(j.key)));
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
  const preCount = filteredJobs.filter((j) => preOrderKeys.has(j.key)).length;
  const nativePreCount = filteredJobs.filter((j) => j.isPreOrderRow).length;

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
          {assignable && layout === "board" && (
            <button type="button" onClick={() => (selectMode ? cancelSelect() : enterSelect())}
              title="Selecciona colores y márcalos como pre-orden"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                selectMode
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-violet-700 border-violet-300 hover:bg-violet-50"}`}>
              <Tag size={14} /> Pre-órdenes{preCount ? ` (${preCount})` : ""}
            </button>
          )}
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
          {preCount > 0 && (
            <span className="inline-flex items-center gap-1.5" style={{ color: PREORDER_ACCENT }}>
              <Tag size={14} /><b>{preCount}</b> pre-orden(es)
              {nativePreCount > 0 && <span className="text-slate-400">· {nativePreCount} PRE####</span>}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${planOnline ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}
            title={planOnline ? "Los cambios se guardan en el servidor" : "Sin conexión al plan — los cambios quedan en este navegador"}>
            {planOnline ? "☁️ Guardado en servidor" : "💾 Solo local"}
          </span>
          {!!assignedCount && <button type="button" onClick={clearAll} className="ml-auto text-rose-600 hover:underline">Limpiar asignaciones</button>}
          {!apiOnline && !loading && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">⚠️ Demo</span>}
        </div>
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 shadow-sm">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-800">
            <Tag size={15} /> Modo pre-órdenes
          </span>
          <span className="text-xs text-violet-700">· {selected.size} seleccionada(s) — toca los colores del tablero para elegirlos</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => applyPreOrder(true)} disabled={!selected.size}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
              <Check size={14} /> Marcar como pre-orden
            </button>
            <button type="button" onClick={() => applyPreOrder(false)} disabled={!selected.size}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40">
              Quitar pre-orden
            </button>
            <button type="button" onClick={cancelSelect}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white">Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-slate-400 text-sm"><RefreshCw size={24} className="animate-spin mx-auto mb-2" /> Cargando órdenes…</div>
      ) : layout === "table" ? (
        <PlannerTable jobs={filteredJobs} weeks={assignable ? periods : null} currentDate={currentDate}
          assignments={assignments} onAssign={assignToWeek} onUnassign={unassign} preOrders={preOrderKeys} />
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
                  <div className="flex gap-2 overflow-x-auto pb-1 items-start">
                    {board.pool.map((j) => (
                      <JobCard key={j.key} j={j} armed={armed === j.key}
                        isPre={preOrderKeys.has(j.key)} selectMode={selectMode} selected={selected.has(j.key)}
                        onToggleSelect={() => toggleSelect(j.key)}
                        onConvert={j.isPreOrderRow ? () => goConvert(j) : null}
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
            realByPeriod={realByPeriod} weekCap={WEEK_CAP} activeJob={filteredJobs.find((x) => x.key === active)}
            preOrders={preOrderKeys} selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect}
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
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: (j.styleColor || NEUTRAL).dotBg }} />
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
          weeks={assignable ? periods : null} isPre={preOrderKeys.has(selectedJob.key)}
          onTogglePre={selectedJob.isPreOrderRow ? null : () => togglePreOne(selectedJob.key)}
          onConvert={selectedJob.isPreOrderRow ? () => goConvert(selectedJob) : null}
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

function WeekGrid({ periods, board, active, dragKey, armed, dropTarget, setDropTarget, setDragKey, assignToWeek, onOpenJob, onArmJob, realByPeriod, weekCap, activeJob, preOrders, selectMode, selected, onToggleSelect }) {
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
          // Weekly real-piece capacity (source-of-truth totals, cap enforced in
          // assignToWeek). Preview whether the picked-up color would fit here.
          const realTotal = realByPeriod?.get(p.key) || 0;
          const capPct = weekCap ? Math.min(1, realTotal / weekCap) : 0;
          const atCap = weekCap ? realTotal >= weekCap : false;
          const alreadyHere = activeJob && list.some((x) => x.key === activeJob.key);
          const wouldExceed = !!weekCap && !!activeJob && !alreadyHere &&
            realTotal + num(activeJob?.cantidad) > weekCap;
          // The whole column is the drop zone, so a color can be dropped onto an
          // empty slot OR onto a tile that is already sitting in that week.
          // dragleave only counts when the pointer truly exits the column —
          // otherwise crossing between child cells clears the highlight.
          return (
            <div key={p.key} style={{ width: CELL_W }}
              className={`shrink-0 rounded-lg transition ${
                wouldExceed ? "ring-2 ring-rose-300 bg-rose-50/40"
                : isDrop ? "ring-2 ring-blue-400 bg-blue-50/50" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(p.key); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((t) => (t === p.key ? null : t)); }}
              onDrop={(e) => { e.preventDefault(); setDropTarget(null); const k = dragKey ?? e.dataTransfer.getData("text/plain"); if (k) assignToWeek(k, p); setDragKey(null); }}
            >
              {/* Week header */}
              <div className="sticky top-0 z-10 bg-white text-center pb-1.5">
                <div className="text-[11px] font-bold text-slate-500 leading-tight">{p.top}</div>
                <div className="text-[11px] text-slate-400 leading-tight">{p.bottom}</div>
                {colTotalEq > 0 && <div className="text-[10px] font-mono font-semibold text-blue-600 leading-tight">{fmtInt(colTotalEq)} eq</div>}
                {weekCap ? (
                  <div className="px-0.5 pt-0.5" title={`Piezas reales asignadas · límite ${fmtInt(weekCap)}/semana`}>
                    <div className={`text-[9px] font-mono leading-tight ${atCap ? "text-rose-600 font-bold" : capPct >= 0.8 ? "text-amber-600" : "text-slate-400"}`}>
                      {fmtInt(realTotal)}/{fmtInt(weekCap)}
                    </div>
                    <div className="mt-0.5 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full transition-all ${atCap ? "bg-rose-500" : capPct >= 0.8 ? "bg-amber-500" : "bg-blue-400"}`}
                        style={{ width: `${Math.round(capPct * 100)}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Cells */}
              <div className="flex flex-col" style={{ gap: GAP }}>
                {Array.from({ length: rows }).map((_, r) => {
                  const j = list[r];
                  if (j) {
                    const c = j.styleColor || NEUTRAL;
                    const isArmed = armed === j.key;
                    const isDragging = dragKey === j.key;
                    const isPre = !!preOrders?.has(j.key);
                    const isSelected = !!selected?.has(j.key);
                    // Placed tiles are draggable (move to another week) and tappable:
                    // first tap picks the tile up for touch users, second opens detail.
                    // In selection mode, tapping instead toggles pre-order selection.
                    return (
                      <div key={j.key} draggable={!selectMode}
                        onDragStart={(e) => { if (selectMode) return; e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.key); setDragKey(j.key); onArmJob(null); }}
                        onDragEnd={() => { draggedAtRef.current = Date.now(); setDragKey(null); setDropTarget(null); }}
                        onClick={() => {
                          if (selectMode) { onToggleSelect?.(j.key); return; }
                          if (Date.now() - draggedAtRef.current < 300) return;
                          if (isArmed) { onArmJob(null); onOpenJob(j); } else onArmJob(j.key);
                        }}
                        title={`${j.work_order_no}${j.color ? " · " + j.color : ""}${isPre ? " · PRE-ORDEN" : ""} · ${j.estilo || ""}${j.deliveryDate ? " · Entrega " + fmtDate(j.deliveryDate) : ""} · ${fmtInt(j.eqPieces)} pzas eq — arrástrala a otra semana, o tócala y luego toca la semana destino`}
                        style={{ height: CELL_H, backgroundColor: c.solidBg, color: c.onSolid,
                          ...(isPre ? { border: `2px dashed ${PREORDER_ACCENT}`, boxShadow: `0 0 0 2px ${PREORDER_SOFT}` } : {}) }}
                        className={`relative rounded-lg flex flex-col items-center justify-center shadow-sm hover:shadow transition leading-none px-1
                          ${selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}
                          ${isDragging ? "opacity-40" : ""}
                          ${isSelected ? "ring-2 ring-offset-1 ring-violet-500 shadow-md" : isArmed ? "ring-2 ring-offset-1 ring-slate-900 shadow-md" : ""}`}>
                        {isPre && (
                          <span className="absolute top-0.5 left-0.5 text-[7px] font-bold leading-none px-1 py-[1px] rounded-full shadow-sm"
                            style={{ backgroundColor: PREORDER_ACCENT, color: "#fff" }}>PRE</span>
                        )}
                        {selectMode && (
                          <span className="absolute top-0.5 right-0.5">
                            {isSelected ? <CheckSquare size={12} className="text-violet-200" /> : <Square size={12} className="opacity-70" />}
                          </span>
                        )}
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
                      title={wouldExceed && active != null ? `Semana llena — límite ${fmtInt(weekCap)} pzas/semana` : undefined}
                      className={`rounded-lg border transition ${
                        wouldExceed && active != null ? "border-rose-200 bg-rose-50/50 cursor-not-allowed"
                        : isDrop && isPrimary ? "border-blue-400 bg-blue-100 ring-2 ring-blue-300"
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

function JobCard({ j, armed, onTap, onDragStart, onDragEnd, isPre, selectMode, selected, onToggleSelect, onConvert }) {
  const c = j.styleColor || NEUTRAL;
  return (
    <div draggable={!selectMode}
      onDragStart={(e) => { if (selectMode) return; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.key); onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={() => (selectMode ? onToggleSelect?.() : onTap?.())}
      title={selectMode ? "Toca para seleccionar / deseleccionar" : "Arrástrala a una semana, o tócala y luego toca una celda"}
      style={isPre ? { border: `2px dashed ${PREORDER_ACCENT}`, boxShadow: `0 0 0 2px ${PREORDER_SOFT}` } : undefined}
      className={`relative shrink-0 w-60 rounded-xl border bg-white px-2.5 py-2 shadow-sm hover:shadow transition group
        ${selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}
        ${selected ? "ring-2 ring-violet-500 border-transparent" : armed ? "ring-2 ring-slate-900 border-transparent" : isPre ? "border-transparent" : "border-slate-200"}`}>
      <div className="flex items-center gap-1.5">
        {selectMode
          ? (selected ? <CheckSquare size={14} className="text-violet-600 shrink-0" /> : <Square size={14} className="text-slate-300 shrink-0" />)
          : <GripVertical size={13} className="text-slate-300 shrink-0" />}
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.dotBg }} />
        <span className="font-mono text-xs font-bold text-slate-800 truncate">{j.work_order_no}</span>
        {isPre && (
          <span className="text-[8px] font-bold leading-none px-1.5 py-0.5 rounded-full" style={{ backgroundColor: PREORDER_ACCENT, color: "#fff" }}>PRE</span>
        )}
        {j.color && <span className="ml-auto text-[10px] rounded-full bg-slate-100 text-slate-700 px-1.5 py-0.5 font-mono">{j.color}</span>}
      </div>
      <p className="text-[11px] text-slate-500 truncate mt-0.5">{j.customer_name}{j.customer_po ? ` · ${j.customer_po}` : ""}</p>
      {j.isPreOrderRow && (
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="text-[10px] truncate" style={{ color: PREORDER_ACCENT }}>
            Pre-orden · faltan tallas, colores y SAM
          </p>
          {onConvert && !selectMode && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onConvert(); }}
              title="Completar los datos y volverla orden de producción — conserva esta semana"
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0"
              style={{ backgroundColor: PREORDER_ACCENT }}>
              a PO <ArrowRight size={9} />
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-slate-600 truncate">
        <span className="font-mono text-slate-500">{j.style_code}</span>
        {j.estilo ? <> · <span className="text-slate-400">Estilo</span> <span className="font-mono">{j.estilo}</span></> : null}
      </p>
      {j.deliveryDate && (
        <p className="text-[11px] mt-0.5 flex items-center gap-1 truncate">
          <CalendarDays size={11} className="text-slate-400 shrink-0" />
          <span className="text-slate-400">Entrega</span>
          <span className="font-mono font-semibold text-slate-700">
            {j.deliveryDates && j.deliveryDates.length > 1
              ? `${fmtDate(j.deliveryDate)} – ${fmtDate(j.deliveryDateMax)}`
              : fmtDate(j.deliveryDate)}
          </span>
        </p>
      )}
      {j.breakdown && j.breakdown.length > 0 ? (
        <div className="mt-1 space-y-1.5 border-t border-slate-100 pt-1.5">
          {j.breakdown.map((po, pi) => (
            <div key={pi}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold text-slate-600 truncate"><span className="text-slate-400 font-normal">PO</span> {po.customerPo || "—"}</span>
                <span className="text-[9px] text-slate-400 font-mono shrink-0">{fmtInt(po.total)}</span>
              </div>
              {po.styles.map((st, si) => (
                <div key={si} className="pl-2 mt-0.5">
                  <div className="text-[9px] text-slate-500 font-mono truncate flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dotBg }} />
                    {j.color ? `${j.color} · ` : ""}{st.estilo || "—"}
                  </div>
                  {st.sizes.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {st.sizes.map((s) => (
                        <span key={s.talla} className="text-[9px] rounded bg-sky-50 text-sky-700 border border-sky-100 px-1 py-0.5 font-mono">{s.talla}: {fmtInt(s.quantity)}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : j.sizes.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {j.sizes.map((s) => (
            <span key={s.talla} className="text-[10px] rounded bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 font-mono">{s.talla}: {fmtInt(s.quantity)}</span>
          ))}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono">
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-600 px-1.5 py-0.5"><Package size={10} />{fmtInt(j.cantidad)}</span>
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 text-slate-600 px-1.5 py-0.5"
          title={j.isPreOrderRow && !j.sam ? "El SAM se define al convertirla en PO" : "SAM"}>
          <Timer size={10} />{j.isPreOrderRow && !j.sam ? "—" : fmt2(j.sam)}</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold" style={{ backgroundColor: c.softBg, color: c.textFg }}
          title="Piezas equivalentes = cantidad × (SAM ÷ equivalencia)">{fmtInt(j.eqPieces)} eq</span>
      </div>
    </div>
  );
}

function JobDetailModal({ job, assignedWeek, weeks, onMove, onClose, onRemove, isPre, onTogglePre, onConvert }) {
  const c = job.styleColor || NEUTRAL;
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
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.dotBg }} />
          <div className="min-w-0">
            <h3 className="font-mono font-bold text-slate-900 truncate flex items-center gap-1.5">
              {job.work_order_no}{job.color ? ` · ${job.color}` : ""}
              {isPre && <span className="text-[9px] font-sans font-bold leading-none px-1.5 py-0.5 rounded-full" style={{ backgroundColor: PREORDER_ACCENT, color: "#fff" }}>PRE-ORDEN</span>}
            </h3>
            <p className="text-xs text-slate-500 truncate">{job.style_description || job.style_code}</p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-1">
          <Row k="Cliente" v={job.customer_name} />
          {job.customer_po && <Row k="PO cliente" v={job.customer_po} mono />}
          <Row k="Estilo (code)" v={job.style_code} mono />
          <Row k="Estilo N°" v={job.estilo} mono />
          <Row k="Fecha de entrega" v={job.deliveryDate
            ? (job.deliveryDates && job.deliveryDates.length > 1
                ? `${fmtDate(job.deliveryDate)} – ${fmtDate(job.deliveryDateMax)}`
                : fmtDate(job.deliveryDate))
            : "—"} mono />
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
          {job.breakdown && job.breakdown.length > 0 ? (
            <div className="pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Desglose · PO cliente → estilo → tallas</p>
              <div className="space-y-2">
                {job.breakdown.map((po, pi) => (
                  <div key={pi} className="rounded-lg bg-slate-50 border border-slate-100 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-slate-700">
                        <span className="text-slate-400 font-normal">PO</span> {po.customerPo || "—"}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">{fmtInt(po.total)} pzas</span>
                    </div>
                    {po.styles.map((st, si) => (
                      <div key={si} className="pl-2 mt-1">
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dotBg }} />
                          {job.color ? `${job.color} · ` : ""}{st.estilo || "—"}
                        </div>
                        {st.sizes.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {st.sizes.map((s) => (
                              <span key={s.talla} className="text-[11px] rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-slate-700">{s.talla} × {fmtInt(s.quantity)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : job.sizes.length > 0 && (
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
        {onConvert && (
          <div className="px-6 pb-2">
            <button onClick={onConvert}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg"
              style={{ backgroundColor: PREORDER_ACCENT }}>
              <ArrowRight size={15} /> Completar y volverla orden de producción
            </button>
            <p className="text-[11px] text-slate-500 text-center mt-1.5">
              Las órdenes nuevas se quedan en {curWeek ? curWeek.split("-").reverse().join("/") : "esta semana"} — no hay que reasignarlas.
            </p>
          </div>
        )}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-2">
          <button onClick={onRemove} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 border border-rose-200"><Trash2 size={14} /> Quitar del tablero</button>
          <div className="flex items-center gap-2">
            {onTogglePre && (
              <button onClick={onTogglePre}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border transition"
                style={isPre
                  ? { backgroundColor: "#fff", color: PREORDER_ACCENT, borderColor: PREORDER_ACCENT }
                  : { backgroundColor: PREORDER_ACCENT, color: "#fff", borderColor: PREORDER_ACCENT }}>
                <Tag size={14} /> {isPre ? "Quitar pre-orden" : "Marcar pre-orden"}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================== table view */

function PlannerTable({ jobs, weeks, currentDate, assignments, onAssign, onUnassign, preOrders }) {
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
            const c = j.styleColor || NEUTRAL;
            const isPre = !!preOrders?.has(j.key);
            return (
              <tr key={j.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-top"
                style={isPre ? { boxShadow: `inset 3px 0 0 0 ${PREORDER_ACCENT}` } : undefined}>
                <td className="px-4 py-2 whitespace-nowrap font-mono font-bold text-slate-800">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.dotBg }} />{j.work_order_no}
                    {isPre && <span className="text-[8px] font-sans font-bold leading-none px-1.5 py-0.5 rounded-full" style={{ backgroundColor: PREORDER_ACCENT, color: "#fff" }}>PRE</span>}
                  </span>
                </td>
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