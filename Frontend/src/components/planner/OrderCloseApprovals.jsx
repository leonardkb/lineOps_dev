// components/planner/OrderCloseApprovals.jsx
//
// Vista del CEO para el cierre manual de órdenes (order-close.js):
//   • Solicitudes  — el planeador quiso completar una orden con lo producido
//                    por debajo del umbral. El CEO aprueba (la orden se
//                    completa) o rechaza (con nota que ve el planeador).
//   • Alertas      — el planeador completó una orden que sí cumplía el umbral.
//                    Solo informativas: el CEO las marca como vistas.
//
// Props:
//   onChange()  se llama después de aprobar / rechazar / marcar, para que la
//               pestaña refresque su contador.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, XCircle, Bell, ShieldAlert, Loader2, RefreshCw, Eye, Inbox, History,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

async function api(method, path, body) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, data };
  } catch (err) {
    return { ok: false, data: { error: err.message || "Sin conexión" } };
  }
}

const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-MX");
const fmtPct = (v) => (v == null ? "—" : `${Math.round(Number(v) * 10) / 10}%`);
const fmtWhen = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? "—" : d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const STATUS_CHIP = {
  pending:   { label: "Pendiente", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  approved:  { label: "Aprobada",  cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  rejected:  { label: "Rechazada", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  cancelled: { label: "Retirada",  cls: "bg-gray-100 text-gray-500 ring-gray-500/20" },
  closed:    { label: "Cerrada por planeación", cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
};

function Meter({ pct, threshold }) {
  const ok = pct != null && Number(pct) >= Number(threshold);
  return (
    <div className="relative h-2 w-full rounded-full bg-gray-100">
      <div
        className={`h-full rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`}
        style={{ width: `${Math.max(0, Math.min(Number(pct) || 0, 100))}%` }}
      />
      <span
        className="absolute -top-1 w-0.5 rounded bg-gray-700"
        style={{ left: `${Math.min(Number(threshold) || 0, 100)}%`, height: 16 }}
        title={`Mínimo ${threshold}%`}
      />
    </div>
  );
}

function OrderHead({ it }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold text-gray-900">{it.work_order_no}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_CHIP[it.status]?.cls || ""}`}>
          {STATUS_CHIP[it.status]?.label || it.status}
        </span>
      </div>
      <div className="truncate text-xs text-gray-500">
        {[it.customer_name, it.customer_po && `PO ${it.customer_po}`, it.style_code].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

function Numbers({ it }) {
  return (
    <div className="w-full sm:w-56">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-gray-500 tabular-nums">{fmtN(it.produced_qty)} / {fmtN(it.assigned_qty)} asignadas</span>
        <span className="font-semibold text-gray-800 tabular-nums">{fmtPct(it.pct)}</span>
      </div>
      <Meter pct={it.pct} threshold={it.threshold_pct} />
      <div className="mt-1 text-[11px] text-gray-400">Mínimo {Number(it.threshold_pct)}% · total orden {fmtN(it.total_qty)}</div>
    </div>
  );
}

function RequestCard({ it, onDecide, busy }) {
  const [note, setNote] = useState("");
  const pending = it.status === "pending";
  return (
    <li className={`rounded-xl border bg-white p-4 ${pending ? "border-amber-200" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <OrderHead it={it} />
        <Numbers it={it} />
      </div>
      <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <span className="text-gray-500">{it.requested_by_name || "Planeación"} · {fmtWhen(it.requested_at)}:</span>{" "}
        {it.reason || <i className="text-gray-400">sin motivo</i>}
      </div>

      {pending ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nota para planeación (opcional; recomendada al rechazar)"
            maxLength={500}
            className="h-9 min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(it, "reject", note)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" /> Rechazar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(it, "approve", note)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> Aprobar y completar
          </button>
        </div>
      ) : (
        <div className="mt-2 text-xs text-gray-500">
          {STATUS_CHIP[it.status]?.label} {it.decided_by_name && `por ${it.decided_by_name}`} · {fmtWhen(it.decided_at)}
          {it.decision_note && <> — “{it.decision_note}”</>}
        </div>
      )}
    </li>
  );
}

function AlertCard({ it, onAck, busy }) {
  const unread = !it.acknowledged_at;
  return (
    <li className={`rounded-xl border bg-white p-4 ${unread ? "border-sky-200" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Bell className={`mt-0.5 h-5 w-5 shrink-0 ${unread ? "text-sky-600" : "text-gray-300"}`} />
          <div className="min-w-0">
            <OrderHead it={it} />
            <p className="mt-1 text-sm text-gray-700">
              <b>{it.requested_by_name || "Planeación"}</b> completó la orden con {fmtPct(it.pct)} producido
              · {fmtWhen(it.requested_at)}
            </p>
            {it.reason && <p className="mt-1 text-xs text-gray-500">Nota: “{it.reason}”</p>}
          </div>
        </div>
        <Numbers it={it} />
      </div>
      <div className="mt-3 flex justify-end">
        {unread ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAck(it)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" /> Enterado
          </button>
        ) : (
          <span className="text-xs text-gray-400">Vista {it.acknowledged_by_name && `por ${it.acknowledged_by_name}`} · {fmtWhen(it.acknowledged_at)}</span>
        )}
      </div>
    </li>
  );
}

export default function OrderCloseApprovals({ onChange }) {
  const [view, setView] = useState("inbox"); // inbox | history
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const r = await api("GET", "/api/work-order-close-requests?limit=300");
    if (r.ok) setItems(r.data.items || []);
    else setError(r.data?.error || "No se pudieron cargar las solicitudes.");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const { requests, alerts, history } = useMemo(() => {
    const requests = items.filter((i) => i.kind === "request" && i.status === "pending");
    const alerts = items.filter((i) => i.kind === "alert" && !i.acknowledged_at);
    const history = items.filter((i) => !(i.kind === "request" && i.status === "pending") && !(i.kind === "alert" && !i.acknowledged_at));
    return { requests, alerts, history };
  }, [items]);

  const after = async (r, okMsg) => {
    setBusyId(null);
    if (!r.ok) { setError(r.data?.error || "No se pudo guardar."); return; }
    setFlash(r.data?.message || okMsg);
    await load();
    onChange?.();
  };

  const decide = async (it, action, note) => {
    setBusyId(it.id);
    setError("");
    const r = await api("POST", `/api/work-order-close-requests/${it.id}/${action}`, { note });
    after(r, action === "approve" ? "Orden completada." : "Solicitud rechazada.");
  };

  const ack = async (it) => {
    setBusyId(it.id);
    const r = await api("POST", `/api/work-order-close-requests/${it.id}/ack`);
    after(r, "Alerta marcada como vista.");
  };

  const ackAll = async () => {
    setBusyId("all");
    const r = await api("POST", "/api/work-order-close-requests/ack-all");
    after(r, "Todas las alertas marcadas como vistas.");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          {[
            { v: "inbox", label: `Por atender (${requests.length + alerts.length})`, Icon: Inbox },
            { v: "history", label: "Historial", Icon: History },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setView(o.v)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                view === o.v ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              <o.Icon className="h-4 w-4" /> {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {flash && <div className="mb-3 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">{flash}</div>}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando…
        </div>
      ) : view === "inbox" ? (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Solicitudes de cierre ({requests.length})
            </h2>
            {requests.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                Ninguna orden espera permiso para cerrarse.
              </p>
            ) : (
              <ul className="space-y-3">
                {requests.map((it) => (
                  <RequestCard key={it.id} it={it} onDecide={decide} busy={busyId === it.id} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <Bell className="h-4 w-4 text-sky-600" />
                Órdenes cerradas por planeación ({alerts.length})
              </h2>
              {alerts.length > 1 && (
                <button
                  type="button"
                  onClick={ackAll}
                  disabled={busyId === "all"}
                  className="ml-auto text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
                >
                  Marcar todas como vistas
                </button>
              )}
            </div>
            {alerts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                Sin alertas nuevas.
              </p>
            ) : (
              <ul className="space-y-3">
                {alerts.map((it) => (
                  <AlertCard key={it.id} it={it} onAck={ack} busy={busyId === it.id} />
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : history.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          Aún no hay historial de cierres.
        </p>
      ) : (
        <ul className="space-y-3">
          {history.map((it) =>
            it.kind === "alert"
              ? <AlertCard key={it.id} it={it} onAck={ack} busy={busyId === it.id} />
              : <RequestCard key={it.id} it={it} onDecide={decide} busy={busyId === it.id} />
          )}
        </ul>
      )}
    </div>
  );
}