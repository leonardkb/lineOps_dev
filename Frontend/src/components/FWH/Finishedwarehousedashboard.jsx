// components/warehouse/FinishedWarehouseDashboard.jsx
// Almacén de Producto Terminado — Dashboard de recepción.
//   • Piezas recibidas HOY (por hora, por orden, contra ayer)
//   • Estado de recepción por orden: recibido vs asignado, fecha de entrega
//     del merchant, ritmo de los últimos 7 días, fecha estimada de término
//   • Órdenes atrasadas y en riesgo primero
// Clic en una orden → panel lateral con el desglose por talla y línea.
//   GET /api/finished-warehouse/receiving-status?tz=…
//   GET /api/finished-warehouse/dashboard        (tickets por ingresar, inventario, listas)
//
//   <FinishedWarehouseDashboard onNavigate={setTab} />
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw, PackageCheck, AlertTriangle, AlarmClock, CalendarClock, ScanLine, Package,
  CheckCircle2, CalendarX, ChevronRight, TrendingUp, TrendingDown, Truck, ListChecks,
} from "lucide-react";
import {
  api, num, cx, timeAgo, PageHeader, Card, CardHeader, Button, Pill, SegTabs, Stat,
  SearchInput, EmptyState, Loading, Banner, Th, Td, notifyChange,
  PageFrame,
} from "./finishedShared";
import FinishedOrderDrawer from "./FinishedOrderDrawer";

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
const REFRESH_MS = 60000;

const STATE = {
  late: { label: "Atrasada", tone: "red", icon: AlarmClock },
  risk: { label: "En riesgo", tone: "amber", icon: AlertTriangle },
  ok: { label: "A tiempo", tone: "indigo", icon: CalendarClock },
  done: { label: "Completa", tone: "emerald", icon: CheckCircle2 },
  no_date: { label: "Sin fecha", tone: "slate", icon: CalendarX },
};
const ORDER = { late: 0, risk: 1, ok: 2, no_date: 3, done: 4 };

const fmtDay = (ymd) => {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }).replace(".", "");
};
const relDays = (n) => {
  if (n == null) return "";
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n > 0) return `en ${n} d`;
  return `hace ${-n} d`;
};

