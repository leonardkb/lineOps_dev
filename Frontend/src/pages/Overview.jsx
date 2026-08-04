// Overview.jsx — Skyrina "Daily Production" dashboard (Looker-Studio style)
//
// Data sources (all in server1.js; daily-production is the one added endpoint):
//   GET /api/skyrina/period-summary         → KPI cards
//   GET /api/skyrina/daily-production        → daily bars + Meta line   (NEW)
//   GET /api/skyrina/style-performance       → Meta vs Producido by product
//   GET /api/skyrina/line-performance-detail → product / line table
//   GET /api/skyrina/available-styles        → "Producto" filter
//   GET /api/skyrina/available-lines         → "Línea" filter
//
// Filters: Producto (style), Línea, and a date range.

import { useState, useEffect, useCallback, useMemo, Component } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart
} from 'recharts';

import NavCeo from '../components/NavCeo';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// ---------- palette (matches the mockup) ----------
const C = {
  bg: '#1b2733', panel: '#22303d', panelAlt: '#1f2c38', header: '#3a556b',
  border: '#2f3f4e', text: '#e6ebf0', textDim: '#9aa9b7',
  bar: '#5b9bd5', barTarget: '#7cc47a', meta: '#ffffff',
  good: '#6fbf73', goodBg: 'rgba(111,191,115,0.22)',
  warn: '#e0a83e', warnBg: 'rgba(224,168,62,0.18)',
  bad: '#e05c5c', badBg: 'rgba(224,92,92,0.18)',
  down: '#e07a5a', up: '#6fbf73',
};

