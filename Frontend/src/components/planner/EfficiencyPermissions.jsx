// components/planner/EfficiencyPermissions.jsx
//
// CEO view of the efficiency-change queue, shown inside Analíticas de Planeación
// under the "Permisos de eficiencia" tab. The CEO approves or rejects each
// planner request. APPROVE writes the new efficiency to every run of the style
// and recomputes its plan-board capacity; REJECT leaves everything untouched.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, ShieldCheck, Clock, CheckCircle2, XCircle, TrendingUp, TrendingDown,
  Check, X, RefreshCw,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const pct = (frac) => (frac == null ? "—" : `${Math.round(frac * 1000) / 10}%`);
const fmtDateTime = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d)
    ? "—"
    : d.toLocaleString("es-MX", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const STATUS = {
  pending:  { label: "Pendiente", chip: "bg-amber-50 text-amber-700 ring-amber-600/20",       Icon: Clock },
  approved: { label: "Aprobada",  chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  rejected: { label: "Rechazada", chip: "bg-rose-50 text-rose-700 ring-rose-600/20",           Icon: XCircle },
};

export default function EfficiencyPermissions() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [filter, setFilter] = useState("pending"); // pending | approved | rejected | all
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [notes, setNotes] = useState({}); // id -> decision note

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetch(`${API_URL}/api/efficiency-change-requests?status=all`, { headers: authHeaders() });
      const data = await res.json();
      setRequests(data?.success ? data.requests || [] : []);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: requests.length };
    for (const r of requests) if (c[r.status] != null) c[r.status]++;
    return c;
  }, [requests]);

  const visible = useMemo(
    () => (filter === "all" ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter]
  );

  const decide = async (req, decision) => {
    setBusyId(req.id);
    try {
      const res = await fetch(`${API_URL}/api/efficiency-change-requests/${req.id}/decision`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ decision, note: (notes[req.id] || "").trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setToast({ err: true, msg: data.error || "No se pudo procesar la decisión." });
      } else {
        setToast({ err: false, msg: data.message });
        setNotes((n) => { const c = { ...n }; delete c[req.id]; return c; });
      }
      await load();
      window.dispatchEvent(new Event("efficiency-permissions-updated"));
    } catch {
      setToast({ err: true, msg: "Error de red. Intenta de nuevo." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4">
      {/* Header row */}
      <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600">
            <ShieldCheck className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Permisos de eficiencia</h2>
            <p className="text-[11px] text-gray-500">
              Aprueba o rechaza los cambios de eficiencia solicitados por planeación. Aprobar recalcula la
              capacidad del estilo en el Plan Board.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {/* Filter segmented */}
      <div className="shrink-0 inline-flex p-0.5 rounded-lg bg-gray-100 border border-gray-200 mb-3 self-start">
        {[
          { v: "pending", label: `Pendientes${counts.pending ? ` (${counts.pending})` : ""}` },
          { v: "approved", label: "Aprobadas" },
          { v: "rejected", label: "Rechazadas" },
          { v: "all", label: "Todas" },
        ].map((o) => (
          <button
            key={o.v}
            onClick={() => setFilter(o.v)}
            className={`px-3 py-1 text-sm rounded-md transition whitespace-nowrap ${
              filter === o.v ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando solicitudes…
          </div>
        ) : errored ? (
          <div className="py-16 text-center text-sm text-gray-500">
            No se pudieron cargar las solicitudes. Revisa tu conexión.
          </div>
        ) : visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            {filter === "pending" ? "No hay solicitudes pendientes." : "No hay solicitudes con este filtro."}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((r) => {
              const st = STATUS[r.status] || STATUS.pending;
              const up = r.current_efficiency != null && r.requested_efficiency > r.current_efficiency;
              const isPending = r.status === "pending";
              const busy = busyId === r.id;
              return (
                <div key={r.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{r.style}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${st.chip}`}>
                          <st.Icon className="w-3.5 h-3.5" />{st.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 truncate max-w-[420px]">{r.style_description || "—"}</div>
                    </div>

                    {/* before → after */}
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="text-gray-500">{pct(r.current_efficiency)}</span>
                      <span className="text-gray-300">→</span>
                      <span className={`text-lg font-bold ${up ? "text-emerald-600" : "text-rose-600"}`}>{pct(r.requested_efficiency)}</span>
                      {up ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-rose-500" />}
                    </div>
                  </div>

                  {/* meta */}
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-gray-600">
                    <div><span className="text-gray-400">Solicitó:</span> {r.requested_by_name || "—"}</div>
                    <div><span className="text-gray-400">Fecha:</span> {fmtDateTime(r.requested_at)}</div>
                    <div className="sm:col-span-2">
                      <span className="text-gray-400">Motivo:</span> {r.reason || <span className="text-gray-300">sin motivo</span>}
                    </div>
                    {!isPending && (
                      <>
                        <div><span className="text-gray-400">Decidió:</span> {r.decided_by_name || "—"}</div>
                        <div><span className="text-gray-400">Fecha decisión:</span> {fmtDateTime(r.decided_at)}</div>
                        {r.status === "approved" && r.applied_runs != null && (
                          <div className="sm:col-span-2 text-emerald-700">
                            Aplicada a {r.applied_runs} corrida(s) del estilo.
                          </div>
                        )}
                        {r.decision_note && (
                          <div className="sm:col-span-2"><span className="text-gray-400">Nota:</span> {r.decision_note}</div>
                        )}
                      </>
                    )}
                  </div>

                  {/* actions (pending only) */}
                  {isPending && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                      <input
                        value={notes[r.id] || ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                        placeholder="Nota (opcional)…"
                        className="flex-1 min-w-[160px] text-sm rounded-lg border border-gray-300 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                      <button
                        onClick={() => decide(r, "rejected")}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Rechazar
                      </button>
                      <button
                        onClick={() => decide(r, "approved")}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aprobar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw] ${toast.err ? "bg-rose-600 text-white" : "bg-gray-900 text-white"}`}>
          {toast.err ? <XCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          <span className="truncate">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}