export default function FinishedWarehouseDashboard({ onNavigate = null }) {
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("attention");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [d1, d2] = await Promise.all([
        api(`/api/finished-warehouse/receiving-status?tz=${encodeURIComponent(TZ)}`),
        api("/api/finished-warehouse/dashboard").catch(() => ({ dashboard: null })),
      ]);
      setData(d1);
      setExtra(d2.dashboard || null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message || "No se pudo cargar el tablero");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(true); }, REFRESH_MS);
    const onChange = () => load(true);
    window.addEventListener("fw:changed", onChange);
    return () => { clearInterval(id); window.removeEventListener("fw:changed", onChange); };
  }, [load]);

  const go = (k) => onNavigate && onNavigate(k);
  const s = data?.summary;
  const orders = data?.orders || [];

  const counts = useMemo(() => ({
    attention: orders.filter((o) => o.state === "late" || o.state === "risk").length,
    ok: orders.filter((o) => o.state === "ok").length,
    no_date: orders.filter((o) => o.state === "no_date").length,
    done: orders.filter((o) => o.state === "done").length,
    all: orders.length,
  }), [orders]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orders
      .filter((o) => tab === "all" || (tab === "attention" ? o.state === "late" || o.state === "risk" : o.state === tab))
      .filter((o) => !t || [o.po, o.mo, o.customer_name, o.style].some((v) => String(v ?? "").toLowerCase().includes(t)))
      .sort((a, b) => (ORDER[a.state] - ORDER[b.state])
        || ((a.days_left ?? 9999) - (b.days_left ?? 9999))
        || (b.pending - a.pending));
  }, [orders, tab, q]);

  const todayOrders = useMemo(
    () => orders.filter((o) => o.received_today > 0).sort((a, b) => b.received_today - a.received_today),
    [orders]
  );

  const diff = s ? s.receivedToday - s.receivedYesterday : 0;

  return (
    <PageFrame>
      <PageHeader
        title="Dashboard"
        subtitle="Recepción de órdenes: qué se recibió hoy, qué falta y qué va tarde contra la fecha de entrega."
        actions={<>
          {updatedAt && <span className="text-xs text-slate-400 hidden sm:inline">Actualizado {timeAgo(updatedAt)}</span>}
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => { load(); notifyChange(); }}>Actualizar</Button>
        </>}
      />

      {error && <Banner kind="err" onClose={() => setError(null)}>{error}</Banner>}
      {data && !data.deliveryColumn && (
        <Banner kind="warn">
          No se encontró la fecha de entrega del merchant en <span className="font-mono">work_orders</span> ni en <span className="font-mono">work_order_lines</span>.
          Las órdenes aparecen como «Sin fecha» hasta que exista esa columna.
        </Banner>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat
          icon={PackageCheck} tone="emerald" label="Recibido hoy"
          value={s?.receivedToday}
          hint={s ? `${num(s.ticketsToday)} ticket(s) · ${num(s.ordersToday)} orden(es)` : null}
        />
        <Stat
          icon={AlarmClock} tone="red" label="Órdenes atrasadas" value={s?.late} alert={(s?.late || 0) > 0}
          hint="pasó su fecha de entrega" onClick={() => setTab("attention")}
        />
        <Stat
          icon={AlertTriangle} tone="amber" label="En riesgo" value={s?.risk}
          hint="al ritmo actual no llegan" onClick={() => setTab("attention")}
        />
        <Stat icon={Truck} tone="indigo" label="Entregan esta semana" value={s?.dueThisWeek} hint="próximos 7 días" onClick={() => setTab("all")} />
        <Stat
          icon={ScanLine} tone="violet" label="Tickets por ingresar" value={extra?.tickets?.pending}
          hint={extra?.tickets ? `${num(extra.tickets.pendingPieces)} pzas` : null}
          onClick={onNavigate ? () => go("escaneo") : undefined}
        />
        <Stat
          icon={Package} label="Piezas en inventario" value={extra?.inventory?.pieces}
          hint={extra?.inventory ? `${num(extra.inventory.skus)} SKU(s)` : null}
          onClick={onNavigate ? () => go("inventario") : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Receiving status */}
        <Card className="lg:col-span-8 overflow-hidden">
          <CardHeader
            icon={ListChecks}
            title="Estado de recepción"
            subtitle="Recibido contra lo asignado por el merchant y su fecha de entrega. Clic en una orden para ver el detalle."
          />
          <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="overflow-x-auto max-w-full">
              <SegTabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { key: "attention", label: "Atención", icon: AlertTriangle, count: counts.attention },
                  { key: "ok", label: "A tiempo", count: counts.ok },
                  { key: "no_date", label: "Sin fecha", count: counts.no_date },
                  { key: "done", label: "Completas", count: counts.done },
                  { key: "all", label: "Todas", count: counts.all },
                ]}
              />
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Orden, PO, cliente, estilo…" className="w-full sm:w-64 sm:ml-auto" />
          </div>

          {loading && !data ? (
            <Loading />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={tab === "attention" ? CheckCircle2 : ListChecks}
              title={q ? "Sin resultados" : tab === "attention" ? "Nada atrasado ni en riesgo" : "Sin órdenes"}
              text={q ? "Pruebe con otra búsqueda." : tab === "attention" ? "Todas las órdenes con fecha van a tiempo." : null}
            />
          ) : (
            <>
              {/* Phone / PDA */}
              <ul className="md:hidden divide-y divide-slate-100">
                {shown.map((o) => (
                  <li key={o.id} onClick={() => setSel(o)} className="px-4 py-3 cursor-pointer active:bg-slate-100">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-semibold text-slate-900 truncate">{o.po}</div>
                        <div className="text-xs text-slate-500 truncate">{o.customer_name || "—"} · PO {o.mo || "—"}</div>
                      </div>
                      <StatePill o={o} />
                    </div>
                    <div className="mt-2"><RecvBar o={o} /></div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      <DeliveryText o={o} />
                      <span>Faltan <b className="text-slate-700">{num(o.pending)}</b></span>
                      {o.received_today > 0 && <span className="text-emerald-700">+{num(o.received_today)} hoy</span>}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto max-h-[62vh]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <Th>Orden</Th><Th>Entrega</Th><Th>Recibido / asignado</Th><Th right>Faltan</Th>
                      <Th right>Ritmo / necesita</Th><Th>Estimado</Th><Th>Estado</Th><Th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((o) => (
                      <tr key={o.id} onClick={() => setSel(o)} className={cx("cursor-pointer", sel?.id === o.id ? "bg-indigo-50/60" : "hover:bg-slate-50")}>
                        <td className="px-4 py-2.5 max-w-[240px]">
                          <div className="font-mono font-semibold text-slate-900 truncate">{o.po}</div>
                          <div className="text-xs text-slate-500 truncate">{o.customer_name || "—"} · PO {o.mo || "—"}{o.style ? ` · ${o.style}` : ""}</div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><DeliveryText o={o} stacked /></td>
                        <td className="px-4 py-2.5 min-w-[180px]">
                          <RecvBar o={o} />
                          {o.received_today > 0 && <div className="text-[11px] text-emerald-700 mt-0.5">+{num(o.received_today)} hoy</div>}
                        </td>
                        <Td right strong={o.pending > 0} className={o.pending === 0 ? "text-slate-400" : ""}>{num(o.pending)}</Td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                          <PaceText o={o} />
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap"><EtaText o={o} /></td>
                        <td className="px-4 py-2.5"><StatePill o={o} /></td>
                        <td className="pr-3"><ChevronRight className="w-4 h-4 text-slate-300" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {/* Today */}
        <Card className="lg:col-span-4 overflow-hidden">
          <CardHeader icon={PackageCheck} title="Recibido hoy" subtitle={data?.today ? fmtDay(data.today) : null} />
          <div className="px-5 pt-4">
            <div className="flex items-end gap-3">
              <div className="text-4xl font-semibold text-slate-900 tabular-nums">{num(s?.receivedToday)}</div>
              <div className="pb-1 text-sm text-slate-500">pzas</div>
              {s && (
                <span className={cx("ml-auto mb-1 inline-flex items-center gap-1 text-xs font-medium",
                  diff >= 0 ? "text-emerald-700" : "text-red-600")}>
                  {diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {diff >= 0 ? "+" : "−"}{num(Math.abs(diff))} vs ayer ({num(s.receivedYesterday)})
                </span>
              )}
            </div>
            <HourBars hours={data?.todayByHour || []} />
          </div>
          <div className="mt-4 border-t border-slate-100">
            <div className="px-5 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Por orden</div>
            {todayOrders.length === 0 ? (
              <div className="px-5 pb-5 pt-2 text-sm text-slate-400">Aún no se recibe nada hoy.</div>
            ) : (
              <ul className="pb-2 max-h-[320px] overflow-y-auto">
                {todayOrders.map((o) => (
                  <li key={o.id}>
                    <button onClick={() => setSel(o)} className="w-full px-5 py-2 flex items-center gap-3 text-left hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm text-slate-900 truncate">{o.po}</div>
                        <div className="text-xs text-slate-500 truncate">{o.customer_name || "—"} · {o.pct}% recibido</div>
                      </div>
                      <span className="font-semibold text-emerald-700 tabular-nums">+{num(o.received_today)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <FinishedOrderDrawer open={!!sel} workOrder={sel?.po} onClose={() => setSel(null)} />
    </PageFrame>
  );
}

function StatePill({ o }) {
  const st = STATE[o.state] || STATE.ok;
  return <Pill tone={st.tone} icon={st.icon}>{st.label}</Pill>;
}

function DeliveryText({ o, stacked }) {
  if (!o.delivery_date) return <span className="text-slate-400">Sin fecha</span>;
  const late = o.state === "late";
  const near = o.days_left != null && o.days_left >= 0 && o.days_left <= 3 && o.state !== "done";
  const rel = late ? `vencida ${relDays(o.days_left)}` : relDays(o.days_left);
  const cls = late ? "text-red-600" : near ? "text-amber-700" : "text-slate-500";
  return stacked ? (
    <div>
      <div className="text-slate-900">{fmtDay(o.delivery_date)}</div>
      {o.state !== "done" && <div className={cx("text-[11px]", cls)}>{rel}</div>}
    </div>
  ) : (
    <span>Entrega <b className="text-slate-700">{fmtDay(o.delivery_date)}</b>{o.state !== "done" && <span className={cx("ml-1", cls)}>({rel})</span>}</span>
  );
}

function RecvBar({ o }) {
  const tone = o.state === "late" ? "bg-red-500" : o.state === "risk" ? "bg-amber-400" : o.state === "done" ? "bg-emerald-500" : "bg-indigo-500";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span><b className="text-slate-900 text-sm">{num(o.received)}</b><span className="text-slate-400"> / {num(o.assigned)}</span></span>
        <span className="text-slate-500">{o.pct}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${o.pct}%` }} />
      </div>
    </div>
  );
}

function PaceText({ o }) {
  if (o.state === "done") return <span className="text-slate-400">—</span>;
  const short = o.need_per_day > 0 && o.pace < o.need_per_day;
  return (
    <div>
      <div className={cx(short ? "text-red-600 font-medium" : "text-slate-900")}>{num(o.pace)}<span className="text-slate-400 text-xs"> /día</span></div>
      {o.need_per_day > 0 && <div className="text-[11px] text-slate-400">necesita {num(o.need_per_day)}/día</div>}
    </div>
  );
}

function EtaText({ o }) {
  if (o.state === "done") return <span className="text-emerald-700 text-xs font-medium">Completa</span>;
  if (!o.eta) return <span className="text-xs text-slate-400" title="No se ha recibido nada en los últimos 7 días">Sin ritmo</span>;
  const after = o.delivery_date && o.eta > o.delivery_date;
  return (
    <div>
      <div className={cx(after ? "text-red-600 font-medium" : "text-slate-900")}>{fmtDay(o.eta)}</div>
      {after && <div className="text-[11px] text-red-500">después de la entrega</div>}
    </div>
  );
}

// Pieces received per hour today (only the hours of the working window).
function HourBars({ hours }) {
  const byHour = new Map(hours.map((h) => [h.hour, h]));
  const present = hours.map((h) => h.hour);
  const nowH = new Date().getHours();
  const from = Math.min(7, ...present);
  const to = Math.max(Math.min(nowH, 23), 18, ...present);
  const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const max = Math.max(1, ...hours.map((h) => h.pieces));
  return (
    <div className="mt-4">
      <div className="h-28 flex items-end gap-1">
        {range.map((h) => {
          const v = byHour.get(h);
          const pct = v ? Math.max(4, Math.round((v.pieces / max) * 100)) : 0;
          return (
            <div key={h} className="flex-1 h-full flex flex-col justify-end group relative" title={`${String(h).padStart(2, "0")}:00 · ${num(v?.pieces)} pzas · ${num(v?.tickets)} ticket(s)`}>
              <div className={cx("w-full rounded-t", v ? "bg-emerald-500 group-hover:bg-emerald-600" : h === nowH ? "bg-slate-200" : "bg-slate-100")}
                   style={{ height: v ? `${pct}%` : "3px" }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-slate-400 tabular-nums">
        {range.map((h) => <div key={h} className="flex-1 text-center">{h % 3 === 0 ? h : ""}</div>)}
      </div>
    </div>
  );
}