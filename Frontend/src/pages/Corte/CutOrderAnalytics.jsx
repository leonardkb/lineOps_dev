// CutOrderAnalytics.jsx - cut-order (órdenes de corte) monitoring dashboard.
// Twin of MerchantAnalytics.jsx, reading /api/cut-orders/analytics. Answers the
// cutting-floor questions on one screen: the status of every corte, how many
// órdenes and piezas were created, which tallas are being cut (and how many per
// talla), and how many marcadas each corte carries versus how many are cerradas.
// Same layout contract as the merchant board: compact header + KPI strip stay
// fixed, the chart grid fills the remaining height, and the tables live in one
// tabbed side panel that scrolls internally.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';

import { X, Loader2, AlertCircle, ChevronRight, Scissors, Layers, CheckCircle2, Circle } from 'lucide-react';

import NavCeo from '../../components/NavCeo';

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};

const pct = (v) => `${Math.round(Number(v) || 0)}%`;
// Eficiencia con un decimal ("84.5%"), para no perder medias unidades.
const pct1 = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString()}%`;

// Green once the corte is cutting to plan, red while it's barely started.
const progressColor = (p) => {
  if (p >= 100) return '#16a34a';
  if (p >= 75) return '#65a30d';
  if (p >= 40) return '#f59e0b';
  if (p > 0) return '#f97316';
  return '#94a3b8';
};

const TALLA_PALETTE = ['#4f46e5', '#0891b2', '#7c3aed', '#2563eb', '#c026d3', '#0d9488', '#db2777', '#ea580c', '#65a30d', '#ca8a04'];

const STATUS_META = {
  pending:     { label: 'Pendiente',  chip: 'bg-slate-100 text-slate-700',  dot: '#94a3b8' },
  in_progress: { label: 'En proceso', chip: 'bg-amber-100 text-amber-700',  dot: '#f59e0b' },
  awaiting_verification: { label: 'Por verificar', chip: 'bg-sky-100 text-sky-700', dot: '#0ea5e9' },
  completed:   { label: 'Terminada',  chip: 'bg-green-100 text-green-700',  dot: '#16a34a' },
  cancelled:   { label: 'Cancelada',  chip: 'bg-red-100 text-red-600',      dot: '#dc2626' },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || '—', chip: 'bg-gray-100 text-gray-600', dot: '#94a3b8' };

// Etapa real del corte, derivada en el backend. La diferencia que importa:
// "cortado todo" NO es "terminado" — falta la verificación.
const STAGE_META = {
  planning:     { label: 'En planeación',    short: 'Planeación',  chip: 'bg-violet-100 text-violet-700', dot: '#a855f7' },
  ready:        { label: 'Lista para cortar', short: 'Lista',      chip: 'bg-indigo-100 text-indigo-700', dot: '#6366f1' },
  cutting:      { label: 'En corte',          short: 'Corte',      chip: 'bg-amber-100 text-amber-700',   dot: '#f59e0b' },
  verification: { label: 'Por verificar',     short: 'Verificar',  chip: 'bg-sky-100 text-sky-700',       dot: '#0ea5e9' },
  verified:     { label: 'Terminada',         short: 'Terminada',  chip: 'bg-green-100 text-green-700',   dot: '#16a34a' },
  cancelled:    { label: 'Cancelada',         short: 'Cancelada',  chip: 'bg-red-100 text-red-600',       dot: '#dc2626' },
};
const stageMeta = (s) => STAGE_META[s] || { label: s || '—', short: s || '—', chip: 'bg-gray-100 text-gray-600', dot: '#94a3b8' };

const todayStr = () => new Date().toISOString().split('T')[0];
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};
// "2026-08-10" -> "10/08".
const shortDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '—');

function Kpi({ label, value, sub, tone = 'gray' }) {
  const tones = {
    indigo: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    teal: 'bg-gradient-to-br from-teal-500 to-cyan-600 text-white',
    gray: 'bg-white text-gray-900 border border-gray-200',
  };
  const grad = tone !== 'gray';
  return (
    <div className={`rounded-xl shadow-sm px-3 py-2 flex flex-col justify-center ${tones[tone]}`}>
      <p className={`text-[10px] font-medium uppercase tracking-wide leading-none ${grad ? 'text-white/80' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className="text-xl xl:text-2xl font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className={`text-[10px] leading-none ${grad ? 'text-white/80' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

function Panel({ title, right, children, className = '' }) {
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


function StageChip({ stage }) {
  const m = stageMeta(stage);
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${m.chip}`}>{m.label}</span>;
}

// Thin progress bar used in the orders table: piezas cortadas against the plan.
function Progress({ value }) {
  const v = Math.min(Math.max(Number(value) || 0, 0), 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[40px]">
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: progressColor(v) }} />
      </div>
      <span className="text-[10px] text-gray-500 w-8 text-right">{pct(v)}</span>
    </div>
  );
}

export default function CutOrderAnalytics() {
  const navigate = useNavigate();
  const [, setUser] = useState(null);

  const [preset, setPreset] = useState('last30');
  const [startDate, setStartDate] = useState(addDays(todayStr(), -29));
  const [endDate, setEndDate] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  // Búsqueda por orden / work order. `searchInput` es lo que se teclea; `search`
  // es el valor con debounce que realmente dispara la consulta.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [allDates, setAllDates] = useState(false);
  // A qué fecha se aplica el rango: 'completed' = día en que se completó cada
  // marcada (lo que pasó en el piso ese día); 'cut_date' = fecha planeada.
  const [dateBy, setDateBy] = useState('completed');
  const [tab, setTab] = useState('orders'); // orders | tallas | fabrics | days

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Panel lateral con el desglose de un corte (tallas, paneles, marcadas).
  const [selected, setSelected] = useState(null); // fila de data.detail
  const [breakdown, setBreakdown] = useState(null);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdError, setBdError] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/'); return; }
    axios.get(`http://localhost:5000/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setUser(res.data.user))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/');
      });
  }, [navigate]);

  useEffect(() => {
    const t = todayStr();
    if (preset === 'today') { setStartDate(t); setEndDate(t); }
    else if (preset === 'last7') { setStartDate(addDays(t, -6)); setEndDate(t); }
    else if (preset === 'last30') { setStartDate(addDays(t, -29)); setEndDate(t); }
    else if (preset === 'last90') { setStartDate(addDays(t, -89)); setEndDate(t); }
    else if (preset === 'year') { setStartDate(`${new Date().getFullYear()}-01-01`); setEndDate(t); }
  }, [preset]);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (stageFilter !== 'all') params.append('stage', stageFilter);
      if (dateBy === 'completed') params.append('dateBy', 'completed');
      if (search) {
        params.append('q', search);
        if (allDates) params.append('allDates', '1');
      }
      const res = await axios.get(`http://localhost:5000/api/cut-orders/analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setData(res.data);
      else setError(res.data.error || 'Could not load cut-order data.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, statusFilter, stageFilter, search, allDates, dateBy]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openBreakdown = useCallback(async (row) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setSelected(row);
    setBreakdown(null);
    setBdError(null);
    setBdLoading(true);
    try {
      const res = await axios.get(`http://localhost:5000/api/cut-orders/analytics/breakdown?id=${encodeURIComponent(row.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setBreakdown(res.data);
      else setBdError(res.data.error || 'No se pudo cargar el desglose.');
    } catch (err) {
      setBdError(err.response?.data?.error || err.message);
    } finally {
      setBdLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setSelected(null);
    setBreakdown(null);
    setBdError(null);
  }, []);

  const summary = data?.summary || {};
  const byDone = dateBy === 'completed';
  // Cómo llamar al rango en los textos chicos: "hoy" o "en rango".
  const rangeWord = preset === 'today' ? 'hoy' : 'en rango';
  const rangeLabel = search && allDates
    ? 'Todas las fechas'
    : (startDate === endDate ? startDate : `${startDate} → ${endDate}`);

  // Top tallas by planned pieces for the chart (the table shows them all).
  const tallaChart = useMemo(
    () => (data?.byTalla || [])
      .slice()
      .sort((a, b) => b.planned - a.planned)
      .slice(0, 10)
      .map((t) => ({ name: t.talla, planned: t.planned, cut: t.cut })),
    [data]
  );

  // Etapas en el orden del flujo, no por tamaño: planeación → corte →
  // verificación → terminada. Así la gráfica se lee como el proceso real.
  const stageChart = useMemo(
    () => (data?.byStage || []).map((s) => ({
      name: stageMeta(s.stage).short,
      stage: s.stage,
      orders: s.orders,
      quantity: s.quantity,
      cut: s.cut,
    })),
    [data]
  );

  const dayChart = useMemo(
    () => (data?.byDay || []).map((d) => ({
      name: shortDate(d.day),
      day: d.day,
      quantity: d.quantity,
      cut: d.cut,
    })),
    [data]
  );

  // Por marcada completada: marcadas y piezas por día de completado.
  const doneChart = useMemo(
    () => (data?.byCompletedDay || []).map((d) => ({
      name: shortDate(d.day),
      day: d.day,
      marcadas: d.marcadas,
      pieces: d.pieces,
      orders: d.orders.length,
    })),
    [data]
  );

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 to-gray-100">
      <NavCeo />

      <div className="flex-1 min-h-0 flex flex-col max-w-[1600px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 gap-3">

        {/* Header + filters (compact, fixed) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-shrink-0">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
              <span className="bg-gradient-to-r from-indigo-600 to-cyan-500 bg-clip-text text-transparent">
                Monitor de Corte
              </span>
              <span className="text-[11px] font-normal text-gray-600">
                {rangeLabel}
                {stageFilter !== 'all' && <> · {stageMeta(stageFilter).label}</>}
                {statusFilter !== 'all' && <> · {statusMeta(statusFilter).label}</>}
                {search && <> · «{search}»</>}
                {byDone && <> · por marcada completada</>}
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="9" cy="9" r="6" /><path d="M14 14l4 4" strokeLinecap="round" />
              </svg>
              <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchInput.trim()); if (e.key === 'Escape') setSearchInput(''); }}
                placeholder="Orden / Work order…"
                aria-label="Buscar por número de orden o work order"
                className="w-48 bg-white border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {searchInput.trim() && (
              <label className="flex items-center gap-1 text-xs text-gray-600 select-none cursor-pointer"
                title="Buscar la orden en cualquier fecha, sin importar el rango">
                <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)}
                  className="accent-indigo-600" />
                Todas las fechas
              </label>
            )}
            <select value={dateBy} onChange={(e) => setDateBy(e.target.value)}
              title="A qué fecha se aplica el rango"
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="completed">Por marcada completada</option>
              <option value="cut_date">Por fecha de corte</option>
            </select>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="today">Hoy</option>
              <option value="last7">Últimos 7 días</option>
              <option value="last30">Últimos 30 días</option>
              <option value="last90">Últimos 90 días</option>
              <option value="year">Este año</option>
              <option value="custom">Personalizado</option>
            </select>
            {preset === 'custom' && (
              <>
                <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <span className="text-gray-400 text-xs">a</span>
                <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </>
            )}
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="all">Todas las etapas</option>
              {Object.keys(STAGE_META).map((s) => (
                <option key={s} value={s}>{STAGE_META[s].label}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="all">Todos los estados</option>
              {Object.keys(STATUS_META).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
            <button onClick={fetchData}
              className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition">
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex-shrink-0">
            No se pudo cargar el corte: {error}. Intenta Actualizar.
          </div>
        )}

        {/* KPI strip (fixed) */}
        <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-8 gap-2 flex-shrink-0">
          <Kpi label="Órdenes" value={fmt(summary.total_orders)} sub={`${byDone ? `${fmt(summary.completed_marcadas_in_range)} marcadas completadas ${rangeWord}` : `${fmt(summary.total_marcadas)} marcadas`}${summary.avg_efficiency != null ? ` · ef. ${pct1(summary.avg_efficiency)}` : ''}`} tone="indigo" />
          <Kpi label="Planeación" value={fmt((summary.planning_orders || 0) + (summary.ready_orders || 0))}
            sub={`${fmt(summary.planning_orders)} sin marcadas`} />
          <Kpi label="En corte" value={fmt(summary.cutting_orders)} sub={`${fmt(summary.total_remaining)} pzs por cortar`} />
          <Kpi label="Por verificar" value={fmt(summary.verification_orders)} sub={`${fmt(summary.verification_quantity)} pzs esperando`} />
          <Kpi label="Terminadas" value={fmt(summary.verified_orders)} sub={`${pct(summary.verified_progress)} verificadas`} tone="teal" />
          <Kpi label="Piezas" value={fmt(summary.total_quantity)} sub={`${fmt(summary.total_cut)} cortadas · ${pct(summary.progress)}`} />
          <Kpi label="Restante" value={fmt(summary.total_remaining)}
            sub={summary.total_over > 0 ? `${fmt(summary.total_over)} excedente` : 'sin excedente'} />
          <Kpi label="Tela" value={`${fmt(summary.total_length)} m`} sub={`${fmt(summary.fabrics_count)} telas · ${fmt(summary.tallas)} tallas`} />
        </div>

        {data && summary.verification_enabled === false && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs flex-shrink-0">
            Falta la columna <code className="font-mono">verified_at</code> en <code className="font-mono">cut_orders</code>: todos los cortes terminados se muestran como «Por verificar» hasta que se agregue y alguien firme la verificación.
          </div>
        )}

        {/* Main area fills the rest; nothing below scrolls the page */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Left: 2x2 chart grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-3 min-h-0 h-[70vh] lg:h-auto">
            <Panel title="Piezas por talla" right="planeado vs cortado">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tallaChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} height={24} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip formatter={(v, n) => [fmt(v), n]} labelFormatter={(l) => `Talla ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar name="Planeado" dataKey="planned" fill="#4f46e5" radius={[5, 5, 0, 0]} />
                  <Bar name="Cortado" dataKey="cut" fill="#0891b2" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Órdenes por etapa" right="planeación → corte → verificación">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={stageChart} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={78} />
                  <Tooltip
                    formatter={(v) => [fmt(v), 'Órdenes']}
                    labelFormatter={(l) => stageMeta(stageChart.find((r) => r.name === l)?.stage).label}
                  />
                  <Bar dataKey="orders" radius={[0, 5, 5, 0]}>
                    {stageChart.map((r, i) => (
                      <Cell key={i} fill={stageMeta(r.stage).dot} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel
              title={byDone ? 'Marcadas completadas por día' : 'Corte por día'}
              right={byDone ? 'día en que se completaron' : 'planeado vs cortado'}
              className="sm:col-span-2"
            >
              <ResponsiveContainer width="100%" height="100%">
                {byDone ? (
                <BarChart data={doneChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip
                    formatter={(v, n, p) => [`${fmt(v)} · ${fmt(p.payload.pieces)} pzs · ${fmt(p.payload.orders)} órdenes`, 'Marcadas']}
                    labelFormatter={(l) => `Día ${l}`}
                  />
                  <Bar name="Marcadas completadas" dataKey="marcadas" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
                ) : (
                <BarChart data={dayChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip formatter={(v, n) => [fmt(v), n]} labelFormatter={(l) => `Día ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar name="Planeado" dataKey="quantity" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar name="Cortado" dataKey="cut" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
                )}
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Right: tabbed data panel, scrolls internally */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-[60vh] lg:h-auto">
            <div className="flex border-b border-gray-100 flex-shrink-0">
              {[
                { id: 'orders', label: 'Órdenes' },
                { id: 'tallas', label: 'Tallas' },
                { id: 'fabrics', label: 'Telas' },
                { id: 'days', label: 'Días' },
              ].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition ${
                    tab === t.id ? 'text-indigo-600 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {loading && !data ? (
                <div className="text-center text-gray-400 py-10 text-sm">Cargando…</div>
              ) : tab === 'orders' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Corte</th>
                      <th className="py-1.5 pr-2 font-medium" title={byDone ? 'Último día con marcada completada en el rango' : 'Fecha de corte planeada'}>
                        {byDone ? 'Completó' : 'Fecha'}
                      </th>
                      <th className="py-1.5 pr-2 font-medium">Tallas</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Marcadas</th>
                      <th className="py-1.5 pr-2 font-medium">Etapa</th>
                      <th className="py-1.5 font-medium text-right">Cortado</th>
                      <th className="py-1.5 pl-1 w-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.detail || []).map((row) => (
                      <tr key={row.id}
                        onClick={() => openBreakdown(row)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBreakdown(row); } }}
                        title="Ver desglose por talla"
                        className={`border-t border-gray-50 align-top cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                          selected?.id === row.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                        }`}>
                        <td className="py-1.5 pr-2">
                          <span className="text-gray-900 font-medium">{row.work_order_no}</span>
                          {row.customer_po && (
                            <span className="block text-[10px] text-gray-500">PO {row.customer_po}</span>
                          )}
                          <span className="block text-[10px] text-gray-400 max-w-[130px] truncate"
                            title={`${row.customer_name || ''}${row.fabric ? ` · ${row.fabric}` : ''}${row.fabric_code ? ` (${row.fabric_code})` : ''}${row.color ? ` · ${row.color}` : ''}`}>
                            {row.customer_name || '—'}{row.fabric ? ` · ${row.fabric}` : ''}{row.fabric_code ? ` (${row.fabric_code})` : ''}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-gray-700 whitespace-nowrap">
                          {byDone ? shortDate(row.last_completed_day) : shortDate(row.cut_date)}
                          {byDone && (
                            <span className="block text-[10px] text-gray-400" title="Fecha de corte planeada">
                              plan {shortDate(row.cut_date)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-700">
                          {row.tallas && row.tallas.length ? (
                            <span className="max-w-[120px] inline-block truncate align-top" title={row.tallas.join(', ')}>
                              {row.tallas.join(', ')}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                          {row.marcadas > 0 ? (
                            <>
                              <span className="font-semibold text-gray-900">{fmt(row.marcadas_done)}</span>
                              <span className="text-gray-400"> / {fmt(row.marcadas)}</span>
                            </>
                          ) : <span className="text-gray-300">—</span>}
                          {byDone && row.marcadas_done_in_range > 0 && (
                            <span className="block text-[10px] text-green-700 font-medium"
                              title={row.markers_done_in_range?.join(', ')}>
                              +{fmt(row.marcadas_done_in_range)} {rangeWord}
                            </span>
                          )}
                          {row.marcadas_pending > 0 && (
                            <span className="block text-[10px] text-amber-600">{fmt(row.marcadas_pending)} pendiente{row.marcadas_pending > 1 ? 's' : ''}</span>
                          )}
                          {byDone && row.efficiency_in_range != null && row.efficiency_in_range !== row.efficiency_avg && (
                            <span className="block text-[10px] text-indigo-500" title={`Eficiencia de las marcadas completadas ${rangeWord}`}>
                              ef. {rangeWord} {pct1(row.efficiency_in_range)}
                            </span>
                          )}
                          {row.efficiency_avg != null && (
                            <span
                              className="block text-[10px] text-indigo-600 font-medium"
                              title={
                                row.efficiency_min != null && row.efficiency_max != null && row.efficiency_min !== row.efficiency_max
                                  ? `Eficiencia de marcada ${pct1(row.efficiency_min)}–${pct1(row.efficiency_max)} · prom. ${pct1(row.efficiency_avg)} · ${fmt(row.efficiency_count)} con dato`
                                  : `Eficiencia de marcada ${pct1(row.efficiency_avg)} · ${fmt(row.efficiency_count)} con dato`
                              }
                            >
                              ef. {pct1(row.efficiency_avg)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <StageChip stage={row.stage} />
                          {row.stage === 'verified' && !row.verified_at && (
                            <span className="block text-[10px] text-gray-400 mt-0.5">marcadas verificadas</span>
                          )}
                          {row.verified_at && (
                            <span className="block text-[10px] text-gray-400 mt-0.5 truncate max-w-[110px]"
                              title={`Verificada ${shortDate(String(row.verified_at).slice(0, 10))}${row.verified_by ? ` por ${row.verified_by}` : ''}`}>
                              {shortDate(String(row.verified_at).slice(0, 10))}
                              {row.verified_by ? ` · ${row.verified_by}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          <span className="font-semibold text-gray-900">{fmt(row.amount_cut)}</span>
                          <span className="text-gray-400"> / {fmt(row.quantity)}</span>
                          <div className="mt-0.5 w-[86px] ml-auto"><Progress value={row.progress} /></div>
                          {byDone && row.pieces_done_in_range > 0 && (
                            <span className="block text-[10px] text-green-700 font-medium"
                              title={`Piezas de las marcadas completadas ${rangeWord}`}>
                              {fmt(row.pieces_done_in_range)} pzs {rangeWord}
                            </span>
                          )}
                          {row.over > 0 ? (
                            <span className="block text-[10px] text-amber-600 font-medium">+{fmt(row.over)} excedente</span>
                          ) : row.remaining > 0 ? (
                            <span className="block text-[10px] text-red-500">{fmt(row.remaining)} restantes</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 pl-1 text-gray-300"><ChevronRight className="w-3.5 h-3.5" /></td>
                      </tr>
                    ))}
                    {(!data?.detail || data.detail.length === 0) && (
                      <tr><td colSpan={7} className="py-8 text-center text-gray-400">
                        {search
                          ? <>Ningún corte coincide con «{search}»{!allDates && <><br />Prueba con «Todas las fechas»</>}</>
                          : byDone ? `No se completó ninguna marcada ${preset === 'today' ? 'hoy' : 'en este rango'}` : 'No hay cortes en esta selección'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'tallas' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Talla</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Planeado</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Cortado</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Restante</th>
                      <th className="py-1.5 font-medium text-right">Excedente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byTalla || []).map((r) => (
                      <tr key={r.talla} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 font-medium whitespace-nowrap">
                          {r.talla}
                          <span className="block text-[10px] text-gray-400">{fmt(r.orders)} órdenes</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-900 font-semibold">{fmt(r.planned)}</td>
                        <td className="py-1.5 pr-2 text-right text-teal-600 font-semibold">{fmt(r.cut)}</td>
                        <td className="py-1.5 pr-2 text-right font-semibold"
                          style={{ color: r.remaining <= 0 ? '#16a34a' : '#dc2626' }}>
                          {fmt(r.remaining)}
                        </td>
                        <td className="py-1.5 text-right font-semibold"
                          style={{ color: r.over > 0 ? '#d97706' : '#cbd5e1' }}>
                          {r.over > 0 ? `+${fmt(r.over)}` : '—'}
                        </td>
                      </tr>
                    ))}
                    {(!data?.byTalla || data.byTalla.length === 0) && (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">Sin tallas en el rango</td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'fabrics' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Tela</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Órdenes</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Piezas</th>
                      <th className="py-1.5 font-medium text-right">Metros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byFabric || []).map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 max-w-[130px]" title={`${r.fabric}${r.fabric_code ? ` · ${r.fabric_code}` : ''}`}>
                          <span className="block truncate">{r.fabric}</span>
                          {r.fabric_code && (
                            <span className="block text-[10px] text-gray-400 font-mono truncate">{r.fabric_code}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{fmt(r.orders)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-900 font-semibold">{fmt(r.quantity)}</td>
                        <td className="py-1.5 text-right text-teal-600 font-semibold">{fmt(r.length)}</td>
                      </tr>
                    ))}
                    {(!data?.byFabric || data.byFabric.length === 0) && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">Sin telas en el rango</td></tr>
                    )}
                  </tbody>
                </table>
              ) : byDone ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Día</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Órdenes</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Marcadas</th>
                      <th className="py-1.5 font-medium text-right">Piezas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byCompletedDay || []).slice().reverse().map((r) => (
                      <tr key={r.day} className="border-t border-gray-50 align-top">
                        <td className="py-1.5 pr-2 text-gray-800 whitespace-nowrap">{r.day}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500"
                          title={r.orders.map((o) => `${o.work_order_no || o.cut_order_id} (${o.marcadas})`).join(', ')}>
                          {fmt(r.orders.length)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-900 font-semibold">{fmt(r.marcadas)}</td>
                        <td className="py-1.5 text-right text-teal-600 font-semibold">{fmt(r.pieces)}</td>
                      </tr>
                    ))}
                    {(!data?.byCompletedDay || data.byCompletedDay.length === 0) && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">No se completaron marcadas en el rango</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Día</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Órdenes</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Planeado</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Cortado</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Restante</th>
                      <th className="py-1.5 font-medium text-right">Excedente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byDay || []).map((r) => (
                      <tr key={r.day} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 whitespace-nowrap">{r.day}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{fmt(r.orders)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-900">{fmt(r.quantity)}</td>
                        <td className="py-1.5 pr-2 text-right font-semibold"
                          style={{ color: r.cut >= r.quantity ? '#16a34a' : '#dc2626' }}>
                          {fmt(r.cut)}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-700">{fmt(r.remaining)}</td>
                        <td className="py-1.5 text-right font-semibold"
                          style={{ color: r.over > 0 ? '#d97706' : '#cbd5e1' }}>
                          {r.over > 0 ? `+${fmt(r.over)}` : '—'}
                        </td>
                      </tr>
                    ))}
                    {(!data?.byDay || data.byDay.length === 0) && (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-400">Nada cortado en el rango</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Panel lateral: desglose del corte seleccionado */}
      {selected && (
        <CutBreakdownDrawer
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
// Panel lateral con el desglose de un corte: por talla (planeado, paneles,
// cortado, restante) y por marcada (paneles × piezas por panel, tallas, si ya
// se cerró). Mismo patrón que el drawer de Almacén PT.
// ---------------------------------------------------------------------------
function CutBreakdownDrawer({ selected, breakdown, loading, error, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const o = breakdown?.order || {};
  const t = breakdown?.totals || {};
  const sizes = breakdown?.sizes || [];
  const markers = breakdown?.markers || [];
  const fabrics = breakdown?.fabrics || [];
  const stage = o.stage || selected.stage;

  const subtitle = [
    o.customer_name || selected.customer_name,
    o.style || selected.style,
    o.color || selected.color,
  ].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Desglose del corte ${selected.work_order_no}`}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-[cutslidein_.2s_ease-out] motion-reduce:animate-none">

        {/* Cabecera */}
        <div className="px-4 py-3 border-b flex items-start gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Scissors className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 flex-wrap">
              <span className="font-mono">{selected.work_order_no}</span>
              {selected.customer_po && <span className="text-gray-400 font-mono">PO {selected.customer_po}</span>}
              <StageChip stage={stage} />
            </h2>
            <p className="text-xs text-gray-500 truncate">{subtitle || '—'}</p>
            <p className="text-[11px] text-gray-400">
              Corte #{selected.id} · plan {shortDate(o.cut_date || selected.cut_date)}
              {o.verified_at && <> · verificado {shortDate(String(o.verified_at).slice(0, 10))}{o.verified_by ? ` por ${o.verified_by}` : ''}</>}
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Totales */}
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b flex-shrink-0">
          <MiniStat label="Cortado" value={fmt(t.cut ?? selected.amount_cut)}
            sub={`de ${fmt(t.planned ?? selected.quantity)} planeadas`} tone="teal" />
          <MiniStat label="Restante" value={fmt(t.remaining ?? selected.remaining)}
            sub={(t.over ?? selected.over) > 0 ? `+${fmt(t.over ?? selected.over)} excedente` : 'sin excedente'}
            tone={(t.remaining ?? selected.remaining) > 0 ? 'amber' : 'gray'} />
          <MiniStat label="Paneles" value={fmt(t.panels ?? selected.panels)}
            sub={t.marcadas ? `${fmt(t.panels_done)} en marcadas cerradas` : 'sin marcadas'} tone="indigo" />
          <MiniStat label="Marcadas" value={`${fmt(t.marcadas_done ?? selected.marcadas_done)} / ${fmt(t.marcadas ?? selected.marcadas)}`}
            sub={t.efficiency_avg != null ? `ef. ${pct1(t.efficiency_avg)}` : 'cerradas'} tone="gray" />
        </div>

        <div className="px-4 py-2 border-b flex-shrink-0">
          <Progress value={t.progress ?? selected.progress} />
        </div>

        {/* Telas */}
        {fabrics.length > 0 && (
          <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap flex-shrink-0">
            <span className="text-[11px] text-gray-400 mr-1">Telas</span>
            {fabrics.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-gray-100 bg-gray-50 px-2 py-1">
                <span className="font-medium text-gray-700">{f.name || '—'}</span>
                {f.code && <span className="text-gray-400 font-mono">{f.code}</span>}
                {f.total_length != null && <span className="text-gray-900">{fmt(f.total_length)} m</span>}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-12 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando desglose…
            </div>
          ) : error ? (
            <div className="m-4 p-3 rounded-lg bg-amber-50 text-amber-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> No se pudo cargar el desglose: {error}
            </div>
          ) : (
            <>
              {/* Por talla */}
              <div className="px-4 pt-3 pb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-bold text-gray-800">Por talla</h3>
                {t.cut_source === 'markers' && (
                  <span className="text-[10px] text-gray-400">cortado = piezas de marcadas cerradas</span>
                )}
              </div>
              {sizes.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">Este corte todavía no tiene tallas.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white z-10">
                    <tr className="border-b">
                      <th className="py-2 px-4 font-medium">Talla</th>
                      <th className="py-2 px-2 font-medium text-right">Planeado</th>
                      <th className="py-2 px-2 font-medium text-right" title="Paneles de las marcadas que llevan esta talla">Paneles</th>
                      <th className="py-2 px-2 font-medium text-right">Cortado</th>
                      <th className="py-2 px-2 font-medium text-right">Restante</th>
                      <th className="py-2 pl-2 pr-4 font-medium">Avance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sizes.map((s) => (
                      <tr key={s.talla} className="align-top">
                        <td className="py-2 px-4">
                          <span className="font-semibold text-gray-900">{s.talla}</span>
                          {s.markers > 0 && (
                            <span className="block text-[10px] text-gray-400">{s.markers} marcada{s.markers > 1 ? 's' : ''}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right text-gray-600">
                          {fmt(s.planned)}
                          {s.marker_pieces > 0 && s.marker_pieces !== s.planned && (
                            <span className="block text-[10px] text-gray-400" title="Piezas que suman las marcadas de esta talla">
                              {fmt(s.marker_pieces)} en marcadas
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <span className="font-semibold text-gray-900">{fmt(s.panels)}</span>
                          {s.panels_done > 0 && s.panels_done !== s.panels && (
                            <span className="block text-[10px] text-green-700">{fmt(s.panels_done)} cerrados</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right">
                          <span className="font-semibold text-teal-700">{fmt(s.cut)}</span>
                          {s.over > 0 && <span className="block text-[10px] text-amber-600">+{fmt(s.over)} excedente</span>}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold" style={{ color: s.remaining > 0 ? '#dc2626' : '#16a34a' }}>
                          {fmt(s.remaining)}
                        </td>
                        <td className="py-2 pl-2 pr-4"><div className="w-[92px]"><Progress value={s.progress} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-gray-50/60 font-semibold text-gray-900">
                      <td className="py-2 px-4">Total</td>
                      <td className="py-2 px-2 text-right">{fmt(t.planned)}</td>
                      <td className="py-2 px-2 text-right" title="Paneles totales del corte (un panel sirve a varias tallas)">{fmt(t.panels)}</td>
                      <td className="py-2 px-2 text-right text-teal-700">{fmt(t.cut)}</td>
                      <td className="py-2 px-2 text-right">{fmt(t.remaining)}</td>
                      <td className="py-2 pl-2 pr-4"><div className="w-[92px]"><Progress value={t.progress} /></div></td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* Por marcada */}
              <div className="px-4 pt-4 pb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-gray-400" /> Marcadas
                </h3>
                {markers.length > 0 && (
                  <span className="text-[10px] text-gray-400">{fmt(t.marker_pieces)} piezas en {markers.length} marcada{markers.length > 1 ? 's' : ''}</span>
                )}
              </div>
              {markers.length === 0 ? (
                <div className="text-center text-gray-400 py-6 text-sm px-4">
                  El planner aún no arma las marcadas de este corte.
                </div>
              ) : (
                <ul className="px-4 pb-4 space-y-2">
                  {markers.map((m) => (
                    <li key={m.index} className={`rounded-lg border px-3 py-2 ${m.done ? 'border-green-100 bg-green-50/40' : 'border-gray-100'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                            {m.done
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" aria-label="Cerrada" />
                              : <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" aria-label="Pendiente" />}
                            <span className="truncate">{m.name}</span>
                          </p>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            {m.done
                              ? (m.completed_day ? `Cerrada ${shortDate(m.completed_day)}` : 'Cerrada')
                              : 'Pendiente'}
                            {m.efficiency != null && ` · ef. ${pct1(m.efficiency)}`}
                            {m.length != null && ` · ${fmt(m.length)} m`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-900">
                            <span className="font-semibold">{fmt(m.panels)}</span>
                            <span className="text-gray-400"> paneles × {fmt(m.pieces_per_panel)}</span>
                          </p>
                          <p className="text-[11px] font-semibold text-teal-700">{fmt(m.pieces)} pzs</p>
                        </div>
                      </div>
                      {m.lines.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.lines.map((l, i) => (
                            <span key={`${l.talla}-${i}`}
                              title={`${l.perPanel} por panel × ${m.panels} paneles`}
                              className="inline-flex items-center gap-1 text-[10px] rounded-md border border-gray-100 bg-white px-1.5 py-0.5">
                              <span className="font-medium text-gray-700">{l.talla}</span>
                              <span className="text-gray-400">×{fmt(l.perPanel)}</span>
                              <span className="text-gray-900">{fmt(l.pieces)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {(o.verification_notes || o.notes) && (
                <div className="px-4 pb-4 space-y-1 text-[11px] text-gray-500">
                  {o.verification_notes && <p><span className="text-gray-700 font-medium">Verificación:</span> {o.verification_notes}</p>}
                  {o.notes && <p><span className="text-gray-700 font-medium">Notas:</span> {o.notes}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <style>{`@keyframes cutslidein { from { transform: translateX(24px); opacity: .6 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>
  );
}

function MiniStat({ label, value, sub, tone = 'gray' }) {
  const tones = {
    teal: 'text-teal-700 bg-teal-50',
    indigo: 'text-indigo-700 bg-indigo-50',
    amber: 'text-amber-700 bg-amber-50',
    gray: 'text-gray-700 bg-gray-100',
  };
  return (
    <div className={`rounded-lg px-2 py-1.5 ${tones[tone] || tones.gray}`}>
      <p className="text-[10px] uppercase tracking-wide leading-none opacity-80">{label}</p>
      <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[10px] leading-tight opacity-70">{sub}</p>}
    </div>
  );
}