// MechanicsDashboard.jsx - CEO mechanics & bonus dashboard (single-screen / no page scroll)
// Reads GET /api/mechanics-summary on the VMware backend, which merges the AWS
// /rh/bonos/semana + /supervisor/dashboard/stats. Layout mirrors QualityAnalytics:
// a compact header + KPI strip stay fixed, a chart grid fills the remaining height,
// and the per-mechanic / bonus / location data lives in one tabbed side panel that
// scrolls internally — so the page itself never scrolls on desktop.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts';

import NavCeo from '../components/NavCeo';

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ---- formatters ---------------------------------------------------------

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const mxnCompact = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Bonus scale: more is better, so high = strong green, low = muted.
const bonusColor = (value, max) => {
  if (!max) return '#94a3b8';
  const r = value / max;
  if (r >= 0.8) return '#059669'; // emerald-600
  if (r >= 0.5) return '#10b981'; // emerald-500
  if (r >= 0.25) return '#34d399'; // emerald-400
  return '#a7c5bd'; // muted
};

const EARNER_PALETTE = ['#4f46e5', '#6366f1', '#7c3aed', '#8b5cf6', '#a855f7', '#c084fc'];

// Close time: less is better, so fast = green, slow = red.
const timeColor = (minutes, max) => {
  if (!max) return '#94a3b8';
  const r = minutes / max;
  if (r >= 0.8) return '#dc2626'; // red-600
  if (r >= 0.5) return '#f97316'; // orange-500
  if (r >= 0.25) return '#f59e0b'; // amber-500
  return '#22c55e'; // green-500
};

// ---- week helpers -------------------------------------------------------

