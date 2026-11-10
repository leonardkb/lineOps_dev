// components/warehouse/FinishedOrderDrawer.jsx
// Side panel with one order's detail: received (scanned) vs assigned (merchant)
// vs produced (line), per size × color, and which line the pieces came from.
//   GET /api/finished-warehouse/analytics/breakdown?workOrder=&po=&startDate=&endDate=
//
//   <FinishedOrderDrawer
//     open={!!sel}
//     workOrder={sel?.po}        // work_order_no
//     customerPo={sel?.mo}       // PO cliente (omit → all POs of the order)
//     highlight={{ size: sel?.size_code, color: sel?.color_name }}
//     onClose={() => setSel(null)} />
import { useState, useEffect } from "react";
import { X, Package, Factory, RefreshCw } from "lucide-react";
import { api, num, cx, sizeText, Button, Banner, Loading, EmptyState, Th } from "./finishedShared";

// Received is counted since the beginning (inventory is all-time, not the last 30 days).
const ALL_TIME = "2000-01-01";
const today = () => new Date().toISOString().slice(0, 10);
const same = (a, b) => String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
const barTone = (pct) => (pct >= 100 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-orange-500");

export default function FinishedOrderDrawer({ open, workOrder, customerPo, highlight, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open || !workOrder) return;
    let alive = true;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ workOrder, startDate: ALL_TIME, endDate: today() });
    if (customerPo != null && customerPo !== "") qs.set("po", customerPo);
    api(`/api/finished-warehouse/analytics/breakdown?${qs}`)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) { setData(null); setError(e.message); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, workOrder, customerPo, nonce]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  const wo = data?.workOrder;
  const t = data?.totals;
  const sizes = data?.sizes || [];
  const lines = (data?.lines || []).filter((l) => l.received > 0);
  const isHi = (s) => highlight && same(s.size_code, highlight.size) && (!highlight.color || same(s.color, highlight.color));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 w-full sm:w-[680px] max-w-full bg-white shadow-2xl flex flex-col"
             style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono font-semibold text-slate-900 break-all">{wo?.work_order_no || workOrder}</span>
              {(customerPo || wo?.mo) && <span className="font-mono text-sm text-slate-400">· PO {customerPo || wo?.mo}</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{[wo?.customer_name, wo?.style].filter(Boolean).join(" · ") || "—"}</div>
          </div>
          <button onClick={() => setNonce((n) => n + 1)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Actualizar">
            <RefreshCw className={cx("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="p-5"><Banner kind="err">{error}</Banner></div>
          ) : loading && !data ? (
            <Loading />
          ) : !data ? null : (
            <>
              {/* Totals */}
              <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-200">
                <Tile label="Recibido" value={t.received} cls="bg-emerald-50 text-emerald-700" />
                <Tile label="Asignado" value={t.assigned} cls="bg-indigo-50 text-indigo-700" />
                <Tile label="Producido" value={t.produced} cls="bg-slate-100 text-slate-700" />
                <Tile label="Pendiente" value={t.pending} cls="bg-amber-50 text-amber-700" />
              </div>

              {/* Which line */}
              <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">De qué línea</span>
                {lines.length === 0 ? (
                  <span className="text-xs text-slate-400">Sin piezas recibidas todavía.</span>
                ) : lines.map((l) => (
                  <span key={l.line_no} className="inline-flex items-center gap-1.5 text-xs rounded-lg ring-1 ring-inset ring-slate-200 bg-slate-50 px-2 py-1">
                    <Factory className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-700">{l.line_no === "—" ? "Línea desconocida" : `Línea ${l.line_no}`}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{num(l.received)}</span>
                    <span className="text-slate-400">rec.</span>
                  </span>
                ))}
              </div>

              {sizes.length === 0 ? (
                <EmptyState icon={Package} title="Sin desglose" text="Esta orden no tiene tallas asignadas, producidas ni recibidas." />
              ) : (
                <>
                  {/* Phone: cards */}
                  <ul className="sm:hidden divide-y divide-slate-100">
                    {sizes.map((s) => (
                      <li key={`${s.size_code}|${s.color}`} className={cx("px-5 py-3", isHi(s) && "bg-indigo-50/60")}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-900">{sizeText(s.size_code, s.size_label)} <span className="font-normal text-slate-500">· {s.color || "—"}</span></span>
                          <span className="text-sm tabular-nums"><b>{num(s.received)}</b><span className="text-slate-400"> / {num(s.assigned)}</span></span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500 tabular-nums">Producido {num(s.produced)}{s.pending > 0 && <span className="text-amber-600"> · faltan {num(s.pending)}</span>}</div>
                        <Progress s={s} />
                      </li>
                    ))}
                  </ul>

                  {/* Tablet / desktop: table */}
                  <table className="hidden sm:table w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr className="uppercase tracking-wide">
                        <Th className="pl-5">Talla</Th><Th>Color</Th><Th right>Asignado</Th><Th right>Producido</Th><Th right>Recibido</Th><Th className="pr-5">% / línea</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sizes.map((s) => (
                        <tr key={`${s.size_code}|${s.color}`} className={cx("align-top", isHi(s) ? "bg-indigo-50/60" : "hover:bg-slate-50")}>
                          <td className="pl-5 pr-4 py-3">
                            <div className={cx("font-medium text-slate-900", isHi(s) && "text-indigo-700")}>{sizeText(s.size_code, s.size_label)}</div>
                            {(s.estilo || s.style_code) && <div className="text-[11px] font-mono text-slate-400">{s.estilo || s.style_code}</div>}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{s.color || "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">{num(s.assigned)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">{num(s.produced)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <div className="font-semibold text-slate-900">{num(s.received)}</div>
                            {s.pending > 0 && <div className="text-[11px] text-amber-600">faltan {num(s.pending)}</div>}
                          </td>
                          <td className="pl-4 pr-5 py-3 min-w-[150px]"><Progress s={s} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 sticky bottom-0">
                      <tr className="border-t border-slate-200 font-semibold text-slate-900">
                        <td className="pl-5 pr-4 py-3" colSpan={2}>Total</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(t.assigned)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{num(t.produced)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{num(t.received)}</td>
                        <td className="pl-4 pr-5 py-3"><Bar pct={t.pct} /></td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </>
          )}
        </div>
        {data && (
          <div className="px-5 py-3 border-t border-slate-200 flex justify-end">
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          </div>
        )}
      </aside>
    </div>
  );
}

function Tile({ label, value, cls }) {
  return (
    <div className={cx("rounded-xl px-3 py-2.5", cls)}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{num(value)}</div>
    </div>
  );
}

function Bar({ pct }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={cx("h-full rounded-full", barTone(pct))} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}

function Progress({ s }) {
  const rec = (s.byLine || []).filter((l) => l.received > 0);
  return (
    <div className="mt-1.5 sm:mt-0">
      <Bar pct={s.pct} />
      {rec.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rec.map((l) => (
            <span key={l.line_no} className="inline-flex items-center gap-1 text-[11px] rounded-md ring-1 ring-inset ring-slate-200 bg-slate-50 px-1.5 py-0.5" title={`Línea ${l.line_no}: ${num(l.received)} recibidas`}>
              <Factory className="w-3 h-3 text-slate-400" />
              <span className="text-slate-500">{l.line_no === "—" ? "?" : `L${l.line_no}`}</span>
              <span className="font-semibold text-slate-800 tabular-nums">{num(l.received)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}