// components/planner/PlanBoard.jsx
import { useState, useEffect, useMemo } from "react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, startOfYear, addMonths, eachWeekOfInterval, eachMonthOfInterval, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Package, Loader2, Check, AlertCircle, GripVertical, Search, X } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO, WO_PALETTE, buildStyleColorMap } from "../../lib/workOrderColors";
import PendingBalances, { useDayBalances, cellKey } from "./PendingBalances";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const producedOf = (wo) => Number(wo?.produced_quantity) || 0;
// A piece still needs a line only if it is NEITHER actively assigned NOR
// already produced. Production is tracked per order (in line_runs),
// independently of the board, so it survives deleting assignment cells and can
// outrun `assigned`. Take the greater of the two as "coverage" so the leftover
// is the true gap to the goal — e.g. 7,200 - max(3,490 assigned, 7,134
// produced) = 66, not the stale 7,200 - 3,490 = 3,710.
const coveredOf = (wo) => Math.max(assignedOf(wo), producedOf(wo));
const remainingOf = (wo) => Math.max(targetOf(wo) - coveredOf(wo), 0);

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
const LABEL = 52;  // px — line label column width

export default function PlanBoard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState("week"); // day, week, month
  const [assignments, setAssignments] = useState([]);
  const [holds, setHolds] = useState([]); // PRE#### line/day holds (Plan Board reservations)
  const [workOrders, setWorkOrders] = useState([]);
  const [lineRuns, setLineRuns] = useState([]);
  const [plannerLines, setPlannerLines] = useState([]); // lines the planner added but engineering hasn't configured
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [hovered, setHovered] = useState(null); // { assignment, x, y }

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
  const [toast, setToast] = useState(null);
  const [showPool, setShowPool] = useState(true);
  const [showSizes, setShowSizes] = useState(false); // compact pool by default; reveal size chips on demand
  // One search box for WO / estilo / PO cliente. It filters the merchant pool
  // AND dims the grid cells so only the searched order's blocks stand out.
  const [search, setSearch] = useState("");
  const [editLine, setEditLine] = useState(null); // { lineNo, rows: [{ style, run, operators }] } — per-style operators editor
  const [savingOps, setSavingOps] = useState(false);

  // The merchant's weekly plan drives which orders reach the pool and their
  // target week. `merchantOk` is false only if that fetch fails → we then fall
  // back to the previous behavior (show every open order) so the board still works.
  const [merchantPlan, setMerchantPlan] = useState([]);
  const [merchantOk, setMerchantOk] = useState(true);

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

  useEffect(() => { fetchData(); }, []);

  // Al volver a la pestaña, re-sincroniza en silencio. Es como se entera de que
  // una pre-orden ya se convirtió (o de que el merchant movió una semana) sin
  // recargar a mano. Nunca durante un arrastre o una selección, para no mover
  // el piso bajo los pies.
  useEffect(() => {
    const onFocus = () => {
      if (draggedPO || armedPO || draggedAssignment || dropBusy || selectMode) return;
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
        if (wasPicking) return false;        // first Esc: just leave dest mode
        setSelectMode(false); setSelectedIds(new Set()); // second Esc: leave select mode
        return false;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Individual cells only exist in Diario; leaving that view drops selection.
  useEffect(() => {
    if (viewMode !== "day") { setSelectMode(false); setPickingDest(false); setSelectedIds(new Set()); }
  }, [viewMode]);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = async ({ silent = false } = {}) => {
    // Only the initial mount shows the full-page "Cargando Plan Board..."
    // gate. Post-mutation refetches pass { silent: true } so the board stays
    // rendered and updates in place instead of flashing the loader.
    if (!silent) setLoading(true);
    try {
      const [aRes, woRes, lrRes, mpRes, plRes, hRes] = await Promise.all([
        fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/line-runs`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/merchant-plan`, { headers: authHeaders() }).catch(() => null),
        fetch(`${API_URL}/api/planning/lines`, { headers: authHeaders() }).catch(() => null),
        fetch(`${API_URL}/api/pre-order-holds`, { headers: authHeaders() }).catch(() => null),
      ]);
      const a = await aRes.json(); if (a.success) setAssignments(a.assignments);
      // Pre-order holds on line/day cells. Optional: an older backend without the
      // endpoint just yields no holds, and the board renders as before.
      try {
        const h = hRes && hRes.ok ? await hRes.json() : null;
        setHolds(h && h.success ? (h.holds || []) : []);
      } catch { setHolds([]); }
      const wo = await woRes.json(); if (wo.success) setWorkOrders(wo.workOrders);
      const lr = await lrRes.json(); if (lr.success) setLineRuns(lr.runs);
      if (plRes) { const pl = await plRes.json().catch(() => null); if (pl?.success) setPlannerLines(pl.lines || []); }
      // The merchant weekly plan is the upstream source for the pool.
      try {
        const mp = mpRes && mpRes.ok ? await mpRes.json() : null;
        if (mp && mp.success) { setMerchantPlan(mp.plan || []); setMerchantOk(true); }
        else { setMerchantPlan([]); setMerchantOk(false); }
      } catch { setMerchantPlan([]); setMerchantOk(false); }
    } catch (err) {
      console.error("Error fetching plan board data:", err);
    } finally {
      setLoading(false);
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

  const unassignedPOs = workOrders
    .filter((wo) => remainingOf(wo) > 0 && !["completed", "cancelled"].includes(wo.status))
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
  const preOrderJobs = useMemo(() => (merchantPlan || [])
    .filter((r) => r.pre_order_id != null)
    .map((r) => ({
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
      remaining: Number(r.cantidad) || 0,
      sizes: Array.isArray(r.sizes) ? r.sizes : [],
      breakdown: [],
      sam_minutes: Number(r.sam_minutes) || 0,
      commitment_date: null,
      week: r.week_start || null,
    })), [merchantPlan]);
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
  const isSearching = searchTerms.length > 0;

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
      ];
      const lines = Array.isArray(wo.lines) ? wo.lines : [];
      for (const l of lines) parts.push(l?.estilo, l?.customerPo);
      m.set(wo.id, norm(parts.filter(Boolean).join(" ")));
    }
    return m;
  }, [workOrders]);

  // True when no search is active, or every term hits the order's haystack.
  const woMatchesSearch = (woId) => {
    if (!isSearching) return true;
    const hay = searchHaystackByWoId.get(woId) || "";
    return searchTerms.every((t) => hay.includes(t));
  };

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
      const cap = remainingOf(wo); // goal - max(assigned, produced); never < 0
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
  }, [workOrders, assignments, merchantByKey, gateByMerchant]);

  // Pool after the search box. Order-level match keeps every color of a hit
  // order visible together (searchHaystackByWoId already folds in all lines).
  const filteredPoolJobs = useMemo(
    () => (isSearching ? poolJobs.filter((j) => woMatchesSearch(j.workOrderId)) : poolJobs),
    [poolJobs, isSearching, searchHaystackByWoId, searchTerms]
  );

  // Las pre-órdenes no están en workOrders, así que se buscan sobre sus propios
  // campos (PRE####, cliente, estilo, PO cliente).
  const filteredPreOrderJobs = useMemo(() => {
    if (!isSearching) return preOrderJobs;
    return preOrderJobs.filter((j) => {
      const hay = norm([j.work_order_no, j.style_code, j.estilo, j.customer_name, j.customer_po].filter(Boolean).join(" "));
      return searchTerms.every((t) => hay.includes(t));
    });
  }, [preOrderJobs, isSearching, searchTerms]);

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

  const getDateRange = () => {
    // Daily view: weekdays only (no weekend work) up to ~6 months ahead. Hiding
    // Sat/Sun roughly triples the density so ~3 months fit without scrolling.
    if (viewMode === "day") {
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
    if (viewMode === "week") {
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
  }, [viewMode, currentDate]);

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
        groupKey: blockGroupKey(a),
        no: `${woNo(a)}${a.color ? " · " + a.color : ""}`,
        qty: 0,
        pre: isPreOrder(a.work_order_id, a.color) || isPreOrder(a.work_order_no, a.color),
      };
      cur.qty += q;
      orders.set(k, cur);
    });
    const list = [...orders.values()];
    return { total, orders: list, hasPre: list.some((o) => o.pre) };
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
  // Real capacity per line-day, then summed over the period's working weekdays.
  //
  // A line can split across SEVERAL styles in one day — each style is its own
  // line_run with its own target_pcs (operators×hours×60×eff÷SAM for that style's
  // share of the line). The line's daily capacity is therefore the SUM of all
  // runs configured that day. For days with no run of their own we carry forward
  // the most-recent configured day's total (else the closest future one, else the
  // planner-line target), mirroring the server's "most-recent config on/before
  // the date" rule. /api/line-runs sends the full history, so this needs no
  // per-day server round-trip. Weekends are non-working and add no capacity.
  const dayTotalsByLine = useMemo(() => {
    const perLineDay = new Map(); // line -> Map(dayStr -> summed target_pcs)
    for (const r of lineRuns) {
      if (r.line_no == null || r.target_pcs == null) continue;
      const k = String(r.line_no);
      const d = ymd(r.run_date);
      if (!d) continue;
      if (!perLineDay.has(k)) perLineDay.set(k, new Map());
      const dm = perLineDay.get(k);
      dm.set(d, (dm.get(d) || 0) + (Number(r.target_pcs) || 0)); // sum styles on the same day
    }
    const out = new Map();
    for (const [k, dm] of perLineDay) {
      out.set(
        k,
        [...dm.entries()]
          .map(([d, total]) => ({ d, total }))
          .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
      );
    }
    return out;
  }, [lineRuns]);

  // A line's real daily capacity on a specific date (summed styles + carry-forward).
  const targetForLineOnDate = (lineNo, dayStr) => {
    const days = dayTotalsByLine.get(String(lineNo));
    if (days && days.length) {
      let chosen = null;
      for (const e of days) { if (e.d <= dayStr) chosen = e; else break; }
      return chosen ? chosen.total : days[0].total; // most-recent on/before, else closest future
    }
    return Math.round(Number(plannerLineMap[String(lineNo)]?.target_pcs) || 0); // planner line, no run yet
  };

  // Sum the real daily capacity over the working weekdays in the period.
  const periodCapacity = (lineNo, startYmd, endYmd) => {
    let sum = 0;
    let d = new Date(`${startYmd}T00:00:00`);
    const end = new Date(`${endYmd}T00:00:00`);
    while (d <= end) {
      const g = d.getDay();
      if (g !== 0 && g !== 6) sum += targetForLineOnDate(lineNo, ymd(d));
      d = addDays(d, 1);
    }
    return sum;
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
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

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

  const step = (dir) => {
    if (viewMode === "day") return setCurrentDate(addDays(currentDate, dir * 7));
    if (viewMode === "week") return setCurrentDate(addDays(currentDate, dir * 28));
    if (viewMode === "month") return setCurrentDate(addMonths(currentDate, dir * 12)); // whole year
    return setCurrentDate(addMonths(currentDate, dir * 12 * 6)); // year view = 6-year window
  };
  const goPrevious = () => step(-1);
  const goNext = () => step(1);
  const goToday = () => setCurrentDate(new Date());

  // ---- capacity helper (for the line label only) ------------------------
  const latestTargetForLine = (lineNo) => {
    const runs = lineRuns
      .filter((lr) => String(lr.line_no) === String(lineNo) && lr.target_pcs)
      .sort((a, b) => new Date(b.run_date) - new Date(a.run_date));
    return runs.length ? Math.round(runs[0].target_pcs) : 0;
  };

  // Most recent run for a line (its operators/hours/efficiency/SAM baseline).
  const latestRunForLine = (lineNo) => {
    const runs = lineRuns
      .filter((lr) => String(lr.line_no) === String(lineNo))
      .sort((a, b) => new Date(b.run_date) - new Date(a.run_date));
    return runs[0] || null;
  };

  // The MERCHANT SAM for a given estilo/style. The run's own sam_minutes (the
  // "SAM producción") can drift from the real style SAM the merchant set on the
  // master_code; that real SAM travels with the work order (work_orders.sam_minutes).
  // line_runs.style stores the style_code, so we match it back to a loaded work order
  // (by style_code, else estilo). Returns null when no merchant SAM is known.
  const merchantSamForStyle = (styleCode) => {
    const code = String(styleCode || "").trim().toUpperCase();
    if (!code) return null;
    const norm = (s) => String(s || "").trim().toUpperCase();
    const wo = workOrders.find((w) => norm(w.style_code) === code || norm(w.estilo) === code);
    const sam = Number(wo?.sam_minutes) || 0;
    if (sam <= 0) return null;
    return { sam, estilo: String(wo?.estilo || "").trim() };
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

  // The line_run that provides the capacity baseline (operators / hours /
  // efficiency / SAM) for a given (line, style_code). Prefer the run on the exact
  // day, else the most recent run of that style; fall back to the assignment's
  // linked run only so a preview can still render.
  const runForStyle = (lineNo, dateStr, style, linkedRun) => {
    const matches = lineRuns.filter(
      (r) => String(r.line_no) === String(lineNo) && sameStyle(r.style, style)
    );
    if (matches.length) {
      const exact = matches.find((r) => ymd(r.run_date) === dateStr);
      if (exact) return exact;
      return matches.sort((x, y) => new Date(y.run_date) - new Date(x.run_date))[0];
    }
    return linkedRun || null;
  };

  // Styles to edit for a line on a specific day, keyed by style_code so the two
  // sources line up:
  //   (a) the actual line_runs for that line-day → edited IN PLACE (no dup), and
  //   (b) styles ASSIGNED that day whose style_code has no run yet → a run gets
  //       created on save.
  const stylesAssignedOnDay = (lineNo, dateStr) => {
    if (!dateStr) return [];
    const norm = (s) => String(s || "").trim().toUpperCase();
    const byStyle = new Map(); // normalized style_code -> { style, run }

    // (a) Runs configured for this line on this day.
    for (const run of lineRuns.filter((r) => String(r.line_no) === String(lineNo) && ymd(r.run_date) === dateStr)) {
      const style = String(run.style || "").trim();
      const key = norm(style);
      if (!key) continue;
      if (!byStyle.has(key)) byStyle.set(key, { style, run });
    }

    // (b) Styles assigned that day (by the orders' style_code) not already covered.
    const cell = assignments.filter(
      (a) => cellMatches(a, lineNo, dateStr) && !["cancelled", "rejected"].includes(a.status)
    );
    for (const a of cell) {
      const style = styleCodeOfAssignment(a);
      const key = norm(style);
      if (!key || byStyle.has(key)) continue;
      const linkedRun = a.line_run_id != null
        ? lineRuns.find((r) => String(r.id) === String(a.line_run_id))
        : null;
      byStyle.set(key, { style, run: runForStyle(lineNo, dateStr, style, linkedRun) });
    }

    return [...byStyle.values()].sort((a, b) => String(a.style).localeCompare(String(b.style)));
  };

  // Open the operators editor for a line, seeded to today's assigned styles.
  const openOperatorsEditor = (lineNo) => {
    const effDate = format(new Date(), "yyyy-MM-dd");
    const rows = stylesAssignedOnDay(lineNo, effDate);
    const ops = Object.fromEntries(rows.map((r) => [r.style, String(Number(r.run?.operators_count) || 0)]));
    setEditLine({
      lineNo,
      effDate, // the day whose assigned styles we edit (default today)
      scope: "from", // "from" = this date onward, "day" = only this date
      ops, // { [style]: "operatorCount" } — editable values
    });
  };

  // Change the day: re-derive that day's assigned styles and reseed the inputs.
  const setEditDate = (dateStr) => {
    setEditLine((s) => {
      if (!s) return s;
      const rows = stylesAssignedOnDay(s.lineNo, dateStr);
      const ops = Object.fromEntries(rows.map((r) => [r.style, String(Number(r.run?.operators_count) || 0)]));
      return { ...s, effDate: dateStr, ops };
    });
  };

  // Update one style's operator value (kept as a string for the input).
  const setRowOperators = (style, value) => {
    setEditLine((s) => (s ? { ...s, ops: { ...s.ops, [style]: value } } : s));
  };

  // Persist operator changes. Only styles whose count actually changed are sent;
  // each PATCH is scoped to (line, style) + the chosen date/scope so the server
  // recomputes that style's daily capacity without touching earlier dates.
  const saveOperators = async () => {
    if (!editLine) return;
    if (!editLine.effDate) return showToast("Seleccione una fecha", true);
    const rows = stylesAssignedOnDay(editLine.lineNo, editLine.effDate);
    for (const r of rows) {
      const n = parseInt(editLine.ops[r.style]);
      if (isNaN(n) || n < 0) return showToast(`Número de operarios inválido para ${r.style || "—"}`, true);
    }
    const changed = rows.filter(
      (r) => parseInt(editLine.ops[r.style]) !== (Number(r.run?.operators_count) || 0)
    );
    if (changed.length === 0) { setEditLine(null); return; }
    setSavingOps(true);
    // Scope the write: "day" = only editLine.effDate, "from" = that date onward.
    const scopeBody = editLine.scope === "day"
      ? { date: editLine.effDate }
      : { from: editLine.effDate };
    try {
      for (const r of changed) {
        const res = await fetch(`${API_URL}/api/line-runs/operators`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ lineNo: editLine.lineNo, style: r.style, operators: parseInt(editLine.ops[r.style]), ...scopeBody }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || `No se pudo actualizar ${r.style || "—"}`);
      }
      await fetchData({ silent: true });
      showToast(`✅ Línea ${editLine.lineNo}: operarios actualizados (${changed.length} estilo${changed.length === 1 ? "" : "s"})`);
      setEditLine(null);
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setSavingOps(false);
    }
  };

  // Capacity math for the editor:
  //   available min/day = operators × working_hours × 60 × efficiency
  //   pieces/day        = available min/day ÷ SAM
  const previewCapacity = (run, operators) => {
    const wh = Number(run?.working_hours) || 0;
    const eff = Number(run?.efficiency) || 0;
    const sam = Number(run?.sam_minutes) || 0;
    const availableMin = operators * wh * 60 * eff;
    const pcs = sam > 0 ? availableMin / sam : 0;
    return { availableMin, pcs };
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

  // ---- DROP: fill the line day by day, carrying the remainder forward ----
  const assignPOAcrossDays = async (po, lineNo, startDate) => {
    // A pre-order card places a HOLD, not a real assignment.
    if (po.isPreOrderRow || po.preOrderId != null) return assignHoldAcrossDays(po, lineNo, startDate);
    let remaining = po.remaining != null ? po.remaining : remainingOf(po);
    if (remaining <= 0) return showToast("Esta PO ya está totalmente asignada.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""}${po.isPreOrder ? " · PRE-ORDEN" : ""}`;

    setDropBusy(true);
    let day = new Date(startDate);
    let created = 0, assignedTotal = 0;
    let daysScanned = 0, failures = 0;
    let skippedNoCap = 0, skippedFull = 0;
    const MAX_DAYS = 180;        // scan up to ~6 months (matches the day-view horizon)
    const MAX_FAILURES = 3;      // stop only on real server errors, not skipped days
    const errors = [];
    const capCache = {};         // dateStr -> lines[] (fetched once per day)

    try {
      while (remaining > 0 && daysScanned < MAX_DAYS && failures < MAX_FAILURES) {
        daysScanned++;
        // No production on weekends — skip Sat/Sun (not a failure).
        if (day.getDay() === 0 || day.getDay() === 6) { day = addDays(day, 1); continue; }
        const dateStr = format(day, "yyyy-MM-dd");

        // A day may already carry other POs; available_capacity is the line's
        // daily target minus everything already assigned, so packing here just
        // fills whatever room is left before spilling to the next day.
        if (!capCache[dateStr]) capCache[dateStr] = await fetchAvailableForDate(dateStr);
        const lineInfo = capCache[dateStr].find((l) => String(l.line_no) === String(lineNo));

        // No capacity configured for this line/date → skip the day (not a failure).
        if (!lineInfo) {
          skippedNoCap++;
          day = addDays(day, 1);
          continue;
        }

        const available = Math.floor(Number(lineInfo.available_capacity) || 0);
        if (available <= 0) { skippedFull++; day = addDays(day, 1); continue; } // day full → next day

        const qty = Math.min(remaining, available);
        const res = await fetch(`${API_URL}/api/line-assignments`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            workOrderId: po.workOrderId != null ? po.workOrderId : po.id,
            lineNo: lineInfo.line_no,           // exact value the backend expects
            assignedDate: dateStr,
            quantity: qty,
            plannedStartDate: dateStr,
            color: po.color || null,
          }),
        });
        const data = await res.json();

        if (data.success) {
          created++;
          assignedTotal += qty;
          remaining -= qty;
          lineInfo.available_capacity = available - qty; // keep cache consistent
          day = addDays(day, 1);
        } else {
          failures++;
          errors.push(`${dateStr}: ${data.error || res.status}`);
          day = addDays(day, 1);
        }
      }

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
  const assignHoldAcrossDays = async (po, lineNo, startDate) => {
    let remaining = po.remaining != null ? po.remaining : (Number(po.cantidad) || 0);
    if (remaining <= 0) return showToast("Esta pre-orden no tiene piezas por reservar.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""} · PRE-ORDEN`;

    setDropBusy(true);
    let day = new Date(startDate);
    let created = 0, heldTotal = 0, daysScanned = 0, failures = 0;
    let skippedNoCap = 0, skippedFull = 0;
    const MAX_DAYS = 180, MAX_FAILURES = 3;
    const errors = [];
    const capCache = {};

    try {
      while (remaining > 0 && daysScanned < MAX_DAYS && failures < MAX_FAILURES) {
        daysScanned++;
        if (day.getDay() === 0 || day.getDay() === 6) { day = addDays(day, 1); continue; }
        const dateStr = format(day, "yyyy-MM-dd");

        if (!capCache[dateStr]) capCache[dateStr] = await fetchAvailableForDate(dateStr);
        const lineInfo = capCache[dateStr].find((l) => String(l.line_no) === String(lineNo));
        if (!lineInfo) { skippedNoCap++; day = addDays(day, 1); continue; }

        const available = Math.floor(Number(lineInfo.available_capacity) || 0);
        if (available <= 0) { skippedFull++; day = addDays(day, 1); continue; }

        const qty = Math.min(remaining, available);
        const res = await fetch(`${API_URL}/api/pre-order-holds`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            preOrderId: po.preOrderId,
            lineNo: lineInfo.line_no,
            assignedDate: dateStr,
            quantity: qty,
            color: po.color || "",
            preOrderNo: po.work_order_no,
            customerName: po.customer_name,
            styleCode: po.style_code,
            estilo: po.estilo,
          }),
        });
        const data = await res.json();
        if (data.success) {
          created++; heldTotal += qty; remaining -= qty;
          lineInfo.available_capacity = available - qty; // keep cache consistent
          day = addDays(day, 1);
        } else {
          failures++; errors.push(`${dateStr}: ${data.error || res.status}`); day = addDays(day, 1);
        }
      }

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
    if (!a?.holdId || dropBusy) return;
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
    const total = po.remaining != null ? po.remaining : remainingOf(po);
    if (total <= 0) return showToast("Esta PO ya está totalmente asignada.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""}`;
    const woId = po.workOrderId != null ? po.workOrderId : po.id;
    const color = po.color || null;

    setDropBusy(true);
    const MAX_DAYS = 180;
    const ymdStr = (d) => format(d, "yyyy-MM-dd");
    const isWknd = (d) => d.getDay() === 0 || d.getDay() === 6;
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
        if (!occ.has(k)) occ.set(k, []);
        occ.get(k).push(a);
      }
      const isEmptyDay = (dstr) => !(occ.get(dstr) && occ.get(dstr).length);

      // 1) Size the leftover into whole-day cells, capped at each start day's
      //    capacity. This tells us S (how many front slots we must free).
      const startWD = firstWD(new Date(startDate));
      const capOfDay = async (dstr) => {
        const lines = await fetchAvailableForDate(dstr);
        const li = lines.find((l) => String(l.line_no) === String(lineNo));
        return li ? Math.floor(Number(li.target_pcs ?? li.available_capacity) || 0) : 0;
      };
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
  const reassignBalance = async (row) => {
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

  const handleDrop = (e, lineNo, date) => {
    e.preventDefault();
    setDropTarget(null);
    if (dropBusy) return;

    if (isWeekend(date)) {
      showToast("No se puede asignar en fin de semana. Elija un día entre semana.", true);
      setDraggedAssignment(null);
      return;
    }

    // Moving an existing assignment to another line/day.
    if (draggedAssignment) {
      const target = getAssignmentForLineAndDate(lineNo, date);
      if (target && target.id === draggedAssignment.id) { setDraggedAssignment(null); return; } // dropped on itself
      if (target) { showToast("Ese día ya está ocupado. Elija un día libre.", true); setDraggedAssignment(null); return; }
      moveAssignment(draggedAssignment, lineNo, date);
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
      } else {
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

  // ---- multi-cell selection ---------------------------------------------
  const exitSelectMode = () => {
    setSelectMode(false);
    setPickingDest(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Pile every selected block into the target line/day and re-pack forward.
  const batchMove = async (ids, lineNo, date) => {
    if (!ids.length || dropBusy) return;
    setDropBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/move-batch`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ids, lineNo, assignedDate: format(date, "yyyy-MM-dd") }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData({ silent: true });
        balances.reload({ silent: true });
        showToast(`✅ ${ids.length} casilla(s) movida(s) a Línea ${lineNo} · ${format(date, "dd/MM")}`);
        exitSelectMode();
      } else {
        showToast(data.error || "No se pudieron mover las casillas", true);
      }
    } catch (err) {
      showToast(`Error al mover: ${err.message}`, true);
    } finally {
      setDropBusy(false);
    }
  };
  const chooseDestination = (lineNo, date) => {
    if (isWeekend(date)) {
      showToast("No se puede mover a un fin de semana. Elija un día entre semana.", true);
      return;
    }
    batchMove([...selectedIds], lineNo, date);
  };
  // Delete ONLY the cells the user checked. Past (locked) cells are dropped and
  // reported; removeAssignments enforces the same lock as a second guard.
  const deleteSelected = async () => {
    const selObjs = assignments.filter((a) => selectedIds.has(a.id));
    if (!selObjs.length || dropBusy) return;
    const deletable = selObjs.filter((a) => !isLockedCell(a));
    if (deletable.length === 0) {
      showToast("Las casillas seleccionadas son de días pasados y no se pueden eliminar.", true);
      return;
    }
    const lockedN = selObjs.length - deletable.length;
    if (!window.confirm(`¿Eliminar ${deletable.length} casilla(s) seleccionada(s)?${lockedN > 0 ? ` (${lockedN} de días pasados se conservan)` : ""}`)) return;
    await removeAssignments(deletable.map((a) => a.id));
    exitSelectMode();
  };

  // Tap a cell: in select mode it either destination-picks; while armed it packs
  // a pool PO here; otherwise individual blocks open their own detail on click.
  const handleCellClick = (lineNo, date) => {
    if (selectMode) {
      if (pickingDest) chooseDestination(lineNo, date); // chooseDestination guards weekends
      return; // selecting phase: empty cells do nothing
    }
    if (armedPO && !dropBusy) {
      if (isWeekend(date)) {
        showToast("No se puede asignar en fin de semana. Elija un día entre semana.", true);
        return;
      }
      assignPOAcrossDays(armedPO, lineNo, date);
    }
  };

  // Remove one or more assignments from a line.
  const removeAssignments = async (ids) => {
    if (!ids || ids.length === 0) return;
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

  const gridCols = `${LABEL}px repeat(${dateRange.length}, ${CELL}px)`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Cargando Plan Board...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Plan Board</h2>
            <p className="text-sm text-gray-600">Arrastre una orden del panel izquierdo a una casilla de la línea —o tóquela y luego toque la casilla— para programarla</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-1">
              {["day", "week", "month", "year"].map((m) => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-3 py-1.5 text-sm rounded-md transition ${viewMode === m ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-800"}`}>
                  {m === "day" ? "Diario" : m === "week" ? "Semanal" : m === "month" ? "Mensual" : "Año"}
                </button>
              ))}
            </div>
            <button onClick={goToday} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Hoy</button>
            <button
              onClick={() => setAddLine({ lineNo: "", operators: "", hours: "", effPct: "", sam: "" })}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              title="Agregar una línea que ingeniería aún no configuró para poder asignarle órdenes"
            >
              + Línea
            </button>
            {lineOrder.length > 0 && (
              <button
                onClick={resetLineOrder}
                title="Restablecer el orden de las líneas al orden numérico"
                className="px-3 py-1.5 text-sm rounded-lg transition bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Restablecer orden
              </button>
            )}
            {viewMode === "day" && (
              <button
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                className={`px-3 py-1.5 text-sm rounded-lg transition ${selectMode ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                {selectMode ? "Selección: ON" : "Seleccionar"}
              </button>
            )}
            <div className="flex gap-1">
              <button onClick={goPrevious} className="p-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={goNext} className="p-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
        <div className="mt-3 text-sm text-gray-500">
          {viewMode === "day" && dateRange.length > 0 && `${format(dateRange[0], "d MMM", { locale: es })} – ${format(dateRange[dateRange.length - 1], "d MMM yyyy", { locale: es })}`}
          {viewMode === "week" && periods.length > 0 && `${format(new Date(`${periods[0].start}T00:00:00`), "d MMM")} – ${format(new Date(`${periods[periods.length - 1].end}T00:00:00`), "d MMM yyyy")}`}
          {viewMode === "month" && format(currentDate, "yyyy")}
          {viewMode === "year" && periods.length > 0 && `${periods[0].bottom} – ${periods[periods.length - 1].bottom}`}
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
        <div className="sticky top-0 z-40 px-5 py-2 bg-indigo-50 border-b border-indigo-200 text-sm text-indigo-900 flex items-center gap-3">
          {!pickingDest ? (
            <>
              <span className="truncate">
                <b>{selectedIds.size}</b> casilla(s) seleccionada(s) — toque los bloques para marcar (cualquier línea), luego Mover o Eliminar.
              </span>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <button
                  disabled={selectedIds.size === 0 || dropBusy}
                  onClick={() => setPickingDest(true)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Mover…
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
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Moviendo…</span>
                ) : (
                  <>Toque la casilla <b>destino</b> — las <b>{selectedIds.size}</b> casilla(s) se reacomodan ahí día por día.</>
                )}
              </span>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <button
                  disabled={dropBusy}
                  onClick={() => setPickingDest(false)}
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
      {viewMode === "day" && (
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
            <button onClick={() => setShowPool((v) => !v)} className="text-xs text-gray-500 hover:text-gray-700">
              {showPool ? "Ocultar" : "Mostrar"}
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
                Sin coincidencias para «{search.trim()}».
                {" "}
                <button onClick={() => setSearch("")} className="text-amber-700 underline hover:text-amber-800">Limpiar</button>
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
                              <div key={job.key} draggable={!dropBusy}
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", job.key);
                                  setArmedPO(null);
                                  setDraggedPO(job);
                                }}
                                onDragEnd={() => { setDraggedPO(null); setDropTarget(null); }}
                                onClick={() => setArmedPO((cur) => (cur?.key === job.key ? null : job))}
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
                                  <span className="text-[9px] text-violet-500 truncate">reserva de capacidad</span>
                                </div>
                              </div>
                            );
                            return (
                              <div key={job.key} draggable={!dropBusy}
                                onDragStart={(e) => {
                                  // Required for the drag to actually start in Firefox / some browsers.
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", job.key);
                                  setArmedPO(null);      // dragging supersedes a tapped selection
                                  setDraggedPO(job);
                                }}
                                onDragEnd={() => { setDraggedPO(null); setDropTarget(null); }}
                                onClick={() => setArmedPO((cur) => (cur?.key === job.key ? null : job))}
                                title={`${job.work_order_no}${job.color ? " · " + job.color : ""}${isPre ? " · PRE-ORDEN" : ""} — ${job.customer_name || ""}\nArrástrela a una línea, o tóquela y luego toque una casilla libre`}
                                className={`rounded-lg border bg-white px-2.5 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${isActive ? "ring-2 ring-amber-500 border-amber-400" : isPre ? "border-dashed border-violet-500 ring-1 ring-violet-200" : "border-gray-200 hover:border-amber-300"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(colorGroupKey(job.style_code, job.key)).dot}`} />
                                  <span className="font-mono text-[12px] font-bold text-gray-900 truncate flex-1 min-w-0">{job.work_order_no}</span>
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
                                  {job.commitment_date && (
                                    <span className="text-[10px] text-gray-400" title="Fecha compromiso">{format(new Date(job.commitment_date), "dd/MM")}</span>
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
      <div className="flex-1 min-w-0 overflow-auto relative px-4 pb-4 pt-3 bg-white">
        {dropBusy && (
          <div className="absolute inset-0 z-40 bg-white/60 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-700 text-sm bg-white border rounded-lg px-4 py-2 shadow">
              <Loader2 className="w-4 h-4 animate-spin" /> Programando…
            </div>
          </div>
        )}

        {!aggregated && (
        <div className="inline-block">
          {/* Day header row */}
          <div className="grid items-end sticky top-0 z-20 bg-white" style={{ gridTemplateColumns: gridCols, gap: GAP, paddingBottom: GAP }}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 z-30 bg-white pr-2 self-stretch flex items-end border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.18)]">Línea</div>
            {dateRange.map((date, idx) => {
              const isToday = isSameDay(date, new Date());
              // With weekends hidden the 1st may not be a visible column, so a
              // month starts wherever the month changes from the previous cell.
              const prev = idx > 0 ? dateRange[idx - 1] : null;
              const monthStart = idx === 0 || !prev || prev.getMonth() !== date.getMonth() || prev.getFullYear() !== date.getFullYear();
              return (
                <div key={idx} className={`relative text-center leading-tight ${monthStart && idx !== 0 ? "border-l border-gray-300" : ""} text-gray-500`} style={{ width: CELL }}>
                  {monthStart && (
                    <div className="text-[8px] font-bold uppercase tracking-wide text-indigo-500 leading-none">{format(date, "MMM", { locale: es })}</div>
                  )}
                  {/* Número de semana: una vez por semana (lunes o primera columna). */}
                  {(idx === 0 || date.getDay() === 1) && (
                    <div className="text-[8px] font-semibold text-violet-500 leading-none" title="Semana del año">
                      S{getWeek(date, { weekStartsOn: 1 })}
                    </div>
                  )}
                  <div className="text-[9px] uppercase leading-none mb-0.5">{format(date, "EEEEE", { locale: es })}</div>
                  <div className={`text-[11px] font-semibold mx-auto ${isToday ? "text-white bg-blue-600 rounded-full w-[18px] h-[18px] flex items-center justify-center" : "text-gray-700"}`}>{format(date, "d")}</div>
                  {/* Debajo de la fecha: asignado (gris) y producido (verde) del día, todas las líneas. */}
                  {(() => {
                    const k = format(date, "yyyy-MM-dd");
                    const asg = assignedByDay.get(k) || 0;
                    const prod = producedByDay.get(k) || 0;
                    return (
                      <div className="mt-0.5 leading-none">
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
                  onClick={() => openOperatorsEditor(lineNo)}
                  className={`pr-2 pl-1 text-left rounded-md transition cursor-grab active:cursor-grabbing sticky left-0 z-10 bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)] flex items-center gap-1 ${draggedLine === String(lineNo) ? "opacity-40" : "hover:bg-gray-100"} ${lineDropTarget === String(lineNo) && draggedLine !== String(lineNo) ? "ring-2 ring-emerald-400 ring-inset bg-emerald-50" : ""}`}
                  title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios · ${latestTargetForLine(lineNo).toLocaleString()} pzas/día — arrastre para reordenar · clic para cambiar operarios por estilo`}
                >
                  <GripVertical className="w-3 h-3 text-gray-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-gray-800 leading-none">L{lineNo}{isPlannerOnly(lineNo) && (<span title="Línea del planeador — aún sin configurar por ingeniería" className="ml-1 align-middle inline-block px-1 py-[1px] rounded bg-amber-100 text-amber-700 text-[8px] font-bold leading-none">P</span>)}</div>
                    <div className="text-[9px] text-gray-400 leading-none mt-0.5">
                      👤{latestRunForLine(lineNo)?.operators_count ?? plannerLineMap[String(lineNo)]?.operators_count ?? 0} · {(latestTargetForLine(lineNo) || Number(plannerLineMap[String(lineNo)]?.target_pcs) || 0) ? `${(latestTargetForLine(lineNo) || Math.round(Number(plannerLineMap[String(lineNo)]?.target_pcs) || 0)).toLocaleString()}` : "—"}
                    </div>
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
                  // A move needs an empty target; a pool PO can pack into any cell.
                  // (Weekends are hidden from the day view, so every column is a workday.)
                  const canDrop = moving ? !hasAny : !!activePO;
                  const isDropHover = dropTarget === dateKey && canDrop;
                  const dayStr = format(date, "yyyy-MM-dd");
                  const totalQty = cellAssignments.reduce((s, a) => s + (parseFloat(a.assigned_quantity) || 0), 0);

                  const emptyCls = `border ${monthStart ? "border-l-2 border-l-gray-300 " : ""}${isToday ? "border-blue-300 bg-blue-50 ring-1 ring-inset ring-blue-200" : "border-gray-200/80 bg-gray-50"}`;

                  return (
                    <div
                      key={idx}
                      onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(dateKey); } }}
                      onDragLeave={() => setDropTarget((t) => (t === dateKey ? null : t))}
                      onDrop={(e) => handleDrop(e, lineNo, date)}
                      onClick={() => handleCellClick(lineNo, date)}
                      style={{ width: CELL, height: CELL }}
                      className={`relative rounded-md overflow-hidden transition ${hasAny ? "" : emptyCls} ${isDropHover ? "ring-2 ring-amber-400 bg-amber-100" : ""} ${activePO && !hasAny ? "ring-1 ring-inset ring-amber-300/70 " : ""}${canDrop && !hasAny ? "cursor-pointer hover:ring-2 hover:ring-amber-300" : ""} ${selectMode && pickingDest ? "cursor-pointer hover:ring-2 hover:ring-indigo-500" : ""}`}
                    >
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
                            const searchHit = isSearching && woMatchesSearch(a.work_order_id);
                            const searchDim = isSearching && !searchHit ? "opacity-10 grayscale" : "";
                            const searchRing = searchHit ? "ring-2 ring-inset ring-amber-500 z-10" : "";
                            const share = totalQty > 0 ? (parseFloat(a.assigned_quantity) || 0) / totalQty : 1 / cellAssignments.length;
                            // Alto real de esta rebanada (px). Con varias OT en el
                            // mismo dia la celda se parte, y el sello "PRE" solo
                            // cabe si la rebanada tiene altura suficiente.
                            const slicePx = share * CELL;
                            return (
                              <div
                                key={a.id}
                                draggable={!dropBusy && !selectMode && !a.is_hold}
                                onDragStart={(e) => {
                                  if (a.is_hold) { e.preventDefault(); return; } // holds don't move via line-assignments
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", String(a.id));
                                  setDraggedPO(null);
                                  setArmedPO(null);
                                  setDraggedAssignment(a);
                                }}
                                onDragEnd={() => { setDraggedAssignment(null); setDropTarget(null); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (selectMode) {
                                    // In dest phase, a tap on any cell (even an
                                    // occupied one) picks it as the target.
                                    if (pickingDest) chooseDestination(lineNo, date);
                                    else if (!a.is_hold) toggleSelected(a.id); // holds aren't batch-movable
                                    return;
                                  }
                                  // An armed PO packs onto this cell even over a hold.
                                  if (armedPO && !dropBusy) assignPOAcrossDays(armedPO, lineNo, date);
                                  else if (a.is_hold) removeHold(a);
                                  else setSelectedAssignment(a);
                                }}
                                onMouseEnter={(e) => setHovered({ assignment: a, x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => setHovered({ assignment: a, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => setHovered(null)}
                                style={{ flexGrow: share, flexBasis: 0, minHeight: 3 }}
                                className={`relative ${c.bg} ${c.border} border-b last:border-b-0 ${selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${overdue} ${done} ${dim} ${searchDim} ${searchRing} ${selectMode && selectedIds.has(a.id) ? "ring-2 ring-inset ring-indigo-600 z-10" : ""}`}
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
                                    {slicePx >= 9 ? (
                                      <span className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                                        <span className="rounded-[2px] bg-violet-700 px-[2px] font-black leading-none text-white" style={{ fontSize: 6 }}>PRE</span>
                                      </span>
                                    ) : (
                                      <span className="pointer-events-none absolute bottom-0 left-0 z-20 w-0 h-0 border-b-[6px] border-r-[6px] border-b-violet-700 border-r-transparent" />
                                    )}
                                  </>
                                )}
                                {isStart && <span className="absolute inset-y-0 left-0 w-1 bg-black/25" />}
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
            <div className="inline-block">
              {/* Period header row */}
              <div className="grid items-end sticky top-0 z-20 bg-white" style={{ gridTemplateColumns: aggCols, gap: GAP, paddingBottom: GAP }}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 z-30 bg-white pr-2 self-stretch flex items-end border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.18)]">Línea</div>
                {periods.map((p) => {
                  const { assigned, produced } = columnTotals(p.start, p.end);
                  return (
                    <div key={p.key} className="text-center leading-tight text-gray-500" style={{ width: AGG_W }}>
                      <div className="text-[9px] uppercase">{p.top}</div>
                      <div className="text-[10px] font-semibold text-gray-700">{p.bottom}</div>
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
                      onClick={() => openOperatorsEditor(lineNo)}
                      className={`pr-2 pl-1 text-left rounded-md transition cursor-grab active:cursor-grabbing sticky left-0 z-10 bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)] flex items-center gap-1 ${draggedLine === String(lineNo) ? "opacity-40" : "hover:bg-gray-100"} ${lineDropTarget === String(lineNo) && draggedLine !== String(lineNo) ? "ring-2 ring-emerald-400 ring-inset bg-emerald-50" : ""}`}
                      title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios — arrastre para reordenar · clic para cambiar operarios por estilo`}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-800 leading-none">L{lineNo}{isPlannerOnly(lineNo) && (<span title="Línea del planeador — aún sin configurar por ingeniería" className="ml-1 align-middle inline-block px-1 py-[1px] rounded bg-amber-100 text-amber-700 text-[8px] font-bold leading-none">P</span>)}</div>
                        <div className="text-[9px] text-gray-400 leading-none mt-0.5">
                          👤{latestRunForLine(lineNo)?.operators_count ?? plannerLineMap[String(lineNo)]?.operators_count ?? 0}
                        </div>
                      </div>
                    </button>

                    {periods.map((p) => {
                      const { total, orders, hasPre } = aggFor(lineNo, p.start, p.end);
                      const has = total > 0;
                      const cap = periodCapacity(lineNo, p.start, p.end);
                      const util = cap > 0 ? total / cap : null;       // null → capacity unknown
                      const cc = has && util != null ? capColor(util) : null;
                      const cellStyle = { width: AGG_W, height: AGG_H };
                      if (has && cc) { cellStyle.backgroundColor = cc.bg; cellStyle.borderColor = cc.border; cellStyle.color = cc.text; }
                      else if (has) { cellStyle.backgroundColor = "rgba(100,116,139,0.18)"; cellStyle.borderColor = "#94a3b8"; cellStyle.color = "#334155"; }
                      if (hasPre) { cellStyle.outline = "2px dashed #6d28d9"; cellStyle.outlineOffset = "-2px"; }
                      const pctTxt = util != null ? `${Math.round(util * 100)}% de capacidad` : "sin capacidad configurada";
                      return (
                        <button
                          key={p.key}
                          onClick={() => has && setAggModal({ lineNo, label: `${p.top} ${p.bottom}`, orders, total })}
                          title={has ? `${orders.length} orden(es) · ${Math.round(total).toLocaleString()} pzas · ${pctTxt}${hasPre ? " · incluye PRE-ORDEN" : ""}` : "Sin asignaciones"}
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
                                <span className="font-bold" style={{ fontSize: 9 }}>{Math.round(util * 100)}%</span>
                              )}
                            </span>
                          ) : ""}
                          {hasPre && (
                            <span className="pointer-events-none absolute top-0 right-0 z-10 rounded-bl bg-violet-700 font-black leading-none text-white" style={{ fontSize: 7, padding: "1px 2px" }}>PRE</span>
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
                <span className="text-gray-400">·</span>
                <span className="font-medium text-gray-600">Color = uso de capacidad:</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#ef4444", borderColor: "#dc2626" }} />&lt;50%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#f97316", borderColor: "#ea580c" }} />50–80%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#facc15", borderColor: "#eab308" }} />80–95%</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border" style={{ backgroundColor: "#22c55e", borderColor: "#16a34a" }} />95–100%</span>
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

      {/* Saldos: dias cerrados que no alcanzaron las piezas asignadas.
          Va antes de la cuadricula porque es lo primero que el planeador
          tiene que resolver antes de seguir programando dias nuevos. */}
      <div className="px-5 py-3 border-b bg-white">
        <PendingBalances
          rows={balances.rows}
          loading={balances.loading}
          error={balances.error}
          resolved={balances.resolved}
          busy={dropBusy}
          onReload={balances.reload}
          onReassign={reassignBalance}
        />
      </div>

      {/* Legend: cell states (order colors are shown above the grid) */}
      <div className="px-5 py-3 border-t bg-gray-50 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded ring-2 ring-red-600 bg-white" />
            <span className="text-gray-600">Atrasada</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-100 border border-gray-200" />
            <span className="text-gray-600">Libre</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-gray-400 opacity-60" />
            <span className="text-gray-600">Completada (atenuada)</span>
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
                return (
                  <div className="flex flex-wrap gap-2">
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

      {/* Operators editor — only the styles assigned to this line on the chosen day */}
      {editLine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditLine(null)}>
          {(() => {
            const dayRows = stylesAssignedOnDay(editLine.lineNo, editLine.effDate);
            return (
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b">
                  <h3 className="font-semibold text-gray-900">Operarios — Línea {editLine.lineNo}</h3>
                  <p className="text-sm text-gray-500">Estilos asignados en el día seleccionado</p>
                </div>
                <div className="p-6 space-y-4 overflow-y-auto">
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Día</label>
                      <input
                        type="date"
                        value={editLine.effDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditLine((s) => (s ? { ...s, scope: "from" } : s))}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition ${editLine.scope === "from" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                      >
                        Desde esta fecha
                      </button>
                      <button
                        onClick={() => setEditLine((s) => (s ? { ...s, scope: "day" } : s))}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition ${editLine.scope === "day" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
                      >
                        Solo este día
                      </button>
                    </div>
                  </div>

                  {dayRows.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No hay estilos asignados a la Línea {editLine.lineNo} el {editLine.effDate}. Elija otro día.
                    </p>
                  ) : (
                    <>
                      {dayRows.map((row) => {
                        const val = editLine.ops[row.style] ?? "0";
                        const ops = parseInt(val) || 0;
                        const { availableMin, pcs } = previewCapacity(row.run, ops);
                        return (
                          <div key={row.style} className="rounded-xl border border-gray-200 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-500">Estilo</span>
                              <span className="font-mono text-sm font-semibold text-gray-900">{row.style || "—"}</span>
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">N° de operarios (costureras)</label>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setRowOperators(row.style, String(Math.max(0, (parseInt(val) || 0) - 1)))}
                                  className="w-9 h-9 rounded-lg border border-gray-200 text-lg hover:bg-gray-50"
                                >−</button>
                                <input
                                  type="number"
                                  min="0"
                                  value={val}
                                  onChange={(e) => setRowOperators(row.style, e.target.value)}
                                  className="w-full text-center rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                                />
                                <button
                                  onClick={() => setRowOperators(row.style, String((parseInt(val) || 0) + 1))}
                                  className="w-9 h-9 rounded-lg border border-gray-200 text-lg hover:bg-gray-50"
                                >+</button>
                              </div>
                            </div>
                            {row.run ? (
                              <div className="bg-blue-50 rounded-lg p-3 text-xs space-y-1">
                                <div className="flex justify-between"><span className="text-blue-700">Horas:</span><span className="font-medium text-blue-900">{Number(row.run.working_hours)} h</span></div>
                                <div className="flex justify-between"><span className="text-blue-700">Eficiencia:</span><span className="font-medium text-blue-900">{Math.round(Number(row.run.efficiency) * 100)}%</span></div>
                                {(() => {
                                  const m = merchantSamForStyle(row.style);
                                  return (
                                    <>
                                      <div className="flex justify-between"><span className="text-blue-700">SAM estilo (merchant):</span><span className="font-medium text-blue-900">{m ? `${m.sam} min` : "—"}</span></div>
                                      <div className="flex justify-between"><span className="text-blue-700">SAM producción:</span><span className="font-medium text-blue-900">{Number(row.run.sam_minutes)} min</span></div>
                                    </>
                                  );
                                })()}
                                <div className="flex justify-between pt-1 border-t border-blue-200"><span className="text-blue-700">Min disponibles/día:</span><span className="font-semibold text-blue-900">{Math.round(availableMin).toLocaleString()}</span></div>
                                <div className="flex justify-between"><span className="text-blue-700">Capacidad/día:</span><span className="font-semibold text-blue-900">{Math.round(pcs).toLocaleString()} pzas</span></div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-amber-600">Sin corrida configurada para este estilo; no hay SAM/horas para calcular capacidad.</p>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-gray-400">
                        {editLine.scope === "day"
                          ? `El cambio se aplica solo al ${editLine.effDate} en la Línea ${editLine.lineNo} con ese estilo.`
                          : `El cambio se aplica desde el ${editLine.effDate} en adelante en la Línea ${editLine.lineNo} con ese estilo. No modifica fechas anteriores.`}
                      </p>
                    </>
                  )}
                </div>
                <div className="px-6 py-4 border-t flex justify-end gap-2">
                  <button onClick={() => setEditLine(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancelar</button>
                  <button
                    onClick={saveOperators}
                    disabled={savingOps || dayRows.length === 0}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {savingOps ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Aggregated period breakdown */}
      {aggModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setAggModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Línea {aggModal.lineNo} — {aggModal.label}</h3>
              <p className="text-sm text-gray-500">{Math.round(aggModal.total).toLocaleString()} pzas · {aggModal.orders.length} orden(es)</p>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto divide-y">
              {aggModal.orders
                .sort((a, b) => b.qty - a.qty)
                .map((o) => (
                  <div key={o.id} className="py-2 flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(o.groupKey).dot}`} />
                    <span className="font-mono text-sm font-medium text-gray-800 flex-1 truncate">{o.no}</span>
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

      {/* Toast */}
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