function weekMonday(ref = new Date()) {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function recentMondays(n = 8) {
  const base = new Date(`${weekMonday()}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    return d.toISOString().slice(0, 10);
  });
}
function prettyWeek(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// ---- small pieces -------------------------------------------------------

function Kpi({ label, value, sub, tone = 'gray' }) {
  const tones = {
    emerald: 'bg-gradient-to-br from-emerald-500 to-green-600 text-white',
    indigo: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    gray: 'bg-white text-gray-900 border border-gray-200',
  };
  const grad = tone !== 'gray';
  return (
    <div className={`rounded-xl shadow-sm px-3 py-2 flex flex-col justify-center ${tones[tone]}`}>
      <p className={`text-[10px] font-medium uppercase tracking-wide leading-none ${grad ? 'text-white/80' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className="text-xl xl:text-2xl font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className={`text-[10px] leading-none mt-0.5 ${grad ? 'text-white/80' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

function Panel({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col min-h-0 ${className}`}>
      <h3 className="text-xs font-bold text-gray-800 mb-1 flex-shrink-0">{title}</h3>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

const LOCATION_STYLES = {
  piso: 'bg-emerald-100 text-emerald-700',
  taller: 'bg-amber-100 text-amber-700',
  muestras: 'bg-purple-100 text-purple-700',
};
function LocationBadge({ value }) {
  const key = (value || '').toLowerCase();
  const cls = LOCATION_STYLES[key] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${cls}`}>
      {value || '—'}
    </span>
  );
}

// ---- page ---------------------------------------------------------------

export default function MechanicsDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const weeks = useMemo(() => recentMondays(8), []);
  const [semana, setSemana] = useState(weeks[0]);
  const [tab, setTab] = useState('mecanicos'); // mecanicos | bonos | ubicaciones

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Auth gate (same pattern as QualityAnalytics)
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

  const fetchData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/mechanics-summary?semana=${semana}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setData(res.data);
      else setError(res.data.error || 'No se pudieron cargar los datos.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [semana]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const g = data?.global || {};
  const mechanics = data?.mechanics || [];

  const maxBonus = useMemo(
    () => Math.max(0, ...mechanics.map((m) => m.bonusMxn || 0)),
    [mechanics]
  );

  // Chart-friendly shapes (remap name to avoid Recharts prop collisions).
  const byMechanic = useMemo(
    () => mechanics.map((m) => ({
      name: m.name,
      bono: m.bonusMxn || 0,
      asignados: m.ticketsAssigned || 0,
      cerrados: m.ticketsClosed || 0,
    })),
    [mechanics]
  );
  const topEarners = useMemo(
    () => [...byMechanic].sort((a, b) => b.bono - a.bono).slice(0, 6),
    [byMechanic]
  );

  // Per-location aggregation for the Ubicaciones tab.
  const byLocation = useMemo(() => {
    const acc = {};
    for (const m of mechanics) {
      const k = m.location || '—';
      if (!acc[k]) acc[k] = { location: k, count: 0, asignados: 0, cerrados: 0, bono: 0 };
      acc[k].count += 1;
      acc[k].asignados += m.ticketsAssigned || 0;
      acc[k].cerrados += m.ticketsClosed || 0;
      acc[k].bono += m.bonusMxn || 0;
    }
    return Object.values(acc);
  }, [mechanics]);

  // Per-mechanic close time (all-time avg), sorted fastest first.
  const closeTimes = useMemo(
    () => mechanics
      .filter((m) => m.avgCloseMinutes != null && m.avgCloseMinutes > 0)
      .map((m) => ({ id: m.id, name: m.name, minutes: m.avgCloseMinutes, delayed: m.delayedTickets }))
      .sort((a, b) => a.minutes - b.minutes),
    [mechanics]
  );
  const maxCloseMinutes = useMemo(
    () => Math.max(1, ...closeTimes.map((m) => m.minutes || 0)),
    [closeTimes]
  );

  return (
    <div className="lg:h-screen lg:overflow-hidden flex flex-col bg-gradient-to-br from-slate-50 to-gray-100">
      <NavCeo />

      <div className="flex-1 min-h-0 flex flex-col max-w-[1600px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 gap-3">

        {/* Header + week picker (compact, fixed) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 flex-shrink-0">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
              <span className="bg-gradient-to-r from-indigo-600 to-emerald-500 bg-clip-text text-transparent">
                Mecánicos &amp; Bonos
              </span>
              <span className="text-[11px] font-normal text-gray-600">
                Semana del {prettyWeek(semana)}
              </span>
              {data?.weekBonoClosed && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  Cerrada
                </span>
              )}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={semana} onChange={(e) => setSemana(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {weeks.map((w) => <option key={w} value={w}>{prettyWeek(w)}</option>)}
            </select>
            <button onClick={fetchData}
              className="bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition">
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex-shrink-0">
            No se pudieron cargar los datos: {error}. Intenta Actualizar.
          </div>
        )}

        {/* KPI strip (fixed) */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 flex-shrink-0">
          <Kpi label="Bono total (todos)" value={mxnCompact.format(g.totalBonusAllMechanics || 0)} sub={`${fmt(mechanics.length)} mecánicos`} tone="emerald" />
          <Kpi label="Tickets creados" value={fmt(g.ticketsCreated)} tone="indigo" />
          <Kpi label="Tickets cerrados" value={fmt(g.ticketsClosed)} />
          <Kpi label="Activos" value={fmt(g.activeTickets)} sub={`${fmt(g.pendingValidation)} por validar`} />
          <Kpi label="Tiempo prom. cierre" value={g.avgClosingMinutes != null ? `${fmt(g.avgClosingMinutes)} min` : '—'} />
        </div>

        {/* Main area fills the rest; nothing below scrolls the page */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Left: 2x2 chart grid */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 grid-rows-2 gap-3 min-h-0 h-[70vh] lg:h-auto">
            <Panel title="Bono por mecánico">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMechanic} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={(v) => mxnCompact.format(v)} />
                  <Tooltip formatter={(v) => [mxn.format(v), 'Bono']} />
                  <Bar dataKey="bono" radius={[5, 5, 0, 0]}>
                    {byMechanic.map((entry, i) => (
                      <Cell key={i} fill={bonusColor(entry.bono, maxBonus)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Top ganadores">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={topEarners} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => mxnCompact.format(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip formatter={(v) => [mxn.format(v), 'Bono']} />
                  <Bar dataKey="bono" radius={[0, 5, 5, 0]}>
                    {topEarners.map((_, i) => (
                      <Cell key={i} fill={EARNER_PALETTE[i % EARNER_PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Tickets asignados vs. cerrados" className="sm:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMechanic} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="asignados" name="Asignados" fill="#818cf8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cerrados" name="Cerrados" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* Right column: close-time panel + tabbed panel stacked */}
          <div className="flex flex-col gap-3 min-h-0 h-[80vh] lg:h-auto">

            {/* Close-time panel (above the tabbed card) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 flex-shrink-0 max-h-[38%]">
              <div className="px-3 pt-3 flex-shrink-0">
                <h3 className="text-xs font-bold text-gray-800">Tiempo de cierre por mecánico</h3>
                <p className="text-[10px] text-gray-400 leading-none mt-0.5">Promedio histórico · minutos</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2 space-y-1.5">
                {closeTimes.length === 0 ? (
                  <p className="text-center text-gray-400 py-6 text-xs">Sin datos de tiempo</p>
                ) : (
                  closeTimes.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <span className="w-24 truncate text-[11px] text-gray-700" title={m.name}>{m.name}</span>
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(m.minutes / maxCloseMinutes) * 100}%`,
                            backgroundColor: timeColor(m.minutes, maxCloseMinutes),
                          }}
                        />
                      </div>
                      <span className="w-14 text-right text-[11px] font-semibold text-gray-800 tabular-nums">
                        {fmt(m.minutes)} min
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Tabbed data panel, scrolls internally */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0 flex-1">
              <div className="flex border-b border-gray-100 flex-shrink-0">
              {[
                { id: 'mecanicos', label: 'Mecánicos' },
                { id: 'bonos', label: 'Bonos' },
                { id: 'ubicaciones', label: 'Ubicaciones' },
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
              ) : tab === 'mecanicos' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Mecánico</th>
                      <th className="py-1.5 pr-2 font-medium">Ubic.</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Asig.</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Cerr.</th>
                      <th className="py-1.5 font-medium text-right">Bono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mechanics.map((m) => (
                      <tr key={m.id} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 max-w-[110px] truncate" title={m.name}>{m.name}</td>
                        <td className="py-1.5 pr-2"><LocationBadge value={m.location} /></td>
                        <td className="py-1.5 pr-2 text-right text-gray-600">{fmt(m.ticketsAssigned)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-600">{fmt(m.ticketsClosed)}</td>
                        <td className="py-1.5 text-right font-semibold text-emerald-600">{mxn.format(m.bonusMxn || 0)}</td>
                      </tr>
                    ))}
                    {mechanics.length === 0 && (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">Sin mecánicos para esta semana</td></tr>
                    )}
                  </tbody>
                </table>
              ) : tab === 'bonos' ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Mecánico</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Bono %</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Calculado</th>
                      <th className="py-1.5 font-medium text-right">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mechanics.map((m) => (
                      <tr key={m.id} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-800 max-w-[110px] truncate" title={m.name}>{m.name}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-600">{fmt(m.bonusPct)}%</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{mxn.format(m.bonusCalculatedMxn || 0)}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">
                          {m.bonusFinalMxn != null ? mxn.format(m.bonusFinalMxn) : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))}
                    {mechanics.length === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">Sin bonos registrados</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-left text-gray-500 uppercase tracking-wide sticky top-0 bg-white">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">Ubicación</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Mec.</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Cerr.</th>
                      <th className="py-1.5 font-medium text-right">Bono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byLocation.map((r) => (
                      <tr key={r.location} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2"><LocationBadge value={r.location} /></td>
                        <td className="py-1.5 pr-2 text-right text-gray-600">{fmt(r.count)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-600">{fmt(r.cerrados)}</td>
                        <td className="py-1.5 text-right font-semibold text-emerald-600">{mxn.format(r.bono)}</td>
                      </tr>
                    ))}
                    {byLocation.length === 0 && (
                      <tr><td colSpan={4} className="py-8 text-center text-gray-400">Sin ubicaciones</td></tr>
                    )}
                  </tbody>
                </table>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}