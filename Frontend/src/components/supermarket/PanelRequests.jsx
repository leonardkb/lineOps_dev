// components/supermarket/PanelRequests.jsx
//
// Solicitudes de paneles del lado del supermercado.
//
//   usePanelRequests()   lista viva de solicitudes abiertas (se refresca sola)
//   panelKey()           llave línea|orden|color para cruzar con el tablero
//   PanelRequestCard     una solicitud: solicitado / enviado / saldo, envíos
//                        anteriores y el formulario para registrar un envío
//   PanelRequestsStrip   franja arriba del tablero con todo lo pendiente,
//                        incluso solicitudes de semanas que no están publicadas

import { useState, useEffect, useCallback, useRef } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Send, Loader2, CheckCircle2, Clock, PackageOpen } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export const panelKey = (line, workOrderId, color) => `${String(line)}|${String(workOrderId)}|${String(color || "")}`;

// ¿Esta solicitud es de esta orden en esta línea? Tolerante a cómo venga el
// dato en el snapshot publicado: línea "2" / "L2", color con espacios o en
// minúsculas, y la orden por id o, si el snapshot no trae id, por número de OT.
const normLine = (v) => String(v ?? "").trim().replace(/^l/i, "");
const normColor = (v) => String(v ?? "").trim().toUpperCase();
export const requestMatches = (r, lineNo, a, aWoNo = null) =>
  normLine(r.line_no) === normLine(lineNo) &&
  normColor(r.color) === normColor(a.color) &&
  ((a.work_order_id != null && String(a.work_order_id) === String(r.work_order_id)) ||
    (!!r.work_order_no && (String(a.work_order_no || "") === r.work_order_no || String(aWoNo || "") === r.work_order_no)));

const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const dShort = (ymd) => format(new Date(`${ymd}T00:00:00`), "EEE d MMM", { locale: es });
const tShort = (iso) => format(new Date(iso), "d MMM HH:mm", { locale: es });

