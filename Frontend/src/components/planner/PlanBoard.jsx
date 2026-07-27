// components/planner/PlanBoard.jsx
import { useState, useEffect, useMemo } from "react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, startOfYear, addMonths, eachWeekOfInterval, eachMonthOfInterval } from "date-fns";
import { ChevronLeft, ChevronRight, Package, GripVertical, Loader2, Check, AlertCircle } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const remainingOf = (wo) => Math.max(targetOf(wo) - assignedOf(wo), 0);

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
  const [editLine, setEditLine] = useState(null); // { lineNo, operators, run }
  const [savingOps, setSavingOps] = useState(false);
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
      const [aRes, woRes, lrRes] = await Promise.all([
        fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/line-runs`, { headers: authHeaders() }),
      ]);
      const a = await aRes.json(); if (a.success) setAssignments(a.assignments);
      const wo = await woRes.json(); if (wo.success) setWorkOrders(wo.workOrders);
      const lr = await lrRes.json(); if (lr.success) setLineRuns(lr.runs);
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

  const getDateRange = () => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "week") {
      return eachDayOfInterval({
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }),
      });
    }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 34) });
  };
  const dateRange = getDateRange();

  const aggregated = viewMode === "month" || viewMode === "year";
  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Aggregated columns: month → weekly blocks of the month; year → 12 monthly blocks.
  const periods = useMemo(() => {
    if (viewMode === "month") {
      const s = startOfMonth(currentDate);
      const e = endOfMonth(currentDate);
      return eachWeekOfInterval({ start: s, end: e }, { weekStartsOn: 1 }).map((wStart) => {
        const wEnd = addDays(wStart, 6);
        return {
          key: format(wStart, "yyyy-MM-dd"),
          top: "Sem",
          bottom: format(wStart, "dd/MM"),
          start: format(wStart, "yyyy-MM-dd"),
          end: format(wEnd, "yyyy-MM-dd"),
        };
      });
    }
    if (viewMode === "year") {
      const s = startOfYear(currentDate);
      return eachMonthOfInterval({ start: s, end: endOfMonth(addMonths(s, 11)) }).map((mStart) => ({
        key: format(mStart, "yyyy-MM"),
        top: MES[mStart.getMonth()],
        bottom: format(mStart, "yyyy"),
        start: format(startOfMonth(mStart), "yyyy-MM-dd"),
        end: format(endOfMonth(mStart), "yyyy-MM-dd"),
      }));
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
      const cur = orders.get(a.work_order_id) || { id: a.work_order_id, no: woNo(a), qty: 0 };
      cur.qty += q;
      orders.set(a.work_order_id, cur);
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
  const getAssignmentForLineAndDate = (lineNo, date) => {
    const key = format(date, "yyyy-MM-dd");
    return assignments.find((a) => {
      if (String(a.line_no) !== String(lineNo)) return false;
      if (a.assigned_date) return ymd(a.assigned_date) === key;
      return ymd(a.planned_start_date) <= key && key <= ymd(a.planned_end_date);
    });
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
    if (viewMode === "day") return setCurrentDate(addDays(currentDate, dir));
    if (viewMode === "week") return setCurrentDate(addDays(currentDate, dir * 7));
    if (viewMode === "month") return setCurrentDate(addMonths(currentDate, dir));
    return setCurrentDate(addMonths(currentDate, dir * 12)); // year
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

  // Authoritative daily availability for a line on a date, straight from the
  // backend (same numbers the server validates against — avoids 400s).
  const fetchAvailableForDate = async (dateStr) => {
    const r = await fetch(`${API_URL}/api/planning/available-lines?date=${dateStr}`, { headers: authHeaders() });
    const d = await r.json();
    return d.success ? (d.lines || []) : [];
  };

  // ---- DROP: fill the line day by day, carrying the remainder forward ----
  const assignPOAcrossDays = async (po, lineNo, startDate) => {
    let remaining = remainingOf(po);
    if (remaining <= 0) return showToast("Esta PO ya está totalmente asignada.", true);

    setDropBusy(true);
    let day = new Date(startDate);
    let created = 0, assignedTotal = 0;
    let daysScanned = 0, failures = 0;
    const MAX_DAYS = 90;         // don't scan forever
    const MAX_FAILURES = 3;      // stop hammering if the server keeps rejecting
    const errors = [];
    const capCache = {};         // dateStr -> lines[] (fetched once per day)

    try {
      while (remaining > 0 && daysScanned < MAX_DAYS && failures < MAX_FAILURES) {
        daysScanned++;
        const dateStr = format(day, "yyyy-MM-dd");

        if (!capCache[dateStr]) capCache[dateStr] = await fetchAvailableForDate(dateStr);
        const lineInfo = capCache[dateStr].find((l) => String(l.line_no) === String(lineNo));

        // No capacity configured for this line/date at all.
        if (!lineInfo) {
          failures++;
          errors.push(`Sin configuración de capacidad para la línea ${lineNo} el ${dateStr}`);
          day = addDays(day, 1);
          continue;
        }

        const available = Math.floor(Number(lineInfo.available_capacity) || 0);
        if (available <= 0) { day = addDays(day, 1); continue; } // day full → next day

        const qty = Math.min(remaining, available);
        const res = await fetch(`${API_URL}/api/line-assignments`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            workOrderId: po.id,
            lineNo: lineInfo.line_no,           // exact value the backend expects
            assignedDate: dateStr,
            quantity: qty,
            plannedStartDate: dateStr,
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

      if (created > 0 && remaining <= 0) {
        showToast(`✅ ${po.work_order_no}: ${Math.round(assignedTotal).toLocaleString()} pzas en ${created} día(s).`);
      } else if (created > 0) {
        showToast(`⚠️ ${po.work_order_no}: asignadas ${Math.round(assignedTotal).toLocaleString()} pzas; faltan ${Math.round(remaining).toLocaleString()}. ${errors[0] || "Sin capacidad disponible en las próximas fechas."}`, true);
      } else {
        showToast(`No se pudo asignar ${po.work_order_no}. ${errors[0] || ""}`, true);
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

    // Placing a new PO from the pool.
    const po = draggedPO || armedPO;
    if (!po) return;
    if (getAssignmentForLineAndDate(lineNo, date)) return showToast("Ese día ya está ocupado. Elija un día libre.", true);
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

  // Click on a cell: open details if occupied, or place the armed PO if free.
  const handleCellClick = (lineNo, date, assignment) => {
    if (assignment) return setSelectedAssignment(assignment);
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
                  {m === "day" ? "Día" : m === "week" ? "Semana" : m === "month" ? "Mes" : "Año"}
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
          {viewMode === "day" && format(currentDate, "EEEE, d MMMM yyyy")}
          {viewMode === "week" && `${format(dateRange[0], "d MMM")} - ${format(dateRange[dateRange.length - 1], "d MMM yyyy")}`}
          {viewMode === "month" && format(currentDate, "MMMM yyyy")}
          {viewMode === "year" && format(currentDate, "yyyy")}
        </div>
      </div>

      {/* Unassigned PO pool */}
      <div className="border-b bg-amber-50/60">
        <button onClick={() => setShowPool((v) => !v)} className="w-full flex items-center justify-between px-5 py-2.5 text-left">
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Package className="w-4 h-4 text-amber-600" /> Órdenes por asignar ({unassignedPOs.length})
          </span>
          <span className="text-xs text-gray-500">{showPool ? "Ocultar" : "Mostrar"}</span>
        </button>
        {showPool && (
          <div className="px-5 pb-3">
            {unassignedPOs.length === 0 ? (
              <p className="text-sm text-gray-500 py-1">No hay órdenes pendientes.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {unassignedPOs.map((po) => {
                  const isActive = activePO?.id === po.id;
                  return (
                    <div key={po.id} draggable={!dropBusy}
                      onDragStart={(e) => {
                        // Required for the drag to actually start in Firefox / some browsers.
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(po.id));
                        setArmedPO(null);      // dragging supersedes a tapped selection
                        setDraggedPO(po);
                      }}
                      onDragEnd={() => { setDraggedPO(null); setDropTarget(null); }}
                      onClick={() => setArmedPO((cur) => (cur?.id === po.id ? null : po))}
                      title="Arrástrela a una línea, o tóquela y luego toque una casilla libre"
                      className={`shrink-0 w-52 rounded-xl border bg-white p-2.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${isActive ? "ring-2 ring-amber-500 border-amber-400" : "border-gray-200"}`}>
                      <div className="flex items-start gap-2">
                        <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-bold text-gray-900 truncate flex items-center gap-1.5">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(po.id).dot}`} />
                            {po.work_order_no}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{po.customer_name} · {po.style_code || po.estilo || "—"}</p>
                          <div className="mt-1 flex items-center justify-between text-xs">
                            <span className="font-medium text-amber-700">{Math.round(remainingOf(po)).toLocaleString()} pzas</span>
                            {po.commitment_date && <span className="text-gray-400">{format(new Date(po.commitment_date), "dd/MM")}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Armed-PO hint */}
      {armedPO && !dropBusy && (
        <div className="px-5 py-2 bg-amber-100 border-b border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span className="truncate">
            <b className="font-mono">{armedPO.work_order_no}</b> lista para asignar — toque una casilla libre (o arrástrela). <span className="text-amber-600">Esc para cancelar.</span>
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
            const cur = byOrder.get(a.work_order_id) || { id: a.work_order_id, no: woNo(a), qty: 0 };
            cur.qty += parseFloat(a.assigned_quantity) || 0;
            byOrder.set(a.work_order_id, cur);
          });
        const orders = [...byOrder.values()];
        if (orders.length === 0) return null;
        return (
          <div className="px-5 py-3 border-b bg-white">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800 mr-1">Órdenes asignadas:</span>
              {orders.map((o) => (
                <span
                  key={o.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 pl-1.5 pr-2 py-0.5 text-xs"
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${colorForWO(o.id).dot}`} />
                  <span className="font-mono font-medium text-gray-800">{o.no}</span>
                  <span className="text-gray-500">{Math.round(o.qty).toLocaleString()} pzas</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Compact square grid */}
      <div className="p-5 overflow-x-auto relative">
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
          <div className="grid items-end" style={{ gridTemplateColumns: gridCols, gap: GAP, marginBottom: GAP }}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Línea</div>
            {dateRange.map((date, idx) => {
              const isToday = isSameDay(date, new Date());
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div key={idx} className={`text-center leading-tight ${isWeekend ? "text-gray-300" : "text-gray-500"}`} style={{ width: CELL }}>
                  <div className="text-[9px] uppercase">{format(date, "EEEEE")}</div>
                  <div className={`text-[10px] font-semibold ${isToday ? "text-blue-600" : "text-gray-700"}`}>{format(date, "d")}</div>
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
                  className="pr-1 text-left rounded-md hover:bg-gray-100 transition"
                  title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios · ${latestTargetForLine(lineNo).toLocaleString()} pzas/día — clic para cambiar operarios`}
                >
                  <div className="text-xs font-semibold text-gray-800 leading-none">L{lineNo}</div>
                  <div className="text-[9px] text-gray-400 leading-none mt-0.5">
                    👤{latestRunForLine(lineNo)?.operators_count ?? 0} · {latestTargetForLine(lineNo) ? `${latestTargetForLine(lineNo).toLocaleString()}` : "—"}
                  </div>
                </button>

                {/* Day squares */}
                {dateRange.map((date, idx) => {
                  const assignment = getAssignmentForLineAndDate(lineNo, date);
                  const isToday = isSameDay(date, new Date());
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const dateKey = `${lineNo}|${format(date, "yyyy-MM-dd")}`;
                  const moving = draggedAssignment != null;
                  const isDropHover = dropTarget === dateKey && (activePO || moving) && !assignment;
                  const canDrop = (activePO || moving) && !assignment;
                  const isBeingMoved = moving && draggedAssignment.id === assignment?.id;
                  const isStart = assignment && ymd(assignment.planned_start_date) === format(date, "yyyy-MM-dd");

                  let cls;
                  if (assignment) {
                    const c = colorForWO(assignment.work_order_id);
                    const overdue = isOverdue(assignment) ? "ring-2 ring-red-600" : "";
                    const done = assignment.status === "completed" ? "opacity-60" : "";
                    const dim = isBeingMoved ? "opacity-40" : "";
                    cls = `${c.bg} ${c.border} border cursor-grab active:cursor-grabbing ${overdue} ${done} ${dim}`;
                  } else {
                    cls = `border ${isToday ? "border-blue-200 bg-blue-50" : isWeekend ? "border-gray-100 bg-gray-50" : "border-gray-200 bg-gray-100"}`;
                  }

                  return (
                    <div
                      key={idx}
                      draggable={!!assignment && !dropBusy}
                      onDragStart={(e) => {
                        if (!assignment) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(assignment.id));
                        setDraggedPO(null);
                        setArmedPO(null);
                        setDraggedAssignment(assignment);
                      }}
                      onDragEnd={() => { setDraggedAssignment(null); setDropTarget(null); }}
                      onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(dateKey); } }}
                      onDragLeave={() => setDropTarget((t) => (t === dateKey ? null : t))}
                      onDrop={(e) => handleDrop(e, lineNo, date)}
                      onClick={() => handleCellClick(lineNo, date, assignment)}
                      onMouseEnter={(e) => assignment && setHovered({ assignment, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => assignment && setHovered({ assignment, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHovered(null)}
                      style={{ width: CELL, height: CELL }}
                      className={`relative rounded-md transition ${cls} ${isDropHover ? "ring-2 ring-amber-400 bg-amber-100" : ""} ${canDrop ? "cursor-pointer hover:ring-2 hover:ring-amber-300" : ""}`}
                      title={assignment ? "Arrastre para mover a otra línea o día" : ""}
                    >
                      {isStart && <span className="absolute inset-y-0 left-0 w-1 rounded-l-md bg-black/25" />}
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
              <div className="grid items-end" style={{ gridTemplateColumns: aggCols, gap: GAP, marginBottom: GAP }}>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Línea</div>
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
                      className="pr-1 text-left rounded-md hover:bg-gray-100 transition"
                      title={`Línea ${lineNo} · ${latestRunForLine(lineNo)?.operators_count ?? 0} operarios`}
                    >
                      <div className="text-xs font-semibold text-gray-800 leading-none">L{lineNo}</div>
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
                {viewMode === "month"
                  ? "Cada bloque suma la semana. Cambie a Semana/Día para asignar o mover."
                  : "Cada bloque suma el mes. Cambie a Semana/Día para asignar o mover."}
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
          <div className="font-medium mb-1">{woNo(hovered.assignment)}</div>
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
                    <ModalRow k="Estilo" v={woStyle(selectedAssignment)} />
                    <ModalRow k="Línea" v={selectedAssignment.line_no} />
                    <ModalRow k="Cantidad" v={`${Math.round(selectedAssignment.assigned_quantity).toLocaleString()} pzas`} />
                    <ModalRow k="Inicio" v={fmtDMY(selectedAssignment.planned_start_date)} />
                    <ModalRow k="Fin" v={fmtDMY(selectedAssignment.planned_end_date)} />
                    <ModalRow k="Estado" v={selectedAssignment.status} />
                    {wo && <>
                      <ModalRow k="Cliente" v={wo.customer_name} />
                      <ModalRow k="Total Orden" v={`${Math.round(targetOf(wo)).toLocaleString()} pzas`} />
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
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(o.id).dot}`} />
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