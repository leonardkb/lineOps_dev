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

import NavCeo from '../../components/NavCeo';

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};

const pct = (v) => `${Math.round(Number(v) || 0)}%`;

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
  const [tab, setTab] = useState('orders'); // orders | tallas | fabrics | days

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const fetchData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (stageFilter !== 'all') params.append('stage', stageFilter);
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
  }, [startDate, endDate, statusFilter, stageFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = data?.summary || {};
  const rangeLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

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
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
          <Kpi label="Órdenes" value={fmt(summary.total_orders)} sub={`${fmt(summary.total_marcadas)} marcadas`} tone="indigo" />
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

            <Panel title="Corte por día" right="planeado vs cortado" className="sm:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip formatter={(v, n) => [fmt(v), n]} labelFormatter={(l) => `Día ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar name="Planeado" dataKey="quantity" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar name="Cortado" dataKey="cut" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
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
                      <th className="py-1.5 pr-2 font-medium">Fecha</th>
                      <th className="py-1.5 pr-2 font-medium">Tallas</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Marcadas</th>
                      <th className="py-1.5 pr-2 font-medium">Etapa</th>
                      <th className="py-1.5 font-medium text-right">Cortado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.detail || []).map((row) => (
                      <tr key={row.id} className="border-t border-gray-50 align-top">
                        <td className="py-1.5 pr-2">
                          <span className="text-gray-900 font-medium">{row.work_order_no}</span>
                          <span className="block text-[10px] text-gray-400 max-w-[130px] truncate"
                            title={`${row.customer_name || ''}${row.fabric ? ` · ${row.fabric}` : ''}${row.fabric_code ? ` (${row.fabric_code})` : ''}${row.color ? ` · ${row.color}` : ''}`}>
                            {row.customer_name || '—'}{row.fabric ? ` · ${row.fabric}` : ''}{row.fabric_code ? ` (${row.fabric_code})` : ''}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-gray-700 whitespace-nowrap">{shortDate(row.cut_date)}</td>
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
                          {row.over > 0 ? (
                            <span className="block text-[10px] text-amber-600 font-medium">+{fmt(row.over)} excedente</span>
                          ) : row.remaining > 0 ? (
                            <span className="block text-[10px] text-red-500">{fmt(row.remaining)} restantes</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {(!data?.detail || data.detail.length === 0) && (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-400">No hay cortes en esta selección</td></tr>
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
    </div>
  );
}