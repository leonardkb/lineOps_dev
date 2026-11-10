// components/planner/UrgentChangeModal.jsx
//
// ⚡ Cambio urgente en una semana bloqueada por el CEO.
// Cambia el COLOR (misma orden) o el ESTILO (otra orden) de UNA casilla sin
// desbloquear la semana. El servidor (plan-urgent-changes.js) valida todo y
// deja bitácora; aquí sólo se arma la petición y se explica qué va a pasar.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X, Zap, Lock } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const norm = (c) => String(c == null ? "" : c).trim().toUpperCase();
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString();
const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;

// Colores de una orden con su cantidad pedida (null = sin desglose).
function colorsOf(wo) {
  const m = new Map();
  (wo?.lines || []).forEach((l) => {
    const c = norm(l?.color);
    if (c) m.set(c, (m.get(c) || 0) + (Number(l.quantity) || 0));
  });
  if (!m.size) (wo?.colors || []).forEach((c) => { const k = norm(c?.color); if (k) m.set(k, (m.get(k) || 0) + (Number(c.quantity) || 0)); });
  if (!m.size) String(wo?.color || "").split(",").map(norm).filter(Boolean).forEach((c) => m.set(c, null));
  return [...m.entries()].map(([color, qty]) => ({ color, qty }));
}

