// components/lineleader/PanelRequestsButton.jsx
//
// Botón "Paneles" del jefe de línea + su panel.
//
//   Pedir           las órdenes que la línea tiene planeadas (hoy y próximos
//                   días) con las piezas a producir; se pide esa cantidad de
//                   paneles (editable) con un toque.
//   Mis solicitudes lo pedido, lo que el supermercado ya envió y el saldo.
//                   Cada envío que llega se confirma con "Recibido".
//
// El globo del botón cuenta los envíos que están en camino y falta confirmar.
// Usa rutas relativas /api, igual que el resto de LineLeaderPage.

import { useState, useEffect, useCallback, useMemo } from "react";

const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dLabel = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((d - t) / 86400000);
  const base = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  return diff === 0 ? `Hoy · ${base}` : diff === 1 ? `Mañana · ${base}` : base;
};
const tLabel = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const STATUS = {
  requested: { label: "Pedido · esperando supermercado", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  partial: { label: "Llegó una parte", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  sent: { label: "Enviado · confirme al recibir", cls: "bg-sky-50 text-sky-800 border-sky-200" },
  received: { label: "Recibido", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelado", cls: "bg-gray-50 text-gray-500 border-gray-200" },
};

export default function PanelRequestsButton({ getToken }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("ask");
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [qtyByRow, setQtyByRow] = useState({});
  const [busyKey, setBusyKey] = useState(null);

  const call = useCallback(async (url, opts = {}) => {
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) throw new Error(json?.error || `El servidor respondió ${res.status}`);
    return json;
  }, [getToken]);

  const loadRequests = useCallback(async () => {
    try {
      const j = await call(`http://localhost:5000/api/panel-requests?scope=recent`);
      setRequests(j.requests || []);
    } catch (e) { setError(e.message); }
  }, [call]);

  const loadOrders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await call(`http://localhost:5000/api/panel-requests/line-orders?days=14`);
      setOrders(j.orders || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [call]);

  // El globo se mantiene al día aunque el panel esté cerrado.
  useEffect(() => {
    loadRequests();
    const t = setInterval(loadRequests, 60000);
    return () => clearInterval(t);
  }, [loadRequests]);

  useEffect(() => { if (open) { loadOrders(); loadRequests(); } }, [open, loadOrders, loadRequests]);

  const toReceive = useMemo(
    () => requests.reduce((s, r) => s + (r.shipments || []).filter((x) => !x.received_at).length, 0),
    [requests]
  );
  const waiting = requests.filter((r) => r.status === "requested" || r.status === "partial").length;

  const rowKey = (o) => `${o.date}|${o.work_order_id}|${o.color || ""}`;
  // Lo que falta pedir para esa fila = piezas a producir − lo ya pedido.
  const missing = (o) => Math.max(0, Math.round(o.planned_qty - o.requested_qty));

  const flash = (text, err = false) => { setToast({ text, err }); setTimeout(() => setToast(null), 3500); };

  const ask = async (o) => {
    const k = rowKey(o);
    const q = Number(qtyByRow[k] ?? missing(o));
    if (!(q > 0)) { flash("Escriba cuántos paneles necesita", true); return; }
    setBusyKey(k);
    try {
      await call(`http://localhost:5000/api/panel-requests`, {
        method: "POST",
        body: JSON.stringify({ workOrderId: o.work_order_id, color: o.color, date: o.date, qty: q }),
      });
      flash(`Pedido enviado al supermercado: ${n0(q)} paneles de ${o.work_order_no}`);
      setQtyByRow((m) => { const c = { ...m }; delete c[k]; return c; });
      await Promise.all([loadOrders(), loadRequests()]);
    } catch (e) { flash(e.message, true); }
    finally { setBusyKey(null); }
  };

  const receive = async (s) => {
    setBusyKey(`s${s.id}`);
    try {
      await call(`http://localhost:5000/api/panel-requests/shipments/${s.id}/receive`, { method: "POST" });
      flash(`Recibido: ${n0(s.qty)} paneles`);
      await loadRequests();
    } catch (e) { flash(e.message, true); }
    finally { setBusyKey(null); }
  };

  const cancel = async (r) => {
    if (!window.confirm(`¿Cancelar el pedido de ${n0(r.requested_qty)} paneles de ${r.work_order_no}?`)) return;
    setBusyKey(`c${r.id}`);
    try {
      await call(`http://localhost:5000/api/panel-requests/${r.id}/cancel`, { method: "POST" });
      flash("Pedido cancelado");
      await Promise.all([loadOrders(), loadRequests()]);
    } catch (e) { flash(e.message, true); }
    finally { setBusyKey(null); }
  };

  const byDay = useMemo(() => {
    const m = new Map();
    for (const o of orders) { if (!m.has(o.date)) m.set(o.date, []); m.get(o.date).push(o); }
    return [...m.entries()];
  }, [orders]);

  return (
    <>
      <button
        onClick={() => { setOpen(true); setTab(toReceive > 0 ? "mine" : "ask"); }}
        className="relative rounded-xl border bg-white px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50"
      >
        Paneles
        {toReceive > 0 ? (
          <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-sky-600 text-white text-[11px] font-bold flex items-center justify-center" title="Envíos por confirmar">
            {toReceive}
          </span>
        ) : waiting > 0 ? (
          <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center" title="Pedidos esperando al supermercado">
            {waiting}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div
            className="w-full sm:max-w-2xl max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 border-b">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Paneles</h2>
                <button onClick={() => setOpen(false)} className="ml-auto rounded-xl border px-3 py-1.5 text-sm font-medium text-gray-700">
                  Cerrar
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                {[
                  { id: "ask", label: "Pedir paneles" },
                  { id: "mine", label: `Mis pedidos${toReceive ? ` · ${toReceive} por recibir` : ""}` },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={tab === t.id
                      ? "rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-semibold"
                      : "rounded-xl border bg-white px-4 py-2 text-sm font-semibold text-gray-900"}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && <p className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}

              {tab === "ask" && (
                loading ? <p className="py-10 text-center text-gray-500">Cargando órdenes…</p>
                : byDay.length === 0 ? <p className="py-10 text-center text-gray-500">Su línea no tiene órdenes planeadas en los próximos días.</p>
                : byDay.map(([day, rows]) => (
                  <section key={day} className="mb-5">
                    <h3 className="text-sm font-semibold text-gray-500 mb-2 capitalize">{dLabel(day)}</h3>
                    <ul className="space-y-2">
                      {rows.map((o) => {
                        const k = rowKey(o);
                        const miss = missing(o);
                        const done = miss === 0;
                        return (
                          <li key={k} className={`rounded-2xl border p-3 ${done ? "bg-gray-50" : "bg-white"}`}>
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="font-mono text-base font-bold text-gray-900 break-all">{o.work_order_no}</div>
                                <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-gray-600">
                                  {o.color && <span className="rounded-md bg-gray-900 text-white px-1.5 py-0.5 text-xs font-semibold">{o.color}</span>}
                                  {o.customer_po && <span>PO {o.customer_po}</span>}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-2xl font-bold tabular-nums text-gray-900 leading-none">{n0(o.planned_qty)}</div>
                                <div className="text-xs text-gray-500 mt-1">pzas a producir</div>
                              </div>
                            </div>
                            {done ? (
                              <p className="mt-2 text-sm text-emerald-700">Ya pidió {n0(o.requested_qty)} paneles para este día.</p>
                            ) : (
                              <div className="mt-3 flex items-end gap-2">
                                <label className="flex-1">
                                  <span className="block text-xs text-gray-500 mb-1">
                                    Paneles a pedir{o.requested_qty > 0 ? ` (ya pidió ${n0(o.requested_qty)})` : ""}
                                  </span>
                                  <input
                                    type="number" min="1" step="1" inputMode="numeric"
                                    value={qtyByRow[k] ?? miss}
                                    onChange={(e) => setQtyByRow((m) => ({ ...m, [k]: e.target.value }))}
                                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-900"
                                  />
                                </label>
                                <button
                                  onClick={() => ask(o)}
                                  disabled={busyKey === k}
                                  className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  {busyKey === k ? "Enviando…" : "Pedir paneles"}
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}

              {tab === "mine" && (
                requests.length === 0 ? <p className="py-10 text-center text-gray-500">No ha pedido paneles en los últimos 14 días.</p>
                : (
                  <ul className="space-y-3">
                    {requests.map((r) => {
                      const st = STATUS[r.status] || STATUS.requested;
                      return (
                        <li key={r.id} className={`rounded-2xl border p-3 ${r.status === "sent" ? "border-sky-300" : ""}`}>
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-base font-bold text-gray-900 break-all">{r.work_order_no}</div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-gray-600">
                                {r.color && <span className="rounded-md bg-gray-900 text-white px-1.5 py-0.5 text-xs font-semibold">{r.color}</span>}
                                <span className="capitalize">{dLabel(r.request_date)}</span>
                              </div>
                            </div>
                            <span className={`shrink-0 text-xs font-medium rounded-full border px-2 py-1 ${st.cls}`}>{st.label}</span>
                          </div>

                          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-gray-50 py-2">
                              <dd className="text-xl font-bold tabular-nums text-gray-900 leading-none">{n0(r.requested_qty)}</dd>
                              <dt className="text-xs text-gray-500 mt-1">Pedido</dt>
                            </div>
                            <div className="rounded-xl bg-gray-50 py-2">
                              <dd className="text-xl font-bold tabular-nums text-gray-900 leading-none">{n0(r.received_qty)}</dd>
                              <dt className="text-xs text-gray-500 mt-1">Recibido</dt>
                            </div>
                            <div className={`rounded-xl py-2 ${r.balance_qty > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
                              <dd className={`text-xl font-bold tabular-nums leading-none ${r.balance_qty > 0 ? "text-amber-800" : "text-emerald-700"}`}>{n0(r.balance_qty)}</dd>
                              <dt className="text-xs text-gray-500 mt-1">Falta enviar</dt>
                            </div>
                          </dl>

                          {(r.shipments || []).length > 0 && (
                            <ul className="mt-3 space-y-2">
                              {r.shipments.map((s) => (
                                <li key={s.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${s.received_at ? "bg-emerald-50/50 border-emerald-200" : "bg-sky-50 border-sky-200"}`}>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-base font-semibold tabular-nums text-gray-900">{n0(s.qty)} paneles</div>
                                    <div className="text-xs text-gray-500">
                                      Enviado {tLabel(s.sent_at)}{s.received_at ? ` · recibido ${tLabel(s.received_at)}` : ""}
                                    </div>
                                  </div>
                                  {s.received_at ? (
                                    <span className="text-sm font-semibold text-emerald-700">✓ Recibido</span>
                                  ) : (
                                    <button
                                      onClick={() => receive(s)}
                                      disabled={busyKey === `s${s.id}`}
                                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      {busyKey === `s${s.id}` ? "…" : "Recibido"}
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}

                          {r.status === "requested" && (
                            <button
                              onClick={() => cancel(r)}
                              disabled={busyKey === `c${r.id}`}
                              className="mt-2 text-xs font-medium text-gray-500 underline underline-offset-2"
                            >
                              Cancelar pedido
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>

            {toast && (
              <div className={`mx-5 mb-4 rounded-xl px-3 py-2 text-sm font-medium ${toast.err ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200"}`}>
                {toast.text}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}