// ---------- helpers ----------
const toYMD = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const off = dt.getTimezoneOffset();
  return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 10);
};
const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('es-ES');
const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00`)
    .toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    .replace(/\./g, '');
const fmtPct = (n) => `${Math.round(Number(n) || 0)} %`;

const startOfWeekMonday = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export default function Overview() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  // ---------- sidebar collapse (persisted) ----------
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1'
  );
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  // ---------- filters ----------
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(toYMD(addDays(today, -29)));
  const [endDate, setEndDate] = useState(toYMD(today));
  const [style, setStyle] = useState('all');
  const [lineNo, setLineNo] = useState('all');

  const [styleOptions, setStyleOptions] = useState([]);
  const [lineOptions, setLineOptions] = useState([]);

  // ---------- data ----------
  const [kpis, setKpis] = useState(null);
  const [daily, setDaily] = useState([]);
  const [products, setProducts] = useState([]);
  const [tableRows, setTableRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const PAGE_SIZE = 9;
  const [page, setPage] = useState(0);

  // day chosen by clicking a daily bar (null = full range)
  const [selectedDay, setSelectedDay] = useState(null);

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  // ---------- auth / role guard (same roles as before) ----------
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/', { replace: true }); return; }

    axios.get(`${API_BASE}/api/me`, { headers: headers() })
      .then((res) => {
        const u = res.data.user;
        if (!['skyrina', 'engineer', 'supervisor', 'master'].includes(u.role)) {
          navigate('/', { replace: true });
          return;
        }
        setUser(u);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, [navigate]);

  // ---------- filter options (refresh when range changes) ----------
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [s, l] = await Promise.all([
          axios.get(`${API_BASE}/api/skyrina/available-styles`, { headers: headers(), params: { startDate, endDate } }),
          axios.get(`${API_BASE}/api/skyrina/available-lines`,  { headers: headers(), params: { startDate, endDate } }),
        ]);
        if (s.data.success) setStyleOptions(s.data.styles || []);
        if (l.data.success) setLineOptions(l.data.lines || []);
      } catch { /* non-fatal */ }
    })();
  }, [user, startDate, endDate]);

  // ---------- KPI windows (relative to today, independent of the range picker) ----------
  const windowTotal = useCallback(async (from, to) => {
    try {
      const res = await axios.get(`${API_BASE}/api/skyrina/period-summary`, {
        headers: headers(),
        params: { startDate: toYMD(from), endDate: toYMD(to), style, lineNo },
      });
      return res.data.success ? Number(res.data.summary.totalSewed) || 0 : 0;
    } catch { return 0; }
  }, [style, lineNo]);

  const loadKpis = useCallback(async () => {
    const now = new Date();
    const twStart = startOfWeekMonday(now);
    const lwStart = addDays(twStart, -7);
    const lwEnd   = addDays(twStart, -1);
    const wbStart = addDays(twStart, -14);
    const wbEnd   = addDays(twStart, -8);
    const tmStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lmSame  = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    // "last month" = previous full calendar month; compared to the month before it
    const pmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pmEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
    const ppStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const ppEnd   = new Date(now.getFullYear(), now.getMonth() - 1, 0);

    const [tw, lw, wb, tm, lm, pm, pp] = await Promise.all([
      windowTotal(twStart, now),
      windowTotal(lwStart, lwEnd),
      windowTotal(wbStart, wbEnd),
      windowTotal(tmStart, now),
      windowTotal(lmStart, lmSame),
      windowTotal(pmStart, pmEnd),
      windowTotal(ppStart, ppEnd),
    ]);

    const chg = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : 0);
    setKpis({
      lastWeek:  { value: lw,  change: chg(lw, wb) },
      thisWeek:  { value: tw,  change: chg(tw, lw) },
      thisMonth: { value: tm,  change: chg(tm, lm) },
      last30:    { value: pm,  change: chg(pm, pp) },
    });
  }, [windowTotal]);

  // ---------- main data (range + filters) ----------
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    const rangeParams = { startDate, endDate, style, lineNo };
    const scopedParams = { startDate: selectedDay || startDate, endDate: selectedDay || endDate, style, lineNo };
    try {
      const [d, p, t] = await Promise.all([
        axios.get(`${API_BASE}/api/skyrina/daily-production`,        { headers: headers(), params: rangeParams }),
        axios.get(`${API_BASE}/api/skyrina/style-performance`,       { headers: headers(), params: scopedParams }),
        axios.get(`${API_BASE}/api/skyrina/line-performance-detail`, { headers: headers(), params: scopedParams }),
      ]);

      setDaily(d.data.success ? d.data.days : []);

      const prods = (p.data.success ? p.data.styles : [])
        .slice().sort((a, b) => b.produced - a.produced).slice(0, 12);
      setProducts(prods);

      setTableRows(t.data.success ? t.data.lines : []);
      setPage(0);

      await loadKpis();
    } catch (e) {
      console.error(e);
      setError('No se pudieron cargar los datos. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [user, startDate, endDate, style, lineNo, selectedDay, loadKpis]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---------- table pagination ----------
  const sortedRows = useMemo(
    () => tableRows.slice().sort((a, b) => (b.compliance || 0) - (a.compliance || 0)),
    [tableRows]
  );
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const compStyle = (c) =>
    c >= 100 ? { color: C.good, bg: C.goodBg }
      : c >= 90 ? { color: C.warn, bg: C.warnBg }
        : { color: C.bad, bg: C.badBg };

  const filterActive = style !== 'all' || lineNo !== 'all' || selectedDay !== null;
  const resetFilters = () => {
    const now = new Date();
    setStyle('all');
    setLineNo('all');
    setSelectedDay(null);
    setEndDate(toYMD(now));
    setStartDate(toYMD(addDays(now, -29)));
  };

  // ---------- loading gate ----------
  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: C.textDim }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%',
            border: `4px solid ${C.border}`, borderTopColor: C.bar,
            margin: '0 auto', animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16 }}>Cargando Skyrina…</p>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      <NavCeo collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />

      <div
        className={`transition-[margin] duration-300 ${sidebarCollapsed ? 'md:ml-16' : 'md:ml-64'}`}
        style={{ color: C.text, fontFamily: 'Inter, system-ui, sans-serif', padding: 16 }}
      >
        {/* ── Top filter bar ── */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ background: '#fff', color: '#111', fontWeight: 800, fontStyle: 'italic',
            fontSize: 28, padding: '4px 18px', borderRadius: 4, display: 'flex',
            alignItems: 'center', letterSpacing: -1 }}>
            Skyrina
          </div>

          <Dropdown label="Producto" value={style}  onChange={setStyle}  options={styleOptions} />
          <Dropdown label="Línea"    value={lineNo} onChange={setLineNo} options={lineOptions} />

          <div style={{ flex: 1.4, minWidth: 220, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '6px 12px', display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 11, color: C.textDim }}>Rango de fechas</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={startDate} max={endDate}
                onChange={(e) => { setSelectedDay(null); setStartDate(e.target.value); }}
                style={{ background: 'transparent', color: C.text, border: 'none',
                  outline: 'none', fontSize: 13, colorScheme: 'dark' }} />
              <span style={{ color: C.textDim }}>–</span>
              <input type="date" value={endDate} min={startDate}
                onChange={(e) => { setSelectedDay(null); setEndDate(e.target.value); }}
                style={{ background: 'transparent', color: C.text, border: 'none',
                  outline: 'none', fontSize: 13, colorScheme: 'dark' }} />
            </div>
          </div>

          {filterActive && (
            <button onClick={resetFilters} title="Restablecer filtros"
              style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text,
                borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13,
                whiteSpace: 'nowrap' }}>
              ✕ Limpiar filtro
            </button>
          )}
        </div>
        <div style={{ background: C.header, padding: '10px 16px', borderRadius: 4,
          fontWeight: 700, fontSize: 18, margin: '10px 0' }}>
          Daily Production
        </div>

        {error && (
          <div style={{ background: C.badBg, color: C.bad, padding: '10px 16px',
            borderRadius: 6, marginBottom: 12 }}>{error}</div>
        )}

        {/* ── Row 1: KPIs + daily chart ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <KpiCard title="Semana Pasada"   data={kpis?.lastWeek}  />
            <KpiCard title="Esta Semana"     data={kpis?.thisWeek}  />
            <KpiCard title="Este Mes"        data={kpis?.thisMonth} />
            <KpiCard title="Mes Pasado" data={kpis?.last30}    />
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '12px 8px', minHeight: 340 }}>
            {loading ? <Skeleton height={320} />
              : daily.length === 0 ? <Empty />
                : (
                  <ChartBoundary>
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={selectedDay ? daily.filter((x) => x.date === selectedDay) : daily} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke={C.border} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDay}
                        tick={{ fill: C.textDim, fontSize: 11 }} interval="preserveStartEnd"
                        minTickGap={12} axisLine={{ stroke: C.border }} tickLine={false} />
                      <YAxis tickFormatter={(v) => (v >= 1000 ? `${v / 1000} mil` : v)}
                        tick={{ fill: C.textDim, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: C.panelAlt, border: `1px solid ${C.border}`,
                          borderRadius: 8, color: C.text }}
                        labelFormatter={fmtDay}
                        formatter={(v, n) => [fmtNum(v), n === 'produced' ? 'Producido' : 'Meta']} />
                      <Legend wrapperStyle={{ color: C.textDim, fontSize: 12 }}
                        formatter={(v) => (v === 'produced' ? 'Producido' : 'Meta')} />
                      <Bar dataKey="produced" name="produced" fill={C.bar} barSize={26}
                        radius={[2, 2, 0, 0]} isAnimationActive={false} cursor="pointer"
                        onClick={(d) => {
                          const day = d?.payload?.date || d?.date;
                          if (day) setSelectedDay((prev) => (prev === day ? null : day));
                        }} />
                      <Line dataKey="target" name="target" stroke={C.meta} strokeWidth={2}
                        dot={selectedDay ? { r: 4, fill: C.meta } : false} type="monotone" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  </ChartBoundary>
                )}
          </div>
        </div>

        {/* ── Row 2: product bars + table ── */}
        {selectedDay && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 0', fontSize: 13, color: C.text }}>
            <span style={{ background: 'rgba(91,155,213,0.18)', color: C.bar, border: `1px solid ${C.border}`, borderRadius: 999, padding: '4px 12px' }}>
              Mostrando datos del {fmtDay(selectedDay)}
            </span>
            <button onClick={() => setSelectedDay(null)} style={{ background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>
              ✕ Ver todo el rango
            </button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '12px 8px', minHeight: 360 }}>
            <div style={{ display: 'flex', gap: 18, padding: '0 10px 6px', color: C.textDim, fontSize: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <i style={{ width: 12, height: 12, background: C.barTarget, borderRadius: 2 }} /> Meta
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <i style={{ width: 12, height: 12, background: C.bar, borderRadius: 2 }} /> Producido
              </span>
            </div>
            {loading ? <Skeleton height={320} />
              : products.length === 0 ? <Empty />
                : (
                  <ProductBars products={products} selected={style}
                    onSelect={(s) => setStyle((prev) => (prev === s ? 'all' : s))} />
                )}
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: 0, minHeight: 360, display: 'flex', flexDirection: 'column' }}>
            {loading ? <div style={{ padding: 12 }}><Skeleton height={320} /></div>
              : sortedRows.length === 0 ? <Empty />
                : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: C.textDim, textAlign: 'left' }}>
                          <th style={thCell}>Producto</th>
                          <th style={{ ...thCell, textAlign: 'center' }}>Línea</th>
                          <th style={{ ...thCell, textAlign: 'right' }}>Meta</th>
                          <th style={{ ...thCell, textAlign: 'right' }}>Prod</th>
                          <th style={{ ...thCell, textAlign: 'right' }}>Cump ▾</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((r, i) => {
                          const cs = compStyle(r.compliance);
                          return (
                            <tr key={`${r.style}-${r.lineNo}-${i}`}
                              onClick={() => { setStyle(r.style); setLineNo(String(r.lineNo)); }}
                              title={`Filtrar por ${r.style} · Línea ${r.lineNo}`}
                              style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}>
                              <td style={tdCell}>
                                <span style={{ color: C.textDim, marginRight: 6 }}>
                                  {page * PAGE_SIZE + i + 1}.
                                </span>
                                {r.style}
                              </td>
                              <td style={{ ...tdCell, textAlign: 'center' }}>{r.lineNo}</td>
                              <td style={{ ...tdCell, textAlign: 'right' }}>{fmtNum(r.target)}</td>
                              <td style={{ ...tdCell, textAlign: 'right' }}>{fmtNum(r.produced)}</td>
                              <td style={{ ...tdCell, textAlign: 'right', padding: '4px 8px' }}>
                                <span style={{ display: 'inline-block', minWidth: 54, padding: '4px 8px',
                                  borderRadius: 4, color: cs.color, background: cs.bg,
                                  fontWeight: 600, textAlign: 'right' }}>
                                  {fmtPct(r.compliance)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end',
                      alignItems: 'center', gap: 12, padding: '8px 12px', color: C.textDim, fontSize: 12 }}>
                      <span>
                        {sortedRows.length === 0 ? 0 : page * PAGE_SIZE + 1} –{' '}
                        {Math.min((page + 1) * PAGE_SIZE, sortedRows.length)} / {sortedRows.length}
                      </span>
                      <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                        style={pagerBtn(page === 0)}>‹</button>
                      <button disabled={page >= pageCount - 1}
                        onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                        style={pagerBtn(page >= pageCount - 1)}>›</button>
                    </div>
                  </>
                )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── sub-components ───────── */

class ChartBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('Chart render error:', err); }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ height: 300, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: C.textDim, fontSize: 13 }}>
          No se pudo dibujar el gráfico
        </div>
      );
    }
    return this.props.children;
  }
}

function Dropdown({ label, value, onChange, options }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.panel, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: '6px 12px', display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 11, color: C.textDim }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: 'transparent', color: C.text, border: 'none', outline: 'none',
          fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        <option value="all" style={{ background: C.panel }}>Todos</option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: C.panel }}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function ProductBars({ products, selected, onSelect }) {
  const max = Math.max(1, ...products.map((p) => Math.max(Number(p.target) || 0, Number(p.produced) || 0)));
  const Bar = ({ value, color }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 9, marginBottom: 2 }}>
      <div style={{ width: `${(Math.max(Number(value) || 0, 0) / max) * 100}%`,
        height: 9, background: color, borderRadius: '0 2px 2px 0', minWidth: 1 }} />
      <span style={{ fontSize: 9, color: C.textDim, whiteSpace: 'nowrap' }}>{fmtNum(value)}</span>
    </div>
  );
  return (
    <div style={{ padding: '4px 6px', maxHeight: 420, overflowY: 'auto' }}>
      {products.map((p, i) => {
        const isSel = selected && selected !== 'all' && selected === p.style;
        const dim = selected && selected !== 'all' && !isSel;
        return (
          <div key={`${p.style}-${i}`}
            onClick={() => onSelect && onSelect(p.style)}
            title={`Filtrar por ${p.style}`}
            style={{ marginBottom: 9, cursor: 'pointer', opacity: dim ? 0.4 : 1,
              background: isSel ? 'rgba(91,155,213,0.12)' : 'transparent',
              borderRadius: 4, padding: '2px 4px' }}>
            <div style={{ fontSize: 10, color: isSel ? C.text : C.textDim, marginBottom: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.style}
            </div>
            <Bar value={p.target} color={C.barTarget} />
            <Bar value={p.produced} color={C.bar} />
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ title, data }) {
  const value = data?.value ?? 0;
  const change = data?.change ?? 0;
  const negative = change < 0;
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ fontSize: 13, color: C.textDim, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{fmtNum(value)}</div>
      <div style={{ fontSize: 13, marginTop: 8, color: negative ? C.down : C.up,
        display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{negative ? '▼' : '▲'}</span>
        {change > 0 ? '+' : ''}{Math.round(change)}%
      </div>
    </div>
  );
}

const Skeleton = ({ height }) => (
  <div style={{ height, background: C.panelAlt, borderRadius: 6, animation: 'pulse 1.4s ease-in-out infinite' }}>
    <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}`}</style>
  </div>
);
const Empty = () => (
  <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: C.textDim, fontSize: 14 }}>
    No hay datos para los filtros seleccionados
  </div>
);

const thCell = { padding: '10px 8px', fontWeight: 600, fontSize: 12 };
const tdCell = { padding: '8px', color: C.text };
const pagerBtn = (disabled) => ({
  background: 'transparent', color: disabled ? C.border : C.text,
  border: `1px solid ${C.border}`, borderRadius: 4, width: 24, height: 24,
  cursor: disabled ? 'default' : 'pointer', fontSize: 14, lineHeight: '20px',
});