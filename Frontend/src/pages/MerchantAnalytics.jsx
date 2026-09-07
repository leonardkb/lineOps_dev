// MerchantAnalytics.jsx - merchant PO monitoring dashboard (single-screen / no page scroll)
// Twin of QualityAnalytics.jsx, reading /api/merchant/analytics. Answers four
// questions on one screen: who raised the PO, which week (semana) it belongs to,
// which day the planner dropped it on, and how many pieces are actually sewn
// against its status. Same layout contract as the quality board: compact header
// + KPI strip stay fixed, the chart grid fills the remaining height, and the
// tables live in one tabbed side panel that scrolls internally.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import NavCeo from '../components/NavCeo';


const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};

const pct = (v) => `${Math.round(Number(v) || 0)}%`;

// Green once the order is running to plan, red while it's barely started.
const progressColor = (p) => {
  if (p >= 100) return '#16a34a';
  if (p >= 75) return '#65a30d';
  if (p >= 40) return '#f59e0b';
  if (p > 0) return '#f97316';
  return '#94a3b8';
};

const MERCHANT_PALETTE = ['#4f46e5', '#0891b2', '#7c3aed', '#2563eb', '#c026d3', '#0d9488', '#db2777', '#ea580c', '#65a30d', '#ca8a04'];

const STATUS_META = {
  pending:     { label: 'Pendiente',  chip: 'bg-slate-100 text-slate-700',   dot: '#94a3b8' },
  assigned:    { label: 'Asignada',   chip: 'bg-blue-100 text-blue-700',     dot: '#2563eb' },
  in_progress: { label: 'En proceso', chip: 'bg-amber-100 text-amber-700',   dot: '#f59e0b' },
  completed:   { label: 'Terminada',  chip: 'bg-green-100 text-green-700',   dot: '#16a34a' },
  cancelled:   { label: 'Cancelada',  chip: 'bg-red-100 text-red-600',       dot: '#dc2626' },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || '—', chip: 'bg-gray-100 text-gray-600', dot: '#94a3b8' };

const todayStr = () => new Date().toISOString().split('T')[0];
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};
// "2026-08-10" -> "10/08". Weeks read as their Monday, days as themselves.
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