export const STATUS = {
  requested: { label: "Solicitado", cls: "bg-red-50 text-red-700 border-red-200" },
  partial: { label: "Envío parcial", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  sent: { label: "Enviado · por recibir", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  received: { label: "Recibido", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelado", cls: "bg-gray-50 text-gray-500 border-gray-200" },
};

// Necesita acción del supermercado = falta enviar algo.
export const needsSending = (r) => r.status === "requested" || r.status === "partial";

export function usePanelRequests({ pollMs = 30000 } = {}) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/panel-requests?scope=open`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Error ${res.status}`);
      if (alive.current) { setRequests(json.requests || []); setError(null); }
    } catch (e) {
      if (alive.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    const t = setInterval(reload, pollMs);
    // Al volver a la pestaña, refrescar de inmediato.
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [reload, pollMs]);

  return { requests, error, reload };
}

export function PanelRequestCard({ request: r, onChanged }) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // El campo arranca con el saldo: el caso normal es surtir todo lo que falta.
  useEffect(() => { setQty(r.balance_qty > 0 ? String(Math.round(r.balance_qty)) : ""); setMsg(null); }, [r.id, r.balance_qty]);

  const send = async () => {
    const q = Number(qty);
    if (!(q > 0)) { setMsg({ err: true, text: "Escriba cuántos paneles salen" }); return; }
    if (q > r.balance_qty) { setMsg({ err: true, text: `Sólo faltan ${n0(r.balance_qty)}` }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/panel-requests/${r.id}/shipments`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ qty: q, note: note.trim() || null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Error ${res.status}`);
      setNote("");
      setMsg({ err: false, text: `Enviados ${n0(q)}. ${json.request.balance_qty > 0 ? `Faltan ${n0(json.request.balance_qty)}.` : "Solicitud cubierta."}` });
      onChanged?.(json.request);
    } catch (e) {
      setMsg({ err: true, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const pct = r.requested_qty > 0 ? Math.min(100, (r.sent_qty / r.requested_qty) * 100) : 0;
  const st = STATUS[r.status] || STATUS.requested;

  return (
    <div className={`rounded-xl border ${needsSending(r) ? "border-red-300" : "border-gray-200"} bg-white p-3`}>
      <div className="flex items-center gap-2 flex-wrap">
        {needsSending(r) && <span className="relative flex w-2.5 h-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" /><span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500" /></span>}
        <span className="text-sm font-semibold text-gray-900">Solicitud de paneles</span>
        <span className={`text-[11px] font-medium rounded-full border px-2 py-0.5 ${st.cls}`}>{st.label}</span>
        <span className="ml-auto text-xs text-gray-500 capitalize">para {dShort(r.request_date)}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Pidió {r.requested_by_name || "la línea"} · {tShort(r.created_at)}{r.note ? ` · “${r.note}”` : ""}
      </p>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 py-1.5">
          <dd className="text-lg font-bold tabular-nums text-gray-900 leading-none">{n0(r.requested_qty)}</dd>
          <dt className="text-[11px] text-gray-500 mt-1">Solicitado</dt>
        </div>
        <div className="rounded-lg bg-gray-50 py-1.5">
          <dd className="text-lg font-bold tabular-nums text-gray-900 leading-none">{n0(r.sent_qty)}</dd>
          <dt className="text-[11px] text-gray-500 mt-1">Enviado</dt>
        </div>
        <div className={`rounded-lg py-1.5 ${r.balance_qty > 0 ? "bg-red-50" : "bg-emerald-50"}`}>
          <dd className={`text-lg font-bold tabular-nums leading-none ${r.balance_qty > 0 ? "text-red-700" : "text-emerald-700"}`}>{n0(r.balance_qty)}</dd>
          <dt className="text-[11px] text-gray-500 mt-1">Saldo por enviar</dt>
        </div>
      </dl>
      <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {r.shipments?.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {r.shipments.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-xs text-gray-600">
              {s.received_at
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                : <Clock className="w-3.5 h-3.5 text-sky-600 shrink-0" />}
              <span className="tabular-nums font-semibold text-gray-900">{n0(s.qty)}</span>
              <span>enviados {tShort(s.sent_at)}</span>
              <span className={`ml-auto ${s.received_at ? "text-emerald-700" : "text-sky-700"}`}>
                {s.received_at ? `recibido ${tShort(s.received_at)}` : "en camino"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {r.balance_qty > 0 && (
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1 min-w-0">
            <span className="block text-[11px] text-gray-500 mb-1">Paneles que salen ahora</span>
            <input
              type="number" min="1" step="1" inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </label>
          <input
            value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button
            onClick={send} disabled={busy}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar
          </button>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.err ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p>}
    </div>
  );
}

// Franja arriba del tablero: todo lo que falta surtir, de un vistazo. Cubre
// también solicitudes para días que el supermercado no tiene publicados.
export function PanelRequestsStrip({ requests, onOpen }) {
  const pending = requests.filter(needsSending);
  const inTransit = requests.filter((r) => r.status === "sent");
  if (!pending.length && !inTransit.length) return null;
  return (
    <div className={`rounded-xl border shadow-sm bg-white ${pending.length ? "border-red-300" : ""}`}>
      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap border-b">
        <PackageOpen className={`w-4 h-4 ${pending.length ? "text-red-600" : "text-gray-400"}`} />
        <span className="text-sm font-semibold text-gray-900">Solicitudes de paneles</span>
        {pending.length > 0 && <span className="text-xs font-semibold rounded-full bg-red-600 text-white px-2 py-0.5">{pending.length} por surtir</span>}
        {inTransit.length > 0 && <span className="text-xs text-sky-700">{inTransit.length} en camino a la línea</span>}
      </div>
      {pending.length > 0 && (
        <ul className="px-2 py-2 flex gap-2 overflow-x-auto">
          {pending.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onOpen(r)}
                className="w-56 text-left rounded-lg border border-red-200 bg-red-50/40 hover:bg-red-50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="relative flex w-2 h-2"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" /><span className="relative inline-flex w-2 h-2 rounded-full bg-red-500" /></span>
                  <span className="text-sm font-bold text-gray-900">L{r.line_no}</span>
                  <span className="font-mono text-xs font-bold text-gray-900 truncate">{String(r.work_order_no || "").split("-")[0]}</span>
                  {r.color && <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-800">{r.color}</span>}
                </div>
                <div className="mt-1 flex items-baseline gap-1 text-xs text-gray-600">
                  <span className="capitalize">{dShort(r.request_date)}</span>
                  <span className="ml-auto font-semibold tabular-nums text-red-700">{n0(r.balance_qty)}</span>
                  <span>por enviar</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}