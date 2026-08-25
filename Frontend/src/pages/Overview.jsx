// Overview.jsx — "Daily Production" board (light theme)
//
// Layout: KPI rail (left), daily Meta/Producido combo chart (top),
// style comparison bars (bottom-left), product compliance table (bottom-right).
// Filters: period (día / semana / mes / año / rango), estilo, línea.
//
// Charts are sized from a measured container instead of ResponsiveContainer —
// recharts was receiving width/height of -1 on first paint inside the CSS grid.
//
// Data sources:
//   /api/skyrina/period-summary          -> KPI cards + daily series fallback
//   /api/skyrina/daily-production        -> daily series (optional single-query route)
//
// Efficiency (SAM-based) is NEVER computed in this file. Both routes above return
// it already calculated by the same SQL that feeds ActualEfficiency.jsx:
//   efficiency = SUM(packed * sam_minutes) / SUM(operators * working_hours * 60) * 100
// with the denominator spanning EVERY run in the window, not just runs that have a
// packing operation. Read avgEfficiency / efficiency straight off the response —
// re-deriving it here is how the two dashboards start disagreeing.
//   /api/skyrina/style-performance       -> horizontal Meta vs Producido bars
//   /api/skyrina/line-performance-detail -> product table
//   /api/skyrina/available-styles        -> estilo dropdown
//   /api/skyrina/available-lines         -> línea dropdown

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList,
} from 'recharts';

import NavCeo from '../components/NavCeo';

/* ------------------------------------------------------------------ *
 * API client + concurrency limiter
 *
 * The dashboard mounts and immediately needs ~13 endpoints (8 KPI windows +
 * daily series + style + line + 2 dropdowns). Firing them all at once made a
 * swarm of cold Lambdas open connections to Aurora simultaneously, exhausting
 * the DB and timing the function out (HTTP 500 "Internal server error").
 *
 * Every request below goes through `apiGet`, which caps the number of
 * in-flight requests to MAX_CONCURRENT. The dashboard still loads everything —
 * it just drip-feeds the calls so the backend is never stormed. Raise/lower
 * MAX_CONCURRENT to trade page-load latency against backend pressure.
 * ------------------------------------------------------------------ */
const MAX_CONCURRENT = 4;

const api = axios.create({
  // 304 Not Modified is a success, not an error — without this axios throws on
  // a cached response and the affected card renders empty.
  validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
});

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { run, resolve, reject } = queue.shift();
    run().then(resolve, reject).finally(() => {
      active -= 1;
      pump();
    });
  };
  return (run) =>
    new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      pump();
    });
}

const limit = createLimiter(MAX_CONCURRENT);

// Throttled GET — use this for every dashboard read.
const apiGet = (url, config) => limit(() => api.get(url, config));

// Point this at your API host. Empty string uses the dev-server proxy.

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */
const C = {
  canvas: '#f1f3f4',
  panel: '#ffffff',
  edge: '#dadce0',
  ink: '#202124',
  muted: '#5f6368',
  faint: '#80868b',
  grid: '#e8eaed',
  axis: '#5f6368',
  blue: '#5b9bd5',
  blueInk: '#2f6ea5',
  green: '#7cb342',
  greenInk: '#4e7a24',
  meta: '#5f6368',
  up: '#188038',
  down: '#c5221f',
  head: '#f8f9fa',
  hover: '#f8f9fa',
  focus: '#4285f4',
  good: '#b7e1cd', goodInk: '#0d652d',
  warn: '#fce8b2', warnInk: '#7c5800',
  bad: '#f4c7c3', badInk: '#a50e0e',
  eff: '#9334e6', effInk: '#7627bb',
};

// Efficiency bands — same thresholds ActualEfficiency.jsx paints with, so a line
// that reads "green" on one dashboard reads green on the other.
const EFF_BANDS = [
  { min: 90, color: '#15803d' },
  { min: 80, color: '#10b981' },
  { min: 70, color: '#84cc16' },
  { min: 60, color: '#f97316' },
  { min: -Infinity, color: '#ef4444' },
];

const effColor = (v) => EFF_BANDS.find((b) => (Number(v) || 0) >= b.min).color;

const TOP_CHART_H = 292;
const STYLE_CHART_H = 344;
const PAGE_SIZE = 10;
// Without /api/skyrina/daily-production the series falls back to one request per
// day, so long ranges are refused rather than firing hundreds of calls.
const MAX_FALLBACK_DAYS = 62;

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */
const nf = new Intl.NumberFormat('es-MX');
const fmtInt = (v) => (v == null || isNaN(v) ? '0' : nf.format(Math.round(Number(v))));

const fmtMil = (v) => {
  if (!v) return '0';
  const k = Number(v) / 1000;
  return `${k.toLocaleString('es-MX', { maximumFractionDigits: 1 })} mil`;
};

const fmtPct = (v) => `${Math.round(Number(v) || 0)} %`;
// Efficiency keeps one decimal to match ActualEfficiency.jsx's formatPercent —
// rounding to whole points here would make the same number look different on the
// two screens.
const fmtPct1 = (v) => (v == null || isNaN(v) ? '–' : `${Number(v).toFixed(1)} %`);
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------------ *
 * Dates — all local, never toISOString (that shifts a day in UTC-6)
 * ------------------------------------------------------------------ */
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fromYMD = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (d, n) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

const dayCount = (a, b) => Math.round((b - a) / 86400000) + 1;

const startOfWeek = (d) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
};