export default function UrgentChangeModal({
  assignment,        // casilla seleccionada (line_assignments)
  workOrders,        // lista del tablero
  assignments,       // todas las casillas (para calcular lo libre por color)
  weekLock,          // { locked_by_name, ... } de la semana
  weekLabel,         // "Semana 45 (03/11 – 09/11)"
  produced = 0,      // lo cosido ese día en esa casilla (si se conoce)
  pendingBalances = [], // saldos de días pasados (day-balances: balance > 0)
  onClose,
  onDone,            // (data) => void  — el tablero recarga
  onMissingStyle,    // (data, retry) => bool — reusa el formulario de estándar
}) {
  const a = assignment;
  const srcWo = workOrders.find((w) => w.id === a.work_order_id);
  const srcQty = Number(a.assigned_quantity) || 0;
  const movable = Math.max(Math.floor(srcQty - (Number(produced) || 0)), 0);
  const wasSent = a.status === "released" || a.line_run_id != null;

  const [mode, setMode] = useState("color");
  const [newColor, setNewColor] = useState("");
  const [targetId, setTargetId] = useState(null);
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState(String(movable));
  const [reason, setReason] = useState("");
  const [sendToLines, setSendToLines] = useState(wasSent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Saldos de días pasados elegidos para la orden destino: "linea|yyyy-MM-dd".
  const [pickedBal, setPickedBal] = useState(() => new Set());

  // Opciones del servidor: órdenes del mismo estilo/cliente y saldos de días
  // pasados (6 meses). No dependen de lo que el tablero tenga cargado.
  const [srvOrders, setSrvOrders] = useState(null);   // null = cargando / sin datos
  const [srvBal, setSrvBal] = useState(null);
  const [loadingOpts, setLoadingOpts] = useState(true);
  useEffect(() => {
    let off = false;
    const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date();
    const from = ymdLocal(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 180));
    const to = ymdLocal(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
    const get = (path) => fetch(`${API_URL}${path}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
    Promise.all([
      get(`/api/line-assignments/urgent-options?assignmentId=${a.id}`),
      get(`/api/line-assignments/day-balances?onlyPending=1&from=${from}&to=${to}`),
    ]).then(([o, b]) => {
      if (off) return;
      if (o?.success) setSrvOrders(o.sameStyleOrders || []);
      if (b?.success && b.resolved !== false) {
        setSrvBal((b.rows || []).filter((r) => r.is_past !== false && Number(r.balance) > 0));
      }
      setLoadingOpts(false);
    });
    return () => { off = true; };
  }, [a.id]);
  const balSource = srvBal || pendingBalances;

  const assignedFor = (woId, color) =>
    assignments
      .filter((x) => x.work_order_id === woId && !["cancelled", "rejected"].includes(x.status)
        && (color === undefined || norm(x.color) === norm(color)))
      .reduce((s, x) => s + (Number(x.assigned_quantity) || 0), 0);

  // ---- saldos de días pasados (casillas que cerraron por debajo) ---------
  const srcDay = String(a.assigned_date || "").slice(0, 10);
  const balKey = (r) => `${r.line_no}|${String(r.assigned_date).slice(0, 10)}`;
  const balRowsOf = (woId) =>
    balSource
      .filter((r) => Number(r.work_order_id) === Number(woId) && Number(r.balance) > 0
        && !(String(r.line_no) === String(a.line_no) && String(r.assigned_date).slice(0, 10) === srcDay))
      .sort((x, y) => String(x.assigned_date).localeCompare(String(y.assigned_date)));
  const balanceOfWo = (woId) => balRowsOf(woId).reduce((t, r) => t + (Number(r.balance) || 0), 0);
  // Capturó producción sin ligar la orden: el saldo puede ser falso.
  const suspicious = (r) => !r.run_linked && Number(r.runs_on_day) > 0;
  // Marca saldos (del más viejo al más nuevo, sin los dudosos) hasta cubrir
  // lo que falta para mover toda la casilla.
  const autoPickBalances = (woId, baseFree) => {
    const next = new Set();
    let have = baseFree == null ? Infinity : baseFree;
    for (const r of balRowsOf(woId)) {
      if (have >= movable) break;
      if (suspicious(r)) continue;
      next.add(balKey(r));
      have += Number(r.balance) || 0;
    }
    setPickedBal(next);
    return have;
  };

  const targetWo = mode === "color"
    ? workOrders.find((w) => w.id === targetId) || srcWo
    : workOrders.find((w) => w.id === targetId) || null;

  // Cambiar color: todos los colores DISPONIBLES del mismo estilo y cliente,
  // de esta orden o de otros PO del mismo estilo (igual que el tablero:
  // mismo estilo + mismo cliente = cambio de color).
  const styleKey = (w) => norm(w?.style_code || w?.estilo);
  const custKey = (w) => (w?.customer_id != null ? `id:${w.customer_id}` : norm(w?.customer_name));
  const colorChoices = useMemo(() => {
    if (srvOrders) {
      const out = [];
      srvOrders.forEach((o) => {
        o.colors.forEach((c) => {
          if (o.own && c.color === norm(a.color)) return;
          const free = o.own ? c.free : c.free == null ? o.free : Math.min(c.free, o.free);
          out.push({ woId: o.id, woNo: o.work_order_no, po: o.customer_po, color: c.color, free, own: o.own, bal: balanceOfWo(o.id) });
        });
      });
      const avail = (x) => x.free == null || x.free > 0 || x.bal > 0;
      return out.sort((x, y) =>
        Number(avail(y)) - Number(avail(x)) || Number(y.own) - Number(x.own)
        || (y.free ?? 1e9) - (x.free ?? 1e9) || x.color.localeCompare(y.color));
    }
    if (!srcWo) return [];
    const st = styleKey(srcWo), cu = custKey(srcWo);
    const out = [];
    workOrders
      .filter((w) => w.id === srcWo.id || (
        st && styleKey(w) === st && custKey(w) === cu && !["completed", "cancelled"].includes(w.status)))
      .forEach((w) => {
        const orderFree = Math.max(targetOf(w) - assignedFor(w.id), 0);
        colorsOf(w).forEach((c) => {
          if (w.id === srcWo.id && c.color === norm(a.color)) return;
          const colorFree = c.qty == null ? null : Math.max(c.qty - assignedFor(w.id, c.color), 0);
          // Otra orden: tambien la limita lo que le queda sin asignar.
          const free = w.id === srcWo.id
            ? colorFree
            : colorFree == null ? orderFree : Math.min(colorFree, orderFree);
          out.push({ woId: w.id, woNo: w.work_order_no, po: w.customer_po, color: c.color, free, own: w.id === srcWo.id, bal: balanceOfWo(w.id) });
        });
      });
    const avail = (x) => x.free == null || x.free > 0 || x.bal > 0;
    return out.sort((x, y) =>
      Number(avail(y)) - Number(avail(x)) || Number(y.own) - Number(x.own)
      || (y.free ?? 1e9) - (x.free ?? 1e9) || x.color.localeCompare(y.color));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srvOrders, srcWo, workOrders, assignments, a.color, balSource]);
  const pickedChoice = mode === "color"
    ? colorChoices.find((c) => c.color === newColor && c.woId === (targetId ?? srcWo?.id)) || null
    : null;
  const pickColorChoice = (c) => {
    setTargetId(c.own ? null : c.woId);
    setNewColor(c.color);
    const have = autoPickBalances(c.woId, c.free);
    setQty(String(Number.isFinite(have) ? Math.max(Math.min(movable, have), 0) : movable));
    setError(null);
  };
  const colorOptions = useMemo(() => {
    if (!targetWo) return [];
    return colorsOf(targetWo)
      .filter((c) => !(mode === "color" && c.color === norm(a.color)))
      .map((c) => ({ ...c, free: c.qty == null ? null : Math.max(c.qty - assignedFor(targetWo.id, c.color), 0) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetWo, mode, assignments]);

  // Órdenes candidatas para cambio de estilo: activas, con piezas sin asignar.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workOrders
      .filter((w) => w.id !== a.work_order_id && !["completed", "cancelled"].includes(w.status))
      .map((w) => ({ w, free: Math.max(targetOf(w) - assignedFor(w.id), 0), bal: balanceOfWo(w.id) }))
      .filter(({ free, bal }) => free > 0 || bal > 0)
      .filter(({ w }) => !q || [w.work_order_no, w.style_code, w.estilo, w.style_description, w.customer_name, w.customer_po]
        .some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders, assignments, query, a.work_order_id, balSource]);

  const switchMode = (m) => { setMode(m); setNewColor(""); setTargetId(null); setPickedBal(new Set()); setError(null); };
  const pickTarget = (id) => {
    setTargetId(id);
    const w = workOrders.find((x) => x.id === id);
    const opts = colorsOf(w);
    setNewColor(opts.length === 1 ? opts[0].color : "");
    const have = autoPickBalances(id, Math.max(targetOf(w) - assignedFor(id), 0));
    setQty(String(Math.max(Math.min(movable, have), 0)));
    setError(null);
  };

  // Cambiar color: TODOS los saldos pasados del mismo estilo y cliente.
  const sameStyleIds = new Set((srvOrders || []).map((o) => Number(o.id)));
  const sameStyleBal = balSource
    .filter((r) => sameStyleIds.has(Number(r.work_order_id)) && Number(r.balance) > 0
      && !(String(r.line_no) === String(a.line_no) && String(r.assigned_date).slice(0, 10) === srcDay))
    .sort((x, y) => String(y.assigned_date).localeCompare(String(x.assigned_date)));
  // Colores que puede tomar una fila de saldo (sin el color actual de la misma orden).
  const rowColorChoices = (r) => {
    const ch = colorChoices.filter((c) => c.woId === Number(r.work_order_id));
    const rc = (r.colors || []).map(norm);
    // Un saldo sólo alimenta SU color (la tela ya está cortada en ese color).
    if (!rc.length) return ch;
    return ch.filter((c) => rc.includes(c.color));
  };
  const pickBalanceRow = (r) => {
    const woId = Number(r.work_order_id);
    const curWo = pickedChoice ? pickedChoice.woId : null;
    if (curWo === woId) { toggleBal(r); return; }
    const ch = rowColorChoices(r);
    if (!ch.length) { setError("Esa orden no tiene otro color para esta casilla."); return; }
    const c = ch[0];
    setTargetId(c.own ? null : c.woId);
    setNewColor(c.color);
    const next = new Set([balKey(r)]);
    setPickedBal(next);
    const have = (c.free ?? 0) + (Number(r.balance) || 0);
    setQty(String(Math.max(Math.min(movable, Math.floor(have)), 0)));
    setError(null);
  };

  // Piezas disponibles para el destino = libres + saldos marcados.
  const balTargetId = mode === "color" ? (pickedChoice ? pickedChoice.woId : null) : targetId;
  const balRows = balTargetId != null ? balRowsOf(balTargetId) : [];
  const pickedRows = balRows.filter((r) => pickedBal.has(balKey(r)));
  const pickedSum = pickedRows.reduce((t, r) => t + (Number(r.balance) || 0), 0);
  const baseFree = mode === "color"
    ? (pickedChoice ? pickedChoice.free : null)
    : (targetWo ? Math.max(targetOf(targetWo) - assignedFor(targetWo.id), 0) : null);
  const available = baseFree == null ? null : Math.floor(baseFree + pickedSum);
  const toggleBal = (r) => {
    const k = balKey(r);
    setPickedBal((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };

  const qtyNum = Math.floor(Number(qty) || 0);
  const needsColor = colorOptions.length > 0;
  const ready = !busy && reason.trim().length >= 5 && qtyNum > 0 && qtyNum <= movable
    && (available == null || qtyNum <= available)
    && (mode === "color" ? !!pickedChoice : !!targetId && (!needsColor || !!newColor));

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/line-assignments/urgent-change`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          assignmentId: a.id,
          mode,
          newColor: newColor || null,
          newWorkOrderId: targetId ?? undefined,
          balanceCells: pickedRows.map((r) => ({ lineNo: r.line_no, date: String(r.assigned_date).slice(0, 10) })),
          quantity: qtyNum,
          reason: reason.trim(),
          sendToLines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) { onDone?.(data); return; }
      if (onMissingStyle && onMissingStyle(data, submit)) return;
      if (data.maxQuantity != null) setQty(String(data.maxQuantity));
      setError(data.error || `No se pudo hacer el cambio (HTTP ${res.status}).`);
    } catch (err) {
      setError(`Error de red: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const day = String(a.assigned_date || "").slice(0, 10);
  const srcLabel = `${srcWo?.work_order_no || `#${a.work_order_id}`}${a.color ? ` · ${a.color}` : ""}`;
  const tgtLabel = targetWo ? `${targetWo.work_order_no}${newColor ? ` · ${newColor}` : ""}` : "—";

  const maxQty = available == null ? movable : Math.min(movable, available);
  const tabCls = (m) => `py-2 rounded-lg text-[12px] font-semibold transition-colors ${mode === m ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"}`;
  const H = ({ children, hint }) => (
    <div className="mb-1.5">
      <div className="text-[12px] font-semibold text-gray-800">{children}{hint && <span className="font-normal text-gray-400"> · {hint}</span>}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Cambio urgente"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[860px] max-h-[92vh] flex flex-col overflow-hidden text-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Encabezado ── */}
        <div className="relative pl-5 pr-3 py-3 border-b flex items-start gap-3">
          <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-orange-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-orange-600" />
              <h3 className="font-bold text-gray-900 text-[15px] tracking-tight">Cambio urgente</h3>
            </div>
            <p className="text-gray-500 mt-0.5 flex items-center gap-1 truncate">
              <Lock className="w-3 h-3 shrink-0" />
              {weekLabel}{weekLock?.locked_by_name ? ` · bloqueada por ${weekLock.locked_by_name}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-[12px] font-semibold rounded-lg bg-gray-900 text-white px-2.5 py-1">Línea {a.line_no}</span>
          <span className="shrink-0 text-[12px] rounded-lg border border-gray-200 text-gray-700 px-2.5 py-1">{day.slice(8)}/{day.slice(5, 7)}/{day.slice(0, 4)}</span>
          <button onClick={onClose} className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </div>

        {/* ── Cuerpo ── */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-[1.15fr_1fr] md:divide-x divide-gray-200">
          {/* Izquierda: elegir destino */}
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl" role="tablist">
              <button role="tab" aria-selected={mode === "color"} onClick={() => switchMode("color")} className={tabCls("color")}>Cambiar color</button>
              <button role="tab" aria-selected={mode === "style"} onClick={() => switchMode("style")} className={tabCls("style")}>Cambiar estilo</button>
            </div>

            {mode === "color" && (
              <section>
                <H hint={`mismo estilo ${srcWo?.style_code || srcWo?.estilo || ""}`}>Nuevo color</H>
                {loadingOpts && !srvOrders ? (
                  <div className="text-gray-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando órdenes y saldos del mismo estilo…</div>
                ) : colorChoices.length === 0 ? (
                  <div className="text-gray-500">Este estilo no tiene otro color en ninguna orden activa.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {colorChoices.map((c) => {
                      const on = pickedChoice && pickedChoice.woId === c.woId && pickedChoice.color === c.color;
                      const none = c.free === 0 && !(c.bal > 0);
                      return (
                        <button key={`${c.woId}|${c.color}`} disabled={none} onClick={() => pickColorChoice(c)}
                          title={none ? "Sin piezas disponibles" : c.own ? "Misma orden" : `Orden ${c.woNo}${c.po ? ` · PO ${c.po}` : ""}`}
                          className={`text-left rounded-xl border px-3 py-2 transition-colors ${on ? "border-orange-600 bg-orange-50 ring-1 ring-orange-600" : none ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed" : "border-gray-200 bg-white hover:border-gray-400"}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`text-[14px] font-bold ${on ? "text-orange-800" : none ? "" : "text-gray-900"}`}>{c.color}</span>
                            <span className={`text-[11px] tabular-nums ${none ? "" : "text-gray-500"}`}>{c.free == null ? "disponible" : `${fmt(c.free)} libres`}</span>
                          </div>
                          <div className={`text-[10px] truncate ${none ? "" : "text-gray-400"}`}>{c.own ? "Misma orden" : `${c.woNo}${c.po ? ` · PO ${c.po}` : ""}`}</div>
                          {c.bal > 0 && <div className="text-[11px] text-amber-700 font-medium">+{fmt(c.bal)} pzas de saldo</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {mode === "color" && !loadingOpts && (
              <section>
                <H hint="mismo estilo y cliente">Saldos de días pasados</H>
                {sameStyleBal.length === 0 ? (
                  <div className="text-gray-500">
                    {srvBal ? "No hay días pasados con piezas sin coser para este estilo." : "No se pudieron leer los saldos (la captura de piso no está ligada a las órdenes)."}
                  </div>
                ) : (
                  <>
                    <p className="text-gray-400 -mt-1 mb-1.5">Marque un día para tomar sus piezas. El día se cierra con lo que sí se cosió.</p>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {sameStyleBal.map((r) => {
                        const d = String(r.assigned_date).slice(0, 10);
                        const isTarget = pickedChoice && pickedChoice.woId === Number(r.work_order_id);
                        const on = isTarget && pickedBal.has(balKey(r));
                        const usable = rowColorChoices(r).length > 0;
                        return (
                          <label key={`${r.work_order_id}|${balKey(r)}`}
                            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 ${usable ? "cursor-pointer bg-white hover:border-amber-400" : "bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed"} ${on ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500" : "border-gray-200"}`}>
                            <input type="checkbox" className="mt-0.5 accent-orange-600" disabled={!usable} checked={!!on} onChange={() => pickBalanceRow(r)} />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="text-gray-900 font-semibold">{d.slice(8)}/{d.slice(5, 7)} · Línea {r.line_no}</span>
                                <span className="text-amber-800 font-bold tabular-nums shrink-0">{fmt(r.balance)} pzas</span>
                              </span>
                              <span className="block text-gray-600 truncate">{r.work_order_no}{(r.colors || []).length ? ` · ${r.colors.join(", ")}` : ""}</span>
                              <span className="block text-gray-400">{fmt(r.assigned)} asignadas · {fmt(r.produced)} cosidas</span>
                              {!usable && (
                                <span className="block text-gray-500">
                                  {Number(r.work_order_id) === Number(a.work_order_id) && (r.colors || []).map(norm).includes(norm(a.color))
                                    ? "Mismo color de esta casilla: no es un cambio de color."
                                    : "Su color no está disponible en la orden."}
                                </span>
                              )}
                              {suspicious(r) && <span className="block text-rose-700">La línea capturó producción sin ligar la orden: puede que ya estén hechas.</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            )}

            {mode === "style" && (
              <section>
                <H>Orden con el nuevo estilo</H>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input id="urgent-search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar orden"
                    placeholder="Buscar por orden, estilo, cliente o PO"
                    className="w-full pl-8 pr-2 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {candidates.length === 0 && <div className="text-gray-500 px-1">Ninguna orden con piezas libres o saldo de días pasados coincide.</div>}
                  {candidates.map(({ w, free, bal }) => (
                    <button key={w.id} onClick={() => pickTarget(w.id)}
                      className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${targetId === w.id ? "border-orange-600 bg-orange-50 ring-1 ring-orange-600" : "border-gray-200 bg-white hover:border-gray-400"}`}>
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold text-gray-900 truncate">{w.work_order_no}</span>
                        <span className="text-gray-500 shrink-0 tabular-nums">
                          {fmt(free)} libres{bal > 0 && <span className="text-amber-700"> · +{fmt(bal)} saldo</span>}
                        </span>
                      </div>
                      <div className="text-gray-500 truncate">{w.style_code || w.estilo || "—"} · {w.style_description} · {w.customer_name}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {mode === "style" && targetWo && (
              <section>
                <H>Color</H>
                {colorOptions.length === 0 ? (
                  <div className="text-gray-500">La orden no tiene desglose por color.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {colorOptions.map((c) => (
                      <button key={c.color} onClick={() => { setNewColor(c.color); setError(null); }}
                        className={`px-3 py-1.5 rounded-lg border ${newColor === c.color ? "border-orange-600 bg-orange-50 text-orange-800 font-semibold ring-1 ring-orange-600" : "border-gray-200 bg-white hover:border-gray-400 text-gray-700"}`}>
                        {c.color}{c.free != null && <span className="text-gray-500 font-normal"> · {fmt(c.free)} libres</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {mode === "style" && balRows.length > 0 && (
              <section>
                <H hint={workOrders.find((w) => w.id === balTargetId)?.work_order_no}>Saldos de días pasados</H>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {balRows.map((r) => {
                    const k = balKey(r);
                    const d = String(r.assigned_date).slice(0, 10);
                    const on = pickedBal.has(k);
                    return (
                      <label key={k} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer bg-white hover:border-amber-400 ${on ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500" : "border-gray-200"}`}>
                        <input type="checkbox" className="mt-0.5 accent-orange-600" checked={on} onChange={() => toggleBal(r)} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-gray-900 font-semibold">{d.slice(8)}/{d.slice(5, 7)} · Línea {r.line_no}{(r.colors || []).length ? ` · ${r.colors.join(", ")}` : ""}</span>
                            <span className="text-amber-800 font-bold tabular-nums shrink-0">{fmt(r.balance)} pzas</span>
                          </span>
                          <span className="block text-gray-400">{fmt(r.assigned)} asignadas · {fmt(r.produced)} cosidas</span>
                          {suspicious(r) && <span className="block text-rose-700">La línea capturó producción sin ligar la orden: puede que ya estén hechas.</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* Derecha: resumen y confirmación */}
          <div className="p-4 space-y-4 bg-gray-50/50">
            <section>
              <H>Resumen del cambio</H>
              <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Antes</div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-gray-900 truncate">{srcWo?.work_order_no || `#${a.work_order_id}`}</span>
                  <span className="text-[14px] font-bold text-gray-900 shrink-0">{a.color || "—"}</span>
                </div>
                <div className="text-gray-500 tabular-nums">
                  {fmt(srcQty)} pzas{produced > 0 ? ` · ${fmt(produced)} ya cosidas` : ""} · {fmt(movable)} se pueden cambiar
                </div>
              </div>
              <div className="flex justify-center py-1 text-orange-600" aria-hidden>↓</div>
              <div className={`rounded-xl border px-3 py-2.5 ${targetWo && (newColor || colorOptions.length === 0) ? "border-orange-300 bg-orange-50" : "border-dashed border-gray-300 bg-white"}`}>
                <div className="text-[11px] text-gray-500">Después</div>
                {targetWo && (newColor || (mode === "style" && colorOptions.length === 0)) ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-orange-900 truncate">{targetWo.work_order_no}</span>
                      <span className="text-[14px] font-bold text-orange-800 shrink-0">{newColor || "—"}</span>
                    </div>
                    <div className="text-orange-800 tabular-nums">
                      {fmt(qtyNum)} pzas{pickedSum > 0 ? ` · ${fmt(pickedSum)} de saldos` : ""}
                    </div>
                    {qtyNum > 0 && qtyNum < srcQty && <div className="text-gray-600">Se quedan {fmt(srcQty - qtyNum)} pzas de {srcLabel}.</div>}
                  </>
                ) : (
                  <div className="text-gray-400">{mode === "color" ? "Elija un color o un saldo a la izquierda." : "Elija una orden a la izquierda."}</div>
                )}
              </div>
            </section>

            <section>
              <label className="text-[12px] font-semibold text-gray-800" htmlFor="urgent-qty">Piezas a cambiar</label>
              <div className="mt-1 grid grid-cols-[1fr_auto] gap-2">
                <input id="urgent-qty" type="number" min={1} max={movable} value={qty} onChange={(e) => setQty(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-500" />
                <button onClick={() => setQty(String(maxQty))} className="px-3 py-2 border rounded-xl bg-white text-gray-700 hover:bg-gray-50">Máx. ({fmt(maxQty)})</button>
              </div>
              {available != null && (
                <div className={`mt-1 text-[11px] ${qtyNum > available ? "text-rose-700" : "text-gray-500"}`}>
                  Disponible: <span className="font-semibold">{fmt(available)} pzas</span>
                  {pickedSum > 0 && ` (${fmt(baseFree)} libres + ${fmt(pickedSum)} de saldos)`}
                  {qtyNum > available && " · marque más saldos o baje la cantidad."}
                </div>
              )}
            </section>

            <section>
              <label className="text-[12px] font-semibold text-gray-800" htmlFor="urgent-reason">Motivo</label>
              <textarea id="urgent-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. No llegó la tela azul; el cliente adelantó el estilo 12"
                className="mt-1 w-full px-3 py-2 border rounded-xl bg-white resize-none focus:outline-none focus:ring-2 focus:ring-orange-500" />
              <p className={`text-[11px] ${reason.trim().length > 0 && reason.trim().length < 5 ? "text-rose-600" : "text-gray-400"}`}>
                {reason.trim().length < 5 ? `Mínimo 5 caracteres (${reason.trim().length}/5). ` : ""}Queda en la bitácora con su nombre y avisa al CEO.
              </p>
            </section>

            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={sendToLines} onChange={(e) => setSendToLines(e.target.checked)} className="accent-orange-600" />
              Enviar el cambio a los líderes de línea
            </label>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800" role="alert">{error}</div>}
          </div>
        </div>

        {/* ── Acciones ── */}
        <div className="px-4 py-3 border-t bg-white flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancelar</button>
          <button onClick={submit} disabled={!ready}
            title={ready ? "" : [
              mode === "style" && !targetId ? "Elija la orden" : "",
              (mode === "color" || (targetId && needsColor)) && !newColor ? "Elija el color" : "",
              !(qtyNum > 0 && qtyNum <= movable) ? `Piezas entre 1 y ${movable}` : "",
              available != null && qtyNum > available ? `Sólo hay ${available} disponibles: marque saldos` : "",
              reason.trim().length < 5 ? "Motivo de al menos 5 caracteres" : "",
            ].filter(Boolean).join(" · ")}
            className="px-4 py-2 text-[12px] font-semibold bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {mode === "color" ? "Cambiar color" : "Cambiar estilo"}
          </button>
        </div>
      </div>
    </div>
  );
}