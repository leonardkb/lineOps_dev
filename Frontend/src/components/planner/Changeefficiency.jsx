// components/planner/ChangeEfficiency.jsx
//
// "Cambiar Eficiencia" — lists every style currently in production with its
// plan-board efficiency and lets the planner REQUEST a change. Nothing changes
// on submit: the request is queued for the CEO in Analíticas de Planeación →
// "Permisos de eficiencia". Only after the CEO approves does the efficiency (and
// therefore the day's capacity in the Plan Board) actually change for that style.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, Search, Gauge, Send, X, Clock, CheckCircle2, XCircle,
  AlertTriangle, TrendingUp, TrendingDown, ShieldCheck,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const pct = (frac) => (frac == null ? "—" : `${Math.round(frac * 1000) / 10}%`);
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? "—" : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
};

const STATUS = {
  pending:  { label: "Pendiente", chip: "bg-amber-50 text-amber-700 ring-amber-600/20",   Icon: Clock },
  approved: { label: "Aprobada",  chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  rejected: { label: "Rechazada", chip: "bg-rose-50 text-rose-700 ring-rose-600/20",       Icon: XCircle },
};

export default function ChangeEfficiency() {
  const [styles, setStyles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // { style, currentEfficiency, ... }
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      const [sRes, rRes] = await Promise.all([
        fetch(`${API_URL}/api/style-efficiencies`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/efficiency-change-requests?status=all`, { headers: authHeaders() }).catch(() => null),
      ]);
      const s = await sRes.json();
      const r = rRes && rRes.ok ? await rRes.json().catch(() => null) : null;
      setStyles(s?.success ? s.styles || [] : []);
      setRequests(r?.success ? r.requests || [] : []);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return styles;
    return styles.filter(
      (s) =>
        String(s.style || "").toUpperCase().includes(q) ||
        String(s.description || "").toUpperCase().includes(q)
    );
  }, [styles, search]);

  const recentRequests = useMemo(() => requests.slice(0, 8), [requests]);

  return (
    <div className="space-y-6">
      {/* Intro card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
            <Gauge className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cambiar Eficiencia</h2>
            <p className="text-sm text-gray-600">
              Ajusta la eficiencia de un estilo para el <b>Plan Board</b>. Al enviar, la solicitud
              queda <b>pendiente de aprobación del CEO</b>; la capacidad del día solo cambia una vez
              que el CEO la aprueba. No cambia la SAM del merchant ni las metas de producción de las corridas.
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar estilo o descripción…"
            className="pl-8 pr-3 py-2 w-full text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <span className="text-xs text-gray-400">{visible.length} estilo(s)</span>
      </div>

      {/* Styles table */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" /> Cargando eficiencias…
            </div>
          ) : errored ? (
            <div className="py-16 text-center text-sm text-gray-500">
              No se pudieron cargar los datos. Revisa tu conexión y vuelve a intentar.
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">
              No hay estilos con corridas en el tablero todavía.
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gray-50/95 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Estilo</th>
                  <th className="text-right px-3 py-2.5 font-medium">Eficiencia actual</th>
                  <th className="text-right px-3 py-2.5 font-medium">Corridas</th>
                  <th className="text-left px-3 py-2.5 font-medium">Estado</th>
                  <th className="text-right px-4 py-2.5 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((s) => {
                  const pend = s.pendingRequest;
                  return (
                    <tr key={s.styleKey} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 leading-tight">{s.style}</div>
                        <div className="text-[11px] text-gray-400 truncate max-w-[280px]">
                          {s.description || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <span className="tabular-nums font-semibold text-gray-900">{pct(s.currentEfficiency)}</span>
                          {s.source === "override" && (
                            <span
                              title={`Eficiencia aprobada${s.approvedByName ? ` por ${s.approvedByName}` : ""}${s.approvedAt ? ` el ${s.approvedAt}` : ""}`}
                              className="text-emerald-500"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {s.inconsistent && (
                            <span
                              title={`Las corridas de este estilo tienen eficiencias distintas (${pct(s.minEfficiency)}–${pct(s.maxEfficiency)}). Al aprobar un cambio se unificarán.`}
                              className="text-amber-500 cursor-help"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-500">{s.runCount || 0}</td>
                      <td className="px-3 py-3">
                        {pend ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 bg-amber-50 text-amber-700 ring-amber-600/20">
                            <Clock className="w-3.5 h-3.5" />
                            Pendiente CEO → {pct(pend.requestedEfficiency)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          disabled={!!pend}
                          onClick={() => setModal(s)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={pend ? "Ya hay una solicitud pendiente para este estilo" : "Solicitar cambio de eficiencia"}
                        >
                          <Gauge className="w-4 h-4" /> Modificar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent requests (status tracking for the planner) */}
      {recentRequests.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Solicitudes recientes</h3>
            <p className="text-[11px] text-gray-400">Estado de tus últimas solicitudes de eficiencia.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {recentRequests.map((r) => {
              const st = STATUS[r.status] || STATUS.pending;
              const up = r.current_efficiency != null && r.requested_efficiency > r.current_efficiency;
              return (
                <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 shrink-0 ${st.chip}`}>
                    <st.Icon className="w-3.5 h-3.5" />{st.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800 truncate">{r.style}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {r.reason || "Sin motivo indicado"}
                      {r.status !== "pending" && r.decided_by_name ? ` · ${r.status === "approved" ? "Aprobó" : "Rechazó"}: ${r.decided_by_name}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="inline-flex items-center gap-1 tabular-nums text-sm text-gray-700">
                      {pct(r.current_efficiency)} <span className="text-gray-300">→</span>{" "}
                      <b className={up ? "text-emerald-600" : "text-rose-600"}>{pct(r.requested_efficiency)}</b>
                      {up ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> : <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
                    </div>
                    <div className="text-[10px] text-gray-400">{fmtDate(r.requested_at)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {modal && (
        <RequestModal
          style={modal}
          onClose={() => setModal(null)}
          onSubmitted={(msg) => {
            setModal(null);
            setToast(msg);
            load();
            // Bump the CEO's "Plan Analytics" pending badge right away.
            window.dispatchEvent(new Event("efficiency-permissions-updated"));
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] text-sm px-4 py-2 rounded-full shadow-lg bg-gray-900 text-white flex items-center gap-2 max-w-[90vw]">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{toast}</span>
        </div>
      )}
    </div>
  );
}

function RequestModal({ style, onClose, onSubmitted }) {
  const currentPctVal = style.currentEfficiency != null ? Math.round(style.currentEfficiency * 1000) / 10 : "";
  const [effPct, setEffPct] = useState(String(currentPctVal));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const newFrac = (() => {
    const n = Number(effPct);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
    return n / 100;
  })();
  const delta =
    newFrac != null && style.currentEfficiency != null ? newFrac - style.currentEfficiency : null;
  const unchanged = newFrac != null && style.currentEfficiency != null && Math.abs(delta) < 0.0005;

  const submit = async () => {
    setError("");
    if (newFrac == null) {
      setError("Ingresa una eficiencia entre 1% y 100%.");
      return;
    }
    if (unchanged) {
      setError("La eficiencia es la misma que la actual.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/efficiency-change-requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          style: style.style,
          requestedEfficiency: newFrac,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "No se pudo enviar la solicitud.");
        setSaving(false);
        return;
      }
      onSubmitted(`✅ Solicitud enviada al CEO para ${style.style}.`);
    } catch {
      setError("Error de red. Intenta de nuevo.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Solicitar cambio de eficiencia</h3>
            <p className="text-sm text-gray-500">{style.style}{style.description ? ` · ${style.description}` : ""}</p>
          </div>
          <button onClick={onClose} disabled={saving} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-400">Eficiencia actual</div>
              <div className="text-lg font-bold text-gray-900 tabular-nums">{pct(style.currentEfficiency)}</div>
            </div>
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-indigo-400">Corridas del estilo</div>
              <div className="text-lg font-bold text-indigo-700 tabular-nums">{style.runCount || 0}</div>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Nueva eficiencia (%)</span>
            <input
              autoFocus
              type="number"
              min="1"
              max="100"
              step="1"
              value={effPct}
              onChange={(e) => setEffPct(e.target.value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>

          {delta != null && !unchanged && (
            <div className={`flex items-center gap-2 text-sm ${delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {delta > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {delta > 0
                ? "Sube la eficiencia → la capacidad diaria del estilo aumenta."
                : "Baja la eficiencia → la capacidad diaria del estilo disminuye."}
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Motivo (para el CEO)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Explica por qué se necesita el cambio (curva de aprendizaje, ausentismo, nueva línea, etc.)"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            />
          </label>

          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || newFrac == null || unchanged}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar al CEO
          </button>
        </div>
      </div>
    </div>
  );
}