// components/planner/ForecastOverview.jsx
//
// Analíticas de Planeación → «Resumen de pronóstico».
// Vista analítica del Tablero de pronóstico (pronósticos FC#### del cliente):
//   • KPIs: pronósticos, clientes, piezas, % en tablero, convertido a SKM,
//     atrasados, fecha en que termina todo, líneas ocupadas.
//   • Por cliente: piezas, avance, cuándo termina y cuántos días faltan.
//   • Carga por línea: pronósticos, piezas, días ocupados, ocupada hasta.
//   • Carga por mes (piezas en tablero).
//   • Detalle por pronóstico: inicio, fin, días de trabajo, días para
//     completar, entrega vs fin, holgura / atraso, estado.
// Se muestra dentro de BoardsHub.jsx (que tiene el selector de vistas);
// «Ver tablero de pronóstico» llama a onOpenBoard.
//
// Lee sólo: GET /api/forecast-orders?status=all y GET /api/forecast-holds.
import { useEffect, useMemo, useState } from "react";
import {
  TrendingUp, Users, Package, LayoutGrid, AlertTriangle, CalendarClock,
  ArrowRightLeft, Loader2, Search, BarChart3, RefreshCw, CalendarDays,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
async function getJSON(path, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(), cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) return data;
      if (res.status < 500 && res.status !== 429) return null;
    } catch { /* retry */ }
    if (i < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => Math.round(num(v)).toLocaleString();
const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(`${ymd(b)}T00:00:00`) - new Date(`${ymd(a)}T00:00:00`)) / 86400000);
};
const fmtDate = (s) => {
  const k = ymd(s);
  if (!k) return "—";
  return new Date(`${k}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
};
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const sortLines = (a, b) => (Number(a) || 0) - (Number(b) || 0) || String(a).localeCompare(String(b));

// Estado de un pronóstico en el tablero.
const ST = {
  late:      { label: "Atrasado",        chip: "bg-rose-50 text-rose-700 ring-rose-600/20",          bar: "bg-rose-500" },
  ontime:    { label: "A tiempo",        chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", bar: "bg-emerald-500" },
  partial:   { label: "Parcial en tablero", chip: "bg-amber-50 text-amber-700 ring-amber-600/20",    bar: "bg-amber-400" },
  unplanned: { label: "Por cargar",      chip: "bg-gray-100 text-gray-600 ring-gray-500/20",         bar: "bg-gray-300" },
  converted: { label: "Convertido a SKM", chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",   bar: "bg-indigo-500" },
  cancelled: { label: "Cancelado",       chip: "bg-gray-100 text-gray-400 ring-gray-400/20",         bar: "bg-gray-200" },
};
const STATUS_RANK = { late: 0, partial: 1, unplanned: 2, ontime: 3, converted: 4, cancelled: 5 };

export default function ForecastOverview({ onOpenBoard = null }) {
  const [orders, setOrders] = useState([]);
  const [holds, setHolds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("open"); // open | late | unplanned | converted | all

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [o, h] = await Promise.all([getJSON("/api/forecast-orders?status=all"), getJSON("/api/forecast-holds")]);
      if (!alive) return;
      if (!o || !h) setError("No se pudieron cargar los pronósticos. Intente de nuevo.");
      else { setError(""); setOrders(o.forecastOrders || []); setHolds(h.holds || []); }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reload]);

  const today = todayYmd();

  // ── Una fila por pronóstico ──────────────────────────────────────────────
  const rows = useMemo(() => {
    const byOrder = new Map();
    for (const h of holds) {
      const k = String(h.forecast_order_id ?? h.pre_order_id);
      const g = byOrder.get(k) || { pcs: 0, dates: new Set(), lines: new Map(), first: null, last: null, fromToday: 0 };
      const q = num(h.quantity), d = ymd(h.assigned_date), ln = String(h.line_no);
      g.pcs += q;
      g.dates.add(d);
      g.lines.set(ln, (g.lines.get(ln) || 0) + q);
      if (!g.first || d < g.first) g.first = d;
      if (!g.last || d > g.last) g.last = d;
      if (d >= today) g.fromToday += q;
      byOrder.set(k, g);
    }
    return orders.map((o) => {
      const g = byOrder.get(String(o.id)) || { pcs: 0, dates: new Set(), lines: new Map(), first: null, last: null, fromToday: 0 };
      const qty = num(o.quantity);
      const conv = num(o.converted_pieces);
      const open = Math.max(qty - conv, 0);
      const placed = g.pcs;
      const unplaced = Math.max(open - placed, 0);
      const target = num(o.target_pcs);
      const handover = ymd(o.handover_date) || null;
      const slack = handover && g.last ? daysBetween(g.last, handover) : null; // + = holgura, − = atraso
      const isOpen = o.status === "active" || o.status === "partially_converted";
      let status;
      if (o.status === "cancelled") status = "cancelled";
      else if (o.status === "converted") status = "converted";
      else if (placed <= 0) status = "unplanned";
      else if (slack != null && slack < 0) status = "late";
      else if (unplaced > 0) status = "partial";
      else status = "ontime";
      return {
        id: o.id, no: o.forecast_no, customer: o.customer_name || "—", style: o.style_name || "—",
        description: o.style_description || "", season: o.season || "", status, isOpen,
        qty, conv, open, placed, unplaced, target,
        workNos: o.work_order_nos || "",
        lines: [...g.lines.keys()].sort(sortLines),
        first: g.first, last: g.last,
        workDays: g.dates.size,                                     // días con producción en tablero
        spanDays: g.first && g.last ? daysBetween(g.first, g.last) + 1 : null, // calendario
        daysToFinish: g.last ? Math.max(0, daysBetween(today, g.last)) : null, // desde hoy
        lineDaysNeeded: target > 0 && open > 0 ? Math.ceil(open / target) : null, // a 1 línea
        handover, slack,
        search: `${o.forecast_no} ${o.customer_name} ${o.style_name} ${o.season} ${o.style_description} ${o.work_order_nos || ""}`.toUpperCase(),
      };
    });
  }, [orders, holds, today]);

  const openRows = useMemo(() => rows.filter((r) => r.isOpen), [rows]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const pcs = openRows.reduce((t, r) => t + r.open, 0);
    const placed = openRows.reduce((t, r) => t + r.placed, 0);
    const conv = rows.reduce((t, r) => t + r.conv, 0);
    const late = openRows.filter((r) => r.status === "late").length;
    const lines = new Set(holds.map((h) => String(h.line_no)));
    const lastAll = openRows.reduce((m, r) => (r.last && (!m || r.last > m) ? r.last : m), null);
    return {
      forecasts: openRows.length,
      clients: new Set(openRows.map((r) => r.customer)).size,
      pcs, placed, placedPct: pcs > 0 ? Math.floor((placed / pcs) * 100) : 0, // 100% sólo si está todo
      unplaced: Math.max(pcs - placed, 0),
      conv, late, lines: lines.size, lastAll,
      daysToAll: lastAll ? Math.max(0, daysBetween(today, lastAll)) : null,
    };
  }, [rows, openRows, holds, today]);

  // ── Por cliente ───────────────────────────────────────────────────────────
  const byClient = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (r.status === "cancelled") continue;
      const g = m.get(r.customer) || { customer: r.customer, n: 0, open: 0, placed: 0, conv: 0, late: 0, last: null, lines: new Set() };
      if (r.isOpen) g.n++;
      g.open += r.isOpen ? r.open : 0;
      g.placed += r.isOpen ? r.placed : 0;
      g.conv += r.conv;
      if (r.status === "late") g.late++;
      if (r.isOpen && r.last && (!g.last || r.last > g.last)) g.last = r.last;
      r.lines.forEach((l) => g.lines.add(l));
      m.set(r.customer, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, pct: g.open > 0 ? Math.floor((g.placed / g.open) * 100) : 0, daysToFinish: g.last ? Math.max(0, daysBetween(today, g.last)) : null }))
      .sort((a, b) => b.open - a.open || a.customer.localeCompare(b.customer));
  }, [rows, today]);

  // ── Carga por línea ───────────────────────────────────────────────────────
  const byLine = useMemo(() => {
    const m = new Map();
    for (const h of holds) {
      const ln = String(h.line_no);
      const g = m.get(ln) || { line: ln, pcs: 0, dates: new Set(), fcs: new Set(), last: null, first: null };
      const d = ymd(h.assigned_date);
      g.pcs += num(h.quantity);
      g.dates.add(d);
      g.fcs.add(h.forecast_no || h.pre_order_no);
      if (!g.last || d > g.last) g.last = d;
      if (!g.first || d < g.first) g.first = d;
      m.set(ln, g);
    }
    return [...m.values()].map((g) => ({ ...g, days: g.dates.size, n: g.fcs.size })).sort((a, b) => sortLines(a.line, b.line));
  }, [holds]);

  // ── Carga por mes ─────────────────────────────────────────────────────────
  const byMonth = useMemo(() => {
    const m = new Map();
    for (const h of holds) {
      const k = ymd(h.assigned_date).slice(0, 7);
      if (k) m.set(k, (m.get(k) || 0) + num(h.quantity));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, pcs]) => ({
      key: k, pcs, label: `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`,
    }));
  }, [holds]);
  const maxMonth = Math.max(1, ...byMonth.map((x) => x.pcs));

  // ── Detalle visible ───────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => {
        if (only === "open") return r.isOpen;
        if (only === "late") return r.status === "late";
        if (only === "unplanned") return r.isOpen && (r.status === "unplanned" || r.status === "partial");
        if (only === "converted") return r.conv > 0;
        return true;
      })
      .filter((r) => (q ? r.search.includes(q) : true))
      .slice()
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        (a.slack ?? 99999) - (b.slack ?? 99999) ||
        String(a.handover || "9999").localeCompare(String(b.handover || "9999")));
  }, [rows, only, search]);

  return (
    <div className="h-full overflow-auto">
      <div className="w-full px-3 sm:px-4 lg:px-5 py-3 space-y-4">
        <div className="flex items-center justify-end gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">Fuente: Tablero de pronóstico · no afecta el plan real</span>
            <button onClick={() => setReload((k) => k + 1)} title="Actualizar"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            {onOpenBoard && <button onClick={onOpenBoard}
              className="h-8 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-700">
              <TrendingUp className="w-4 h-4" /> Ver tablero de pronóstico
            </button>}
          </div>
        </div>

        {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

        {loading && !orders.length ? (
          <div className="py-24 flex justify-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !orders.length ? (
          <div className="py-20 text-center text-sm text-gray-500">
            Aún no hay pronósticos. Planeación los crea en Planificación Avanzada → Plan Board → <b>Pronóstico</b>.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <Kpi Icon={TrendingUp} label="Pronósticos activos" value={fmt(kpi.forecasts)} />
              <Kpi Icon={Users} label="Clientes" value={fmt(kpi.clients)} />
              <Kpi Icon={Package} label="Pzas pronóstico" value={fmt(kpi.pcs)} />
              <Kpi Icon={LayoutGrid} label="En tablero" value={`${kpi.placedPct}%`} sub={`${fmt(kpi.placed)} pzas`} tone={kpi.placedPct >= 100 ? "ok" : kpi.placedPct > 0 ? "warn" : "muted"} />
              <Kpi Icon={CalendarClock} label="Por cargar" value={fmt(kpi.unplaced)} sub="pzas sin línea" tone={kpi.unplaced > 0 ? "warn" : "ok"} />
              <Kpi Icon={AlertTriangle} label="Atrasados" value={fmt(kpi.late)} sub="fin > entrega" tone={kpi.late > 0 ? "bad" : "ok"} />
              <Kpi Icon={CalendarDays} label="Termina todo" value={kpi.lastAll ? fmtDate(kpi.lastAll) : "—"} sub={kpi.daysToAll != null ? `en ${fmt(kpi.daysToAll)} días` : null} />
              <Kpi Icon={ArrowRightLeft} label="Convertido a SKM" value={fmt(kpi.conv)} sub="pzas" tone={kpi.conv > 0 ? "info" : "muted"} />
            </div>

            {/* Cliente + línea */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
              <Card title="Resumen por cliente" Icon={Users}>
                <Table
                  cols={["Cliente", "Pron.", "Pzas", "En tablero", "SKM", "Termina", "Días p/ completar", "Atras."]}
                  align={["l", "r", "r", "l", "r", "l", "r", "r"]}
                >
                  {byClient.map((c) => (
                    <tr key={c.customer} className="border-t border-gray-100">
                      <td className="py-2 px-2 font-semibold text-gray-900">{c.customer}<div className="text-[10px] font-normal text-gray-500">{[...c.lines].sort(sortLines).map((l) => `L${l}`).join(", ") || "sin línea"}</div></td>
                      <td className="py-2 px-2 text-right tabular-nums">{c.n}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmt(c.open)}</td>
                      <td className="py-2 px-2 min-w-[110px]"><Meter pct={c.pct} /></td>
                      <td className="py-2 px-2 text-right tabular-nums text-indigo-700">{c.conv ? fmt(c.conv) : "—"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(c.last)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{c.daysToFinish != null ? fmt(c.daysToFinish) : "—"}</td>
                      <td className={`py-2 px-2 text-right tabular-nums ${c.late ? "text-rose-700 font-semibold" : "text-gray-400"}`}>{c.late || "—"}</td>
                    </tr>
                  ))}
                </Table>
              </Card>

              <Card title="Carga por línea" Icon={LayoutGrid}>
                {byLine.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">Ningún pronóstico está cargado a una línea.</p>
                ) : (
                  <Table cols={["Línea", "Pron.", "Pzas", "Días", "Ocupada hasta"]} align={["l", "r", "r", "r", "l"]}>
                    {byLine.map((l) => (
                      <tr key={l.line} className="border-t border-gray-100">
                        <td className="py-2 px-2 font-semibold">L{l.line}</td>
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

            {/* Detalle */}
            <Card
              title="Detalle por pronóstico"
              Icon={TrendingUp}
              right={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-[12px]">
                    {[["open", "Activos"], ["late", "Atrasados"], ["unplanned", "Por cargar"], ["converted", "Con SKM"], ["all", "Todos"]].map(([k, l]) => (
                      <button key={k} onClick={() => setOnly(k)}
                        className={`px-2.5 py-1 rounded-md ${only === k ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-800"}`}>{l}</button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="FC, cliente, estilo…"
                      className="h-8 w-48 pl-7 pr-2 text-[12px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
              }
            >
              <Table
                cols={["Pronóstico", "Cliente", "Pzas", "Avance", "Líneas", "Inicio", "Fin", "Días trabajo", "Días p/ completar", "Entrega", "Holgura", "Estado"]}
                align={["l", "l", "r", "l", "l", "l", "l", "r", "r", "l", "r", "l"]}
              >
                {visible.map((r) => {
                  const base = Math.max(r.qty, 1);
                  return (
                    <tr key={r.id} className={`border-t border-gray-100 ${r.status === "cancelled" ? "opacity-50" : ""}`}>
                      <td className="py-2 px-2">
                        <div className="font-mono font-semibold text-teal-800">{r.no}</div>
                        <div className="text-[11px] text-gray-600 max-w-[170px] truncate" title={r.description || r.style}>{r.style}{r.season ? ` · ${r.season}` : ""}</div>
                      </td>
                      <td className="py-2 px-2">{r.customer}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {fmt(r.qty)}
                        {r.conv > 0 && <div className="text-[10px] text-indigo-700 max-w-[140px] truncate" title={r.workNos}>{fmt(r.conv)} → SKM</div>}
                      </td>
                      <td className="py-2 px-2 min-w-[130px]">
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex" title={`SKM ${fmt(r.conv)} · en tablero ${fmt(r.placed)} · por cargar ${fmt(r.unplaced)}`}>
                          <div className="bg-indigo-500" style={{ width: `${(r.conv / base) * 100}%` }} />
                          <div className="bg-teal-500" style={{ width: `${(r.placed / base) * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                          {fmt(r.placed)} en tablero{r.unplaced > 0 && r.isOpen ? <span className="text-amber-700"> · {fmt(r.unplaced)} por cargar</span> : null}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-[12px] text-gray-700">{r.lines.length ? r.lines.map((l) => `L${l}`).join(", ") : "—"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(r.first)}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium">{fmtDate(r.last)}</td>
                      <td className="py-2 px-2 text-right tabular-nums" title={r.spanDays ? `${fmt(r.spanDays)} días calendario` : ""}>
                        {r.workDays ? fmt(r.workDays) : "—"}
                        {r.spanDays ? <div className="text-[10px] text-gray-400">{fmt(r.spanDays)} cal.</div> : null}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums" title={r.lineDaysNeeded ? `A ${fmt(r.target)} pzas/día necesita ${fmt(r.lineDaysNeeded)} día(s)-línea` : ""}>
                        <span className="font-semibold">{r.isOpen && r.daysToFinish != null ? fmt(r.daysToFinish) : "—"}</span>
                        {r.isOpen && r.lineDaysNeeded ? <div className="text-[10px] text-gray-400">{fmt(r.lineDaysNeeded)} d-línea</div> : null}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtDate(r.handover)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-semibold ${r.slack == null ? "text-gray-400" : r.slack < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                        {r.slack == null || !r.isOpen ? "—" : r.slack > 0 ? `+${r.slack} d` : `${r.slack} d`}
                      </td>
                      <td className="py-2 px-2"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ST[r.status].chip}`}>{ST[r.status].label}</span></td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr><td colSpan={12} className="py-8 text-center text-sm text-gray-500">Sin pronósticos con este filtro.</td></tr>
                )}
              </Table>
              <p className="mt-2 text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                <span><b className="text-gray-700">Días trabajo</b>: días con piezas en el tablero (cal. = calendario de inicio a fin).</span>
                <span><b className="text-gray-700">Días p/ completar</b>: días desde hoy hasta su último día en el tablero; d-línea = días que necesita a su capacidad en una sola línea.</span>
                <span><b className="text-gray-700">Holgura</b>: entrega − fin (negativo = atraso).</span>
              </p>
            </Card>

            {/* Carga por mes */}
            {byMonth.length > 0 && (
              <Card title="Piezas en tablero por mes" Icon={BarChart3}>
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-1.5 h-40 min-w-max px-1 pt-4">
                    {byMonth.map((m) => (
                      <div key={m.key} className="flex flex-col items-center justify-end h-full w-11" title={`${m.label}: ${fmt(m.pcs)} pzas`}>
                        <span className="text-[9px] tabular-nums text-gray-600 mb-0.5">{m.pcs >= 1000 ? `${(m.pcs / 1000).toFixed(m.pcs >= 10000 ? 0 : 1)}k` : fmt(m.pcs)}</span>
                        <div className={`w-full rounded-t ${m.key === today.slice(0, 7) ? "bg-teal-600" : "bg-teal-400/80"}`} style={{ height: `${Math.max(3, (m.pcs / maxMonth) * 100)}%` }} />
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

// ── UI bits ─────────────────────────────────────────────────────────────────
const TONE = {
  muted: "text-gray-900", ok: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700", info: "text-indigo-700",
};
export function Kpi({ Icon, label, value, sub, tone = "muted" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums leading-none ${TONE[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
export function Card({ title, Icon, right, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5"><Icon className="w-4 h-4 text-teal-600" />{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
export function Table({ cols, align, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-500">
            {cols.map((c, i) => <th key={c} className={`py-1.5 px-2 font-medium whitespace-nowrap ${align[i] === "r" ? "text-right" : "text-left"}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Meter({ pct }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${p >= 100 ? "bg-emerald-500" : p > 0 ? "bg-teal-500" : "bg-gray-300"}`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-gray-600 w-9 text-right">{p}%</span>
    </div>
  );
}