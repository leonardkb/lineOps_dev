// components/planner/StyleEfficiencyApprovals.jsx
//
// CEO panel: efficiency changes the planner requested for a style's planning
// standard. A request is for the style's GENERAL standard (every line without
// its own) or for ONE line's own standard (line_no). The planner can change SAM,
// operators and working hours on their own; a new EFFICIENCY only applies when
// approved here. Approving re-plans that scope's cells from tomorrow on: the one
// line, or the lines that follow the general standard.
//
// Mounted in PlannerAnalytics → "Permisos de eficiencia".
import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Eye, Clock, RefreshCw, ShieldCheck } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const pct = (v) => (v == null ? "—" : `${Math.round(Number(v) * 1000) / 10}%`);
const pcsDay = (r, eff) => {
  const sam = Number(r.sam_minutes) || 0;
  if (!(sam > 0) || eff == null) return null;
  return ((Number(r.operators_count) || 0) * (Number(r.working_hours) || 0) * 60 * Number(eff)) / sam;
};
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : "—");
const scopeLabel = (r) => (r.line_no ? `Línea ${r.line_no}` : "General · todas las líneas");
const fmtDate = (s) => (s ? new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

const STATUS = {
  approved:   { label: "Aprobada",   cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  rejected:   { label: "Rechazada",  cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  cancelled:  { label: "Retirada",   cls: "bg-gray-100 text-gray-600 ring-gray-500/20" },
  superseded: { label: "Reemplazada", cls: "bg-gray-100 text-gray-600 ring-gray-500/20" },
  pending:    { label: "Pendiente",  cls: "bg-violet-50 text-violet-700 ring-violet-600/20" },
};

// Impact of approving + which lines to re-plan (checkboxes, all ticked by default).
function ImpactSummary({ impact, selected, onToggle, canPick }) {
  if (!impact) return null;
  if (impact.error) return <p className="text-[12px] text-rose-600">{impact.error}</p>;
  const r = impact.recompute;
  const lostByLine = {};
  for (const u of r?.unplaced || []) lostByLine[String(u.line_no)] = (lostByLine[String(u.line_no)] || 0) + (Number(u.qty) || 0);
  return (
    <div className="rounded-lg bg-gray-50 p-2.5 text-[12px] text-gray-700 space-y-2">
      <div>Capacidad: <b>{fmt(impact.before)}</b> → <b>{fmt(impact.after)}</b> pzas/día</div>
      {r?.cellsBefore > 0 ? (
        <div>
          <div className="mb-1">
            {canPick ? "Líneas a re-planear desde mañana (las no marcadas conservan sus celdas):" : "Re-planeación desde mañana:"}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {(r.lines || []).map((l) => {
              const ln = String(l.line_no);
              const on = !canPick || selected?.has(ln);
              const lost = lostByLine[ln] || 0;
              return (
                <li key={ln}>
                  <label className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${canPick ? "cursor-pointer" : ""} ${on ? "border-gray-300 bg-white" : "border-dashed border-gray-300 bg-gray-50 text-gray-400"}`}>
                    {canPick && <input type="checkbox" checked={on} onChange={() => onToggle(ln)} className="rounded border-gray-300" />}
                    <b>L{ln}</b> {l.daysBefore} → {l.daysAfter} día(s)
                    {l.lockedCells > 0 && <span className="text-gray-500">· 🔒 {l.lockedCells} fija(s)</span>}
                    {lost > 0 && <span className="text-rose-600">· {fmt(lost)} pzas no caben</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="text-gray-500">No hay celdas futuras de este estilo en el tablero.</div>
      )}
      {r?.lockedCells > 0 && (
        <div className="text-gray-500">
          🔒 {r.lockedCells} celda(s) en semanas bloqueadas se quedan como están.
        </div>
      )}
      {r?.excludedLines?.length > 0 && (
        <div className="text-gray-500">
          No {r.excludedLines.length > 1 ? "cambian" : "cambia"} {r.excludedLines.map((l) => `L${l}`).join(", ")}:{" "}
          {r.excludedLines.length > 1 ? "tienen" : "tiene"} estándar propio.
        </div>
      )}
    </div>
  );
}

export default function StyleEfficiencyApprovals() {
  const [rows, setRows] = useState([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});   // id → decision note
  const [impact, setImpact] = useState({}); // id → preview result
  const [lineSel, setLineSel] = useState({}); // id → Set(line_no) to re-plan on approval
  const toggleLine = (id, ln) => setLineSel((m) => {
    const n = new Set(m[id] || []);
    n.has(ln) ? n.delete(ln) : n.add(ln);
    return { ...m, [id]: n };
  });
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState("pending"); // pending | approved | rejected | all

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/planner/style-eff-requests?status=all`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudieron cargar las solicitudes");
      setRows(data.requests || []);
      setCanApprove(!!data.canApprove);
      window.dispatchEvent(new Event("efficiency-permissions-updated")); // keep the nav badge in sync
    } catch (err) {
      setMsg({ error: true, text: err.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const preview = async (r) => {
    setBusyId(r.id);
    try {
      const res = await fetch(`${API_URL}/api/planner/style-eff-requests/${r.id}/preview`, { headers: authHeaders() });
      const data = await res.json();
      setImpact((m) => ({ ...m, [r.id]: data.success ? data : { error: data.error || "No se pudo calcular el impacto" } }));
      if (data.success) {
        setLineSel((m) => ({ ...m, [r.id]: new Set((data.recompute?.lines || []).map((l) => String(l.line_no))) }));
      }
    } catch (err) {
      setImpact((m) => ({ ...m, [r.id]: { error: err.message } }));
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (r, action) => {
    const verb = action === "approve" ? "Aprobar" : "Rechazar";
    // Lines picked after "Ver impacto"; without a preview every line is re-planned.
    const picked = impact[r.id]?.recompute?.cellsBefore > 0 && lineSel[r.id] ? [...lineSel[r.id]] : null;
    const where = r.line_no ? ` en la Línea ${r.line_no}` : " (estándar general)";
    const extra = action !== "approve" ? ""
      : r.line_no && picked == null ? `\n\nSolo cambia la Línea ${r.line_no}; se re-planean sus celdas a partir de mañana.`
      : picked == null ? "\n\nSe re-planearán las celdas de este estilo a partir de mañana en las líneas sin estándar propio."
      : picked.length === 0 ? "\n\nNo se re-planea ninguna línea: las celdas actuales se conservan."
      : `\n\nSe re-planearán a partir de mañana solo las líneas: ${picked.map((l) => `L${l}`).join(", ")}.`;
    if (!window.confirm(`${verb} eficiencia ${pct(r.requested_efficiency)} para ${r.style_code}${where}?${extra}`)) return;
    setBusyId(r.id);
    setMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/planner/style-eff-requests/${r.id}/${action}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(action === "approve" && picked != null ? { note: notes[r.id] || null, lines: picked } : { note: notes[r.id] || null }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || `No se pudo ${verb.toLowerCase()}`);
      const who = `${r.style_code}${r.line_no ? ` · L${r.line_no}` : ""}`;
      let text = action === "approve" ? `${who}: eficiencia ${pct(r.requested_efficiency)} aprobada.` : `${who}: solicitud rechazada.`;
      if (data.recompute?.reason === "locked") text += " No se re-planeó porque toca una semana bloqueada.";
      setMsg({ error: false, text });
      // NavCeo listens for this to refresh the "Plan Analytics" badge now.
      window.dispatchEvent(new Event("efficiency-permissions-updated"));
      await load();
    } catch (err) {
      setMsg({ error: true, text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const counts = {
    pending: rows.filter((r) => r.status === "pending").length,
    approved: rows.filter((r) => r.status === "approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    all: rows.length,
  };
  const shown = tab === "all" ? rows : rows.filter((r) => r.status === tab);

  return (
    <section className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6">
      {/* Header — same look as the "Permisos de eficiencia" panel below */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Eficiencia por estilo · Plan Board</h2>
            <p className="text-xs text-gray-500">
              El planner cambia SAM, operarios y horas directamente; la eficiencia solo cambia con aprobación del CEO.
              Cada solicitud es para el estándar general del estilo o para una sola línea; al aprobar se re-planean
              a partir de mañana solo las celdas de ese alcance.
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      <div className="inline-flex rounded-lg bg-gray-100 p-1 mb-4" role="tablist">
        {[["pending", "Pendientes"], ["approved", "Aprobadas"], ["rejected", "Rechazadas"], ["all", "Todas"]].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${tab === k ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
          >
            {label}
            {counts[k] > 0 && <span className={`ml-1.5 text-[11px] ${k === "pending" ? "text-violet-600 font-semibold" : "text-gray-400"}`}>{counts[k]}</span>}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{msg.text}</div>
      )}
      {!loading && !canApprove && counts.pending > 0 && (
        <p className="mb-3 text-[12px] text-gray-500">Solo lectura: aprobar o rechazar corresponde al CEO.</p>
      )}

      {loading ? (
        <div className="py-10 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500">
          {tab === "pending" ? "No hay solicitudes pendientes." : "No hay solicitudes en esta vista."}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const curEff = r.status === "pending" ? (r.standard_efficiency ?? r.current_efficiency) : r.current_efficiency;
            const before = pcsDay(r, curEff);
            const after = pcsDay(r, r.requested_efficiency);
            const up = Number(r.requested_efficiency) > Number(curEff);
            const busy = busyId === r.id;
            const st = STATUS[r.status] || STATUS.cancelled;
            return (
              <article key={r.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-gray-900">{r.style_code}</span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${r.line_no ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-600"}`}
                        title={r.line_no ? "Solo cambia esta línea" : "Aplica a las líneas sin estándar propio"}
                      >
                        {scopeLabel(r)}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-gray-500 inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Solicitó {r.requested_by || "planner"} · {fmtDate(r.requested_at)}
                    </div>
                    <div className="mt-1 text-[12px] text-gray-600">
                      SAM {Number(r.sam_minutes) || "—"} min · {Number(r.operators_count) || "—"} operarios · {Number(r.working_hours) || "—"} h
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-gray-900">
                      {pct(curEff)} <span className="text-gray-400">→</span>{" "}
                      <span className={up ? "text-emerald-700" : "text-rose-700"}>{pct(r.requested_efficiency)}</span>
                    </div>
                    <div className="text-[12px] text-gray-500 tabular-nums">{fmt(before)} → {fmt(after)} pzas/día</div>
                  </div>
                </div>

                {r.reason && (
                  <p className="mt-3 text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-400 mr-2">Motivo</span>{r.reason}
                  </p>
                )}
                {r.status !== "pending" && (r.decided_by || r.decision_note) && (
                  <p className="mt-2 text-[12px] text-gray-500">
                    {st.label} por {r.decided_by || "—"} · {fmtDate(r.decided_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}
                  </p>
                )}

                {r.status === "pending" && (
                  <div className="mt-3 space-y-3">
                    <ImpactSummary
                      impact={impact[r.id]}
                      canPick={canApprove}
                      selected={lineSel[r.id]}
                      onToggle={(ln) => toggleLine(r.id, ln)}
                    />
                    {canApprove && (
                      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <input
                          value={notes[r.id] || ""}
                          onChange={(e) => setNotes((m) => ({ ...m, [r.id]: e.target.value }))}
                          placeholder="Nota para el planner (opcional)"
                          className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => preview(r)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50">
                            <Eye className="w-4 h-4" /> Ver impacto
                          </button>
                          <button onClick={() => decide(r, "reject")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                            <XCircle className="w-4 h-4" /> Rechazar
                          </button>
                          <button onClick={() => decide(r, "approve")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50">
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Aprobar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}