// components/warehouse/FinishedWarehouseAnalytics.jsx
// Almacén de Producto Terminado — Analítica de recepción.
//
// Responde: ¿cuánto se RECIBIÓ (escaneando tickets) por orden de trabajo y por
// PO cliente, y cómo se compara contra lo que el MERCHANT asignó y contra lo
// que produjo cada LÍNEA? Al hacer clic en una fila se abre el desglose por
// talla: recibido (escaneado) vs asignado (merchant) vs producido (línea), y de
// QUÉ LÍNEA vinieron las piezas.
//
// Backend:
//   GET /api/finished-warehouse/analytics            -> { summary, detail, byLine, byDay, byCustomer }
//   GET /api/finished-warehouse/analytics/breakdown  -> { sizes, totals, lines }
//
//   <FinishedWarehouseAnalytics onNavigate={setTab} />
//
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  ArrowLeft, RefreshCw, Loader2, AlertCircle, PackageCheck, ScanLine,
  Boxes, ClipboardList, Factory, Percent, X, Search, ChevronRight,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import NavCeo from "../../components/NavCeo";

// ── API helpers (mismo patrón que FinishedWarehouseScan.jsx) ────────────────
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
function apiUrl(path) {
  const base = String(API_URL || "").replace(/\/+$/, "");
  let p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  if (base && p.startsWith(base)) return p;
  return base + (p.startsWith("/") ? p : `/${p}`);
}
async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), { headers: authHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ── Formatters ──────────────────────────────────────────────────────────────
const num = (v) => Math.round(Number(v) || 0).toLocaleString();
const pct = (v) => `${Math.round(Number(v) || 0)}%`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const shortDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : "—");
function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const sizeText = (s) => {
  const code = String(s.size_code ?? "").trim();
  const lbl = String(s.size_label ?? "").trim();
  if (code && lbl && lbl !== code) return `${code} · ${lbl}`;
  return code || lbl || "—";
};

const LINE_PALETTE = ["#4f46e5", "#0891b2", "#7c3aed", "#2563eb", "#c026d3", "#0d9488", "#db2777", "#ea580c", "#65a30d", "#ca8a04"];
// Verde cuando lo recibido ya alcanzó lo asignado; rojo cuando apenas empieza.
const pctColor = (p) => {
  if (p >= 100) return "#16a34a";
  if (p >= 75) return "#65a30d";
  if (p >= 40) return "#f59e0b";
  if (p > 0) return "#f97316";
  return "#94a3b8";
};

function Kpi({ icon: Icon, label, value, sub, tone = "gray" }) {
  const tones = {
    indigo: "bg-gradient-to-br from-indigo-500 to-violet-600 text-white",
    teal: "bg-gradient-to-br from-teal-500 to-cyan-600 text-white",
    gray: "bg-white text-gray-900 border border-gray-200",
  };
  const grad = tone !== "gray";
  return (
    <div className={`rounded-xl shadow-sm px-3 py-2 flex flex-col justify-center ${tones[tone]}`}>
      <p className={`text-[10px] font-medium uppercase tracking-wide leading-none flex items-center gap-1 ${grad ? "text-white/80" : "text-gray-500"}`}>
        {Icon && <Icon className="w-3 h-3" />} {label}
      </p>
      <p className="text-xl xl:text-2xl font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className={`text-[10px] leading-none ${grad ? "text-white/80" : "text-gray-400"}`}>{sub}</p>}
    </div>
  );
}

function Panel({ title, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col min-h-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1 flex-shrink-0">
        <h3 className="text-xs font-bold text-gray-800">{title}</h3>
        {right && <span className="text-[10px] text-gray-400">{right}</span>}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// Barra fina recibido/asignado usada en la tabla.
function MiniProgress({ value }) {
  const v = Math.min(Math.max(Number(value) || 0, 0), 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[36px]">
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: pctColor(v) }} />
      </div>
      <span className="text-[10px] text-gray-500 w-8 text-right">{pct(v)}</span>
    </div>
  );
}