function StatusChip({ status }) {
  const m = statusMeta(status);
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${m.chip}`}>{m.label}</span>;
}

// Thin progress bar used in the orders table: produced against what the PO owes.
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

export default function MerchantAnalytics() {
  const navigate = useNavigate();
  const [, setUser] = useState(null);

  const [preset, setPreset] = useState('last30');
  const [startDate, setStartDate] = useState(addDays(todayStr(), -29));
  const [endDate, setEndDate] = useState(todayStr());
  const [merchantFilter, setMerchantFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [weekBasis, setWeekBasis] = useState('plan');
  const [tab, setTab] = useState('orders'); // orders | merchants | weeks | days

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
      const params = new URLSearchParams({ startDate, endDate, weekBasis });
      if (merchantFilter !== 'all') params.append('merchant', merchantFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      const res = await axios.get(`http://localhost:5000/api/merchant/analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setData(res.data);
      else setError(res.data.error || 'Could not load merchant data.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, merchantFilter, statusFilter, weekBasis]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = data?.summary || {};
  const rangeLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

  // The merchant list is filtered server-side, so keep the last full list around
  // or the dropdown collapses to the one merchant you just selected.
  const [merchantOptions, setMerchantOptions] = useState([]);
  useEffect(() => {
    if (merchantFilter === 'all' && statusFilter === 'all' && data?.byMerchant) {
      setMerchantOptions(data.byMerchant.map((m) => ({ id: m.merchant_id, name: m.merchant })));
    }
  }, [data, merchantFilter, statusFilter]);

  const merchantChart = useMemo(
    () => (data?.byMerchant || []).slice(0, 8).map((m) => ({
      name: m.merchant,
      pos: m.pos,
      pieces: m.pieces,
      produced: m.produced,
    })),
    [data]
  );

  const weekChart = useMemo(
    () => (data?.byWeek || []).map((w) => ({
      name: shortDate(w.week_start),
      week_start: w.week_start,
      pieces: w.pieces,
      produced: w.produced,
      pos: w.pos,
    })),
    [data]
  );

  const dayChart = useMemo(
    () => (data?.byDay || []).map((d) => ({
      name: shortDate(d.day),
      day: d.day,
      assigned: d.assigned,
      produced: d.produced,
      lines: d.lines,
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
                Merchant Monitor
              </span>
              <span className="text-[11px] font-normal text-gray-600">
                {rangeLabel}
                {statusFilter !== 'all' && <> · {statusMeta(statusFilter).label}</>}
                {weekBasis === 'created' && <> · semana de captura</>}
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={preset} onChange={(e) => setPreset(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="last90">Last 90 days</option>
              <option value="year">This year</option>
              <option value="custom">Custom</option>
            </select>
            {preset === 'custom' && (
              <>
                <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <span className="text-gray-400 text-xs">to</span>
                <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </>
            )}
            <select value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[170px]">
              <option value="all">All merchants</option>
              {merchantOptions.map((m) => (
                <option key={m.id ?? 'none'} value={m.id ?? 'none'}>{m.name}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="all">All statuses</option>
              {Object.keys(STATUS_META).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
            <select value={weekBasis} onChange={(e) => setWeekBasis(e.target.value)}
              title="Which week a PO counts in"
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="plan">Semana planeada</option>
              <option value="created">Semana de captura</option>
            </select>
            <button onClick={fetchData}
              className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition">
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex-shrink-0">
            Couldn't load merchant data: {error}. Try Refresh.
          </div>
        )}

        {/* KPI strip (fixed) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 flex-shrink-0">
          <Kpi label="POs" value={fmt(summary.total_pos)} sub={`${fmt(summary.merchants)} merchants`} tone="indigo" />
          <Kpi label="Piezas" value={fmt(summary.total_pieces)} sub={`${fmt(summary.weeks)} semanas`} />
          <Kpi label="Producido" value={fmt(summary.produced_pieces)} sub={pct(summary.progress)} tone="teal" />
          <Kpi label="Por producir" value={fmt(summary.open_pieces)} sub="órdenes abiertas" />
          <Kpi label="Sin asignar" value={fmt(summary.unassigned_pos)} sub={`${fmt(summary.assigned_pos)} en línea`} />
          <Kpi label="Terminadas" value={fmt(summary.completed_pos)} sub={`${fmt(summary.planned_pos)} en tablero`} />
        </div>

        {/* Main area fills the rest; nothing below scrolls the page */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Left: 2x2 chart grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-3 min-h-0 h-[70vh] lg:h-auto">
            <Panel title="POs por merchant" right="top 8">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={merchantChart} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={95} />
                  <Tooltip formatter={(v, n) => [fmt(v), n === 'pos' ? 'POs' : n]} />
                  <Bar dataKey="pos" radius={[0, 5, 5, 0]}>
                    {merchantChart.map((_, i) => (
                      <Cell key={i} fill={MERCHANT_PALETTE[i % MERCHANT_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Piezas por semana" right={weekBasis === 'plan' ? 'semana planeada' : 'semana de captura'}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={36} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip
                    formatter={(v, n) => [fmt(v), n === 'pieces' ? 'Piezas' : 'Producido']}
                    labelFormatter={(l) => `Semana ${l}`}
                  />
                  <Bar dataKey="pieces" fill="#4f46e5" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="produced" fill="#0891b2" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Asignado vs producido por día" right="planeación diaria" className="sm:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayChart} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" height={28} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={34} />
                  <Tooltip
                    formatter={(v, n) => [fmt(v), n === 'assigned' ? 'Asignado' : 'Producido']}
                    labelFormatter={(l) => `Día ${l}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar name="Asignado" dataKey="assigned" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar name="Producido" dataKey="produced" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Right: tabbed data panel, scrolls internally */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-[60vh] lg:h-auto">
            <div className="flex border-b border-gray-100 flex-shrink-0">
              {[
                { id: 'orders', label: 'Órdenes' },
                { id: 'merchants', label: 'Merchants' },
                { id: 'weeks', label: 'Semanas' },
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
                <div className="text-center text-gray-400 py-10 text-sm">Loading…</div>
              ) : tab === 'orders' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">PO</th>
                      <th className="py-1.5 pr-2 font-medium">Merchant</th>
                      <th className="py-1.5 pr-2 font-medium">Semana</th>
                      <th className="py-1.5 pr-2 font-medium">Día / línea</th>
                      <th className="py-1.5 pr-2 font-medium">Estado</th>
                      <th className="py-1.5 font-medium text-right">Prod.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.detail || []).map((row) => (
                      <tr key={row.id} className="border-t border-gray-50 align-top">
                        <td className="py-1.5 pr-2">
                          <span className="text-gray-900 font-medium">{row.work_order_no}</span>
                          <span className="block text-[10px] text-gray-400 max-w-[110px] truncate"
                            title={`${row.customer_name || ''} ${row.customer_po ? `· PO ${row.customer_po}` : ''}`}>
                            {row.customer_name || '—'}{row.customer_po ? ` · ${row.customer_po}` : ''}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-gray-600 max-w-[80px] truncate" title={row.merchant}>
                          {row.merchant}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-700 whitespace-nowrap">
                          {shortDate(row.week)}
                          {!row.planned && <span className="block text-[10px] text-amber-500">sin tablero</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-700 whitespace-nowrap">
                          {row.first_assigned_day ? (
                            <>
                              {shortDate(row.first_assigned_day)}
                              <span className="block text-[10px] text-gray-400">
                                L{row.assigned_lines || '—'}{row.assigned_days > 1 ? ` · ${row.assigned_days}d` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-amber-500">sin asignar</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2"><StatusChip status={row.status} /></td>
                        <td className="py-1.5 text-right">
                          <span className="font-semibold text-gray-900">{fmt(row.produced_quantity)}</span>
                          <span className="text-gray-400"> / {fmt(row.target_quantity)}</span>
                          <div className="mt-0.5 w-[86px] ml-auto"><Progress value={row.progress} /></div>
                        </td>
                      </tr>
                    ))}
                    {(!data?.detail || data.detail.length === 0) && (
                      <tr><td colSpan={6} className="py-8 text-center text-gray-400">No POs for this selection</td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'merchants' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Merchant</th>
                      <th className="py-1.5 pr-2 font-medium text-right">POs</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Piezas</th>
                      <th className="py-1.5 font-medium text-right">Prod.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byMerchant || []).map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800">
                          {r.merchant}
                          <span className="block text-[10px] text-gray-400">
                            {fmt(r.assigned)} en línea · {fmt(r.completed)} terminadas
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{fmt(r.pos)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-900 font-semibold">{fmt(r.pieces)}</td>
                        <td className="py-1.5 text-right text-teal-600 font-semibold">{fmt(r.produced)}</td>
                      </tr>
                    ))}
                    {(!data?.byMerchant || data.byMerchant.length === 0) && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">No merchants in range</td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'weeks' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Semana</th>
                      <th className="py-1.5 pr-2 font-medium text-right">POs</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Piezas</th>
                      <th className="py-1.5 font-medium text-right">Prod.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byWeek || []).map((r) => (
                      <tr key={r.week_start} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 whitespace-nowrap">
                          {r.week_start}
                          <span className="block text-[10px] text-gray-400">{fmt(r.merchants)} merchants</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{fmt(r.pos)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-900 font-semibold">{fmt(r.pieces)}</td>
                        <td className="py-1.5 text-right text-teal-600 font-semibold">{fmt(r.produced)}</td>
                      </tr>
                    ))}
                    {(!data?.byWeek || data.byWeek.length === 0) && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">No weeks in range</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Día</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Asig.</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Prod.</th>
                      <th className="py-1.5 font-medium text-right">Líneas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byDay || []).map((r) => (
                      <tr key={r.day} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 whitespace-nowrap">
                          {r.day}
                          <span className="block text-[10px] text-gray-400">{fmt(r.orders)} POs</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-900">{fmt(r.assigned)}</td>
                        <td className="py-1.5 pr-2 text-right font-semibold"
                          style={{ color: r.produced >= r.assigned ? '#16a34a' : '#dc2626' }}>
                          {fmt(r.produced)}
                        </td>
                        <td className="py-1.5 text-right text-gray-500">{fmt(r.lines)}</td>
                      </tr>
                    ))}
                    {(!data?.byDay || data.byDay.length === 0) && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">Nothing assigned in range</td></tr>
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