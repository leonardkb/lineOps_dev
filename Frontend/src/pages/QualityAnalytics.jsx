// QualityAnalytics.jsx - CEO quality monitoring dashboard (single-screen / no page scroll)
// Reads the quality_inspections table via /api/quality/analytics. The layout fills
// the viewport: a compact header + KPI strip stay fixed, the chart grid fills the
// remaining height, and the records/reasons/inspectors data lives in one tabbed
// side panel that scrolls internally — so the page itself never scrolls on desktop.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts';

import NavCeo from '../components/NavCeo';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};

// Severity scale for line bars: green when low, red for the worst offender.
const severityColor = (value, max) => {
  if (!max) return '#22c55e';
  const r = value / max;
  if (r >= 0.8) return '#dc2626';
  if (r >= 0.5) return '#f97316';
  if (r >= 0.25) return '#f59e0b';
  return '#22c55e';
};

const TYPE_PALETTE = ['#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777'];

const todayStr = () => new Date().toISOString().split('T')[0];
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

function Kpi({ label, value, sub, tone = 'gray' }) {
  const tones = {
    red: 'bg-gradient-to-br from-red-500 to-rose-600 text-white',
    amber: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white',
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

// A chart panel that fills the height it's given.
function Panel({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col min-h-0 ${className}`}>
      <h3 className="text-xs font-bold text-gray-800 mb-1 flex-shrink-0">{title}</h3>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export default function QualityAnalytics() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const [preset, setPreset] = useState('today');
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [lineFilter, setLineFilter] = useState('all');
  const [styleFilter, setStyleFilter] = useState('all');
  const [tab, setTab] = useState('records'); // records | reasons | inspectors

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/'); return; }
    axios.get(`${API_BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
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
    else if (preset === 'yesterday') { const y = addDays(t, -1); setStartDate(y); setEndDate(y); }
    else if (preset === 'last7') { setStartDate(addDays(t, -6)); setEndDate(t); }
    else if (preset === 'last30') { setStartDate(addDays(t, -29)); setEndDate(t); }
  }, [preset]);

  const fetchData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (lineFilter !== 'all') params.append('line', lineFilter);
      if (styleFilter !== 'all') params.append('style', styleFilter);
      const res = await axios.get(`${API_BASE}/api/quality/analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setData(res.data);
      else setError(res.data.error || 'Could not load quality data.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, lineFilter, styleFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lineOptions = useMemo(() => (data?.byLine || []).map((r) => r.line_no), [data]);
  const styleOptions = useMemo(
    () => (data?.byStyle || []).map((r) => r.style).filter((s) => s && s !== 'Sin estilo'),
    [data]
  );
  // Recharts forwards each datum's own fields onto the SVG bar, so a field named
  // `style` (a string) collides with the element's style prop. Remap to `name`.
  const styleChartData = useMemo(
    () => (data?.byStyle || []).slice(0, 10).map((r) => ({ name: r.style, total_defects: r.total_defects })),
    [data]
  );

  const summary = data?.summary || {};
  const maxLineDefects = useMemo(
    () => Math.max(0, ...(data?.byLine || []).map((r) => r.total_defects)),
    [data]
  );
  const rangeLabel = startDate === endDate ? startDate : `${startDate} → ${endDate}`;

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 to-gray-100">
      <NavCeo />

      <div className="flex-1 min-h-0 flex flex-col max-w-[1600px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 gap-3">

        {/* Header + filters (compact, fixed) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-shrink-0">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
              <span className="bg-gradient-to-r from-red-600 to-orange-500 bg-clip-text text-transparent">
                Quality Monitor
              </span>
              <span className="text-[11px] font-normal text-gray-600">
                {rangeLabel}
                {lineFilter !== 'all' && <> · Line {lineFilter}</>}
                {styleFilter !== 'all' && <> · {styleFilter}</>}
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={preset} onChange={(e) => setPreset(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
            {preset === 'custom' && (
              <>
                <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500" />
                <span className="text-gray-400 text-xs">to</span>
                <input type="date" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500" />
              </>
            )}
            <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500">
              <option value="all">All lines</option>
              {lineOptions.map((l) => <option key={l} value={l}>Line {l}</option>)}
            </select>
            <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 max-w-[150px]">
              <option value="all">All styles</option>
              {styleOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={fetchData}
              className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition">
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex-shrink-0">
            Couldn't load quality data: {error}. Try Refresh.
          </div>
        )}

        {/* KPI strip (fixed) */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 flex-shrink-0">
          <Kpi label="Total defects" value={fmt(summary.total_defects)} sub={`${fmt(summary.total_inspections)} insp.`} tone="red" />
          <Kpi label="Lines" value={fmt(summary.active_lines)} />
          <Kpi label="Styles" value={fmt(summary.active_styles)} />
          <Kpi label="Inspectors" value={fmt(summary.active_inspectors)} />
          <Kpi label="Inspections" value={fmt(summary.total_inspections)} />
        </div>

        {/* Main area fills the rest; nothing below scrolls the page */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Left: 2x2 chart grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-3 min-h-0 h-[70vh] lg:h-auto">
            <Panel title="Defects by line">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.byLine || []} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="line_no" tickFormatter={(v) => `L${v}`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip formatter={(v) => [fmt(v), 'Defects']} labelFormatter={(l) => `Line ${l}`} />
                  <Bar dataKey="total_defects" radius={[5, 5, 0, 0]}>
                    {(data?.byLine || []).map((entry, i) => (
                      <Cell key={i} fill={severityColor(entry.total_defects, maxLineDefects)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Top defect types">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={(data?.byType || []).slice(0, 6)} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="defect_name" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip formatter={(v) => [fmt(v), 'Defects']} />
                  <Bar dataKey="total_defects" radius={[0, 5, 5, 0]}>
                    {(data?.byType || []).slice(0, 6).map((_, i) => (
                      <Cell key={i} fill={TYPE_PALETTE[i % TYPE_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Defects by style" className="sm:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={styleChartData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip formatter={(v) => [fmt(v), 'Defects']} />
                  <Bar dataKey="total_defects" fill="#7c3aed" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Right: tabbed data panel, scrolls internally */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 h-[60vh] lg:h-auto">
            <div className="flex border-b border-gray-100 flex-shrink-0">
              {[
                { id: 'records', label: 'Records' },
                { id: 'reasons', label: 'Reasons' },
                { id: 'inspectors', label: 'Inspectors' },
              ].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition ${
                    tab === t.id ? 'text-red-600 border-b-2 border-red-500' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {loading && !data ? (
                <div className="text-center text-gray-400 py-10 text-sm">Loading…</div>
              ) : tab === 'records' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Time</th>
                      <th className="py-1.5 pr-2 font-medium">Line</th>
                      <th className="py-1.5 pr-2 font-medium">Style</th>
                      <th className="py-1.5 pr-2 font-medium">Inspector</th>
                      <th className="py-1.5 font-medium text-right">Def.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.detail || []).map((row) => (
                      <tr key={row.id} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{row.time}</td>
                        <td className="py-1.5 pr-2 text-gray-800">L{row.line_no}</td>
                        <td className="py-1.5 pr-2 text-gray-800 max-w-[80px] truncate" title={row.style || ''}>{row.style || '—'}</td>
                        <td className="py-1.5 pr-2 text-gray-600 max-w-[90px] truncate" title={row.inspector_name}>{row.inspector_name}</td>
                        <td className="py-1.5 text-right font-semibold text-red-600">{fmt(row.total_defects)}</td>
                      </tr>
                    ))}
                    {(!data?.detail || data.detail.length === 0) && (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">No records for this selection</td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'reasons' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Reason</th>
                      <th className="py-1.5 font-medium text-right">Def.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byReason || []).map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800">
                          {r.reason_code} · {r.reason_description}
                          <span className="block text-[10px] text-gray-400">{r.defect_name}</span>
                        </td>
                        <td className="py-1.5 text-right font-semibold text-gray-900 align-top">{fmt(r.total_defects)}</td>
                      </tr>
                    ))}
                    {(!data?.byReason || data.byReason.length === 0) && (
                      <tr><td colSpan={2} className="py-8 text-center text-gray-400">No reasons recorded</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Inspector</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Insp.</th>
                      <th className="py-1.5 font-medium text-right">Def.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.byInspector || []).map((r, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800">{r.inspector_name}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{fmt(r.inspections)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{fmt(r.total_defects)}</td>
                      </tr>
                    ))}
                    {(!data?.byInspector || data.byInspector.length === 0) && (
                      <tr><td colSpan={3} className="py-8 text-center text-gray-400">No inspections</td></tr>
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