// components/planner/PlanOverview.jsx
//
// Analíticas de Planeación → Tableros → «Resumen plan».
// Vista analítica del Plan Board REAL (órdenes SKM y sus asignaciones), con
// el mismo formato que el resumen de pronóstico:
//   • KPIs: órdenes activas, clientes, pzas por producir, % asignado,
//     sin asignar, atrasadas, cuándo termina todo, producido.
//   • Por cliente, carga por línea (desde hoy), detalle por orden y carga por mes.
//
// No pide nada al servidor: usa las órdenes y asignaciones que la página ya
// cargó (PlannerAnalytics → /api/work-orders y /api/line-assignments).
import { useMemo, useState } from "react";
import {
  ClipboardList, Users, Package, LayoutGrid, AlertTriangle, CalendarClock,
  CalendarDays, Factory, Search, BarChart3, Loader2, RefreshCw, ChevronRight,
} from "lucide-react";
import { Kpi, Card, Table, Meter } from "./ForecastOverview";

const DEAD = new Set(["cancelled", "rejected"]);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => Math.round(num(v)).toLocaleString();
const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a, b) => (a && b ? Math.round((new Date(`${ymd(b)}T00:00:00`) - new Date(`${ymd(a)}T00:00:00`)) / 86400000) : null);
const fmtDate = (s) => {
  const k = ymd(s);
  return k ? new Date(`${k}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
};
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const sortLines = (a, b) => (Number(String(a).replace(/\D/g, "")) || 0) - (Number(String(b).replace(/\D/g, "")) || 0) || String(a).localeCompare(String(b));

const ST = {
  late:      { label: "Atrasada",    chip: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  partial:   { label: "Parcial en tablero", chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  sinplan:   { label: "Por planear", chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  ontime:    { label: "A tiempo",    chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  nofecha:   { label: "Sin fecha",   chip: "bg-gray-100 text-gray-500 ring-gray-500/20" },
  completed: { label: "Completada",  chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  dead:      { label: "Cancelada",   chip: "bg-gray-100 text-gray-400 ring-gray-400/20" },
};
const RANK = { late: 0, partial: 1, sinplan: 2, nofecha: 3, ontime: 4, completed: 5, dead: 6 };

export default function PlanOverview({ workOrders = [], assignments = [], loading = false, errored = false, onRetry = null, onOpenBoard = null, onSelectClient = null }) {
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("open"); // open | late | unplanned | completed | all
  const today = todayYmd();

  const live = useMemo(
    () => assignments.filter((a) => !DEAD.has(String(a.status || "").toLowerCase()) && a.work_order_id != null && ymd(a.assigned_date)),
    [assignments]
  );

  // ── Una fila por orden ────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const byWo = new Map();
    for (const a of live) {
      const k = String(a.work_order_id);
      const g = byWo.get(k) || { pcs: 0, dates: new Set(), lines: new Set(), first: null, last: null };
      const d = ymd(a.assigned_date);
      g.pcs += num(a.assigned_quantity);
      g.dates.add(d);
      if (a.line_no != null) g.lines.add(String(a.line_no));
      if (!g.first || d < g.first) g.first = d;
      if (!g.last || d > g.last) g.last = d;
      byWo.set(k, g);
    }
    return workOrders.map((wo) => {
      const g = byWo.get(String(wo.id)) || { pcs: 0, dates: new Set(), lines: new Set(), first: null, last: null };
      const st = String(wo.status || "").toLowerCase();
      const target = num(wo.total_to_produce) || num(wo.quantity);
      const produced = num(wo.produced_quantity);
      const assigned = Math.max(num(wo.assigned_quantity), g.pcs);
      const unassigned = Math.max(target - assigned, 0);
      const dead = DEAD.has(st);
      const completed = !dead && (st === "completed" || (target > 0 && produced >= target));
      const isOpen = !dead && !completed;
      const delivery = ymd(wo.commitment_date) || null;
      const slack = delivery && g.last ? daysBetween(g.last, delivery) : null;
      let status;
      if (dead) status = "dead";
      else if (completed) status = "completed";
      else if (!g.last) status = delivery ? "sinplan" : "nofecha";
      else if (slack != null && slack < 0) status = "late";
      else if (unassigned > 0) status = "partial";
      else if (!delivery) status = "nofecha";
      else status = "ontime";
      return {
        id: wo.id, no: wo.work_order_no || `#${wo.id}`, customer: wo.customer_name || "—",
        style: wo.estilo || wo.style_code || "—", styleCode: wo.style_code || "", po: wo.customer_po || "",
        status, isOpen, target, produced, assigned, unassigned,
        toProduce: Math.max(target - produced, 0),
        lines: [...g.lines].sort(sortLines), first: g.first, last: g.last,
        workDays: g.dates.size,
        spanDays: g.first && g.last ? daysBetween(g.first, g.last) + 1 : null,
        daysToFinish: g.last ? Math.max(0, daysBetween(today, g.last)) : null,
        delivery, slack,
        search: `${wo.work_order_no} ${wo.customer_name} ${wo.customer_po} ${wo.style_code} ${wo.estilo}`.toUpperCase(),
      };
    });
  }, [workOrders, live, today]);

  const openRows = useMemo(() => rows.filter((r) => r.isOpen), [rows]);

  const kpi = useMemo(() => {
    const target = openRows.reduce((t, r) => t + r.target, 0);
    const assigned = openRows.reduce((t, r) => t + Math.min(r.assigned, r.target), 0);
    const lastAll = openRows.reduce((m, r) => (r.last && (!m || r.last > m) ? r.last : m), null);
    return {
      orders: openRows.length,
      clients: new Set(openRows.map((r) => r.customer)).size,
      toProduce: openRows.reduce((t, r) => t + r.toProduce, 0),
      assignedPct: target > 0 ? Math.floor((assigned / target) * 100) : 0,
      assigned,
      unassigned: openRows.reduce((t, r) => t + r.unassigned, 0),
      late: openRows.filter((r) => r.status === "late").length,
      sinplan: openRows.filter((r) => r.status === "sinplan").length,
      // Producido = TODO lo cosido (también de órdenes ya completadas).
      produced: rows.reduce((t, r) => t + (r.status === "dead" ? 0 : r.produced), 0),
      producedOpen: openRows.reduce((t, r) => t + r.produced, 0),
      lastAll, daysToAll: lastAll ? Math.max(0, daysBetween(today, lastAll)) : null,
    };
  }, [rows, openRows, today]);

  // Por cliente: órdenes / pzas / asignado / termina = órdenes ACTIVAS;
  // Producido = TODO lo cosido del cliente (incluye órdenes completadas).
  const byClient = useMemo(() => {
    const m = new Map();
    const blank = (c) => ({ customer: c, n: 0, done: 0, target: 0, assigned: 0, produced: 0, producedOpen: 0, late: 0, last: null, lines: new Set() });
    for (const r of rows) {
      if (r.status === "dead") continue;
      const g = m.get(r.customer) || blank(r.customer);
      g.produced += r.produced;
      if (r.status === "completed") g.done++;
      m.set(r.customer, g);
    }
    for (const r of openRows) {
      const g = m.get(r.customer) || blank(r.customer);
      g.n++; g.target += r.target; g.assigned += Math.min(r.assigned, r.target); g.producedOpen += r.produced;
      if (r.status === "late") g.late++;
      if (r.last && (!g.last || r.last > g.last)) g.last = r.last;
      r.lines.forEach((l) => g.lines.add(l));
      m.set(r.customer, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, pct: g.target > 0 ? Math.floor((g.assigned / g.target) * 100) : 0, daysToFinish: g.last ? Math.max(0, daysBetween(today, g.last)) : null }))
      .filter((g) => g.n > 0 || g.produced > 0)
      .sort((a, b) => b.target - a.target || b.produced - a.produced || a.customer.localeCompare(b.customer));
  }, [rows, openRows, today]);

  // Carga por línea desde hoy (lo que falta por coser).
  const byLine = useMemo(() => {
    const m = new Map();
    for (const a of live) {
      const d = ymd(a.assigned_date);
      if (d < today || a.line_no == null) continue;
      const ln = String(a.line_no);
      const g = m.get(ln) || { line: ln, pcs: 0, dates: new Set(), wos: new Set(), last: null };
      g.pcs += num(a.assigned_quantity);
      g.dates.add(d);
      g.wos.add(String(a.work_order_id));
      if (!g.last || d > g.last) g.last = d;
      m.set(ln, g);
    }
    return [...m.values()].map((g) => ({ ...g, days: g.dates.size, n: g.wos.size })).sort((a, b) => sortLines(a.line, b.line));
  }, [live, today]);

  const byMonth = useMemo(() => {
    const m = new Map();
    for (const a of live) {
      const k = ymd(a.assigned_date).slice(0, 7);
      if (k) m.set(k, (m.get(k) || 0) + num(a.assigned_quantity));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, pcs]) => ({ key: k, pcs, label: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` }));
  }, [live]);
  const maxMonth = Math.max(1, ...byMonth.map((x) => x.pcs));

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => {
        if (only === "open") return r.isOpen;
        if (only === "late") return r.status === "late";
        if (only === "unplanned") return r.isOpen && (r.status === "sinplan" || r.status === "partial");
        if (only === "completed") return r.status === "completed";
        return true;
      })
      .filter((r) => (q ? r.search.includes(q) : true))
      .slice()
      .sort((a, b) => RANK[a.status] - RANK[b.status] ||
        (a.slack ?? 99999) - (b.slack ?? 99999) ||
        String(a.delivery || "9999").localeCompare(String(b.delivery || "9999")));
  }, [rows, only, search]);

  if (errored && !workOrders.length) {
    return (
      <div className="py-20 text-center text-sm text-gray-600">
        No se pudieron cargar las órdenes.
        {onRetry && <button onClick={onRetry} className="ml-2 font-semibold text-teal-700 hover:underline">Reintentar</button>}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="w-full px-3 sm:px-4 lg:px-5 py-3 space-y-4">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500">Fuente: Plan Board (órdenes SKM y asignaciones)</span>
          {onRetry && (
            <button onClick={onRetry} title="Actualizar"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}
          {onOpenBoard && (
            <button onClick={onOpenBoard}
              className="h-8 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white hover:bg-gray-800">
              <LayoutGrid className="w-4 h-4" /> Ver Plan Board
            </button>
          )}
        </div>

        {loading && !workOrders.length ? (
          <div className="py-24 flex justify-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <Kpi Icon={ClipboardList} label="Órdenes activas" value={fmt(kpi.orders)} />
              <Kpi Icon={Users} label="Clientes" value={fmt(kpi.clients)} />
              <Kpi Icon={Package} label="Pzas por producir" value={fmt(kpi.toProduce)} />
              <Kpi Icon={LayoutGrid} label="Asignado" value={`${kpi.assignedPct}%`} sub={`${fmt(kpi.assigned)} pzas en líneas`} tone={kpi.assignedPct >= 100 ? "ok" : kpi.assignedPct > 0 ? "warn" : "muted"} />
              <Kpi Icon={CalendarClock} label="Sin asignar" value={fmt(kpi.unassigned)} sub={`${fmt(kpi.sinplan)} órdenes por planear`} tone={kpi.unassigned > 0 ? "warn" : "ok"} />
              <Kpi Icon={AlertTriangle} label="Atrasadas" value={fmt(kpi.late)} sub="fin > entrega" tone={kpi.late > 0 ? "bad" : "ok"} />
              <Kpi Icon={CalendarDays} label="Termina todo" value={kpi.lastAll ? fmtDate(kpi.lastAll) : "—"} sub={kpi.daysToAll != null ? `en ${fmt(kpi.daysToAll)} días` : null} />
              <Kpi Icon={Factory} label="Producido" value={fmt(kpi.produced)} sub={`total cosido · ${fmt(kpi.producedOpen)} en activas`} tone="info" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
              <Card title="Resumen por cliente" Icon={Users}>
                <Table cols={["Cliente", "Órd.", "Pzas", "Asignado", "Producido", "Termina", "Días p/ completar", "Atras."]}
                  align={["l", "r", "r", "l", "r", "l", "r", "r"]}>
                  {byClient.map((c) => {
                    // Clic / Enter abre el panel lateral del cliente (BoardsHub).
                    // «—» = órdenes sin cliente: no hay nada que buscar.
                    const canOpen = !!onSelectClient && c.customer !== "—";
                    const open = () => canOpen && onSelectClient(c.customer);
                    return (
                    <tr key={c.customer}
                      onClick={open}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
                      tabIndex={canOpen ? 0 : undefined}
                      aria-label={canOpen ? `Ver detalle de ${c.customer}` : undefined}
                      className={`border-t border-gray-100 ${canOpen ? "group cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:bg-indigo-50" : ""}`}>
                      <td className="py-2 px-2 font-semibold text-gray-900">
                        <div className="flex items-center gap-2">
                          <span>{c.customer}</span>
                          {canOpen && (
                            <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-medium text-teal-600 group-hover:text-teal-800 group-hover:underline group-focus-visible:text-teal-800">
                              Ver detalle <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-normal text-gray-500 max-w-[220px] truncate">{[...c.lines].sort(sortLines).map((l) => `L${l}`).join(", ") || "sin línea"}</div></td>
                      <td className="py-2 px-2 text-right tabular-nums">{c.n}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmt(c.target)}</td>
                      <td className="py-2 px-2 min-w-[110px]"><Meter pct={c.pct} /></td>
                      <td className="py-2 px-2 text-right tabular-nums text-indigo-700"
                        title={`Total cosido ${fmt(c.produced)} pzas · de órdenes activas ${fmt(c.producedOpen)} · de ${c.done} orden(es) completada(s) ${fmt(c.produced - c.producedOpen)}`}>
                        {c.produced ? fmt(c.produced) : "—"}
                        {c.produced > c.producedOpen && (
                          <div className="text-[10px] text-gray-500">{fmt(c.producedOpen)} en activas</div>
                        )}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(c.last)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{c.daysToFinish != null ? fmt(c.daysToFinish) : "—"}</td>
                      <td className={`py-2 px-2 text-right tabular-nums ${c.late ? "text-rose-700 font-semibold" : "text-gray-400"}`}>{c.late || "—"}</td>
                    </tr>
                    );
                  })}
                  {byClient.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-sm text-gray-500">Sin órdenes activas.</td></tr>}
                </Table>
              </Card>

              <Card title="Carga por línea (desde hoy)" Icon={LayoutGrid}>
                {byLine.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No hay asignaciones desde hoy.</p>
                ) : (
                  <Table cols={["Línea", "Órd.", "Pzas", "Días", "Ocupada hasta"]} align={["l", "r", "r", "r", "l"]}>
                    {byLine.map((l) => (
                      <tr key={l.line} className="border-t border-gray-100">
                        <td className="py-2 px-2 font-semibold">L{String(l.line).replace(/^L/i, "")}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{l.n}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmt(l.pcs)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{fmt(l.days)}</td>
                        <td className="py-2 px-2 whitespace-nowrap">{fmtDate(l.last)}<span className="text-[10px] text-gray-500"> · {fmt(Math.max(0, daysBetween(today, l.last)))} d</span></td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
            </div>

            <Card
              title="Detalle por orden"
              Icon={ClipboardList}
              right={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-[12px]">
                    {[["open", "Activas"], ["late", "Atrasadas"], ["unplanned", "Por planear"], ["completed", "Completadas"], ["all", "Todas"]].map(([k, l]) => (
                      <button key={k} onClick={() => setOnly(k)}
                        className={`px-2.5 py-1 rounded-md ${only === k ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-800"}`}>{l}</button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="OT, cliente, estilo, PO…"
                      className="h-8 w-48 pl-7 pr-2 text-[12px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
              }
            >
              <Table
                cols={["Orden", "Cliente", "Pzas", "Avance", "Líneas", "Inicio", "Fin", "Días trabajo", "Días p/ completar", "Entrega", "Holgura", "Estado"]}
                align={["l", "l", "r", "l", "l", "l", "l", "r", "r", "l", "r", "l"]}
              >
                {visible.map((r) => {
                  const base = Math.max(r.target, 1);
                  const asg = Math.max(Math.min(r.assigned, r.target) - r.produced, 0);
                  return (
                    <tr key={r.id} className={`border-t border-gray-100 ${r.status === "dead" ? "opacity-50" : ""}`}>
                      <td className="py-2 px-2">
                        <div className="font-mono font-semibold text-gray-900 text-[12px] whitespace-nowrap">{r.no}</div>
                        <div className="text-[11px] text-gray-600 max-w-[180px] truncate">{r.style}{r.po ? ` · PO ${r.po}` : ""}</div>
                      </td>
                      <td className="py-2 px-2">{r.customer}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmt(r.target)}</td>
                      <td className="py-2 px-2 min-w-[130px]">
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex" title={`producido ${fmt(r.produced)} · asignado ${fmt(r.assigned)} · sin asignar ${fmt(r.unassigned)}`}>
                          <div className="bg-indigo-500" style={{ width: `${Math.min(r.produced / base, 1) * 100}%` }} />
                          <div className="bg-teal-500" style={{ width: `${(asg / base) * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                          {fmt(r.produced)} cosidas · {fmt(r.assigned)} asignadas
                          {r.unassigned > 0 && r.isOpen ? <span className="text-amber-700"> · {fmt(r.unassigned)} sin asignar</span> : null}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-[12px] text-gray-700 max-w-[120px] truncate" title={r.lines.join(", ")}>{r.lines.length ? r.lines.map((l) => `L${String(l).replace(/^L/i, "")}`).join(", ") : "—"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(r.first)}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium">{fmtDate(r.last)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {r.workDays ? fmt(r.workDays) : "—"}
                        {r.spanDays ? <div className="text-[10px] text-gray-400">{fmt(r.spanDays)} cal.</div> : null}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{r.isOpen && r.daysToFinish != null ? fmt(r.daysToFinish) : "—"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(r.delivery)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-semibold ${r.slack == null || !r.isOpen ? "text-gray-400" : r.slack < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {r.slack == null || !r.isOpen ? "—" : r.slack > 0 ? `+${r.slack} d` : `${r.slack} d`}
                      </td>
                      <td className="py-2 px-2"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ST[r.status].chip}`}>{ST[r.status].label}</span></td>
                    </tr>
                  );
                })}
                {visible.length === 0 && <tr><td colSpan={12} className="py-8 text-center text-sm text-gray-500">Sin órdenes con este filtro.</td></tr>}
              </Table>
              <p className="mt-2 text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                <span><b className="text-gray-700">Días trabajo</b>: días con asignación en el Plan Board (cal. = calendario de inicio a fin).</span>
                <span><b className="text-gray-700">Días p/ completar</b>: días desde hoy hasta su último día asignado.</span>
                <span><b className="text-gray-700">Holgura</b>: entrega del merchant − fin de plan (negativo = atraso).</span>
              </p>
            </Card>

            {byMonth.length > 0 && (
              <Card title="Piezas asignadas por mes" Icon={BarChart3}>
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-1.5 h-40 min-w-max px-1 pt-4">
                    {byMonth.map((m) => (
                      <div key={m.key} className="flex flex-col items-center justify-end h-full w-11" title={`${m.label}: ${fmt(m.pcs)} pzas`}>
                        <span className="text-[9px] tabular-nums text-gray-600 mb-0.5">{m.pcs >= 1000 ? `${(m.pcs / 1000).toFixed(m.pcs >= 10000 ? 0 : 1)}k` : fmt(m.pcs)}</span>
                        <div className={`w-full rounded-t ${m.key === today.slice(0, 7) ? "bg-gray-900" : m.key < today.slice(0, 7) ? "bg-gray-300" : "bg-gray-500"}`} style={{ height: `${Math.max(3, (m.pcs / maxMonth) * 100)}%` }} />
                        <span className={`text-[10px] mt-1 ${m.key.slice(5) === "01" ? "font-semibold text-gray-800" : "text-gray-500"}`}>{m.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}