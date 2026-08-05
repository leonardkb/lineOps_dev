// components/planner/PlanBoard.jsx
import { useState, useEffect, useMemo } from "react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, startOfYear, addMonths, eachWeekOfInterval, eachMonthOfInterval, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Package, Loader2, Check, AlertCircle } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO, WO_PALETTE } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const remainingOf = (wo) => Math.max(targetOf(wo) - assignedOf(wo), 0);

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

// Compact cell sizing
const CELL = 34;   // px — square size
const GAP = 6;     // px — gap between squares
const LABEL = 64;  // px — line label column width

export default function PlanBoard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState("week"); // day, week, month
  const [assignments, setAssignments] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [lineRuns, setLineRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [hovered, setHovered] = useState(null); // { assignment, x, y }

  // Drag & drop
  const [draggedPO, setDraggedPO] = useState(null); // transient: during a native drag only
  const [armedPO, setArmedPO] = useState(null);     // persistent: picked up via tap/click
  const [draggedAssignment, setDraggedAssignment] = useState(null); // moving an existing cell
  const [dropTarget, setDropTarget] = useState(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showPool, setShowPool] = useState(true);
  const [showSizes, setShowSizes] = useState(false); // compact pool by default; reveal size chips on demand
  const [editLine, setEditLine] = useState(null); // { lineNo, operators, run }
  const [savingOps, setSavingOps] = useState(false);

  // The merchant's weekly plan drives which orders reach the pool and their
  // target week. `merchantOk` is false only if that fetch fails → we then fall
  // back to the previous behavior (show every open order) so the board still works.
  const [merchantPlan, setMerchantPlan] = useState([]);
  const [merchantOk, setMerchantOk] = useState(true);

  // User-chosen block colors (per work-order+color key), persisted per browser.
  const [colorOverrides, setColorOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("planboard_color_overrides") || "{}"); } catch { return {}; }
  });
  const blockColor = (key) => {
    const idx = colorOverrides[key];
    return idx != null && WO_PALETTE[idx] ? WO_PALETTE[idx] : colorForWO(key);
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

  // The PO currently ready to place (drag takes priority over tap).
  const activePO = draggedPO || armedPO;

  useEffect(() => { fetchData(); }, []);

  // Esc cancels a picked-up (armed) PO.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setArmedPO(null); setDraggedPO(null); setDraggedAssignment(null); setDropTarget(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [aRes, woRes, lrRes, mpRes] = await Promise.all([
        fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/line-runs`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/merchant-plan`, { headers: authHeaders() }).catch(() => null),
      ]);
      const a = await aRes.json(); if (a.success) setAssignments(a.assignments);
      const wo = await woRes.json(); if (wo.success) setWorkOrders(wo.workOrders);
      const lr = await lrRes.json(); if (lr.success) setLineRuns(lr.runs);
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

  const lines = [
    ...new Set([...assignments.map((a) => a.line_no), ...lineRuns.map((lr) => lr.line_no)]),
  ].sort((a, b) => Number(a) - Number(b));

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
      m.set(planKey(r.work_order_id, r.color), r);
      // Also index by work_order_no in case an order was planned before it had a numeric id.
      if (r.work_order_no) m.set(planKey(r.work_order_no, r.color), r);
    }
    return m;
  }, [merchantPlan]);
  // Gate the pool by the plan only when it actually loaded; otherwise fall back.
  const gateByMerchant = merchantOk;

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
      if (job.remaining <= 0) return;
      const mp = merchantByKey.get(planKey(job.workOrderId, job.color));
      if (gateByMerchant && !mp) return;
      job.week = mp ? mp.week_start : null; // Monday (YYYY-MM-DD) the merchant assigned
      jobs.push(job);
    };

    workOrders.forEach((wo) => {
      if (["completed", "cancelled"].includes(wo.status)) return;
      const lines = Array.isArray(wo.lines) ? wo.lines : [];
      const colors = Array.isArray(wo.colors) ? wo.colors.filter((c) => c && c.color != null) : [];

      if (lines.length > 0) {
        groupsFromLines(lines).forEach((g) => {
          consider(mkJob(wo, g.color, g.qty, g.sizes, g.estilo, g.customerPo, g.breakdown));
        });
      } else if (colors.length > 0) {
        colors.forEach((c) => {
          consider(mkJob(wo, c.color, Number(c.quantity) || 0, [], wo.estilo, wo.customer_po));
        });
      } else {
        consider(mkJob(wo, wo.color || null, targetOf(wo), [], wo.estilo, wo.customer_po));
      }
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

  // Group the pool by the merchant-assigned week so the planner sees, week by
  // week, exactly what needs to land on the day grid.
  const poolWeekGroups = useMemo(() => {
    const groups = new Map();
    for (const j of poolJobs) {
      const wk = j.week || "";
      if (!groups.has(wk)) groups.set(wk, []);
      groups.get(wk).push(j);
    }
    return [...groups.entries()]
      .sort((a, b) => ((a[0] || "9999-99-99") < (b[0] || "9999-99-99") ? -1 : 1))
      .map(([week, jobs]) => ({ week, jobs, totalPzas: jobs.reduce((s, j) => s + (j.remaining || 0), 0) }));
  }, [poolJobs]);

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
    // Daily view: individual days up to ~6 months ahead (scroll right for more).
    if (viewMode === "day") {
      return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 182) });
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
      const cur = orders.get(k) || { id: k, no: `${woNo(a)}${a.color ? " · " + a.color : ""}`, qty: 0 };
      cur.qty += q;
      orders.set(k, cur);
    });
    return { total, orders: [...orders.values()] };
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

  // Each assignment is one day (one assigned_date), matched by calendar day.
  const cellMatches = (a, lineNo, key) => {
    if (String(a.line_no) !== String(lineNo)) return false;
    if (a.assigned_date) return ymd(a.assigned_date) === key;
    return ymd(a.planned_start_date) <= key && key <= ymd(a.planned_end_date);
  };
  const getAssignmentForLineAndDate = (lineNo, date) =>
    assignments.find((a) => cellMatches(a, lineNo, format(date, "yyyy-MM-dd")));
  // All POs sharing a line-day (a cell can now hold several, packed to capacity).
  const getAssignmentsForLineAndDate = (lineNo, date) => {
    const key = format(date, "yyyy-MM-dd");
    return assignments
      .filter((a) => cellMatches(a, lineNo, key) && !["cancelled", "rejected"].includes(a.status))
      .sort((x, y) => (parseFloat(y.assigned_quantity) || 0) - (parseFloat(x.assigned_quantity) || 0));
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

  const openOperatorsEditor = (lineNo) => {
    const run = latestRunForLine(lineNo);
    setEditLine({ lineNo, operators: run ? Number(run.operators_count) || 0 : 0, run });
  };

  // Live preview of capacity for the editor:
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

  const saveOperators = async () => {
    if (!editLine) return;
    const ops = parseInt(editLine.operators);
    if (isNaN(ops) || ops < 0) return showToast("Número de operarios inválido", true);
    setSavingOps(true);
    try {
      const res = await fetch(`${API_URL}/api/line-runs/operators`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ lineNo: editLine.lineNo, operators: ops }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchData();
        showToast(`✅ Línea ${editLine.lineNo}: ${ops} operarios · capacidad actualizada`);
        setEditLine(null);
      } else {
        showToast(data.error || "No se pudo actualizar", true);
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, true);
    } finally {
      setSavingOps(false);
    }
  };

  // backend (same numbers the server validates against — avoids 400s).
  const fetchAvailableForDate = async (dateStr) => {
    const r = await fetch(`${API_URL}/api/planning/available-lines?date=${dateStr}`, { headers: authHeaders() });
    const d = await r.json();
    return d.success ? (d.lines || []) : [];
  };

  // ---- DROP: fill the line day by day, carrying the remainder forward ----
  const assignPOAcrossDays = async (po, lineNo, startDate) => {
    let remaining = po.remaining != null ? po.remaining : remainingOf(po);
    if (remaining <= 0) return showToast("Esta PO ya está totalmente asignada.", true);
    const label = `${po.work_order_no}${po.color ? " " + po.color : ""}`;

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

      await fetchData();

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

  const handleDrop = (e, lineNo, date) => {
    e.preventDefault();
    setDropTarget(null);
    if (dropBusy) return;

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
        await fetchData();
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

  // Tap a cell: if a PO is armed, pack it here (into any remaining capacity);
  // otherwise do nothing — individual blocks open their own detail on click.
  const handleCellClick = (lineNo, date) => {
    if (armedPO && !dropBusy) assignPOAcrossDays(armedPO, lineNo, date);
  };

  // Remove one or more assignments from a line.
  const removeAssignments = async (ids) => {
    if (!ids || ids.length === 0) return;
    setDropBusy(true);
    let removed = 0;
    const errors = [];
    try {
      for (const id of ids) {
        const res = await fetch(`${API_URL}/api/line-assignments/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) removed++;
        else errors.push(data.error || `HTTP ${res.status}`);
      }
      await fetchData();
      setSelectedAssignment(null);
      if (removed > 0) showToast(`🗑️ ${removed} asignación(es) eliminada(s).`);
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
            <p className="text-sm text-gray-600">Arrastre una PO a una línea —o tóquela y luego toque una casilla libre— para programarla</p>
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

      {/* Pool: orders the MERCHANT planned, laid out as compact per-week columns
          so the planner sees the weeks AND the line grid at the same time.
          Assigning/dragging only in Diario. */}
      {viewMode === "day" && (
      <div className="border-b bg-amber-50/60">
        {/* Header row — title collapses the pool; controls stay on the right */}
        <div className="w-full flex items-center justify-between px-5 py-2.5 gap-3">
          <button onClick={() => setShowPool((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-gray-800 min-w-0">
            <Package className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">Órdenes planificadas por el merchant ({poolJobs.length})</span>
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
          <div className="px-5 pb-3">
            {!merchantOk && (
              <p className="mb-2 text-[11px] text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2 py-1 inline-block">
                No se pudo cargar el plan del merchant — mostrando todas las órdenes pendientes.
              </p>
            )}
            {poolJobs.length === 0 ? (
              <p className="text-sm text-gray-500 py-1">
                {merchantOk
                  ? "El merchant aún no ha planificado órdenes (o ya están completamente programadas)."
                  : "No hay órdenes pendientes."}
              </p>
            ) : (
              // ONE bounded, scrollable strip. Weeks are columns (scroll →);
              // sticky headers keep the week visible while scrolling ↓.
              <div className="overflow-auto rounded-lg" style={{ maxHeight: "38vh" }}>
                <div className="flex gap-3 items-start min-w-min">
                  {poolWeekGroups.map((grp) => {
                    const wl = weekLabel(grp.week);
                    return (
                      <div key={grp.week || "none"} className="shrink-0 w-[208px] flex flex-col">
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
                            {grp.jobs.length} ord · {Math.round(grp.totalPzas).toLocaleString()} pzas
                          </div>
                        </button>

                        {/* Compact order cards for this week */}
                        <div className="space-y-1.5">
                          {grp.jobs.map((job) => {
                            const isActive = activePO?.key === job.key;
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
                                title={`${job.work_order_no}${job.color ? " · " + job.color : ""} — ${job.customer_name || ""}\nArrástrela a una línea, o tóquela y luego toque una casilla libre`}
                                className={`rounded-lg border bg-white px-2.5 py-2 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${isActive ? "ring-2 ring-amber-500 border-amber-400" : "border-gray-200 hover:border-amber-300"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(job.key).dot}`} />
                                  <span className="font-mono text-[12px] font-bold text-gray-900 truncate flex-1 min-w-0">{job.work_order_no}</span>
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
                                                {job.color && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${blockColor(job.key).dot}`} />}
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

      {/* Armed-PO hint */}
      {armedPO && !dropBusy && (
        <div className="px-5 py-2 bg-amber-100 border-b border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span className="truncate">
            <b className="font-mono">{armedPO.work_order_no}{armedPO.color ? ` · ${armedPO.color}` : ""}</b> lista para asignar — toque una casilla libre (o arrástrela). <span className="text-amber-600">Esc para cancelar.</span>
          </span>
          <button onClick={() => setArmedPO(null)} className="shrink-0 text-amber-700 hover:text-amber-900 underline">
            Cancelar
          </button>
        </div>
      )}

      {/* Assigned work orders (color + number) shown above the grid */}
      {(() => {
        const byOrder = new Map();
        assignments
          .filter((a) => !["cancelled", "rejected"].includes(a.status))
          .forEach((a) => {
            const k = keyOf(a.work_order_id, a.color);
            const cur = byOrder.get(k) || { key: k, no: woNo(a), color: a.color || null, qty: 0 };
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
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 pl-1.5 pr-2 py-0.5 text-xs"
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${blockColor(o.key).dot}`} />
                  <span className="font-mono font-medium text-gray-800">{o.no}{o.color ? ` · ${o.color}` : ""}</span>
                  <span className="text-gray-500">{Math.round(o.qty).toLocaleString()} pzas</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Compact square grid */}
      <div className="px-5 pb-4 overflow-auto relative" style={{ maxHeight: "72vh" }}>
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
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div key={idx} className={`relative text-center leading-tight ${date.getDate() === 1 ? "border-l border-gray-300" : ""} ${isWeekend ? "text-gray-400" : "text-gray-500"}`} style={{ width: CELL }}>
                  {(idx === 0 || date.getDate() === 1) && (
                    <div className="text-[8px] font-bold uppercase tracking-wide text-indigo-500 leading-none">{format(date, "MMM", { locale: es })}</div>
                  )}
                  <div className="text-[9px] uppercase leading-none mb-0.5">{format(date, "EEEEE", { locale: es })}</div>
                  <div className={`text-[11px] font-semibold mx-auto ${isToday ? "text-white bg-blue-600 rounded-full w-[18px] h-[18px] flex items-center justify-center" : "text-gray-700"}`}>{format(date, "d")}</div>
                </div>
              );
            })}
          </div>

          {/* Line rows */}
          {lines.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">No hay líneas configuradas.</div>
          ) : (
            lines.map((lineNo) => (
              <div key={lineNo} className="grid items-center" style={{ gridTemplateColumns: gridCols, gap: GAP, marginBottom: GAP }}>
                {/* Line label — click to edit sewers (operators) */}
                <button
                  onClick={() => openOperatorsEditor(lineNo)}
                  className="pr-2 text-left rounded-md hover:bg-gray-100 transition sticky left-0 z-10 bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)]"
                  title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios · ${latestTargetForLine(lineNo).toLocaleString()} pzas/día — clic para cambiar operarios`}
                >
                  <div className="text-sm font-bold text-gray-800 leading-none">L{lineNo}</div>
                  <div className="text-[9px] text-gray-400 leading-none mt-0.5">
                    👤{latestRunForLine(lineNo)?.operators_count ?? 0} · {latestTargetForLine(lineNo) ? `${latestTargetForLine(lineNo).toLocaleString()}` : "—"}
                  </div>
                </button>

                {/* Day squares — one line-day can now stack several POs, each
                    slice sized by its share of that day's assigned pieces. */}
                {dateRange.map((date, idx) => {
                  const cellAssignments = getAssignmentsForLineAndDate(lineNo, date);
                  const hasAny = cellAssignments.length > 0;
                  const isToday = isSameDay(date, new Date());
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const dateKey = `${lineNo}|${format(date, "yyyy-MM-dd")}`;
                  const moving = draggedAssignment != null;
                  // A move needs an empty target; a pool PO can pack into any cell.
                  const canDrop = moving ? !hasAny : !!activePO;
                  const isDropHover = dropTarget === dateKey && canDrop;
                  const dayStr = format(date, "yyyy-MM-dd");
                  const totalQty = cellAssignments.reduce((s, a) => s + (parseFloat(a.assigned_quantity) || 0), 0);

                  const emptyCls = `border ${date.getDate() === 1 ? "border-l-2 border-l-gray-300 " : ""}${isToday ? "border-blue-300 bg-blue-50 ring-1 ring-inset ring-blue-200" : isWeekend ? "border-gray-100 bg-gray-50/60" : "border-gray-200/80 bg-gray-50"}`;

                  return (
                    <div
                      key={idx}
                      onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(dateKey); } }}
                      onDragLeave={() => setDropTarget((t) => (t === dateKey ? null : t))}
                      onDrop={(e) => handleDrop(e, lineNo, date)}
                      onClick={() => handleCellClick(lineNo, date)}
                      style={{ width: CELL, height: CELL }}
                      className={`relative rounded-md overflow-hidden transition ${hasAny ? "" : emptyCls} ${isDropHover ? "ring-2 ring-amber-400 bg-amber-100" : ""} ${canDrop && !hasAny ? "cursor-pointer hover:ring-2 hover:ring-amber-300" : ""}`}
                    >
                      {hasAny && (
                        <div className="absolute inset-0 flex flex-col">
                          {cellAssignments.map((a) => {
                            const c = blockColor(keyOf(a.work_order_id, a.color));
                            const overdue = isOverdue(a) ? "ring-1 ring-inset ring-red-600" : "";
                            const done = a.status === "completed" ? "opacity-60" : "";
                            const isBeingMoved = moving && draggedAssignment.id === a.id;
                            const dim = isBeingMoved ? "opacity-40" : "";
                            const isStart = ymd(a.planned_start_date) === dayStr;
                            const share = totalQty > 0 ? (parseFloat(a.assigned_quantity) || 0) / totalQty : 1 / cellAssignments.length;
                            return (
                              <div
                                key={a.id}
                                draggable={!dropBusy}
                                onDragStart={(e) => {
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
                                  if (armedPO && !dropBusy) assignPOAcrossDays(armedPO, lineNo, date);
                                  else setSelectedAssignment(a);
                                }}
                                onMouseEnter={(e) => setHovered({ assignment: a, x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => setHovered({ assignment: a, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => setHovered(null)}
                                style={{ flexGrow: share, flexBasis: 0, minHeight: 3 }}
                                className={`relative ${c.bg} ${c.border} border-b last:border-b-0 cursor-grab active:cursor-grabbing ${overdue} ${done} ${dim}`}
                                title="Arrastre para mover · toque para ver detalle"
                              >
                                {isStart && <span className="absolute inset-y-0 left-0 w-1 bg-black/25" />}
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
          let maxAgg = 0;
          lines.forEach((ln) => periods.forEach((p) => {
            const t = aggFor(ln, p.start, p.end).total;
            if (t > maxAgg) maxAgg = t;
          }));
          return (
            <div className="inline-block">
              {/* Period header row */}
              <div className="grid items-end sticky top-0 z-20 bg-white" style={{ gridTemplateColumns: aggCols, gap: GAP, paddingBottom: GAP }}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide sticky left-0 z-30 bg-white pr-2 self-stretch flex items-end border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.18)]">Línea</div>
                {periods.map((p) => (
                  <div key={p.key} className="text-center leading-tight text-gray-500" style={{ width: AGG_W }}>
                    <div className="text-[9px] uppercase">{p.top}</div>
                    <div className="text-[10px] font-semibold text-gray-700">{p.bottom}</div>
                  </div>
                ))}
              </div>

              {/* Line rows (aggregated blocks) */}
              {lines.length === 0 ? (
                <div className="py-8 text-center text-gray-500 text-sm">No hay líneas configuradas.</div>
              ) : (
                lines.map((lineNo) => (
                  <div key={lineNo} className="grid items-center" style={{ gridTemplateColumns: aggCols, gap: GAP, marginBottom: GAP }}>
                    <button
                      onClick={() => openOperatorsEditor(lineNo)}
                      className="pr-2 text-left rounded-md hover:bg-gray-100 transition sticky left-0 z-10 bg-white border-r border-gray-200 shadow-[6px_0_0_0_#ffffff,4px_0_6px_-3px_rgba(0,0,0,0.10)]"
                      title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios`}
                    >
                      <div className="text-sm font-bold text-gray-800 leading-none">L{lineNo}</div>
                      <div className="text-[9px] text-gray-400 leading-none mt-0.5">👤{latestRunForLine(lineNo)?.operators_count ?? 0}</div>
                    </button>

                    {periods.map((p) => {
                      const { total, orders } = aggFor(lineNo, p.start, p.end);
                      const has = total > 0;
                      const intensity = has && maxAgg > 0 ? Math.max(0.18, total / maxAgg) : 0;
                      return (
                        <button
                          key={p.key}
                          onClick={() => has && setAggModal({ lineNo, label: `${p.top} ${p.bottom}`, orders, total })}
                          title={has ? `${orders.length} orden(es) · ${Math.round(total).toLocaleString()} pzas` : "Sin asignaciones"}
                          style={{ width: AGG_W, height: AGG_H, backgroundColor: has ? `rgba(37,99,235,${intensity})` : undefined }}
                          className={`rounded-md border text-[11px] font-semibold flex items-center justify-center transition ${
                            has ? "border-blue-300 text-blue-900 hover:ring-2 hover:ring-blue-300" : "border-gray-200 bg-gray-100 text-gray-300"
                          }`}
                        >
                          {has ? Math.round(total).toLocaleString() : ""}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
              <p className="mt-2 text-[11px] text-gray-400">
                {viewMode === "week"
                  ? "Cada bloque suma la semana. Cambie a Diario para asignar o mover."
                  : viewMode === "month"
                  ? "Cada bloque suma el mes. Cambie a Diario para asignar o mover."
                  : "Cada bloque suma el año. Cambie a Diario para asignar o mover."}
              </p>
            </div>
          );
        })()}
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
        </div>
      </div>

      {/* Hover tooltip (follows cursor) */}
      {hovered && (
        <div className="fixed z-[60] w-56 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 pointer-events-none"
          style={{ left: Math.min(hovered.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1000) - 240), top: hovered.y + 12 }}>
          <div className="font-medium mb-1">{woNo(hovered.assignment)}{hovered.assignment.color ? ` · ${hovered.assignment.color}` : ""}</div>
          <div className="space-y-0.5">
            <Row k="Estilo" v={woStyle(hovered.assignment)} />
            <Row k="Línea" v={`L${hovered.assignment.line_no}`} />
            <Row k="Cantidad" v={`${Math.round(hovered.assignment.assigned_quantity).toLocaleString()} pzas`} />
            <Row k="Inicio" v={fmtDMY(hovered.assignment.planned_start_date)} />
            <Row k="Fin" v={fmtDMY(hovered.assignment.planned_end_date)} />
            <Row k="Estado" v={hovered.assignment.status} />
          </div>
        </div>
      )}

      {/* Assignment Details Modal */}
      {selectedAssignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedAssignment(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b"><h3 className="font-semibold text-gray-900">Detalles de Asignación</h3></div>
            <div className="p-6 space-y-3 text-sm">
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
                                <div key={pi} className="rounded-lg bg-gray-50 border border-gray-100 p-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[12px] font-semibold text-gray-700">
                                      <span className="text-gray-400 font-normal">PO</span> {po.customerPo || "—"}
                                    </span>
                                    <span className="text-[11px] text-gray-400">{Math.round(po.total).toLocaleString()} pzas</span>
                                  </div>
                                  {po.styles.map((st, si) => (
                                    <div key={si} className="pl-2 mt-1">
                                      <div className="text-[11px] text-gray-500 font-mono flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${blockColor(keyOf(selectedAssignment.work_order_id, selectedAssignment.color)).dot}`} />
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
                          const key = keyOf(selectedAssignment.work_order_id, selectedAssignment.color);
                          const activeIdx = colorOverrides[key];
                          return (
                            <>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-gray-500">Color del bloque</span>
                                {activeIdx != null && (
                                  <button onClick={() => setBlockColor(key, null)} className="text-[11px] text-gray-500 hover:text-gray-800 underline">
                                    Automático
                                  </button>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {WO_PALETTE.map((c, i) => {
                                  const on = (activeIdx != null ? activeIdx === i : blockColor(key) === c);
                                  return (
                                    <button
                                      key={i}
                                      onClick={() => setBlockColor(key, i)}
                                      title={`Color ${i + 1}`}
                                      className={`w-6 h-6 rounded-md ${c.bg} ${c.border} border ${on ? "ring-2 ring-gray-900 ring-offset-1" : ""}`}
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
            <div className="px-6 py-4 border-t flex flex-wrap justify-between gap-2">
              {(() => {
                const sel = selectedAssignment;
                const sameOrderOnLine = assignments.filter(
                  (a) =>
                    a.work_order_id === sel.work_order_id &&
                    String(a.line_no) === String(sel.line_no) &&
                    !["cancelled"].includes(a.status)
                );
                const dayLabel = sel.assigned_date
                  ? fmtDMY(sel.assigned_date).slice(0, 5)
                  : fmtDMY(sel.planned_start_date).slice(0, 5);
                return (
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={dropBusy}
                      onClick={() => {
                        if (window.confirm(`¿Quitar la asignación del ${dayLabel} en la Línea ${sel.line_no}?`)) {
                          removeAssignments([sel.id]);
                        }
                      }}
                      className="px-3 py-2 text-sm bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 border border-rose-200 disabled:opacity-50"
                    >
                      Quitar este día
                    </button>
                    {sameOrderOnLine.length > 1 && (
                      <button
                        disabled={dropBusy}
                        onClick={() => {
                          if (window.confirm(`¿Quitar TODA la orden ${woNo(sel)} de la Línea ${sel.line_no}? (${sameOrderOnLine.length} días)`)) {
                            removeAssignments(sameOrderOnLine.map((a) => a.id));
                          }
                        }}
                        className="px-3 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
                      >
                        Quitar orden de la línea ({sameOrderOnLine.length})
                      </button>
                    )}
                  </div>
                );
              })()}
              <button onClick={() => setSelectedAssignment(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Operators (sewers) editor */}
      {editLine && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditLine(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Operarios — Línea {editLine.lineNo}</h3>
              <p className="text-sm text-gray-500">Cambiar costureras ajusta la capacidad diaria</p>
            </div>
            <div className="p-6 space-y-4">
              {!editLine.run ? (
                <p className="text-sm text-rose-600">
                  Esta línea no tiene una corrida configurada, así que no hay SAM/horas para calcular capacidad.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">N° de operarios (costureras)</label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditLine((s) => ({ ...s, operators: Math.max(0, (parseInt(s.operators) || 0) - 1) }))}
                        className="w-9 h-9 rounded-lg border border-gray-200 text-lg hover:bg-gray-50"
                      >−</button>
                      <input
                        type="number"
                        min="0"
                        value={editLine.operators}
                        onChange={(e) => setEditLine((s) => ({ ...s, operators: e.target.value }))}
                        className="w-full text-center rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                      />
                      <button
                        onClick={() => setEditLine((s) => ({ ...s, operators: (parseInt(s.operators) || 0) + 1 }))}
                        className="w-9 h-9 rounded-lg border border-gray-200 text-lg hover:bg-gray-50"
                      >+</button>
                    </div>
                  </div>

                  {(() => {
                    const ops = parseInt(editLine.operators) || 0;
                    const { availableMin, pcs } = previewCapacity(editLine.run, ops);
                    return (
                      <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
                        <div className="flex justify-between"><span className="text-blue-700">Horas:</span><span className="font-medium text-blue-900">{Number(editLine.run.working_hours)} h</span></div>
                        <div className="flex justify-between"><span className="text-blue-700">Eficiencia:</span><span className="font-medium text-blue-900">{Math.round(Number(editLine.run.efficiency) * 100)}%</span></div>
                        <div className="flex justify-between"><span className="text-blue-700">SAM:</span><span className="font-medium text-blue-900">{Number(editLine.run.sam_minutes)} min</span></div>
                        <div className="flex justify-between pt-1 border-t border-blue-200"><span className="text-blue-700">Min disponibles/día:</span><span className="font-semibold text-blue-900">{Math.round(availableMin).toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-blue-700">Capacidad/día:</span><span className="font-semibold text-blue-900">{Math.round(pcs).toLocaleString()} pzas</span></div>
                      </div>
                    );
                  })()}
                  <p className="text-[11px] text-gray-400">
                    Se aplica a todas las corridas de la Línea {editLine.lineNo} (recalcula capacidad por corrida según su SAM/horas).
                  </p>
                </>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setEditLine(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancelar</button>
              <button
                onClick={saveOperators}
                disabled={savingOps || !editLine.run}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {savingOps ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
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
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${blockColor(o.id).dot}`} />
                    <span className="font-mono text-sm font-medium text-gray-800 flex-1 truncate">{o.no}</span>
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