const weekString = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const n = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(n).padStart(2, '0')}`;
};

const weekStart = (str) => {
  const [y, w] = String(str).split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  return addDays(startOfWeek(jan4), (w - 1) * 7);
};

const eachDay = (start, end) => {
  const out = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(ymd(d));
  return out;
};

const pctChange = (current, previous) => (previous ? ((current - previous) / previous) * 100 : null);

// Efficiency is already a percentage, so movement between periods is a difference
// in percentage points — a "% change of a %" would be meaningless here.
const ppChange = (current, previous) =>
  current == null || previous == null ? null : Number(current) - Number(previous);

const fmtShort = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace(/\./g, '');
const fmtLong = (d) =>
  d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
// Axis ticks drop the year — it already lives in the panel subtitle
const fmtAxisDay = (val) => fmtShort(fromYMD(val));
const fmtDayLabel = (val) => {
  const d = fromYMD(val);
  const weekday = d.toLocaleDateString('es-MX', { weekday: 'short' }).replace(/\./g, '');
  return `${sentence(weekday)} ${fmtLong(d)}`;
};

/* ------------------------------------------------------------------ *
 * Period resolution
 * ------------------------------------------------------------------ */
function resolvePeriod(state) {
  const { rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd } = state;

  let start;
  let end;
  let label;

  switch (rangeType) {
    case 'week': {
      start = weekStart(selectedWeek);
      end = addDays(start, 6);
      label = `Semana ${selectedWeek.split('-W')[1]}`;
      break;
    }
    case 'month': {
      const [y, m] = selectedMonth.split('-').map(Number);
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0);
      label = sentence(start.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
      break;
    }
    case 'year': {
      const y = Number(selectedYear);
      start = new Date(y, 0, 1);
      end = new Date(y, 11, 31);
      label = String(y);
      break;
    }
    case 'custom': {
      start = fromYMD(customStart);
      end = fromYMD(customEnd);
      if (end < start) [start, end] = [end, start];
      label = `${fmtShort(start)} – ${fmtShort(end)}`;
      break;
    }
    case 'day':
    default: {
      start = fromYMD(selectedDate);
      end = new Date(start);
      label = sentence(fmtLong(start));
      break;
    }
  }

  const span = dayCount(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(span - 1));
  const rangeText = span === 1 ? fmtLong(start) : `${fmtShort(start)} – ${fmtLong(end)}`;

  return { start, end, prevStart, prevEnd, span, label, rangeText };
}

function buildWeekOptions() {
  const out = [];
  let cursor = startOfWeek(new Date());
  for (let i = 0; i < 30; i += 1) {
    const value = weekString(cursor);
    out.push({
      value,
      label: `Semana ${value.split('-W')[1]} · ${fmtShort(cursor)} – ${fmtShort(addDays(cursor, 6))}`,
    });
    cursor = addDays(cursor, -7);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Measured container — replaces ResponsiveContainer
 * ------------------------------------------------------------------ */
function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const apply = (next) => {
      const w = Math.floor(next);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };

    apply(el.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => apply(el.getBoundingClientRect().width);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

function ChartFrame({ height, loading, empty, children }) {
  const [ref, width] = useMeasuredWidth();
  return (
    <div ref={ref} style={{ height, width: '100%', minWidth: 0 }}>
      {loading || width === 0 ? (
        <div className="dp-skel" />
      ) : empty ? (
        <div className="dp-chart-empty">{empty}</div>
      ) : (
        children(width, height)
      )}
    </div>
  );
}

function PanelHead({ title, subtitle, children }) {
  return (
    <div className="dp-panel-head">
      <div className="dp-panel-titles">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="dp-panel-actions">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * KPI card
 * ------------------------------------------------------------------ */
function KpiCard({
  label, value, change, caption, loading, tall, accent,
  efficiency, efficiencyChange, efficiencyLabel = 'Eficiencia',
}) {
  const hasValue = value != null && value > 0;
  const isUp = change != null && change >= 0;

  // `undefined` = this card doesn't track efficiency at all; `null` = it does,
  // but the period had no runs, so we show a dash instead of a misleading 0 %.
  const showsEff = efficiency !== undefined;
  const hasEff = efficiency != null;
  const effUp = efficiencyChange != null && efficiencyChange >= 0;

  return (
    <div className={`dp-kpi${tall ? ' dp-kpi-tall' : ''}${accent ? ' dp-kpi-accent' : ''}`}>
      <div className="dp-kpi-label" title={label}>{label}</div>

      {loading ? (
        <>
          <div className="dp-kpi-ghost dp-kpi-ghost-lg" />
          <div className="dp-kpi-ghost dp-kpi-ghost-sm" />
          {showsEff && <div className="dp-kpi-ghost dp-kpi-ghost-md" />}
        </>
      ) : (
        <>
          <div className="dp-kpi-value">{hasValue ? fmtInt(value) : '–'}</div>
          <div
            className={`dp-kpi-delta${change == null ? '' : isUp ? ' up' : ' down'}`}
            title={change == null ? 'Sin período anterior comparable' : 'Comparado con el período anterior'}
          >
            {change == null ? 'Sin comparación' : `${isUp ? '▲' : '▼'} ${Math.abs(Math.round(change))}%`}
          </div>

          {showsEff && (
            <div className="dp-kpi-eff">
              <div className="dp-kpi-eff-top">
                <span className="dp-kpi-eff-label">{efficiencyLabel}</span>
                <span
                  className="dp-kpi-eff-value"
                  style={{ color: hasEff ? effColor(efficiency) : C.faint }}
                >
                  {fmtPct1(efficiency)}
                </span>
              </div>
              <div className="dp-kpi-eff-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(Math.max(Number(efficiency) || 0, 0), 100)}%`,
                    background: hasEff ? effColor(efficiency) : 'transparent',
                  }}
                />
              </div>
              {efficiencyChange != null && (
                <div className={`dp-kpi-eff-delta${effUp ? ' up' : ' down'}`}>
                  {`${effUp ? '▲' : '▼'} ${Math.abs(efficiencyChange).toFixed(1)} pp`}
                </div>
              )}
            </div>
          )}

          {caption && <div className="dp-kpi-caption">{caption}</div>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chart pieces
 * ------------------------------------------------------------------ */
function StaggeredTick({ x, y, payload, index }) {
  const i = index ?? payload?.index ?? 0;
  return (
    <text x={x} y={y + (i % 2 === 0 ? 12 : 26)} fill={C.axis} fontSize={11} textAnchor="middle">
      {fmtAxisDay(payload.value)}
    </text>
  );
}

function BarValueLabel({ x, y, width, height, value }) {
  if (!value || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 26) return null; // too narrow to read
  const inside = height >= 26;
  return (
    <text
      x={x + width / 2}
      y={inside ? y + 15 : y - 5}
      fill={inside ? '#ffffff' : C.muted}
      fontSize={11}
      textAnchor="middle"
    >
      {fmtInt(value)}
    </text>
  );
}

function DailyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const meta = row.target;
  const prod = row.produced;
  const eff = row.efficiency;
  const cump = meta ? (prod / meta) * 100 : null;
  const hasRuns = meta != null || row.runs > 0;

  return (
    <div className="dp-tip">
      <div className="dp-tip-head">{fmtDayLabel(label)}</div>
      {!hasRuns ? (
        <div className="dp-tip-note">Sin corridas programadas</div>
      ) : (
        <>
          <div className="dp-tip-row"><span style={{ color: C.meta }}>Meta</span><span>{meta == null ? '–' : fmtInt(meta)}</span></div>
          <div className="dp-tip-row"><span style={{ color: C.blueInk }}>Producido</span><span>{fmtInt(prod)}</span></div>
          <div className="dp-tip-row"><span>Cumplimiento</span><span>{cump == null ? '–' : fmtPct(cump)}</span></div>
          <div className="dp-tip-row strong">
            <span style={{ color: C.effInk }}>Eficiencia</span>
            <span style={{ color: eff == null ? C.faint : effColor(eff) }}>{fmtPct1(eff)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function StyleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const cump = row.target ? (row.produced / row.target) * 100 : null;
  return (
    <div className="dp-tip">
      <div className="dp-tip-head">{row.product}</div>
      <div className="dp-tip-row"><span style={{ color: C.greenInk }}>Meta</span><span>{fmtInt(row.target)}</span></div>
      <div className="dp-tip-row"><span style={{ color: C.blueInk }}>Producido</span><span>{fmtInt(row.produced)}</span></div>
      <div className="dp-tip-row"><span>Cumplimiento</span><span>{cump == null ? '–' : fmtPct(cump)}</span></div>
      <div className="dp-tip-row strong">
        <span style={{ color: C.effInk }}>Eficiencia</span>
        <span style={{ color: row.efficiency == null ? C.faint : effColor(row.efficiency) }}>
          {fmtPct1(row.efficiency)}
        </span>
      </div>
    </div>
  );
}

// Two-line category tick: style name, then its SAM efficiency in band colour.
// Efficiency is a rate, not a quantity — putting it on the value axis next to
// Meta/Producido bars would imply it shares their scale.
function StyleCategoryTick({ x, y, payload, data }) {
  const row = data?.[payload?.index] || {};
  const eff = row.efficiency;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-4} y={-1} textAnchor="end" fill={C.axis} fontSize={10}>
        {row.short ?? payload?.value}
      </text>
      <text
        x={-4}
        y={10}
        textAnchor="end"
        fontSize={9}
        fill={eff == null ? C.faint : effColor(eff)}
      >
        {eff == null ? '' : `Ef. ${Number(eff).toFixed(1)}%`}
      </text>
    </g>
  );
}

function Legend({ items }) {
  return (
    <div className="dp-legend">
      {items.map((it) => (
        <div key={it.label} className="dp-legend-item">
          <span
            className={it.type === 'line' ? 'dp-swatch-line' : 'dp-swatch'}
            style={{ background: it.color }}
          />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="dp-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const complianceClass = (pct) => (pct >= 100 ? 'good' : pct >= 90 ? 'warn' : 'bad');

/* ================================================================== *
 * Page
 * ================================================================== */
export default function Overview() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  /* ---- filters ---- */
  const [rangeType, setRangeType] = useState('month');
  const [selectedDate, setSelectedDate] = useState(ymd(today));
  const [selectedWeek, setSelectedWeek] = useState(weekString(today));
  const [selectedMonth, setSelectedMonth] = useState(ymd(today).slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [customStart, setCustomStart] = useState(ymd(addDays(today, -29)));
  const [customEnd, setCustomEnd] = useState(ymd(today));
  const [selectedStyle, setSelectedStyle] = useState('all');
  const [selectedLine, setSelectedLine] = useState('all');

  const [availableStyles, setAvailableStyles] = useState([]);
  const [availableLines, setAvailableLines] = useState([]);

  const weekOptions = useMemo(buildWeekOptions, []);
  const yearOptions = useMemo(() => {
    const y = today.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [today]);

  const period = useMemo(
    () =>
      resolvePeriod({
        rangeType, selectedDate, selectedWeek, selectedMonth,
        selectedYear, customStart, customEnd,
      }),
    [rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd]
  );

  /* ---- data ---- */
  const [kpis, setKpis] = useState({
    lastWeek: null, lastWeekChange: null, lastWeekEff: null, lastWeekEffChange: null,
    thisWeek: null, thisWeekChange: null, thisWeekEff: null, thisWeekEffChange: null,
    thisMonth: null, thisMonthChange: null, thisMonthEff: null, thisMonthEffChange: null,
    period: null, periodChange: null, periodTarget: null,
    periodEff: null, periodEffChange: null,
  });
  const [daily, setDaily] = useState([]);
  const [seriesNote, setSeriesNote] = useState('');
  const [styles, setStyles] = useState([]);
  const [rows, setRows] = useState([]);

  const [chartOrder, setChartOrder] = useState('date');
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [showEfficiency, setShowEfficiency] = useState(true);
  const [styleSort, setStyleSort] = useState('target');
  const [sortKey, setSortKey] = useState('compliance');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);

  /* ---------------- auth ---------------- */
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }
    axios
      .get(`http://localhost:5000/api/me`, { headers: { Authorization: `Bearer ${token}` } })
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

  /* ---------------- fetch helpers ---------------- */
  const filterQS = useCallback(() => {
    let q = '';
    if (selectedStyle !== 'all') q += `&style=${encodeURIComponent(selectedStyle)}`;
    if (selectedLine !== 'all') q += `&lineNo=${encodeURIComponent(selectedLine)}`;
    return q;
  }, [selectedStyle, selectedLine]);

  const summary = useCallback(async (start, end, headers, qs) => {
    try {
      const res = await apiGet(
        `http://localhost:5000/api/skyrina/period-summary?startDate=${ymd(start)}&endDate=${ymd(end)}${qs}`,
        { headers }
      );
      if (res.data?.success) {
        const runs = Number(res.data.summary.totalRuns) || 0;
        return {
          produced: Number(res.data.summary.totalSewed) || 0,
          target: Number(res.data.summary.totalTarget) || 0,
          runs,
          // Server-calculated SAM efficiency, taken verbatim. Null (not 0) when
          // the window had no runs so the card shows "–" instead of a fake 0 %.
          efficiency: runs > 0 ? Number(res.data.summary.avgEfficiency) || 0 : null,
        };
      }
    } catch (e) {
      console.error('period-summary failed', ymd(start), ymd(end), e?.message);
    }
    return { produced: 0, target: 0, runs: 0, efficiency: null };
  }, []);

  const dailySeries = useCallback(async (start, end, headers, qs) => {
    // target/efficiency null (not 0) on days with no runs, so both lines break
    // instead of plunging to zero across weekends and shutdowns.
    const shape = (d) => {
      const runs = Number(d.runs) || 0;
      return {
        date: String(d.date).slice(0, 10),
        runs,
        produced: Number(d.produced) || 0,
        target: Number(d.target) > 0 ? Number(d.target) : null,
        // Server-calculated, never re-derived here — see the note at the top.
        efficiency: runs > 0 ? Number(d.efficiency) || 0 : null,
      };
    };

    try {
      const res = await apiGet(
        `http://localhost:5000/api/skyrina/daily-production?startDate=${ymd(start)}&endDate=${ymd(end)}${qs}`,
        { headers }
      );
      if (res.data?.success && Array.isArray(res.data.days)) {
        return { rows: res.data.days.map(shape), note: '' };
      }
    } catch {
      /* route not deployed — fall through */
    }

    const days = eachDay(start, end);
    if (days.length > MAX_FALLBACK_DAYS) {
      return {
        rows: [],
        note: `El desglose diario de ${days.length} días necesita la ruta /api/skyrina/daily-production. Instálala o elige un rango más corto.`,
      };
    }

    // Fallback: one request per day. The shared limiter caps concurrency, so we
    // can enqueue them all at once instead of hand-rolling chunks — at most
    // MAX_CONCURRENT run in flight regardless.
    const out = await Promise.all(
      days.map((d) =>
        apiGet(`http://localhost:5000/api/skyrina/period-summary?startDate=${d}&endDate=${d}${qs}`, { headers })
          .then((r) =>
            shape({
              date: d,
              runs: r.data?.summary?.totalRuns,
              produced: r.data?.summary?.totalSewed,
              target: r.data?.summary?.totalTarget,
              efficiency: r.data?.summary?.avgEfficiency,
            })
          )
          .catch(() => ({ date: d, runs: 0, produced: 0, target: null, efficiency: null }))
      )
    );
    return { rows: out, note: '' };
  }, []);

  /* ---------------- dropdown options ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    const qs = `startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;

    Promise.all([
      apiGet(`http://localhost:5000/api/skyrina/available-styles?${qs}`, { headers })
        .then((r) => (r.data?.success ? r.data.styles : []))
        .catch(() => []),
      apiGet(`http://localhost:5000/api/skyrina/available-lines?${qs}`, { headers })
        .then((r) => (r.data?.success ? r.data.lines : []))
        .catch(() => []),
    ]).then(([s, l]) => {
      if (cancelled) return;
      setAvailableStyles(s);
      setAvailableLines(l);
      setSelectedStyle((prev) => (prev !== 'all' && !s.includes(prev) ? 'all' : prev));
      setSelectedLine((prev) => (prev !== 'all' && !l.includes(prev) ? 'all' : prev));
    });

    return () => {
      cancelled = true;
    };
  }, [user, period]);

  /* ---------------- load panels ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const qs = filterQS();
      const range = `startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;

      const thisWeekStart = startOfWeek(today);
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      const prevWeekStart = addDays(lastWeekStart, -7);
      const prevWeekEnd = addDays(lastWeekStart, -1);
      const daysIntoWeek = Math.round((today - thisWeekStart) / 86400000);
      const weekBeforeSameSpan = addDays(lastWeekStart, daysIntoWeek);

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevMonthSameDay = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate())
      );

      try {
        const [
          lastWeek, prevWeek, thisWeek, lastWeekPartial,
          thisMonth, prevMonth, current, previous,
          series, styleRes, lineRes,
        ] = await Promise.all([
          summary(lastWeekStart, lastWeekEnd, headers, qs),
          summary(prevWeekStart, prevWeekEnd, headers, qs),
          summary(thisWeekStart, today, headers, qs),
          summary(lastWeekStart, weekBeforeSameSpan, headers, qs),
          summary(monthStart, today, headers, qs),
          summary(prevMonthStart, prevMonthSameDay, headers, qs),
          summary(period.start, period.end, headers, qs),
          summary(period.prevStart, period.prevEnd, headers, qs),
          dailySeries(period.start, period.end, headers, qs),
          apiGet(`http://localhost:5000/api/skyrina/style-performance?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.styles : []))
            .catch(() => []),
          apiGet(`http://localhost:5000/api/skyrina/line-performance-detail?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.lines : []))
            .catch(() => []),
        ]);

        if (cancelled) return;

        setKpis({
          lastWeek: lastWeek.produced,
          lastWeekChange: pctChange(lastWeek.produced, prevWeek.produced),
          lastWeekEff: lastWeek.efficiency,
          lastWeekEffChange: ppChange(lastWeek.efficiency, prevWeek.efficiency),

          thisWeek: thisWeek.produced,
          thisWeekChange: thisWeek.produced ? pctChange(thisWeek.produced, lastWeekPartial.produced) : null,
          thisWeekEff: thisWeek.efficiency,
          // compared against the same number of days into last week, not the
          // full week — otherwise Monday always looks catastrophic.
          thisWeekEffChange: ppChange(thisWeek.efficiency, lastWeekPartial.efficiency),

          thisMonth: thisMonth.produced,
          thisMonthChange: pctChange(thisMonth.produced, prevMonth.produced),
          thisMonthEff: thisMonth.efficiency,
          thisMonthEffChange: ppChange(thisMonth.efficiency, prevMonth.efficiency),

          period: current.produced,
          periodChange: pctChange(current.produced, previous.produced),
          periodTarget: current.target,
          // This is the "global efficiency" of the selected period — the exact
          // value ActualEfficiency.jsx shows for the same range and filters.
          periodEff: current.efficiency,
          periodEffChange: ppChange(current.efficiency, previous.efficiency),
        });

        setDaily(series.rows);
        setSeriesNote(series.note);
        setStyles(styleRes);
        setRows(lineRes);
        setPage(0);
      } catch (err) {
        console.error('Dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, period, filterQS, today, summary, dailySeries]);

  /* ---------------- derived ---------------- */
  const activeDays = useMemo(() => daily.filter((d) => d.target != null || d.produced > 0).length, [daily]);

  const chartData = useMemo(() => {
    let d = [...daily];
    if (hideEmptyDays) d = d.filter((x) => x.produced > 0 || x.target != null);
    if (chartOrder === 'asc') d.sort((a, b) => a.produced - b.produced);
    else if (chartOrder === 'desc') d.sort((a, b) => b.produced - a.produced);
    return d;
  }, [daily, chartOrder, hideEmptyDays]);

  const tickInterval = useMemo(
    () => Math.max(0, Math.ceil(chartData.length / 26) - 1),
    [chartData.length]
  );

  const styleData = useMemo(() => {
    const mapped = styles.map((s) => ({
      // NOTE: never name a field `style` here — recharts spreads each data
      // row onto the rendered <path>, so a string `style` crashes React.
      product: s.style,
      short: s.style.length > 18 ? `${s.style.slice(0, 17)}…` : s.style,
      target: Number(s.target) || 0,
      produced: Number(s.produced) || 0,
      compliance: Number(s.target) ? (Number(s.produced) / Number(s.target)) * 100 : 0,
      // Server-calculated SAM efficiency — same field ActualEfficiency.jsx reads.
      efficiency: Number(s.efficiency) || 0,
    }));

    if (styleSort === 'compliance') mapped.sort((a, b) => a.compliance - b.compliance);
    else if (styleSort === 'efficiency') mapped.sort((a, b) => a.efficiency - b.efficiency);
    else mapped.sort((a, b) => b.target - a.target);

    return mapped.slice(0, 12);
  }, [styles, styleSort]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'lineNo') {
        av = parseInt(av, 10) || 0;
        bv = parseInt(bv, 10) || 0;
      }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => {
    const target = rows.reduce((a, r) => a + (Number(r.target) || 0), 0);
    const produced = rows.reduce((a, r) => a + (Number(r.produced) || 0), 0);
    // NOTE: there is deliberately no efficiency here. Averaging the per-row
    // efficiency column would be wrong (a line that ran 2 hours and one that ran
    // 80 must not get an equal vote), and line-performance-detail doesn't return
    // the SAM output / available minutes needed to weight them. The correct
    // period-wide figure is period-summary's avgEfficiency, already in
    // kpis.periodEff — the footer reuses that rather than inventing a rival number.
    return { target, produced, compliance: target ? (produced / target) * 100 : 0 };
  }, [rows]);

  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const firstIdx = sortedRows.length ? page * PAGE_SIZE + 1 : 0;
  const lastIdx = Math.min((page + 1) * PAGE_SIZE, sortedRows.length);

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'style' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const resetFilters = () => {
    setSelectedStyle('all');
    setSelectedLine('all');
  };
  const filtersActive = selectedStyle !== 'all' || selectedLine !== 'all';
  const scopeText = [
    selectedStyle === 'all' ? 'Todos los estilos' : selectedStyle,
    selectedLine === 'all' ? 'Todas las líneas' : `Línea ${selectedLine}`,
  ].join(' · ');

  if (!user) {
    return (
      <div className="dp-boot">
        <div>
          <div className="dp-spin" />
          <p>Cargando panel…</p>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  const th = (key, label, align = 'left') => (
    <th
      className={`dp-th${align === 'right' ? ' right' : ''}`}
      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key && <span className="dp-caret">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );

  return (
    <div className="dp-page">
      <NavCeo />

      <div className="dp-root">
        {/* ---------- title + filters ---------- */}
        <header className="dp-titlebar">
          <div className="dp-title">
            <h1>Daily Production</h1>
            <p>{period.rangeText} · {scopeText}</p>
          </div>

          <div className="dp-filters">
            <select value={rangeType} onChange={(e) => setRangeType(e.target.value)} aria-label="Tipo de período">
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
              <option value="year">Año</option>
              <option value="custom">Rango personalizado</option>
            </select>

            {rangeType === 'day' && (
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} aria-label="Fecha" />
            )}

            {rangeType === 'week' && (
              <select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} aria-label="Semana" className="wide">
                {weekOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {rangeType === 'month' && (
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} aria-label="Mes" />
            )}

            {rangeType === 'year' && (
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} aria-label="Año">
                {yearOptions.map((y) => (<option key={y} value={y}>{y}</option>))}
              </select>
            )}

            {rangeType === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="Fecha inicial" />
                <span className="dp-dash">–</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="Fecha final" />
              </>
            )}

            <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} aria-label="Estilo" className="wide">
              <option value="all">Todos los estilos</option>
              {availableStyles.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>

            <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} aria-label="Línea">
              <option value="all">Todas las líneas</option>
              {availableLines.map((l) => (<option key={l} value={l}>Línea {l}</option>))}
            </select>

            {filtersActive && (
              <button type="button" className="dp-clear" onClick={resetFilters}>Limpiar filtros</button>
            )}
          </div>
        </header>

        <div className="dp-grid">
          {/* ---------- KPI rail ---------- */}
          <aside className="dp-rail">
            <KpiCard
              label="Semana pasada"
              value={kpis.lastWeek}
              change={kpis.lastWeekChange}
              efficiency={kpis.lastWeekEff}
              efficiencyChange={kpis.lastWeekEffChange}
              loading={loading}
            />
            <KpiCard
              label="Esta semana"
              value={kpis.thisWeek}
              change={kpis.thisWeekChange}
              efficiency={kpis.thisWeekEff}
              efficiencyChange={kpis.thisWeekEffChange}
              loading={loading}
            />
            <KpiCard
              label="Este mes"
              value={kpis.thisMonth}
              change={kpis.thisMonthChange}
              efficiency={kpis.thisMonthEff}
              efficiencyChange={kpis.thisMonthEffChange}
              loading={loading}
            />
            <KpiCard
              label={period.label}
              value={kpis.period}
              change={kpis.periodChange}
              efficiency={kpis.periodEff}
              efficiencyChange={kpis.periodEffChange}
              efficiencyLabel="Eficiencia global"
              caption={
                kpis.periodTarget
                  ? `Meta ${fmtInt(kpis.periodTarget)} · ${fmtPct((kpis.period / kpis.periodTarget) * 100)}`
                  : null
              }
              loading={loading}
              tall
              accent
            />
          </aside>

          {/* ---------- daily combo chart ---------- */}
          <section className="dp-panel dp-chart-top">
            <PanelHead title="Producción diaria" subtitle={period.rangeText}>
              <Segmented
                label="Orden del gráfico"
                value={chartOrder}
                onChange={setChartOrder}
                options={[
                  { value: 'date', label: 'Fecha' },
                  { value: 'desc', label: 'Mayor' },
                  { value: 'asc', label: 'Menor' },
                ]}
              />
              <label className="dp-check">
                <input type="checkbox" checked={hideEmptyDays} onChange={(e) => setHideEmptyDays(e.target.checked)} />
                Solo días con corridas
              </label>
              <label className="dp-check">
                <input type="checkbox" checked={showEfficiency} onChange={(e) => setShowEfficiency(e.target.checked)} />
                Eficiencia
              </label>
            </PanelHead>

            <Legend
              items={[
                { label: 'Meta', color: C.meta, type: 'line' },
                { label: 'Producido', color: C.blue, type: 'square' },
                ...(showEfficiency ? [{ label: 'Eficiencia', color: C.eff, type: 'line' }] : []),
              ]}
            />

            <ChartFrame
              height={TOP_CHART_H}
              loading={loading}
              empty={seriesNote || (chartData.length ? '' : 'Sin datos en este período.')}
            >
              {(w, h) => (
                <ComposedChart
                  width={w}
                  height={h}
                  data={chartData}
                  margin={{ top: 16, right: showEfficiency ? 6 : 14, left: 0, bottom: 24 }}
                >
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={<StaggeredTick />}
                    tickLine={false}
                    axisLine={{ stroke: C.grid }}
                    interval={tickInterval}
                    height={42}
                  />
                  {/* pieces (left) and % (right) can't share a scale — 1.2k pieces
                      would flatten an 80 % line onto the axis */}
                  <YAxis
                    yAxisId="left"
                    tickFormatter={fmtMil}
                    tick={{ fill: C.axis, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                  />
                  {showEfficiency && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      // headroom above 100 % so an over-performing day isn't clipped
                      domain={[0, (max) => Math.max(100, Math.ceil((Number(max) || 0) / 10) * 10)]}
                      tickFormatter={(v) => `${Math.round(v)}%`}
                      tick={{ fill: C.effInk, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                    />
                  )}
                  <Tooltip content={<DailyTooltip />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
                  <Bar yAxisId="left" dataKey="produced" name="Producido" fill={C.blue} maxBarSize={44} isAnimationActive={false}>
                    <LabelList dataKey="produced" content={<BarValueLabel />} />
                  </Bar>
                  <Line
                    yAxisId="left"
                    type="linear"
                    dataKey="target"
                    name="Meta"
                    stroke={C.meta}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  {showEfficiency && (
                    <Line
                      yAxisId="right"
                      type="linear"
                      dataKey="efficiency"
                      name="Eficiencia"
                      stroke={C.eff}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              )}
            </ChartFrame>

            {!loading && daily.length > 0 && (
              <p className="dp-foot-note">
                {activeDays} de {daily.length} días con corridas programadas
                {kpis.periodEff != null && (
                  <>
                    {' · '}Eficiencia global{' '}
                    <b style={{ color: effColor(kpis.periodEff), fontWeight: 500 }}>
                      {fmtPct1(kpis.periodEff)}
                    </b>
                  </>
                )}
              </p>
            )}
          </section>

          {/* ---------- style comparison ---------- */}
          <section className="dp-panel dp-chart-left">
            <PanelHead title="Meta vs producido por estilo" subtitle={`${styleData.length} de ${styles.length} estilos`}>
              <Segmented
                label="Orden de estilos"
                value={styleSort}
                onChange={setStyleSort}
                options={[
                  { value: 'target', label: 'Mayor meta' },
                  { value: 'compliance', label: 'Menor cumpl.' },
                  { value: 'efficiency', label: 'Menor efic.' },
                ]}
              />
            </PanelHead>

            <Legend
              items={[
                { label: 'Meta', color: C.green, type: 'square' },
                { label: 'Producido', color: C.blue, type: 'square' },
                { label: 'Ef. = eficiencia SAM', color: C.eff, type: 'line' },
              ]}
            />

            <ChartFrame
              height={STYLE_CHART_H}
              loading={loading}
              empty={styleData.length ? '' : 'Sin estilos en este período.'}
            >
              {(w, h) => (
                <BarChart
                  width={w}
                  height={h}
                  data={styleData}
                  layout="vertical"
                  margin={{ top: 4, right: 62, left: 4, bottom: 8 }}
                  barCategoryGap="26%"
                  barGap={2}
                >
                  <CartesianGrid stroke={C.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={fmtMil}
                    tick={{ fill: C.axis, fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: C.grid }}
                  />
                  <YAxis
                    type="category"
                    dataKey="short"
                    tick={<StyleCategoryTick data={styleData} />}
                    tickLine={false}
                    axisLine={false}
                    width={112}
                    interval={0}
                  />
                  <Tooltip content={<StyleTooltip />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
                  <Bar dataKey="target" name="Meta" fill={C.green} isAnimationActive={false}>
                    <LabelList dataKey="target" position="right" formatter={fmtInt} fill={C.greenInk} fontSize={9} />
                  </Bar>
                  <Bar dataKey="produced" name="Producido" fill={C.blue} isAnimationActive={false}>
                    <LabelList dataKey="produced" position="right" formatter={fmtInt} fill={C.blueInk} fontSize={9} />
                  </Bar>
                </BarChart>
              )}
            </ChartFrame>
          </section>

          {/* ---------- product table ---------- */}
          <section className="dp-panel dp-table-panel">
            <PanelHead title="Cumplimiento por producto y línea" subtitle={`${sortedRows.length} combinaciones`}>
              <div className="dp-key">
                <span><i className="good" /> ≥100%</span>
                <span><i className="warn" /> 90–99%</span>
                <span><i className="bad" /> &lt;90%</span>
              </div>
            </PanelHead>

            <div className="dp-table-scroll">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th className="dp-th dp-th-rank" />
                    {th('style', 'Producto')}
                    {th('lineNo', 'Línea')}
                    {th('target', 'Meta', 'right')}
                    {th('produced', 'Prod', 'right')}
                    {th('efficiency', 'Efic', 'right')}
                    {th('compliance', 'Cump', 'right')}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="dp-empty">Cargando productos…</td></tr>}
                  {!loading && !pageRows.length && (
                    <tr><td colSpan={7} className="dp-empty">Sin producción registrada en este período.</td></tr>
                  )}
                  {!loading &&
                    pageRows.map((r, i) => {
                      const rank = page * PAGE_SIZE + i + 1;
                      return (
                        <tr key={`${r.style}-${r.lineNo}-${rank}`}>
                          <td className="dp-rank">{rank}.</td>
                          <td className="dp-name" title={r.style}>{r.style}</td>
                          <td>{r.lineNo}</td>
                          <td className="dp-num">{fmtInt(r.target)}</td>
                          <td className="dp-num">{fmtInt(r.produced)}</td>
                          <td className="dp-num dp-eff-num" style={{ color: effColor(r.efficiency) }}>
                            {fmtPct1(r.efficiency)}
                          </td>
                          <td className="dp-cump-cell">
                            <div className={`dp-cump ${complianceClass(r.compliance)}`}>{fmtPct(r.compliance)}</div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                {!loading && sortedRows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td />
                      <td className="dp-total-label" colSpan={2}>Total del período</td>
                      <td className="dp-num">{fmtInt(totals.target)}</td>
                      <td className="dp-num">{fmtInt(totals.produced)}</td>
                      <td
                        className="dp-num dp-eff-num"
                        style={{ color: kpis.periodEff == null ? C.faint : effColor(kpis.periodEff) }}
                        title="Eficiencia global del período (ponderada por minutos disponibles)"
                      >
                        {fmtPct1(kpis.periodEff)}
                      </td>
                      <td className="dp-cump-cell">
                        <div className={`dp-cump ${complianceClass(totals.compliance)}`}>{fmtPct(totals.compliance)}</div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="dp-pager">
              <span>{firstIdx} – {lastIdx} de {sortedRows.length}</span>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Página anterior">‹</button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                aria-label="Página siguiente"
              >›</button>
            </div>
          </section>
        </div>
      </div>

      <style>{css}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const css = `
.dp-page{min-height:100vh;background:${C.canvas};
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:${C.ink}}
.dp-root{padding:10px}

.dp-boot{min-height:100vh;background:${C.canvas};display:grid;place-items:center;text-align:center}
.dp-boot p{color:${C.muted};margin-top:14px;font-size:14px}
.dp-spin{width:44px;height:44px;border-radius:50%;border:3px solid ${C.grid};
  border-top-color:${C.blue};animation:dpspin .9s linear infinite;margin:0 auto}
@keyframes dpspin{to{transform:rotate(360deg)}}

.dp-titlebar{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:10px 16px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.dp-title h1{margin:0;font-size:17px;font-weight:500;letter-spacing:.2px}
.dp-title p{margin:2px 0 0;font-size:12px;color:${C.muted}}

.dp-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dp-filters select,.dp-filters input{background:${C.panel};color:${C.ink};border:1px solid ${C.edge};
  border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;cursor:pointer;max-width:210px}
.dp-filters select.wide{max-width:250px}
.dp-filters select:hover,.dp-filters input:hover{border-color:#bdc1c6}
.dp-filters select:focus-visible,.dp-filters input:focus-visible{outline:none;
  border-color:${C.focus};box-shadow:0 0 0 3px rgba(66,133,244,.28)}
.dp-dash{color:${C.muted};font-size:13px}
.dp-clear{background:none;border:1px solid ${C.edge};border-radius:8px;padding:7px 12px;
  font-size:13px;font-family:inherit;color:${C.muted};cursor:pointer}
.dp-clear:hover{background:${C.hover};color:${C.ink}}
.dp-clear:focus-visible{outline:2px solid ${C.focus};outline-offset:1px}

.dp-grid{display:grid;gap:10px;
  grid-template-columns:210px minmax(0,1.15fr) minmax(0,1fr);
  grid-template-areas:"rail chart chart" "rail styles table"}
.dp-rail{grid-area:rail;display:flex;flex-direction:column;gap:10px;min-width:0}
.dp-chart-top{grid-area:chart}
.dp-chart-left{grid-area:styles}
.dp-table-panel{grid-area:table;display:flex;flex-direction:column;min-height:0}

.dp-panel{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;
  padding:0 0 4px;min-width:0;overflow:hidden;display:flex;flex-direction:column}

.dp-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:11px 14px 9px;border-bottom:1px solid ${C.grid};flex-wrap:wrap}
.dp-panel-titles h2{margin:0;font-size:13.5px;font-weight:500;color:${C.ink}}
.dp-panel-titles p{margin:2px 0 0;font-size:11.5px;color:${C.faint}}
.dp-panel-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

.dp-seg{display:inline-flex;border:1px solid ${C.edge};border-radius:7px;overflow:hidden}
.dp-seg button{background:${C.panel};border:none;border-right:1px solid ${C.edge};
  padding:5px 10px;font-size:11.5px;font-family:inherit;color:${C.muted};cursor:pointer}
.dp-seg button:last-child{border-right:none}
.dp-seg button:hover{background:${C.hover};color:${C.ink}}
.dp-seg button.on{background:#e8f0fe;color:#1967d2;font-weight:500}
.dp-seg button:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}

.dp-check{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:${C.muted};cursor:pointer}
.dp-check input{accent-color:${C.focus};cursor:pointer;margin:0}

.dp-key{display:flex;gap:10px;font-size:11px;color:${C.muted};align-items:center}
.dp-key span{display:inline-flex;align-items:center;gap:4px}
.dp-key i{width:10px;height:10px;border-radius:2px;display:inline-block}
.dp-key i.good{background:${C.good}}
.dp-key i.warn{background:${C.warn}}
.dp-key i.bad{background:${C.bad}}

.dp-kpi{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:12px 14px 14px}
.dp-kpi-tall{padding:14px}
.dp-kpi-accent{border-left:3px solid ${C.blue}}
.dp-kpi-label{color:${C.muted};font-size:12.5px;margin-bottom:6px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-kpi-value{color:${C.ink};font-size:27px;font-weight:400;line-height:1.1;letter-spacing:-.5px;
  font-variant-numeric:tabular-nums}
.dp-kpi-tall .dp-kpi-value{font-size:30px}
.dp-kpi-delta{margin-top:4px;font-size:12px;color:${C.faint}}
.dp-kpi-delta.up{color:${C.up}}
.dp-kpi-delta.down{color:${C.down}}
.dp-kpi-caption{margin-top:7px;padding-top:7px;border-top:1px solid ${C.grid};
  font-size:11.5px;color:${C.muted}}
.dp-kpi-ghost{background:${C.grid};border-radius:4px}
.dp-kpi-ghost-lg{height:30px;width:70%}
.dp-kpi-ghost-sm{height:11px;width:35%;margin-top:8px}
.dp-kpi-ghost-md{height:13px;width:55%;margin-top:12px}

.dp-kpi-eff{margin-top:9px;padding-top:8px;border-top:1px solid ${C.grid}}
.dp-kpi-eff-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dp-kpi-eff-label{font-size:11.5px;color:${C.muted};overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.dp-kpi-eff-value{font-size:15px;font-weight:500;font-variant-numeric:tabular-nums;
  letter-spacing:-.2px;white-space:nowrap}
.dp-kpi-tall .dp-kpi-eff-value{font-size:17px}
.dp-kpi-eff-track{margin-top:6px;height:4px;border-radius:2px;background:${C.grid};
  overflow:hidden}
.dp-kpi-eff-track span{display:block;height:100%;border-radius:2px;
  transition:width .35s ease}
.dp-kpi-eff-delta{margin-top:5px;font-size:11px;color:${C.faint}}
.dp-kpi-eff-delta.up{color:${C.up}}
.dp-kpi-eff-delta.down{color:${C.down}}

.dp-eff-num{font-weight:500;font-variant-numeric:tabular-nums}

.dp-legend{display:flex;gap:18px;align-items:center;padding:8px 0 2px 14px;
  font-size:12.5px;color:${C.ink}}
.dp-legend-item{display:flex;align-items:center;gap:6px}
.dp-swatch{width:16px;height:12px;display:inline-block;border-radius:1px}
.dp-swatch-line{width:22px;height:2px;display:inline-block}

.dp-chart-empty{height:100%;display:grid;place-items:center;text-align:center;
  padding:0 24px;color:${C.muted};font-size:13px;line-height:1.5}
.dp-foot-note{margin:0;padding:2px 14px 8px;font-size:11px;color:${C.faint};text-align:right}

.dp-tip{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:9px 11px;
  font-size:12px;color:${C.ink};box-shadow:0 2px 8px rgba(60,64,67,.2);min-width:150px}
.dp-tip-head{color:${C.muted};margin-bottom:5px;font-size:11.5px}
.dp-tip-row{display:flex;gap:14px;justify-content:space-between;line-height:1.7}
.dp-tip-row.strong{border-top:1px solid ${C.grid};margin-top:4px;padding-top:4px;font-weight:500}
.dp-tip-note{color:${C.faint};font-style:italic}

.dp-table-scroll{flex:1;overflow:auto;min-height:0}
.dp-table{width:100%;border-collapse:collapse;font-size:12.5px;color:${C.ink}}
.dp-th{position:sticky;top:0;z-index:1;background:${C.head};text-align:left;
  font-weight:500;font-size:12.5px;color:${C.muted};white-space:nowrap;
  border-bottom:1px solid ${C.edge};padding:0}
.dp-th button{width:100%;background:none;border:none;font:inherit;color:inherit;
  padding:9px 12px;text-align:inherit;cursor:pointer}
.dp-th.right,.dp-th.right button{text-align:right}
.dp-th button:hover{background:${C.grid};color:${C.ink}}
.dp-th button:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}
.dp-th-rank{width:34px}
.dp-caret{margin-left:5px;font-size:10px}
.dp-table tbody td{padding:9px 12px;border-bottom:1px solid ${C.grid};white-space:nowrap}
.dp-table tbody tr:hover{background:${C.hover}}
.dp-rank{color:${C.faint};text-align:right;padding-right:6px !important;padding-left:12px !important}
.dp-name{max-width:190px;overflow:hidden;text-overflow:ellipsis}
.dp-num{text-align:right;font-variant-numeric:tabular-nums}
.dp-cump-cell{padding:0 !important;text-align:right}
.dp-cump{padding:9px 12px;text-align:right;font-variant-numeric:tabular-nums}
.dp-cump.good{background:${C.good};color:${C.goodInk}}
.dp-cump.warn{background:${C.warn};color:${C.warnInk}}
.dp-cump.bad{background:${C.bad};color:${C.badInk}}
.dp-table tfoot td{position:sticky;bottom:0;background:${C.head};border-top:1px solid ${C.edge};
  padding:9px 12px;font-weight:500;white-space:nowrap}
.dp-table tfoot .dp-cump-cell{padding:0 !important}
.dp-total-label{color:${C.muted}}
.dp-empty{padding:22px 12px;text-align:center;color:${C.muted}}

.dp-pager{display:flex;align-items:center;justify-content:flex-end;gap:6px;
  padding:8px 12px;font-size:12px;color:${C.muted};border-top:1px solid ${C.grid}}
.dp-pager button{background:none;border:none;color:${C.muted};font-size:17px;cursor:pointer;
  padding:0 6px;border-radius:3px;line-height:1}
.dp-pager button:hover:not(:disabled){color:${C.ink};background:${C.hover}}
.dp-pager button:disabled{opacity:.35;cursor:default}
.dp-pager button:focus-visible{outline:2px solid ${C.focus};outline-offset:1px}

.dp-skel{height:100%;width:100%;border-radius:4px;
  background:linear-gradient(90deg,#f1f3f4 25%,#e8eaed 50%,#f1f3f4 75%);
  background-size:200% 100%;animation:dpshimmer 1.4s ease-in-out infinite}
@keyframes dpshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.dp-table-scroll::-webkit-scrollbar{width:9px;height:9px}
.dp-table-scroll::-webkit-scrollbar-thumb{background:#c4c7c5;border-radius:5px}
.dp-table-scroll::-webkit-scrollbar-track{background:transparent}

@media (max-width:1280px){
  .dp-grid{grid-template-columns:180px minmax(0,1fr) minmax(0,1fr);
    grid-template-areas:"rail chart chart" "rail styles table"}
  .dp-name{max-width:150px}
}
@media (max-width:1080px){
  .dp-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    grid-template-areas:"rail rail" "chart chart" "styles table"}
  .dp-rail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .dp-name{max-width:120px}
}
@media (max-width:760px){
  .dp-grid{grid-template-columns:1fr;
    grid-template-areas:"rail" "chart" "styles" "table"}
  .dp-rail{grid-template-columns:1fr 1fr}
  .dp-name{max-width:130px}
  .dp-filters{width:100%}
  .dp-filters select,.dp-filters input{flex:1 1 140px;max-width:none}
  .dp-panel-head{flex-direction:column;align-items:stretch}
}
@media (prefers-reduced-motion:reduce){
  .dp-skel,.dp-spin{animation:none}
}
`;