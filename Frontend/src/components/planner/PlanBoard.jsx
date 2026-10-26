// components/planner/PlanBoard.jsx
import { useState, useEffect, useMemo, useRef } from "react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, startOfYear, addMonths, eachWeekOfInterval, eachMonthOfInterval, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Package, Loader2, Check, AlertCircle, GripVertical, Search, X, Send, Lock, Unlock, CalendarDays, FileSpreadsheet, Download, Bell, MoreHorizontal, Plus, RotateCcw, Settings, Scissors, SlidersHorizontal } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO, WO_PALETTE, buildStyleColorMap } from "../../lib/workOrderColors";
import { useDayBalances, cellKey } from "./PendingBalances";
import { StyleParamsFormModal, StyleStandardsListModal, normStyle, targetOfParams, lineKey, effKey, paramsForLine } from "./StyleStandards";
// ReplanLinesModal is read from the module namespace (not a named import) so the
// board still loads when StyleStandards.jsx doesn't export it yet; in that case
// the local FallbackReplanLinesModal (bottom of this file) is used instead.
import * as StyleStandardsModule from "./StyleStandards";
const ReplanLinesModal = StyleStandardsModule.ReplanLinesModal || FallbackReplanLinesModal;

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// GET robusto para la carga del tablero: timeout, reintentos con espera y sin
// cache. Reintenta red caida, 5xx, 429 (Lambda throttled / cold start / RDS
// Proxy) y cuerpos no-JSON (502/504 de API Gateway). 4xx no se reintenta.
// Nunca lanza: regresa { ok, status, data, error }.
async function getJSON(path, { retries = 2, timeoutMs = 28000 } = {}) {
  let last = { ok: false, status: 0, data: null, error: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        cache: "no-store",
        signal: ctrl.signal,
      });
      const retryable = res.status >= 500 || res.status === 429;
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && data) return { ok: true, status: res.status, data, error: null };
      last = { ok: false, status: res.status, data, error: new Error(data?.error || `HTTP ${res.status}`) };
      if (!retryable && res.ok === false) return last; // 401/403/404: no insistir
    } catch (err) {
      last = { ok: false, status: 0, data: null, error: err };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt)); // 300, 600 ms
  }
  return last;
}

// Interruptor compacto para la barra del tablero: etiqueta corta + switch.
// Reemplaza los botones "X: ON/OFF" (más claros y no se parten en 2 líneas).
const TOGGLE_ON = { emerald: "bg-emerald-500", sky: "bg-sky-500", indigo: "bg-indigo-500" };
function ToggleChip({ on, onClick, label, title, color = "emerald" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      onClick={onClick}
      title={title}
      className={`h-8 inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition ${on ? "border-gray-300 bg-white text-gray-900 shadow-sm" : "border-gray-200 bg-transparent text-gray-500 hover:bg-white hover:text-gray-700"}`}
    >
      <span className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${on ? TOGGLE_ON[color] || TOGGLE_ON.emerald : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const producedOf = (wo) => Number(wo?.produced_quantity) || 0;
// A piece still needs a line only if it is NEITHER actively assigned NOR
// already produced. Production is tracked per order (in line_runs),
// independently of the board, so it survives deleting assignment cells and can
// outrun `assigned`. Take the greater of the two as "coverage" so the leftover
// is the true gap to the goal — e.g. 7,200 - max(3,490 assigned, 7,134
// produced) = 66, not the stale 7,200 - 3,490 = 3,710.
// `openQty` = pieces in board cells that are still ahead (status 'planned',
// dated today or later). Those pieces are NOT in `produced` yet, so they must
// be ADDED to production. Before, max(assigned, produced) ignored every new
// cell whenever produced > assigned, so an order with e.g. 388 pzas left kept
// showing its card in the pool even after the 388 were placed on a line.
const coveredOf = (wo, openQty = 0) =>
  Math.max(assignedOf(wo), producedOf(wo) + (Number(openQty) || 0));
const remainingOf = (wo, openQty = 0) => Math.max(targetOf(wo) - coveredOf(wo, openQty), 0);

// Calendar day (YYYY-MM-DD) of a DATE/ISO value, without timezone shifting.
const dayOf = (v) => {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// When an order is packed across days each cell is filled to the line's full
// daily capacity, so only the final cell carries the remainder. The earlier
// days always stay full (e.g. 466, 466, …) and the last day holds whatever is
// left over exactly as-is — even if that is only 1–2 pzs. We do NOT borrow
// pieces back from the full days to pad the tail.

// Shared breakdown: PO cliente → estilo → talla×cantidad, from work-order lines.
// Pass a `color` to scope it to a single color (used by the pool card and the
// assignment-details modal); omit it to break down every color in the order.
function buildBreakdownFromLines(lines, color) {
  const detail = new Map(); // `${po}\u0000${estilo}` -> { customerPo, estilo, sizeMap, total }
  (Array.isArray(lines) ? lines : []).forEach((l) => {
    if (!l || l.color == null) return;
    if (color !== undefined && String(l.color || "") !== String(color || "")) return;
    const po = l.customerPo || "";
    const est = l.estilo || "";
    const dk = `${po}\u0000${est}`;
    let d = detail.get(dk);
    if (!d) { d = { customerPo: po, estilo: est, sizeMap: new Map(), total: 0 }; detail.set(dk, d); }
    const q = Number(l.quantity) || 0;
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
      sizes: [...d.sizeMap.entries()].map(([talla, quantity]) => ({ talla, quantity })),
    });
  }
  return [...poMap.values()]
    .sort((a, b) => String(a.customerPo).localeCompare(String(b.customerPo)))
    .map((g) => ({ ...g, styles: g.styles.sort((a, b) => String(a.estilo).localeCompare(String(b.estilo))) }));
}

// Compact cell sizing — tuned so ~3 months of weekdays fit without scrolling.
const CELL = 22;   // px — square size
const GAP = 3;     // px — gap between squares
const LABEL = 64;  // px — line label column width (room for the late-count circle + "L12")
// Sólo se puede enviar al supermercado el plan de las semanas 1 y 2 a partir de
// la actual (0 = semana actual, que NO se envía). Debe coincidir con
// `minWeeksAhead` / `maxWeeksAhead` del servidor (supermarket-plan.js). El
// servidor es la autoridad; esto es sólo para la UX.
const SEND_MIN_WEEKS_AHEAD = 1;
const SEND_MAX_WEEKS_AHEAD = 2;

// PlanBoard sirve a DOS pantallas con el mismo código, para que el tablero del
// supermercado sea idéntico al del planner y no se separen con el tiempo:
//
//   readOnly      Modo consulta: sin arrastrar, sin editar, sin bolsa de
//                 órdenes. Todas las mutaciones salen temprano, así que ni un
//                 clic accidental ni un atajo de teclado tocan datos.
//   dataOverride  Datos ya resueltos ({ assignments, holds, holidays,
//                 workOrders, lineRuns, plannerLines, merchantPlan,
//                 equivalence, lineOrder }). Si viene, PlanBoard NO llama a la
//                 API: pinta exactamente lo que se le entrega. Es como el
//                 supermercado ve el snapshot publicado.
//   restrictWeeks Arreglo de lunes ("YYYY-MM-DD"). Recorta el calendario a esas
//                 semanas — el supermercado ve sólo lo que el planner envió.
//   heading/subheading  Títulos del encabezado.
// Fecha de entrega que el merchant puso para una orden + color: la más próxima
// de sus renglones (cada renglón trae la suya); si no hay, la de la cabecera.
function deliveryOfWoColor(wo, color) {
  if (!wo) return null;
  const day = (v) => (v ? String(v).slice(0, 10) : "");
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const want = String(color || "").trim().toUpperCase();
  const ds = (Array.isArray(wo.lines) ? wo.lines : [])
    .filter((l) => l && (!want || String(l.color || "").trim().toUpperCase() === want))
    .map((l) => day(l.commitmentDate || l.commitment_date))
    .filter(isDay)
    .sort();
  return ds[0] || (isDay(day(wo.commitment_date)) ? day(wo.commitment_date) : null);
}

// ---- Filtros del tablero (CEO) --------------------------------------------
// "" / "all" = sin filtrar. Se combinan con la búsqueda (AND).
const BOARD_FILTERS_EMPTY = { kind: "all", customer: "", season: "", line: "", proc: "all", deliv: "all" };
// Tipo: órdenes reales vs. pre-órdenes (PRE#### reservadas en el tablero y POs
// que el merchant marcó como pre-orden).
const KIND_OPTIONS = [
  { v: "orders", label: "Sin pre-órdenes (solo órdenes)" },
  { v: "pre", label: "Solo pre-órdenes" },
];
const FILTER_DEAD = new Set(["cancelled", "rejected"]);
// Igual que `ymd` del componente (día calendario sin corrimiento de zona), pero
// a nivel módulo porque los filtros se arman antes de que `ymd` exista.
const dayOfValue = (v) => {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const PROC_OPTIONS = [
  { v: "pending", label: "Pendientes" },
  { v: "in_progress", label: "En proceso" },
  { v: "completed", label: "Completadas" },
];
const DELIV_OPTIONS = [
  { v: "late", label: "Atrasadas" },
  { v: "ontime", label: "A tiempo" },
  { v: "sinplan", label: "Sin planear" },
  { v: "nofecha", label: "Sin fecha de entrega" },
];

function BoardFilterSelect({ label, value, onChange, options, allLabel }) {
  const active = !!value;
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full py-1.5 pl-2.5 pr-7 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-300 ${active ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 bg-white text-gray-700"}`}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.v;
          return <option key={v} value={v}>{typeof o === "string" ? o : o.label}</option>;
        })}
      </select>
    </label>
  );
}

export default function PlanBoard({
  readOnly = false,
  dataOverride = null,
  // Opcional: la página que contiene el tablero lo pasa para que el aviso de
  // "Corte pide" tenga un botón que lleve a «Órdenes de corte».
  onOpenCutOrders = null,
  restrictWeeks = null,
  heading,
  subheading,
  // cellDetails: en Diario, imprime dentro de cada casilla la OT, el PO cliente
  // y la cantidad asignada. Ensancha/alarga la casilla para que el texto quepa,
  // así que se activa sólo donde se necesita leer el kit (supermercado), no en
  // el tablero denso del planner.
  cellDetails = false,
  // canLockWeeks: el CEO (Analíticas de Planeación) ve un candado junto a cada
  // "Sem N" en la vista Semanal para bloquear / desbloquear esa semana. Una
  // semana bloqueada no se puede tocar desde el tablero del planner.
  canLockWeeks = false,
} = {}) {
  const [currentDate, setCurrentDate] = useState(() => {
    // Con semanas publicadas arrancamos en la PRIMERA semana enviada, no en hoy:
    // así las vistas agregadas (semana/mes) caen en el año correcto aunque lo
    // publicado sea de otro año, y el fetch de "producido" apunta al periodo real.
    if (Array.isArray(restrictWeeks) && restrictWeeks.length > 0) {
      const first = restrictWeeks.slice().sort()[0];
      const d = new Date(`${first}T00:00:00`);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  });
  // Con restrictWeeks el tablero arranca en Diario. Las vistas agregadas
  // (semana/mes) SÍ están disponibles, pero sus columnas se derivan de
  // restrictWeeks (ver `periods`), nunca de currentDate: así el supermercado no
  // puede ver una semana o un mes que planeación no publicó.
  const [viewMode, setViewMode] = useState(restrictWeeks ? "day" : "week"); // day, week, month

  // "2 órdenes/día" (split-day). When ON, a dropped order/pre-orden takes at
  // most HALF the line's daily target on any given day, so a second order can
  // share the same day. When OFF, an order fills the whole remaining capacity
  // and spills forward (original behavior). Toggle lives in the toolbar.
  const [splitDay, setSplitDay] = useState(false);

  // Con cellDetails la casilla del Diario crece para dar cabida a OT + PO +
  // cantidad. En cualquier otro caso conserva el tamaño compacto (CELL).
  const CELL_W = cellDetails ? 104 : CELL;
  const CELL_H = cellDetails ? 60 : CELL;
  const [assignments, setAssignments] = useState([]);
  const [holds, setHolds] = useState([]); // PRE#### line/day holds (Plan Board reservations)
  // Fecha de entrega (target_date) que el merchant capturó en cada PRE####,
  // { pre_order_id: "YYYY-MM-DD" }. Alimenta el resaltado de entrega al soltar.
  const [preOrderTargets, setPreOrderTargets] = useState({});
  // ---- aviso de pre-órdenes convertidas en PO ----------------------------
  // Lista completa de pre-órdenes (ya se pedía para las fechas de entrega).
  // Con ella el tablero detecta cuándo una PRE#### pasó a PO real (total o
  // parcial) y avisa al planeador: campana "Convertidas", toast al detectarlo y
  // sello "de PRE####" en la tarjeta de la PO nueva en la bolsa.
  // Lo ya visto se guarda por navegador: { [preOrderId]: firma }. La firma
  // cambia con cada conversión parcial nueva, así que vuelve a avisar.
  const [preOrdersAll, setPreOrdersAll] = useState([]);
  const [preOrdersLoaded, setPreOrdersLoaded] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false); // menú "⋯ Más" de la barra
  // ---- solicitudes de corte (cut-order-requests.js) ----------------------
  // El área de corte pide al planner que asigne una orden a corte; el tablero
  // lo avisa con "Corte pide (N)" + un toast cuando llega una nueva.
  const [cutReqs, setCutReqs] = useState([]);
  const [cutReqOpen, setCutReqOpen] = useState(false);
  const cutReqSeenRef = useRef(null); // ids pendientes ya conocidos
  // ---- cambios del merchant en órdenes ya asignadas (plan_change_notices) --
  // Cuando el merchant cambia color o cantidad de una orden que está en el
  // tablero, el servidor ajusta las celdas y deja un aviso. Aquí se muestran
  // en «Cambios» + un aviso flotante que no se va solo.
  const [changeNotices, setChangeNotices] = useState([]);
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeBanner, setChangeBanner] = useState(null); // { count, text }
  const changeSeenRef = useRef(null); // ids ya conocidos
  const [convSeen, setConvSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem("planboard.preConvSeen") || "null"); } catch { return null; }
  });
  const [holidays, setHolidays] = useState([]); // non-working days (Días festivos): plant-wide or per-line
  const [workOrders, setWorkOrders] = useState([]);
  const [lineRuns, setLineRuns] = useState([]);
  const [plannerLines, setPlannerLines] = useState([]); // lines the planner added but engineering hasn't configured
  // Planner-owned standards per style { STYLE: { sam_minutes, operators_count,
  // working_hours, efficiency, ... } } from /api/planner/style-params. These — and
  // NOT the line engineers' runs — drive every capacity number on the board.
  // The ref mirrors the state synchronously so a drop resumed right after saving
  // a standard (from an older render's closure) already sees the new values.
  const [styleParams, setStyleParamsState] = useState({});
  const styleParamsRef = useRef({});
  // Cada carga lleva un numero; solo la MAS RECIENTE puede escribir el estado.
  // Sin esto, una carga vieja y lenta (p.ej. la del montaje) que termina despues
  // de una mas nueva (foco / post-mutacion) pisaba el tablero con datos viejos.
  const fetchSeqRef = useRef(0);
  const fetchInFlightRef = useRef(false);
  const setStyleParams = (next) => {
    setStyleParamsState((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      styleParamsRef.current = v;
      return v;
    });
  };
  const putStyleParam = (key, row) => {
    styleParamsRef.current = { ...styleParamsRef.current, [key]: row };
    setStyleParams((m) => ({ ...m, [key]: row }));
  };
  // A line's OWN standard for a style { "STYLE|LINE": row } — overrides the
  // general one on that line only. Same ref pattern as styleParams.
  const [lineParams, setLineParamsState] = useState({});
  const lineParamsRef = useRef({});
  const setLineParams = (next) => {
    setLineParamsState((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      lineParamsRef.current = v;
      return v;
    });
  };
  const putLineParam = (k, row) => {
    lineParamsRef.current = { ...lineParamsRef.current, [k]: row };
    setLineParams((m) => ({ ...m, [k]: row }));
  };
  const dropLineParam = (k) => {
    const { [k]: _gone, ...rest } = lineParamsRef.current; // eslint-disable-line no-unused-vars
    lineParamsRef.current = rest;
    setLineParams((m) => { const n = { ...m }; delete n[k]; return n; });
  };
  // Replace every line standard of ONE style with the server's list.
  const replaceLineParamsOfStyle = (style, rows) => {
    const st = normStyle(style);
    const next = {};
    for (const [k, v] of Object.entries(lineParamsRef.current)) if (!k.startsWith(`${st}|`)) next[k] = v;
    for (const r of rows || []) next[lineKey(st, r.line_no)] = r;
    setLineParams(next);
  };
  // The standard that applies to a style on a line: its own, else the general.
  const paramsFor = (style, lineNo) => paramsForLine(styleParamsRef.current, lineParamsRef.current, style, lineNo);
  const [canEditStyles, setCanEditStyles] = useState(false); // server says: planner role
  // Efficiency changes waiting for the CEO { STYLE | "STYLE|LINE": request } (see effKey).
  const [pendingEff, setPendingEff] = useState({});
  const [styleForm, setStyleForm] = useState(null);  // single-style form (see StyleParamsFormModal)
  const [savingStyle, setSavingStyle] = useState(false);
  // Line picker shown before a standard change re-plans existing cells:
  // { style, recompute, resolve(lines[] | null) }.
  const [replanPrompt, setReplanPrompt] = useState(null);
  const askReplanLines = (style, recompute, scopeLine = null) =>
    new Promise((resolve) => setReplanPrompt({ style, recompute, scopeLine, resolve }));
  const [styleList, setStyleList] = useState(null);  // { lineNo, date } | { all: true }
  // "Revisar estándar al soltar": when ON the planner confirms/adjusts a style's
  // standard on every drop, not only the first time the style is seen.
  // "Entregas": marca en cada bloque asignado si su orden termina a tiempo
  // para la fecha de entrega del merchant (franja verde/roja + sello en el
  // último día). Persistido como reviewOnDrop.
  const [showDelivery, setShowDelivery] = useState(() => {
    try { return localStorage.getItem("planboard.showDelivery") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("planboard.showDelivery", showDelivery ? "1" : "0"); } catch { /* ignore */ }
  }, [showDelivery]);
  const [reviewOnDrop, setReviewOnDrop] = useState(() => {
    try { return localStorage.getItem("planboard.reviewStyleOnDrop") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("planboard.reviewStyleOnDrop", reviewOnDrop ? "1" : "0"); } catch { /* ignore */ }
  }, [reviewOnDrop]);
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [hovered, setHovered] = useState(null); // { assignment, x, y }
  // Resaltar orden: al pasar el cursor sobre un bloque se resaltan TODOS los
  // bloques de esa misma orden (en todas las líneas y días) y el resto se
  // atenúa. Clave por orden completa (todos sus colores): "wo:<id>" para POs,
  // "pre:<id>" para reservas PRE. Se puede apagar desde la barra.
  const [hlOn, setHlOn] = useState(() => {
    try { return localStorage.getItem("planboard.hoverHighlight") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("planboard.hoverHighlight", hlOn ? "1" : "0"); } catch { /* ignore */ }
  }, [hlOn]);
  const [hl, setHl] = useState(null); // { key, label }
  const hlTimer = useRef(null);
  const orderKeyOf = (a) =>
    a?.is_hold ? `pre:${a.pre_order_id}` : a?.work_order_id != null ? `wo:${a.work_order_id}` : null;
  const hoverOrder = (key, label) => {
    if (!hlOn || !key) return;
    clearTimeout(hlTimer.current);
    setHl((cur) => (cur?.key === key ? cur : { key, label }));
  };
  // Pequeña espera al salir: al pasar de un bloque al vecino no parpadea.
  const leaveOrder = () => {
    clearTimeout(hlTimer.current);
    hlTimer.current = setTimeout(() => setHl(null), 120);
  };
  useEffect(() => () => clearTimeout(hlTimer.current), []);
  useEffect(() => { if (!hlOn) setHl(null); }, [hlOn]);

  // Drag & drop
  const [draggedPO, setDraggedPO] = useState(null); // transient: during a native drag only
  const [armedPO, setArmedPO] = useState(null);     // persistent: picked up via tap/click
  const [draggedAssignment, setDraggedAssignment] = useState(null); // moving an existing cell
  const [dropTarget, setDropTarget] = useState(null);
  const [dropBusy, setDropBusy] = useState(false);

  // Line-row reordering by drag & drop. Drag a line's label onto another line's
  // label to drop it into that position. Purely visual — never touches data.
  const [draggedLine, setDraggedLine] = useState(null);       // line_no being dragged (string)
  const [lineDropTarget, setLineDropTarget] = useState(null); // line_no hovered as drop position (string)

  // Multi-cell selection: tap "Seleccionar", tap blocks (across any line) to
  // check them, then "Mover" and tap a destination cell. The whole selection is
  // piled into the target line and re-packed forward day by day.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pickingDest, setPickingDest] = useState(false); // choosing the target cell
  // When picking a destination, insertMode decides what the tap does:
  //   false → pile the selection into the target and re-pack forward (move-batch)
  //   true  → INSERT the selection at the target and ripple the line's tail
  //           forward (insert-shift-batch) — the multi-order "insert in the middle".
  const [insertMode, setInsertMode] = useState(false);
  // Snapshot returned by the last insert (single drag OR multi-select). While set,
  // an "Deshacer" chip offers to reverse that whole ripple in one shot.
  const [lastInsertUndo, setLastInsertUndo] = useState(null);
  const [toast, setToast] = useState(null);
  // Panel "Órdenes del merchant": visible by default; the planner can hide it to
  // give the plan board the full width. The choice is remembered per browser.
  const [showPool, setShowPool] = useState(() => {
    try { return localStorage.getItem("planboard.showPool") !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("planboard.showPool", showPool ? "1" : "0"); } catch { /* ignore */ }
  }, [showPool]);
  const [showSizes, setShowSizes] = useState(false); // compact pool by default; reveal size chips on demand
  // One search box for WO / estilo / PO cliente. It filters the merchant pool
  // AND dims the grid cells so only the searched order's blocks stand out.
  const [search, setSearch] = useState("");
  // Filtros del tablero (botón «Filtros» junto a «Estándares» en modo consulta).
  const [boardFilters, setBoardFilters] = useState(BOARD_FILTERS_EMPTY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setBoardFilter = (k) => (v) => setBoardFilters((f) => ({ ...f, [k]: v }));

  // The merchant's weekly plan drives which orders reach the pool and their
  // target week. `merchantOk` is false only if that fetch fails → we then fall
  // back to the previous behavior (show every open order) so the board still works.
  const [merchantPlan, setMerchantPlan] = useState([]);
  const [merchantOk, setMerchantOk] = useState(true);
  // Global equivalencia factor from the merchant board (eq/pza = SAM ÷ equivalencia).
  // Lets the plan board convert the real assigned pieces into the same "piezas
  // equivalentes" the merchant plans in. Defaults to 10 until the plan loads.
  const [equivalence, setEquivalence] = useState(10);

  // ---- envío al supermercado --------------------------------------------
  // El planner elige una o varias semanas (cualquiera, no sólo la actual, y con
  // o sin pre-órdenes) y las envía. Al enviar se congela un snapshot: el
  // supermercado surte contra lo que se comprometió, no contra un tablero que
  // sigue moviéndose.
  const [sendOpen, setSendOpen] = useState(false);
  const [sendWeeks, setSendWeeks] = useState(() => new Set()); // lunes YYYY-MM-DD
  const [sendNote, setSendNote] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [publications, setPublications] = useState([]); // semanas ya publicadas

  // ---- candados de semana (CEO) ------------------------------------------
  // { "YYYY-MM-DD" (lunes): { locked_by_name, locked_at, note } }. El servidor
  // es la autoridad (trigger en line_assignments); esto sólo avisa antes y
  // pinta el tablero.
  const [weekLocks, setWeekLocks] = useState({});
  const [canLockServer, setCanLockServer] = useState(false); // el rol del usuario puede bloquear
  // 🔒 Candado de TODO el tablero (lo pone el planeador al terminar el plan).
  // Mientras está puesto no se asigna, mueve, inserta ni elimina nada.
  const [boardLock, setBoardLock] = useState({ locked: false, lockedBy: null, lockedAt: null, canLock: false });
  const [boardLockBusy, setBoardLockBusy] = useState(false);
  const [lockBusyWeek, setLockBusyWeek] = useState(null);

  // User-chosen display order for the line rows (array of line_no as strings),
  // persisted per browser. Purely visual — it never touches assignments or runs.
  // Any line not listed here falls back to numeric order after the listed ones.
  const [lineOrder, setLineOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("planboard_line_order") || "[]"); } catch { return []; }
  });

  // User-chosen block colors (per work-order+color key), persisted per browser.
  const [colorOverrides, setColorOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("planboard_color_overrides") || "{}"); } catch { return {}; }
  });
  // Rank-based color per tipo+modelo+correlativo (style_code): every distinct
  // style_code gets its own palette slot (assigned by sorted position), so codes
  // are visually distinguishable instead of hash-colliding. Built from the whole
  // order catalog plus whatever styles the assignments carry, so it stays stable
  // regardless of what's currently on the board. Colors only repeat once the
  // number of distinct style_codes exceeds WO_PALETTE.length.
  const styleColorMap = useMemo(
    () =>
      buildStyleColorMap([
        ...workOrders.map((w) => w.style_code),
        ...assignments.map((a) => a.style_code),
      ]),
    [workOrders, assignments]
  );
  const blockColor = (key) => {
    // 1) explicit per-group override chosen from the swatch picker wins.
    const ov = colorOverrides[key];
    if (ov != null && WO_PALETTE[ov]) return WO_PALETTE[ov];
    // 2) style groups ("style:DAMTSH01") get their distinct rank-based color.
    if (typeof key === "string" && key.startsWith("style:")) {
      const idx = styleColorMap.get(key.slice(6));
      if (idx != null && WO_PALETTE[idx]) return WO_PALETTE[idx];
    }
    // 3) legacy keys with no style_code fall back to the stable hash color.
    return colorForWO(key);
  };
  const setBlockColor = (key, idx) => {
    setColorOverrides((prev) => {
      const next = { ...prev };
      if (idx == null) delete next[key];
      else next[key] = idx;
      try { localStorage.setItem("planboard_color_overrides", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [aggModal, setAggModal] = useState(null); // { lineNo, label, orders, total }
  // Add-line modal: lets the planner create a line engineering hasn't
  // configured yet so orders can be assigned to it right away.
  const [addLine, setAddLine] = useState(null); // { lineNo, operators, hours, effPct, sam } | null
  const [savingLine, setSavingLine] = useState(false);

  // Saldos por dia: lo que se asigno en cada celda contra lo que la linea
  // realmente cosio ESE dia. Sin esto una celda que cerro a la mitad se ve
  // igual que una que salio completa.
  const balances = useDayBalances();
  // Campana de saldos (sobre "+ Línea"): lista de días que cerraron cortos.
  // Reemplaza el panel "Saldos por reasignar": la celda ya se marca en la
  // cuadrícula y el planeador la arrastra a un día nuevo desde ahí.
  const [balOpen, setBalOpen] = useState(false);
  const [flashCell, setFlashCell] = useState(null); // "line|yyyy-MM-dd" resaltada tras "Ir"

  // Totales por columna del encabezado (asignado vs producido).
  // El "producido por dia" se pide por rango a day-balances (misma fuente que
  // los saldos por celda) y se agrupa por dia. En Semana/Mes/Año se suman los
  // dias del periodo. Si la deteccion de piso no resolvio, producedResolved es
  // false y NO se muestra el renglon verde, para no enseñar ceros engañosos.
  const [producedByDay, setProducedByDay] = useState(() => new Map());
  const [producedResolved, setProducedResolved] = useState(false);

  useEffect(() => {
    // Rango visible segun la vista, calculado desde primitivos (viewMode,
    // currentDate) para no re-disparar el fetch en cada render.
    let from, to;
    if (viewMode === "day") {
      from = format(currentDate, "yyyy-MM-dd");
      to = format(addDays(currentDate, 182), "yyyy-MM-dd");
    } else if (viewMode === "week") {
      const first = startOfWeek(currentDate, { weekStartsOn: 1 });
      from = format(first, "yyyy-MM-dd");
      to = format(addDays(first, 26 * 7 - 1), "yyyy-MM-dd");
    } else if (viewMode === "month") {
      const s = startOfYear(currentDate);
      from = format(s, "yyyy-MM-dd");
      to = format(endOfMonth(addMonths(s, 11)), "yyyy-MM-dd");
    } else {
      const y0 = currentDate.getFullYear();
      from = `${y0}-01-01`;
      to = `${y0 + 5}-12-31`;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/line-assignments/day-balances?from=${from}&to=${to}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        if (cancelled) return;
        if (!data.success || data.resolved === false) {
          setProducedByDay(new Map());
          setProducedResolved(false);
          return;
        }
        const m = new Map();
        for (const r of data.rows || []) {
          const k = (r.assigned_date || "").slice(0, 10);
          if (!k) continue;
          m.set(k, (m.get(k) || 0) + (Number(r.produced) || 0));
        }
        setProducedByDay(m);
        setProducedResolved(true);
      } catch {
        if (!cancelled) { setProducedByDay(new Map()); setProducedResolved(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [viewMode, currentDate, assignments]);

  // The PO currently ready to place (drag takes priority over tap).
  const activePO = draggedPO || armedPO;
  // El resaltado se apaga mientras se arrastra algo, para no estorbar al soltar.
  const hlActive = hlOn && !!hl && !draggedAssignment && !draggedPO && !draggedLine;

  // Pre-órdenes que ya salieron (total o parcialmente) como PO real.
  const conversions = useMemo(() => {
    const out = [];
    for (const p of preOrdersAll || []) {
      if (!p || p.id == null) continue;
      const st = String(p.status || "").toLowerCase();
      if (st !== "converted" && st !== "partially_converted") continue;
      const woNos = String(p.work_order_nos || "").split(",").map((x) => x.trim()).filter(Boolean);
      const converted = Number(p.converted_pieces) || 0;
      out.push({
        id: String(p.id),
        no: p.pre_order_no || `PRE${p.id}`,
        partial: st === "partially_converted",
        sig: `${st}|${converted}|${woNos.join(",")}`,
        woNos,
        woIds: (p.work_order_ids || []).map(Number).filter((n) => !isNaN(n)),
        converted,
        pieces: Number(p.pieces) || 0,
        when: p.converted_at || p.updated_at || null,
        customer: p.customer_name || "",
        style: p.estilo || p.style_code || "",
      });
    }
    return out.sort((a, b) => String(b.when || "").localeCompare(String(a.when || "")));
  }, [preOrdersAll]);
  const unseenConv = useMemo(
    () => (convSeen ? conversions.filter((c) => convSeen[c.id] !== c.sig) : []),
    [conversions, convSeen]
  );
  // PO nueva → de qué pre-orden salió (para el sello en la bolsa).
  const convByWoId = useMemo(() => {
    const m = new Map();
    for (const c of conversions) for (const id of c.woIds) m.set(id, c);
    return m;
  }, [conversions]);
  const saveConvSeen = (next) => {
    setConvSeen(next);
    try { localStorage.setItem("planboard.preConvSeen", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const markConvSeen = (list) => {
    const next = { ...(convSeen || {}) };
    for (const c of list) next[c.id] = c.sig;
    saveConvSeen(next);
  };
  // Primera vez en este navegador: no inundar con todo el historial. Lo
  // convertido en los últimos 7 días queda como "nuevo"; lo demás, visto.
  useEffect(() => {
    if (convSeen || !preOrdersLoaded || dataOverride) return;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const base = {};
    for (const c of conversions) {
      const t = c.when ? new Date(c.when).getTime() : 0;
      if (!(t >= cutoff)) base[c.id] = c.sig;
    }
    saveConvSeen(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preOrdersLoaded, conversions, convSeen]);
  // Toast cuando aparece una conversión NUEVA mientras el tablero está abierto.
  const convNotifiedRef = useRef(null); // Set de "id|firma" ya avisados en esta sesión
  useEffect(() => {
    if (!convSeen || dataOverride) return;
    if (convNotifiedRef.current == null) {
      // Al abrir: lo pendiente ya se ve en la campana, sin toast.
      convNotifiedRef.current = new Set(unseenConv.map((c) => `${c.id}|${c.sig}`));
      return;
    }
    const fresh = unseenConv.filter((c) => !convNotifiedRef.current.has(`${c.id}|${c.sig}`));
    fresh.forEach((c) => convNotifiedRef.current.add(`${c.id}|${c.sig}`));
    if (fresh.length === 1) {
      const c = fresh[0];
      showToast(`🔔 ${c.no} ${c.partial ? "se convirtió parcialmente" : "se convirtió"} en ${c.woNos.join(", ") || "PO"}. Ya puede asignarla en el tablero.`);
    } else if (fresh.length > 1) {
      showToast(`🔔 ${fresh.length} pre-órdenes se convirtieron en PO. Revise la campana «Convertidas».`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenConv, convSeen]);
  // "Ver": lleva a Diario y busca la PO nueva (resalta sus celdas y la filtra
  // en la bolsa si todavía no está asignada).
  const goToConversion = (c) => {
    markConvSeen([c]);
    setConvOpen(false);
    setViewMode("day");
    if (c.woNos[0]) setSearch(c.woNos[0]);
  };
  const loadChangeNotices = async () => {
    const r = await getJSON("/api/plan-change-notices?status=open", { retries: 0 });
    if (!r.ok || !r.data?.success) return; // servidor sin el módulo: sin avisos
    const list = r.data.notices || [];
    if (changeSeenRef.current) {
      const fresh = list.filter((x) => !changeSeenRef.current.has(x.id));
      if (fresh.length > 0) {
        const freshPending = fresh.filter((x) => x.status === "pending" || x.status === "partial").length;
        setChangeBanner({
          count: fresh.length,
          pending: freshPending,
          text: fresh.length === 1
            ? `${fresh[0].changed_by_name ? fresh[0].changed_by_name + " cambió " : "Cambió "}${fresh[0].summary || fresh[0].work_order_no}`
            : freshPending > 0
            ? `${fresh.length} órdenes asignadas cambiaron (color / cantidad). ${freshPending} quedan pendientes de aplicar por bloqueo.`
            : `${fresh.length} órdenes asignadas cambiaron (color / cantidad). El tablero ya se actualizó.`,
        });
        // Las celdas ya cambiaron en el servidor: recargar para verlo.
        if (!fetchInFlightRef.current) fetchData({ silent: true });
      }
    }
    changeSeenRef.current = new Set(list.map((x) => x.id));
    setChangeNotices(list);
  };
  const isUnapplied = (n) => n.status === "pending" || n.status === "partial";
  const markChangeSeen = async (ids) => {
    const all = ids === "all";
    // Los pendientes de aplicar se quedan en la lista hasta que se apliquen.
    setChangeNotices((prev) => prev.filter((x) => isUnapplied(x) || (!all && !ids.includes(x.id))));
    try {
      if (all) {
        await fetch(`${API_URL}/api/plan-change-notices/seen-all`, { method: "POST", headers: authHeaders() });
      } else {
        await Promise.all(ids.map((id) =>
          fetch(`${API_URL}/api/plan-change-notices/${id}/seen`, { method: "POST", headers: authHeaders() })));
      }
    } catch { /* se reintenta en la siguiente lectura */ }
  };
  const [applyingId, setApplyingId] = useState(null);
  const applyChange = async (n) => {
    if (applyingId) return;
    setApplyingId(n.id);
    try {
      const res = await fetch(`${API_URL}/api/plan-change-notices/${n.id}/apply`, { method: "POST", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.error || `No se pudo aplicar (${res.status}).`, true);
      } else {
        showToast(`${n.work_order_no}: ${data.message || "aplicado"}`, data.status === "pending");
        await fetchData({ silent: true });
      }
    } catch (e) {
      showToast(`No se pudo aplicar: ${e.message}`, true);
    } finally {
      setApplyingId(null);
      loadChangeNotices();
    }
  };
  // Al desbloquear el tablero, recordar los cambios que quedaron pendientes.
  const prevBoardLockedRef = useRef(boardLock.locked);
  useEffect(() => {
    const was = prevBoardLockedRef.current;
    prevBoardLockedRef.current = boardLock.locked;
    if (!was || boardLock.locked || dataOverride || readOnly) return;
    const pend = changeNotices.filter((x) => x.status === "pending").length;
    if (pend > 0) {
      setChangeBanner({
        count: pend,
        pending: pend,
        text: `Tablero desbloqueado: ${pend} cambio${pend === 1 ? "" : "s"} del merchant pendiente${pend === 1 ? "" : "s"} de aplicar. Ábralos y toque «Aplicar ahora».`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardLock.locked]);
  const goToChange = (n) => {
    setChangeOpen(false);
    setChangeBanner(null);
    setViewMode("day");
    if (n.work_order_no) setSearch(n.work_order_no);
  };
  useEffect(() => {
    if (dataOverride || readOnly) return undefined;
    loadChangeNotices();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") loadChangeNotices(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") loadChangeNotices(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fmtPz = (v) => Math.round(Number(v) || 0).toLocaleString();
  const describeChange = (ch) => {
    switch (ch.kind) {
      case "color_renamed": return { tone: "violet", text: `Color ${ch.from} → ${ch.to}${ch.cells ? ` (${ch.cells} celda${ch.cells === 1 ? "" : "s"} actualizada${ch.cells === 1 ? "" : "s"})` : ""}` };
      case "color_added":   return { tone: "emerald", text: `Color nuevo ${ch.color}: ${fmtPz(ch.to)} pzas (por asignar)` };
      case "color_removed": return { tone: "rose", text: `Color ${ch.color} eliminado (${fmtPz(ch.from)} pzas)` };
      case "qty_changed": {
        const d = (Number(ch.to) || 0) - (Number(ch.from) || 0);
        return { tone: d < 0 ? "rose" : "emerald", text: `${ch.color || "Orden"}: ${fmtPz(ch.from)} → ${fmtPz(ch.to)} pzas (${d > 0 ? "+" : ""}${fmtPz(d)})` };
      }
      case "sizes_changed": return { tone: "gray", text: `${ch.color} tallas: ${(ch.sizes || []).map((x) => `${x.talla || "?"} ${fmtPz(x.from)}→${fmtPz(x.to)}`).join(", ")}` };
      case "field_changed": {
        const v = (x) => (x === "" || x == null ? "—" : String(x));
        return { tone: "gray", text: `${ch.label}: ${v(ch.from)} → ${v(ch.to)}` };
      }
      default: return null;
    }
  };

  const loadCutRequests = async () => {
    const r = await getJSON("/api/cut-order-requests?scope=open", { retries: 0 });
    if (!r.ok || !r.data?.success) return; // sin el módulo en el servidor: sin avisos
    const pend = (r.data.requests || []).filter((x) => x.status === "pending");
    if (cutReqSeenRef.current) {
      const fresh = pend.filter((x) => !cutReqSeenRef.current.has(x.id));
      if (fresh.length === 1) {
        const x = fresh[0];
        showToast(`✂️ Corte solicita ${x.work_order_no}${x.color ? ` · ${x.color}` : ""}${x.requested_by_name ? ` (${x.requested_by_name})` : ""}. Asígnela en «Órdenes de corte».`);
      } else if (fresh.length > 1) {
        showToast(`✂️ ${fresh.length} solicitudes nuevas de corte. Revise «Corte pide».`);
      }
    }
    cutReqSeenRef.current = new Set(pend.map((x) => x.id));
    setCutReqs(pend);
  };
  useEffect(() => {
    if (dataOverride || readOnly) return undefined;
    loadCutRequests();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") loadCutRequests(); }, 60000);
    const onVis = () => { if (document.visibilityState === "visible") loadCutRequests(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revisa las pre-órdenes cada 60 s mientras la pestaña está visible, para
  // avisar aunque el planeador no cambie de pestaña. Con la pestaña oculta no
  // consulta (deja que la base de datos se pause).
  useEffect(() => {
    if (dataOverride || readOnly) return undefined;
    const timer = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const r = await getJSON("/api/pre-orders?status=all", { retries: 0 });
      if (!r.ok || !r.data) return;
      const pr = r.data;
      const rows = pr.preOrders || pr.pre_orders || pr.rows || (Array.isArray(pr) ? pr : []);
      setPreOrdersAll(rows || []);
      setPreOrdersLoaded(true);
    }, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchData(); }, []);


  // Al volver a la pestaña, re-sincroniza en silencio. Es como se entera de que
  // una pre-orden ya se convirtió (o de que el merchant movió una semana) sin
  // recargar a mano. Nunca durante un arrastre o una selección, para no mover
  // el piso bajo los pies.
  useEffect(() => {
    const onFocus = () => {
      if (draggedPO || armedPO || draggedAssignment || dropBusy || selectMode) return;
      if (fetchInFlightRef.current) return; // ya hay una carga corriendo
      fetchData({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedPO, armedPO, draggedAssignment, dropBusy, selectMode]);

  // Esc cancels a picked-up (armed) PO — or, in select mode, the destination
  // pick first, then the whole selection.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setArmedPO(null); setDraggedPO(null); setDraggedAssignment(null); setDropTarget(null);
      setDraggedLine(null); setLineDropTarget(null);
      setPickingDest((wasPicking) => {
        if (wasPicking) { setInsertMode(false); return false; } // first Esc: just leave dest mode
        setSelectMode(false); setSelectedIds(new Set()); // second Esc: leave select mode
        return false;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Individual cells only exist in Diario; leaving that view drops selection.
  useEffect(() => {
    if (viewMode !== "day") { setSelectMode(false); setPickingDest(false); setInsertMode(false); setSelectedIds(new Set()); }
  }, [viewMode]);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = async ({ silent = false } = {}) => {
    // Only the initial mount shows the full-page "Cargando Plan Board..."
    // gate. Post-mutation refetches pass { silent: true } so the board stays
    // rendered and updates in place instead of flashing the loader.
    // Modo snapshot (supermercado): los datos ya vienen resueltos, no hay nada
    // que pedir. Se pinta tal cual para que el tablero sea idéntico al que el
    // planner envió, aunque el tablero vivo ya haya cambiado.
    if (dataOverride) {
      setAssignments(dataOverride.assignments || []);
      setHolds(dataOverride.holds || []);
      setHolidays(dataOverride.holidays || []);
      setWorkOrders(dataOverride.workOrders || []);
      setLineRuns(dataOverride.lineRuns || []);
      setPlannerLines(dataOverride.plannerLines || []);
      setStyleParams(dataOverride.styleParams || {});
      setLineParams(dataOverride.lineParams || {});
      setMerchantPlan(dataOverride.merchantPlan || []);
      setMerchantOk(true);
      if (Number(dataOverride.equivalence) > 0) setEquivalence(Number(dataOverride.equivalence));
      setLoading(false);
      return;
    }

    const seq = ++fetchSeqRef.current;
    const isCurrent = () => seq === fetchSeqRef.current;
    fetchInFlightRef.current = true;
    if (!silent) setLoading(true);

    // Cada recurso se pide en paralelo con reintentos. Si uno falla tras los
    // reintentos se CONSERVA lo que ya habia en pantalla: nunca se vacia el
    // tablero (ni se queda vacio en la primera carga sin avisar) por un
    // 502 / timeout / cold start pasajero.
    const failed = [];
    const load = (path, apply, { critical = false, label = path, onFail = null } = {}) =>
      getJSON(path).then((r) => {
        if (!isCurrent()) return;
        if (!r.ok && onFail) { try { onFail(); } catch { /* ignore */ } }
        if (r.ok) {
          try { apply(r.data); }
          catch (e) { console.error(label, e); if (critical) failed.push(label); }
        }
        else {
          console.error(`Plan Board: fallo ${label}`, r.status, r.error?.message);
          if (critical) failed.push(label);
        }
      });

    // Todo en paralelo. La grilla usa tambien work-orders (entregas, SAM, eq) y
    // el plan del merchant (equivalencia), asi que el "Cargando..." se quita
    // cuando TODO llego: nunca se pinta un tablero a medias.
    const all = Promise.all([
      // Candados (semanas del CEO + tablero) dentro de la MISMA carga: el
      // tablero no se muestra "abierto" y luego se bloquea unos segundos después.
      loadWeekLocksRef.current ? loadWeekLocksRef.current({ retries: 2 }) : Promise.resolve(),
      load("/api/line-assignments", (a) => { if (a.success) setAssignments(a.assignments || []); else throw new Error(a.error); },
        { critical: true, label: "asignaciones" }),
      load("/api/pre-order-holds", (h) => { if (h.success) setHolds(h.holds || []); }, { critical: true, label: "reservas PRE" }),
      load("/api/line-runs", (lr) => { if (lr.success) setLineRuns(lr.runs || []); }, { critical: true, label: "corridas" }),
      load("/api/planning/lines", (pl) => { if (pl?.success) setPlannerLines(pl.lines || []); }),
      load("/api/holidays", (hol) => { if (hol?.success) setHolidays(hol.holidays || []); }),
      load("/api/planner/style-params", (sp) => {
        if (!sp?.success) return;
        const m = {};
        (sp.params || []).forEach((r) => { m[normStyle(r.style_code)] = r; });
        setStyleParams(m);
        const lm = {};
        (sp.lineParams || []).forEach((r) => { lm[lineKey(r.style_code, r.line_no)] = r; });
        setLineParams(lm);
        setCanEditStyles(!!sp.canEdit);
        const pe = {};
        (sp.pendingEff || []).forEach((r) => { pe[effKey(r.style_code, r.line_no)] = r; });
        setPendingEff(pe);
      }),
      load("/api/work-orders", (wo) => { if (wo.success) setWorkOrders(wo.workOrders || []); }, { critical: true, label: "órdenes" }),
      load("/api/merchant-plan", (mp) => {
        if (mp?.success) {
          setMerchantPlan(mp.plan || []); setMerchantOk(true);
          if (Number(mp.equivalence) > 0) setEquivalence(Number(mp.equivalence));
        } else { setMerchantPlan([]); setMerchantOk(false); }
      }, { onFail: () => { setMerchantPlan([]); setMerchantOk(false); } }),
      load("/api/pre-orders?status=all", (pr) => {
        const rows = pr.preOrders || pr.pre_orders || pr.rows || (Array.isArray(pr) ? pr : []);
        const t = {};
        (rows || []).forEach((r) => { if (r && r.id != null && r.target_date) t[r.id] = String(r.target_date).slice(0, 10); });
        setPreOrderTargets(t);
        setPreOrdersAll(rows || []);
        setPreOrdersLoaded(true);
      }),
    ]);

    try {
      await all;
      if (isCurrent() && failed.length) {
        showToast(`No se pudo cargar: ${failed.join(", ")}. Se muestra lo último conocido; reintente con "Hoy" o recargue.`, true);
      }
    } catch (err) {
      console.error("Error fetching plan board data:", err);
    } finally {
      if (isCurrent()) { setLoading(false); fetchInFlightRef.current = false; }
    }
  };

  // Lines present on the board = any line that has an assignment or a run.
  // Order them by the user's saved display order first (persisted, visual only),
  // then append any remaining lines in numeric order so new lines still appear.
  const lines = (() => {
    const present = [
      ...new Set([
        ...assignments.map((a) => a.line_no),
        ...lineRuns.map((lr) => lr.line_no),
        ...plannerLines.map((pl) => pl.line_no),
      ]),
    ];
    const numeric = (arr) => [...arr].sort((a, b) => Number(a) - Number(b));
    const rank = new Map(lineOrder.map((ln, i) => [String(ln), i]));
    const listed = present
      .filter((ln) => rank.has(String(ln)))
      .sort((a, b) => rank.get(String(a)) - rank.get(String(b)));
    const rest = numeric(present.filter((ln) => !rank.has(String(ln))));
    return [...listed, ...rest];
  })();

  // Lines the planner defined but engineering hasn't configured yet. A line
  // stops being 'planner-only' the moment a real line_run exists for it (the
  // server also removes the planner_lines row at that point).
  const plannerLineMap = useMemo(() => {
    const m = {};
    plannerLines.forEach((pl) => { m[String(pl.line_no)] = pl; });
    return m;
  }, [plannerLines]);
  const hasEngineerRun = (lineNo) =>
    lineRuns.some((r) => String(r.line_no) === String(lineNo));
  const isPlannerOnly = (lineNo) =>
    !!plannerLineMap[String(lineNo)] && !hasEngineerRun(lineNo);

  // Drop `dragLineNo` into the position currently held by `targetLineNo`,
  // persisting the whole resulting order. Visual only — no assignment or run
  // data is touched.
  const reorderLineTo = (dragLineNo, targetLineNo) => {
    if (dragLineNo == null || targetLineNo == null) return;
    const cur = lines.map(String);
    const from = cur.indexOf(String(dragLineNo));
    const to = cur.indexOf(String(targetLineNo));
    if (from < 0 || to < 0 || from === to) return;
    const next = [...cur];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setLineOrder(next);
    try { localStorage.setItem("planboard_line_order", JSON.stringify(next)); } catch {}
  };

  // Drag handlers for the line label (used as both drag handle and drop zone).
  const onLineDragStart = (e, lineNo) => {
    if (readOnly) return;   // reordenar filas es una preferencia del planner
    setDraggedLine(String(lineNo));
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", `line:${lineNo}`); } catch {}
  };
  const onLineDragOver = (e, lineNo) => {
    if (draggedLine == null) return;           // only react while a line is being dragged
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch {}
    if (String(lineNo) !== lineDropTarget) setLineDropTarget(String(lineNo));
  };
  const onLineDrop = (e, lineNo) => {
    if (draggedLine == null) return;
    e.preventDefault();
    reorderLineTo(draggedLine, lineNo);
    setDraggedLine(null);
    setLineDropTarget(null);
  };
  const onLineDragEnd = () => { setDraggedLine(null); setLineDropTarget(null); };

  // Reset to plain numeric order (clears the saved custom order).
  const resetLineOrder = () => {
    setLineOrder([]);
    try { localStorage.removeItem("planboard_line_order"); } catch {}
  };

  // Pieces per work order sitting in future board cells (not sewn yet).
  const openPlannedByWo = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    const m = new Map();
    assignments.forEach((a) => {
      if (a.status !== "planned") return;
      if (dayOf(a.assigned_date || a.planned_start_date) < today) return;
      m.set(a.work_order_id, (m.get(a.work_order_id) || 0) + (parseFloat(a.assigned_quantity) || 0));
    });
    return m;
  }, [assignments]);
  const remainingOfWo = (wo) => remainingOf(wo, openPlannedByWo.get(wo?.id) || 0);

  const unassignedPOs = workOrders
    .filter((wo) => remainingOfWo(wo) > 0 && !["completed", "cancelled"].includes(wo.status))
    .sort((a, b) => {
      const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
      const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
      return da - db;
    });

  // Color key so each work-order + color gets its own color and is tracked apart.
  const keyOf = (woId, color) => `${woId}:${color || ""}`;

  // Pieces already assigned for a given work order + color (active only).
  const assignedForColor = (woId, color) =>
    assignments
      .filter(
        (a) =>
          a.work_order_id === woId &&
          String(a.color || "") === String(color || "") &&
          !["cancelled", "rejected"].includes(a.status)
      )
      .reduce((s, a) => s + (parseFloat(a.assigned_quantity) || 0), 0);

  // ---- merchant weekly plan → pool source -------------------------------
  // The merchant board decides WHICH orders get planned and into WHICH week.
  // Index those rows so the pool can (a) show only planned orders and (b) tag
  // each with its target week. Colors are stored upper-cased on the merchant
  // side, so normalize the key when matching.
  const planKey = (woId, color) => `${woId}:${String(color || "").trim().toUpperCase()}`;
  const merchantByKey = useMemo(() => {
    const m = new Map();
    for (const r of merchantPlan) {
      if (r.pre_order_id != null) continue;   // las PRE#### se manejan aparte
      m.set(planKey(r.work_order_id, r.color), r);
      // Also index by work_order_no in case an order was planned before it had a numeric id.
      if (r.work_order_no) m.set(planKey(r.work_order_no, r.color), r);
    }
    return m;
  }, [merchantPlan]);
  // Which planned rows the merchant flagged as PRE-ORDER. Keyed the same way as
  // merchantByKey (by id and by work_order_no) so a block/pool card can be
  // recognized regardless of which identifier the assignment carries.
  const preOrderKeys = useMemo(() => {
    const s = new Set();
    for (const r of merchantPlan) {
      if (r.pre_order_id != null) continue;   // esas son PRE####, no POs marcadas
      if (!r.is_pre_order) continue;
      s.add(planKey(r.work_order_id, r.color));
      if (r.work_order_no) s.add(planKey(r.work_order_no, r.color));
    }
    return s;
  }, [merchantPlan]);
  const isPreOrder = (woId, color) => preOrderKeys.has(planKey(woId, color));

  // ---- pre-órdenes del merchant (PRE####) --------------------------------
  // Filas del plan con pre_order_id: pedidos que el merchant ya comprometió
  // pero que TODAVÍA NO SON PO. No tienen tallas, colores ni SAM, así que no se
  // pueden asignar a una línea — entran a la bolsa como carga a la vista, para
  // que el planner sepa qué se le viene en esa semana. Cuando el merchant las
  // convierte, el backend cambia esa fila por las de las POs reales y la
  // tarjeta se vuelve una orden normal, arrastrable, en la misma semana.
  // Piezas ya reservadas en el tablero por pre-orden (holds). Se restan de la
  // carga pendiente para que una pre-orden colocada se comporte como una PO:
  // encoge conforme se reserva y sale de la bolsa cuando ya está completa.
  const heldByPreOrder = useMemo(() => {
    const m = new Map();
    for (const h of holds || []) {
      if (h.pre_order_id == null) continue;
      m.set(h.pre_order_id, (m.get(h.pre_order_id) || 0) + (Number(h.quantity) || 0));
    }
    return m;
  }, [holds]);

  const preOrderJobs = useMemo(() => (merchantPlan || [])
    .filter((r) => r.pre_order_id != null)
    .map((r) => {
      const planned = Number(r.cantidad) || 0;
      const held = heldByPreOrder.get(r.pre_order_id) || 0; // ya apartado en el tablero
      return {
      key: `pre:${r.pre_order_id}`,
      preOrderId: r.pre_order_id,
      isPreOrderRow: true,
      isPreOrder: true,
      workOrderId: null,
      work_order_no: r.work_order_no || `PRE${r.pre_order_id}`,
      customer_po: r.customer_po || "",
      customer_name: r.customer_name || "—",
      style_code: r.style_code || "",
      estilo: r.estilo || "",
      color: r.color || null,
      remaining: Math.max(planned - held, 0), // sólo lo que aún falta reservar
      sizes: Array.isArray(r.sizes) ? r.sizes : [],
      breakdown: [],
      sam_minutes: Number(r.sam_minutes) || 0,
      commitment_date: null,
      // Fecha de entrega de la pre-orden: la del plan del merchant si la trae,
      // si no la target_date capturada en la pre-orden.
      delivery_date: String(r.target_date || r.delivery_date || preOrderTargets[r.pre_order_id] || "").slice(0, 10) || null,
      week: r.week_start || null,
      };
    })
    // Una pre-orden totalmente reservada en el tablero sale de la bolsa, igual
    // que una PO desaparece al asignarse por completo. El umbral en 1 evita
    // dejar tarjetas fantasma de "0 pzas" por remanentes de redondeo.
    .filter((j) => j.remaining >= 1), [merchantPlan, heldByPreOrder, preOrderTargets]);
  // Gate the pool by the plan only when it actually loaded; otherwise fall back.
  const gateByMerchant = merchantOk;

  // ---- search: WO # / estilo / PO cliente -------------------------------
  // One box drives both the merchant pool and the grid. A query is split into
  // terms and EVERY term must appear somewhere in the order (AND), so
  // "1234 rojo" or "polo po-abc" narrow across fields. Matching is order-level
  // (by work_order_id) so the pool cards and the grid cells stay in sync.
  const norm = (s) => String(s ?? "").toLowerCase().trim();
  const searchTerms = useMemo(
    () => norm(search).split(/\s+/).filter(Boolean),
    [search]
  );

  // ---- filtros del tablero: tipo / cliente / temporada / línea / estado / entrega
  // Por orden se precalcula lo que cada filtro necesita, con la MISMA lógica
  // que «Estado de órdenes» en Analíticas, para que ambos cuenten igual:
  //   estado  = completada (status completed o producido ≥ meta) / en proceso
  //             (algo producido) / pendiente.
  //   entrega = fecha del merchant vs. último día asignado en el tablero.
  // Las pre-órdenes PRE#### (no son POs) llevan su propia ficha: cliente, líneas
  // y fecha objetivo salen del plan del merchant y de sus reservas (holds).
  // Todavía no producen, así que su estado siempre es «pendiente».
  const { woFilterInfo, preFilterInfo, filterOptions } = useMemo(() => {
    const deliveryOf = (due, finish) =>
      !due ? "nofecha" : !finish ? "sinplan" : finish > due ? "late" : "ontime";
    const allLines = new Set();
    const customers = new Set(), seasons = new Set();

    // -- órdenes reales --------------------------------------------------------
    const info = new Map(); // String(wo.id) -> { customer, season, lines, proc, deliv }
    const lastDay = new Map();
    const linesOf = new Map();
    const addLine = (map, id, ln) => {
      if (id == null || ln == null || ln === "") return;
      const k = String(id), l = String(ln);
      allLines.add(l);
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(l);
    };
    const bumpLast = (map, id, v) => {
      const d = dayOfValue(v), k = String(id);
      if (d && (!map.has(k) || d > map.get(k))) map.set(k, d);
    };
    for (const a of assignments) {
      if (FILTER_DEAD.has(String(a.status || "").toLowerCase())) continue;
      addLine(linesOf, a.work_order_id, a.line_no);
      bumpLast(lastDay, a.work_order_id, a.assigned_date);
    }
    for (const wo of workOrders) {
      const st = String(wo.status || "").toLowerCase();
      if (FILTER_DEAD.has(st)) continue;
      const k = String(wo.id);
      addLine(linesOf, wo.id, wo.line_no);
      const customer = String(wo.customer_name || "").trim();
      const season = String(wo.season || "").trim();
      if (customer) customers.add(customer);
      if (season) seasons.add(season);
      const target = targetOf(wo), produced = producedOf(wo);
      const proc = st === "completed" || (target > 0 && produced >= target)
        ? "completed" : produced > 0 ? "in_progress" : "pending";
      const deliv = deliveryOf(deliveryOfWoColor(wo, null) || "", lastDay.get(k) || "");
      info.set(k, { customer, season, lines: linesOf.get(k) || new Set(), proc, deliv });
    }

    // -- pre-órdenes PRE#### ---------------------------------------------------
    const pre = new Map(); // String(pre_order_id) -> { customer, season, lines, proc, deliv, hay }
    const preLines = new Map(), preLast = new Map(), preHolds = new Map();
    for (const h of holds || []) {
      if (h.pre_order_id == null) continue;
      addLine(preLines, h.pre_order_id, h.line_no);
      bumpLast(preLast, h.pre_order_id, h.assigned_date);
      const k = String(h.pre_order_id);
      if (!preHolds.has(k)) preHolds.set(k, h);
    }
    const preRow = new Map();
    for (const r of merchantPlan || []) {
      if (r.pre_order_id != null && !preRow.has(String(r.pre_order_id))) preRow.set(String(r.pre_order_id), r);
    }
    for (const k of new Set([...preRow.keys(), ...preHolds.keys()])) {
      const r = preRow.get(k) || {}, h = preHolds.get(k) || {};
      const customer = String(r.customer_name || h.customer_name || "").trim();
      const season = String(r.season || h.season || "").trim();
      if (customer) customers.add(customer);
      if (season) seasons.add(season);
      const due = dayOfValue(r.target_date || r.delivery_date || preOrderTargets[k] || preOrderTargets[Number(k)] || "");
      pre.set(k, {
        customer, season,
        lines: preLines.get(k) || new Set(),
        proc: "pending",
        deliv: deliveryOf(due, preLast.get(k) || ""),
        hay: norm([r.work_order_no || h.pre_order_no || `PRE${k}`, r.style_code || h.style_code, r.estilo || h.estilo, customer, r.customer_po].filter(Boolean).join(" ")),
      });
    }

    const txt = (a, b) => a.localeCompare(b, "es", { sensitivity: "base" });
    return {
      woFilterInfo: info,
      preFilterInfo: pre,
      filterOptions: {
        customers: [...customers].sort(txt),
        seasons: [...seasons].sort(txt),
        lines: [...allLines].sort((a, b) => (Number(a) - Number(b)) || txt(a, b)),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders, assignments, holds, merchantPlan, preOrderTargets]);

  // POs que el merchant marcó como pre-orden (en cualquier color).
  const preFlaggedWoIds = useMemo(() => {
    const ids = new Set();
    for (const r of merchantPlan || []) {
      if (r.pre_order_id == null && r.is_pre_order && r.work_order_id != null) ids.add(String(r.work_order_id));
    }
    return ids;
  }, [merchantPlan]);

  const activeFilterCount =
    (boardFilters.kind !== "all" ? 1 : 0) +
    (boardFilters.customer ? 1 : 0) + (boardFilters.season ? 1 : 0) + (boardFilters.line ? 1 : 0) +
    (boardFilters.proc !== "all" ? 1 : 0) + (boardFilters.deliv !== "all" ? 1 : 0);

  // Filtros comunes sobre una ficha { customer, season, lines, proc, deliv }.
  const infoPassesFilters = (i) => {
    const f = boardFilters;
    if (!i) return false;
    if (f.customer && i.customer !== f.customer) return false;
    if (f.season && i.season !== f.season) return false;
    if (f.line && !i.lines.has(f.line)) return false;
    if (f.proc !== "all" && i.proc !== f.proc) return false;
    if (f.deliv !== "all" && i.deliv !== f.deliv) return false;
    return true;
  };
  // Tipo: `isPre` = el bloque / tarjeta es pre-orden.
  const kindPasses = (isPre) =>
    boardFilters.kind === "all" || (boardFilters.kind === "pre" ? isPre : !isPre);

  // `color` (opcional) decide pre-orden por color, como la marca PRE del bloque;
  // sin color se toma a nivel orden (alguno de sus colores es pre-orden).
  const woMatchesFilters = (woId, color) => {
    if (!activeFilterCount) return true;
    const isPre = color !== undefined ? isPreOrder(woId, color) : preFlaggedWoIds.has(String(woId));
    if (!kindPasses(isPre)) return false;
    return infoPassesFilters(woFilterInfo.get(String(woId)));
  };

  // "Searching" = búsqueda de texto y/o algún filtro activo: ambos usan el mismo
  // resaltado del tablero (coincidencias con anillo, el resto se desvanece).
  const isSearching = searchTerms.length > 0 || activeFilterCount > 0;
  const clearBoardFilters = () => { setBoardFilters(BOARD_FILTERS_EMPTY); setSearch(""); };

  // Searchable text per order: its number, every style field, and every
  // PO cliente / estilo on its lines. Built once per work-order load so typing
  // stays cheap.
  const searchHaystackByWoId = useMemo(() => {
    const m = new Map();
    for (const wo of workOrders) {
      const parts = [
        wo.work_order_no,
        wo.style_code,
        wo.estilo,
        wo.style_description,
        wo.customer_po,
        wo.customer_name,
      ];
      const lines = Array.isArray(wo.lines) ? wo.lines : [];
      for (const l of lines) parts.push(l?.estilo, l?.customerPo);
      m.set(String(wo.id), norm(parts.filter(Boolean).join(" ")));
    }
    return m;
  }, [workOrders]);

  // True when no search/filter is active, or the order passes the filters and
  // every search term hits its haystack.
  const woMatchesSearch = (woId, color) => {
    if (!isSearching) return true;
    if (!woMatchesFilters(woId, color)) return false;
    if (!searchTerms.length) return true;
    const hay = searchHaystackByWoId.get(String(woId)) || "";
    return searchTerms.every((t) => hay.includes(t));
  };

  // Lo mismo para una pre-orden PRE#### (tarjeta de la bolsa o reserva en el tablero).
  const preMatchesSearch = (preOrderId) => {
    if (!isSearching) return true;
    const i = preFilterInfo.get(String(preOrderId));
    if (!i) return false;
    if (activeFilterCount) {
      if (!kindPasses(true)) return false;
      if (!infoPassesFilters(i)) return false;
    }
    return searchTerms.every((t) => i.hay.includes(t));
  };

  // Un bloque del tablero (asignación o reserva PRE).
  const blockMatchesSearch = (a) =>
    a?.is_hold ? preMatchesSearch(a.pre_order_id) : woMatchesSearch(a?.work_order_id, a?.color ?? null);

  // Órdenes + pre-órdenes que pasan búsqueda + filtros (contador del panel).
  const filterTotal = woFilterInfo.size + preFilterInfo.size;
  const filterMatchCount = useMemo(() => {
    if (!isSearching) return null;
    let n = 0;
    for (const k of woFilterInfo.keys()) if (woMatchesSearch(k)) n++;
    for (const k of preFilterInfo.keys()) if (preMatchesSearch(k)) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woFilterInfo, preFilterInfo, preFlaggedWoIds, boardFilters, searchTerms, searchHaystackByWoId]);

  // The pool: one draggable "job" per work order + color, with remaining qty
  // and (when available) the size breakdown for that color.
  const poolJobs = useMemo(() => {
    const mkJob = (wo, color, colorQty, sizes, estilo, customerPo, breakdown) => ({
      key: keyOf(wo.id, color),
      workOrderId: wo.id,
      work_order_no: wo.work_order_no,
      customer_po: customerPo || wo.customer_po || "",
      color: color || null,
      remaining: Math.max(colorQty - assignedForColor(wo.id, color), 0),
      sizes: sizes || [],
      // PO cliente → estilo → talla×cantidad, for this color. Empty when the
      // order has no line-level detail (colors-only or bare quantity).
      breakdown: breakdown || [],
      estilo: estilo || wo.estilo || wo.style_code || "",
      customer_name: wo.customer_name,
      style_code: wo.style_code,
      sam_minutes: wo.sam_minutes,
      commitment_date: wo.commitment_date,
      delivery_date: deliveryOfWoColor(wo, color),
    });


    // Group work_order_lines by color, and within each color keep a full
    // PO cliente → estilo → talla×cantidad breakdown (shared with the modal).
    const groupsFromLines = (lines) => {
      const byColor = new Map();
      lines.forEach((l) => {
        if (!l || l.color == null) return;
        const cur = byColor.get(l.color) || { color: l.color, qty: 0, sizeMap: new Map(), estilos: new Set(), pos: new Set() };
        const q = Number(l.quantity) || 0;
        cur.qty += q;
        if (l.talla) cur.sizeMap.set(l.talla, (cur.sizeMap.get(l.talla) || 0) + q);
        if (l.estilo) cur.estilos.add(l.estilo);
        if (l.customerPo) cur.pos.add(l.customerPo);
        byColor.set(l.color, cur);
      });

      return [...byColor.values()].map((c) => ({
        color: c.color,
        qty: c.qty,
        sizes: [...c.sizeMap.entries()].map(([talla, quantity]) => ({ talla, quantity })),
        estilo: [...c.estilos].join(", "),
        customerPo: [...c.pos].join(", "),
        breakdown: buildBreakdownFromLines(lines, c.color),
      }));
    };

    const jobs = [];
    // A job only reaches the pool if the merchant planned it into a week; that
    // merchant week is attached so the planner knows where it belongs. If the
    // merchant plan couldn't be loaded, fall back to showing every open order.
    const consider = (job) => {
      // Only show a card while there is at least one whole piece left to
      // assign. Anything that would round to "0 pzas" (fully assigned, or a
      // sub-piece rounding/float remainder) is hidden from the pool.
      if (job.remaining < 1) return;
      const mp = merchantByKey.get(planKey(job.workOrderId, job.color));
      if (gateByMerchant && !mp) return;
      job.week = mp ? mp.week_start : null; // Monday (YYYY-MM-DD) the merchant assigned
      job.isPreOrder = !!(mp && mp.is_pre_order); // flagged on the merchant board
      jobs.push(job);
    };

    // Reduce a work order's per-color leftovers so their TOTAL never exceeds
    // what the order still needs on a line. remainingOf() nets out production
    // (goal - max(assigned, produced)), so once the floor reaches the goal the
    // pool goes quiet even if the old assignment cells were deleted. Production
    // is captured per ORDER, so the reduction is split across colors
    // proportionally - the same rule settle-day uses.
    const emitForOrder = (wo, rawJobs) => {
      const cap = remainingOfWo(wo); // goal - max(assigned, produced + future cells); never < 0
      if (cap < 1) return;
      const rawSum = rawJobs.reduce((s, j) => s + j.remaining, 0);
      if (rawSum > 0) {
        const factor = Math.min(1, cap / rawSum); // only ever scales DOWN
        rawJobs.forEach((j) => { j.remaining *= factor; consider(j); });
      } else {
        // Every color already fully assigned, yet the order still owes pieces
        // (cells deleted, or extra_quantity has no color line). Surface them as
        // one order-level card so they stay draggable.
        const j = mkJob(wo, wo.color || null, 0, [], wo.estilo, wo.customer_po);
        j.remaining = cap;
        consider(j);
      }
    };

    workOrders.forEach((wo) => {
      if (["completed", "cancelled"].includes(wo.status)) return;
      const lines = Array.isArray(wo.lines) ? wo.lines : [];
      const colors = Array.isArray(wo.colors) ? wo.colors.filter((c) => c && c.color != null) : [];

      let rawJobs;
      if (lines.length > 0) {
        rawJobs = groupsFromLines(lines).map((g) =>
          mkJob(wo, g.color, g.qty, g.sizes, g.estilo, g.customerPo, g.breakdown));
      } else if (colors.length > 0) {
        rawJobs = colors.map((c) =>
          mkJob(wo, c.color, Number(c.quantity) || 0, [], wo.estilo, wo.customer_po));
      } else {
        rawJobs = [mkJob(wo, wo.color || null, targetOf(wo), [], wo.estilo, wo.customer_po)];
      }
      emitForOrder(wo, rawJobs);
    });

    return jobs.sort((a, b) => {
      // Earliest merchant week first, then commitment date, then order/color.
      const wa = a.week || "9999-99-99";
      const wb = b.week || "9999-99-99";
      if (wa !== wb) return wa < wb ? -1 : 1;
      const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
      const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
      if (da !== db) return da - db;
      const c = String(a.work_order_no).localeCompare(String(b.work_order_no));
      return c !== 0 ? c : String(a.color || "").localeCompare(String(b.color || ""));
    });
  }, [workOrders, assignments, merchantByKey, gateByMerchant, openPlannedByWo]);

  // Pool after the search box. Order-level match keeps every color of a hit
  // order visible together (searchHaystackByWoId already folds in all lines).
  const filteredPoolJobs = useMemo(
    () => (isSearching ? poolJobs.filter((j) => woMatchesSearch(j.workOrderId, j.color ?? null)) : poolJobs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poolJobs, isSearching, searchHaystackByWoId, searchTerms, boardFilters, woFilterInfo, preOrderKeys]
  );

  // Las pre-órdenes no están en workOrders: se filtran con su propia ficha
  // (PRE####, cliente, estilo, PO cliente, líneas reservadas, fecha objetivo).
  const filteredPreOrderJobs = useMemo(
    () => (isSearching ? preOrderJobs.filter((j) => preMatchesSearch(j.preOrderId)) : preOrderJobs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preOrderJobs, isSearching, searchTerms, boardFilters, preFilterInfo]
  );

  // Group the pool by the merchant-assigned week so the planner sees, week by
  // week, exactly what needs to land on the day grid.
  const poolWeekGroups = useMemo(() => {
    const groups = new Map();
    for (const j of [...filteredPoolJobs, ...filteredPreOrderJobs]) {
      const wk = j.week || "";
      if (!groups.has(wk)) groups.set(wk, []);
      groups.get(wk).push(j);
    }
    return [...groups.entries()]
      .sort((a, b) => ((a[0] || "9999-99-99") < (b[0] || "9999-99-99") ? -1 : 1))
      .map(([week, jobs]) => ({
        week,
        // Las órdenes reales primero; las pre-órdenes cierran la semana.
        jobs: jobs.slice().sort((a, b) => (a.isPreOrderRow ? 1 : 0) - (b.isPreOrderRow ? 1 : 0)),
        // Piezas asignables vs. piezas que todavía son pronóstico: se cuentan
        // aparte para no inflar lo que el planner puede bajar al tablero.
        totalPzas: jobs.filter((j) => !j.isPreOrderRow).reduce((s, j) => s + (j.remaining || 0), 0),
        prePzas: jobs.filter((j) => j.isPreOrderRow).reduce((s, j) => s + (j.remaining || 0), 0),
        preCount: jobs.filter((j) => j.isPreOrderRow).length,
      }));
  }, [filteredPoolJobs, filteredPreOrderJobs]);

  const weekLabel = (weekStart) => {
    if (!weekStart) return { top: "Sin semana asignada", range: "" };
    const s = new Date(`${weekStart}T00:00:00`);
    const e = addDays(s, 6);
    return { top: `Semana ${getWeek(s, { weekStartsOn: 1 })}`, range: `${format(s, "dd/MM")} – ${format(e, "dd/MM/yyyy")}` };
  };

  // Jump the day grid to the Monday of a merchant week.
  const goToWeek = (weekStart) => {
    if (!weekStart) return;
    setViewMode("day");
    setCurrentDate(new Date(`${weekStart}T00:00:00`));
  };

  // Saldo pendiente → abre Diario en esa fecha y hace parpadear la celda para
  // que el planeador la tome y la arrastre a un día nuevo.
  const goToBalanceCell = (row) => {
    const d = String(row.assigned_date || "").slice(0, 10);
    if (!d) return;
    setBalOpen(false);
    setViewMode("day");
    setCurrentDate(new Date(`${d}T00:00:00`));
    setFlashCell(`${row.line_no}|${d}`);
  };
  useEffect(() => {
    if (!flashCell) return undefined;
    const t0 = setTimeout(() => {
      const el = document.querySelector(`[data-cell="${flashCell}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 120);
    const t1 = setTimeout(() => setFlashCell(null), 4000);
    return () => { clearTimeout(t0); clearTimeout(t1); };
  }, [flashCell]);

  // Días pendientes de reasignar, agrupados por orden (mayor saldo primero).
  const pendingBalanceGroups = useMemo(() => {
    // Sólo días ANTERIORES a hoy que cerraron por debajo de lo asignado, y sólo
    // de órdenes que siguen abiertas (una OT completada/cancelada ya no se
    // reasigna). Hoy y días futuros todavía pueden producirse, así que no avisan.
    const today = format(new Date(), "yyyy-MM-dd");
    const rows = (balances.rows || []).filter((r) => {
      if (!(Number(r.balance) > 0)) return false;
      const d = String(r.assigned_date || "").slice(0, 10);
      if (!d || d >= today) return false;
      const st = String(workOrders.find((w) => w.id === r.work_order_id)?.status || "").toLowerCase();
      return !["completed", "cancelled", "canceled", "closed"].includes(st);
    });
    const byWo = new Map();
    for (const r of rows) {
      const k = String(r.work_order_id);
      const g = byWo.get(k) || { key: k, woId: r.work_order_id, woNo: r.work_order_no, total: 0, rows: [] };
      g.total += Number(r.balance) || 0;
      g.rows.push(r);
      byWo.set(k, g);
    }
    const groups = [...byWo.values()];
    groups.forEach((g) => g.rows.sort((a, b) => String(b.assigned_date).localeCompare(String(a.assigned_date))));
    groups.sort((a, b) => b.total - a.total);
    return {
      groups,
      days: rows.length,
      pcs: rows.reduce((t, r) => t + (Number(r.balance) || 0), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances.rows, workOrders]);

  const getDateRange = () => {
    // Daily view: weekdays only (no weekend work) up to ~6 months ahead. Hiding
    // Sat/Sun roughly triples the density so ~3 months fit without scrolling.
    if (viewMode === "day") {
      // Semanas publicadas: el calendario se recorta a esos lunes→viernes y
      // nada más. El supermercado no puede navegar fuera de lo enviado.
      if (Array.isArray(restrictWeeks) && restrictWeeks.length > 0) {
        return restrictWeeks
          .slice()
          .sort()
          .flatMap((wk) => {
            const mon = new Date(`${wk}T00:00:00`);
            if (isNaN(mon.getTime())) return [];
            return eachDayOfInterval({ start: mon, end: addDays(mon, 6) })
              .filter((d) => { const w = d.getDay(); return w !== 0 && w !== 6; });
          });
      }
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 182) })
        .filter((d) => { const w = d.getDay(); return w !== 0 && w !== 6; });
    }
    // week/month are aggregated (handled by `periods`), no day range needed.
    return [];
  };
  const dateRange = getDateRange();

  const aggregated = viewMode === "week" || viewMode === "month" || viewMode === "year";
  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Aggregated columns: week → weekly blocks of the current month; month → 12 monthly blocks of the year.
  const periods = useMemo(() => {
    // Con semanas publicadas las columnas agregadas se arman SÓLO con esas
    // semanas: una columna por semana en Semanal, y una columna por cada mes que
    // toque alguna semana publicada en Mensual. Así ninguna vista puede mostrar
    // un periodo que planeación no envió.
    const restricted = Array.isArray(restrictWeeks) && restrictWeeks.length > 0;
    const weeksSorted = restricted ? restrictWeeks.slice().sort() : [];

    if (viewMode === "week") {
      if (restricted) {
        return weeksSorted
          .map((wk) => {
            const wStart = new Date(`${wk}T00:00:00`);
            if (isNaN(wStart.getTime())) return null;
            const wEnd = addDays(wStart, 6);
            return {
              key: wk,
              top: `Sem ${getWeek(wStart, { weekStartsOn: 1 })}`,
              bottom: format(wStart, "dd/MM"),
              start: wk,
              end: format(wEnd, "yyyy-MM-dd"),
            };
          })
          .filter(Boolean);
      }
      // 26 rolling weeks from the current week; scroll right for future weeks.
      const first = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: 26 }, (_, i) => {
        const wStart = addDays(first, i * 7);
        const wEnd = addDays(wStart, 6);
        return {
          key: format(wStart, "yyyy-MM-dd"),
          top: `Sem ${getWeek(wStart, { weekStartsOn: 1 })}`,
          bottom: format(wStart, "dd/MM"),
          start: format(wStart, "yyyy-MM-dd"),
          end: format(wEnd, "yyyy-MM-dd"),
        };
      });
    }
    if (viewMode === "month") {
      if (restricted) {
        // Meses distintos que toca cualquier semana publicada (una semana puede
        // caer a caballo entre dos meses; incluimos ambos).
        const monthKeys = new Set();
        weeksSorted.forEach((wk) => {
          const mon = new Date(`${wk}T00:00:00`);
          if (isNaN(mon.getTime())) return;
          for (let i = 0; i < 7; i++) monthKeys.add(format(addDays(mon, i), "yyyy-MM"));
        });
        return [...monthKeys].sort().map((mk) => {
          const mStart = new Date(`${mk}-01T00:00:00`);
          return {
            key: mk,
            top: MES[mStart.getMonth()],
            bottom: format(mStart, "yyyy"),
            start: format(startOfMonth(mStart), "yyyy-MM-dd"),
            end: format(endOfMonth(mStart), "yyyy-MM-dd"),
          };
        });
      }
      const s = startOfYear(currentDate);
      return eachMonthOfInterval({ start: s, end: endOfMonth(addMonths(s, 11)) }).map((mStart) => ({
        key: format(mStart, "yyyy-MM"),
        top: MES[mStart.getMonth()],
        bottom: format(mStart, "yyyy"),
        start: format(startOfMonth(mStart), "yyyy-MM-dd"),
        end: format(endOfMonth(mStart), "yyyy-MM-dd"),
      }));
    }
    if (viewMode === "year") {
      const y0 = currentDate.getFullYear();
      return Array.from({ length: 6 }, (_, i) => {
        const y = y0 + i;
        return {
          key: String(y),
          top: "Año",
          bottom: String(y),
          start: `${y}-01-01`,
          end: `${y}-12-31`,
        };
      });
    }
    return [];
  }, [viewMode, currentDate, restrictWeeks]);

  // Sum + per-order breakdown for a line within a [start,end] period (YYYY-MM-DD strings).
  const aggFor = (lineNo, startYmd, endYmd) => {
    const rows = assignments.filter(
      (a) =>
        String(a.line_no) === String(lineNo) &&
        !["cancelled", "rejected"].includes(a.status) &&
        a.assigned_date &&
        ymd(a.assigned_date) >= startYmd &&
        ymd(a.assigned_date) <= endYmd
    );
    let total = 0;
    const orders = new Map();
    rows.forEach((a) => {
      const q = parseFloat(a.assigned_quantity) || 0;
      total += q;
      const k = keyOf(a.work_order_id, a.color);
      const cur = orders.get(k) || {
        id: k,
        orderKey: `wo:${a.work_order_id}`,
        woId: a.work_order_id,
        color: a.color ?? null,
        groupKey: blockGroupKey(a),
        no: `${woNo(a)}${a.color ? " · " + a.color : ""}`,
        qty: 0,
        pre: isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color),
      };
      cur.qty += q;
      orders.set(k, cur);
    });
    // Pre-order holds (PRE####) reserve line/day capacity just like the daily
    // view shows them, so fold them into the same period totals. They aren't
    // real assignments (no work_order_id), so key them by their hold identity
    // and mark them pre + isHold. Counting their pieces in `total` keeps the
    // capacity-utilization color honest: a week/month/year full of reservations
    // reads as busy, exactly as it does day by day.
    holdRows.forEach((h) => {
      if (String(h.line_no) !== String(lineNo)) return;
      const d = ymd(h.assigned_date);
      if (!d || d < startYmd || d > endYmd) return;
      const q = parseFloat(h.assigned_quantity) || 0;
      total += q;
      const k = `hold:${keyOf(h.pre_order_id, h.color)}`;
      const cur = orders.get(k) || {
        id: k,
        orderKey: `pre:${h.pre_order_id}`,
        preOrderId: h.pre_order_id,
        groupKey: blockGroupKey(h),
        no: `${h.work_order_no}${h.color ? " · " + h.color : ""}`,
        qty: 0,
        pre: true,
        isHold: true,
      };
      cur.qty += q;
      orders.set(k, cur);
    });
    const list = [...orders.values()];
    // Pieces that are reservations (holds) or PO-flagged pre-orders, so the
    // cell/tooltip/modal can call out how much of the load is pre-order.
    const preQty = list.reduce((s, o) => s + (o.pre ? o.qty : 0), 0);
    return { total, orders: list, hasPre: list.some((o) => o.pre), preQty };
  };

  // Read a DATE/ISO value as its calendar day WITHOUT timezone shifting.
  const ymd = (v) => {
    if (!v) return "";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // Format a date-only value as dd/MM/yyyy (no timezone shift).
  const fmtDMY = (v) => {
    const s = ymd(v);
    if (!s) return "—";
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };

  // ---- capacity utilization coloring (week / month / year cells) ----------
  // Capacity comes from the PLANNER's standard per style (planner_style_params):
  //   pieces/day = operators × working_hours × 60 × efficiency ÷ SAM
  // A line-day can mix styles: each block uses qty ÷ (its style's pieces/day) of
  // the day, so the day's capacity in pieces is the mix-weighted target
  // (Σ qty ÷ Σ fraction). Days with nothing planned carry forward the line's most
  // recent mix (else the closest future one, else the planner-line target).
  // The line engineers' runs are NOT read here any more.
  // With lineNo: that line's own standard if it has one, else the general.
  const styleTargetOf = (styleKey, lineNo = null) => {
    const p = paramsFor(styleKey, lineNo) || paramsForLine(styleParams, lineParams, styleKey, lineNo);
    return p ? targetOfParams(p) : 0;
  };

  // A line's daily capacity (pieces) on a specific date.
  const targetForLineOnDate = (lineNo, dayStr) => {
    const idx = styleDayIndex.get(String(lineNo));
    if (idx) {
      const e = idx.byDay.get(dayStr);
      if (e && e.frac > 0) return e.qtyKnown / e.frac;
      let chosen = null;
      for (const x of idx.sorted) { if (x.d <= dayStr) chosen = x; else break; }
      const ref = chosen || idx.sorted[0];
      if (ref) return ref.cap;
    }
    return Math.round(Number(plannerLineMap[String(lineNo)]?.target_pcs) || 0); // planner line, nothing planned yet
  };

  // Sum the real daily capacity over the working weekdays in the period.
  const periodCapacity = (lineNo, startYmd, endYmd) => {
    let sum = 0;
    let d = new Date(`${startYmd}T00:00:00`);
    const end = new Date(`${endYmd}T00:00:00`);
    while (d <= end) {
      const g = d.getDay();
      // Días festivos / paros (planta o de la línea) no aportan capacidad.
      if (g !== 0 && g !== 6 && !holidayFor(lineNo, d)) sum += targetForLineOnDate(lineNo, ymd(d));
      d = addDays(d, 1);
    }
    return sum;
  };

  // Días festivos dentro de un periodo (sólo lunes–viernes).
  //   lineNo = null → sólo festivos de TODA la planta (encabezado de columna)
  //   lineNo = "8"  → festivos de planta + los propios de esa línea
  // full = todos los días hábiles del periodo están bloqueados.
  const periodHolidays = (lineNo, startYmd, endYmd) => {
    let work = 0, off = 0;
    const names = new Set();
    let d = new Date(`${startYmd}T00:00:00`);
    const end = new Date(`${endYmd}T00:00:00`);
    while (d <= end) {
      const g = d.getDay();
      if (g !== 0 && g !== 6) {
        work += 1;
        const key = format(d, "yyyy-MM-dd");
        const h = lineNo == null
          ? holidayIndex.plant.get(key)
          : holidayFor(lineNo, key);
        if (h) { off += 1; if (h.name) names.add(h.name); }
      }
      d = addDays(d, 1);
    }
    return { work, off, full: work > 0 && off === work, name: [...names].join(", ") };
  };

  // util = assigned / capacity → bucket color. Bright, solid fills so the state
  // reads instantly across the grid; text color picked for contrast.
  //   ≥95% verde · 80–95% amarillo · 50–80% naranja · <50% rojo
  const capColor = (util) => {
    if (util >= 0.95) return { bg: "#22c55e", border: "#16a34a", text: "#ffffff" }; // green
    if (util >= 0.80) return { bg: "#facc15", border: "#eab308", text: "#3f2d00" }; // yellow
    if (util >= 0.50) return { bg: "#f97316", border: "#ea580c", text: "#ffffff" }; // orange
    return { bg: "#ef4444", border: "#dc2626", text: "#ffffff" };                   // red
  };

  // Capacity never reads above 100%. Anything assigned beyond the capacity is
  // reported as an EXCESS in pieces (+N) instead of a >100% figure, so the
  // planner sees exactly how much has to be moved off that line/period.
  //   shown  → utilization clamped to 0–1 (drives color + % label)
  //   over   → whole pieces above capacity (0 when within capacity)
  // Week / month view: is this period the one that contains today?
  const todayYmdStr = format(new Date(), "yyyy-MM-dd");
  const isCurrentWeek = (p) => (viewMode === "week" || viewMode === "month") && p.start <= todayYmdStr && todayYmdStr <= p.end;
  const currentPeriodLabel = viewMode === "month" ? "Mes actual" : "Semana actual";

  const capInfo = (total, cap) => {
    if (!(cap > 0)) return { util: null, shown: null, over: 0 };
    const util = total / cap;
    const over = Math.max(Math.round(total) - Math.round(cap), 0);
    return { util, shown: Math.min(util, 1), over };
  };

  // ── Totales por columna del encabezado ─────────────────────────────────
  // Total ASIGNADO por dia (todas las lineas). Sale de las asignaciones
  // locales, que siempre estan cargadas, aunque la deteccion de piso no
  // resuelva. El PRODUCIDO por dia vive en producedByDay (fetch de arriba).
  const assignedByDay = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (["cancelled", "rejected"].includes(a.status)) continue;
      const k = ymd(a.assigned_date);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + (parseFloat(a.assigned_quantity) || 0));
    }
    // PRE#### holds are assigned-to-produce load too (they reserve the line-day),
    // so the header's assigned total includes them alongside real POs.
    for (const h of holds || []) {
      const k = ymd(h.assigned_date);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + (Number(h.quantity) || 0));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, holds]);

  // Suma de un Map<ymd,number> en el rango [startYmd,endYmd] inclusive. Las
  // llaves son 'YYYY-MM-DD', asi que el orden lexicografico == cronologico.
  const sumRange = (map, startYmd, endYmd) => {
    let s = 0;
    for (const [k, v] of map) if (k >= startYmd && k <= endYmd) s += v;
    return s;
  };

  // { assigned, produced } para una columna [start,end] (un solo dia en Diario).
  const columnTotals = (startYmd, endYmd) => ({
    assigned: startYmd === endYmd ? (assignedByDay.get(startYmd) || 0) : sumRange(assignedByDay, startYmd, endYmd),
    produced: startYmd === endYmd ? (producedByDay.get(startYmd) || 0) : sumRange(producedByDay, startYmd, endYmd),
  });

  // Numero compacto para las celdas angostas del Diario (34px): 1.2k, 12k.
  const compactN = (v) => {
    const num = Math.round(Number(v) || 0);
    if (num >= 10000) return `${Math.round(num / 1000)}k`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  // Saldo de la celda a la que pertenece una asignacion. Se busca por
  // (orden, linea, dia) y no por id: una celda puede tener varias filas (una
  // por color) y la produccion no se captura por color, asi que restarla
  // contra cada fila la contaria de mas.
  const balanceOf = (a) =>
    balances.byCell.get(
      cellKey(a.work_order_id, a.line_no, ymd(a.assigned_date || a.planned_start_date))
    );

  // Each assignment is one day (one assigned_date), matched by calendar day.
  const cellMatches = (a, lineNo, key) => {
    if (String(a.line_no) !== String(lineNo)) return false;
    if (a.assigned_date) return ymd(a.assigned_date) === key;
    return ymd(a.planned_start_date) <= key && key <= ymd(a.planned_end_date);
  };
  // PRE#### holds, shaped like day assignments so they flow through the same
  // cell rendering. is_hold marks them so interactions (drag/move/settle/select)
  // are gated off — a hold is only a reservation, not a real line_assignment.
  const holdRows = useMemo(
    () => (holds || []).map((h) => ({
      id: `hold:${h.id}`,
      holdId: h.id,
      is_hold: true,
      pre_order_id: h.pre_order_id,
      work_order_id: null,
      work_order_no: h.pre_order_no || `PRE${h.pre_order_id}`,
      line_no: h.line_no,
      assigned_date: h.assigned_date,
      planned_start_date: h.assigned_date,
      planned_end_date: h.assigned_date,
      assigned_quantity: Number(h.quantity) || 0,
      color: h.color || null,
      status: "planned",
      style_code: h.style_code || "",
      estilo: h.estilo || "",
      customer_name: h.customer_name || "",
      target_date: h.target_date ? String(h.target_date).slice(0, 10) : null, // entrega de la pre-orden
    })),
    [holds]
  );
  // Singular getter stays assignments-only: holds must not block moves.
  const getAssignmentForLineAndDate = (lineNo, date) =>
    assignments.find((a) => cellMatches(a, lineNo, format(date, "yyyy-MM-dd")));
  // All POs (and pre-order holds) sharing a line-day. Real assignments first,
  // holds last, each sized by its share of the day's pieces.
  const getAssignmentsForLineAndDate = (lineNo, date) => {
    const key = format(date, "yyyy-MM-dd");
    const real = assignments
      .filter((a) => cellMatches(a, lineNo, key) && !["cancelled", "rejected"].includes(a.status))
      .sort((x, y) => (parseFloat(y.assigned_quantity) || 0) - (parseFloat(x.assigned_quantity) || 0));
    const held = holdRows.filter((h) => cellMatches(h, lineNo, key));
    return [...real, ...held];
  };

  // ---- delete lock: protect old assigned quantity ------------------------
  // A cell dated BEFORE today is "locked": it represents production/quantity
  // that was already assigned in the past and must not be deleted. Today and
  // future days stay editable. If the rule should instead lock everything from
  // today ONWARD, change `k < todayStr()` below to `k >= todayStr()`.
  const todayStr = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return format(d, "yyyy-MM-dd"); };
  const cellDateOf = (a) => ymd(a?.assigned_date || a?.planned_start_date);
  const isLockedCell = (a) => { const k = cellDateOf(a); return !!k && k < todayStr(); };

  // ---- candado de SEMANA (CEO) ---------------------------------------------
  // Distinto del candado de días pasados de arriba: éste lo pone el CEO por
  // semana completa (lun–dom) y congela TODO movimiento en ella.
  // Los DOS candados (semanas del CEO + tablero completo) se piden EN PARALELO
  // y sin caché; antes iban uno tras otro y el segundo esperaba al primero.
  // Si falla la red se conserva lo último conocido: el servidor lo hace cumplir.
  const loadWeekLocks = async ({ retries = 0 } = {}) => {
    if (dataOverride) return; // snapshot publicado: no aplica
    const [wk, bl] = await Promise.all([
      getJSON("/api/plan-week-locks", { retries, timeoutMs: 15000 }),
      getJSON("/api/plan-board-lock", { retries, timeoutMs: 15000 }),
    ]);
    if (wk.ok && wk.data?.success) {
      const map = {};
      (wk.data.locks || []).forEach((l) => { if (l?.week_start) map[l.week_start] = l; });
      setWeekLocks(map);
      setCanLockServer(!!wk.data.canLock);
    }
    if (bl.ok && bl.data?.success) {
      const d2 = bl.data;
      setBoardLock({ locked: !!d2.locked, lockedBy: d2.lockedBy, lockedAt: d2.lockedAt, canLock: !!d2.canLock });
    }
  };
  const loadWeekLocksRef = useRef(loadWeekLocks);
  loadWeekLocksRef.current = loadWeekLocks;

  // true (y avisa) cuando el tablero está bloqueado. Se usa al inicio de cada
  // acción que cambia el tablero; el servidor y la base lo hacen cumplir igual.
  const boardLockedGuard = () => {
    if (!boardLock.locked) return false;
    showToast(`🔒 El Plan Board está bloqueado${boardLock.lockedBy ? ` por ${boardLock.lockedBy}` : ""}. Desbloquéelo para hacer cambios.`, true);
    setDraggedAssignment(null); setDraggedPO(null); setArmedPO(null); setDropTarget(null);
    return true;
  };

  const toggleBoardLock = async () => {
    const next = !boardLock.locked;
    const ok = window.confirm(next
      ? "¿Bloquear el Plan Board?\n\nNadie podrá asignar, mover, insertar ni eliminar celdas hasta que se desbloquee."
      : "¿Desbloquear el Plan Board?\n\nSe podrán volver a asignar, mover, insertar y eliminar celdas.");
    if (!ok) return;
    setBoardLockBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/plan-board-lock`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ locked: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setBoardLock((b) => ({ ...b, locked: !!data.locked, lockedBy: data.lockedBy, lockedAt: data.lockedAt }));
        setSelectMode(false); setSelectedIds(new Set());
        showToast(data.locked ? "🔒 Plan Board bloqueado." : "🔓 Plan Board desbloqueado.");
      } else {
        showToast(data.error || "No se pudo cambiar el candado del tablero", true);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setBoardLockBusy(false);
    }
  };
  // Respuesta 423 = el servidor rechazó un cambio porque hay candado (semana del
  // CEO o tablero completo). En cuanto llega, se recargan los candados para que
  // el tablero se pinte bloqueado YA, sin esperar al siguiente refresco.
  useEffect(() => {
    if (dataOverride) return undefined;
    const orig = window.fetch;
    const wrapped = async (...args) => {
      const res = await orig(...args);
      try {
        const url = String(args[0]?.url || args[0] || "");
        if (res.status === 423 && url.includes("/api/") && !url.includes("lock")) {
          setTimeout(() => loadWeekLocksRef.current?.(), 0);
        }
      } catch { /* nunca romper la petición original */ }
      return res;
    };
    window.fetch = wrapped;
    return () => { if (window.fetch === wrapped) window.fetch = orig; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se refresca solo: si el CEO bloquea mientras el planner tiene el tablero
  // abierto, el candado aparece en segundos (y al volver a la pestaña).
  useEffect(() => {
    if (dataOverride) return undefined;
    // La primera lectura va dentro de fetchData (junto con el resto del tablero).
    // Con la pestaña oculta no consulta: una pestaña olvidada abierta ya no
    // mantiene despierta la base de datos (Aurora puede pausarse).
    // Cada 10 s (antes 20 s): un candado nuevo del CEO aparece en ≤10 s.
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") loadWeekLocks(); }, 10000);
    const onFocus = () => { if (document.visibilityState !== "hidden") loadWeekLocks(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataOverride]);

  // Lunes (YYYY-MM-DD) de la semana de una fecha (Date o "YYYY-MM-DD...").
  const weekKeyOf = (d) => {
    if (!d) return null;
    const dt = typeof d === "string" ? new Date(`${ymd(d)}T00:00:00`) : d;
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return null;
    return format(startOfWeek(dt, { weekStartsOn: 1 }), "yyyy-MM-dd");
  };
  const weekLockOf = (d) => { const k = weekKeyOf(d); return k ? weekLocks[k] || null : null; };
  const weekLabelOf = (weekKey) => {
    const s0 = new Date(`${weekKey}T00:00:00`);
    return `Semana ${getWeek(s0, { weekStartsOn: 1 })} (${format(s0, "dd/MM")} – ${format(addDays(s0, 6), "dd/MM")})`;
  };
  const weekLockMsg = (d) =>
    `🔒 La ${weekLabelOf(weekKeyOf(d))} está bloqueada por el CEO. No se puede mover nada en esa semana hasta que la desbloquee.`;
  // Devuelve true (y avisa) si CUALQUIERA de las fechas cae en semana bloqueada.
  const blockedByWeekLock = (...dates) => {
    for (const d of dates.flat()) {
      if (d && weekLockOf(d)) { showToast(weekLockMsg(d), true); return true; }
    }
    return false;
  };
  // Fechas actuales de las casillas seleccionadas (asignaciones y reservas PRE).
  const datesOfIds = (ids) => {
    const set = new Set(ids);
    return [...assignments, ...holdRows].filter((a) => set.has(a.id)).map((a) => a.assigned_date);
  };

  // CEO: bloquear / desbloquear una semana completa.
  // Pre-órdenes (reservas PRE####) por semana: una semana que las tiene NO se
  // puede bloquear (el servidor lo rechaza con 409 WEEK_HAS_PRE_ORDERS).
  // Cuenta TODO lo que el tablero pinta como PRE, no sólo las reservas:
  //   1. reservas PRE#### en el tablero (pre_order_day_holds)
  //   2. POs reales marcadas como pre-orden por el merchant (is_pre_order):
  //      son line_assignments, no holds, y la vista Semanal también les pone
  //      el sello PRE (aggFor -> hasPre). Antes se escapaban del candado.
  //   3. pre-órdenes PRE#### que el merchant planeó en esa semana y que aún
  //      tienen piezas sin reservar (la bolsa de la semana).
  // Con UNA sola pre-orden la semana ya no se puede bloquear.
  const preOrdersByWeek = useMemo(() => {
    const m = new Map();
    const add = (wk, label) => {
      if (!wk || !label) return;
      if (!m.has(wk)) m.set(wk, new Set());
      m.get(wk).add(label);
    };
    // 1. Reservas PRE en el tablero
    for (const h of holds || []) {
      if (!(Number(h.quantity) > 0)) continue;
      add(weekKeyOf(h.assigned_date), h.pre_order_no || `PRE${h.pre_order_id}`);
    }
    // 2. POs marcadas como pre-orden, ya asignadas a un día
    for (const a of assignments || []) {
      if (!a.assigned_date || ["cancelled", "rejected"].includes(a.status)) continue;
      if (!(isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color))) continue;
      add(weekKeyOf(a.assigned_date), a.work_order_no || `PO ${a.work_order_id}`);
    }
    // 3. PRE#### planeadas por el merchant en la semana, aún por reservar
    for (const j of preOrderJobs || []) {
      if (!j.week || !(j.remaining > 0)) continue;
      add(weekKeyOf(j.week), j.work_order_no || `PRE${j.preOrderId}`);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holds, assignments, preOrderKeys, preOrderJobs]);
  const preOrdersInWeek = (weekKey) => [...(preOrdersByWeek.get(weekKey) || [])].sort();

  const toggleWeekLock = async (weekKey) => {
    if (!weekLocks[weekKey]) {
      const pre = preOrdersInWeek(weekKey);
      if (pre.length) {
        showToast(`No se puede bloquear la ${weekLabelOf(weekKey)}: tiene pre-órdenes en el tablero (${pre.join(", ")}). Conviértalas, muévalas o quítelas primero.`, true);
        return;
      }
    }
    if (!canLockWeeks || !weekKey || lockBusyWeek) return;
    const locked = !!weekLocks[weekKey];
    const label = weekLabelOf(weekKey);
    const ok = window.confirm(
      locked
        ? `¿Desbloquear la ${label}?\n\nEl planner podrá volver a asignar y mover órdenes en esa semana.`
        : `¿Bloquear la ${label}?\n\nEl planner NO podrá asignar, mover ni eliminar nada en esa semana hasta que usted la desbloquee.`
    );
    if (!ok) return;
    setLockBusyWeek(weekKey);
    try {
      const res = await fetch(`${API_URL}/api/plan-week-locks/${weekKey}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ locked: !locked }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const map = {};
        (data.locks || []).forEach((l) => { if (l?.week_start) map[l.week_start] = l; });
        setWeekLocks(map);
        showToast(locked ? `🔓 ${label} desbloqueada.` : `🔒 ${label} bloqueada.`);
      } else {
        showToast(data.error || `No se pudo cambiar el candado (HTTP ${res.status}).`, true);
      }
    } catch (err) {
      showToast(`Error al cambiar el candado: ${err.message}`, true);
    } finally {
      setLockBusyWeek(null);
    }
  };

  // ---- exportar a Excel (vista Semanal) ------------------------------------
  // Un libro con 3 hojas, por cada semana exportada:
  //   • Resumen por línea   capacidad, asignado, PRE, % uso, # órdenes
  //   • Órdenes             una fila por línea × orden/color en la semana, con
  //                         estilo, cliente, PO, días, SAM, entrega vs fin de plan
  //   • Detalle diario      cada casilla del tablero (línea × día × orden)
  // Usa los mismos datos que pinta el tablero (assignments + reservas PRE), así
  // que el Excel coincide con lo que se ve en pantalla. exceljs se carga sólo al
  // exportar para no engordar el bundle del tablero.
  const [exportBusy, setExportBusy] = useState(false);

  const STATUS_ES = { planned: "Planeada", released: "Enviada a línea", completed: "Completada", in_progress: "En proceso", pending: "Pendiente", assigned: "Asignada", cancelled: "Cancelada", rejected: "Rechazada" };
  const DIA_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  // Fecha "YYYY-MM-DD" → Date en UTC (exceljs escribe en UTC; así el día no se corre).
  const xlDate = (s) => {
    const k = ymd(s);
    if (!k) return null;
    const [y, m, d] = k.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const addDaysLocal = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // Estilo(s) y PO(s) cliente de UNA orden+color, desde sus renglones; si la
  // orden no trae renglones, cae a los datos de cabecera.
  const orderDetailFor = (woId, color) => {
    const wo = woOf(woId) || {};
    const ls = (Array.isArray(wo.lines) ? wo.lines : []).filter(
      (l) => !color || String(l?.color || "").trim().toUpperCase() === String(color).trim().toUpperCase()
    );
    const uniq = (arr) => [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))].join(", ");
    return {
      wo,
      estilo: uniq(ls.map((l) => l.estilo)) || wo.estilo || wo.style_code || "",
      po: uniq(ls.map((l) => l.customerPo)) || wo.customer_po || "",
      entregaLineas: [...new Set(ls.map((l) => l.commitmentDate).filter(Boolean))].sort(),
    };
  };

  const exportWeeksToExcel = async (weekPeriods) => {
    const weeks = (weekPeriods || []).filter(Boolean);
    if (!weeks.length || exportBusy) return;
    setExportBusy(true);
    try {
      const mod = await import("exceljs");
      const ExcelJS = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Plan Board";
      wb.created = new Date();

      const FONT = { name: "Arial", size: 10 };
      const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      const WEEK_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
      const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      const PRE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
      const LATE_FONT = { ...FONT, color: { argb: "FFB91C1C" }, bold: true };
      const OK_FONT = { ...FONT, color: { argb: "FF15803D" }, bold: true };
      const thin = { style: "thin", color: { argb: "FFD1D5DB" } };
      const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

      const first = weeks[0], last = weeks[weeks.length - 1];
      const weekNum = (p) => getWeek(new Date(`${p.start}T00:00:00`), { weekStartsOn: 1 });
      const rangeTxt = (p) => `${fmtDMY(p.start)} – ${fmtDMY(p.end)}`;
      const titleTxt = weeks.length === 1
        ? `Plan Board — Semana ${weekNum(first)} (${rangeTxt(first)})`
        : `Plan Board — Semanas ${weekNum(first)} a ${weekNum(last)} (${fmtDMY(first.start)} – ${fmtDMY(last.end)})`;
      const lockedTxt = weeks.filter((p) => weekLocks[p.key]).map((p) => `Sem ${weekNum(p)}`).join(", ");
      const subTxt = `Generado ${format(new Date(), "dd/MM/yyyy HH:mm")}${lockedTxt ? ` · 🔒 Bloqueadas por el CEO: ${lockedTxt}` : ""}`;

      // Hoja con título en filas 1-2 y encabezados en la fila 4.
      const HEAD_ROW = 4;
      const makeSheet = (name, cols) => {
        const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: HEAD_ROW }] });
        ws.columns = cols.map((c) => ({ key: c.key, width: c.width || 12, style: { font: FONT, numFmt: c.fmt } }));
        ws.getCell("A1").value = titleTxt;
        ws.getCell("A1").font = { ...FONT, size: 14, bold: true };
        ws.getCell("A2").value = subTxt;
        ws.getCell("A2").font = { ...FONT, color: { argb: "FF6B7280" } };
        const hr = ws.getRow(HEAD_ROW);
        cols.forEach((c, i) => {
          const cell = hr.getCell(i + 1);
          cell.value = c.header;
          cell.font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = HEAD_FILL;
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.border = BORDER;
        });
        hr.height = 30;
        ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW, column: cols.length } };
        return ws;
      };
      const col = (ws, key) => ws.getColumn(key).letter;
      const addRow = (ws, values, extra = {}) => {
        const r = ws.addRow(values);
        r.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; if (extra.fill) c.fill = extra.fill; if (extra.bold) c.font = { ...FONT, bold: true }; });
        return r;
      };

      // ---------- datos de una semana ----------
      const liveAssign = (p) => assignments.filter(
        (a) => !["cancelled", "rejected"].includes(a.status) && a.assigned_date &&
          ymd(a.assigned_date) >= p.start && ymd(a.assigned_date) <= p.end
      );
      const liveHolds = (p) => holdRows.filter(
        (h) => h.assigned_date && ymd(h.assigned_date) >= p.start && ymd(h.assigned_date) <= p.end
      );
      // Fin de plan por orden+color: último día asignado en TODO el tablero.
      const finPlanByKey = new Map();
      assignments.forEach((a) => {
        if (["cancelled", "rejected"].includes(a.status) || !a.assigned_date) return;
        const k = keyOf(a.work_order_id, a.color);
        const d = ymd(a.assigned_date);
        if (!finPlanByKey.has(k) || d > finPlanByKey.get(k)) finPlanByKey.set(k, d);
      });

      // ---------- día a día por línea + cambios de estilo ----------
      // Índice línea → día → renglones (asignaciones vivas + reservas PRE) de TODO
      // el tablero, para poder comparar cada día con el día trabajado anterior
      // aunque éste caiga en la semana previa.
      const CHANGE_STYLE_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAE8FF" } }; // fucsia claro
      const CHANGE_COLOR_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } }; // azul claro
      const CHANGE_STYLE_ARGB = "FFA21CAF"; // fucsia (igual que el tablero)
      const CHANGE_COLOR_ARGB = "FF0369A1"; // azul
      const rowKeyOf = (a) => (a.is_hold ? `hold:${keyOf(a.pre_order_id, a.color)}` : keyOf(a.work_order_id, a.color));
      const rowLabelOf = (a) => `${a.is_hold ? a.work_order_no : woNo(a)}${a.color ? " · " + a.color : ""}`;
      const dayIndex = new Map(); // line → Map(day → rows[])
      [...assignments.filter((a) => !["cancelled", "rejected"].includes(a.status) && a.assigned_date), ...holdRows.filter((h) => h.assigned_date)]
        .forEach((a) => {
          const ln = String(a.line_no), d = ymd(a.assigned_date);
          if (!d) return;
          if (!dayIndex.has(ln)) dayIndex.set(ln, new Map());
          const m = dayIndex.get(ln);
          if (!m.has(d)) m.set(d, []);
          m.get(d).push(a);
        });
      const sortedDaysOf = new Map();
      dayIndex.forEach((m, ln) => sortedDaysOf.set(ln, [...m.keys()].sort()));
      const rowsOn = (lineNo, d) => dayIndex.get(String(lineNo))?.get(d) || [];
      const prevWorkedDay = (lineNo, d) => {
        const ds = sortedDaysOf.get(String(lineNo)) || [];
        let prev = null;
        for (const x of ds) { if (x < d) prev = x; else break; }
        return prev;
      };
      // Órdenes/colores de un día (OT · color = pzas), de mayor a menor.
      const dayOrdersOf = (rows) => {
        const m = new Map();
        rows.forEach((a) => {
          const k = rowKeyOf(a);
          const cur = m.get(k) || { key: k, label: rowLabelOf(a), qty: 0, style: styleKeyOfAssignment(a), hold: !!a.is_hold, rows: [] };
          cur.qty += parseFloat(a.assigned_quantity) || 0;
          cur.rows.push(a);
          m.set(k, cur);
        });
        return [...m.values()].sort((x, y) => y.qty - x.qty);
      };
      // Cambio en la línea ese día, contra el día trabajado anterior y dentro del
      // mismo día (2+ estilos, como la marca "Cambio estilo" del tablero).
      //   → { kind: "style"|"color", text, incoming: Set(rowKey) }  |  null
      const changeMemo = new Map();
      const dayChangeOf = (lineNo, d) => {
        const mk = `${lineNo}|${d}`;
        if (changeMemo.has(mk)) return changeMemo.get(mk);
        const today = dayOrdersOf(rowsOn(lineNo, d));
        let res = null;
        if (today.length) {
          const pd = prevWorkedDay(lineNo, d);
          const prev = pd ? dayOrdersOf(rowsOn(lineNo, pd)) : [];
          const prevStyles = new Set(prev.map((o) => o.style).filter(Boolean));
          const prevKeys = new Set(prev.map((o) => o.key));
          const todayStyles = [...new Set(today.map((o) => o.style).filter(Boolean))];
          // Estilos que entran hoy: no venían del día anterior; si no hay día
          // anterior, cuentan los que no son el estilo principal del día.
          const base = prevStyles.size ? prevStyles : new Set(todayStyles.slice(0, 1));
          const newStyleOrders = today.filter((o) => o.style && !base.has(o.style));
          const intra = cellChangeOf(rowsOn(lineNo, d));
          if (newStyleOrders.length || intra?.kind === "style") {
            const incoming = newStyleOrders.length ? newStyleOrders : today.slice(1);
            const fromTxt = [...(prevStyles.size ? prevStyles : base)].join(", ") || "—";
            const toTxt = [...new Set(incoming.map((o) => o.style).filter(Boolean))].join(", ") || "estilo distinto";
            res = {
              kind: "style",
              text: `Cambio de estilo ${fromTxt} → ${toTxt}: ${incoming.map((o) => o.label).join(", ")}`,
              incoming: new Set(incoming.map((o) => o.key)),
            };
          } else {
            const newColorOrders = prev.length ? today.filter((o) => !prevKeys.has(o.key)) : [];
            if (newColorOrders.length || intra?.kind === "color") {
              const incoming = newColorOrders.length ? newColorOrders : today.slice(1);
              res = {
                kind: "color",
                text: `Cambio de color${todayStyles.length ? ` (${todayStyles[0]})` : ""}: ${incoming.map((o) => o.label).join(", ")}`,
                incoming: new Set(incoming.map((o) => o.key)),
              };
            }
          }
        }
        changeMemo.set(mk, res);
        return res;
      };
      // Columnas de día (1 = lunes … 7 = domingo). Sáb/Dom sólo si hay carga.
      const isoDow = (d) => ((new Date(`${d}T00:00:00`).getDay() + 6) % 7) + 1;
      const DOW_ES = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };
      const weekDaysOf = (p) => {
        const out = [];
        for (let d = new Date(`${p.start}T00:00:00`); format(d, "yyyy-MM-dd") <= p.end; d = addDaysLocal(d, 1)) out.push(format(d, "yyyy-MM-dd"));
        return out;
      };
      // Cambios de una línea en la semana: estilos que entran / órdenes-color que entran.
      const weekChangesOf = (lineNo, p) => {
        let style = 0, color = 0;
        weekDaysOf(p).forEach((d) => {
          const ch = dayChangeOf(lineNo, d);
          if (!ch) return;
          if (ch.kind === "style") {
            const inc = dayOrdersOf(rowsOn(lineNo, d)).filter((o) => ch.incoming.has(o.key));
            style += Math.max(1, new Set(inc.map((o) => o.style).filter(Boolean)).size);
          } else {
            color += Math.max(1, ch.incoming.size);
          }
        });
        return { style, color };
      };

      // ================= Hoja 1: Resumen por línea =================
      const sumCols = [
        { key: "sem", header: "Semana", width: 9 },
        { key: "ini", header: "Inicio", width: 12, fmt: "dd/mm/yyyy" },
        { key: "fin", header: "Fin", width: 12, fmt: "dd/mm/yyyy" },
        { key: "lock", header: "Candado", width: 11 },
        { key: "linea", header: "Línea", width: 8 },
        { key: "ops", header: "Operarios", width: 10, fmt: "#,##0" },
        { key: "cap", header: "Capacidad semana (pzas)", width: 14, fmt: "#,##0" },
        { key: "asig", header: "Asignado (pzas)", width: 13, fmt: "#,##0" },
        { key: "pre", header: "De ello PRE-orden (pzas)", width: 14, fmt: "#,##0" },
        { key: "uso", header: "% uso", width: 9, fmt: "0%" },
        { key: "libre", header: "Capacidad libre (pzas)", width: 14, fmt: "#,##0" },
        { key: "exc", header: "Excede capacidad (pzas)", width: 14, fmt: "#,##0" },
        { key: "nord", header: "# Órdenes", width: 10, fmt: "#,##0" },
        { key: "cest", header: "# Cambios de estilo", width: 12, fmt: "#,##0" },
        { key: "ccol", header: "# Cambios de color", width: 12, fmt: "#,##0" },
        { key: "ordsem", header: "Órdenes de la semana (OT · color = pzas)", width: 60 },
        { key: "ords", header: "Órdenes por día (OT · color = pzas)", width: 70 },
      ];
      const wsSum = makeSheet("Resumen por línea", sumCols);
      const C = (k) => col(wsSum, k);

      // ================= Hoja 2: Órdenes =================
      const ordCols = [
        { key: "sem", header: "Semana", width: 9 },
        { key: "linea", header: "Línea", width: 8 },
        { key: "ot", header: "OT", width: 12 },
        { key: "color", header: "Color", width: 14 },
        { key: "tipo", header: "Tipo", width: 13 },
        { key: "estilo", header: "Estilo", width: 16 },
        { key: "desc", header: "Descripción", width: 28 },
        { key: "cliente", header: "Cliente", width: 20 },
        { key: "po", header: "PO cliente", width: 16 },
        { key: "dias", header: "Días en la semana", width: 26 },
        { key: "d1", header: "Primer día", width: 12, fmt: "dd/mm/yyyy" },
        { key: "d2", header: "Último día", width: 12, fmt: "dd/mm/yyyy" },
        { key: "qty", header: "Pzas asignadas (semana)", width: 13, fmt: "#,##0" },
        { key: "sam", header: "SAM (min/pza)", width: 10, fmt: "0.00" },
        { key: "min", header: "Minutos SAM", width: 12, fmt: "#,##0" },
        { key: "meta", header: "Meta orden (pzas)", width: 12, fmt: "#,##0" },
        { key: "asigTot", header: "Asignado total orden", width: 12, fmt: "#,##0" },
        { key: "prod", header: "Producido orden", width: 12, fmt: "#,##0" },
        { key: "pend", header: "Pendiente sin línea", width: 12, fmt: "#,##0" },
        { key: "entrega", header: "Fecha entrega", width: 12, fmt: "dd/mm/yyyy" },
        { key: "finPlan", header: "Fin de plan", width: 12, fmt: "dd/mm/yyyy" },
        { key: "verd", header: "Entrega vs plan", width: 13 },
        { key: "estado", header: "Estado en tablero", width: 16 },
        { key: "woEstado", header: "Estado orden", width: 12 },
      ];
      const wsOrd = makeSheet("Órdenes", ordCols);
      const O = (k) => col(wsOrd, k);

      // ================= Hoja 3: Detalle diario =================
      const dayCols = [
        { key: "fecha", header: "Fecha", width: 12, fmt: "dd/mm/yyyy" },
        { key: "dia", header: "Día", width: 6 },
        { key: "sem", header: "Semana", width: 9 },
        { key: "linea", header: "Línea", width: 8 },
        { key: "ot", header: "OT", width: 12 },
        { key: "color", header: "Color", width: 14 },
        { key: "tipo", header: "Tipo", width: 13 },
        { key: "estilo", header: "Estilo", width: 16 },
        { key: "cliente", header: "Cliente", width: 20 },
        { key: "po", header: "PO cliente", width: 16 },
        { key: "qty", header: "Pzas asignadas", width: 12, fmt: "#,##0" },
        { key: "capDia", header: "Capacidad línea/día", width: 12, fmt: "#,##0" },
        { key: "estado", header: "Estado", width: 16 },
      ];
      const wsDay = makeSheet("Detalle diario", dayCols);

      let anyRow = false;
      for (const p of weeks) {
        const wn = `S${weekNum(p)}`;
        const locked = weekLocks[p.key] ? "Bloqueada" : "Abierta";
        const A = liveAssign(p);
        const H = liveHolds(p);
        if (A.length === 0 && H.length === 0) continue;
        anyRow = true;

        // --- Resumen: una fila por línea con algo asignado o con capacidad ---
        const sumStart = wsSum.rowCount + 1;
        lines.forEach((lineNo) => {
          const { total, orders, preQty } = aggFor(lineNo, p.start, p.end);
          const cap = periodCapacity(lineNo, p.start, p.end);
          if (total <= 0 && cap <= 0) return;
          const wkCh = weekChangesOf(lineNo, p);
          // Órdenes día por día, sólo las órdenes (los cambios van en sus columnas):
          //   Lun 28/09: OT · color = pzas, OT · color = pzas
          const dayByDay = (() => {
            const preOf = new Map(orders.map((o) => [o.id, o]));
            const out = [];
            let visual = 0;
            weekDaysOf(p).forEach((d) => {
              const dayOrd = dayOrdersOf(rowsOn(lineNo, d));
              if (!dayOrd.length) return;
              const txt = `${DOW_ES[isoDow(d)]} ${format(new Date(`${d}T00:00:00`), "dd/MM")}: ` + dayOrd
                .map((o) => `${o.label}${o.hold ? " (reserva)" : preOf.get(o.key)?.pre ? " (PRE)" : ""} = ${Math.round(o.qty).toLocaleString()}`)
                .join(", ");
              out.push(txt);
              visual += Math.max(1, Math.ceil(txt.length / 80));
            });
            return { text: out.join("\n"), lines: visual };
          })();
          const r = addRow(wsSum, {
            sem: wn, ini: xlDate(p.start), fin: xlDate(p.end), lock: locked, linea: `L${lineNo}`,
            ops: lineOpsLabel(lineNo),
            cap: Math.round(cap), asig: Math.round(total), pre: Math.round(preQty),
            nord: orders.length,
            cest: wkCh.style,
            ccol: wkCh.color,
            ordsem: orders.slice().sort((a, b) => b.qty - a.qty).map((o) => `${o.no}${o.isHold ? " (reserva)" : o.pre ? " (PRE)" : ""} = ${Math.round(o.qty).toLocaleString()}`).join("\n"),
            ords: dayByDay.text,
          });
          const n = r.number;
          r.getCell("uso").value = { formula: `IF(${C("cap")}${n}>0,MIN(${C("asig")}${n}/${C("cap")}${n},1),"")`, result: cap > 0 ? Math.min(total / cap, 1) : "" };
          r.getCell("libre").value = { formula: `MAX(${C("cap")}${n}-${C("asig")}${n},0)`, result: Math.max(Math.round(cap) - Math.round(total), 0) };
          const excN = cap > 0 ? Math.max(Math.round(total) - Math.round(cap), 0) : 0;
          r.getCell("exc").value = { formula: `IF(${C("cap")}${n}>0,MAX(${C("asig")}${n}-${C("cap")}${n},0),0)`, result: excN };
          if (excN > 0) r.getCell("exc").font = { ...FONT, bold: true, color: { argb: "FFB91C1C" } };
          r.getCell("ords").alignment = { wrapText: true, vertical: "top" };
          r.getCell("ordsem").alignment = { wrapText: true, vertical: "top" };
          r.height = Math.max(15, Math.max(dayByDay.lines, orders.length) * 13 + 4);
          if (wkCh.style > 0) { r.getCell("cest").fill = CHANGE_STYLE_FILL; r.getCell("cest").font = { ...FONT, bold: true, color: { argb: CHANGE_STYLE_ARGB } }; }
          if (wkCh.color > 0) { r.getCell("ccol").fill = CHANGE_COLOR_FILL; r.getCell("ccol").font = { ...FONT, bold: true, color: { argb: CHANGE_COLOR_ARGB } }; }
          if (cap > 0) {
            const u = total / cap;
            const argb = u >= 0.95 ? "FF15803D" : u >= 0.8 ? "FFA16207" : u >= 0.5 ? "FFC2410C" : "FFB91C1C";
            r.getCell("uso").font = { ...FONT, bold: true, color: { argb } };
          }
        });
        const sumEnd = wsSum.rowCount;
        if (sumEnd >= sumStart) {
          const t = addRow(wsSum, { sem: wn, linea: "TOTAL" }, { fill: WEEK_FILL, bold: true });
          ["ops", "cap", "asig", "pre", "libre", "exc", "nord", "cest", "ccol"].forEach((k) => {
            let res = 0;
            for (let i = sumStart; i <= sumEnd; i++) res += Number(wsSum.getRow(i).getCell(k).value?.result ?? wsSum.getRow(i).getCell(k).value) || 0;
            t.getCell(k).value = { formula: `SUM(${C(k)}${sumStart}:${C(k)}${sumEnd})`, result: res };
          });
          const totParts = [];
          weekDaysOf(p).forEach((d) => {
            const q = lines.reduce((acc, ln) => acc + rowsOn(ln, d).reduce((ss, a) => ss + (parseFloat(a.assigned_quantity) || 0), 0), 0);
            if (q > 0) totParts.push(`${DOW_ES[isoDow(d)]} ${Math.round(q).toLocaleString()}`);
          });
          if (totParts.length) {
            t.getCell("ords").value = totParts.join(" · ");
            t.getCell("ords").alignment = { wrapText: true, vertical: "top" };
          }
          const tn = t.number;
          const capT = Number(t.getCell("cap").value.result) || 0;
          t.getCell("uso").value = { formula: `IF(${C("cap")}${tn}>0,MIN(${C("asig")}${tn}/${C("cap")}${tn},1),"")`, result: capT > 0 ? Math.min((Number(t.getCell("asig").value.result) || 0) / capT, 1) : "" };
        }

        // --- Órdenes: línea × orden/color ---
        const groups = new Map(); // `${line}|${key}` -> { lineNo, rows: [] }
        [...A, ...H].forEach((a) => {
          const k = a.is_hold ? `hold:${keyOf(a.pre_order_id, a.color)}` : keyOf(a.work_order_id, a.color);
          const gk = `${a.line_no}|${k}`;
          const g = groups.get(gk) || { lineNo: a.line_no, key: k, rows: [] };
          g.rows.push(a);
          groups.set(gk, g);
        });
        const lineRank = new Map(lines.map((l, i) => [String(l), i]));
        const ordered = [...groups.values()].sort((x, y) =>
          (lineRank.get(String(x.lineNo)) ?? 9999) - (lineRank.get(String(y.lineNo)) ?? 9999) ||
          ymd(x.rows[0].assigned_date).localeCompare(ymd(y.rows[0].assigned_date))
        );
        const ordStart = wsOrd.rowCount + 1;
        ordered.forEach((g) => {
          const a0 = g.rows[0];
          const days = [...new Set(g.rows.map((r) => ymd(r.assigned_date)))].sort();
          const qty = g.rows.reduce((s, r) => s + (parseFloat(r.assigned_quantity) || 0), 0);
          const diasTxt = days.map((d) => { const dt = new Date(`${d}T00:00:00`); return `${DIA_ES[dt.getDay()]} ${format(dt, "dd/MM")}`; }).join(", ");
          const estados = [...new Set(g.rows.map((r) => STATUS_ES[r.status] || r.status || "Planeada"))].join(", ");

          if (a0.is_hold) {
            const r = addRow(wsOrd, {
              sem: wn, linea: `L${g.lineNo}`, ot: a0.work_order_no, color: a0.color || "", tipo: "Reserva PRE",
              estilo: a0.estilo || a0.style_code || "", cliente: a0.customer_name || "",
              dias: diasTxt, d1: xlDate(days[0]), d2: xlDate(days[days.length - 1]), qty: Math.round(qty),
              estado: "Reservada",
            }, { fill: PRE_FILL });
            return r;
          }
          const det = orderDetailFor(a0.work_order_id, a0.color);
          const wo = det.wo;
          const samInfo = merchantSamForOrder(a0.work_order_id, a0.color);
          const sam = samInfo?.sam || 0;
          const pre = isPreOrder(a0.work_order_id, a0.color) || isPreOrder(a0.work_order_no, a0.color);
          const entregaStr = det.entregaLineas.length ? det.entregaLineas[0] : wo.commitment_date || null;
          const finPlan = finPlanByKey.get(g.key) || null;
          let verd = "Sin fecha";
          if (entregaStr && finPlan) verd = finPlan <= ymd(entregaStr) ? "A tiempo" : `Atrasada ${differenceInDays(new Date(`${finPlan}T00:00:00`), new Date(`${ymd(entregaStr)}T00:00:00`))} d`;
          else if (entregaStr) verd = "Sin plan";

          const r = addRow(wsOrd, {
            sem: wn, linea: `L${g.lineNo}`, ot: woNo(a0), color: a0.color || "", tipo: pre ? "PRE-orden" : "Orden",
            estilo: det.estilo, desc: wo.style_description || woStyle(a0) || "", cliente: wo.customer_name || "",
            po: det.po || woPo(a0), dias: diasTxt, d1: xlDate(days[0]), d2: xlDate(days[days.length - 1]),
            qty: Math.round(qty), sam: sam > 0 ? Number(sam.toFixed(2)) : null,
            meta: targetOf(wo) || null, asigTot: assignedOf(wo) || null, prod: producedOf(wo) || null,
            pend: wo.id ? remainingOfWo(wo) : null,
            entrega: xlDate(entregaStr), finPlan: xlDate(finPlan), verd,
            estado: estados, woEstado: STATUS_ES[wo.status] || wo.status || "",
          }, pre ? { fill: PRE_FILL } : {});
          const n = r.number;
          if (sam > 0) r.getCell("min").value = { formula: `${O("qty")}${n}*${O("sam")}${n}`, result: Math.round(qty * sam) };
          if (verd.startsWith("Atrasada")) r.getCell("verd").font = LATE_FONT;
          else if (verd === "A tiempo") r.getCell("verd").font = OK_FONT;
          if (det.entregaLineas.length > 1) {
            r.getCell("entrega").note = `Varias fechas de entrega en los renglones: ${det.entregaLineas.map(fmtDMY).join(", ")}. Se muestra la más próxima.`;
          }
          return r;
        });
        const ordEnd = wsOrd.rowCount;
        if (ordEnd >= ordStart) {
          const t = addRow(wsOrd, { sem: wn, linea: "TOTAL" }, { fill: WEEK_FILL, bold: true });
          ["qty", "min"].forEach((k) => {
            let res = 0;
            for (let i = ordStart; i <= ordEnd; i++) { const v = wsOrd.getRow(i).getCell(k).value; res += Number(v?.result ?? v) || 0; }
            t.getCell(k).value = { formula: `SUM(${O(k)}${ordStart}:${O(k)}${ordEnd})`, result: res };
          });
        }

        // --- Detalle diario ---
        [...A, ...H]
          .slice()
          .sort((x, y) => ymd(x.assigned_date).localeCompare(ymd(y.assigned_date)) ||
            (lineRank.get(String(x.line_no)) ?? 9999) - (lineRank.get(String(y.line_no)) ?? 9999))
          .forEach((a) => {
            const d = ymd(a.assigned_date);
            const dt = new Date(`${d}T00:00:00`);
            const det = a.is_hold ? null : orderDetailFor(a.work_order_id, a.color);
            const pre = !a.is_hold && (isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color));
            addRow(wsDay, {
              fecha: xlDate(d), dia: DIA_ES[dt.getDay()], sem: wn, linea: `L${a.line_no}`,
              ot: a.is_hold ? a.work_order_no : woNo(a), color: a.color || "",
              tipo: a.is_hold ? "Reserva PRE" : pre ? "PRE-orden" : "Orden",
              estilo: a.is_hold ? (a.estilo || a.style_code || "") : det.estilo,
              cliente: a.is_hold ? (a.customer_name || "") : det.wo.customer_name || "",
              po: a.is_hold ? "" : det.po || woPo(a),
              qty: Math.round(parseFloat(a.assigned_quantity) || 0),
              capDia: Math.round(targetForLineOnDate(a.line_no, d)) || null,
              estado: a.is_hold ? "Reservada" : STATUS_ES[a.status] || a.status || "Planeada",
            }, a.is_hold || pre ? { fill: PRE_FILL } : {});
          });
      }

      if (!anyRow) {
        showToast("No hay órdenes asignadas en la(s) semana(s) seleccionada(s).", true);
        return;
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const yr = first.start.slice(0, 4);
      link.href = url;
      link.download = weeks.length === 1
        ? `PlanBoard_Sem${weekNum(first)}_${yr}.xlsx`
        : `PlanBoard_Sem${weekNum(first)}-Sem${weekNum(last)}_${yr}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("📊 Excel generado.");
    } catch (err) {
      console.error("Excel export failed:", err);
      showToast(
        /exceljs/i.test(String(err?.message || ""))
          ? "Falta la librería exceljs. Instálela con: npm install exceljs"
          : `No se pudo exportar: ${err.message}`,
        true
      );
    } finally {
      setExportBusy(false);
    }
  };

  const getDaysRemaining = (assignment) => {
    const end = ymd(assignment.planned_end_date);
    if (!end) return 0;
    const [y, m, d] = end.split("-").map(Number);
    const endLocal = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((endLocal - today) / 86400000);
  };

  // Each work order gets its own stable color (same in the pool and on the grid).
  // Full literal class strings so Tailwind keeps them.
  const isOverdue = (assignment) =>
    assignment.status !== "completed" && getDaysRemaining(assignment) < 0;

  // The assignments endpoint doesn't include work_order_no / style, so resolve
  // them from the already-loaded work-order list.
  const woOf = (id) => workOrders.find((w) => w.id === id);
  const woNo = (a) => a.work_order_no || woOf(a.work_order_id)?.work_order_no || `#${a.work_order_id}`;
  const woStyle = (a) => a.style_description || woOf(a.work_order_id)?.style_description || "";
  const woPo = (a) => a.customer_po || woOf(a.work_order_id)?.customer_po || "";

  // ---- piezas equivalentes de lo ASIGNADO en el tablero ------------------
  // eq/pza = SAM ÷ equivalencia ; se pesa por las piezas REALES asignadas en el
  // piso (assigned_quantity), no por la cantidad total del merchant. Así el eq
  // sigue lo que hay en las líneas y se mueve al arrastrar/partir órdenes.
  // El SAM del estilo viaja con la orden: se toma del plan del merchant (su
  // snapshot) y si no está, del work_order. Devuelve 0 si no hay SAM.
  const eqPerPieceFor = (woId, color) => {
    const eq = Number(equivalence) > 0 ? Number(equivalence) : 10;
    const row = merchantByKey.get(planKey(woId, color));
    let sam = row ? Number(row.sam_minutes) : 0;
    if (!(sam > 0)) sam = Number(woOf(woId)?.sam_minutes) || 0;
    return sam > 0 ? sam / eq : 0;
  };
  // Piezas equivalentes asignadas por día (todas las líneas), espejo de
  // assignedByDay pero pesando cada asignación por su eq/pza.
  const eqByDay = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (["cancelled", "rejected"].includes(a.status)) continue;
      const k = ymd(a.assigned_date);
      if (!k) continue;
      const eqp = eqPerPieceFor(a.work_order_id, a.color);
      if (!(eqp > 0)) continue;
      m.set(k, (m.get(k) || 0) + (parseFloat(a.assigned_quantity) || 0) * eqp);
    }
    // PRE#### holds reserve line-day capacity, so they count in the equivalent
    // load too. Their SAM comes ONLY from the planner's style standard (the same
    // one that sized the hold): the server sends it as h.sam_minutes, and the
    // board's own styleParams map covers an older backend that doesn't.
    const eqF = Number(equivalence) > 0 ? Number(equivalence) : 10;
    for (const h of holds || []) {
      const k = ymd(h.assigned_date);
      if (!k) continue;
      let sam = Number(h.sam_minutes) || 0;
      if (!(sam > 0)) {
        const st = normStyle(h.style_code || h.estilo || "");
        sam = Number(paramsForLine(styleParams, lineParams, st, h.line_no)?.sam_minutes) || 0;
      }
      if (!(sam > 0)) continue;
      m.set(k, (m.get(k) || 0) + (Number(h.quantity) || 0) * (sam / eqF));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, holds, styleParams, lineParams, merchantByKey, equivalence, workOrders]);
  // Piezas equivalentes de una columna [start,end] (un solo día en Diario).
  const columnEq = (startYmd, endYmd) =>
    startYmd === endYmd ? (eqByDay.get(startYmd) || 0) : sumRange(eqByDay, startYmd, endYmd);

  // ---- envío al supermercado ---------------------------------------------
  // Semanas ofrecidas al planner: las que el merchant planeó (poolWeekGroups,
  // que ya incluye las de pre-orden) UNIDAS a las que ya tienen algo en el
  // tablero. Así puede enviar una semana futura vacía de bolsa pero ya
  // programada, y también una semana que sólo trae PRE####.
  const sendableWeeks = useMemo(() => {
    const wk = new Map(); // lunes -> { weekStart, poolPzas, prePzas, preCount, boardPzas, boardCells }
    const touch = (w) => {
      if (!w) return null;
      if (!wk.has(w)) wk.set(w, { weekStart: w, poolPzas: 0, prePzas: 0, preCount: 0, boardPzas: 0, boardCells: 0 });
      return wk.get(w);
    };

    poolWeekGroups.forEach((g) => {
      const e = touch(g.week);
      if (!e) return;
      e.poolPzas += g.totalPzas || 0;
      e.prePzas += g.prePzas || 0;
      e.preCount += g.preCount || 0;
    });

    // Lo ya programado en el tablero, agrupado por el lunes de su día.
    const mondayOfDate = (d) => format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
    assignments.forEach((a) => {
      if (!a.assigned_date || ["cancelled", "rejected"].includes(a.status)) return;
      const e = touch(mondayOfDate(new Date(`${ymd(a.assigned_date)}T00:00:00`)));
      if (!e) return;
      e.boardPzas += parseFloat(a.assigned_quantity) || 0;
      e.boardCells += 1;
    });
    holds.forEach((h) => {
      if (!h.hold_date && !h.assigned_date) return;
      const raw = ymd(h.hold_date || h.assigned_date);
      const e = touch(mondayOfDate(new Date(`${raw}T00:00:00`)));
      if (!e) return;
      e.boardPzas += Number(h.quantity) || 0;
      e.boardCells += 1;
      e.preCount += 1;
    });

    const pubBy = new Map(publications.map((p) => [p.week_start, p]));
    // Horizonte de envío, medido en semanas desde el lunes de HOY.
    const thisMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weeksAhead = (weekStart) =>
      Math.round(
        differenceInDays(new Date(`${weekStart}T00:00:00`), new Date(`${thisMonday}T00:00:00`)) / 7
      );
    return [...wk.values()]
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
      .map((e) => {
        const hasPreOrders = e.preCount > 0 || e.prePzas > 0;
        const ahead = weeksAhead(e.weekStart);
        const tooFar = ahead > SEND_MAX_WEEKS_AHEAD;
        const tooSoon = ahead < SEND_MIN_WEEKS_AHEAD; // semana actual (0) o pasada
        const alreadySent = !!pubBy.get(e.weekStart); // ya tiene publicación activa
        // Una semana con pre-órdenes, fuera del horizonte, o YA enviada no se
        // puede (re)enviar.
        const blocked = hasPreOrders || tooFar || tooSoon || alreadySent;
        const blockReason = hasPreOrders
          ? "Contiene pre-órdenes"
          : ahead < 0
          ? "Semana pasada"
          : ahead === 0
          ? "Semana actual"
          : tooFar
          ? `Fuera de las semanas ${SEND_MIN_WEEKS_AHEAD}–${SEND_MAX_WEEKS_AHEAD}`
          : alreadySent
          ? "Ya enviada"
          : null;
        return {
          ...e,
          hasPreOrders,
          blocked,
          blockReason,
          published: pubBy.get(e.weekStart) || null,
        };
      });
  }, [poolWeekGroups, assignments, holds, publications]);

  // Estado de publicación (para marcar "ya enviada" en el selector).
  const loadPublications = async () => {
    if (readOnly) return;
    try {
      const res = await fetch(`${API_URL}/api/supermarket-plan/weeks`, { headers: authHeaders() });
      const data = await res.json().catch(() => null);
      if (data?.success) setPublications(data.publications || []);
    } catch { /* el selector funciona igual sin el estado previo */ }
  };
  useEffect(() => { loadPublications(); }, [readOnly]);

  const toggleSendWeek = (weekStart) =>
    setSendWeeks((prev) => {
      // No dejamos marcar una semana bloqueada (pre-órdenes o fuera de horizonte).
      const meta = sendableWeeks.find((s) => s.weekStart === weekStart);
      if (meta?.blocked && !prev.has(weekStart)) return prev;
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart); else next.add(weekStart);
      return next;
    });

  // Snapshot de UNA semana, en la forma exacta que PlanBoard consume. Se recorta
  // a los 7 días de la semana; las órdenes y corridas se filtran a lo que esa
  // semana referencia, para no mandar el catálogo completo en cada envío.
  const buildWeekSnapshot = (weekStart) => {
    const start = weekStart;
    const end = format(addDays(new Date(`${weekStart}T00:00:00`), 6), "yyyy-MM-dd");
    const inRange = (d) => { const k = ymd(d); return k >= start && k <= end; };

    const wAssignments = assignments.filter(
      (a) => a.assigned_date && inRange(a.assigned_date) && !["cancelled", "rejected"].includes(a.status)
    );
    const wHolds = holds.filter((h) => {
      const d = h.hold_date || h.assigned_date;
      return d && inRange(d);
    });
    const wRuns = lineRuns.filter((lr) => lr.run_date && inRange(lr.run_date));

    // Órdenes referenciadas por la semana (asignaciones + filas del plan).
    const woIds = new Set(wAssignments.map((a) => String(a.work_order_id)));
    const wPlan = (merchantPlan || []).filter((r) => {
      const rw = typeof r.week_start === "string" ? r.week_start.slice(0, 10) : ymd(r.week_start);
      return rw === weekStart || woIds.has(String(r.work_order_id));
    });
    wPlan.forEach((r) => { if (r.work_order_id != null) woIds.add(String(r.work_order_id)); });

    return {
      assignments: wAssignments,
      holds: wHolds,
      holidays: (holidays || []).filter((h) => !h.date || inRange(h.date)),
      workOrders: (workOrders || []).filter((w) => woIds.has(String(w.id))),
      lineRuns: wRuns,
      plannerLines: plannerLines || [],
      merchantPlan: wPlan,
      equivalence,
      lineOrder,
    };
  };

  const sendToSupermarket = async () => {
    // Filtramos por si quedó marcada una semana que luego se bloqueó (p. ej. le
    // cayó una pre-orden o salió del horizonte de 2 semanas). El servidor
    // también lo rechaza; esto evita el viaje.
    const blockedSet = new Set(sendableWeeks.filter((s) => s.blocked).map((s) => s.weekStart));
    const weeks = [...sendWeeks].filter((w) => !blockedSet.has(w)).sort();
    if (weeks.length === 0) return showToast("Seleccione al menos una semana que se pueda enviar", true);
    setSendBusy(true);
    try {
      const payload = {
        note: sendNote.trim() || null,
        weeks: weeks.map((w) => {
          const meta = sendableWeeks.find((s) => s.weekStart === w);
          return {
            weekStart: w,
            hasPreOrders: !!meta?.hasPreOrders,
            counts: {
              poolPzas: Math.round(meta?.poolPzas || 0),
              prePzas: Math.round(meta?.prePzas || 0),
              boardPzas: Math.round(meta?.boardPzas || 0),
              boardCells: meta?.boardCells || 0,
            },
            snapshot: buildWeekSnapshot(w),
          };
        }),
      };
      const res = await fetch(`${API_URL}/api/supermarket-plan/publish`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        showToast(data.message || "Enviado al supermercado");
        setSendOpen(false);
        setSendWeeks(new Set());
        setSendNote("");
        loadPublications();
      } else {
        showToast(data?.error || "No se pudo enviar al supermercado", true);
      }
    } catch (err) {
      showToast(`Error al enviar: ${err.message}`, true);
    } finally {
      setSendBusy(false);
    }
  };

  const step = (dir) => {
    if (viewMode === "day") return setCurrentDate(addDays(currentDate, dir * 7));
    if (viewMode === "week") return setCurrentDate(addDays(currentDate, dir * 28));
    if (viewMode === "month") return setCurrentDate(addMonths(currentDate, dir * 12)); // whole year
    return setCurrentDate(addMonths(currentDate, dir * 12 * 6)); // year view = 6-year window
  };
  const goPrevious = () => step(-1);
  const goNext = () => step(1);
  const goToday = () => setCurrentDate(new Date());

  // ---- equivalencia editable (paridad con el merchant) -------------------
  // El factor es GLOBAL y vive en las filas del plan (merchant_week_plan), así
  // que "guardarlo" = re-guardar el tablero del merchant con el nuevo factor y
  // sus eq/pza y eq_pieces recalculados — exactamente lo que hace el merchant al
  // cambiarlo. El cambio es inmediato en pantalla (eqByDay usa el factor actual)
  // y se persiste con debounce para no golpear el backend en cada tecla.
  const factorTimer = useRef(null);
  const persistEquivalence = async (factor) => {
    const items = (merchantPlan || []).map((r) => {
      const sam = Number(r.sam_minutes) || 0;
      const cantidad = Number(r.cantidad) || 0;
      const eqPerPiece = sam / (factor || 10);
      return {
        workOrderId: r.work_order_id ?? null,
        preOrderId: r.pre_order_id ?? null,
        color: r.color || "",
        weekStart: typeof r.week_start === "string" ? r.week_start.slice(0, 10) : ymd(r.week_start),
        workOrderNo: r.work_order_no,
        customerName: r.customer_name,
        customerPo: r.customer_po,
        styleCode: r.style_code,
        estilo: r.estilo,
        styleDescription: r.style_description,
        cantidad,
        samMinutes: sam,
        equivalence: factor,
        eqPerPiece,
        eqPieces: cantidad * eqPerPiece,
        sizes: Array.isArray(r.sizes) ? r.sizes : [],
        isPreOrder: !!r.is_pre_order,
      };
    });
    // Sin filas no hay dónde guardar el factor (el GET lo deriva de las filas):
    // se queda local hasta que exista plan. Evita, además, borrar un tablero vacío.
    if (items.length === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/merchant-plan`, {
        method: "PUT", headers: authHeaders(),
        body: JSON.stringify({ items, equivalence: factor }),
      });
      const data = await res.json().catch(() => null);
      if (data && data.success) showToast(`Equivalencia guardada: ${factor}`);
      else showToast("No se pudo guardar la equivalencia", true);
    } catch (err) {
      showToast(`Error al guardar equivalencia: ${err.message}`, true);
    }
  };
  const onChangeEquivalence = (raw) => {
    if (readOnly) return;
    const f = Number(raw);
    const factor = f > 0 ? f : 10;   // igual que el merchant: valor inválido → 10
    setEquivalence(factor);          // recálculo inmediato del eq en pantalla
    if (!merchantOk) return;         // el plan no cargó → solo local, no se persiste
    clearTimeout(factorTimer.current);
    factorTimer.current = setTimeout(() => persistEquivalence(factor), 700);
  };

  // ---- line label helpers (planner standards, not engineering runs) --------
  // The style the line is on "now": its latest block on/before today, else its
  // first upcoming one.
  const lineRefStyle = (lineNo) => {
    const today = format(new Date(), "yyyy-MM-dd");
    const rows = assignments.filter(
      (a) => String(a.line_no) === String(lineNo) && a.assigned_date && !["cancelled", "rejected"].includes(a.status)
    );
    if (!rows.length) return null;
    const past = rows.filter((a) => ymd(a.assigned_date) <= today).sort((a, b) => ymd(b.assigned_date).localeCompare(ymd(a.assigned_date)));
    const pick = past[0] || [...rows].sort((a, b) => ymd(a.assigned_date).localeCompare(ymd(b.assigned_date)))[0];
    const style = styleKeyOfAssignment(pick);
    return { style, params: paramsForLine(styleParams, lineParams, style, lineNo) };
  };
  const lineOpsLabel = (lineNo) =>
    Number(lineRefStyle(lineNo)?.params?.operators_count ?? plannerLineMap[String(lineNo)]?.operators_count ?? 0) || 0;
  const lineTargetLabel = (lineNo) => Math.round(targetForLineOnDate(lineNo, format(new Date(), "yyyy-MM-dd"))) || 0;

  // The MERCHANT SAM for a SPECIFIC assigned order (by work order + color) — NOT by
  // style_code. Two orders can share a style_code with different sam_minutes
  // snapshots, so a by-style `workOrders.find` returns whichever order sits first in
  // the array, not the one on the block. This mirrors eqPerPieceFor: prefer the
  // merchant plan snapshot, then fall back to the order's own work_orders.sam_minutes.
  // Returns null when no merchant SAM is known for that order.
  const merchantSamForOrder = (woId, color) => {
    if (woId == null) return null;
    const mp = merchantByKey.get(planKey(woId, color));
    let sam = mp ? Number(mp.sam_minutes) : 0;
    if (!(sam > 0)) sam = Number(woOf(woId)?.sam_minutes) || 0;
    if (!(sam > 0)) return null;
    return { sam, estilo: String(woOf(woId)?.estilo || "").trim() };
  };

  // The style CODE a single assignment represents. line_runs.style stores the
  // order's tipo+modelo+correlativo (the `style_code`, e.g. "DAMCHA01"), NOT the
  // 6-char `estilo` ("030800"). So we key on style_code so assignments line up
  // with the runs that actually exist.
  const styleCodeOfAssignment = (a) => {
    // Prefer the code carried on the assignment itself. The assignments endpoint
    // returns style_code, so the operators editor still lists a style even when
    // its work order isn't in the currently loaded `workOrders` list (completed,
    // filtered or paginated out). Without this, such a style renders as a block on
    // the board but silently disappears from the per-style operators editor.
    const own = String(a.style_code || "").trim();
    if (own) return own;
    const wo = woOf(a.work_order_id);
    if (wo) {
      // The order's style_code is the tipo+modelo+correlativo used by line_runs.
      const code = String(wo.style_code || "").trim();
      if (code) return code;
      // Legacy fallback only (older orders without a style_code): try estilo.
      const lines = Array.isArray(wo.lines) ? wo.lines : [];
      if (lines.length) {
        const matching = a.color != null
          ? lines.filter((l) => String(l.color || "") === String(a.color || ""))
          : lines;
        const pool = matching.length ? matching : lines;
        const est = String((pool.find((l) => l.estilo) || {}).estilo || "").trim();
        if (est) return est;
      }
      const woEst = String(wo.estilo || "").trim();
      if (woEst) return woEst;
    }
    // Last resort: estilo carried on the assignment itself.
    return String(a.estilo || "").trim();
  };

  // ---- block color grouping by tipo+modelo+correlativo ------------------
  // Blocks are colored by the order's tipo+modelo+correlativo — its `style_code`
  // (e.g. "DAMTSH01"), NOT the individual fabric color — so every assignment that
  // shares a style_code shares ONE color group: all DAMTSH01 the same color, all
  // DAMBOD08 another, all DAMBOD09 another. Orders with no style_code fall back to
  // the per work-order+color key so they still get a stable, distinct color.
  const colorGroupKey = (styleCode, fallbackKey) => {
    const code = String(styleCode || "").trim().toUpperCase();
    return code ? `style:${code}` : (fallbackKey || "");
  };
  // Color-group key for a single assignment/block on the grid.
  const blockGroupKey = (a) =>
    colorGroupKey(styleCodeOfAssignment(a), keyOf(a.work_order_id, a.color));

  const sameStyle = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();

  // ---- style keys (must match the server: style_code, else estilo) --------
  const styleKeyOfAssignment = (a) =>
    normStyle(a?.style_code || woOf(a?.work_order_id)?.style_code || a?.estilo || woOf(a?.work_order_id)?.estilo || "");
  // Cambio en una casilla (línea-día) con 2+ órdenes:
  //   "style" → hay estilos distintos (o el mismo estilo de clientes distintos): cambio de estilo
  //   "color" → mismo estilo y mismo cliente, sólo cambia el color: cambio de color
  //   null    → una sola orden, o todo igual
  const cellChangeOf = (rows) => {
    if (!rows || rows.length < 2) return null;
    const norm = (v) => String(v || "").trim().toUpperCase();
    const styles = new Set(), clients = new Set(), colors = new Set();
    for (const a of rows) {
      const st = styleKeyOfAssignment(a);
      if (st) styles.add(st);
      const cl = norm(a.customer_name || woOf(a.work_order_id)?.customer_name);
      if (cl && cl !== "—") clients.add(cl);
      const co = norm(a.color);
      if (co) colors.add(co);
    }
    if (styles.size > 1 || clients.size > 1) {
      return { kind: "style", text: `Cambio de estilo: ${[...styles].join(" → ") || "estilos distintos"}` };
    }
    if (colors.size > 1) {
      return { kind: "color", text: `Cambio de color${styles.size ? ` (${[...styles][0]})` : ""}: ${[...colors].join(" → ")}` };
    }
    return null;
  };

  const styleKeyOfPO = (po) => {
    const wo = woOf(po?.workOrderId != null ? po.workOrderId : po?.id);
    return normStyle(po?.style_code || wo?.style_code || wo?.estilo || "");
  };

  // line → { byDay: Map(day → { qtyKnown, frac }), sorted: [{ d, cap }] } built
  // from the planned blocks (and pre-order holds) with the planner standards.
  // A block whose style has no standard yet falls back to the rate stored on the
  // assignment when it was planned.
  const styleDayIndex = useMemo(() => {
    const out = new Map();
    const add = (a) => {
      if (a.line_no == null || ["cancelled", "rejected"].includes(a.status)) return;
      const d = ymd(a.assigned_date);
      if (!d) return;
      const qty = parseFloat(a.assigned_quantity) || 0;
      if (!(qty > 0)) return;
      const p = paramsForLine(styleParams, lineParams, styleKeyOfAssignment(a), a.line_no);
      const tgt = (p ? targetOfParams(p) : 0) || Number(a.required_production_rate) || 0;
      if (!(tgt > 0)) return;
      const k = String(a.line_no);
      if (!out.has(k)) out.set(k, { byDay: new Map(), sorted: [] });
      const m = out.get(k).byDay;
      const e = m.get(d) || { qtyKnown: 0, frac: 0 };
      e.qtyKnown += qty;
      e.frac += qty / tgt;
      m.set(d, e);
    };
    assignments.forEach(add);
    holdRows.forEach(add);
    for (const v of out.values()) {
      v.sorted = [...v.byDay.entries()]
        .map(([d, e]) => ({ d, cap: e.qtyKnown / e.frac }))
        .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, holdRows, styleParams, lineParams, workOrders]);

  // Distinct styles on a line-day (blocks + holds), for the per-line editor.
  const stylesOnLineDay = (lineNo, dateStr) => {
    const set = new Set();
    for (const a of [...assignments, ...holdRows]) {
      if (["cancelled", "rejected"].includes(a.status) || !cellMatches(a, lineNo, dateStr)) continue;
      const k = styleKeyOfAssignment(a);
      if (k) set.add(k);
    }
    return [...set];
  };

  // Line label click → the styles on that line (today by default) with their
  // planner standards, each editable.
  const openStyleEditor = (lineNo) => setStyleList({ lineNo: String(lineNo), date: format(new Date(), "yyyy-MM-dd") });

  // Server copy of one style's standards (+ a production-history hint when the
  // planner has none): general `params`, each line's own `lineParams`, the
  // `lines` where the style is planned, and pending efficiency requests.
  // Null if the request fails.
  const fetchStyleInfo = async (key, lineNo = null) => {
    try {
      const qs = lineNo ? `?lineNo=${encodeURIComponent(lineNo)}` : "";
      const r = await fetch(`${API_URL}/api/planner/style-params/${encodeURIComponent(key)}${qs}`, { headers: authHeaders() });
      const d = await r.json();
      return d && d.success ? d : null;
    } catch { return null; }
  };

  // Lines of the board that have the style (blocks or PRE holds from today on).
  // Used when the server is older and doesn't send `lines`.
  const linesWithStyleLocal = (key) => {
    const today = format(new Date(), "yyyy-MM-dd");
    const set = new Set();
    for (const a of [...assignments, ...holdRows]) {
      if (a.line_no == null || ["cancelled", "rejected"].includes(a.status)) continue;
      if ((ymd(a.assigned_date) || "") < today) continue;
      if (styleKeyOfAssignment(a) === key) set.add(String(a.line_no));
    }
    return [...set];
  };

  // Open the single-style form. `onSaved` runs after a successful save (used to
  // resume the drop / move that needed the standard). `lineNo` preselects that
  // line in the form's "Aplicar a" picker (null = general standard).
  const openStyleForm = async (style, { woId = null, color = null, context = "", onSaved = null, saveLabel, info, merchantSam: samHint = null, lineNo = null } = {}) => {
    const key = normStyle(style);
    if (!key) return;
    const ln = lineNo != null && String(lineNo).trim() ? String(lineNo).trim() : null;
    const data = info && (info.lineParams || !ln) ? info : (await fetchStyleInfo(key, ln)) || info || null;
    const existing = data ? data.params : (styleParamsRef.current[key] || null);
    if (data?.params) putStyleParam(key, data.params);
    if (data?.lineParams) replaceLineParamsOfStyle(key, data.lineParams);
    // Each line's own standard for this style: { "4": row }.
    const lineOverrides = {};
    if (data?.lineParams) data.lineParams.forEach((r) => { lineOverrides[String(r.line_no)] = r; });
    else for (const [k, v] of Object.entries(lineParamsRef.current)) if (k.startsWith(`${key}|`)) lineOverrides[k.slice(key.length + 1)] = v;
    // Lines that have the style (planned from today on, or with their own
    // standard). When the style isn't on any line yet, offer every board line
    // so the planner can still set a line standard.
    const styleLines = [...(data?.lines || linesWithStyleLocal(key)), ...Object.keys(lineOverrides)];
    const lineOptions = [...new Set([...(styleLines.length ? styleLines : lines.map(String)), ...(ln ? [ln] : [])])];

    let merchantSam = Number(samHint) > 0 ? Number(samHint) : (woId != null ? merchantSamForOrder(woId, color)?.sam : null);
    if (!merchantSam) {
      const wo = workOrders.find((w) => normStyle(w.style_code || w.estilo) === key && Number(w.sam_minutes) > 0);
      merchantSam = wo ? Number(wo.sam_minutes) : null;
    }
    // Pending efficiency requests by scope: { "": general, "4": line 4 }.
    const pendList = data
      ? (data.pendingEffs || (data.pendingEff ? [data.pendingEff] : []))
      : Object.values(pendingEff).filter((r) => normStyle(r.style_code) === key);
    const pendingEffs = {};
    pendList.forEach((r) => { pendingEffs[r.line_no ? String(r.line_no) : ""] = r; });
    setPendingEff((m) => {
      const n = {};
      for (const [k, v] of Object.entries(m)) if (normStyle(v.style_code) !== key) n[k] = v;
      pendList.forEach((r) => { n[effKey(key, r.line_no)] = r; });
      return n;
    });
    setStyleForm({
      style: key, existing, suggestion: data?.suggestion || null, merchantSam, context, onSaved, saveLabel,
      lineNo: ln, lineOptions, lineOverrides, pendingEffs,
    });
  };

  // Saving a standard re-plans the planned cells (and pre-order holds) of that
  // style from TOMORROW on: a LINE standard on that line only, the GENERAL one on
  // the lines without their own standard; today and the past are never moved.
  // First ask the server what would move and let the planner confirm; then save
  // (the server re-plans in the same transaction).
  // The planner withdraws a pending efficiency request (from the style form).
  const cancelEffRequest = async (req) => {
    if (!req?.id || readOnly) return;
    const where = req.line_no ? ` en la Línea ${req.line_no}` : "";
    if (!window.confirm(`¿Retirar la solicitud de eficiencia ${Math.round(Number(req.requested_efficiency) * 100)}% para ${req.style_code}${where}?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/planner/style-eff-requests/${req.id}/cancel`, { method: "POST", headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudo retirar la solicitud");
      const k = normStyle(req.style_code);
      const scope = req.line_no ? String(req.line_no) : "";
      setPendingEff((m) => { const n = { ...m }; delete n[effKey(k, req.line_no)]; return n; });
      setStyleForm((f) => {
        if (!f || f.style !== k) return f;
        const pe = { ...(f.pendingEffs || {}) };
        delete pe[scope];
        return { ...f, pendingEffs: pe };
      });
      showToast("Solicitud de eficiencia retirada");
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    }
  };

  // A line goes back to the style's general standard (its own is removed) and
  // the server re-plans that line.
  const resetLineStandard = async (line) => {
    const form = styleForm;
    if (!form || readOnly || !line) return;
    if (!window.confirm(`¿La Línea ${line} vuelve a usar el estándar general de ${form.style}? Se re-planea esa línea desde mañana.`)) return;
    setSavingStyle(true);
    try {
      const res = await fetch(`${API_URL}/api/planner/style-params/${encodeURIComponent(form.style)}/lines/${encodeURIComponent(line)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudo quitar el estándar de la línea");
      dropLineParam(lineKey(form.style, line));
      setPendingEff((m) => { const n = { ...m }; delete n[lineKey(form.style, line)]; return n; });
      setStyleForm(null);
      const r = data.recompute;
      const locked = r?.reason === "locked";
      showToast(
        locked
          ? `⚠️ L${line} usa el estándar general de ${form.style}, pero no se re-planeó: toca una semana bloqueada.`
          : `✅ L${line} usa el estándar general de ${form.style}${describeRecompute(r) ? ` · re-planeado: ${describeRecompute(r)}` : ""}`,
        locked
      );
      await fetchData({ silent: true });
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setSavingStyle(false);
    }
  };

  const describeRecompute = (r) => {
    if (!r || !r.recomputed || !r.cellsBefore) return "";
    const lines = (r.lines || []).map((l) => `L${l.line_no}: ${l.daysBefore} → ${l.daysAfter} día(s)`).join(" · ");
    const lost = (r.unplaced || []).reduce((s, u) => s + (Number(u.qty) || 0), 0);
    return `${lines}${lost > 0 ? ` · ${Math.round(lost).toLocaleString()} pzas no caben y regresan a la bolsa` : ""}`;
  };

  // body.lineNo: null = general standard; "4" = Line 4's own standard.
  const saveStyleForm = async (body) => {
    if (!styleForm || readOnly) return;
    const form = styleForm;
    const scopeLine = body?.lineNo ? String(body.lineNo) : null;
    const label = `${form.style}${scopeLine ? ` · L${scopeLine}` : ""}`;
    setSavingStyle(true);
    // 1) Preview the re-plan (nothing is written), then let the planner pick
    //    which lines to re-plan. null = cancelled; [] = save without re-planning.
    let recomputeLines;
    try {
      const pr = await fetch(`${API_URL}/api/planner/style-params/${encodeURIComponent(form.style)}/preview`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const pv = await pr.json();
      const r = pv?.success ? pv.recompute : null;
      if (r?.recomputed && r.cellsBefore > 0) {
        const picked = await askReplanLines(form.style, r, scopeLine);
        if (picked == null) { setSavingStyle(false); return; }
        recomputeLines = picked;
      }
    } catch { /* preview is advisory; the save below still re-plans */ }

    // 2) Save + re-plan.
    let saved = null;
    let recompute = null;
    let effRequest = null;
    try {
      const res = await fetch(`${API_URL}/api/planner/style-params/${encodeURIComponent(form.style)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(recomputeLines ? { ...body, recomputeLines } : body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudo guardar el estándar");
      saved = data.params;
      recompute = data.recompute || null;
      effRequest = data.effRequest || null;
      if (scopeLine) putLineParam(lineKey(form.style, scopeLine), saved);
      else putStyleParam(form.style, saved);
      if (effRequest) setPendingEff((m) => ({ ...m, [effKey(form.style, effRequest.line_no)]: effRequest }));
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setSavingStyle(false);
    }
    if (!saved) return;
    setStyleForm(null);
    const moved = describeRecompute(recompute);
    if (recompute?.reason === "locked") {
      showToast(`⚠️ ${label} guardado, pero no se re-planeó: toca una semana bloqueada. ${recompute.error || ""}`, true);
    } else {
      const effMsg = effRequest
        ? ` · 🛡️ eficiencia ${Math.round(Number(effRequest.requested_efficiency) * 100)}% enviada al CEO (se sigue usando ${Math.round(Number(saved.efficiency) * 100)}% hasta su aprobación)`
        : "";
      showToast(`✅ ${label}: ${Math.round(targetOfParams(saved)).toLocaleString()} pzas/día${moved ? ` · re-planeado: ${moved}` : ""}${effMsg}`);
    }
    if (recompute?.recomputed && recompute.cellsBefore > 0) await fetchData({ silent: true });
    if (form.onSaved) await form.onSaved(saved);
    else if (!(recompute?.recomputed && recompute.cellsBefore > 0)) fetchData({ silent: true });
  };

  // Gate before planning work of a style. Returns true to continue right away;
  // false when the form was opened instead (it resumes through `retry`).
  //   known style + review OFF → continue with the stored standard
  //   known style + review ON  → show it to confirm / adjust
  //   new style                → the planner must enter SAM, operators, hours, efficiency
  const ensureStyleReady = async (style, { woId, color, context, retry, merchantSam, lineNo = null }) => {
    const key = normStyle(style);
    if (!key) {
      showToast("La orden no tiene estilo (style_code); no se puede calcular su capacidad.", true);
      return false;
    }
    const review = reviewOnDrop && canEditStyles;
    if (styleParamsRef.current[key] && !review) return true;
    const info = await fetchStyleInfo(key); // another planner may have added it meanwhile
    if (info?.params && !review) { putStyleParam(key, info.params); return true; }
    if (!info?.params && !canEditStyles) {
      showToast(`El estilo ${key} no tiene estándar de planeación. Solicite al planeador que lo capture.`, true);
      return false;
    }
    await openStyleForm(key, {
      woId, color, context, info, merchantSam, lineNo,
      onSaved: retry,
      saveLabel: info?.params ? "Confirmar y asignar" : "Guardar y asignar",
    });
    return false;
  };

  // Server said a style lacks a standard (409 STYLE_PARAMS_REQUIRED) → open the
  // form and retry the same action once it is saved. Returns true if handled.
  const handleMissingStyle = (data, retry, context) => {
    if (data?.code !== "STYLE_PARAMS_REQUIRED") return false;
    if (!canEditStyles) {
      showToast(`${data.error} Solicite al planeador que lo capture.`, true);
      return true;
    }
    openStyleForm(data.style, { context, onSaved: retry, saveLabel: retry ? "Guardar y continuar" : "Guardar" });
    return true;
  };

  // Free pieces per day for ONE style on ONE line over [from, to], from the
  // planner standards (server: /api/planning/style-capacity).
  const fetchStyleCapacity = async (lineNo, style, from, to) => {
    const qs = new URLSearchParams({ lineNo: String(lineNo), style, from, to });
    const res = await fetch(`${API_URL}/api/planning/style-capacity?${qs}`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success) {
      const err = new Error(data.error || "No se pudo calcular la capacidad");
      err.data = data;
      throw err;
    }
    return { target: Number(data.target_pcs) || 0, byDay: new Map((data.days || []).map((d) => [d.date, Number(d.available) || 0])) };
  };

  // backend (same numbers the server validates against — avoids 400s).
  const fetchAvailableForDate = async (dateStr) => {
    const r = await fetch(`${API_URL}/api/planning/available-lines?date=${dateStr}`, { headers: authHeaders() });
    const d = await r.json();
    return d.success ? (d.lines || []) : [];
  };

  // Seed a production line the engineers haven't configured yet, so the
  // planner can assign to it immediately. The server persists a capacity row
  // (source='planner'); the new line then appears on the board and passes the
  // same capacity checks as any engineer-configured line. Engineering can
  // refine it later and their real run takes precedence for the dates it covers.
  const createPlannerLine = async () => {
    const ln = String(addLine?.lineNo ?? "").trim();
    if (!ln) return showToast("Escriba el número de línea.", true);
    if (hasEngineerRun(ln)) {
      return showToast(`La línea ${ln} ya está configurada por ingeniería.`, true);
    }
    setSavingLine(true);
    try {
      const body = { lineNo: ln };
      if (String(addLine.operators).trim() !== "") body.operatorsCount = Number(addLine.operators);
      if (String(addLine.hours).trim() !== "") body.workingHours = Number(addLine.hours);
      if (String(addLine.effPct).trim() !== "") body.efficiency = Number(addLine.effPct);
      if (String(addLine.sam).trim() !== "") body.samMinutes = Number(addLine.sam);
      const res = await fetch(`${API_URL}/api/planning/lines`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudo crear la línea");
      const tgt = Math.round(Number(data.line?.target_pcs) || 0).toLocaleString();
      await fetchData({ silent: true });
      setAddLine(null);
      showToast(`✅ Línea ${ln} agregada (${tgt} pzas/día). Ya puede asignarle órdenes.`);
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setSavingLine(false);
    }
  };

  // In "2 órdenes/día" (split-day) mode each order takes at most HALF the
  // line's daily target on a given day, never exceeding that day's remaining
  // room — leaving space for a second order to share the day. Off → the full
  // remaining capacity, exactly as before.
  const perDayCap = (lineInfo, available) => {
    if (!splitDay) return available;
    const target = Math.floor(Number(lineInfo?.target_pcs) || 0);
    const half = Math.floor(target / 2);
    return half > 0 ? Math.min(available, half) : available;
  };

  // ---- DROP: fill the line day by day, carrying the remainder forward ----
  const assignPOAcrossDays = async (po, lineNo, startDate, opts = {}) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (blockedByWeekLock(startDate)) return;
    clearInsertUndo();
    // A pre-order card places a HOLD, not a real assignment.
    if (po.isPreOrderRow || po.preOrderId != null) return assignHoldAcrossDays(po, lineNo, startDate);
    let remaining = po.remaining != null ? po.remaining : remainingOfWo(po);
    if (remaining <= 0) return showToast("Esta PO ya está totalmente asignada.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""}${po.isPreOrder ? " · PRE-ORDEN" : ""}`;

    // Capacity comes from the planner's standard for this order's STYLE. Known
    // style → use it; new style → the planner enters SAM / operators / hours /
    // efficiency first, and the drop resumes when the form is saved.
    const style = styleKeyOfPO(po);
    const woId = po.workOrderId != null ? po.workOrderId : po.id;
    if (!opts.styleChecked) {
      const ok = await ensureStyleReady(style, {
        woId,
        color: po.color || null,
        context: `${label} → Línea ${lineNo} · ${format(new Date(startDate), "dd/MM")}`,
        retry: () => assignPOAcrossDays(po, lineNo, startDate, { styleChecked: true }),
        lineNo,
      });
      if (!ok) { setDraggedPO(null); setArmedPO(null); setDropTarget(null); return; }
    }

    const totalToAssign = remaining;
    setDropBusy(true);
    let day = new Date(startDate);
    let created = 0, assignedTotal = 0;
    let daysScanned = 0, failures = 0;
    let skippedNoCap = 0, skippedFull = 0;
    const MAX_DAYS = 180;        // scan up to ~6 months (matches the day-view horizon)
    const MAX_FAILURES = 3;      // stop only on real server errors, not skipped days
    const errors = [];

    try {
      // Free pieces per day for THIS style on THIS line, for the whole horizon, in
      // one request (planner standards; other styles on a day use their share).
      let cap;
      try {
        cap = await fetchStyleCapacity(lineNo, style, format(day, "yyyy-MM-dd"), format(addDays(day, MAX_DAYS), "yyyy-MM-dd"));
      } catch (e) {
        if (handleMissingStyle(e.data, () => assignPOAcrossDays(po, lineNo, startDate, { styleChecked: true }), label)) return;
        throw e;
      }

      // ── Phase 1: plan the split, filling each eligible day to its FULL daily
      // capacity before spilling to the next. Every day is packed to the brim and
      // the LAST cell simply carries whatever is left over — even if that is only
      // 1–2 pzs. We intentionally do NOT reshape the tail: keeping the earlier
      // days full (e.g. 466, 466, …) is preferred over a "nicer" last cell.
      const plan = []; // { dateStr, lineNoExact, qty, available }
      while (remaining > 0 && daysScanned < MAX_DAYS) {
        daysScanned++;
        // No production on weekends — skip Sat/Sun (not a failure).
        if (day.getDay() === 0 || day.getDay() === 6) { day = addDays(day, 1); continue; }
        // Días festivos / paros — skip a blocked day for this line (not a failure).
        if (holidayFor(lineNo, day)) { day = addDays(day, 1); continue; }
        if (weekLockOf(day)) { day = addDays(day, 1); continue; } // 🔒 semana bloqueada: se brinca
        const dateStr = format(day, "yyyy-MM-dd");

        // A day may already carry other POs (of any style); `available` is what
        // is left of the day for THIS style, so packing fills that room first.
        if (!cap.byDay.has(dateStr)) { skippedNoCap++; day = addDays(day, 1); continue; }

        const available = Math.floor(cap.byDay.get(dateStr) || 0);
        if (available <= 0) { skippedFull++; day = addDays(day, 1); continue; } // day full → next day

        const room = perDayCap({ target_pcs: cap.target }, available); // split-day: at most half the day
        const qty = Math.min(remaining, room);                          // fill up to the (capped) room
        plan.push({ dateStr, lineNoExact: lineNo, qty, available: room });
        remaining -= qty;
        day = addDays(day, 1);
      }

      // ── Phase 2: write the planned cells. The server stores exactly what each
      // cell sends and re-validates it against that day's remaining capacity.
      // The last cell holds the exact remainder as planned above (no borrow-back).
      for (const cell of plan) {
        if (cell.qty <= 0) continue;
        if (failures >= MAX_FAILURES) break;
        const res = await fetch(`${API_URL}/api/line-assignments`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            workOrderId: po.workOrderId != null ? po.workOrderId : po.id,
            lineNo: cell.lineNoExact,           // exact value the backend expects
            assignedDate: cell.dateStr,
            quantity: cell.qty,
            plannedStartDate: cell.dateStr,
            color: po.color || null,
          }),
        });
        const data = await res.json();
        if (data.success) {
          created++;
          assignedTotal += cell.qty;
        } else {
          failures++;
          errors.push(`${cell.dateStr}: ${data.error || res.status}`);
        }
      }
      remaining = totalToAssign - assignedTotal;

      await fetchData({ silent: true });
      balances.reload({ silent: true });

      // Reason the split couldn't finish, when something is still pending.
      const shortfallReason = errors[0]
        || (created === 0 && skippedNoCap > 0 && skippedFull === 0
              ? `La línea ${lineNo} no tiene capacidad configurada en el horizonte.`
              : "No hay más días con capacidad disponible en el horizonte.");

      if (created > 0 && remaining <= 0) {
        showToast(`✅ ${label}: ${Math.round(assignedTotal).toLocaleString()} pzas repartidas en ${created} celda(s).`);
      } else if (created > 0) {
        showToast(`⚠️ ${label}: asignadas ${Math.round(assignedTotal).toLocaleString()} pzas en ${created} celda(s); faltan ${Math.round(remaining).toLocaleString()}. ${shortfallReason}`, true);
      } else {
        showToast(`No se pudo asignar ${label}. ${shortfallReason}`, true);
      }
    } catch (err) {
      showToast(`Error al asignar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedPO(null);
      setArmedPO(null);
      setDropTarget(null);
    }
  };

  // ---- PRE#### HOLD placement: same day-by-day walk, but writes holds ------
  // A pre-order isn't a PO, so it can't enter line_assignments. Instead we drop
  // holds (line + day + qty) that reserve capacity. We pack into each day's
  // remaining room — which now already accounts for other assignments AND holds
  // on the server — and spill the rest forward, just like a real PO.
  const assignHoldAcrossDays = async (po, lineNo, startDate, opts = {}) => {
    if (blockedByWeekLock(startDate)) return;
    let remaining = po.remaining != null ? po.remaining : (Number(po.cantidad) || 0);
    if (remaining <= 0) return showToast("Esta pre-orden no tiene piezas por reservar.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""} · PRE-ORDEN`;

    // A reservation is sized with the planner's standard for the pre-order's
    // style, same as a real PO (new style → the planner enters it first).
    const style = normStyle(po.style_code || po.estilo || "");
    const retry = () => assignHoldAcrossDays(po, lineNo, startDate, { styleChecked: true });
    if (!opts.styleChecked) {
      const ok = await ensureStyleReady(style, {
        woId: null,
        color: po.color || null,
        merchantSam: po.sam_minutes,
        context: `${label} → Línea ${lineNo} · ${format(new Date(startDate), "dd/MM")}`,
        retry,
        lineNo,
      });
      if (!ok) { setDraggedPO(null); setArmedPO(null); setDropTarget(null); return; }
    }

    const totalToHold = remaining;
    setDropBusy(true);
    let day = new Date(startDate);
    let created = 0, heldTotal = 0, daysScanned = 0, failures = 0;
    let skippedNoCap = 0, skippedFull = 0;
    const MAX_DAYS = 180, MAX_FAILURES = 3;
    const errors = [];

    try {
      let cap;
      try {
        cap = await fetchStyleCapacity(lineNo, style, format(day, "yyyy-MM-dd"), format(addDays(day, MAX_DAYS), "yyyy-MM-dd"));
      } catch (e) {
        if (handleMissingStyle(e.data, retry, label)) return;
        throw e;
      }
      // ── Phase 1: plan the split, filling each eligible day to its full capacity.
      // The last cell carries the exact remainder (even 1–2 pzs); earlier days
      // stay full. Same rule as POs: no tail reshaping.
      const plan = []; // { dateStr, lineNoExact, qty, available }
      while (remaining > 0 && daysScanned < MAX_DAYS) {
        daysScanned++;
        if (day.getDay() === 0 || day.getDay() === 6) { day = addDays(day, 1); continue; }
        if (holidayFor(lineNo, day)) { day = addDays(day, 1); continue; } // día bloqueado
        if (weekLockOf(day)) { day = addDays(day, 1); continue; } // 🔒 semana bloqueada: se brinca
        const dateStr = format(day, "yyyy-MM-dd");

        if (!cap.byDay.has(dateStr)) { skippedNoCap++; day = addDays(day, 1); continue; }

        const available = Math.floor(cap.byDay.get(dateStr) || 0);
        if (available <= 0) { skippedFull++; day = addDays(day, 1); continue; }

        const room = perDayCap({ target_pcs: cap.target }, available); // split-day: at most half the day
        const qty = Math.min(remaining, room);
        plan.push({ dateStr, lineNoExact: lineNo, qty, available: room });
        remaining -= qty;
        day = addDays(day, 1);
      }

      // ── Phase 2: write the planned holds. Last cell = exact remainder (same
      // rule as POs: no borrow-back).
      for (const cell of plan) {
        if (cell.qty <= 0) continue;
        if (failures >= MAX_FAILURES) break;
        const res = await fetch(`${API_URL}/api/pre-order-holds`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            preOrderId: po.preOrderId,
            lineNo: cell.lineNoExact,
            assignedDate: cell.dateStr,
            quantity: cell.qty,
            color: po.color || "",
            preOrderNo: po.work_order_no,
            customerName: po.customer_name,
            styleCode: po.style_code,
            estilo: po.estilo,
          }),
        });
        const data = await res.json();
        if (data.success) {
          created++; heldTotal += cell.qty;
        } else if (data.code === "STYLE_PARAMS_REQUIRED") {
          handleMissingStyle(data, retry, label);
          break;
        } else {
          failures++; errors.push(`${cell.dateStr}: ${data.error || res.status}`);
        }
      }
      remaining = totalToHold - heldTotal;

      await fetchData({ silent: true });

      const shortfallReason = errors[0]
        || (created === 0 && skippedNoCap > 0 && skippedFull === 0
              ? `La línea ${lineNo} no tiene capacidad configurada en el horizonte.`
              : "No hay más días con capacidad disponible en el horizonte.");

      if (created > 0 && remaining <= 0) {
        showToast(`✅ ${label}: ${Math.round(heldTotal).toLocaleString()} pzas reservadas en ${created} celda(s).`);
      } else if (created > 0) {
        showToast(`⚠️ ${label}: reservadas ${Math.round(heldTotal).toLocaleString()} pzas en ${created} celda(s); faltan ${Math.round(remaining).toLocaleString()}. ${shortfallReason}`, true);
      } else {
        showToast(`No se pudo reservar ${label}. ${shortfallReason}`, true);
      }
    } catch (err) {
      showToast(`Error al reservar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedPO(null);
      setArmedPO(null);
      setDropTarget(null);
    }
  };

  // Remove a single pre-order hold cell.
  const removeHold = async (a) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (readOnly) return;
    if (!a?.holdId || dropBusy) return;
    if (blockedByWeekLock(a.assigned_date)) return;
    if (!window.confirm(`¿Quitar la reserva de ${a.work_order_no} en L${a.line_no} · ${ymd(a.assigned_date)}?`)) return;
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/pre-order-holds?id=${encodeURIComponent(a.holdId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        showToast(`Reserva de ${a.work_order_no} quitada.`);
      } else {
        showToast(data.error || "No se pudo quitar la reserva", true);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };

  // ---- REASSIGN placement: INSERT the leftover, then RIPPLE the line ---------
  // The leftover is placed as whole cell(s) starting on the next working day, and
  // the orders sitting on those slots are pushed forward — but only as far as the
  // FIRST gap: we shift the contiguous run of occupied days at the front forward
  // by S working days (S = how many cells the leftover needs) and let the first S
  // empty days absorb the push. Orders that already have a gap in front of them
  // don't move. Example: leftover → 27; the run 27–30 slides to 28–31 (the empty
  // 31 absorbs it); a purple order after an existing gap stays put.
  //
  // All of this uses only existing endpoints (POST /line-assignments and
  // PATCH /:id/move), so no backend change is required. The trade-off is that the
  // shift runs as a sequence of moves rather than one atomic transaction.
  const insertBalanceWithRipple = async (po, lineNo, startDate) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (blockedByWeekLock(startDate)) return;
    clearInsertUndo();
    const total = po.remaining != null ? po.remaining : remainingOfWo(po);
    if (total <= 0) return showToast("Esta PO ya está totalmente asignada.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""}`;
    const woId = po.workOrderId != null ? po.workOrderId : po.id;
    const color = po.color || null;

    setDropBusy(true);
    const MAX_DAYS = 180;
    const ymdStr = (d) => format(d, "yyyy-MM-dd");
    // 🔒 Locked weeks are skipped like weekends: the leftover never lands there,
    // the ripple jumps over them, and their cells are never pushed (they are
    // left out of `occ` below), so a locked week is never touched.
    const isWknd = (d) => d.getDay() === 0 || d.getDay() === 6 || !!weekLockOf(d);
    const nextWD = (d) => { let x = addDays(d, 1); while (isWknd(x)) x = addDays(x, 1); return x; };
    const firstWD = (d) => { let x = new Date(d); while (isWknd(x)) x = addDays(x, 1); return x; };
    const plusWD = (dstr, n) => { let d = new Date(`${dstr}T00:00:00`); for (let i = 0; i < n; i++) d = nextWD(d); return ymdStr(d); };

    try {
      // 0) Fresh occupancy for this line (settle-day already ran, so component
      //    state is stale). Build a working-day → cells map from the server.
      const snap = await fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() })
        .then((r) => r.json()).catch(() => null);
      const lineCells = ((snap && snap.success ? snap.assignments : []) || []).filter(
        (a) => String(a.line_no) === String(lineNo) && !["cancelled", "rejected"].includes(a.status)
      );
      const occ = new Map(); // 'yyyy-mm-dd' -> [cells]
      for (const a of lineCells) {
        const k = ymd(a.assigned_date);
        if (!k) continue;
        if (weekLockOf(k)) continue; // 🔒 pinned: never pushed
        if (!occ.has(k)) occ.set(k, []);
        occ.get(k).push(a);
      }
      const isEmptyDay = (dstr) => !(occ.get(dstr) && occ.get(dstr).length);

      // 1) Size the leftover into whole-day cells, capped at each start day's
      //    capacity. This tells us S (how many front slots we must free).
      const startWD = firstWD(new Date(startDate));
      // Whole-day capacity = the planner's pieces/day for this order's style.
      const rippleTarget = Math.floor(styleTargetOf(styleKeyOfPO(po), lineNo) || 0);
      if (rippleTarget <= 0) {
        showToast(`No se pudo reasignar ${label}: su estilo no tiene estándar de planeación.`, true);
        return;
      }
      const capOfDay = async (dstr) => (holidayFor(lineNo, dstr) ? 0 : rippleTarget);
      const chunks = []; // { dstr, qty }
      {
        let rem = total, day = new Date(startWD), scanned = 0;
        while (rem > 0 && scanned < MAX_DAYS) {
          scanned++;
          const dstr = ymdStr(day);
          const cap = await capOfDay(dstr);
          if (cap <= 0) { day = nextWD(day); continue; }
          const qty = Math.min(rem, cap);
          chunks.push({ dstr, qty });
          rem -= qty;
          day = nextWD(day);
        }
        if (rem > 0) {
          showToast(`No se pudo reasignar ${label}: la línea ${lineNo} no tiene capacidad en el horizonte.`, true);
          return;
        }
      }
      const S = chunks.length;

      // 2) Find the cells to push: scan working days from the front, collecting
      //    occupied cells until S empty days have been seen (the first gap that
      //    absorbs the push). Cells beyond that gap are left alone.
      const affected = [];
      {
        let freed = 0, day = new Date(startWD), scanned = 0;
        while (freed < S && scanned < MAX_DAYS) {
          scanned++;
          const dstr = ymdStr(day);
          if (isEmptyDay(dstr)) freed++;
          else affected.push(...occ.get(dstr).map((a) => ({ id: a.id, from: dstr })));
          day = nextWD(day);
        }
      }

      // 3) Execute the shift FAR-FIRST (latest day first) so every target lands on
      //    an already-free day and nothing is overwritten.
      affected.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : b.id - a.id));
      let shifted = 0;
      const moveErrors = [];
      for (const cell of affected) {
        const target = plusWD(cell.from, S);
        const res = await fetch(`${API_URL}/api/line-assignments/${cell.id}/move`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ lineNo, assignedDate: target }),
        });
        const d = await res.json().catch(() => ({}));
        if (d.success) shifted++;
        else moveErrors.push(d.error || `HTTP ${res.status}`);
      }

      // 4) Place the leftover as whole cells on the now-free front slots.
      let created = 0, assignedTotal = 0;
      const putErrors = [];
      for (const c of chunks) {
        const res = await fetch(`${API_URL}/api/line-assignments`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            workOrderId: woId,
            lineNo,
            assignedDate: c.dstr,
            quantity: c.qty,
            plannedStartDate: c.dstr,
            color,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (d.success) { created++; assignedTotal += c.qty; }
        else putErrors.push(d.error || `HTTP ${res.status}`);
      }

      await fetchData({ silent: true });
      balances.reload({ silent: true });

      if (created === S && putErrors.length === 0 && moveErrors.length === 0) {
        showToast(
          `✅ ${label}: ${Math.round(assignedTotal).toLocaleString()} pzas reasignadas en ${created} celda(s)` +
            (shifted > 0 ? ` · ${shifted} orden(es) recorrida(s)` : "") + "."
        );
      } else if (created > 0) {
        showToast(
          `⚠️ ${label}: reasignación parcial (${created}/${S} celda(s)${shifted ? `, ${shifted} recorrida(s)` : ""}). ` +
            `${(putErrors[0] || moveErrors[0] || "")} Revise la línea ${lineNo}.`,
          true
        );
      } else {
        showToast(`No se pudo reasignar ${label}. ${putErrors[0] || moveErrors[0] || ""}`.trim(), true);
      }
    } catch (err) {
      showToast(`Error al reasignar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedPO(null);
      setArmedPO(null);
      setDropTarget(null);
    }
  };

  // ---- Reasignar el saldo de un dia que cerro incompleto ----------------
  //
  // Dos pasos, en este orden:
  //   1. settle-day  baja la celda vieja a las piezas que SI se cosieron
  //   2. la asignacion normal coloca el saldo a partir de manana
  //
  // Al reves la orden queda contada dos veces (lo que se planeo y no se hizo,
  // mas lo que se acaba de reasignar) y como el pool se llena con
  // total - assigned_quantity, la orden se veria totalmente asignada justo
  // cuando todavia le faltan piezas.
  // eslint-disable-next-line no-unused-vars
  const reassignBalance = async (row) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (blockedByWeekLock(row?.assigned_date)) return;
    const dia = `${row.assigned_date.slice(8)}/${row.assigned_date.slice(5, 7)}`;
    const label = `${row.work_order_no} · L${row.line_no} · ${dia}`;

    // Corrida capturada pero sin ligar a la orden: las piezas casi siempre ya
    // existen y el saldo es un espejismo. Reasignar aqui duplica el trabajo.
    if (!row.run_linked && row.runs_on_day > 0) {
      const seguir = window.confirm(
        `La Línea ${row.line_no} sí capturó producción el ${dia}, pero la corrida no quedó ligada a ${row.work_order_no}.\n\n` +
          `Es probable que estas ${Math.round(row.balance).toLocaleString()} pzas ya estén hechas y sólo falte corregir la captura.\n\n` +
          `¿Reasignarlas de todas formas?`
      );
      if (!seguir) return;
    }

    // The leftover is re-planned with the planner's standard for its style.
    const rbStyle = styleKeyOfPO({ workOrderId: row.work_order_id });
    if (!styleParamsRef.current[rbStyle]) {
      const ok = await ensureStyleReady(rbStyle, {
        woId: row.work_order_id,
        color: (row.colors && row.colors[0]) || null,
        context: `Reasignar saldo ${label}`,
        retry: () => reassignBalance(row),
        force: false,
      });
      if (!ok) return;
    }

    setDropBusy(true);
    let saldo = 0;
    let color = null;
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/settle-day`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workOrderId: row.work_order_id,
          lineNo: row.line_no,
          date: row.assigned_date,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || "No se pudo cerrar el día", true);
        return;
      }
      if (!data.balance || data.balance <= 0) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        showToast(`${label}: el día ya estaba completo.`);
        return;
      }
      saldo = data.balance;
      color = (data.colors && data.colors[0]) || row.colors[0] || null;
    } catch (err) {
      showToast(`Error al cerrar el día: ${err.message}`, true);
      return;
    } finally {
      setDropBusy(false);
    }

    // insertBalanceWithRipple maneja su propio dropBusy y su propio fetchData, por
    // eso el finally de arriba ya lo solto. Inserta el saldo como celda(s)
    // completa(s) empezando manana y recorre las ordenes siguientes de la linea
    // hacia adelante hasta el primer hueco (sin rebanadas parciales).
    await insertBalanceWithRipple(
      {
        workOrderId: row.work_order_id,
        work_order_no: row.work_order_no,
        color,
        remaining: saldo,
      },
      row.line_no,
      addDays(new Date(), 1)
    );
    balances.reload({ silent: true });
  };

  // No production on weekends: Sat/Sun are never valid assignment targets.
  const isWeekend = (date) => { const d = date.getDay(); return d === 0 || d === 6; };

  // Días festivos / paros: a day (optionally a single line) marked non-working in
  // the "Días festivos" tab. A plant-wide row (line_no == null) blocks every line;
  // a line-specific row blocks only that line. The board paints these cells and
  // refuses drops on them, mirroring the weekend rule.
  const holidayIndex = useMemo(() => {
    const plant = new Map();   // "yyyy-mm-dd" -> row (whole plant off)
    const perLine = new Map(); // "line|yyyy-mm-dd" -> row (one line off)
    for (const h of holidays) {
      const d = ymd(h.holiday_date);
      if (!d) continue;
      if (h.line_no == null || h.line_no === "" || h.line_no === "*") plant.set(d, h);
      else perLine.set(`${String(h.line_no).trim().replace(/^L/i, "")}|${d}`, h); // "L8" y "8" son la misma línea
    }
    return { plant, perLine };
  }, [holidays]);

  // The blocking row for a line/day, or null. Plant-wide wins over line-specific.
  const holidayFor = (lineNo, date) => {
    const d = typeof date === "string" ? ymd(date) : format(date, "yyyy-MM-dd");
    return holidayIndex.plant.get(d) || holidayIndex.perLine.get(`${String(lineNo).trim().replace(/^L/i, "")}|${d}`) || null;
  };

  const holidayMsg = (hol, date) => {
    const d = typeof date === "string" ? ymd(date) : format(date, "yyyy-MM-dd");
    const why = hol?.name ? ` (${hol.name})` : "";
    return hol?.line_no
      ? `La Línea ${hol.line_no} está bloqueada el ${d}${why}. Elija otro día.`
      : `${d} es día no laborable${why}. Elija un día hábil.`;
  };

  // ---- RESALTADO DE ENTREGA mientras se arrastra / se tiene lista una orden ----
  // Para la orden activa (drag o tap) se simula, por cada línea y cada día de
  // inicio, el MISMO reparto que hace el drop: se llena cada día hábil con lo
  // que le queda libre a la línea para el estilo de la orden (estándar del
  // planeador, ya descontada la carga de otras POs y reservas PRE) y se pasa
  // el resto al siguiente día. Con eso se sabe en qué día TERMINARÍA y se
  // compara contra la fecha de entrega del merchant:
  //   verde → termina a tiempo · rojo → no llega
  //   ⚡    → la línea que termina primero (y su primer día de inicio)
  // Es una proyección local para guiar al planner; al soltar, el servidor
  // sigue validando la capacidad real como siempre.
  const activeDelivery = activePO ? ymd(activePO.delivery_date || activePO.commitment_date) : "";
  const activeStyleKey = activePO
    ? (activePO.isPreOrderRow || activePO.preOrderId != null
        ? normStyle(activePO.style_code || activePO.estilo || "")
        : styleKeyOfPO(activePO))
    : "";
  const fitRangeFirst = dateRange.length ? format(dateRange[0], "yyyy-MM-dd") : "";
  const fitRangeLast = dateRange.length ? format(dateRange[dateRange.length - 1], "yyyy-MM-dd") : "";
  const fitLinesSig = lines.map(String).join("|");
  const deliveryFit = useMemo(() => {
    if (!activePO || viewMode !== "day" || !fitRangeFirst) return null;
    const qty = Math.round(Number(activePO.remaining) || 0);
    const p = styleParamsRef.current[activeStyleKey] || styleParams[activeStyleKey];
    const T = p ? targetOfParams(p) : 0;
    const out = { delivery: activeDelivery || null, style: activeStyleKey, qty, target: T, byLine: new Map(), best: null, noStandard: !(T > 0) };
    if (!(qty > 0) || !(T > 0)) return out;

    const today = format(new Date(), "yyyy-MM-dd");
    // Días hábiles desde el primer día visible hasta 180 días después del
    // último (el mismo horizonte que recorre el drop).
    const days = [];
    let d = new Date(`${fitRangeFirst}T00:00:00`);
    const end = addDays(new Date(`${fitRangeLast}T00:00:00`), 180);
    while (d <= end) {
      const g = d.getDay();
      if (g !== 0 && g !== 6) days.push(format(d, "yyyy-MM-dd"));
      d = addDays(d, 1);
    }
    const lastVisibleIdx = (() => { let i = days.length - 1; while (i >= 0 && days[i] > fitRangeLast) i--; return i; })();

    for (const ln of fitLinesSig ? fitLinesSig.split("|") : []) {
      const idx = styleDayIndex.get(ln);
      // This line's pieces/day for the style (its own standard, else the general).
      const lp = paramsForLine(styleParamsRef.current, lineParamsRef.current, activeStyleKey, ln);
      const TL = (lp ? targetOfParams(lp) : 0) || T;
      const halfL = Math.floor(TL / 2);
      // Piezas libres por día para el estilo de la orden.
      const pre = new Array(days.length + 1);
      pre[0] = 0;
      for (let i = 0; i < days.length; i++) {
        let free = 0;
        if (!holidayFor(ln, days[i]) && !weekLockOf(days[i])) {
          const used = idx?.byDay.get(days[i])?.frac || 0;
          free = Math.floor(TL * Math.max(0, 1 - used) + 1e-6);
          if (splitDay && halfL > 0) free = Math.min(free, halfL);
        }
        pre[i + 1] = pre[i] + free;
      }
      // Día de término al iniciar en i: primer j con Σ libre[i..j] ≥ qty.
      const finishFrom = (i) => {
        if (pre[days.length] - pre[i] < qty) return null; // no termina en el horizonte
        let lo = i, hi = days.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (pre[mid + 1] - pre[i] >= qty) hi = mid; else lo = mid + 1; }
        return days[lo];
      };
      const cells = new Map();
      let firstStart = null;
      for (let i = 0; i <= lastVisibleIdx; i++) {
        const ds = days[i];
        if (ds < today) continue; // no se planea hacia atrás
        const finish = finishFrom(i);
        const ok = activeDelivery ? (finish != null && finish <= activeDelivery) : null;
        const lateDays = activeDelivery && finish && finish > activeDelivery
          ? differenceInDays(new Date(`${finish}T00:00:00`), new Date(`${activeDelivery}T00:00:00`)) : 0;
        const slackDays = activeDelivery && finish && finish <= activeDelivery
          ? differenceInDays(new Date(`${activeDelivery}T00:00:00`), new Date(`${finish}T00:00:00`)) : 0;
        cells.set(ds, { finish, ok, lateDays, slackDays });
        // Primer inicio posible de la línea: día hábil sin festivo ni semana bloqueada.
        if (firstStart == null && !holidayFor(ln, ds) && !weekLockOf(new Date(`${ds}T00:00:00`))) firstStart = ds;
      }
      const first = firstStart ? cells.get(firstStart) : null;
      const summary = { start: firstStart, finish: first?.finish || null, ok: first ? first.ok : null, lateDays: first?.lateDays || 0, slackDays: first?.slackDays || 0 };
      out.byLine.set(ln, { cells, summary });
      if (summary.finish && (!out.best || summary.finish < out.best.finish)) {
        out.best = { line: ln, start: firstStart, finish: summary.finish, ok: summary.ok };
      }
    }
    // Si NINGUNA opción llega (p. ej. la entrega ya pasó), todo sería rojo y no
    // ayuda a decidir: se marcan en ámbar las casillas menos tardías.
    out.noneOnTime = !!out.delivery && !!out.best && out.best.ok === false;
    out.deliveryPast = !!out.delivery && out.delivery < today;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePO?.key, activePO?.remaining, activeDelivery, activeStyleKey, viewMode, fitRangeFirst, fitRangeLast,
      fitLinesSig, styleDayIndex, styleParams, lineParams, splitDay, holidayIndex, weekLocks]);

  // ---- ENTREGA de las órdenes YA asignadas -----------------------------
  // Por orden + color (o por pre-orden en las reservas PRE): el último día que
  // tiene en el tablero (en cualquier línea) contra su fecha de entrega.
  //   ok        → termina a tiempo   · late → termina después de la entrega
  //   pending   → aún tiene piezas en la bolsa (su fin real puede moverse)
  const deliveryKeyOf = (a) => (a.is_hold
    ? `pre:${a.pre_order_id}`
    : `wo:${a.work_order_id}:${String(a.color || "").trim().toUpperCase()}`);
  const pendingPoolKeys = useMemo(() => {
    const set = new Set();
    for (const j of poolJobs) set.add(`wo:${j.workOrderId}:${String(j.color || "").trim().toUpperCase()}`);
    for (const j of preOrderJobs) set.add(`pre:${j.preOrderId}`);
    return set;
  }, [poolJobs, preOrderJobs]);
  const orderDelivery = useMemo(() => {
    const m = new Map();
    const woById = new Map(workOrders.map((w) => [w.id, w]));
    for (const a of [...assignments, ...holdRows]) {
      if (["cancelled", "rejected"].includes(a.status)) continue;
      const d = ymd(a.assigned_date);
      if (!d) continue;
      const k = deliveryKeyOf(a);
      let e = m.get(k);
      if (!e) {
        const delivery = a.is_hold
          ? (a.target_date || preOrderTargets[a.pre_order_id] || null)
          : deliveryOfWoColor(woById.get(a.work_order_id), a.color);
        e = { finish: d, delivery, lines: new Set() };
        m.set(k, e);
      }
      if (d > e.finish) e.finish = d;
      e.lines.add(String(a.line_no));
    }
    for (const [k, e] of m) {
      e.pending = pendingPoolKeys.has(k);
      if (!e.delivery) { e.ok = null; e.lateDays = 0; e.slackDays = 0; continue; }
      const diff = differenceInDays(new Date(`${e.finish}T00:00:00`), new Date(`${e.delivery}T00:00:00`));
      e.ok = diff <= 0;
      e.lateDays = Math.max(diff, 0);
      e.slackDays = Math.max(-diff, 0);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, holdRows, workOrders, preOrderTargets, pendingPoolKeys]);
  const deliveryStatusOf = (a) => orderDelivery.get(deliveryKeyOf(a)) || null;
  // Órdenes atrasadas que tienen al menos un bloque en cada línea.
  const lateCountByLine = useMemo(() => {
    const m = new Map();
    for (const e of orderDelivery.values()) {
      if (e.ok !== false) continue;
      for (const ln of e.lines) m.set(ln, (m.get(ln) || 0) + 1);
    }
    return m;
  }, [orderDelivery]);
  const deliveryText = (e) => {
    if (!e || !e.delivery) return "sin fecha de entrega";
    return `termina ${fmtDMY(e.finish)} · entrega ${fmtDMY(e.delivery)} — ${e.ok
      ? `✅ a tiempo${e.slackDays ? ` (${e.slackDays} d de holgura)` : ""}`
      : `❌ atrasa ${e.lateDays} d`}${e.pending ? " · aún hay piezas sin asignar" : ""}`;
  };

  // ---- Proyección al MOVER un bloque ya asignado -----------------------
  // Un move lleva la casilla completa al día destino, así que la orden
  // terminaría en el más tardío entre ese día y sus otras casillas.
  const moveFit = useMemo(() => {
    const a = draggedAssignment;
    if (!a || viewMode !== "day" || !fitRangeFirst) return null;
    const k = deliveryKeyOf(a);
    const delivery = orderDelivery.get(k)?.delivery || null;
    let otherMax = "";
    for (const x of [...assignments, ...holdRows]) {
      if (x.id === a.id || ["cancelled", "rejected"].includes(x.status) || deliveryKeyOf(x) !== k) continue;
      const d = ymd(x.assigned_date);
      if (d > otherMax) otherMax = d;
    }
    const today = format(new Date(), "yyyy-MM-dd");
    const visible = dateRange.map((dt) => format(dt, "yyyy-MM-dd")).filter((ds) => ds >= today);
    const out = { isMove: true, delivery, qty: Math.round(Number(a.assigned_quantity) || 0), byLine: new Map(), best: null, noneOnTime: false, otherMax, deliveryPast: !!delivery && delivery < today };
    for (const ln of fitLinesSig ? fitLinesSig.split("|") : []) {
      const cells = new Map();
      for (const ds of visible) {
        const finish = otherMax > ds ? otherMax : ds;
        const diff = delivery ? differenceInDays(new Date(`${finish}T00:00:00`), new Date(`${delivery}T00:00:00`)) : 0;
        cells.set(ds, { finish, ok: delivery ? diff <= 0 : null, lateDays: Math.max(diff, 0), slackDays: Math.max(-diff, 0) });
      }
      out.byLine.set(ln, { cells, summary: { start: null } });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedAssignment?.id, viewMode, fitRangeFirst, fitRangeLast, fitLinesSig, orderDelivery, assignments, holdRows]);

  // Lo que pinta el tablero: la orden de la bolsa activa, o el bloque que se mueve.
  const deliveryView = deliveryFit || moveFit;

  const handleDrop = (e, lineNo, date) => {
    e.preventDefault();
    setDropTarget(null);
    if (readOnly) return;   // consulta: el tablero no se toca
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (dropBusy) return;

    if (isWeekend(date)) {
      showToast("No se puede asignar en fin de semana. Elija un día entre semana.", true);
      setDraggedAssignment(null);
      return;
    }

    const hol = holidayFor(lineNo, date);
    if (hol) {
      showToast(holidayMsg(hol, date), true);
      setDraggedAssignment(null);
      return;
    }

    // Semana bloqueada por el CEO: ni como destino ni como origen.
    if (blockedByWeekLock(date, draggedAssignment?.assigned_date)) {
      setDraggedAssignment(null);
      return;
    }

    // Moving an existing block to another line/day.
    if (draggedAssignment) {
      // Pre-order holds live in their own table and stack into capacity, so they
      // relocate via moveHold — no empty cell required, just room (server-checked).
      if (draggedAssignment.is_hold) {
        const sameCell = String(draggedAssignment.line_no) === String(lineNo)
          && ymd(draggedAssignment.assigned_date) === format(date, "yyyy-MM-dd");
        if (sameCell) { setDraggedAssignment(null); return; } // dropped on itself
        moveHold(draggedAssignment, lineNo, date);
        return;
      }
      const sameCell = String(draggedAssignment.line_no) === String(lineNo)
        && ymd(draggedAssignment.assigned_date) === format(date, "yyyy-MM-dd");
      if (sameCell) { setDraggedAssignment(null); return; } // dropped on itself
      // Routing when dropping onto an OCCUPIED day depends on the toggle:
      //   • "2 órdenes/día" ON  -> COMBINE: order1 shares order2's day, taking
      //     the room order2 left and spilling any remainder forward (reports
      //     how much combined vs. spilled).
      //   • toggle OFF          -> INSERT + push this line's tail forward 1 day.
      // Empty day -> plain move (packs into the day, spills remainder forward).
      const occupied = getAssignmentForLineAndDate(lineNo, date);
      if (occupied && splitDay) {
        combineAssignmentOntoDay(draggedAssignment, lineNo, date);
      } else if (occupied) {
        insertShiftMove(draggedAssignment, lineNo, date);
      } else {
        moveAssignment(draggedAssignment, lineNo, date);
      }
      return;
    }

    // Placing a new PO from the pool. A cell may already hold other POs; the
    // walk packs into each day's remaining capacity before spilling forward.
    const po = draggedPO || armedPO;
    if (!po) return;
    assignPOAcrossDays(po, lineNo, date);
  };

  // Relocate one assignment to a new line/day.
  const moveAssignment = async (assignment, lineNo, date) => {
    if (blockedByWeekLock(assignment?.assigned_date, date)) { setDraggedAssignment(null); return; }
    clearInsertUndo();
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/${assignment.id}/move`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ lineNo, assignedDate: format(date, "yyyy-MM-dd") }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        showToast(`✅ ${woNo(assignment)} movida a Línea ${lineNo} · ${format(date, "dd/MM")}`);
      } else if (!handleMissingStyle(data, () => moveAssignment(assignment, lineNo, date), `Mover ${woNo(assignment)} a Línea ${lineNo}`)) {
        showToast(data.error || "No se pudo mover la asignación", true);
      }
    } catch (err) {
      showToast(`Error al mover: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedAssignment(null);
      setDropTarget(null);
    }
  };

  // Insert a moved order onto an OCCUPIED day and push the whole line tail one
  // workday forward. The server does the ripple atomically (all-or-nothing);
  // used instead of a plain move when the drop lands on a day that already has
  // an order.
  const insertShiftMove = async (assignment, lineNo, date) => {
    if (blockedByWeekLock(assignment?.assigned_date, date)) { setDraggedAssignment(null); return; }
    setDropBusy(true);
    try {
      // Routed through the batch endpoint with a single id so the single-drag
      // insert produces the same undo token as the multi-select insert.
      const res = await fetch(`${API_URL}/api/line-assignments/insert-shift-batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ids: [assignment.id], lineNo, assignedDate: format(date, "yyyy-MM-dd") }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        setLastInsertUndo(data.undo || null);
        const shifted = data.shifted || 0;
        showToast(`✅ ${woNo(assignment)} insertada en Línea ${lineNo} · ${format(date, "dd/MM")}${shifted ? ` — ${shifted} orden(es) recorridas 1 día` : ""}`);
      } else {
        showToast(data.error || "No se pudo insertar la orden", true);
      }
    } catch (err) {
      showToast(`Error al insertar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedAssignment(null);
      setDropTarget(null);
    }
  };

  // ---- COMBINE (split-day): drop order1 onto order2 so they SHARE a day ----
  // Uses the same /move endpoint (fit-what's-left, then spill forward), but
  // reports exactly how much landed WITH the occupant on the target day vs. how
  // much spilled to later days — so a combine is visible instead of looking
  // like the order "jumped" to another day. If order2 already fills the day
  // there is no room, and the server carries every piece forward (all-or-
  // nothing within the horizon).
  const combineAssignmentOntoDay = async (assignment, lineNo, date) => {
    if (blockedByWeekLock(assignment?.assigned_date, date)) { setDraggedAssignment(null); return; }
    clearInsertUndo();
    const dropStr = format(date, "yyyy-MM-dd");
    const occupant = getAssignmentForLineAndDate(lineNo, date); // order2, for the label
    const withWho = occupant ? ` con ${woNo(occupant)}` : "";
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/${assignment.id}/move`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ lineNo, assignedDate: dropStr }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        // Split the created cells into "landed on the drop day" vs "spilled".
        const rows = Array.isArray(data.assignments) ? data.assignments : [];
        const onDrop = rows
          .filter((r) => ymd(r.assigned_date) === dropStr)
          .reduce((sum, r) => sum + (parseFloat(r.assigned_quantity) || 0), 0);
        const total = rows.reduce((sum, r) => sum + (parseFloat(r.assigned_quantity) || 0), 0);
        const spilled = Math.max(0, Math.round(total - onDrop));
        const combined = Math.round(onDrop);
        const who = woNo(assignment);
        const day = format(date, "dd/MM");
        if (combined > 0 && spilled > 0) {
          showToast(`✅ ${who}: ${combined.toLocaleString()} pzas combinadas${withWho} el ${day}; ${spilled.toLocaleString()} pzas pasaron a los días siguientes.`);
        } else if (combined > 0) {
          showToast(`✅ ${who}: ${combined.toLocaleString()} pzas combinadas${withWho} el ${day}.`);
        } else {
          showToast(`⚠️ ${who}: el ${day} ya estaba lleno${withWho ? ` (${woNo(occupant)} ocupa todo el día)` : ""}; ${spilled.toLocaleString()} pzas pasaron a los días siguientes.`, true);
        }
      } else if (!handleMissingStyle(data, () => combineAssignmentOntoDay(assignment, lineNo, date), `Combinar ${woNo(assignment)} en Línea ${lineNo}`)) {
        showToast(data.error || "No se pudo combinar la orden", true);
      }
    } catch (err) {
      showToast(`Error al combinar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedAssignment(null);
      setDropTarget(null);
    }
  };

  // Relocate one pre-order hold to a new line/day. Holds live in
  // pre_order_day_holds (create + delete only — no in-place move endpoint), so a
  // move is "reserve at the destination, then release the original," ordered so a
  // failed reservation leaves the original hold untouched.
  const moveHold = async (hold, lineNo, date) => {
    if (blockedByWeekLock(hold?.assigned_date, date)) { setDraggedAssignment(null); return; }
    clearInsertUndo();
    const dateStr = format(date, "yyyy-MM-dd");
    const qty = Math.round(Number(hold.assigned_quantity) || 0);
    if (qty <= 0) { setDraggedAssignment(null); return; }
    setDropBusy(true);
    try {
      // 1) Reserve at the destination first. The holds endpoint rechecks line
      //    capacity, so if the target cell can't fit the full quantity the POST
      //    fails and we keep the original reservation (all-or-nothing move).
      const createRes = await fetch(`${API_URL}/api/pre-order-holds`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          preOrderId: hold.pre_order_id,
          lineNo,
          assignedDate: dateStr,
          quantity: qty,
          color: hold.color || "",
          preOrderNo: hold.work_order_no,
          customerName: hold.customer_name,
          styleCode: hold.style_code,
          estilo: hold.estilo,
        }),
      });
      const createData = await createRes.json();
      if (!createData.success) {
        if (!handleMissingStyle(createData, () => moveHold(hold, lineNo, date), `Mover reserva ${hold.work_order_no}`)) {
          showToast(createData.error || "No hay capacidad en la celda destino para mover la reserva.", true);
        }
        return;
      }
      // 2) Destination reserved — release the original cell.
      const delRes = await fetch(`${API_URL}/api/pre-order-holds?id=${encodeURIComponent(hold.holdId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const delData = await delRes.json().catch(() => ({ success: false }));
      if (delData.success) {
        showToast(`✅ Reserva de ${hold.work_order_no} movida a Línea ${lineNo} · ${format(date, "dd/MM")}`);
      } else {
        // Rare: destination hold created but the original couldn't be cleared, so
        // the reservation now shows in both cells. No pieces lost; the planner
        // removes the leftover manually.
        showToast("⚠️ Reserva creada en el destino, pero no se pudo quitar la original. Quítela manualmente.", true);
      }
      await fetchData({ silent: true });
      balances.reload({ silent: true });
    } catch (err) {
      showToast(`Error al mover la reserva: ${err.message}`, true);
    } finally {
      setDropBusy(false);
      setDraggedAssignment(null);
      setDropTarget(null);
    }
  };

  // ---- multi-cell selection ---------------------------------------------
  useEffect(() => {
    if (!boardLock.locked) return;
    setSelectMode(false); setPickingDest(false); setInsertMode(false); setSelectedIds(new Set());
    setArmedPO(null); setDraggedPO(null); setDraggedAssignment(null); setDropTarget(null);
  }, [boardLock.locked]);
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const byId = new Map([...assignments, ...holdRows].map((x) => [x.id, x]));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        const x = byId.get(id);
        const d = x ? (cellDateOf(x) || ymd(x.assigned_date)) : null;
        if (d && weekLockOf(d)) { changed = true; continue; }
        next.add(id);
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekLocks]);
  const exitSelectMode = () => {
    setSelectMode(false);
    setPickingDest(false);
    setInsertMode(false);
    setSelectedIds(new Set());
    // NOTE: intentionally does NOT touch lastInsertUndo — after an insert we exit
    // select mode but keep the "Deshacer" chip available.
  };
  // Any OTHER board mutation invalidates a pending insert-undo (it only knows how
  // to reverse the last insert against the state it left behind).
  const clearInsertUndo = () => setLastInsertUndo(null);
  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Identity of "the same order" for auto-selection: a real PO is its work
  // order + color; a PRE#### hold is its pre-order + color.
  const sameOrderKey = (a) =>
    a.is_hold ? `pre:${a.pre_order_id}:${a.color || ""}` : `wo:${a.work_order_id}:${a.color || ""}`;
  // Tapping a block in select mode also (de)selects every OTHER cell of the
  // same order on the SAME line from the tapped day FORWARD. Earlier days of
  // that order, past days (before today) and CEO-locked weeks are never
  // touched, so already-produced history stays where it is.
  // A block can only be picked for Mover / Insertar / Eliminar / Enviar when the
  // board is unlocked and its week is not locked by the CEO.
  const selectBlockReason = (a) => {
    if (boardLock.locked) return `🔒 El Plan Board está bloqueado${boardLock.lockedBy ? ` por ${boardLock.lockedBy}` : ""}. No se puede seleccionar.`;
    const d = a ? (cellDateOf(a) || ymd(a.assigned_date)) : null;
    if (d && weekLockOf(d)) return weekLockMsg(d);
    return null;
  };
  const toggleSelectedWithFuture = (a, lineNo, date) => {
    const why = selectBlockReason(a);
    if (why) { showToast(why, true); return; }
    const clickedKey = format(date, "yyyy-MM-dd");
    const today = todayStr();
    const fromKey = clickedKey > today ? clickedKey : today;
    const key = sameOrderKey(a);
    const siblings = [
      ...assignments.filter((x) => !["cancelled", "rejected"].includes(x.status)),
      ...holdRows,
    ].filter((x) => {
      if (x.id === a.id) return false;
      if (String(x.line_no) !== String(lineNo)) return false;
      if (sameOrderKey(x) !== key) return false;
      const k = cellDateOf(x);
      if (!k || k < fromKey) return false;
      if (weekLockOf(k)) return false;
      return true;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const selecting = !next.has(a.id);
      for (const id of [a.id, ...siblings.map((x) => x.id)]) {
        if (selecting) next.add(id); else next.delete(id);
      }
      return next;
    });
  };
  // A selected id is either a real line_assignment id (numeric / numeric string)
  // or a PRE#### hold cell, which is keyed "hold:<id>" so the two never collide
  // in selectedIds. This lets a single selection hold both kinds; each batch
  // action then routes every item to the right backend.
  const isHoldSelId = (id) => typeof id === "string" && id.startsWith("hold:");
  // Move every selected pre-order hold to (lineNo, startDate). Holds live in
  // pre_order_day_holds (create + delete only). The endpoint is ADDITIVE — a
  // POST to the same (pre_order, line, day, color) SUMS the quantity — so we must
  // NOT dump every selected cell onto the clicked day (that collapses N cells
  // into one). Instead we re-pack forward, exactly like a fresh drop: group the
  // selection by (pre-orden + color), free the originals, then walk each group's
  // total across consecutive weekdays from the destination, packing into each
  // day's remaining capacity and spilling to the next.
  const moveHoldsBatch = async (holdSelIds, lineNo, startDate) => {
    const byId = new Map(holdRows.map((h) => [h.id, h]));

    // 1) Group selected reservations by pre-order + color.
    const groups = new Map();
    for (const sid of holdSelIds) {
      const h = byId.get(sid);
      if (!h) continue;
      const qty = Math.round(Number(h.assigned_quantity) || 0);
      if (qty <= 0) continue;
      const key = `${h.pre_order_id}\u0000${(h.color || "").toUpperCase()}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          preOrderId: h.pre_order_id,
          color: h.color || "",
          preOrderNo: h.work_order_no,
          customerName: h.customer_name,
          styleCode: h.style_code,
          estilo: h.estilo,
          total: 0,
          holdIds: [],
        };
        groups.set(key, g);
      }
      g.total += qty;
      if (h.holdId != null) g.holdIds.push(h.holdId);
    }
    if (groups.size === 0) return { moved: 0, failed: [] };

    // 1b) Every reservation must have a planner standard for its style BEFORE we
    //     release anything; otherwise ask for the first missing one and stop
    //     (nothing has been touched yet).
    for (const g of groups.values()) {
      g.style = normStyle(g.styleCode || g.estilo || "");
      if (styleParamsRef.current[g.style]) continue;
      const info = await fetchStyleInfo(g.style);
      if (info?.params) { putStyleParam(g.style, info.params); continue; }
      handleMissingStyle({ code: "STYLE_PARAMS_REQUIRED", style: g.style, error: `El estilo ${g.style || "—"} no tiene estándar de planeación.` }, null, `Mover reservas a Línea ${lineNo}`);
      return { moved: 0, failed: [g.preOrderNo || `PRE ${g.preOrderId}`] };
    }

    // 2) Release the originals FIRST — frees their capacity and prevents the
    //    additive POST from merging the re-packed cells back into them.
    for (const g of groups.values()) {
      for (const hid of g.holdIds) {
        await fetch(`${API_URL}/api/pre-order-holds?id=${encodeURIComponent(hid)}`, {
          method: "DELETE",
          headers: authHeaders(),
        }).catch(() => {});
      }
    }

    // 3) Re-pack each group across days from the destination. Capacity is read
    //    per group (its own style) AFTER the previous groups were written, so a
    //    day already taken by an earlier group is seen as taken.
    const MAX_DAYS = 180, MAX_FAILURES = 3;
    let movedSources = 0;
    const failed = [];

    for (const g of groups.values()) {
      let remaining = g.total;
      let day = new Date(startDate);
      let daysScanned = 0, failures = 0;
      let cap = null;
      try {
        cap = await fetchStyleCapacity(lineNo, g.style, format(day, "yyyy-MM-dd"), format(addDays(day, MAX_DAYS), "yyyy-MM-dd"));
      } catch { cap = null; }
      if (!cap) { failed.push(g.preOrderNo || `PRE ${g.preOrderId}`); continue; }

      while (remaining > 0 && daysScanned < MAX_DAYS && failures < MAX_FAILURES) {
        daysScanned++;
        if (day.getDay() === 0 || day.getDay() === 6) { day = addDays(day, 1); continue; }
        if (holidayFor(lineNo, day)) { day = addDays(day, 1); continue; } // día bloqueado
        if (weekLockOf(day)) { day = addDays(day, 1); continue; } // 🔒 semana bloqueada: se brinca
        const dateStr = format(day, "yyyy-MM-dd");

        const available = Math.floor(cap.byDay.get(dateStr) || 0);
        if (available <= 0) { day = addDays(day, 1); continue; }

        const qty = Math.min(remaining, available);
        try {
          const res = await fetch(`${API_URL}/api/pre-order-holds`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              preOrderId: g.preOrderId,
              lineNo,
              assignedDate: dateStr,
              quantity: qty,
              color: g.color || "",
              preOrderNo: g.preOrderNo,
              customerName: g.customerName,
              styleCode: g.styleCode,
              estilo: g.estilo,
            }),
          });
          const data = await res.json();
          if (data.success) {
            remaining -= qty;
            cap.byDay.set(dateStr, available - qty); // keep this group's view consistent
            day = addDays(day, 1);
          } else {
            failures++; day = addDays(day, 1);
          }
        } catch {
          failures++; day = addDays(day, 1);
        }
      }

      if (remaining <= 0) movedSources += g.holdIds.length; // all original cells relocated
      else failed.push(g.preOrderNo || `PRE ${g.preOrderId}`);
    }

    return { moved: movedSources, failed };
  };
  // Pile every selected block into the target line/day and re-pack forward.
  // Real assignments go through the batch endpoint; PRE#### reservations are
  // re-reserved on the destination day via the holds endpoint.
  const batchMove = async (ids, lineNo, date) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (!ids.length || dropBusy) return;
    if (blockedByWeekLock(date, datesOfIds(ids))) return;
    clearInsertUndo();
    const holdIds = ids.filter(isHoldSelId);
    const assignIds = ids.filter((id) => !isHoldSelId(id));
    setDropBusy(true);
    try {
      let assignMoved = 0;
      let assignError = null;
      if (assignIds.length) {
        const res = await fetch(`${API_URL}/api/line-assignments/move-batch`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ ids: assignIds, lineNo, assignedDate: format(date, "yyyy-MM-dd") }),
        });
        const data = await res.json();
        if (data.success) assignMoved = assignIds.length;
        else if (handleMissingStyle(data, null, `Mover selección a Línea ${lineNo}`)) assignError = data.error;
        else assignError = data.error || "No se pudieron mover las casillas";
      }
      const { moved: holdMoved, failed } = holdIds.length
        ? await moveHoldsBatch(holdIds, lineNo, date)
        : { moved: 0, failed: [] };

      await fetchData({ silent: true });
      balances.reload({ silent: true });

      const totalMoved = assignMoved + holdMoved;
      if (totalMoved > 0) {
        showToast(
          `✅ ${totalMoved} casilla(s) movida(s) a Línea ${lineNo} · ${format(date, "dd/MM")}` +
            (failed.length ? ` · ${failed.length} reserva(s) sin cupo` : "")
        );
        exitSelectMode();
      } else {
        showToast(
          assignError ||
            (failed.length
              ? "No hubo cupo en la celda destino para las reservas."
              : "No se movió ninguna casilla."),
          true
        );
      }
    } catch (err) {
      showToast(`Error al mover: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };
  // Insert every selected ORDER at the target line/day and ripple that line's
  // tail forward — the multi-order version of the single insert-shift. Only real
  // assignments can be inserted (PRE#### reservations live in their own table and
  // stack by capacity, so "insert + ripple" has no meaning for them); if any are
  // selected we stop and point the user at Mover instead.
  const batchInsertShift = async (ids, lineNo, date) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (!ids.length || dropBusy) return;
    if (blockedByWeekLock(date, datesOfIds(ids))) return;
    const holdIds = ids.filter(isHoldSelId);
    const assignIds = ids.filter((id) => !isHoldSelId(id));
    if (holdIds.length) {
      showToast("La inserción no admite reservas PRE. Quítelas de la selección o use Mover.", true);
      return;
    }
    if (!assignIds.length) return;
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/insert-shift-batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ids: assignIds, lineNo, assignedDate: format(date, "yyyy-MM-dd") }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        setLastInsertUndo(data.undo || null);
        const shifted = data.shifted || 0;
        showToast(
          `✅ ${data.inserted} orden(es) insertada(s) en Línea ${lineNo} · ${format(date, "dd/MM")}` +
            (shifted ? ` — ${shifted} orden(es) recorrida(s)` : "")
        );
        exitSelectMode();
      } else {
        showToast(data.error || "No se pudieron insertar las órdenes", true);
      }
    } catch (err) {
      showToast(`Error al insertar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };
  // Reverse the last insert (single or multi) via the snapshot the server handed
  // back. A 409 means the board changed since, so we drop the stale token.
  const undoLastInsert = async () => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (!lastInsertUndo || dropBusy) return;
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/insert-shift-undo`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ undo: lastInsertUndo }),
      });
      const data = await res.json();
      if (data.success) {
        setLastInsertUndo(null);
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        showToast("↩️ Inserción deshecha.");
      } else {
        if (res.status === 409) setLastInsertUndo(null); // stale — hide the chip
        showToast(data.error || "No se pudo deshacer.", true);
      }
    } catch (err) {
      showToast(`Error al deshacer: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };
  const chooseDestination = (lineNo, date) => {
    if (isWeekend(date)) {
      showToast("No se puede mover a un fin de semana. Elija un día entre semana.", true);
      return;
    }
    const hol = holidayFor(lineNo, date);
    if (hol) { showToast(holidayMsg(hol, date), true); return; }
    if (blockedByWeekLock(date)) return;
    if (insertMode) batchInsertShift([...selectedIds], lineNo, date);
    else batchMove([...selectedIds], lineNo, date);
  };
  // Delete ONLY the cells the user checked. Past (locked) cells are dropped and
  // reported; removeAssignments enforces the same lock as a second guard.
  const deleteSelected = async () => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (readOnly) return;
    clearInsertUndo();
    const selObjs = [
      ...assignments.filter((a) => selectedIds.has(a.id)),
      ...holdRows.filter((h) => selectedIds.has(h.id)),
    ];
    if (!selObjs.length || dropBusy) return;
    if (blockedByWeekLock(selObjs.map((a) => a.assigned_date))) return;
    const deletable = selObjs.filter((a) => !isLockedCell(a));
    if (deletable.length === 0) {
      showToast("Las casillas seleccionadas son de días pasados y no se pueden eliminar.", true);
      return;
    }
    const lockedN = selObjs.length - deletable.length;
    if (!window.confirm(`¿Eliminar ${deletable.length} casilla(s) seleccionada(s)?${lockedN > 0 ? ` (${lockedN} de días pasados se conservan)` : ""}`)) return;
    const delHolds = deletable.filter((a) => a.is_hold);   // pre-order reservations
    const delAssigns = deletable.filter((a) => !a.is_hold); // real line_assignments
    setDropBusy(true);
    let removed = 0;
    const errors = [];
    try {
      for (const a of delAssigns) {
        const res = await fetch(`${API_URL}/api/line-assignments/${a.id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) removed += 1;
        else errors.push(data.error || `HTTP ${res.status}`);
      }
      for (const h of delHolds) {
        const res = await fetch(`${API_URL}/api/pre-order-holds?id=${encodeURIComponent(h.holdId)}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) removed += 1;
        else errors.push(data.error || `HTTP ${res.status}`);
      }
      await fetchData({ silent: true });
      balances.reload({ silent: true });
      setSelectedAssignment(null);
      if (removed > 0) showToast(`🗑️ ${removed} casilla(s) eliminada(s).${lockedN > 0 ? ` (${lockedN} de días pasados protegida(s))` : ""}`);
      else showToast(`No se pudo eliminar. ${errors[0] || ""}`, true);
      exitSelectMode();
    } catch (err) {
      showToast(`Error al eliminar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };

  // ---- confirm to line leaders ------------------------------------------
  // Push the given assignment cells to the line leaders. This is what actually
  // creates the draft run on their side. Nothing is drafted while the planner is
  // just assigning/moving orders around — only on this explicit confirm — so a
  // work order dragged from one day to another no longer leaves stale drafts.
  const confirmAssignments = async (ids) => {
    // NOTE: line_assignments.id is BIGSERIAL, and node-postgres returns int8 as
    // a STRING, so ids arrive here as "868", not 868. Parse first — testing
    // Number.isInteger() on the raw value dropped every id and returned before
    // the fetch, with no toast and no request.
    const list = [...new Set(
      (ids || []).map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n))
    )];
    if (list.length === 0) {
      showToast("No hay casillas válidas para enviar a los líderes de línea.", true);
      return false;
    }
    if (dropBusy) return false;
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/confirm`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ids: list }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        const created = data.created ?? 0;
        const already = data.alreadyPresent ?? 0;
        showToast(
          `✅ Enviado a líderes de línea: ${created} nueva(s)` +
            (already > 0 ? `, ${already} ya estaba(n)` : "")
        );
        return true;
      }
      showToast(data.error || "No se pudo enviar a los líderes de línea", true);
      return false;
    } catch (err) {
      showToast(`Error al enviar: ${err.message}`, true);
      return false;
    } finally {
      setDropBusy(false);
    }
  };

  // Confirm every currently selected cell (multi-select toolbar action).
  const confirmSelected = async () => {
    if (selectedIds.size === 0 || dropBusy) return;
    clearInsertUndo();
    // A PRE#### reservation has nothing to produce yet, so it never goes to the
    // line leaders — only the real assignments in the selection are sent.
    const assignIds = [...selectedIds].filter((id) => !isHoldSelId(id));
    const holdN = selectedIds.size - assignIds.length;
    if (assignIds.length === 0) {
      showToast("Las reservas de pre-orden no se envían a líderes: todavía no hay nada que producir.", true);
      return;
    }
    const note = holdN > 0 ? ` (${holdN} reserva(s) de pre-orden se omitirán)` : "";
    if (!window.confirm(`¿Enviar ${assignIds.length} casilla(s) a los líderes de línea?${note}`)) return;
    const ok = await confirmAssignments(assignIds);
    if (ok) exitSelectMode();
  };

  // Tap a cell: in select mode it either destination-picks; while armed it packs
  // a pool PO here; otherwise individual blocks open their own detail on click.
  const handleCellClick = (lineNo, date) => {
    if (readOnly) return;   // consulta: el tablero no se toca
    if (selectMode) {
      if (pickingDest) chooseDestination(lineNo, date); // chooseDestination guards weekends
      return; // selecting phase: empty cells do nothing
    }
    if (armedPO && !dropBusy) {
      if (isWeekend(date)) {
        showToast("No se puede asignar en fin de semana. Elija un día entre semana.", true);
        return;
      }
      const hol = holidayFor(lineNo, date);
      if (hol) { showToast(holidayMsg(hol, date), true); return; }
      assignPOAcrossDays(armedPO, lineNo, date);
    }
  };

  // Remove one or more assignments from a line.
  const removeAssignments = async (ids) => {
    if (boardLockedGuard()) return;   // 🔒 tablero bloqueado
    if (!ids || ids.length === 0) return;
    if (blockedByWeekLock(datesOfIds(ids))) return;
    clearInsertUndo();
    // Never delete locked (past) cells: the old assigned quantity is history.
    const byId = new Map(assignments.map((a) => [a.id, a]));
    const lockedCount = ids.filter((id) => isLockedCell(byId.get(id))).length;
    const deletable = ids.filter((id) => !isLockedCell(byId.get(id)));
    if (deletable.length === 0) {
      showToast(`No se puede eliminar: ${lockedCount} casilla(s) de días anteriores a hoy (cantidad ya asignada).`, true);
      return;
    }
    setDropBusy(true);
    let removed = 0;
    const errors = [];
    try {
      for (const id of deletable) {
        const res = await fetch(`${API_URL}/api/line-assignments/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) removed++;
        else errors.push(data.error || `HTTP ${res.status}`);
      }
      await fetchData({ silent: true });
      balances.reload({ silent: true });
      setSelectedAssignment(null);
      if (removed > 0) showToast(`🗑️ ${removed} asignación(es) eliminada(s).${lockedCount > 0 ? ` (${lockedCount} de días pasados protegida(s))` : ""}`);
      else showToast(`No se pudo eliminar. ${errors[0] || ""}`, true);
    } catch (err) {
      showToast(`Error al eliminar: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };

  const gridCols = `${LABEL}px repeat(${dateRange.length}, ${CELL_W}px)`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Cargando Plan Board...</div>
      </div>
    );
  }

  return (
    <div
      className="bg-white rounded-xl border shadow-sm overflow-hidden"
      // Full-bleed: ocupa todo el ancho de la ventana (con un pequeño margen a
      // los lados) aunque la página envuelva este tablero en un contenedor
      // centrado con ancho máximo — así usa el espacio de izquierda y derecha
      // como el tablero de la página del CEO. Donde el contenedor padre ya es
      // de ancho completo, `calc(50% - 50vw)` da 0 y no cambia nada.
      style={{
        width: "calc(100vw - 32px)",
        maxWidth: "calc(100vw - 32px)",
        marginLeft: "calc(50% - 50vw + 16px)",
        marginRight: "calc(50% - 50vw + 16px)",
      }}
    >
      {/* Selector de semanas + envío al supermercado */}
      {sendOpen && !readOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !sendBusy && setSendOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-emerald-600" /> Enviar al supermercado
                </h3>
                <p className="text-sm text-gray-600 mt-0.5">
                  Elija las semanas a publicar. Una semana ya enviada no se puede reenviar: para
                  cambiarla, retírela primero. Sólo se pueden enviar las semanas{" "}
                  {SEND_MIN_WEEKS_AHEAD} y {SEND_MAX_WEEKS_AHEAD} a partir de la actual (la semana
                  en curso no se envía), y las semanas con pre-órdenes no se pueden enviar hasta
                  convertirlas a PO real.
                </p>
              </div>
              <button onClick={() => !sendBusy && setSendOpen(false)} className="text-gray-400 hover:text-gray-600 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {sendableWeeks.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-500">
                  No hay semanas planeadas todavía. Programe órdenes en el tablero y vuelva aquí.
                </div>
              ) : (
                <div className="space-y-2">
                  {sendableWeeks.map((w) => {
                    const lbl = weekLabel(w.weekStart);
                    const checked = sendWeeks.has(w.weekStart);
                    const blocked = w.blocked;
                    return (
                      <label
                        key={w.weekStart}
                        className={`flex items-start gap-3 border rounded-lg px-3 py-2.5 transition ${
                          blocked
                            ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                            : checked
                            ? "border-emerald-400 bg-emerald-50 cursor-pointer"
                            : "border-gray-200 hover:bg-gray-50 cursor-pointer"
                        }`}
                        title={blocked ? w.blockReason || "No se puede enviar esta semana" : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          onChange={() => toggleSendWeek(w.weekStart)}
                          className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 disabled:cursor-not-allowed"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{lbl.top}</span>
                            <span className="text-xs text-gray-500 tabular-nums">{lbl.range}</span>
                            {w.hasPreOrders && (
                              <span className="text-[10px] font-semibold text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-2 py-0.5">
                                Con pre-orden
                              </span>
                            )}
                            {blocked && !w.published && (
                              <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 rounded-full px-2 py-0.5">
                                No enviable · {w.blockReason}
                              </span>
                            )}
                            {w.published && (
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5">
                                Enviada · rev {w.published.revision} · no reenviable
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 mt-1 flex gap-3 flex-wrap tabular-nums">
                            <span>{Math.round(w.boardPzas).toLocaleString()} pzas en tablero</span>
                            <span>{w.boardCells} casillas</span>
                            {w.poolPzas > 0 && <span>{Math.round(w.poolPzas).toLocaleString()} pzas por bajar</span>}
                            {w.prePzas > 0 && (
                              <span className="text-violet-600">{Math.round(w.prePzas).toLocaleString()} pzas pre-orden</span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t bg-gray-50 space-y-3">
              <input
                type="text"
                value={sendNote}
                onChange={(e) => setSendNote(e.target.value)}
                placeholder="Nota para el supermercado (opcional)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600">
                  {sendWeeks.size === 0
                    ? "Ninguna semana seleccionada"
                    : `${sendWeeks.size} ${sendWeeks.size === 1 ? "semana seleccionada" : "semanas seleccionadas"}`}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSendOpen(false)}
                    disabled={sendBusy}
                    className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={sendToSupermarket}
                    disabled={sendBusy || sendWeeks.size === 0}
                    className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {sendBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {sendBusy ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b bg-white">
        {/* Fila 1: título + acciones */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-[260px] flex-1">
            <h2 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
              {heading || "Plan Board"}
              {readOnly && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                  <Lock className="w-3 h-3" /> Sólo consulta
                </span>
              )}
              {!readOnly && (() => {
                const thisMon = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
                const n = Object.keys(weekLocks).filter((k) => k >= thisMon).length;
                return n > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-700 rounded-full px-2 py-0.5"
                    title={Object.keys(weekLocks).filter((k) => k >= thisMon).sort().map((k) => weekLabelOf(k)).join("\n")}
                  >
                    <Lock className="w-3 h-3" /> {n} {n === 1 ? "semana bloqueada" : "semanas bloqueadas"} por el CEO
                  </span>
                ) : null;
              })()}
            </h2>
            <p className="text-sm text-gray-600">
              {subheading ||
                (readOnly
                  ? "Plan publicado por planeación. Se actualiza cuando planeación vuelve a enviar la semana."
                  : "Arrastre una orden del panel izquierdo a una casilla de la línea —o tóquela y luego toque la casilla— para programarla")}
            </p>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Avisos: sólo aparecen cuando hay algo que atender */}
              {pendingBalanceGroups.days > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setBalOpen((v) => !v); }}
                    aria-expanded={balOpen}
                    className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 hover:bg-rose-100 transition"
                    title={`${pendingBalanceGroups.days} día(s) por reasignar · ${Math.round(pendingBalanceGroups.pcs).toLocaleString()} pzas`}
                  >
                    <AlertCircle className="w-4 h-4" /> Saldos
                    <span className="rounded-full bg-rose-600 text-white text-[10px] font-bold px-1.5 leading-4">
                      {pendingBalanceGroups.days > 99 ? "99+" : pendingBalanceGroups.days}
                    </span>
                  </button>
                {balOpen && (
                  <>
                    <div className="fixed inset-0 z-[58]" onClick={() => setBalOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-[59] w-[420px] max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-xl text-left">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                        <div className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
                          <Bell className="w-4 h-4 text-rose-600" /> Por reasignar
                          <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                            {Math.round(pendingBalanceGroups.pcs).toLocaleString()} pzas · {pendingBalanceGroups.days} día(s)
                          </span>
                        </div>
                        <button onClick={() => setBalOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Cerrar"><X className="w-4 h-4" /></button>
                      </div>
                      <p className="px-3 pt-2 text-[11px] text-gray-500">
                        Toque un día para ir a la celda (esquina roja) y arrástrela a su nuevo día.
                      </p>
                      <div className="max-h-[60vh] overflow-auto p-2 space-y-2">
                        {pendingBalanceGroups.groups.map((g) => {
                          const wo = woOf(g.woId);
                          const sub = [wo?.customer_name, wo?.style_description].filter(Boolean).join(" · ");
                          return (
                            <div key={g.key} className="rounded-lg border border-gray-100 bg-gray-50/60">
                              <div className="flex items-start justify-between gap-2 px-2.5 pt-2">
                                <div className="min-w-0">
                                  <div className="font-mono text-[12px] font-bold text-gray-900 truncate">{g.woNo || wo?.work_order_no || `#${g.woId}`}</div>
                                  {sub && <div className="text-[10px] text-gray-500 truncate">{sub}</div>}
                                </div>
                                <span className="shrink-0 text-[12px] font-semibold text-rose-700 tabular-nums">{Math.round(g.total).toLocaleString()} pzas</span>
                              </div>
                              <div className="p-1.5 space-y-1">
                                {g.rows.map((r) => {
                                  const d = String(r.assigned_date || "").slice(0, 10);
                                  const unlinked = !r.run_linked && Number(r.runs_on_day) > 0;
                                  return (
                                    <button
                                      key={`${r.line_no}|${d}`}
                                      type="button"
                                      onClick={() => goToBalanceCell(r)}
                                      className="w-full flex items-center gap-2 rounded-md bg-white border border-gray-200 px-2 py-1.5 text-[11px] hover:border-rose-300 hover:bg-rose-50 transition"
                                      title={unlinked ? "La línea capturó producción ese día pero sin ligar a la orden: revise la captura antes de reasignar" : "Ir a la celda"}
                                    >
                                      <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                      <span className="font-semibold text-gray-800 tabular-nums w-11 text-left">{d ? `${d.slice(8)}/${d.slice(5, 7)}` : "—"}</span>
                                      <span className="text-gray-600 w-9 text-left">L{r.line_no}</span>
                                      {unlinked && <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 leading-4">sin ligar</span>}
                                      <span className="ml-auto font-bold text-rose-700 tabular-nums">−{Math.round(Number(r.balance) || 0).toLocaleString()}</span>
                                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                </div>
              )}
              {conversions.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setConvOpen((v) => !v)}
                    aria-expanded={convOpen}
                    className={`h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition ${unseenConv.length > 0 ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                    title="Pre-órdenes que ya se convirtieron en PO real"
                  >
                    <Bell className="w-4 h-4" /> Convertidas
                    {unseenConv.length > 0 && (
                      <span className="rounded-full bg-violet-600 text-white text-[10px] font-bold px-1.5 leading-4">
                        {unseenConv.length > 99 ? "99+" : unseenConv.length}
                      </span>
                    )}
                  </button>
                {convOpen && (
                  <>
                    <div className="fixed inset-0 z-[58]" onClick={() => setConvOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-[59] w-[420px] max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-xl text-left">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                        <div className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
                          <Bell className="w-4 h-4 text-violet-600" /> Pre-órdenes convertidas en PO
                        </div>
                        <div className="flex items-center gap-1">
                          {unseenConv.length > 0 && (
                            <button onClick={() => markConvSeen(unseenConv)} className="text-[11px] text-violet-700 hover:underline px-1">Marcar todas como vistas</button>
                          )}
                          <button onClick={() => setConvOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Cerrar"><X className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <p className="px-3 pt-2 text-[11px] text-gray-500">
                        Sus reservas PRE se liberaron. Toque «Ver» para buscar la PO nueva y asignarla en Diario.
                      </p>
                      <div className="max-h-[60vh] overflow-auto p-2 space-y-1.5">
                        {conversions.slice(0, 50).map((c) => {
                          const isNew = !convSeen || convSeen[c.id] !== c.sig;
                          return (
                            <div key={c.id} className={`rounded-lg border px-2.5 py-2 ${isNew ? "border-violet-300 bg-violet-50" : "border-gray-100 bg-gray-50/60"}`}>
                              <div className="flex items-center gap-1.5">
                                {isNew && <span className="text-[8px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5 shrink-0">NUEVA</span>}
                                <span className="font-mono text-[12px] font-bold text-violet-900">{c.no}</span>
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span className="font-mono text-[12px] font-bold text-gray-900 truncate flex-1 min-w-0">{c.woNos.join(", ") || "PO"}</span>
                                <button onClick={() => goToConversion(c)} className="shrink-0 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-2 py-0.5">Ver</button>
                              </div>
                              <div className="mt-0.5 text-[10px] text-gray-500 truncate">
                                {[c.customer, c.style].filter(Boolean).join(" · ") || "—"}
                              </div>
                              <div className="mt-0.5 flex items-center justify-between text-[10px]">
                                <span className={c.partial ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold"}>
                                  {c.partial
                                    ? `Parcial: ${Math.round(c.converted).toLocaleString()} de ${Math.round(c.pieces).toLocaleString()} pzas`
                                    : "Convertida completa"}
                                </span>
                                {c.when && !isNaN(new Date(c.when)) && <span className="text-gray-400">{format(new Date(c.when), "dd/MM/yyyy HH:mm")}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                </div>
              )}
              {cutReqs.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setCutReqOpen((v) => !v)}
                    aria-expanded={cutReqOpen}
                    className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-orange-200 bg-orange-50 px-3 text-sm font-medium text-orange-700 hover:bg-orange-100 transition"
                    title="El área de corte pidió que se le asignen estas órdenes"
                  >
                    <Scissors className="w-4 h-4" /> Corte pide
                    <span className="rounded-full bg-orange-600 text-white text-[10px] font-bold px-1.5 leading-4">
                      {cutReqs.length > 99 ? "99+" : cutReqs.length}
                    </span>
                  </button>
                  {cutReqOpen && (
                    <>
                      <div className="fixed inset-0 z-[58]" onClick={() => setCutReqOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 z-[59] w-[400px] max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-xl text-left">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                          <div className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
                            <Scissors className="w-4 h-4 text-orange-600" /> Solicitudes de corte
                          </div>
                          <button onClick={() => setCutReqOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Cerrar"><X className="w-4 h-4" /></button>
                        </div>
                        <p className="px-3 pt-2 text-[11px] text-gray-500">
                          El área de corte necesita estas órdenes. Se asignan (o rechazan) en «Órdenes de corte».
                        </p>
                        <div className="max-h-[55vh] overflow-auto p-2 space-y-1.5">
                          {cutReqs.map((x) => {
                            const u = x.urgency === "urgent"
                              ? { t: "Urgente", c: "bg-red-100 text-red-700" }
                              : x.urgency === "intermediate"
                              ? { t: "Intermedia", c: "bg-yellow-100 text-yellow-800" }
                              : { t: "Normal", c: "bg-green-100 text-green-700" };
                            return (
                              <div key={x.id} className="rounded-lg border border-orange-100 bg-orange-50/50 px-2.5 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[12px] font-bold text-gray-900 truncate flex-1 min-w-0">{x.work_order_no}</span>
                                  {x.color && <span className="text-[10px] rounded-full bg-white border border-gray-200 text-gray-700 px-1.5 py-0.5">{x.color}</span>}
                                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${u.c}`}>{u.t}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-gray-500 truncate">
                                  {x.customer_name || "—"}{Number(x.quantity) > 0 ? ` · ${Math.round(Number(x.quantity)).toLocaleString()} pzas` : " · todo lo pendiente"}
                                </div>
                                <div className="mt-0.5 text-[10px] text-gray-400">
                                  {x.requested_by_name || "Corte"}{x.created_at && !isNaN(new Date(x.created_at)) ? ` · ${format(new Date(x.created_at), "dd/MM HH:mm")}` : ""}
                                </div>
                                {x.note && <div className="mt-0.5 text-[11px] text-orange-800 truncate" title={x.note}>“{x.note}”</div>}
                              </div>
                            );
                          })}
                        </div>
                        {onOpenCutOrders && (
                          <div className="border-t p-2">
                            <button
                              onClick={() => { setCutReqOpen(false); onOpenCutOrders(); }}
                              className="w-full rounded-lg bg-orange-600 text-white text-sm font-semibold py-2 hover:bg-orange-700"
                            >
                              Ir a Órdenes de corte
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {changeNotices.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setChangeOpen((v) => !v)}
                    aria-expanded={changeOpen}
                    className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 transition"
                    title="El merchant cambió color o cantidad de órdenes que ya están asignadas"
                  >
                    <Bell className="w-4 h-4" /> Cambios
                    <span className="rounded-full bg-amber-600 text-white text-[10px] font-bold px-1.5 leading-4">
                      {changeNotices.length > 99 ? "99+" : changeNotices.length}
                    </span>
                    {changeNotices.some(isUnapplied) && (
                      <span className="rounded-full bg-rose-600 text-white text-[10px] font-bold px-1.5 leading-4" title="Pendientes de aplicar por bloqueo">
                        <Lock className="w-3 h-3 inline -mt-0.5" /> {changeNotices.filter(isUnapplied).length}
                      </span>
                    )}
                  </button>
                  {changeOpen && (
                    <>
                      <div className="fixed inset-0 z-[58]" onClick={() => setChangeOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 z-[59] w-[460px] max-w-[92vw] rounded-xl border border-gray-200 bg-white shadow-xl text-left">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                          <div className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
                            <Bell className="w-4 h-4 text-amber-600" /> Órdenes modificadas por el merchant
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => markChangeSeen("all")} className="text-[11px] text-amber-700 hover:underline px-1">Marcar todas como vistas</button>
                            <button onClick={() => setChangeOpen(false)} className="p-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Cerrar"><X className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <p className="px-3 pt-2 text-[11px] text-gray-500">
                          Las celdas ya se ajustaron solas (color nuevo y piezas de más recortadas desde los días más lejanos). Si subió la cantidad, la diferencia aparece en la bolsa para asignarla.
                          {changeNotices.some(isUnapplied) && (
                            <span className="block mt-1 text-rose-700">
                              🔒 Los marcados «Pendiente» llegaron con el tablero o la semana bloqueada: el tablero NO se tocó. Desbloquee y toque «Aplicar ahora».
                            </span>
                          )}
                        </p>
                        <div className="max-h-[60vh] overflow-auto p-2 space-y-1.5">
                          {changeNotices.map((n) => {
                            const changes = Array.isArray(n.changes) ? n.changes : [];
                            const trims = changes.find((c) => c.kind === "cells_trimmed");
                            const lockedWeek = changes.find((c) => c.kind === "locked_week_cells");
                            const toneCls = { violet: "text-violet-700", emerald: "text-emerald-700", rose: "text-rose-700", gray: "text-gray-600" };
                            const unapplied = isUnapplied(n);
                            const blockedNow = n.status === "pending" && n.deferred_reason === "board_locked" && boardLock.locked;
                            return (
                              <div key={n.id} className={`rounded-lg border px-2.5 py-2 ${unapplied ? "border-rose-300 bg-rose-50/60" : "border-amber-200 bg-amber-50/50"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[12px] font-bold text-gray-900 truncate min-w-0">{n.work_order_no}</span>
                                  {n.status === "pending" && (
                                    <span className="shrink-0 text-[9px] font-bold rounded-full bg-rose-600 text-white px-1.5 py-0.5">
                                      {n.deferred_reason === "board_locked" ? "🔒 PENDIENTE · TABLERO BLOQUEADO" : "PENDIENTE"}
                                    </span>
                                  )}
                                  {n.status === "partial" && (
                                    <span className="shrink-0 text-[9px] font-bold rounded-full bg-orange-500 text-white px-1.5 py-0.5">🔒 PARCIAL · SEMANA BLOQUEADA</span>
                                  )}
                                  <span className="flex-1" />
                                  <button onClick={() => goToChange(n)} className="shrink-0 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md px-2 py-0.5">Ver</button>
                                  {unapplied ? (
                                    <button
                                      onClick={() => applyChange(n)}
                                      disabled={blockedNow || applyingId != null}
                                      title={blockedNow ? "Desbloquee el tablero para aplicar" : "Ajustar el tablero con los datos actuales de la orden"}
                                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      {applyingId === n.id && <Loader2 className="w-3 h-3 animate-spin" />} Aplicar ahora
                                    </button>
                                  ) : (
                                    <button onClick={() => markChangeSeen([n.id])} className="shrink-0 text-[11px] font-semibold text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 rounded-md px-2 py-0.5">Visto</button>
                                  )}
                                </div>
                                <div className="mt-0.5 text-[10px] text-gray-500 truncate">
                                  {[n.customer_name, n.style_code].filter(Boolean).join(" · ") || "—"}
                                  {" · "}{n.changed_by_name || "Merchant"}
                                  {n.created_at && !isNaN(new Date(n.created_at)) ? ` · ${format(new Date(n.created_at), "dd/MM HH:mm")}` : ""}
                                </div>
                                <ul className="mt-1 space-y-0.5">
                                  {changes.map((ch, i) => {
                                    const d = describeChange(ch);
                                    return d ? <li key={i} className={`text-[11px] ${toneCls[d.tone] || "text-gray-700"}`}>• {d.text}</li> : null;
                                  })}
                                </ul>
                                {trims && (trims.groups || []).some((g) => (g.cells || []).length > 0) && (
                                  <div className="mt-1 rounded bg-white/70 border border-amber-100 px-1.5 py-1 text-[10px] text-gray-600">
                                    <div className="font-semibold text-gray-700">Celdas recortadas:</div>
                                    {(trims.groups || []).flatMap((g) => g.cells || []).map((c, i) => (
                                      <div key={i}>L{c.line_no} · {c.day}{c.color ? ` · ${c.color}` : ""}: {fmtPz(c.from)} → {Number(c.to) > 0 ? `${fmtPz(c.to)} pzas` : "eliminada"}</div>
                                    ))}
                                  </div>
                                )}
                                {lockedWeek && (lockedWeek.cells || []).length > 0 && (
                                  <div className="mt-1 rounded bg-white/70 border border-orange-200 px-1.5 py-1 text-[10px] text-orange-800">
                                    <div className="font-semibold">🔒 Sin cambiar (semana bloqueada por el CEO):</div>
                                    {lockedWeek.cells.map((c, i) => (
                                      <div key={i}>L{c.line_no} · {c.day}{c.color ? ` · ${c.color}` : ""} · {fmtPz(c.qty)} pzas → {c.action}</div>
                                    ))}
                                  </div>
                                )}
                                {n.status === "pending" && n.apply_error && (
                                  <div className="mt-1 text-[10px] text-rose-700 break-words">Motivo: {n.apply_error}</div>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px]">
                                  {n.status === "pending" ? (
                                    <span className="text-rose-700 font-semibold">El tablero no se modificó · asignado actual {fmtPz(n.assigned_before)} de {fmtPz(n.target_after)} pzas</span>
                                  ) : (
                                  <span className="text-gray-700 font-semibold">
                                    Asignado {fmtPz(n.assigned_before)} → {fmtPz(n.assigned_after)} de {fmtPz(n.target_after)} pzas
                                  </span>
                                  )}
                                  {n.status !== "pending" && Number(n.pending_to_assign) > 0 && <span className="text-emerald-700 font-semibold">Faltan {fmtPz(n.pending_to_assign)} por asignar</span>}
                                  {Number(n.unresolved_excess) > 0 && <span className="text-rose-700 font-semibold">⚠ {fmtPz(n.unresolved_excess)} pzas de más en celdas pasadas/liberadas: revisar a mano</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {(pendingBalanceGroups.days > 0 || conversions.length > 0 || cutReqs.length > 0 || changeNotices.length > 0) && <span className="mx-1 h-6 w-px bg-gray-200" />}

              {viewMode === "day" && (
                <button
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  disabled={boardLock.locked && !selectMode}
                  aria-pressed={selectMode}
                  title={boardLock.locked ? "🔒 Tablero bloqueado: no se puede seleccionar, mover ni insertar." : "Seleccionar casillas para Mover, Insertar, Enviar a líderes o Eliminar"}
                  className={`h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${selectMode ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  <Check className="w-4 h-4" /> {selectMode ? "Seleccionando" : "Seleccionar"}
                </button>
              )}
              <button
                onClick={toggleBoardLock}
                disabled={boardLockBusy || !boardLock.canLock}
                title={boardLock.canLock
                  ? (boardLock.locked ? "Desbloquear el tablero para volver a hacer cambios." : "Bloquear el tablero: nadie podrá asignar, mover, insertar ni eliminar.")
                  : "Su rol no puede bloquear el tablero."}
                className={`h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition disabled:opacity-50 ${boardLock.locked ? "border-red-600 bg-red-600 text-white hover:bg-red-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {boardLock.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                {boardLock.locked ? `Bloqueado${boardLock.lockedBy ? ` · ${boardLock.lockedBy}` : ""}` : "Bloquear"}
              </button>
              {viewMode === "week" && periods.length > 0 && (
                <button
                  onClick={() => exportWeeksToExcel(periods)}
                  disabled={exportBusy}
                  className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
                  title="Descargar en Excel las semanas visibles: resumen por línea, órdenes y detalle diario. Para una sola semana use el ícono junto a su encabezado."
                >
                  {exportBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-green-700" />} Excel
                </button>
              )}
              {/* Menú "Más": acciones de configuración poco frecuentes */}
              <div className="relative">
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  aria-label="Más acciones"
                  title="Más acciones"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-[58]" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-[59] w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl text-left">
                      <button
                        onClick={() => { setMoreOpen(false); setAddLine({ lineNo: "", operators: "", hours: "", effPct: "", sam: "" }); }}
                        className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-gray-50"
                      >
                        <Plus className="w-4 h-4 mt-0.5 text-indigo-600 shrink-0" />
                        <span><span className="block text-sm font-medium text-gray-800">Agregar línea</span>
                          <span className="block text-[11px] text-gray-500">Una línea que ingeniería aún no configuró</span></span>
                      </button>
                      <button
                        onClick={() => { setMoreOpen(false); setStyleList({ all: true }); }}
                        className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-gray-50"
                      >
                        <Settings className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" />
                        <span><span className="block text-sm font-medium text-gray-800">Estándares por estilo</span>
                          <span className="block text-[11px] text-gray-500">SAM, operarios, horas y eficiencia</span></span>
                      </button>
                      {lineOrder.length > 0 && (
                        <button
                          onClick={() => { setMoreOpen(false); resetLineOrder(); }}
                          className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-gray-50"
                        >
                          <RotateCcw className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" />
                          <span><span className="block text-sm font-medium text-gray-800">Restablecer orden de líneas</span>
                            <span className="block text-[11px] text-gray-500">Volver al orden numérico</span></span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => { setSendOpen(true); loadPublications(); }}
                className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                title="Elegir las semanas del plan y enviarlas al supermercado"
              >
                <Send className="w-4 h-4" /> Enviar al supermercado
              </button>
            </div>
          )}
          {readOnly && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Búsqueda + Filtros: resaltan las órdenes que coinciden en
                  Diario, Semanal y Mensual; el resto se desvanece. */}
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setSearch(""); } }}
                  placeholder="Buscar OT, estilo, cliente o PO…"
                  aria-label="Buscar en el tablero"
                  className="h-9 w-56 pl-8 pr-7 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                  title="Filtrar las órdenes del tablero por cliente, temporada, línea, estado o entrega"
                  className={`h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition ${activeFilterCount ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  <SlidersHorizontal className={`w-4 h-4 ${activeFilterCount ? "text-indigo-600" : "text-gray-500"}`} /> Filtros
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white tabular-nums">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {filtersOpen && (
                  <>
                    <div className="fixed inset-0 z-[58]" onClick={() => setFiltersOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-[59] w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-xl text-left space-y-2.5">
                      <BoardFilterSelect label="Tipo" value={boardFilters.kind === "all" ? "" : boardFilters.kind}
                        onChange={(v) => setBoardFilter("kind")(v || "all")} allLabel="Órdenes y pre-órdenes" options={KIND_OPTIONS} />
                      <BoardFilterSelect label="Cliente" value={boardFilters.customer} onChange={setBoardFilter("customer")}
                        allLabel="Todos los clientes" options={filterOptions.customers} />
                      <BoardFilterSelect label="Temporada" value={boardFilters.season} onChange={setBoardFilter("season")}
                        allLabel="Todas las temporadas" options={filterOptions.seasons} />
                      <BoardFilterSelect label="Línea" value={boardFilters.line} onChange={setBoardFilter("line")}
                        allLabel="Todas las líneas" options={filterOptions.lines.map((l) => ({ v: l, label: `Línea ${l}` }))} />
                      <BoardFilterSelect label="Estado" value={boardFilters.proc === "all" ? "" : boardFilters.proc}
                        onChange={(v) => setBoardFilter("proc")(v || "all")} allLabel="Todos los estados" options={PROC_OPTIONS} />
                      <BoardFilterSelect label="Entrega" value={boardFilters.deliv === "all" ? "" : boardFilters.deliv}
                        onChange={(v) => setBoardFilter("deliv")(v || "all")} allLabel="Todas las entregas" options={DELIV_OPTIONS} />
                      <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                        <span className={`text-xs tabular-nums ${filterMatchCount === 0 ? "text-rose-600 font-medium" : "text-gray-500"}`}>
                          {filterMatchCount == null
                            ? `${filterTotal.toLocaleString()} órdenes`
                            : filterMatchCount === 0
                              ? "Ninguna orden coincide"
                              : `${filterMatchCount.toLocaleString()} de ${filterTotal.toLocaleString()} órdenes`}
                        </span>
                        <button
                          onClick={clearBoardFilters}
                          disabled={!isSearching}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:text-gray-300"
                        >
                          Limpiar filtros
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setStyleList({ all: true })}
                className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                title="SAM, operarios, horas y eficiencia por estilo que usa el Plan Board para calcular la capacidad"
              >
                <Settings className="w-4 h-4 text-gray-500" /> Estándares
              </button>
              {lineOrder.length > 0 && (
                <button
                  onClick={resetLineOrder}
                  className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  title="Restablecer el orden de las líneas al orden numérico"
                >
                  <RotateCcw className="w-4 h-4 text-gray-500" /> Orden de líneas
                </button>
              )}
              {viewMode === "week" && periods.length > 0 && (
                <button
                  onClick={() => exportWeeksToExcel(periods)}
                  disabled={exportBusy}
                  className="h-9 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
                >
                  {exportBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-green-700" />} Excel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Fila 2: navegación y vista */}
        <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/70 flex items-center gap-3 flex-wrap">
          <div className="flex bg-gray-200/60 rounded-lg p-0.5">
              {(restrictWeeks ? ["day", "week", "month"] : ["day", "week", "month", "year"]).map((m) => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`h-7 px-3 text-sm whitespace-nowrap rounded-md transition ${viewMode === m ? "bg-white shadow-sm text-gray-900 font-semibold" : "text-gray-600 hover:text-gray-900"}`}>
                  {m === "day" ? "Diario" : m === "week" ? "Semanal" : m === "month" ? "Mensual" : "Año"}
                </button>
              ))}
            </div>
          {!restrictWeeks && (
            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white shadow-sm">
              <button onClick={goPrevious} aria-label="Anterior" className="h-8 w-8 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 rounded-l-lg"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={goToday} className="h-8 px-3 text-sm font-medium text-gray-700 border-x border-gray-200 hover:bg-gray-50">Hoy</button>
              <button onClick={goNext} aria-label="Siguiente" className="h-8 w-8 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 rounded-r-lg"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
          <div className="text-sm font-semibold text-gray-800 whitespace-nowrap">
          {viewMode === "day" && dateRange.length > 0 && `${format(dateRange[0], "d MMM", { locale: es })} – ${format(dateRange[dateRange.length - 1], "d MMM yyyy", { locale: es })}`}
          {viewMode === "week" && periods.length > 0 && `${format(new Date(`${periods[0].start}T00:00:00`), "d MMM")} – ${format(new Date(`${periods[periods.length - 1].end}T00:00:00`), "d MMM yyyy")}`}
          {viewMode === "month" && (
            // Con semanas publicadas el año sale de las columnas reales, no de
            // currentDate (que podría ser de otro año que el publicado).
            restrictWeeks && periods.length > 0
              ? periods.length === 1
                ? `${periods[0].top} ${periods[0].bottom}`
                : `${periods[0].top} – ${periods[periods.length - 1].top} ${periods[periods.length - 1].bottom}`
              : format(currentDate, "yyyy")
          )}
          {viewMode === "year" && periods.length > 0 && `${periods[0].bottom} – ${periods[periods.length - 1].bottom}`}
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            <ToggleChip on={showDelivery} onClick={() => setShowDelivery((v) => !v)} color="emerald" label="Entregas"
              title="Las casillas con alguna orden que termina después de su fecha de entrega llevan un borde rojo punteado." />
            <ToggleChip on={hlOn} onClick={() => setHlOn((v) => !v)} color="sky" label="Resaltar orden"
              title="Al pasar el cursor sobre una orden se resaltan todos sus bloques en todas las líneas y el resto se atenúa." />
            {!readOnly && (
              <ToggleChip on={splitDay} onClick={() => setSplitDay((v) => !v)} color="indigo" label="2 órdenes/día"
                title="Al cargar una orden, ocupar como máximo la mitad del día para que quepan dos órdenes en la misma línea/día." />
            )}
            {!readOnly && canEditStyles && (
              <ToggleChip on={reviewOnDrop} onClick={() => setReviewOnDrop((v) => !v)} color="indigo" label="Revisar estándar"
                title="Al soltar una orden se muestra el estándar de su estilo para confirmarlo o ajustarlo antes de asignar." />
            )}
            <span className="mx-1 h-6 w-px bg-gray-200" />
            <label
              className="flex items-center gap-1.5"
              title="Minutos SAM de una prenda base = 1 pieza equivalente. eq/pza = SAM ÷ equivalencia; piezas equivalentes = cantidad × eq/pza. Es el mismo factor global del merchant."
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Equiv.</span>
              <input
                type="number" min="0.1" step="0.1" value={equivalence}
                readOnly={readOnly} disabled={readOnly}
                onChange={(e) => onChangeEquivalence(e.target.value)}
                className={`w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 ${readOnly ? "bg-gray-50 text-gray-500" : ""}`}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Armed-PO hint */}
      {armedPO && !dropBusy && (
        <div className={`px-5 py-2 border-b text-sm flex items-center justify-between gap-3 ${armedPO.isPreOrder ? "bg-violet-100 border-violet-200 text-violet-900" : "bg-amber-100 border-amber-200 text-amber-800"}`}>
          <span className="truncate inline-flex items-center gap-1.5">
            <b className="font-mono">{armedPO.work_order_no}{armedPO.color ? ` · ${armedPO.color}` : ""}</b>
            {armedPO.isPreOrder && <span className="text-[9px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5">PRE-ORDEN</span>}
            <span>lista para asignar — toque una casilla libre (o arrástrela).</span>
            <span className={armedPO.isPreOrder ? "text-violet-600" : "text-amber-600"}>Esc para cancelar.</span>
          </span>
          <button onClick={() => setArmedPO(null)} className={`shrink-0 underline ${armedPO.isPreOrder ? "text-violet-700 hover:text-violet-900" : "text-amber-700 hover:text-amber-900"}`}>
            Cancelar
          </button>
        </div>
      )}

      {/* Multi-cell selection bar */}
      {selectMode && (
        <div className={`sticky top-0 z-40 px-5 py-2 border-b text-sm flex items-center gap-3 ${pickingDest && insertMode ? "bg-fuchsia-50 border-fuchsia-200 text-fuchsia-900" : "bg-indigo-50 border-indigo-200 text-indigo-900"}`}>
          {!pickingDest ? (
            <>
              <span className="truncate">
                <b>{selectedIds.size}</b> casilla(s) seleccionada(s) — toque los bloques (POs o reservas PRE) para marcar, luego Mover, Insertar, Enviar a líderes o Eliminar. Las reservas se omiten al enviar a líderes e insertar.
              </span>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <button
                  disabled={selectedIds.size === 0 || dropBusy}
                  onClick={() => { setInsertMode(false); setPickingDest(true); }}
                  title="Reacomoda la selección en la celda destino, empacando día por día."
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Mover…
                </button>
                <button
                  disabled={selectedIds.size === 0 || dropBusy}
                  onClick={() => { setInsertMode(true); setPickingDest(true); }}
                  title="Inserta la selección en la celda destino y recorre el resto de la línea hacia adelante."
                  className="px-3 py-1.5 rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-40"
                >
                  Insertar…
                </button>
                <button
                  disabled={selectedIds.size === 0 || dropBusy}
                  onClick={confirmSelected}
                  title="Crea el borrador en el lado de los líderes de línea para las casillas seleccionadas."
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  Enviar a líderes
                </button>
                <button
                  disabled={selectedIds.size === 0 || dropBusy}
                  onClick={deleteSelected}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
                >
                  Eliminar
                </button>
                <button
                  disabled={selectedIds.size === 0}
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                >
                  Limpiar
                </button>
                <button onClick={exitSelectMode} className="px-3 py-1.5 rounded-lg text-indigo-600 hover:underline">
                  Salir
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="truncate">
                {dropBusy ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {insertMode ? "Insertando…" : "Moviendo…"}</span>
                ) : insertMode ? (
                  <>Toque la casilla <b>destino</b> — las <b>{selectedIds.size}</b> orden(es) se <b>insertan</b> ahí y el resto de la línea se recorre hacia adelante.</>
                ) : (
                  <>Toque la casilla <b>destino</b> — las <b>{selectedIds.size}</b> casilla(s) se reacomodan ahí día por día.</>
                )}
              </span>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <button
                  disabled={dropBusy}
                  onClick={() => { setPickingDest(false); setInsertMode(false); }}
                  className="px-3 py-1.5 rounded-lg text-indigo-600 hover:underline disabled:opacity-40"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Área de trabajo: bolsa de órdenes (izquierda) + cuadrícula de líneas (derecha),
          lado a lado para asignar sin hacer scroll. */}
      <div className="flex border-b bg-white" style={{ height: "70vh" }}>
      {/* Pool: orders the MERCHANT planned, laid out as compact per-week columns
          so the planner sees the weeks AND the line grid at the same time.
          Assigning/dragging only in Diario. */}
      {viewMode === "day" && !readOnly && !showPool && (
        // Hidden: collapse to a thin rail so the plan board gets the full width.
        <button
          onClick={() => setShowPool(true)}
          title="Mostrar órdenes del merchant"
          className="h-full w-9 shrink-0 flex flex-col items-center gap-2 py-3 border-r border-amber-200 bg-amber-50/60 hover:bg-amber-100/70 transition"
        >
          <ChevronRight className="w-4 h-4 text-amber-700" />
          <Package className="w-4 h-4 text-amber-600" />
          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">
            {poolJobs.length + preOrderJobs.length}
          </span>
          <span className="text-xs font-semibold text-gray-700 whitespace-nowrap" style={{ writingMode: "vertical-rl" }}>
            Órdenes del merchant
          </span>
        </button>
      )}
      {viewMode === "day" && !readOnly && showPool && (
      <div className="h-full w-[300px] shrink-0 flex flex-col border-r border-amber-200 bg-amber-50/40">
        {/* Header row — title collapses the pool; controls stay on the right */}
        <div className="w-full flex items-center justify-between px-4 py-2.5 gap-2 border-b border-amber-200 bg-amber-100/40 shrink-0">
          <button onClick={() => setShowPool((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-gray-800 min-w-0">
            <Package className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">Órdenes del merchant</span>
            <span className="shrink-0 text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
              {isSearching
                ? `${filteredPoolJobs.length + filteredPreOrderJobs.length}/${poolJobs.length + preOrderJobs.length}`
                : poolJobs.length + preOrderJobs.length}
            </span>
          </button>
          <div className="flex items-center gap-3 shrink-0">
            {showPool && poolJobs.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showSizes}
                  onChange={(e) => setShowSizes(e.target.checked)}
                  className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                />
                Desglose
              </label>
            )}
            <button
              onClick={() => setShowPool(false)}
              title="Ocultar órdenes del merchant para ver el tablero completo"
              className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-700"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Ocultar
            </button>
          </div>
        </div>

        {showPool && (
          <div className="px-3 py-3 overflow-y-auto flex-1">
            {/* Search: WO # / estilo / PO cliente. Filters these cards and
                highlights the matching order's cells on the grid. */}
            <div className="sticky top-0 z-20 -mx-3 px-3 pb-2 mb-2 bg-amber-50/95 backdrop-blur-sm">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setSearch(""); } }}
                  placeholder="Buscar OT, estilo o PO cliente…"
                  className="w-full pl-8 pr-7 py-1.5 text-[12px] rounded-lg border border-amber-200 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    title="Limpiar"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {isSearching && (
                <p className="mt-1 text-[10px] text-gray-500">
                  {filteredPoolJobs.length} en la bolsa · las celdas que coinciden se resaltan en el tablero
                </p>
              )}
            </div>
            {!merchantOk && (
              <p className="mb-2 text-[11px] text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2 py-1 inline-block">
                No se pudo cargar el plan del merchant — mostrando todas las órdenes pendientes.
              </p>
            )}
            {(preOrderKeys.size > 0 || preOrderJobs.length > 0) && (
              <p className="mb-2 text-[10px] text-violet-700 inline-flex items-start gap-1.5">
                <span className="inline-block w-2.5 h-2.5 mt-0.5 shrink-0 rounded-sm border border-dashed border-violet-500 bg-violet-100" />
                <span>
                  Borde punteado / <span className="font-bold bg-violet-600 text-white rounded-full px-1.5 py-0.5 leading-none">PRE</span> = pre-orden del merchant.
                  {preOrderJobs.length > 0 && " Las PRE#### aún no son PO, pero puede colocarlas en una casilla como reserva: apartan la capacidad de esa línea/día. Toque la casilla para quitar la reserva; al convertir la pre-orden, la reserva se libera y asigna la PO real."}
                </span>
              </p>
            )}
            {poolJobs.length + preOrderJobs.length === 0 ? (
              <p className="text-sm text-gray-500 py-1">
                {merchantOk
                  ? "El merchant aún no ha planificado órdenes (o ya están completamente programadas)."
                  : "No hay órdenes pendientes."}
              </p>
            ) : filteredPoolJobs.length + filteredPreOrderJobs.length === 0 ? (
              <p className="text-sm text-gray-500 py-1">
                {search.trim() ? `Sin coincidencias para «${search.trim()}»` : "Ninguna orden coincide con los filtros"}
                {search.trim() && activeFilterCount > 0 ? " con los filtros activos." : "."}
                {" "}
                <button onClick={clearBoardFilters} className="text-amber-700 underline hover:text-amber-800">Limpiar</button>
              </p>
            ) : (
              // ONE bounded, scrollable strip. Weeks are columns (scroll →);
              // sticky headers keep the week visible while scrolling ↓.
              <div className="rounded-lg">
                <div className="flex flex-col gap-3">
                  {poolWeekGroups.map((grp) => {
                    const wl = weekLabel(grp.week);
                    return (
                      <div key={grp.week || "none"} className="w-full flex flex-col">
                        {/* Sticky week header — click to jump the grid to that week */}
                        <button
                          onClick={() => goToWeek(grp.week)}
                          title={grp.week ? "Llevar el tablero a esta semana" : undefined}
                          className="group sticky top-0 z-10 text-left bg-amber-50/95 backdrop-blur-sm border-b border-amber-200 px-1 pb-1.5 mb-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-3.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="text-xs font-bold text-gray-800">{wl.top}</span>
                            {grp.week && <ChevronRight className="w-3.5 h-3.5 text-amber-500 opacity-0 group-hover:opacity-100 transition" />}
                          </div>
                          <div className="pl-3 text-[10px] text-gray-400 leading-tight">{wl.range}</div>
                          <div className="pl-3 text-[10px] text-gray-500 leading-tight">
                            {grp.jobs.length - grp.preCount} ord · {Math.round(grp.totalPzas).toLocaleString()} pzas
                            {grp.preCount > 0 && (
                              <span className="text-violet-600">
                                {" "}· {grp.preCount} pre · {Math.round(grp.prePzas).toLocaleString()} pzas
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Compact order cards for this week */}
                        <div className="space-y-1.5">
                          {grp.jobs.map((job) => {
                            const isActive = activePO?.key === job.key;
                            const isPre = job.isPreOrder;
                            // PRE####: se coloca en una casilla como "hold" — una
                            // reserva de línea/día que aparta capacidad pero no es
                            // todavía una asignación real. Arrástrela, o tóquela y
                            // luego toque una casilla.
                            if (job.isPreOrderRow) return (
                              <div key={job.key} draggable={!boardLock.locked && !dropBusy}
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", job.key);
                                  setArmedPO(null);
                                  setDraggedPO(job);
                                }}
                                onDragEnd={() => { setDraggedPO(null); setDropTarget(null); }}
                                onClick={() => { if (boardLockedGuard()) return; setArmedPO((cur) => (cur?.key === job.key ? null : job)); }}
                                title={`${job.work_order_no} — ${job.customer_name || ""}\nPre-orden (hold): arrástrela a una línea, o tóquela y luego toque una casilla. Aparta capacidad; no es una PO todavía.`}
                                className={`rounded-lg border border-dashed px-2.5 py-2 cursor-grab active:cursor-grabbing select-none transition ${isActive ? "border-amber-400 bg-amber-50 ring-2 ring-amber-500" : "border-violet-400 bg-violet-50/60 hover:border-violet-500 hover:shadow"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-violet-400" />
                                  <span className="font-mono text-[12px] font-bold text-violet-900 truncate flex-1 min-w-0">{job.work_order_no}</span>
                                  <span className="text-[8px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5 shrink-0">PRE</span>
                                </div>
                                <div className="mt-0.5 text-[10px] text-violet-700/80 truncate">
                                  {job.customer_name || "—"}{job.estilo ? ` · ${job.estilo}` : job.style_code ? ` · ${job.style_code}` : ""}
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2">
                                  <span className="text-[12px] font-semibold text-violet-700">{Math.round(job.remaining).toLocaleString()} pzas</span>
                                  <span className="text-[9px] text-violet-500 truncate">{job.delivery_date ? `entrega ${fmtDMY(job.delivery_date).slice(0, 5)}` : "reserva de capacidad"}</span>
                                </div>
                              </div>
                            );
                            return (
                              <div key={job.key} draggable={!boardLock.locked && !dropBusy}
                                onDragStart={(e) => {
                                  // Required for the drag to actually start in Firefox / some browsers.
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", job.key);
                                  setArmedPO(null);      // dragging supersedes a tapped selection
                                  setDraggedPO(job);
                                }}
                                onDragEnd={() => { setDraggedPO(null); setDropTarget(null); }}
                                onClick={() => { if (boardLockedGuard()) return; setArmedPO((cur) => (cur?.key === job.key ? null : job)); }}
                                title={`${job.work_order_no}${job.color ? " · " + job.color : ""}${isPre ? " · PRE-ORDEN" : ""} — ${job.customer_name || ""}\nArrástrela a una línea, o tóquela y luego toque una casilla libre`}
                                className={`rounded-lg border bg-white px-2.5 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${isActive ? "ring-2 ring-amber-500 border-amber-400" : isPre ? "border-dashed border-violet-500 ring-1 ring-violet-200" : "border-gray-200 hover:border-amber-300"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(colorGroupKey(job.style_code, job.key)).dot}`} />
                                  <span className="font-mono text-[12px] font-bold text-gray-900 truncate flex-1 min-w-0">{job.work_order_no}</span>
                                  {(() => {
                                    // PO que salió de una pre-orden: sello "de PRE####"
                                    // (resaltado mientras la conversión no se ha visto).
                                    const cv = convByWoId.get(Number(job.workOrderId));
                                    if (!cv) return null;
                                    const isNew = !convSeen || convSeen[cv.id] !== cv.sig;
                                    return (
                                      <span title={`Convertida desde la pre-orden ${cv.no}`}
                                        className={`text-[8px] font-bold leading-none rounded-full px-1.5 py-0.5 shrink-0 ${isNew ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-700"}`}>
                                        {isNew ? "NUEVA · " : "de "}{cv.no}
                                      </span>
                                    );
                                  })()}
                                  {isPre && (
                                    <span className="text-[8px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5 shrink-0">PRE</span>
                                  )}
                                  {job.color && (
                                    <span className="text-[10px] rounded-full bg-gray-100 text-gray-700 px-1.5 py-0.5 shrink-0">{job.color}</span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-[10px] text-gray-500 truncate">
                                  {job.customer_name || "—"}{job.estilo ? ` · ${job.estilo}` : ""}
                                </div>
                                {showSizes && (
                                  job.breakdown && job.breakdown.length > 0 ? (
                                    <div className="mt-1.5 space-y-1.5 border-t border-gray-100 pt-1.5">
                                      {job.breakdown.map((po, pi) => (
                                        <div key={pi}>
                                          <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] font-semibold text-gray-700 truncate">
                                              <span className="text-gray-400 font-normal">PO</span> {po.customerPo || "—"}
                                            </span>
                                            <span className="text-[9px] text-gray-400 shrink-0">{Math.round(po.total).toLocaleString()}</span>
                                          </div>
                                          {po.styles.map((st, si) => (
                                            <div key={si} className="pl-2 mt-0.5">
                                              <div className="text-[9px] text-gray-500 truncate flex items-center gap-1">
                                                {job.color && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${blockColor(colorGroupKey(job.style_code, job.key)).dot}`} />}
                                                <span className="font-mono">{st.estilo || "—"}</span>
                                              </div>
                                              {st.sizes.length > 0 && (
                                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                                  {st.sizes.map((s) => (
                                                    <span key={s.talla} className="text-[9px] rounded bg-blue-50 text-blue-700 px-1 py-0.5">
                                                      {s.talla}: {Math.round(s.quantity).toLocaleString()}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (job.sizes && job.sizes.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {job.sizes.map((s) => (
                                        <span key={s.talla} className="text-[9px] rounded bg-blue-50 text-blue-700 px-1 py-0.5">
                                          {s.talla}: {Math.round(s.quantity).toLocaleString()}
                                        </span>
                                      ))}
                                    </div>
                                  ))
                                )}
                                <div className="mt-1 flex items-center justify-between">
                                  <span className="text-[12px] font-semibold text-amber-700">{Math.round(job.remaining).toLocaleString()} pzas</span>
                                  {(job.delivery_date || job.commitment_date) && (
                                    <span className="text-[10px] text-gray-400" title="Fecha de entrega (merchant)">{fmtDMY(job.delivery_date || job.commitment_date).slice(0, 5)}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      {/* Compact square grid */}
      <div className="flex-1 min-w-0 overflow-auto relative bg-white">
        {dropBusy && (
          <div className="absolute inset-0 z-40 bg-white/60 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-700 text-sm bg-white border rounded-lg px-4 py-2 shadow">
              <Loader2 className="w-4 h-4 animate-spin" /> Programando…
            </div>
          </div>
        )}

        {!aggregated && (
        <div className="inline-block pr-4 pb-4">
          {/* Day header row */}
          <div className="grid items-end sticky top-0 z-[35] bg-white pt-3" style={{ gridTemplateColumns: gridCols, gap: GAP, paddingBottom: GAP }}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 z-[36] bg-white pr-2 pl-3 self-stretch flex items-end border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.18)]">Línea</div>
            {dateRange.map((date, idx) => {
              const isToday = isSameDay(date, new Date());
              const plantHol = holidayIndex.plant.get(format(date, "yyyy-MM-dd")); // toda la planta
              // With weekends hidden the 1st may not be a visible column, so a
              // month starts wherever the month changes from the previous cell.
              const prev = idx > 0 ? dateRange[idx - 1] : null;
              const monthStart = idx === 0 || !prev || prev.getMonth() !== date.getMonth() || prev.getFullYear() !== date.getFullYear();
              return (
                <div key={idx} className={`relative text-center leading-tight ${monthStart && idx !== 0 ? "border-l border-gray-300" : ""} text-gray-500`} style={{ width: CELL_W }}>
                  {monthStart && (
                    <div className="text-[8px] font-bold uppercase tracking-wide text-indigo-500 leading-none">{format(date, "MMM", { locale: es })}</div>
                  )}
                  {/* Número de semana: una vez por semana (lunes o primera columna). */}
                  {(idx === 0 || date.getDay() === 1) && (
                    <div
                      className={`text-[8px] font-semibold leading-none inline-flex items-center justify-center gap-[1px] ${weekLockOf(date) ? "text-slate-700" : "text-violet-500"}`}
                      title={weekLockOf(date) ? `Semana bloqueada por el CEO${weekLockOf(date).locked_by_name ? ` (${weekLockOf(date).locked_by_name})` : ""}` : "Semana del año"}
                    >
                      {weekLockOf(date) && <Lock className="w-2 h-2" strokeWidth={3} />}
                      S{getWeek(date, { weekStartsOn: 1 })}
                    </div>
                  )}
                  <div className="text-[9px] uppercase leading-none mb-0.5">{format(date, "EEEEE", { locale: es })}</div>
                  <div className={`text-[11px] font-semibold mx-auto ${isToday ? "text-white bg-blue-600 rounded-full w-[18px] h-[18px] flex items-center justify-center" : plantHol ? "text-amber-700" : "text-gray-700"}`} title={plantHol ? (plantHol.name || "Día no laborable") : undefined}>{format(date, "d")}</div>
                  {/* Debajo de la fecha: asignado (gris) y producido (verde) del día, todas las líneas. */}
                  {(() => {
                    const k = format(date, "yyyy-MM-dd");
                    const asg = assignedByDay.get(k) || 0;
                    const prod = producedByDay.get(k) || 0;
                    const eq = eqByDay.get(k) || 0;
                    return (
                      <div className="mt-0.5 leading-none">
                        {eq > 0 && (
                          <div className="text-[8px] font-mono font-semibold tabular-nums text-blue-600" title={`Carga equivalente asignada: ${Math.round(eq).toLocaleString()} pzas eq`}>
                            {compactN(eq)}
                          </div>
                        )}
                        <div className={`text-[8px] font-semibold tabular-nums ${asg > 0 ? "text-slate-600" : "text-gray-300"}`} title={`Asignado: ${Math.round(asg).toLocaleString()} pzas`}>
                          {asg > 0 ? compactN(asg) : "·"}
                        </div>
                        {producedResolved && (
                          <div className={`text-[8px] font-semibold tabular-nums ${prod > 0 ? "text-emerald-600" : "text-gray-300"}`} title={`Producido: ${Math.round(prod).toLocaleString()} pzas`}>
                            {prod > 0 ? compactN(prod) : "·"}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* Line rows */}
          {lines.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">No hay líneas configuradas.</div>
          ) : (
            lines.map((lineNo, li) => (
              <div key={lineNo} className="grid items-center" style={{ gridTemplateColumns: gridCols, gap: GAP, marginBottom: GAP }}>
                {/* Line label — drag it onto another line to reorder; click to see details */}
                <button
                  draggable={!dropBusy}
                  onDragStart={(e) => onLineDragStart(e, lineNo)}
                  onDragOver={(e) => onLineDragOver(e, lineNo)}
                  onDragLeave={() => setLineDropTarget((t) => (t === String(lineNo) ? null : t))}
                  onDrop={(e) => onLineDrop(e, lineNo)}
                  onDragEnd={onLineDragEnd}
                  onClick={() => openStyleEditor(lineNo)}
                  className={`pr-2 pl-3 self-stretch text-left rounded-r-md transition cursor-grab active:cursor-grabbing sticky left-0 z-[33] bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,0_3px_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)] flex items-center gap-1 ${draggedLine === String(lineNo) ? "opacity-40" : "hover:bg-gray-100"} ${lineDropTarget === String(lineNo) && draggedLine !== String(lineNo) ? "ring-2 ring-emerald-400 ring-inset bg-emerald-50" : ""} ${deliveryFit?.best && deliveryFit.best.line === String(lineNo) ? "ring-2 ring-inset ring-emerald-600" : ""}`}
                  title={`Línea ${lineNo} · ${lineOpsLabel(lineNo)} operarios · ${lineTargetLabel(lineNo).toLocaleString()} pzas/día (estándar de planeación) — arrastre para reordenar · clic para ver/editar SAM, operarios, horas y eficiencia por estilo${(() => {
                    const lf = deliveryFit?.byLine.get(String(lineNo))?.summary;
                    if (!lf || !lf.start) return "";
                    const fin = lf.finish ? fmtDMY(lf.finish) : "fuera del horizonte";
                    return `\n\n${activePO?.work_order_no || ""}: iniciando el ${fmtDMY(lf.start)} termina el ${fin}` +
                      (deliveryFit.delivery ? ` · entrega ${fmtDMY(deliveryFit.delivery)} — ${lf.ok ? `✅ a tiempo${lf.slackDays ? ` (${lf.slackDays} d de holgura)` : ""}` : lf.finish ? `❌ atrasa ${lf.lateDays} d` : "❌ no llega"}` : "");
                  })()}`}
                >
                  {/* Ranura fija a la izquierda del número: el agarre para reordenar, o
                      un círculo rojo con cuántas órdenes de la línea llegan tarde. Mismo
                      ancho siempre, así los números de línea quedan alineados. */}
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {showDelivery && lateCountByLine.get(String(lineNo)) > 0 ? (
                      <span
                        title={`${lateCountByLine.get(String(lineNo))} orden(es) en esta línea terminan después de su fecha de entrega`}
                        className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center tabular-nums"
                      >
                        {lateCountByLine.get(String(lineNo)) > 9 ? "9+" : lateCountByLine.get(String(lineNo))}
                      </span>
                    ) : (
                      <GripVertical className="w-3 h-3 text-gray-300" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-gray-800 leading-none whitespace-nowrap">L{lineNo}{isPlannerOnly(lineNo) && (<span title="Línea del planeador — aún sin configurar por ingeniería" className="ml-1 align-middle inline-block px-1 py-[1px] rounded bg-amber-100 text-amber-700 text-[8px] font-bold leading-none">P</span>)}</div>
                    {/* 2ª línea: operarios. 3ª línea: capacidad (pzas/día, estándar de
                        planeación). Con una orden activa, la 3ª línea muestra en su lugar
                        cuándo terminaría aquí (soltándola en su primer día libre). */}
                    <div className="text-[9px] text-gray-500 leading-none mt-[2px] whitespace-nowrap" title={`${lineOpsLabel(lineNo)} operarios`}>
                      👤{lineOpsLabel(lineNo)}
                    </div>
                    {(() => {
                      const lf = deliveryFit?.byLine.get(String(lineNo))?.summary;
                      if (!lf || !lf.start) {
                        const tgt = lineTargetLabel(lineNo);
                        return (
                          <div className="text-[9px] text-gray-400 leading-none mt-[2px] whitespace-nowrap tabular-nums" title={`${tgt ? tgt.toLocaleString() : "—"} pzas/día (estándar de planeación)`}>
                            {tgt ? `${tgt.toLocaleString()} pz` : "—"}
                          </div>
                        );
                      }
                      const isBest = deliveryFit.best && deliveryFit.best.line === String(lineNo);
                      const least = !isBest && deliveryFit.noneOnTime && lf.finish === deliveryFit.best?.finish;
                      const tone = lf.ok === true ? "text-emerald-700" : least || (isBest && lf.ok === false) ? "text-amber-600" : lf.ok === false ? "text-red-600" : "text-slate-600";
                      return (
                        <div className={`text-[9px] font-bold leading-none mt-[2px] whitespace-nowrap ${tone}`}>
                          {isBest ? "⚡" : ""}{lf.finish ? `fin ${fmtDMY(lf.finish).slice(0, 5)}` : "sin cap."}
                        </div>
                      );
                    })()}
                  </div>
                </button>

                {/* Day squares — one line-day can now stack several POs, each
                    slice sized by its share of that day's assigned pieces. */}
                {dateRange.map((date, idx) => {
                  const cellAssignments = getAssignmentsForLineAndDate(lineNo, date);
                  const hasAny = cellAssignments.length > 0;
                  const isToday = isSameDay(date, new Date());
                  const prevDate = idx > 0 ? dateRange[idx - 1] : null;
                  const monthStart = idx !== 0 && (!prevDate || prevDate.getMonth() !== date.getMonth() || prevDate.getFullYear() !== date.getFullYear());
                  const dateKey = `${lineNo}|${format(date, "yyyy-MM-dd")}`;
                  const moving = draggedAssignment != null;
                  // During any move (PO or pre-order hold) every workday cell is a
                  // valid drop target: an empty cell is a plain move, an occupied
                  // cell inserts the order and shifts that line's tail forward one
                  // workday. (Weekends are hidden, so every column is a workday.)
                  // Día festivo / paro on this line-day. A blocked cell refuses
                  // drops and paints an amber hatch (over any content, so a block
                  // placed before the day was blocked still stands out as a conflict).
                  const holiday = holidayFor(lineNo, date);
                  // Semana bloqueada por el CEO: no acepta drops ni se arrastra nada de ella.
                  const wkLock = weekLockOf(date);
                  const canDrop = holiday || wkLock ? false : (moving ? true : !!activePO);
                  const isDropHover = dropTarget === dateKey && canDrop;
                  const dayStr = format(date, "yyyy-MM-dd");
                  // Resaltado de entrega: ¿soltar la orden activa AQUÍ termina antes de la entrega?
                  const fit = deliveryView && !holiday && !wkLock
                    ? deliveryView.byLine.get(String(lineNo))?.cells.get(dayStr) || null
                    : null;
                  const isBestCell = !!fit && !!deliveryView.best
                    && deliveryView.best.line === String(lineNo) && deliveryView.best.start === dayStr;
                  // Ninguna opción llega: ámbar = las que terminan primero (las menos tardías).
                  const leastLate = !!fit && fit.ok === false && deliveryView.noneOnTime
                    && !!fit.finish && fit.finish === deliveryView.best.finish;
                  // Entrega de lo que YA está en la casilla: un solo marco por casilla.
                  // Rojo si alguna orden de la casilla termina después de su entrega;
                  // verde si todas las que tienen fecha llegan a tiempo. Se oculta
                  // mientras se arrastra/selecciona una orden (manda el resaltado de arriba).
                  const cellDel = (() => {
                    if (!showDelivery || !hasAny || deliveryView) return null;
                    const late = [], ok = [];
                    const seen = new Set();
                    for (const a of cellAssignments) {
                      const st = deliveryStatusOf(a);
                      if (!st || st.ok == null) continue;
                      const k = deliveryKeyOf(a);
                      if (seen.has(k)) continue;
                      seen.add(k);
                      (st.ok ? ok : late).push({ a, st });
                    }
                    if (!late.length && !ok.length) return null;
                    const lines = [...late, ...ok].map(({ a, st }) => `${st.ok ? "✅" : "❌"} ${woNo(a)}${a.color ? ` · ${a.color}` : ""}: ${deliveryText(st)}`);
                    return { late: late.length > 0, txt: `Entrega:\n${lines.join("\n")}` };
                  })();
                  const fitWho = deliveryView?.isMove ? (draggedAssignment ? woNo(draggedAssignment) : "Orden") : (activePO?.work_order_no || "Orden");
                  const fitTxt = fit
                    ? `▶ ${fitWho} ${deliveryView.isMove ? "movida aquí" : "iniciando aquí"} termina el ${fit.finish ? fmtDMY(fit.finish) : "— (no cabe en el horizonte)"}` +
                      (deliveryView.delivery
                        ? ` · entrega ${fmtDMY(deliveryView.delivery)} — ${fit.ok ? `✅ a tiempo${fit.slackDays ? ` (${fit.slackDays} d de holgura)` : ""}` : fit.finish ? `❌ atrasa ${fit.lateDays} d${leastLate ? " (la opción menos tardía)" : ""}` : "❌ no llega"}`
                        : " · sin fecha de entrega")
                      + (isBestCell ? "\n⚡ Línea más rápida para esta orden" : "")
                    : "";
                  const totalQty = cellAssignments.reduce((s, a) => s + (parseFloat(a.assigned_quantity) || 0), 0);
                  // Excess over the line's capacity for this day (planner standard, mix-weighted).
                  const dayCap = hasAny ? targetForLineOnDate(lineNo, dayStr) : 0;
                  const dayOver = hasAny ? capInfo(totalQty, dayCap).over : 0;
                  const change = cellChangeOf(cellAssignments);
                  const overTxt = [
                    change ? `🔁 ${change.text}` : "",
                    dayOver > 0
                      ? `⚠️ Excede la capacidad del día por ${dayOver.toLocaleString()} pzas (${Math.round(totalQty).toLocaleString()} asignadas / ${Math.round(dayCap).toLocaleString()} capacidad)`
                      : "",
                  ].filter(Boolean).join("\n") || undefined;

                  const emptyCls = holiday
                    ? `border ${monthStart ? "border-l-2 border-l-gray-300 " : ""}border-amber-300 bg-amber-50`
                    : `border ${monthStart ? "border-l-2 border-l-gray-300 " : ""}${isToday ? "border-blue-300 bg-blue-50 ring-1 ring-inset ring-blue-200" : "border-gray-200/80 bg-gray-50"}`;

                  return (
                    <div
                      key={idx}
                      onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(dateKey); } }}
                      onDragLeave={() => setDropTarget((t) => (t === dateKey ? null : t))}
                      onDrop={(e) => handleDrop(e, lineNo, date)}
                      onClick={() => handleCellClick(lineNo, date)}
                      data-cell={`${lineNo}|${dayStr}`}
                      style={{ width: CELL_W, height: CELL_H }}
                      title={holiday ? `${holiday.name || "Día no laborable"}${holiday.line_no ? ` · Línea ${holiday.line_no}` : " · toda la planta"}` : wkLock ? "🔒 Semana bloqueada por el CEO" : ([fitTxt, cellDel?.txt, overTxt].filter(Boolean).join("\n") || undefined)}
                      className={`relative rounded-md overflow-hidden transition ${hasAny ? "" : emptyCls} ${isDropHover ? "ring-2 ring-amber-400 bg-amber-100" : ""} ${!holiday && activePO && !hasAny ? "ring-1 ring-inset ring-amber-300/70 " : ""}${canDrop && !hasAny ? "cursor-pointer hover:ring-2 hover:ring-amber-300" : ""} ${holiday || wkLock ? "cursor-not-allowed" : ""} ${!holiday && !wkLock && selectMode && pickingDest ? (insertMode ? "cursor-pointer hover:ring-2 hover:ring-fuchsia-500" : "cursor-pointer hover:ring-2 hover:ring-indigo-500") : ""}`}
                    >
                      {wkLock && !holiday && (
                        <span
                          className="pointer-events-none absolute inset-0 z-30 rounded-md ring-1 ring-inset ring-slate-500/60"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(-45deg, rgba(71,85,105,0.18) 0, rgba(71,85,105,0.18) 1px, transparent 1px, transparent 5px)",
                          }}
                        />
                      )}
                      {holiday && (
                        <span
                          className="pointer-events-none absolute inset-0 z-30 rounded-md ring-1 ring-inset ring-amber-400/70"
                          style={{
                            backgroundImage:
                              "repeating-linear-gradient(45deg, rgba(217,119,6,0.32) 0, rgba(217,119,6,0.32) 2px, transparent 2px, transparent 5px)",
                          }}
                        />
                      )}
                      {fit && (fit.ok !== null || isBestCell) && (() => {
                        // Casilla ocupada: sólo el marco (sin relleno) para que los
                        // bloques que ya están ahí sigan leyéndose.
                        const tone = fit.ok === false ? (leastLate ? "amber" : "red") : "green";
                        const ring = isDropHover ? "ring-2 ring-amber-500"
                          : tone === "red" ? "ring-2 ring-red-500"
                          : tone === "amber" ? "ring-2 ring-amber-500"
                          : isBestCell ? "ring-[3px] ring-emerald-600" : "ring-2 ring-emerald-500";
                        const fill = hasAny ? ""
                          : tone === "red" ? "bg-red-400/30"
                          : tone === "amber" ? "bg-amber-300/50"
                          : isBestCell ? "bg-emerald-400/45" : "bg-emerald-300/30";
                        return <span className={`pointer-events-none absolute inset-0 z-[28] rounded-md ring-inset ${ring} ${fill}`} />;
                      })()}
                      {isBestCell && (
                        <span
                          className={`pointer-events-none absolute top-0 right-0 z-[29] rounded-bl-md ${fit.ok === false ? "bg-amber-500" : "bg-emerald-600"} text-white font-black leading-none`}
                          style={{ fontSize: cellDetails ? 9 : 8, padding: cellDetails ? "2px 3px" : "1px 2px" }}
                        >
                          {cellDetails ? "⚡ Más rápida" : "⚡"}
                        </span>
                      )}
                      {cellDel?.late && (
                        // Atrasada: borde rojo punteado y delgado, encima de los bloques
                        // pero sin taparlos. A tiempo no lleva marca (es lo normal).
                        <span className="pointer-events-none absolute inset-0 z-[23] rounded-md border-[1.5px] border-dashed border-red-500/90" />
                      )}
                      {flashCell === `${lineNo}|${dayStr}` && (
                        <span className="pointer-events-none absolute inset-0 z-[40] rounded-md ring-4 ring-inset ring-rose-500 animate-pulse" />
                      )}
                      {change && (
                        <>
                          <span
                            className={`pointer-events-none absolute inset-0 z-[24] rounded-md ring-2 ring-inset ${change.kind === "style" ? "ring-fuchsia-600" : "ring-sky-500"}`}
                          />
                          <span
                            className={`pointer-events-none absolute top-0 left-0 z-[27] rounded-br-md font-black leading-none text-white ${change.kind === "style" ? "bg-fuchsia-600" : "bg-sky-500"}`}
                            style={{ fontSize: cellDetails ? 8 : 7, padding: cellDetails ? "2px 3px" : "1px 2px" }}
                          >
                            {cellDetails
                              ? (change.kind === "style" ? "Cambio estilo" : "Cambio color")
                              : (change.kind === "style" ? "E" : "C")}
                          </span>
                        </>
                      )}
                      {dayOver > 0 && (
                        <>
                          <span className="pointer-events-none absolute inset-0 z-[25] rounded-md ring-2 ring-inset ring-red-700" />
                          <span
                            className="pointer-events-none absolute bottom-0 inset-x-0 z-[26] bg-red-700 text-white font-bold text-center leading-none tabular-nums truncate"
                            style={{ fontSize: cellDetails ? 9 : 7, padding: cellDetails ? "2px 1px" : "1px 0" }}
                          >
                            +{cellDetails ? `${dayOver.toLocaleString()} excede` : compactN(dayOver)}
                          </span>
                        </>
                      )}
                      {hasAny && (
                        <div className="absolute inset-0 flex flex-col">
                          {cellAssignments.map((a) => {
                            const c = blockColor(blockGroupKey(a));
                            const preO = a.is_hold || isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color);
                            const overdue = isOverdue(a) ? "ring-1 ring-inset ring-red-600" : "";
                            const done = a.status === "completed" ? "opacity-60" : "";
                            const isBeingMoved = moving && draggedAssignment.id === a.id;
                            const dim = isBeingMoved ? "opacity-40" : "";
                            const isStart = ymd(a.planned_start_date) === dayStr;
                            // Search highlight: when a query is active, matching
                            // blocks keep full color + ring; the rest fade back so
                            // only the searched order stands out on the grid.
                            // Resaltar orden (hover) tiene prioridad sobre la búsqueda.
                            const hlHit = hlActive && orderKeyOf(a) === hl.key;
                            const searchHit = !hlActive && isSearching && blockMatchesSearch(a);
                            const searchDim = hlActive
                              ? (hlHit ? "" : "opacity-20 grayscale blur-[1px]")
                              : isSearching && !searchHit ? "opacity-10 grayscale" : "";
                            const searchRing = hlHit
                              ? "ring-2 ring-inset ring-sky-500 z-10"
                              : searchHit ? "ring-2 ring-inset ring-amber-500 z-10" : "";
                            const share = totalQty > 0 ? (parseFloat(a.assigned_quantity) || 0) / totalQty : 1 / cellAssignments.length;
                            // Alto real de esta rebanada (px). Con varias OT en el
                            // mismo dia la celda se parte, y el sello "PRE" solo
                            // cabe si la rebanada tiene altura suficiente.
                            const slicePx = share * CELL_H;
                            return (
                              <div
                                key={a.id}
                                draggable={!boardLock.locked && !dropBusy && !selectMode && !wkLock}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  if (wkLock) { e.preventDefault(); return; }
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", String(a.id));
                                  setDraggedPO(null);
                                  setArmedPO(null);
                                  setDraggedAssignment(a); // may be a hold (a.is_hold); handleDrop routes it to moveHold
                                }}
                                onDragEnd={() => { setDraggedAssignment(null); setDropTarget(null); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (selectMode) {
                                    // In dest phase, a tap on any cell (even an
                                    // occupied one) picks it as the target.
                                    if (pickingDest) chooseDestination(lineNo, date);
                                    else toggleSelectedWithFuture(a, lineNo, date); // also (de)selects the same order's FUTURE cells on this line; routed per-type on Mover/Enviar/Eliminar
                                    return;
                                  }
                                  // An armed PO packs onto this cell even over a hold.
                                  if (armedPO && !dropBusy) assignPOAcrossDays(armedPO, lineNo, date);
                                  else if (a.is_hold) removeHold(a);
                                  else setSelectedAssignment(a);
                                }}
                                onMouseEnter={(e) => {
                                  setHovered({ assignment: a, x: e.clientX, y: e.clientY });
                                  hoverOrder(orderKeyOf(a), woNo(a));
                                }}
                                onMouseMove={(e) => setHovered({ assignment: a, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => { setHovered(null); leaveOrder(); }}
                                title=""
                                style={{ flexGrow: share, flexBasis: 0, minHeight: 3 }}
                                className={`relative ${c.bg} ${c.border} border-b last:border-b-0 ${selectMode ? (wkLock || boardLock.locked ? "cursor-not-allowed" : "cursor-pointer") : wkLock || boardLock.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${overdue} ${done} ${dim} ${searchDim} ${searchRing} ${selectMode && selectedIds.has(a.id) ? "ring-2 ring-inset ring-indigo-600 z-10" : ""}`}
                              >
                                {selectMode && selectedIds.has(a.id) && (
                                  <span className="absolute top-0 left-0 z-20 bg-indigo-600 text-white rounded-br-md flex items-center justify-center" style={{ width: 12, height: 12 }}>
                                    <Check className="w-2.5 h-2.5" strokeWidth={4} />
                                  </span>
                                )}
                                {/* Pre-orden: borde punteado + sello PRE (igual que las
                                    tarjetas de la bolsa) para reconocerla de un vistazo.
                                    Si la rebanada es muy baja para el texto, cae al
                                    triangulo de esquina. */}
                                {preO && (
                                  <>
                                    <span className="pointer-events-none absolute inset-0 z-20 rounded-[3px] border-[1.5px] border-dashed border-violet-700" />
                                    {slicePx >= 9 && !cellDetails ? (
                                      <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                                        <span className="rounded-[2px] bg-violet-700 px-[2px] font-black leading-none text-white" style={{ fontSize: 6 }}>PRE</span>
                                      </span>
                                    ) : (
                                      <span className="pointer-events-none absolute bottom-0 left-0 z-20 w-0 h-0 border-b-[6px] border-r-[6px] border-b-violet-700 border-r-transparent" />
                                    )}
                                  </>
                                )}
                                {isStart && <span className="absolute inset-y-0 left-0 w-1 bg-black/25" />}
                                {/* Etiqueta legible en la casilla (supermercado):
                                    OT + PO cliente + cantidad asignada. Un panel
                                    casi blanco sobre el color del bloque mantiene
                                    el texto legible sin perder el código de color
                                    (queda un marco de 2px). Las líneas de PO y
                                    cantidad sólo aparecen si la rebanada da altura. */}
                                {cellDetails && (
                                  <div className="pointer-events-none absolute inset-[2px] z-10 flex flex-col justify-center rounded-[3px] bg-white/80 px-1 text-left overflow-hidden">
                                    <span
                                      className="font-mono font-bold leading-none text-gray-900 truncate"
                                      style={{ fontSize: 10 }}
                                      title={woNo(a)}
                                    >
                                      {woNo(a)}{a.color ? ` · ${a.color}` : ""}
                                    </span>
                                    {slicePx >= 30 && woPo(a) && (
                                      <span
                                        className="leading-none text-gray-700 truncate mt-[1px]"
                                        style={{ fontSize: 9 }}
                                        title={`PO cliente: ${woPo(a)}`}
                                      >
                                        <span className="text-gray-400">PO </span>{woPo(a)}
                                      </span>
                                    )}
                                    {slicePx >= 20 && (
                                      <span
                                        className="font-semibold tabular-nums leading-none text-gray-900 mt-[1px]"
                                        style={{ fontSize: 9 }}
                                        title={`${Math.round(Number(a.assigned_quantity) || 0).toLocaleString()} pzas asignadas`}
                                      >
                                        {compactN(a.assigned_quantity)} pzas
                                      </span>
                                    )}
                                  </div>
                                )}
                                {(() => {
                                  // Esquina verde: la celda se cerro automaticamente porque
                                  // la linea alcanzo (o supero) lo asignado ese dia.
                                  if (a.status !== "completed") return null;
                                  const b = balanceOf(a);
                                  if (b && b.is_past && b.balance > 0) return null; // cerro corta → esquina roja abajo
                                  const done = a.produced_quantity != null
                                    ? Math.round(Number(a.produced_quantity)).toLocaleString()
                                    : b ? Math.round(b.produced).toLocaleString() : null;
                                  return (
                                    <span
                                      className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-l-[8px] border-t-emerald-600 border-l-transparent"
                                      title={done ? `Completada · ${done} pzas ese día` : "Completada"}
                                    />
                                  );
                                })()}
                                {(() => {
                                  const b = balanceOf(a);
                                  if (!b || !b.is_past || b.balance <= 0) return null;
                                  // Esquina roja: ese dia cerro debajo de lo asignado. La
                                  // celda son 34 px, asi que el numero vive en el tooltip
                                  // y en el panel de saldos.
                                  return (
                                    <span
                                      className="absolute top-0 right-0 w-0 h-0 border-t-[8px] border-l-[8px] border-t-rose-600 border-l-transparent"
                                      title={`Faltaron ${Math.round(b.balance).toLocaleString()} pzas`}
                                    />
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        )}

        {aggregated && (() => {
          const AGG_W = 80, AGG_H = 44;
          const aggCols = `${LABEL}px repeat(${periods.length}, ${AGG_W}px)`;
          return (
            <div className="inline-block pr-4 pb-4">
              {/* Period header row */}
              <div className="grid items-end sticky top-0 z-[35] bg-white pt-3" style={{ gridTemplateColumns: aggCols, gap: GAP, paddingBottom: GAP }}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 z-[36] bg-white pr-2 pl-3 self-stretch flex items-end border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.18)]">Línea</div>
                {periods.map((p) => {
                  const { assigned, produced } = columnTotals(p.start, p.end);
                  const eq = columnEq(p.start, p.end);
                  const isCurWk = isCurrentWeek(p);
                  const colHol = viewMode === "week" ? periodHolidays(null, p.start, p.end) : null;
                  return (
                    <div
                      key={p.key}
                      className={`text-center leading-tight text-gray-500 ${isCurWk ? "bg-blue-50 rounded-md ring-2 ring-blue-500 pb-[2px]" : viewMode === "week" && weekLocks[p.key] ? "bg-slate-100 rounded-md" : ""}`}
                      style={{ width: AGG_W }}
                      title={isCurWk ? currentPeriodLabel : undefined}
                    >
                      {isCurWk && (
                        <div className="mx-auto mt-[2px] mb-[1px] w-fit rounded-full bg-blue-600 px-1.5 py-[1px] text-white font-bold leading-none" style={{ fontSize: 8 }}>
                          {currentPeriodLabel}
                        </div>
                      )}
                      {colHol && colHol.off > 0 && (
                        <div
                          className={`mx-auto mt-[2px] mb-[1px] w-fit rounded-full px-1.5 py-[1px] font-bold leading-none ${colHol.full ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800 border border-amber-300"}`}
                          style={{ fontSize: 8 }}
                          title={`${colHol.full ? "Semana festiva" : `${colHol.off} día(s) festivo(s) en la semana`}${colHol.name ? ` · ${colHol.name}` : ""} (toda la planta)`}
                        >
                          {colHol.full ? "Semana festiva" : `${colHol.off} día${colHol.off > 1 ? "s" : ""} festivo${colHol.off > 1 ? "s" : ""}`}
                        </div>
                      )}
                      <div className="text-[9px] uppercase inline-flex items-center justify-center gap-1">
                        {p.top}
                        {/* Candado de semana: el CEO lo alterna; los demás sólo lo ven cuando está puesto. */}
                        {viewMode === "week" && (() => {
                          const lk = weekLocks[p.key];
                          const busy = lockBusyWeek === p.key;
                          const who = lk ? `${lk.locked_by_name ? ` por ${lk.locked_by_name}` : ""}${lk.locked_at ? ` el ${format(new Date(lk.locked_at), "dd/MM HH:mm")}` : ""}` : "";
                          if (canLockWeeks) {
                            const preHere = lk ? [] : preOrdersInWeek(p.key);
                            return (
                              <button
                                type="button"
                                onClick={() => toggleWeekLock(p.key)}
                                disabled={busy || !canLockServer || preHere.length > 0}
                                aria-pressed={!!lk}
                                aria-label={lk ? `Desbloquear ${p.top}` : `Bloquear ${p.top}`}
                                title={
                                  !canLockServer
                                    ? "Su usuario no tiene permiso para bloquear semanas"
                                    : preHere.length > 0
                                    ? `No se puede bloquear: la semana tiene pre-órdenes (${preHere.join(", ")}). Conviértalas, muévalas o quítelas primero.`
                                    : lk
                                    ? `Semana bloqueada${who}. Clic para desbloquear.`
                                    : "Semana abierta. Clic para bloquearla: el planner no podrá mover nada en ella."
                                }
                                className={`inline-flex items-center justify-center rounded p-[2px] transition disabled:opacity-40 disabled:cursor-not-allowed ${
                                  lk ? "bg-slate-700 text-white hover:bg-slate-800" : "text-gray-400 hover:text-slate-700 hover:bg-gray-100"
                                }`}
                              >
                                {busy ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : lk ? (
                                  <Lock className="w-3 h-3" strokeWidth={2.5} />
                                ) : (
                                  <Unlock className="w-3 h-3" />
                                )}
                              </button>
                            );
                          }
                          return lk ? (
                            <span title={`Semana bloqueada por el CEO${who}`} className="inline-flex items-center justify-center rounded p-[2px] bg-slate-700 text-white">
                              <Lock className="w-3 h-3" strokeWidth={2.5} />
                            </span>
                          ) : null;
                        })()}
                        {viewMode === "week" && (
                          <button
                            type="button"
                            onClick={() => exportWeeksToExcel([p])}
                            disabled={exportBusy}
                            aria-label={`Exportar ${p.top} a Excel`}
                            title={`Exportar ${p.top} a Excel`}
                            className="inline-flex items-center justify-center rounded p-[2px] text-green-700 hover:bg-green-50 disabled:opacity-40"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div className={`text-[10px] font-semibold ${isCurWk ? "text-blue-700" : "text-gray-700"}`}>{p.bottom}</div>
                      {/* Piezas equivalentes (azul) — carga normalizada como en el merchant. */}
                      {eq > 0 && (
                        <div className="text-[9px] font-mono font-semibold tabular-nums text-blue-600" title={`Carga equivalente: ${Math.round(eq).toLocaleString()} pzas eq`}>
                          {Math.round(eq).toLocaleString()} eq
                        </div>
                      )}
                      {/* Asignado (gris) y producido (verde) del periodo, todas las líneas. */}
                      <div className="text-[9px] font-semibold tabular-nums text-slate-600" title={`Asignado: ${Math.round(assigned).toLocaleString()} pzas`}>
                        {assigned > 0 ? Math.round(assigned).toLocaleString() : "·"}
                      </div>
                      {producedResolved && (
                        <div className="text-[9px] font-semibold tabular-nums text-emerald-600" title={`Producido: ${Math.round(produced).toLocaleString()} pzas`}>
                          {produced > 0 ? Math.round(produced).toLocaleString() : "·"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Line rows (aggregated blocks) */}
              {lines.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-sm">No hay líneas configuradas.</div>
              ) : (
                lines.map((lineNo, li) => (
                  <div key={lineNo} className="grid items-center" style={{ gridTemplateColumns: aggCols, gap: GAP, marginBottom: GAP }}>
                    <button
                      draggable={!dropBusy}
                      onDragStart={(e) => onLineDragStart(e, lineNo)}
                      onDragOver={(e) => onLineDragOver(e, lineNo)}
                      onDragLeave={() => setLineDropTarget((t) => (t === String(lineNo) ? null : t))}
                      onDrop={(e) => onLineDrop(e, lineNo)}
                      onDragEnd={onLineDragEnd}
                      onClick={() => openStyleEditor(lineNo)}
                      className={`pr-2 pl-3 self-stretch text-left rounded-r-md transition cursor-grab active:cursor-grabbing sticky left-0 z-[33] bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,0_3px_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)] flex items-center gap-1 ${draggedLine === String(lineNo) ? "opacity-40" : "hover:bg-gray-100"} ${lineDropTarget === String(lineNo) && draggedLine !== String(lineNo) ? "ring-2 ring-emerald-400 ring-inset bg-emerald-50" : ""}`}
                      title={`Línea ${lineNo} · ${lineOpsLabel(lineNo)} operarios (estándar de planeación) — arrastre para reordenar · clic para ver/editar el estándar por estilo`}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-800 leading-none">L{lineNo}{isPlannerOnly(lineNo) && (<span title="Línea del planeador — aún sin configurar por ingeniería" className="ml-1 align-middle inline-block px-1 py-[1px] rounded bg-amber-100 text-amber-700 text-[8px] font-bold leading-none">P</span>)}</div>
                        <div className="text-[9px] text-gray-400 leading-none mt-0.5">
                          👤{lineOpsLabel(lineNo)}
                        </div>
                      </div>
                    </button>

                    {periods.map((p) => {
                      const { total, orders, hasPre, preQty } = aggFor(lineNo, p.start, p.end);
                      const has = total > 0;
                      const cap = periodCapacity(lineNo, p.start, p.end);
                      const { shown: util, over } = capInfo(total, cap); // util null → capacity unknown; clamped to 100%
                      const isOver = has && over > 0;
                      const isCurWk = isCurrentWeek(p);
                      // Festivos de la línea en el periodo (planta + propios de la línea).
                      const hol = periodHolidays(lineNo, p.start, p.end);
                      const holFull = hol.full;
                      const holPartial = viewMode === "week" && !hol.full && hol.off > 0;
                      const cc = has && util != null ? capColor(util) : null;
                      // Orden dominante (más piezas) de la celda: es la que se
                      // resalta al pasar el cursor por un bloque semanal/mensual.
                      const dominant = has ? orders.reduce((m, o) => (o.qty > (m?.qty || 0) ? o : m), null) : null;
                      const hlHitAgg = hlActive && orders.some((o) => o.orderKey === hl.key);
                      const cellStyle = { width: AGG_W, height: AGG_H };
                      if (has && cc) { cellStyle.backgroundColor = cc.bg; cellStyle.borderColor = cc.border; cellStyle.color = cc.text; }
                      else if (has) { cellStyle.backgroundColor = "rgba(100,116,139,0.18)"; cellStyle.borderColor = "#94a3b8"; cellStyle.color = "#334155"; }
                      if (hasPre) { cellStyle.outline = "2px dashed #6d28d9"; cellStyle.outlineOffset = "-2px"; }
                      const colLocked = viewMode === "week" && !!weekLocks[p.key];
                      if (colLocked) {
                        cellStyle.backgroundImage = "repeating-linear-gradient(-45deg, rgba(71,85,105,0.14) 0, rgba(71,85,105,0.14) 1px, transparent 1px, transparent 6px)";
                        if (!hasPre) { cellStyle.outline = "1px solid #64748b"; cellStyle.outlineOffset = "-1px"; }
                      }
                      // Semana / mes actual: anillo azul exterior (no tapa el color de capacidad).
                      const shadows = [];
                      if (isOver) { cellStyle.borderColor = "#b91c1c"; shadows.push("inset 0 0 0 2px #b91c1c"); }
                      if (isCurWk) shadows.push("0 0 0 2px #2563eb");
                      if (hlHitAgg) shadows.push("0 0 0 3px #0ea5e9");
                      // Búsqueda / filtros: piezas de las órdenes que coinciden.
                      // La celda conserva su carga y capacidad reales; sólo se
                      // marca (anillo ámbar + piezas que coinciden) o se desvanece.
                      const matchQty = isSearching && has
                        ? orders.reduce((sum, o) => sum + ((o.isHold ? preMatchesSearch(o.preOrderId) : o.woId != null && woMatchesSearch(o.woId, o.color)) ? o.qty : 0), 0)
                        : 0;
                      const filterHit = isSearching && matchQty > 0;
                      if (filterHit && !hlActive) { shadows.push("0 0 0 2px #f59e0b"); cellStyle.zIndex = 10; }
                      if (shadows.length) cellStyle.boxShadow = shadows.join(", ");
                      if (hlActive) {
                        if (hlHitAgg) cellStyle.zIndex = 20;
                        else { cellStyle.opacity = 0.15; cellStyle.filter = "grayscale(1) blur(1px)"; }
                      } else if (isSearching && !filterHit) {
                        cellStyle.opacity = 0.15; cellStyle.filter = "grayscale(1)";
                      }
                      if (isCurWk && !has) { cellStyle.backgroundColor = "#eff6ff"; cellStyle.borderColor = "#bfdbfe"; }
                      // Semana (periodo) completamente festiva: rayado ámbar, igual que el día festivo en Diario.
                      if (holFull) {
                        if (!has) { cellStyle.backgroundColor = "#fffbeb"; cellStyle.color = "#92400e"; }
                        cellStyle.borderColor = "#fcd34d";
                        cellStyle.backgroundImage = "repeating-linear-gradient(45deg, rgba(217,119,6,0.30) 0, rgba(217,119,6,0.30) 2px, transparent 2px, transparent 6px)";
                      }
                      const holTxt = holFull
                        ? `🏖️ ${viewMode === "week" ? "Semana festiva" : "Periodo festivo"}${hol.name ? ` (${hol.name})` : ""}${has ? " · ⚠️ tiene piezas asignadas en días festivos" : ""} · `
                        : hol.off > 0 ? `🏖️ ${hol.off} día(s) festivo(s)${hol.name ? ` (${hol.name})` : ""} · ` : "";
                      const pctTxt = util != null
                        ? `${Math.round(util * 100)}% de capacidad${isOver ? ` · EXCEDE la capacidad por ${over.toLocaleString()} pzas` : ""}`
                        : "sin capacidad configurada";
                      const preTxt = hasPre ? ` · incluye ${Math.round(preQty).toLocaleString()} pzas PRE-ORDEN` : "";
                      return (
                        <button
                          key={p.key}
                          onClick={() => has && setAggModal({ lineNo, label: `${p.top} ${p.bottom}`, orders, total, preQty })}
                          onMouseEnter={() => dominant && hoverOrder(dominant.orderKey, dominant.no.split(" · ")[0])}
                          onMouseLeave={leaveOrder}
                          title={`${isCurWk ? `📍 ${currentPeriodLabel} · ` : ""}${holTxt}${colLocked ? "🔒 Semana bloqueada por el CEO · " : ""}${has ? `${orders.length} orden(es) · ${Math.round(total).toLocaleString()} pzas · ${pctTxt}${preTxt}` : "Sin asignaciones"}${filterHit ? ` · 🔎 ${Math.round(matchQty).toLocaleString()} pzas coinciden con el filtro` : ""}`}
                          style={cellStyle}
                          className={`relative rounded-md border text-[11px] font-semibold flex items-center justify-center transition ${
                            has ? "hover:ring-2 hover:ring-black/10" : "border-gray-200 bg-gray-100 text-gray-300"
                          }`}
                        >
                          {has ? (
                            <span className="flex flex-col items-center justify-center leading-none">
                              <span>{Math.round(total).toLocaleString()}</span>
                              <span className="font-medium opacity-80" style={{ fontSize: 9 }}>
                                / {cap > 0 ? Math.round(cap).toLocaleString() : "—"}
                              </span>
                              {util != null && (
                                <span className="flex items-center gap-[3px] font-bold" style={{ fontSize: 9 }}>
                                  {Math.round(util * 100)}%
                                  {isOver && (
                                    <span className="rounded-[3px] bg-red-700 px-[3px] py-[1px] text-white leading-none" style={{ fontSize: 8 }}>
                                      +{over.toLocaleString()}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          ) : holFull ? (
                            <span className="font-bold leading-none" style={{ fontSize: 9 }}>Festivo</span>
                          ) : ""}
                          {holFull && has && (
                            <span className="pointer-events-none absolute top-0 left-0 z-10 rounded-br bg-amber-500 font-black leading-none text-white" style={{ fontSize: 7, padding: "1px 2px" }}>FEST</span>
                          )}
                          {holPartial && (
                            <span
                              className="pointer-events-none absolute bottom-0 left-0 z-10 rounded-tr bg-amber-400 font-bold leading-none text-amber-950"
                              style={{ fontSize: 7, padding: "1px 2px" }}
                            >
                              {hol.off}d fest.
                            </span>
                          )}
                          {hasPre && (
                            <span className="pointer-events-none absolute top-0 right-0 z-10 rounded-bl bg-violet-700 font-black leading-none text-white" style={{ fontSize: 7, padding: "1px 2px" }}>PRE</span>
                          )}
                          {filterHit && matchQty < total && (
                            <span className="pointer-events-none absolute bottom-0 right-0 z-10 rounded-tl bg-amber-500 font-bold leading-none text-white" style={{ fontSize: 7, padding: "1px 2px" }}>
                              {compactN(matchQty)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>
                  {viewMode === "week"
                    ? "Cada bloque suma la semana."
                    : viewMode === "month"
                    ? "Cada bloque suma el mes."
                    : "Cada bloque suma el año."}{" "}
                  Cambie a Diario para asignar o mover.
                </span>
                {viewMode === "week" && (canLockWeeks || Object.keys(weekLocks).length > 0) && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-flex items-center justify-center rounded p-[2px] bg-slate-700 text-white"><Lock className="w-2.5 h-2.5" /></span>
                      {canLockWeeks
                        ? "Semana bloqueada: el planner no puede moverla. Clic en el candado para alternar."
                        : "Semana bloqueada por el CEO: no se puede mover."}
                    </span>
                  </>
                )}
                {(viewMode === "week" || viewMode === "month") && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-blue-50" style={{ boxShadow: "0 0 0 2px #2563eb" }} />
                      {currentPeriodLabel}
                    </span>
                  </>
                )}
                {viewMode === "week" && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="w-3 h-3 rounded-sm border border-amber-300 bg-amber-50"
                        style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(217,119,6,0.30) 0, rgba(217,119,6,0.30) 2px, transparent 2px, transparent 5px)" }}
                      />
                      Semana festiva
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="rounded-sm bg-amber-400 px-[3px] font-bold leading-none text-amber-950" style={{ fontSize: 8 }}>Nd fest.</span>
                      días festivos en la semana
                    </span>
                  </>
                )}
                <span className="text-gray-400">·</span>
                <span className="font-medium text-gray-600">Color = uso de capacidad:</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#ef4444", borderColor: "#dc2626" }} />&lt;50%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#f97316", borderColor: "#ea580c" }} />50–80%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#facc15", borderColor: "#eab308" }} />80–95%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#22c55e", borderColor: "#16a34a" }} />95–100%</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#22c55e", borderColor: "#b91c1c", boxShadow: "inset 0 0 0 2px #b91c1c" }} />
                  <span className="rounded-[3px] bg-red-700 px-[3px] text-white font-bold leading-none" style={{ fontSize: 9 }}>+N</span>
                  excede la capacidad por N pzas
                </span>
              </div>
            </div>
          );
        })()}
      </div>
      </div>

      {/* Assigned work orders (color + number) shown above the grid */}
      {(() => {
        const byOrder = new Map();
        assignments
          .filter((a) => !["cancelled", "rejected"].includes(a.status))
          .forEach((a) => {
            const k = keyOf(a.work_order_id, a.color);
            const cur = byOrder.get(k) || {
              key: k, groupKey: blockGroupKey(a), no: woNo(a), color: a.color || null, qty: 0,
              pre: isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color),
            };
            cur.qty += parseFloat(a.assigned_quantity) || 0;
            byOrder.set(k, cur);
          });
        const orders = [...byOrder.values()];
        if (orders.length === 0) return null;
        return (
          <div className="px-5 py-3 border-b bg-white">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800 mr-1">Órdenes asignadas:</span>
              {orders.map((o) => (
                <span
                  key={o.key}
                  className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-xs ${o.pre ? "border-2 border-dashed border-violet-500 bg-violet-50" : "border border-gray-200 bg-gray-50"}`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${blockColor(o.groupKey).dot}`} />
                  <span className="font-mono font-medium text-gray-800">{o.no}{o.color ? ` · ${o.color}` : ""}</span>
                  {o.pre && <span className="text-[8px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5">PRE</span>}
                  <span className="text-gray-500">{Math.round(o.qty).toLocaleString()} pzas</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Los saldos por reasignar ahora viven en la campana sobre "+ Línea". */}

      {/* Legend: cell states (order colors are shown above the grid) */}
      <div className="px-5 py-3 border-t bg-gray-50 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded ring-2 ring-red-600 bg-white" />
            <span className="text-gray-600">Atrasada</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-[3px] bg-red-700 px-1 text-white font-bold leading-none ring-2 ring-red-700" style={{ fontSize: 9 }}>+N</span>
            <span className="text-gray-600">Excede la capacidad del día por N pzas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative inline-block w-3.5 h-3.5 rounded ring-2 ring-inset ring-fuchsia-600 bg-white">
              <span className="absolute top-0 left-0 rounded-br bg-fuchsia-600 px-[1px] font-black leading-none text-white" style={{ fontSize: 6 }}>E</span>
            </span>
            <span className="text-gray-600">Cambio de estilo (estilos distintos en el día)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative inline-block w-3.5 h-3.5 rounded ring-2 ring-inset ring-sky-500 bg-white">
              <span className="absolute top-0 left-0 rounded-br bg-sky-500 px-[1px] font-black leading-none text-white" style={{ fontSize: 6 }}>C</span>
            </span>
            <span className="text-gray-600">Cambio de color (mismo estilo y cliente)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
            <span className="text-gray-600">Libre</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded border border-amber-300 bg-amber-50"
              style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(217,119,6,0.32) 0, rgba(217,119,6,0.32) 2px, transparent 2px, transparent 5px)" }}
            />
            <span className="text-gray-600">Día bloqueado (festivo / paro)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-400 opacity-60" />
            <span className="text-gray-600">Completada (atenuada)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold text-blue-600 tabular-nums">000 eq</span>
            <span className="text-gray-600">Piezas equivalentes asignadas (bajo la fecha)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 tabular-nums">000</span>
            <span className="text-gray-600">Asignado (bajo la fecha)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">000</span>
            <span className="text-gray-600">Producido (bajo la fecha)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-violet-500">S##</span>
            <span className="text-gray-600">Número de semana</span>
          </div>
        </div>
      </div>

      {/* Hover tooltip (follows cursor) */}
      {hlActive && (
        <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-[60] rounded-full bg-sky-600 text-white text-xs font-semibold px-3 py-1 shadow-lg">
          Resaltando: <span className="font-mono">{hl.label}</span>
        </div>
      )}
      {hovered && (
        <div className="fixed z-[60] w-56 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 pointer-events-none"
          style={{ left: Math.min(hovered.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1000) - 240), top: hovered.y + 12 }}>
          <div className="font-medium mb-1 flex items-center gap-1.5">
            <span className="truncate">{woNo(hovered.assignment)}{hovered.assignment.color ? ` · ${hovered.assignment.color}` : ""}</span>
            {(hovered.assignment.is_hold || isPreOrder(hovered.assignment.work_order_id, hovered.assignment.color) || isPreOrder(hovered.assignment.work_order_no, hovered.assignment.color)) && (
              <span className="text-[8px] font-bold leading-none rounded-full bg-violet-500 text-white px-1.5 py-0.5 shrink-0">PRE</span>
            )}
          </div>
          <div className="space-y-0.5">
            {hovered.assignment.is_hold
              ? <Row k="Estilo" v={hovered.assignment.estilo || hovered.assignment.style_code || "—"} />
              : <Row k="Estilo" v={woStyle(hovered.assignment)} />}
            {!hovered.assignment.is_hold && woPo(hovered.assignment) && <Row k="PO Cliente" v={woPo(hovered.assignment)} />}
            <Row k="Línea" v={`L${hovered.assignment.line_no}`} />
            <Row k={hovered.assignment.is_hold ? "Reservado" : "Cantidad"} v={`${Math.round(hovered.assignment.assigned_quantity).toLocaleString()} pzas`} />
            {!hovered.assignment.is_hold && <Row k="Inicio" v={fmtDMY(hovered.assignment.planned_start_date)} />}
            {!hovered.assignment.is_hold && <Row k="Fin" v={fmtDMY(hovered.assignment.planned_end_date)} />}
            <Row k="Estado" v={hovered.assignment.is_hold ? "reserva (pre-orden)" : hovered.assignment.status} />
            {(() => {
              const st = deliveryStatusOf(hovered.assignment);
              if (!st) return null;
              return (
                <>
                  <Row k="Entrega" v={st.delivery ? fmtDMY(st.delivery) : "—"} />
                  <Row k="Termina" v={fmtDMY(st.finish)} />
                  {st.ok != null && (
                    <div className={`mt-1 rounded px-1.5 py-1 font-semibold ${st.ok ? "bg-emerald-600/30 text-emerald-200" : "bg-red-600/40 text-red-100"}`}>
                      {st.ok ? `✅ A tiempo${st.slackDays ? ` · ${st.slackDays} d de holgura` : ""}` : `❌ Atrasada ${st.lateDays} d`}
                      {st.pending && <div className="font-normal opacity-80">Aún hay piezas sin asignar.</div>}
                    </div>
                  )}
                </>
              );
            })()}
            {(() => {
              const b = balanceOf(hovered.assignment);
              if (!b) return null;
              return (
                <>
                  <Row k="Cosido" v={`${Math.round(b.produced).toLocaleString()} pzas`} />
                  {b.is_past && b.balance > 0 && (
                    <Row k="Faltó" v={`${Math.round(b.balance).toLocaleString()} pzas`} />
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Assignment Details Modal */}
      {selectedAssignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedAssignment(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-[260px] text-[12px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-3 py-2 border-b flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 text-[13px]">Detalles de Asignación</h3>
              {(isPreOrder(selectedAssignment.work_order_id, selectedAssignment.color) || isPreOrder(selectedAssignment.work_order_no, selectedAssignment.color)) && (
                <span className="text-[9px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5">PRE-ORDEN</span>
              )}
            </div>
            <div className="p-3 space-y-1 text-[12px] max-h-[68vh] overflow-y-auto">
              {(() => {
                const wo = workOrders.find((w) => w.id === selectedAssignment.work_order_id);
                return (
                  <>
                    <ModalRow k="Orden" v={woNo(selectedAssignment)} bold />
                    <ModalRow k="Color" v={selectedAssignment.color || "—"} />
                    <ModalRow k="Estilo N°" v={(wo && wo.estilo) || "—"} />
                    <ModalRow k="Estilo" v={woStyle(selectedAssignment)} />
                    <ModalRow k="Línea" v={selectedAssignment.line_no} />
                    <ModalRow k="Cantidad" v={`${Math.round(selectedAssignment.assigned_quantity).toLocaleString()} pzas`} />
                    <ModalRow k="Inicio" v={fmtDMY(selectedAssignment.planned_start_date)} />
                    <ModalRow k="Fin" v={fmtDMY(selectedAssignment.planned_end_date)} />
                    <ModalRow k="Estado" v={selectedAssignment.status} />
                    {selectedAssignment.status === "completed" && selectedAssignment.produced_quantity != null && (
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-500">Producido al cierre</span>
                        <span className="font-semibold text-emerald-700">
                          {Math.round(Number(selectedAssignment.produced_quantity)).toLocaleString()} pzas
                        </span>
                      </div>
                    )}
                    {selectedAssignment.status === "completed" && selectedAssignment.completed_at && (
                      <ModalRow k="Cerrada" v={fmtDMY(selectedAssignment.completed_at)} />
                    )}
                    {(() => {
                      const b = balanceOf(selectedAssignment);
                      if (!b) return null;
                      return (
                        <>
                          <ModalRow k="Cosido ese día" v={`${Math.round(b.produced).toLocaleString()} pzas`} />
                          {b.is_past && b.balance > 0 && (
                            <div className="flex justify-between gap-3">
                              <span className="text-gray-500">Saldo</span>
                              <span className="font-semibold text-rose-700">
                                {Math.round(b.balance).toLocaleString()} pzas sin hacer
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {wo && <>
                      <ModalRow k="Cliente" v={wo.customer_name} />
                      {wo.customer_po && <ModalRow k="PO cliente" v={wo.customer_po} />}
                      <ModalRow k="Total Orden" v={`${Math.round(targetOf(wo)).toLocaleString()} pzas`} />
                      {(() => {
                        const bd = buildBreakdownFromLines(wo.lines, selectedAssignment.color);
                        if (bd.length === 0) return null;
                        return (
                          <div className="pt-2 border-t">
                            <div className="text-gray-500 mb-1.5">Desglose · PO cliente → estilo → tallas</div>
                            <div className="space-y-2">
                              {bd.map((po, pi) => (
                                <div key={pi} className="rounded-lg bg-gray-50 border border-gray-100 p-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[12px] font-semibold text-gray-700">
                                      <span className="text-gray-400 font-normal">PO</span> {po.customerPo || "—"}
                                    </span>
                                    <span className="text-[11px] text-gray-400">{Math.round(po.total).toLocaleString()} pzas</span>
                                  </div>
                                  {po.styles.map((st, si) => (
                                    <div key={si} className="pl-2 mt-1">
                                      <div className="text-[11px] text-gray-500 font-mono flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${blockColor(blockGroupKey(selectedAssignment)).dot}`} />
                                        {selectedAssignment.color ? `${selectedAssignment.color} · ` : ""}{st.estilo || "—"}
                                      </div>
                                      {st.sizes.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                          {st.sizes.map((s) => (
                                            <span key={s.talla} className="text-[11px] rounded bg-blue-50 text-blue-700 px-1.5 py-0.5">
                                              {s.talla}: {Math.round(s.quantity).toLocaleString()}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Color del bloque en el tablero */}
                      <div className="pt-2 border-t">
                        {(() => {
                          const key = blockGroupKey(selectedAssignment);
                          const activeIdx = colorOverrides[key];
                          return (
                            <>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-gray-500">Color del grupo (mismo estilo)</span>
                                {activeIdx != null && (
                                  <button onClick={() => setBlockColor(key, null)} className="text-[11px] text-gray-500 hover:text-gray-800 underline">
                                    Automático
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {WO_PALETTE.map((c, i) => {
                                  const on = (activeIdx != null ? activeIdx === i : blockColor(key) === c);
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => setBlockColor(key, i)}
                                      title={`Color ${i + 1}`}
                                      className={`w-5 h-5 rounded-md ${c.bg} ${c.border} border ${on ? "ring-2 ring-gray-900 ring-offset-1" : ""}`}
                                    />
                                  );
                                })}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </>}
                  </>
                );
              })()}
            </div>
            <div className="px-3 py-2.5 border-t flex flex-wrap justify-between gap-2">
              {(() => {
                const sel = selectedAssignment;
                const sameOrderOnLine = assignments.filter(
                  (a) =>
                    a.work_order_id === sel.work_order_id &&
                    String(a.line_no) === String(sel.line_no) &&
                    !["cancelled"].includes(a.status)
                );
                // Only today/future cells may be removed; past cells are locked.
                const deletableOfOrder = sameOrderOnLine.filter((a) => !isLockedCell(a));
                const selLocked = isLockedCell(sel);
                const dayLabel = sel.assigned_date
                  ? fmtDMY(sel.assigned_date).slice(0, 5)
                  : fmtDMY(sel.planned_start_date).slice(0, 5);
                // Cells of this order/line from today onward — the ones we can
                // still push to the line leaders.
                const confirmableOfOrder = sameOrderOnLine.filter((a) => !isLockedCell(a));
                return (
                  <div className="flex flex-wrap gap-2">
                    {confirmableOfOrder.length > 0 && (
                      <button
                        disabled={dropBusy}
                        title="Crea el borrador en el lado de los líderes de línea para esta orden en esta línea."
                        onClick={async () => {
                          const n = confirmableOfOrder.length;
                          if (!window.confirm(`¿Enviar la orden ${woNo(sel)} de la Línea ${sel.line_no} a los líderes de línea? (${n} día(s))`)) return;
                          const ok = await confirmAssignments(confirmableOfOrder.map((a) => a.id));
                          if (ok) setSelectedAssignment(null);
                        }}
                        className="px-2.5 py-1.5 text-[12px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Enviar a líderes ({confirmableOfOrder.length})
                      </button>
                    )}
                    <button
                      disabled={dropBusy || selLocked}
                      title={selLocked ? "Este día ya pasó: la cantidad asignada anterior no se puede eliminar." : "Elimina solo esta casilla (este día)"}
                      onClick={() => {
                        if (selLocked) return;
                        if (window.confirm(`¿Quitar solo la casilla del ${dayLabel} en la Línea ${sel.line_no}?`)) {
                          removeAssignments([sel.id]);
                        }
                      }}
                      className="px-2.5 py-1.5 text-[12px] bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 border border-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {selLocked ? "Día pasado (bloqueado)" : "Quitar solo esta casilla"}
                    </button>
                    {deletableOfOrder.length > 1 && (
                      <button
                        disabled={dropBusy}
                        onClick={() => {
                          const past = sameOrderOnLine.length - deletableOfOrder.length;
                          if (window.confirm(`¿Quitar la orden ${woNo(sel)} de la Línea ${sel.line_no}? Se eliminarán ${deletableOfOrder.length} día(s) de hoy en adelante${past > 0 ? `; los ${past} día(s) pasados se conservan.` : "."}`)) {
                            removeAssignments(deletableOfOrder.map((a) => a.id));
                          }
                        }}
                        className="px-2.5 py-1.5 text-[12px] bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
                      >
                        Quitar orden de la línea ({deletableOfOrder.length})
                      </button>
                    )}
                  </div>
                );
              })()}
              <button onClick={() => setSelectedAssignment(null)} className="px-3 py-1.5 text-[12px] bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Planner standards per style: per line-day list, or every style */}
      {styleList && (() => {
        const isLine = !!styleList.lineNo;
        return (
          <StyleStandardsListModal
            title={isLine ? `Estándares por estilo — Línea ${styleList.lineNo}` : "Estándares por estilo"}
            subtitle={isLine
              ? "Estilos asignados en el día elegido. La capacidad de la línea se calcula con estos valores."
              : "SAM, operarios, horas y eficiencia que usa el Plan Board para calcular la capacidad."}
            styleParams={styleParams}
            lineParams={lineParams}
            lineNo={isLine ? styleList.lineNo : null}
            pendingEffByStyle={pendingEff}
            styles={isLine ? stylesOnLineDay(styleList.lineNo, styleList.date) : null}
            headerSlot={isLine ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                Día
                <input
                  type="date"
                  value={styleList.date}
                  onChange={(e) => setStyleList((s) => (s ? { ...s, date: e.target.value } : s))}
                  className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </label>
            ) : null}
            onEdit={(s) => openStyleForm(s, {
              context: isLine ? `Línea ${styleList.lineNo} · ${styleList.date}` : "",
              lineNo: isLine ? styleList.lineNo : null,
            })}
            onClose={() => setStyleList(null)}
          />
        );
      })()}
      {replanPrompt && (
        <ReplanLinesModal
          style={replanPrompt.style}
          recompute={replanPrompt.recompute}
          scopeLine={replanPrompt.scopeLine}
          onConfirm={(lines) => { replanPrompt.resolve(lines); setReplanPrompt(null); }}
          onCancel={() => { replanPrompt.resolve(null); setReplanPrompt(null); }}
        />
      )}
      {styleForm && (
        <StyleParamsFormModal
          style={styleForm.style}
          existing={styleForm.existing}
          suggestion={styleForm.suggestion}
          merchantSam={styleForm.merchantSam}
          context={styleForm.context}
          saveLabel={styleForm.saveLabel}
          canEdit={canEditStyles && !readOnly}
          saving={savingStyle}
          lineNo={styleForm.lineNo}
          lineOptions={styleForm.lineOptions}
          lineOverrides={styleForm.lineOverrides}
          pendingEffs={styleForm.pendingEffs}
          onResetLine={resetLineStandard}
          onCancelEffRequest={cancelEffRequest}
          onSave={saveStyleForm}
          onCancel={() => setStyleForm(null)}
        />
      )}

      {/* Aggregated period breakdown */}
      {aggModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAggModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Línea {aggModal.lineNo} — {aggModal.label}</h3>
              <p className="text-sm text-gray-500">{Math.round(aggModal.total).toLocaleString()} pzas · {aggModal.orders.length} orden(es)</p>
              {aggModal.preQty > 0 && (
                <p className="text-xs font-medium text-violet-600 mt-0.5">Incluye {Math.round(aggModal.preQty).toLocaleString()} pzas de pre-orden (reserva).</p>
              )}
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto divide-y">
              {aggModal.orders
                .sort((a, b) => b.qty - a.qty)
                .map((o) => (
                  <div key={o.id} className="py-2 flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(o.groupKey).dot}`} />
                    <span className="font-mono text-sm font-medium text-gray-800 flex-1 truncate">{o.no}</span>
                    {o.isHold && <span className="text-[8px] font-medium leading-none rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 shrink-0">reserva</span>}
                    {o.pre && <span className="text-[8px] font-bold leading-none rounded-full bg-violet-600 text-white px-1.5 py-0.5 shrink-0">PRE</span>}
                    <span className="text-sm text-gray-600">{Math.round(o.qty).toLocaleString()} pzas</span>
                  </div>
                ))}
            </div>
            <div className="px-6 py-4 border-t flex justify-end">
              <button onClick={() => setAggModal(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Add a planner-defined line (not yet configured by engineering) */}
      {addLine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !savingLine && setAddLine(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Agregar línea</h3>
              <p className="text-sm text-gray-500">Crea una línea que ingeniería aún no configuró para poder asignarle órdenes. Podrán ajustarla después.</p>
            </div>
            <div className="p-6 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Número de línea *</span>
                <input
                  autoFocus
                  value={addLine.lineNo}
                  onChange={(e) => setAddLine((s) => ({ ...s, lineNo: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") createPlannerLine(); }}
                  placeholder="p. ej. 9"
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Operarios</span>
                  <input type="number" min="1" value={addLine.operators}
                    onChange={(e) => setAddLine((s) => ({ ...s, operators: e.target.value }))}
                    placeholder="20" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Horas/día</span>
                  <input type="number" min="0.1" step="0.5" value={addLine.hours}
                    onChange={(e) => setAddLine((s) => ({ ...s, hours: e.target.value }))}
                    placeholder="8" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Eficiencia %</span>
                  <input type="number" min="1" max="100" value={addLine.effPct}
                    onChange={(e) => setAddLine((s) => ({ ...s, effPct: e.target.value }))}
                    placeholder="85" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">SAM (min)</span>
                  <input type="number" min="0.01" step="0.1" value={addLine.sam}
                    onChange={(e) => setAddLine((s) => ({ ...s, sam: e.target.value }))}
                    placeholder="3.5" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
                </label>
              </div>
              <p className="text-[11px] text-gray-400">Deje los campos vacíos para usar los valores por defecto (20 operarios · 8 h · 85% · SAM 3.5).</p>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setAddLine(null)} disabled={savingLine} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50">Cancelar</button>
              <button onClick={createPlannerLine} disabled={savingLine} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                {savingLine && <Loader2 className="w-4 h-4 animate-spin" />} Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leyenda del resaltado de entrega (flotante: no mueve el tablero durante el arrastre). */}
      {deliveryView && !dropBusy && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
          <div className="rounded-xl border border-gray-200 bg-white/95 backdrop-blur shadow-lg px-3 py-2 text-[12px] text-gray-700 flex flex-wrap items-center gap-x-3 gap-y-1 max-w-[92vw]">
            <b className="font-mono text-gray-900">
              {deliveryView.isMove
                ? (draggedAssignment ? `${woNo(draggedAssignment)}${draggedAssignment.color ? ` · ${draggedAssignment.color}` : ""}` : "")
                : `${activePO?.work_order_no || ""}${activePO?.color ? ` · ${activePO.color}` : ""}`}
            </b>
            {deliveryView.noStandard ? (
              <span className="text-amber-700">El estilo {deliveryView.style || "—"} no tiene estándar: no se puede proyectar la entrega.</span>
            ) : (
              <>
                <span>
                  {deliveryView.isMove ? "moviendo " : ""}{Math.round(deliveryView.qty).toLocaleString()} pzas · entrega <b>{deliveryView.delivery ? fmtDMY(deliveryView.delivery) : "sin fecha"}</b>
                  {deliveryView.deliveryPast && <span className="text-red-600 font-semibold"> (ya pasó)</span>}
                </span>
                {deliveryView.delivery && (
                  <>
                    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-400/60 ring-1 ring-emerald-600" />a tiempo</span>
                    {deliveryView.noneOnTime && (
                      <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-300/70 ring-1 ring-amber-500" />menos tardía</span>
                    )}
                    <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400/50 ring-1 ring-red-500" />atrasada</span>
                  </>
                )}
                {deliveryView.isMove ? (
                  deliveryView.otherMax && (
                    <span className="text-gray-500">sus otras casillas terminan el {fmtDMY(deliveryView.otherMax).slice(0, 5)}</span>
                  )
                ) : deliveryView.best ? (
                  <span className={deliveryView.best.ok === false ? "text-amber-700 font-semibold" : "text-emerald-700 font-semibold"}>
                    ⚡ Más rápida: L{deliveryView.best.line} (inicia {fmtDMY(deliveryView.best.start).slice(0, 5)}, termina {fmtDMY(deliveryView.best.finish).slice(0, 5)})
                    {deliveryView.best.ok === false ? " — ninguna línea llega a tiempo" : ""}
                  </span>
                ) : (
                  <span className="text-red-600 font-semibold">Ninguna línea la termina en el horizonte.</span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Undo the last insert (single drag or multi-select). Sits bottom-left so
          it never overlaps the centred toast. */}
      {lastInsertUndo && !readOnly && (
        <div className="fixed bottom-6 left-6 z-[60]">
          <button
            onClick={undoLastInsert}
            disabled={dropBusy}
            className="text-sm px-4 py-2 rounded-full shadow-lg bg-white border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            <span aria-hidden>↩︎</span> Deshacer inserción
          </button>
        </div>
      )}

      {/* Toast */}
      {changeBanner && (
        <div className="fixed bottom-20 right-6 z-[61] w-[380px] max-w-[92vw] rounded-xl border border-amber-300 bg-amber-50 shadow-xl p-3 text-left">
          <div className="flex items-start gap-2">
            <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-900">
                {changeBanner.pending > 0
                  ? "🔒 Cambios del merchant pendientes de aplicar"
                  : changeBanner.count === 1 ? "Orden modificada por el merchant" : "Órdenes modificadas por el merchant"}
              </div>
              <div className="mt-0.5 text-[12px] text-amber-900/90 break-words">{changeBanner.text}</div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setChangeBanner(null); setChangeOpen(true); }}
                  className="text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md px-2.5 py-1"
                >
                  Ver cambios
                </button>
                <button onClick={() => setChangeBanner(null)} className="text-[12px] text-amber-800 hover:underline">Cerrar</button>
              </div>
            </div>
            <button onClick={() => setChangeBanner(null)} className="p-0.5 rounded hover:bg-amber-100 text-amber-700" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw] ${toast.isError ? "bg-rose-600 text-white" : "bg-gray-900 text-white"}`}>
          {toast.isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
          <span className="truncate">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-3"><span className="text-gray-400">{k}:</span><span className="text-right capitalize truncate">{v}</span></div>;
}
function ModalRow({ k, v, bold }) {
  return <div className="flex justify-between"><span className="text-gray-500">{k}:</span><span className={`capitalize ${bold ? "font-medium" : ""}`}>{v}</span></div>;
}

// Line picker shown before a style-standard change re-plans existing cells.
// Same contract as StyleStandards' ReplanLinesModal:
//   recompute.lines = [{ line_no, daysBefore, daysAfter }], recompute.unplaced = [{ qty }]
//   onConfirm(lineNos[])  → re-plan only those lines ([] = save without re-planning)
//   onCancel()            → abort the save
function FallbackReplanLinesModal({ style, recompute, onConfirm, onCancel }) {
  const lines = (recompute && recompute.lines) || [];
  const [picked, setPicked] = useState(() => new Set(lines.map((l) => String(l.line_no))));
  const toggle = (k) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const lost = ((recompute && recompute.unplaced) || []).reduce((t, u) => t + (Number(u.qty) || 0), 0);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">Re-planear {style}</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            El nuevo estándar cambia cuántos días ocupan las celdas ya programadas. Elija qué líneas re-planear.
          </p>
        </div>
        <div className="max-h-[50vh] space-y-1.5 overflow-auto px-4 py-3">
          {lines.length === 0 && <p className="text-sm text-gray-500">No hay líneas afectadas.</p>}
          {lines.map((l) => {
            const k = String(l.line_no);
            return (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />
                <span className="font-semibold text-gray-800">L{l.line_no}</span>
                <span className="ml-auto tabular-nums text-gray-600">{l.daysBefore} → {l.daysAfter} día(s)</span>
              </label>
            );
          })}
          {lost > 0 && (
            <p className="text-xs text-amber-700">{Math.round(lost).toLocaleString()} pzas no caben y regresan a la bolsa.</p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3">
          <button onClick={onCancel} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">Cancelar</button>
          <button onClick={() => onConfirm([])} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200">Guardar sin re-planear</button>
          <button
            onClick={() => onConfirm(lines.filter((l) => picked.has(String(l.line_no))).map((l) => l.line_no))}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            Re-planear {picked.size} línea(s)
          </button>
        </div>
      </div>
    </div>
  );
}