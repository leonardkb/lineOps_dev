// components/planner/PlanRebalanceModal.jsx
// ---------------------------------------------------------------------------
// Redistribución exacta del Plan Board + snapshots.
//
//  • Vista previa (no toca nada): por línea, cada orden reempacada en secuencia
//    llenando cada día a su capacidad (401 · 401 · 401 · 401 · 347 …).
//  • Aplicar: el servidor guarda un SNAPSHOT del estado actual, escribe el plan,
//    verifica pieza por pieza y, si algo no cuadra, no aplica nada.
//  • Snapshots: lista de estados guardados; cualquiera se puede restaurar.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { X, Loader2, Check, AlertCircle, History, Shuffle, RotateCcw, Save } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const fmtQty = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
const dayLabel = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return format(d, "EEE dd/MM", { locale: es });
};
const utilClass = (load, cap) => {
  if (!(cap > 0)) return "text-gray-400";
  const u = load / cap;
  if (u > 1.0001) return "text-rose-700 font-bold";
  if (u >= 0.95) return "text-green-700 font-semibold";
  if (u >= 0.8) return "text-amber-700";
  return "text-orange-700";
};

export default function PlanRebalanceModal({
  open,
  onClose,
  weekStart,          // "YYYY-MM-DD" (lunes)
  weekEnd,            // "YYYY-MM-DD" (domingo)
  weekLabel,          // "Sem 39"
  allLines = [],      // orden de líneas del tablero
  locked = false,     // semana bloqueada por el CEO
  onApplied,          // () => refrescar el tablero
  showToast,          // (msg, isError)
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const defaultFrom = todayStr > weekStart && todayStr <= weekEnd ? todayStr : weekStart;

  const [tab, setTab] = useState("plan");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(weekEnd);
  const [sequence, setSequence] = useState("current");
  const [selLines, setSelLines] = useState(() => new Set()); // vacío = todas
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [snaps, setSnaps] = useState([]);
  const [snapsBusy, setSnapsBusy] = useState(false);
  const [openLine, setOpenLine] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTab("plan");
    setFromDate(defaultFrom);
    setToDate(weekEnd);
    setPreview(null);
    setError(null);
    setLabel("");
    setSelLines(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, weekStart, weekEnd]);

  // Cualquier cambio de parámetros invalida la vista previa.
  useEffect(() => { setPreview(null); }, [fromDate, toDate, sequence, selLines]);

  const body = () => ({
    fromDate,
    toDate,
    sequence,
    lines: selLines.size ? [...selLines] : null,
  });

  const loadSnaps = async () => {
    setSnapsBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/plan-board/snapshots?from=${weekStart}&to=${weekEnd}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setSnaps(data.snapshots || []);
      else showToast?.(data.error || "No se pudieron cargar los snapshots", true);
    } catch (e) {
      showToast?.(`Error: ${e.message}`, true);
    } finally {
      setSnapsBusy(false);
    }
  };
  useEffect(() => { if (open && tab === "snaps") loadSnaps(); /* eslint-disable-next-line */ }, [open, tab]);

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/plan-board/rebalance/preview`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(body()),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setPreview(data);
      setOpenLine(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    const s = preview.summary;
    const ok = window.confirm(
      `Se guardará un snapshot del estado actual y se redistribuirán ${fmtQty(s.piecesBefore)} pzas ` +
      `de ${s.orders} orden(es) en ${s.lines} línea(s).\n\n` +
      `Las líneas NO cambian; sólo los días y cantidades por celda.\n¿Continuar?`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/plan-board/rebalance/apply`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...body(), inputFingerprint: preview.inputFingerprint, label: label || `${weekLabel} redistribución` }),
      });
      const data = await res.json();
      if (!data.success) {
        const extra = data.details ? `\n${JSON.stringify(data.details).slice(0, 400)}` : "";
        throw new Error((data.error || `HTTP ${res.status}`) + extra);
      }
      showToast?.(`✅ Redistribuido: ${fmtQty(data.summary.piecesAfter)} pzas en ${data.cellsWritten} celdas · snapshot #${data.snapshotId}`);
      setPreview(null);
      onApplied?.();
      setTab("snaps");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    setSnapsBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/plan-board/snapshots`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ fromDate: weekStart, toDate: weekEnd, label: `${weekLabel} manual` }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
      showToast?.(`📸 Snapshot #${data.snapshotId} guardado (${data.rows} celdas, ${fmtQty(data.pieces)} pzas)`);
      loadSnaps();
    } catch (e) {
      showToast?.(`Error: ${e.message}`, true);
      setSnapsBusy(false);
    }
  };

  const restore = async (snap, force = false) => {
    if (!force && !window.confirm(`¿Restaurar el snapshot #${snap.id}? El tablero de esas líneas volverá exactamente a ese estado.`)) return;
    setSnapsBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/plan-board/snapshots/${snap.id}/restore`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (res.status === 409 && data.conflict) {
        setSnapsBusy(false);
        if (window.confirm(`${data.error}\n\n¿Restaurar de todos modos?`)) return restore(snap, true);
        return;
      }
      if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const skip = data.skipped ? ` · ${data.skipped} celda(s) ya no planeadas se dejaron igual` : "";
      showToast?.(`↩︎ Snapshot #${snap.id} restaurado: ${fmtQty(data.piecesRestored)} pzas${skip}`);
      onApplied?.();
      loadSnaps();
    } catch (e) {
      showToast?.(`Error: ${e.message}`, true);
      setSnapsBusy(false);
    }
  };

  const toggleLine = (ln) =>
    setSelLines((prev) => {
      const n = new Set(prev);
      if (n.has(String(ln))) n.delete(String(ln)); else n.add(String(ln));
      return n;
    });

  if (!open) return null;
  const s = preview?.summary;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Shuffle className="w-4 h-4 text-indigo-600" /> Redistribuir {weekLabel}
              <span className="text-xs font-normal text-gray-500">
                ({format(new Date(`${weekStart}T00:00:00`), "dd/MM/yyyy")} – {format(new Date(`${weekEnd}T00:00:00`), "dd/MM/yyyy")})
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Cada orden se mantiene en su línea. Los días se llenan a capacidad completa y sólo el último día de cada orden lleva el remanente.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-2 border-b">
          {[["plan", "Redistribuir", Shuffle], ["snaps", "Snapshots", History]].map(([k, t, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-sm inline-flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon className="w-3.5 h-3.5" /> {t}
            </button>
          ))}
        </div>

        {tab === "plan" && (
          <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
            {locked && (
              <div className="text-sm bg-slate-100 text-slate-700 border border-slate-300 rounded-lg px-3 py-2">
                🔒 Esta semana está bloqueada por el CEO. Puede ver la vista previa, pero no aplicar.
              </div>
            )}

            {/* Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">Desde
                <input type="date" value={fromDate} min={weekStart} max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                {fromDate < todayStr && <span className="text-[11px] text-amber-700">Incluye días pasados</span>}
              </label>
              <label className="text-xs text-gray-600">Hasta
                <input type="date" value={toDate} min={fromDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-600">Secuencia de órdenes
                <select value={sequence} onChange={(e) => setSequence(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                  <option value="current">Mantener orden actual del tablero</option>
                  <option value="commitment">Por fecha de entrega</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">Nota del snapshot
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${weekLabel} redistribución`}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
            </div>

            <div>
              <div className="text-xs text-gray-600 mb-1">Líneas {selLines.size ? `(${selLines.size} seleccionadas)` : "(todas las que tienen órdenes planeadas)"}</div>
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setSelLines(new Set())}
                  className={`px-2 py-0.5 text-xs rounded border ${selLines.size === 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300"}`}>Todas</button>
                {allLines.map((ln) => (
                  <button key={ln} onClick={() => toggleLine(ln)}
                    className={`px-2 py-0.5 text-xs rounded border tabular-nums ${selLines.has(String(ln)) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>L{ln}</button>
                ))}
              </div>
            </div>

            <div className="text-[11px] text-gray-500 leading-relaxed">
              Sólo se mueven celdas <b>Planeadas</b> dentro del rango. Las celdas Completadas / Enviadas a línea, las reservas PRE-orden
              y lo planeado después de “Hasta” quedan fijos y ocupan su capacidad. Se saltan fines de semana y días festivos.
              Si una línea no cabe en el rango, el resto pasa a los siguientes días hábiles sin sobrecargar ningún día.
            </div>

            <div className="flex items-center gap-2">
              <button onClick={runPreview} disabled={busy}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-black disabled:opacity-60 inline-flex items-center gap-1.5">
                {busy && !preview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />} Vista previa
              </button>
              {preview && (
                <button onClick={apply} disabled={busy || locked || !s?.piecesConserved || s?.unplacedPieces > 0}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar snapshot y aplicar
                </button>
              )}
            </div>

            {error && (
              <div className="text-sm bg-rose-50 text-rose-700 border border-rose-200 rounded-lg px-3 py-2 flex gap-2 whitespace-pre-wrap">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {preview && s && (
              <>
                {/* Checks */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Stat label="Piezas antes → después" value={`${fmtQty(s.piecesBefore)} → ${fmtQty(s.piecesAfter)}`}
                    ok={s.piecesConserved} note={s.piecesConserved ? "Cuadra al centavo" : "NO cuadra"} />
                  <Stat label="Órdenes / líneas" value={`${s.orders} / ${s.lines}`} />
                  <Stat label="Celdas" value={`${s.cellsBefore} → ${s.cellsAfter}`} note="menos fragmentos" />
                  <Stat label="Días sobrecargados" value={`${s.overDaysBefore} → ${s.overDaysAfter}`} ok={s.overDaysAfter === 0} />
                  <Stat label="Pasan después de “Hasta”" value={`${fmtQty(s.spillPieces)} pzas`} warn={s.spillPieces > 0} />
                  <Stat label="Terminan después de entrega" value={`${s.lateOrders} orden(es)`} warn={s.lateOrders > 0} />
                </div>
                {s.unplacedPieces > 0 && (
                  <div className="text-sm bg-rose-50 text-rose-700 border border-rose-200 rounded-lg px-3 py-2">
                    {fmtQty(s.unplacedPieces)} pzas no caben (línea sin capacidad configurada). No se puede aplicar.
                  </div>
                )}

                {/* Per line */}
                <div className="space-y-2">
                  {preview.lines.map((l) => (
                    <LineCard key={l.lineNo} line={l} toDate={preview.params.toDate}
                      open={openLine === l.lineNo} onToggle={() => setOpenLine(openLine === l.lineNo ? null : l.lineNo)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "snaps" && (
          <div className="flex-1 overflow-auto px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500">Estados guardados que tocan {weekLabel}. Cada redistribución guarda uno automáticamente.</p>
              <button onClick={saveManual} disabled={snapsBusy}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 inline-flex items-center gap-1.5 disabled:opacity-60">
                <Save className="w-4 h-4" /> Guardar snapshot ahora
              </button>
            </div>
            {snapsBusy && snaps.length === 0 ? (
              <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : snaps.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">Sin snapshots para esta semana.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b">
                  <tr>
                    <th className="text-left py-1.5">#</th><th className="text-left">Fecha</th><th className="text-left">Tipo</th>
                    <th className="text-left">Nota</th><th className="text-left">Rango</th><th className="text-right">Líneas</th>
                    <th className="text-right">Celdas</th><th className="text-left pl-3">Usuario</th><th />
                  </tr>
                </thead>
                <tbody>
                  {snaps.map((sn) => (
                    <tr key={sn.id} className="border-b last:border-0">
                      <td className="py-1.5 tabular-nums text-gray-500">{sn.id}</td>
                      <td className="tabular-nums">{format(new Date(sn.created_at), "dd/MM HH:mm")}</td>
                      <td>{sn.kind === "rebalance"
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Antes de redistribuir</span>
                        : <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">Manual</span>}
                        {sn.status === "restored" && <span className="ml-1 text-[11px] text-emerald-700">· restaurado</span>}
                      </td>
                      <td className="text-gray-700 truncate max-w-[220px]">{sn.label || "—"}</td>
                      <td className="tabular-nums text-xs">{sn.from_date?.slice(5)} → {sn.to_date ? sn.to_date.slice(5) : "…"}</td>
                      <td className="text-right tabular-nums">{sn.lines?.length || 0}</td>
                      <td className="text-right tabular-nums">{sn.rows_count}</td>
                      <td className="pl-3 text-gray-500 text-xs">{sn.created_by || "—"}</td>
                      <td className="text-right">
                        <button onClick={() => restore(sn)} disabled={snapsBusy || locked}
                          className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50">
                          <RotateCcw className="w-3 h-3" /> Restaurar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, ok, warn, note }) {
  const tone = ok === true ? "border-emerald-200 bg-emerald-50" : ok === false ? "border-rose-200 bg-rose-50" : warn ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums flex items-center gap-1">
        {ok === true && <Check className="w-3.5 h-3.5 text-emerald-600" />}
        {ok === false && <AlertCircle className="w-3.5 h-3.5 text-rose-600" />}
        {value}
      </div>
      {note && <div className="text-[10px] text-gray-500">{note}</div>}
    </div>
  );
}

function LineCard({ line, toDate, open, onToggle }) {
  const inRange = line.days.filter((d) => d.inRange && !d.blocked);
  const spill = line.days.filter((d) => d.date > toDate && !d.blocked);
  const spillAfter = spill.reduce((s, d) => s + d.after - d.fixed, 0);
  const cols = inRange;
  const capWeek = inRange.reduce((s, d) => s + d.capacity, 0);
  const loadBefore = inRange.reduce((s, d) => s + d.before, 0);
  const loadAfter = inRange.reduce((s, d) => s + d.after, 0);
  const overB = inRange.filter((d) => d.overBefore).length;

  const cellAfter = (o, date) => o.cellsAfter.find((c) => c.date === date)?.qty || 0;
  const cellBefore = (o, date) => o.cellsBefore.find((c) => c.date === date)?.qty || 0;
  const spillOf = (o) => o.cellsAfter.filter((c) => c.date > toDate).reduce((s, c) => s + c.qty, 0);

  const summaryTxt = useMemo(
    () => line.orders.map((o) => `${o.workOrderNo} ${o.color || ""}`.trim()).join(" · "),
    [line.orders]
  );

  return (
    <div className="border border-gray-200 rounded-lg">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50">
        <span className="text-sm font-bold text-gray-800 w-10">L{line.lineNo}</span>
        <span className="text-xs text-gray-500 tabular-nums w-40">
          {fmtQty(loadBefore)} → <span className={utilClass(loadAfter, capWeek)}>{fmtQty(loadAfter)}</span> / {fmtQty(capWeek)}
        </span>
        <span className="text-xs text-gray-500 w-28 tabular-nums">celdas {line.cellsBefore} → {line.cellsAfter}</span>
        {overB > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">{overB} día(s) sobrecargado(s) antes</span>}
        {spillAfter > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{fmtQty(spillAfter)} pzas pasan después</span>}
        <span className="text-xs text-gray-400 truncate flex-1">{summaryTxt}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left px-2 py-1.5">#</th>
                <th className="text-left px-2">Orden · color</th>
                <th className="text-right px-2">Total</th>
                {cols.map((d) => <th key={d.date} className="text-right px-2 capitalize whitespace-nowrap">{dayLabel(d.date)}</th>)}
                {spill.length > 0 && <th className="text-right px-2 whitespace-nowrap">Después</th>}
                <th className="text-left px-2 whitespace-nowrap">Fin plan</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-gray-50/60">
                <td /><td className="px-2 py-1 text-gray-500">Capacidad del día</td><td />
                {cols.map((d) => <td key={d.date} className="text-right px-2 tabular-nums text-gray-600">{fmtQty(d.capacity)}</td>)}
                {spill.length > 0 && <td />}<td />
              </tr>
              {cols.some((d) => d.fixed > 0) && (
                <tr className="border-b">
                  <td /><td className="px-2 py-1 text-gray-500">Fijo (completado / enviado / reserva)</td><td />
                  {cols.map((d) => <td key={d.date} className="text-right px-2 tabular-nums text-gray-500">{d.fixed ? fmtQty(d.fixed) : ""}</td>)}
                  {spill.length > 0 && <td />}<td />
                </tr>
              )}
              {line.orders.map((o) => (
                <tr key={o.key} className="border-b last:border-0">
                  <td className="px-2 py-1 text-gray-400 tabular-nums">{o.seq}</td>
                  <td className="px-2 whitespace-nowrap">
                    <span className="font-medium text-gray-800">{o.workOrderNo}</span>
                    {o.color && <span className="text-gray-500"> · {o.color}</span>}
                  </td>
                  <td className="text-right px-2 tabular-nums font-medium">{fmtQty(o.totalAfter)}</td>
                  {cols.map((d) => {
                    const a = cellAfter(o, d.date);
                    const b = cellBefore(o, d.date);
                    return (
                      <td key={d.date} className="text-right px-2 tabular-nums align-top">
                        {a > 0 && <div className="font-semibold text-gray-900">{fmtQty(a)}</div>}
                        {b !== a && b > 0 && <div className="text-[10px] text-gray-400 line-through">{fmtQty(b)}</div>}
                      </td>
                    );
                  })}
                  {spill.length > 0 && (
                    <td className="text-right px-2 tabular-nums text-amber-800">{spillOf(o) > 0 ? fmtQty(spillOf(o)) : ""}</td>
                  )}
                  <td className={`px-2 whitespace-nowrap ${o.lateVsCommitment ? "text-rose-700" : "text-gray-600"}`}>
                    {o.end ? o.end.slice(5).split("-").reverse().join("/") : "—"}
                    {o.lateVsCommitment && <span title={`Entrega ${o.commitmentDate}`}> ⚠</span>}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-medium">
                <td /><td className="px-2 py-1 text-gray-600">Carga del día</td><td />
                {cols.map((d) => (
                  <td key={d.date} className="text-right px-2 tabular-nums">
                    <div className={utilClass(d.after, d.capacity)}>{fmtQty(d.after)}</div>
                    {d.before !== d.after && <div className={`text-[10px] line-through ${d.overBefore ? "text-rose-400" : "text-gray-400"}`}>{fmtQty(d.before)}</div>}
                  </td>
                ))}
                {spill.length > 0 && <td className="text-right px-2 tabular-nums text-amber-800">{fmtQty(spillAfter)}</td>}<td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}