function LineChip({ line_no, received }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] rounded-md border border-gray-100 bg-gray-50 px-1.5 py-0.5">
      <Factory className="w-2.5 h-2.5 text-gray-400" />
      <span className="font-medium text-gray-700">L{line_no}</span>
      <span className="font-mono text-gray-900">{num(received)}</span>
    </span>
  );
}

export default function FinishedWarehouseAnalytics({ onNavigate = null }) {
  const [preset, setPreset] = useState("last30");
  const [startDate, setStartDate] = useState(addDays(todayStr(), -29));
  const [endDate, setEndDate] = useState(todayStr());
  const [customerFilter, setCustomerFilter] = useState("all");
  const [q, setQ] = useState("");
  const [queryText, setQueryText] = useState(""); // debounced value actually sent

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Drawer del desglose por talla.
  const [selected, setSelected] = useState(null); // { work_order_no, customer_po, customer_name }
  const [breakdown, setBreakdown] = useState(null);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdError, setBdError] = useState(null);

  useEffect(() => {
    const t = todayStr();
    if (preset === "today") { setStartDate(t); setEndDate(t); }
    else if (preset === "last7") { setStartDate(addDays(t, -6)); setEndDate(t); }
    else if (preset === "last30") { setStartDate(addDays(t, -29)); setEndDate(t); }
    else if (preset === "last90") { setStartDate(addDays(t, -89)); setEndDate(t); }
    else if (preset === "year") { setStartDate(`${new Date().getFullYear()}-01-01`); setEndDate(t); }
  }, [preset]);

  // Debounce del buscador para no disparar en cada tecla.
  useEffect(() => {
    const id = setTimeout(() => setQueryText(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (customerFilter !== "all") params.append("customerId", customerFilter);
      if (queryText) params.append("q", queryText);
      const d = await api(`/api/finished-warehouse/analytics?${params.toString()}`);
      setData(d);
    } catch (e) {
      setError(e.message || "No se pudo cargar la analítica");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, customerFilter, queryText]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Opciones de cliente: se conservan aunque el filtro reduzca la respuesta.
  const [customerOptions, setCustomerOptions] = useState([]);
  useEffect(() => {
    if (customerFilter === "all" && !queryText && data?.byCustomer) {
      setCustomerOptions(data.byCustomer.filter((c) => c.customer_id != null).map((c) => ({ id: c.customer_id, name: c.customer_name })));
    }
  }, [data, customerFilter, queryText]);

  const openBreakdown = useCallback(async (row) => {
    setSelected(row);
    setBreakdown(null);
    setBdError(null);
    setBdLoading(true);
    try {
      const params = new URLSearchParams({
        workOrder: row.work_order_no,
        po: row.customer_po ?? "",
        startDate, endDate,
      });
      const d = await api(`/api/finished-warehouse/analytics/breakdown?${params.toString()}`);
      setBreakdown(d);
    } catch (e) {
      setBdError(e.message || "No se pudo cargar el desglose");
    } finally {
      setBdLoading(false);
    }
  }, [startDate, endDate]);

  const closeDrawer = () => { setSelected(null); setBreakdown(null); setBdError(null); };

  const summary = data?.summary || {};
  const detail = data?.detail || [];
  const rangeLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

  const lineChart = useMemo(
    () => (data?.byLine || []).slice(0, 10).map((l) => ({ name: `L${l.line_no}`, received: l.received })),
    [data]
  );
  const dayChart = useMemo(
    () => (data?.byDay || []).map((d) => ({ name: shortDate(d.day), received: d.received })),
    [data]
  );
  const orderChart = useMemo(
    () => detail.slice(0, 8).map((d) => ({
      name: d.work_order_no + (d.customer_po ? ` · ${d.customer_po}` : ""),
      received: d.received,
      assigned: d.assigned,
    })),
    [detail]
  );

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 to-gray-100">
        <NavCeo />
      <div className="flex-1 min-h-0 flex flex-col max-w-[1600px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 gap-3">

        {/* Header + filtros */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {onNavigate && (
              <button
                onClick={() => onNavigate("dashboard")}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border text-gray-600 hover:bg-gray-50"
                title="Volver al tablero"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 flex-wrap">
                <span className="bg-gradient-to-r from-emerald-600 to-cyan-500 bg-clip-text text-transparent">
                  Recepción de Almacén PT
                </span>
                <span className="text-[11px] font-normal text-gray-600">{rangeLabel}</span>
              </h1>
              <p className="text-xs text-gray-500">Recibido al escanear vs asignado por el merchant, y de qué línea entró.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Orden, PO, cliente…"
                className="bg-white border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-40"
              />
            </div>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="today">Hoy</option>
              <option value="last7">7 días</option>
              <option value="last30">30 días</option>
              <option value="last90">90 días</option>
              <option value="year">Este año</option>
              <option value="custom">Personalizado</option>
            </select>
            {preset === "custom" && (
              <>
                <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                <span className="text-gray-400 text-xs">a</span>
                <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </>
            )}
            <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 max-w-[170px]">
              <option value="all">Todos los clientes</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={fetchData}
              className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition inline-flex items-center gap-1.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2 flex-shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" /> No se pudo cargar: {error}. Intente Actualizar.
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 flex-shrink-0">
          <Kpi icon={ScanLine} label="Recibido" value={num(summary.received)} sub={`${num(summary.tickets)} tickets`} tone="teal" />
          <Kpi icon={ClipboardList} label="Asignado" value={num(summary.assigned)} sub="por merchant" tone="indigo" />
          <Kpi icon={Percent} label="% recibido" value={pct(summary.pct)} sub="recibido / asignado" />
          <Kpi icon={Factory} label="Producido" value={num(summary.produced)} sub="impreso por líneas" />
          <Kpi icon={Boxes} label="Órdenes" value={num(summary.orders)} sub={`${num(summary.pos)} PO cliente`} />
          <Kpi icon={Factory} label="Líneas" value={num(summary.lines)} sub="aportaron piezas" />
        </div>

        {/* Área principal: gráficas (izq) + tabla (der) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Gráficas */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-3 min-h-0 h-[70vh] lg:h-auto">
            <Panel title="Recibido por línea" right="top 10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={lineChart} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={44} />
                  <Tooltip formatter={(v) => [num(v), "Recibido"]} />
                  <Bar dataKey="received" radius={[0, 5, 5, 0]}>
                    {lineChart.map((_, i) => <Cell key={i} fill={LINE_PALETTE[i % LINE_PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Recibido por día" right="hora de escaneo">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip formatter={(v) => [num(v), "Recibido"]} labelFormatter={(l) => `Día ${l}`} />
                  <Bar dataKey="received" fill="#0d9488" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Recibido vs asignado por orden" right="top 8" className="sm:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={orderChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-18} textAnchor="end" height={46} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip formatter={(v, n) => [num(v), n === "assigned" ? "Asignado" : "Recibido"]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar name="Asignado" dataKey="assigned" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar name="Recibido" dataKey="received" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Tabla: filas (orden · PO cliente), clic para ver el desglose por talla */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-[70vh] lg:h-auto">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-xs font-bold text-gray-800">Órdenes · PO cliente</h3>
              <span className="text-[10px] text-gray-400">{detail.length} fila(s) · clic para desglose</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {loading && !data ? (
                <div className="text-center text-gray-400 py-10 text-sm flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
                </div>
              ) : detail.length === 0 ? (
                <div className="text-center text-gray-400 py-10 text-sm px-4">
                  No hay tickets escaneados en este rango.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-100">
                      <th className="py-1.5 px-2 font-medium">Orden / PO</th>
                      <th className="py-1.5 px-2 font-medium text-right">Recibido</th>
                      <th className="py-1.5 px-2 font-medium text-right">Asignado</th>
                      <th className="py-1.5 px-2 font-medium">Líneas</th>
                      <th className="py-1.5 pr-1 w-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map((row) => {
                      const isSel = selected &&
                        selected.work_order_no === row.work_order_no &&
                        (selected.customer_po ?? "") === (row.customer_po ?? "");
                      return (
                        <tr
                          key={`${row.work_order_no}|${row.customer_po}`}
                          onClick={() => openBreakdown(row)}
                          className={`border-t border-gray-50 align-top cursor-pointer transition-colors ${isSel ? "bg-emerald-50" : "hover:bg-gray-50"}`}
                        >
                          <td className="py-1.5 px-2">
                            <span className="text-gray-900 font-semibold font-mono">{row.work_order_no}</span>
                            <span className="block text-[10px] text-gray-500 font-mono">
                              {row.customer_po ? `PO ${row.customer_po}` : "sin PO cliente"}
                            </span>
                            <span className="block text-[10px] text-gray-400 max-w-[130px] truncate" title={row.customer_name || ""}>
                              {row.customer_name || "—"}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <span className="font-semibold text-gray-900">{num(row.received)}</span>
                            <span className="block text-[10px] text-gray-400">{row.tickets} tkt · {row.sizes} tallas</span>
                            <div className="mt-0.5 w-[86px] ml-auto"><MiniProgress value={row.pct} /></div>
                          </td>
                          <td className="py-1.5 px-2 text-right text-gray-600">
                            {num(row.assigned)}
                            <span className="block text-[10px] text-gray-400">prod. {num(row.produced)}</span>
                          </td>
                          <td className="py-1.5 px-2">
                            <div className="flex flex-wrap gap-1 max-w-[130px]">
                              {row.lines.length === 0
                                ? <span className="text-[10px] text-gray-300">—</span>
                                : row.lines.slice(0, 4).map((l) => <LineChip key={l.line_no} line_no={l.line_no} received={l.received} />)}
                              {row.lines.length > 4 && <span className="text-[10px] text-gray-400">+{row.lines.length - 4}</span>}
                            </div>
                          </td>
                          <td className="py-1.5 pr-1 text-gray-300"><ChevronRight className="w-3.5 h-3.5" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Drawer: desglose por talla de la fila seleccionada */}
      {selected && (
        <SizeBreakdownDrawer
          selected={selected}
          breakdown={breakdown}
          loading={bdLoading}
          error={bdError}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer lateral con el desglose por talla: recibido (escaneado) vs asignado
// (merchant) vs producido (línea), y de qué línea vinieron las piezas.
// ---------------------------------------------------------------------------
function SizeBreakdownDrawer({ selected, breakdown, loading, error, onClose }) {
  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const t = breakdown?.totals || {};
  const sizes = breakdown?.sizes || [];
  const lines = breakdown?.lines || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-[slidein_.2s_ease-out]">
        {/* Cabecera */}
        <div className="px-4 py-3 border-b flex items-start gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <PackageCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 font-mono">
              {selected.work_order_no}
              {selected.customer_po ? <span className="text-gray-400"> · PO {selected.customer_po}</span> : null}
            </h2>
            <p className="text-xs text-gray-500 truncate">
              {(breakdown?.workOrder?.customer_name || selected.customer_name || "—")}
              {breakdown?.workOrder?.style ? ` · ${breakdown.workOrder.style}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {/* Totales del desglose */}
        <div className="px-4 py-3 grid grid-cols-4 gap-2 border-b flex-shrink-0">
          <MiniStat label="Recibido" value={t.received} tone="emerald" />
          <MiniStat label="Asignado" value={t.assigned} tone="indigo" />
          <MiniStat label="Producido" value={t.produced} tone="gray" />
          <MiniStat label="Pendiente" value={t.pending} tone="amber" />
        </div>

        {/* Chips de líneas que aportaron */}
        {lines.length > 0 && (
          <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">De qué línea</span>
            {lines.map((l) => (
              <span key={l.line_no} className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-gray-100 bg-gray-50 px-2 py-1">
                <Factory className="w-3 h-3 text-gray-400" />
                <span className="font-medium text-gray-700">Línea {l.line_no}</span>
                <span className="text-gray-300">·</span>
                <span className="font-mono text-gray-900">{num(l.received)}</span>
                <span className="text-gray-400">rec.</span>
              </span>
            ))}
          </div>
        )}

        {/* Tabla por talla */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-12 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando desglose…
            </div>
          ) : error ? (
            <div className="m-4 p-3 rounded-lg bg-amber-50 text-amber-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          ) : sizes.length === 0 ? (
            <div className="text-center text-gray-400 py-12 text-sm">Sin tallas para esta selección.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white z-10">
                <tr className="border-b">
                  <th className="py-2 px-3 font-medium">Talla</th>
                  <th className="py-2 px-2 font-medium">Color</th>
                  <th className="py-2 px-2 font-medium text-right">Asignado</th>
                  <th className="py-2 px-2 font-medium text-right">Producido</th>
                  <th className="py-2 px-2 font-medium text-right">Recibido</th>
                  <th className="py-2 px-2 font-medium">% / línea</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sizes.map((s) => (
                  <tr key={`${s.size_code}|${s.color}`} className="align-top">
                    <td className="py-2 px-3">
                      <span className="font-semibold text-gray-900">{sizeText(s)}</span>
                      {s.estilo && <span className="block text-[10px] text-gray-400 font-mono">{s.estilo}</span>}
                    </td>
                    <td className="py-2 px-2 text-gray-700">{s.color || "—"}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{num(s.assigned)}</td>
                    <td className="py-2 px-2 text-right text-gray-500">{num(s.produced)}</td>
                    <td className="py-2 px-2 text-right">
                      <span className="font-semibold text-gray-900">{num(s.received)}</span>
                      {s.pending > 0 && <span className="block text-[10px] text-amber-500">faltan {num(s.pending)}</span>}
                    </td>
                    <td className="py-2 px-2">
                      <div className="w-[92px]"><MiniProgress value={s.pct} /></div>
                      <div className="flex flex-wrap gap-1 mt-1 max-w-[150px]">
                        {s.byLine.filter((l) => l.received > 0).map((l) => (
                          <LineChip key={l.line_no} line_no={l.line_no} received={l.received} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50/60 font-semibold text-gray-900">
                  <td className="py-2 px-3" colSpan={2}>Total</td>
                  <td className="py-2 px-2 text-right">{num(t.assigned)}</td>
                  <td className="py-2 px-2 text-right text-gray-500">{num(t.produced)}</td>
                  <td className="py-2 px-2 text-right">{num(t.received)}</td>
                  <td className="py-2 px-2"><div className="w-[92px]"><MiniProgress value={t.pct} /></div></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </aside>

      <style>{`@keyframes slidein { from { transform: translateX(24px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>
  );
}

function MiniStat({ label, value, tone = "gray" }) {
  const tones = {
    emerald: "text-emerald-700 bg-emerald-50",
    indigo: "text-indigo-700 bg-indigo-50",
    amber: "text-amber-700 bg-amber-50",
    gray: "text-gray-700 bg-gray-100",
  };
  return (
    <div className={`rounded-lg px-2 py-1.5 ${tones[tone] || tones.gray}`}>
      <p className="text-[10px] uppercase tracking-wide leading-none opacity-80">{label}</p>
      <p className="text-lg font-bold leading-tight mt-0.5">{num(value)}</p>
    </div>
  );
}