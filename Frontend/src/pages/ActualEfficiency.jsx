// ActualEfficiency.jsx — "Eficiencia real" board (light theme)
//
// Same layout as Overview.jsx: KPI rail (left), top chart, two panels below.
//
//   Rail (always whole plant, relative to TODAY — like Overview's week cards):
//     Semana pasada · Esta semana · Hoy (en vivo) · Último día — each one shows
//     the GLOBAL SAM efficiency as its headline figure, plus a card for the
//     selected period that honours every filter.
//   Line chart : efficiency per LINE for the selected period, with the style
//                currently running on each line under its label. Click a line
//                to see its history in the same panel, grouped like Overview:
//                día -> días del mes · semana -> semanas del mes ·
//                mes -> enero .. mes actual · año -> años.
//   Bottom-left: EVERY style of the selected period (día / semana / mes / año /
//                rango), searchable and sortable. Click a style to open the side
//                panel: which lines made it, on which days, whether each line
//                ended or still has planned days, and how much is left to produce.
//   Bottom-right: line performance detail (línea × estilo), sortable.
//   "Mensajes" tab keeps the line leaders' low-efficiency reasons.
//
// Efficiency (SAM-based) is NEVER computed here for a window the server already
// answers. Every route returns it calculated by the same SQL as Overview.jsx:
//   efficiency = SUM(packed * sam_minutes) / SUM(operators * working_hours * 60) * 100
//
// Data sources:
//   /api/skyrina/period-summary           -> week cards + selected period card
//   /api/skyrina/daily-production         -> "Último día" (last day with runs)
//   /api/skyrina/realtime-summary         -> "Hoy" card (re-polled every 60 s)
//   /api/skyrina/line-efficiency          -> line chart
//   /api/skyrina/daily-production         -> line history (bar click)
//   /api/skyrina/style-performance        -> style list (all styles)
//   /api/skyrina/line-performance-detail  -> line table
//   /api/skyrina/style-production-detail  -> style side panel (NEW route)
//   /api/skyrina/available-*              -> dropdowns
//   /api/efficiency-reasons               -> Mensajes tab
//
// Rendered standalone (its own route) or inside Overview.jsx's "Monitor de
// producción" tabs with `embedded` — then the parent draws the NavCeo bar.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, ReferenceLine, Cell,
} from 'recharts';

import NavCeo from '../components/NavCeo';

/* ------------------------------------------------------------------ *
 * API client + concurrency limiter (same as Overview.jsx)
 * ------------------------------------------------------------------ */
const MAX_CONCURRENT = 4;

const api = axios.create({
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
const apiGet = (url, config) => limit(() => api.get(url, config));
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

/* ------------------------------------------------------------------ *
 * Palette — identical to Overview.jsx
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
  good: '#e6f4ea', goodInk: '#0d652d',
  warn: '#fef7e0', warnInk: '#7c5800',
  bad: '#fce8e6', badInk: '#a50e0e',
  idle: '#f1f3f4', idleInk: '#5f6368',
  eff: '#9334e6', effInk: '#7627bb',
};

const EFF_BANDS = [
  { min: 90, color: '#15803d', label: '≥ 90%' },
  { min: 80, color: '#10b981', label: '80–89%' },
  { min: 70, color: '#84cc16', label: '70–79%' },
  { min: 60, color: '#f97316', label: '60–69%' },
  { min: -Infinity, color: '#ef4444', label: '< 60%' },
];
const effColor = (v) => EFF_BANDS.find((b) => (Number(v) || 0) >= b.min).color;
const EFF_GOAL = 70;

const LINE_CHART_H = 300;
const PAGE_SIZE = 12;

const EFFICIENCY_REASON_LABELS = {
  materials_missing: 'Materiales faltantes',
  trims_missing: 'Avíos faltantes (trims)',
  absents: 'Ausencias',
  machine_no_function: 'Máquina sin funcionar',
  change_style: 'Cambio de estilo',
  inefficiencies: 'Ineficiencias',
  others: 'Otros',
};
const REASON_COLORS = {
  materials_missing: '#f97316',
  trims_missing: '#14b8a6',
  absents: '#a855f7',
  machine_no_function: '#e11d48',
  change_style: '#2563eb',
  inefficiencies: '#eab308',
  others: '#6b7280',
};
const MESSAGES_RANGE_OPTIONS = [
  { value: 'all', label: 'Todos los días' },
  { value: 'last7', label: 'Últimos 7 días' },
  { value: 'last30', label: 'Últimos 30 días' },
  { value: 'last90', label: 'Últimos 90 días' },
  { value: 'filter', label: 'Período seleccionado' },
];

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */
const nf = new Intl.NumberFormat('es-MX');
const fmtInt = (v) => (v == null || isNaN(v) ? '0' : nf.format(Math.round(Number(v))));
const fmtPct = (v) => `${Math.round(Number(v) || 0)} %`;
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
  return addDays(startOfWeek(new Date(y, 0, 4)), (w - 1) * 7);
};
const ppChange = (current, previous) =>
  current == null || previous == null ? null : Number(current) - Number(previous);

const fmtShort = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace(/\./g, '');
const fmtLong = (d) =>
  d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
const fmtDay = (s) => {
  if (!s) return '–';
  const d = fromYMD(s);
  const wd = d.toLocaleDateString('es-MX', { weekday: 'short' }).replace(/\./g, '');
  return `${sentence(wd)} ${fmtShort(d)}`;
};
const fmtYmdShort = (s) => (s ? fmtShort(fromYMD(s)) : '–');

function resolvePeriod({ rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd }) {
  let start;
  let end;
  let label;
  switch (rangeType) {
    case 'week':
      start = weekStart(selectedWeek);
      end = addDays(start, 6);
      label = `Semana ${selectedWeek.split('-W')[1]}`;
      break;
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
    case 'custom':
      start = fromYMD(customStart);
      end = fromYMD(customEnd);
      if (end < start) [start, end] = [end, start];
      label = `${fmtShort(start)} – ${fmtShort(end)}`;
      break;
    case 'day':
    default:
      start = fromYMD(selectedDate);
      end = new Date(start);
      label = sentence(fmtLong(start));
      break;
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

const formatSentTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};


/* ------------------------------------------------------------------ *
 * Trend scope — same buckets as Overview.jsx's top chart:
 *   día    -> one bar per DAY of the selected date's month (days with runs)
 *   semana -> one bar per WEEK touching the selected week's month
 *   mes    -> one bar per MONTH, enero .. mes actual (or diciembre in past years)
 *   año    -> one bar per YEAR, same window as Overview
 *   rango  -> one bar per DAY of the custom range
 * ------------------------------------------------------------------ */
const TREND_NOUN = { day: 'días', week: 'semanas', month: 'meses', year: 'años' };
const TREND_ONE = { day: 'día', week: 'semana', month: 'mes', year: 'año' };

function resolveChartScope(state, today) {
  const { rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd } = state;
  const monthName = (d) => sentence(d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
  switch (rangeType) {
    case 'week': {
      const mid = addDays(weekStart(selectedWeek), 3); // Thursday decides the month
      const mStart = new Date(mid.getFullYear(), mid.getMonth(), 1);
      const mEnd = new Date(mid.getFullYear(), mid.getMonth() + 1, 0);
      return { bucket: 'week', start: startOfWeek(mStart), end: addDays(startOfWeek(mEnd), 6), label: `Por semana · ${monthName(mStart)}` };
    }
    case 'month': {
      const y = Number(selectedMonth.split('-')[0]) || today.getFullYear();
      const lastMonth = y === today.getFullYear() ? today.getMonth() : 11;
      return { bucket: 'month', start: new Date(y, 0, 1), end: new Date(y, lastMonth + 1, 0), label: `Por mes · ${y}` };
    }
    case 'year': {
      const y = Number(selectedYear) || today.getFullYear();
      const from = Math.min(y, today.getFullYear());
      const to = Math.max(y, today.getFullYear() + 1);
      return { bucket: 'year', start: new Date(from, 0, 1), end: new Date(to, 11, 31), label: `Por año · ${from}–${to}` };
    }
    case 'custom': {
      let a = fromYMD(customStart);
      let b = fromYMD(customEnd);
      if (b < a) [a, b] = [b, a];
      return { bucket: 'day', start: a, end: b, label: `Por día · ${fmtShort(a)} – ${fmtShort(b)}` };
    }
    case 'day':
    default: {
      const d = fromYMD(selectedDate);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      return { bucket: 'day', start: mStart, end: new Date(d.getFullYear(), d.getMonth() + 1, 0), label: `Por día · ${monthName(mStart)}` };
    }
  }
}

// Fold per-day rows into buckets. Efficiency is re-derived the server's way —
// SUM(samOutput) / SUM(availableMinutes) — never by averaging daily percentages.
// Week/month/year windows list every bucket (empty ones too) so the axis always
// reads e.g. Ene .. Oct; the day view only keeps days that had runs.
function buildTrend(rows, scope) {
  if (scope.bucket === 'day') {
    const from = ymd(scope.start);
    const to = ymd(scope.end);
    return rows
      .filter((d) => d.runs > 0 && d.date >= from && d.date <= to)
      .map((d, i) => {
        const dt = fromYMD(d.date);
        return {
          key: d.date,
          axisLabel: i === 0 || dt.getDate() === 1 ? fmtShort(dt) : String(dt.getDate()),
          tipLabel: fmtDay(d.date),
          runs: d.runs, produced: d.produced, target: d.target, efficiency: d.efficiency,
        };
      });
  }

  const keyOf = (date) => {
    if (scope.bucket === 'week') return weekString(date);
    if (scope.bucket === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return String(date.getFullYear());
  };
  const buckets = new Map();
  const add = (key, date) => {
    if (buckets.has(key)) return;
    let axisLabel = key;
    let tipLabel = key;
    if (scope.bucket === 'week') {
      const ws = weekStart(key);
      const n = key.split('-W')[1];
      axisLabel = `S${n}`;
      tipLabel = `Semana ${n} · ${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`;
    } else if (scope.bucket === 'month') {
      axisLabel = sentence(date.toLocaleDateString('es-MX', { month: 'short' }).replace(/\./g, ''));
      tipLabel = sentence(date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
    }
    buckets.set(key, { key, axisLabel, tipLabel, runs: 0, produced: 0, target: 0, samOutput: 0, availableMinutes: 0 });
  };

  if (scope.bucket === 'week') {
    for (let c = new Date(scope.start); c <= scope.end; c = addDays(c, 7)) add(keyOf(c), c);
  } else if (scope.bucket === 'month') {
    for (let m = 0; m <= scope.end.getMonth(); m += 1) {
      const c = new Date(scope.start.getFullYear(), m, 1);
      add(keyOf(c), c);
    }
  } else {
    for (let y = scope.start.getFullYear(); y <= scope.end.getFullYear(); y += 1) add(String(y), new Date(y, 0, 1));
  }

  for (const d of rows) {
    const date = fromYMD(d.date);
    const k = keyOf(date);
    add(k, date);
    const b = buckets.get(k);
    b.runs += d.runs;
    b.produced += d.produced;
    b.target += d.target || 0;
    b.samOutput += d.samOutput;
    b.availableMinutes += d.availableMinutes;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    target: b.target || null,
    efficiency: b.runs > 0 && b.availableMinutes > 0 ? (b.samOutput / b.availableMinutes) * 100 : null,
  }));
}

/* ------------------------------------------------------------------ *
 * Measured container — replaces ResponsiveContainer (see Overview.jsx)
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
    <div ref={ref} style={{ minHeight: height, width: '100%', minWidth: 0 }}>
      {loading || width === 0 ? (
        <div className="ae-skel" style={{ height }} />
      ) : empty ? (
        <div className="ae-chart-empty" style={{ height }}>{empty}</div>
      ) : (
        children(width, height)
      )}
    </div>
  );
}

function PanelHead({ title, subtitle, children }) {
  return (
    <div className="ae-panel-head">
      <div className="ae-panel-titles">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="ae-panel-actions">{children}</div>}
    </div>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="ae-seg" role="group" aria-label={label}>
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

function BandKey() {
  return (
    <div className="ae-bands" aria-label="Rangos de eficiencia">
      {EFF_BANDS.map((b) => (
        <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Efficiency KPI card — efficiency is the headline figure
 * ------------------------------------------------------------------ */
function EffCard({
  label, sublabel, efficiency, change, changeLabel, produced, target,
  loading, accent, badge, extra, caption,
}) {
  const hasEff = efficiency != null;
  const up = change != null && change >= 0;
  const cump = target ? (produced / target) * 100 : null;

  return (
    <div className={`ae-kpi${accent ? ' ae-kpi-accent' : ''}`}>
      <div className="ae-kpi-head">
        <span className="ae-kpi-label" title={label}>{label}</span>
        {badge}
      </div>
      {sublabel && <div className="ae-kpi-sub">{sublabel}</div>}

      {loading ? (
        <>
          <div className="ae-ghost ae-ghost-lg" />
          <div className="ae-ghost ae-ghost-sm" />
          <div className="ae-ghost ae-ghost-md" />
        </>
      ) : (
        <>
          <div className="ae-kpi-value" style={{ color: hasEff ? effColor(efficiency) : C.faint }}>
            {fmtPct1(efficiency)}
          </div>
          <div className="ae-track" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(Math.max(Number(efficiency) || 0, 0), 100)}%`,
                background: hasEff ? effColor(efficiency) : 'transparent',
              }}
            />
            <b style={{ left: `${EFF_GOAL}%` }} />
          </div>
          <div
            className={`ae-kpi-delta${change == null ? '' : up ? ' up' : ' down'}`}
            title={changeLabel || 'Comparado con el período anterior'}
          >
            {change == null
              ? (hasEff ? 'Sin comparación' : 'Sin corridas')
              : `${up ? '▲' : '▼'} ${Math.abs(change).toFixed(1)} pp ${changeLabel ? `· ${changeLabel}` : ''}`}
          </div>

          {extra}

          {(produced != null || target != null) && hasEff && (
            <div className="ae-kpi-foot">
              <span>Prod. <b>{fmtInt(produced)}</b></span>
              <span>Meta <b>{target ? fmtInt(target) : '–'}</b></span>
              {cump != null && <span>{fmtPct(cump)}</span>}
            </div>
          )}
          {caption && <div className="ae-kpi-caption">{caption}</div>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chart pieces
 * ------------------------------------------------------------------ */
// Row under the pointer when a chart is clicked. Recharts 2 sends it as
// activePayload; Recharts 3 dropped that and only sends the index
// (activeTooltipIndex / activeIndex, sometimes as a string) and activeLabel.
// Handle all of them so clicks work on either version.
function clickedRow(state, data, labelKey) {
  const fromPayload = state?.activePayload?.[0]?.payload;
  if (fromPayload) return fromPayload;
  const idx = Number(state?.activeTooltipIndex ?? state?.activeIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < data.length) return data[idx];
  if (labelKey && state?.activeLabel != null) {
    return data.find((r) => String(r[labelKey]) === String(state.activeLabel));
  }
  return undefined;
}

function LineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0]?.payload || {};
  const cump = r.target ? (r.quantity / r.target) * 100 : null;
  const others = (r.styles || []).filter((x) => x && x !== r.currentStyle);
  return (
    <div className="ae-tip">
      <div className="ae-tip-head">Línea {r.lineNo}</div>
      <div className="ae-tip-row strong">
        <span>Eficiencia</span>
        <span style={{ color: effColor(r.efficiency) }}>{fmtPct1(r.efficiency)}</span>
      </div>
      <div className="ae-tip-row"><span>Producido</span><span>{fmtInt(r.quantity)}</span></div>
      <div className="ae-tip-row"><span>Meta</span><span>{fmtInt(r.target)}</span></div>
      <div className="ae-tip-row"><span>Cumplimiento</span><span>{cump == null ? '–' : fmtPct(cump)}</span></div>
      {r.currentStyle && (
        <div className="ae-tip-row">
          <span>{r.lastRunDate ? `Estilo · ${fmtYmdShort(r.lastRunDate)}` : 'Estilo'}</span>
          <span className="ae-tip-clip">{r.currentStyle}</span>
        </div>
      )}
      {others.length > 0 && (
        <div className="ae-tip-note">También corrió: {others.slice(0, 4).join(', ')}{others.length > 4 ? ` y ${others.length - 4} más` : ''}</div>
      )}
      <div className="ae-tip-note">Clic para ver su tendencia</div>
    </div>
  );
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const r = payload[0]?.payload || {};
  const cump = r.target ? (r.produced / r.target) * 100 : null;
  return (
    <div className="ae-tip">
      <div className="ae-tip-head">{r.tipLabel}</div>
      {r.efficiency == null ? (
        <div className="ae-tip-row"><span>Sin corridas</span></div>
      ) : (
        <>
          <div className="ae-tip-row strong">
            <span>Eficiencia</span>
            <span style={{ color: effColor(r.efficiency) }}>{fmtPct1(r.efficiency)}</span>
          </div>
          <div className="ae-tip-row"><span>Producido</span><span>{fmtInt(r.produced)}</span></div>
          <div className="ae-tip-row"><span>Meta</span><span>{r.target ? fmtInt(r.target) : '–'}</span></div>
          <div className="ae-tip-row"><span>Cumplimiento</span><span>{cump == null ? '–' : fmtPct(cump)}</span></div>
          <div className="ae-tip-row"><span>Corridas</span><span>{fmtInt(r.runs)}</span></div>
        </>
      )}
    </div>
  );
}

// X-axis tick for the line chart: "L3" plus the style running on the line.
// Wide bars get the style on a second line; narrow bars get it slanted so a
// full plant (20+ lines) stays readable. Full name in the native tooltip.
function LineTick({ x, y, payload, rows, band, slanted }) {
  const row = rows.find((r) => r.lineNo === payload.value);
  const style = row?.currentStyle || '';
  if (slanted) {
    const shown = style.length > 14 ? `${style.slice(0, 13)}…` : style;
    return (
      <g transform={`translate(${x},${y})`}>
        <text dy={12} textAnchor="middle" fontSize={11} fontWeight={500} fill={C.ink}>L{payload.value}</text>
        {shown && (
          <text transform="translate(4,24) rotate(-40)" textAnchor="end" fontSize={10} fill={C.muted}>
            <title>{style}</title>{shown}
          </text>
        )}
      </g>
    );
  }
  const maxChars = Math.max(4, Math.floor((band - 6) / 6));
  const shown = style.length > maxChars ? `${style.slice(0, maxChars - 1)}…` : style;
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fontWeight={500} fill={C.ink}>L{payload.value}</text>
      {shown && (
        <text dy={26} textAnchor="middle" fontSize={10} fill={C.muted}>
          <title>{style}</title>{shown}
        </text>
      )}
    </g>
  );
}

// Efficiency % above each bar, knocked out of the grid so reference lines
// passing behind it don't cross the number.
// Efficiency % above each point of the line history (same knock-out style).
function EffPointLabel({ x, y, value }) {
  if (value == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const t = `${Number(value).toFixed(1)}%`;
  const w = t.length * 6 + 6;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - 22} width={w} height={13} rx={3} fill={C.panel} />
      <text x={x} y={y - 12} textAnchor="middle" fontSize={10} fontWeight={600} fill={effColor(value)}>{t}</text>
    </g>
  );
}

function EffBarLabel({ x, y, width, value }) {
  if (value == null || !Number.isFinite(width) || width < 18) return null;
  const t = `${Number(value).toFixed(width < 34 ? 0 : 1)}%`;
  const w = t.length * 6 + 6;
  const cx = x + width / 2;
  return (
    <g pointerEvents="none">
      <rect x={cx - w / 2} y={y - 17} width={w} height={13} rx={3} fill={C.panel} />
      <text x={cx} y={y - 7} textAnchor="middle" fontSize={10} fontWeight={600} fill={effColor(value)}>{t}</text>
    </g>
  );
}

const STATUS_CHIP = {
  ended: { cls: 'good', text: (l) => `Terminó ${fmtYmdShort(l.lastDate)}` },
  in_progress: { cls: 'warn', text: (l) => (l.nextDate ? `Pendiente · sig. ${fmtYmdShort(l.nextDate)}` : 'En proceso') },
  scheduled: { cls: 'idle', text: (l) => (l.nextDate ? `Programada ${fmtYmdShort(l.nextDate)}` : 'Programada') },
  pending: { cls: 'idle', text: () => 'Sin producción' },
};
const ORDER_STATUS = {
  completed: { cls: 'good', label: 'Terminada' },
  in_progress: { cls: 'warn', label: 'En proceso' },
  assigned: { cls: 'idle', label: 'Asignada' },
  pending: { cls: 'idle', label: 'Pendiente' },
};

/* ------------------------------------------------------------------ *
 * Style side panel
 * ------------------------------------------------------------------ */
function StyleDrawer({ style, period, customer, onClose, onOpenLine }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dayScope, setDayScope] = useState('period');
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    let url = `/api/skyrina/style-production-detail?style=${encodeURIComponent(style)}`
      + `&startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;
    if (customer !== 'all') url += `&customer=${encodeURIComponent(customer)}`;
    apiGet(url, { headers: authHeaders() })
      .then((r) => {
        if (cancelled) return;
        if (r.data?.success) setData(r.data);
        else setError('No se pudo cargar el detalle del estilo.');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.status === 404
          ? 'Falta la ruta /api/skyrina/style-production-detail en el servidor.'
          : 'No se pudo cargar el detalle del estilo. Intenta de nuevo.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [style, period, customer]);

  const t = data?.totals;
  const progress = t?.totalToProduce ? Math.min((t.producedOnOrders / t.totalToProduce) * 100, 100) : null;

  const days = useMemo(() => {
    if (!data) return [];
    const s = ymd(period.start);
    const e = ymd(period.end);
    const list = dayScope === 'period' ? data.days.filter((d) => d.date >= s && d.date <= e) : data.days;
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || (parseInt(a.lineNo, 10) - parseInt(b.lineNo, 10)));
  }, [data, dayScope, period]);

  return (
    <div className="ae-drawer-wrap">
      <div className="ae-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="ae-drawer" role="dialog" aria-modal="true" aria-label={`Detalle del estilo ${style}`}>
        <header className="ae-drawer-head">
          <div className="ae-drawer-title">
            <h2 title={style}>{style}</h2>
            <p>
              {t?.firstDate
                ? `Producido del ${fmtYmdShort(t.firstDate)} al ${fmtYmdShort(t.lastDate)}`
                : 'Sin producción registrada'}
            </p>
          </div>
          <button ref={closeRef} type="button" className="ae-icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className="ae-drawer-body">
          {loading && (
            <>
              <div className="ae-skel" style={{ height: 120 }} />
              <div className="ae-skel" style={{ height: 160, marginTop: 14 }} />
            </>
          )}
          {!loading && error && <div className="ae-drawer-error">{error}</div>}

          {!loading && data && (
            <>
              <div className="ae-sum">
                <div>
                  <span>Total a producir</span>
                  <b>{t.totalToProduce == null ? '–' : fmtInt(t.totalToProduce)}</b>
                </div>
                <div>
                  <span>Producido</span>
                  <b>{fmtInt(t.producedOnOrders || t.producedAllTime)}</b>
                </div>
                <div>
                  <span>Pendiente</span>
                  <b style={{ color: t.pending > 0 ? C.warnInk : C.goodInk }}>
                    {t.pending == null ? '–' : fmtInt(t.pending)}
                  </b>
                </div>
                <div>
                  <span>Eficiencia · {period.label}</span>
                  <b style={{ color: t.efficiencyInPeriod == null ? C.faint : effColor(t.efficiencyInPeriod) }}>
                    {fmtPct1(t.efficiencyInPeriod)}
                  </b>
                </div>
              </div>
              {progress != null && (
                <div className="ae-progress" aria-label={`Avance ${Math.round(progress)}%`}>
                  <div className="ae-track ae-track-lg"><span style={{ width: `${progress}%`, background: C.blue }} /></div>
                  <span>{Math.round(progress)}% del total</span>
                </div>
              )}
              {t.totalToProduce == null && (
                <p className="ae-note">Este estilo no está ligado a ninguna orden de trabajo, así que no hay total a producir.</p>
              )}

              <section className="ae-dsec">
                <h3>Líneas que lo produjeron</h3>
                {data.lines.length === 0 ? (
                  <p className="ae-note">Ninguna línea ha corrido este estilo.</p>
                ) : (
                  <table className="ae-mini">
                    <thead>
                      <tr><th>Línea</th><th>Días</th><th className="r">Prod.</th><th className="r">Pend.</th><th className="r">Efic.</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                      {data.lines.map((l) => {
                        const chip = STATUS_CHIP[l.status] || STATUS_CHIP.pending;
                        return (
                          <tr key={l.lineNo}>
                            <td>
                              <button type="button" className="ae-link" onClick={() => onOpenLine(l.lineNo)} title="Ver tendencia de la línea">
                                {l.lineNo}
                              </button>
                            </td>
                            <td className="ae-dim">
                              {l.firstDate ? `${fmtYmdShort(l.firstDate)} – ${fmtYmdShort(l.lastDate)}` : '–'}
                            </td>
                            <td className="r">{fmtInt(l.produced)}</td>
                            <td className="r">{l.pending == null ? '–' : fmtInt(l.pending)}</td>
                            <td className="r" style={{ color: l.efficiency == null ? C.faint : effColor(l.efficiency), fontWeight: 500 }}>
                              {fmtPct1(l.efficiency)}
                            </td>
                            <td><span className={`ae-chip ${chip.cls}`}>{chip.text(l)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="ae-dsec">
                <h3>Órdenes de trabajo</h3>
                {data.orders.length === 0 ? (
                  <p className="ae-note">Sin órdenes de trabajo para este estilo.</p>
                ) : (
                  <ul className="ae-orders">
                    {data.orders.map((o) => {
                      const st = o.pending <= 0 && o.produced > 0
                        ? ORDER_STATUS.completed
                        : ORDER_STATUS[o.status] || ORDER_STATUS.pending;
                      const pct = o.totalToProduce ? Math.min((o.produced / o.totalToProduce) * 100, 100) : 0;
                      return (
                        <li key={o.id}>
                          <div className="ae-order-top">
                            <b>{o.workOrderNo}</b>
                            <span className={`ae-chip ${st.cls}`}>{st.label}</span>
                          </div>
                          <div className="ae-order-meta">
                            {[o.customer, o.color, o.lines.length ? `Líneas ${o.lines.join(', ')}` : null].filter(Boolean).join(' · ')}
                          </div>
                          <div className="ae-track"><span style={{ width: `${pct}%`, background: C.blue }} /></div>
                          <div className="ae-order-nums">
                            <span>Total <b>{fmtInt(o.totalToProduce)}</b></span>
                            <span>Prod. <b>{fmtInt(o.produced)}</b></span>
                            <span>Pend. <b style={{ color: o.pending > 0 ? C.warnInk : C.goodInk }}>{fmtInt(o.pending)}</b></span>
                          </div>
                          <div className="ae-order-dates">
                            {o.lastProductionDate ? `Último empaque ${fmtYmdShort(o.lastProductionDate)}` : 'Sin empaque aún'}
                            {o.commitmentDate && ` · Compromiso ${fmtYmdShort(o.commitmentDate)}`}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="ae-dsec">
                <div className="ae-dsec-head">
                  <h3>Producción por día</h3>
                  <Segmented
                    label="Rango de días"
                    value={dayScope}
                    onChange={setDayScope}
                    options={[
                      { value: 'period', label: period.label },
                      { value: 'all', label: 'Todo' },
                    ]}
                  />
                </div>
                {days.length === 0 ? (
                  <p className="ae-note">Sin producción de este estilo en {dayScope === 'period' ? 'el período' : 'el historial'}.</p>
                ) : (
                  <table className="ae-mini">
                    <thead>
                      <tr><th>Fecha</th><th>Línea</th><th className="r">Prod.</th><th className="r">Meta</th><th className="r">Efic.</th></tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={`${d.date}-${d.lineNo}`} title={[d.colors, d.orders.join(', ')].filter(Boolean).join(' · ')}>
                          <td>{fmtDay(d.date)}</td>
                          <td>{d.lineNo}</td>
                          <td className="r">{fmtInt(d.produced)}</td>
                          <td className="r">{fmtInt(d.target)}</td>
                          <td className="r" style={{ color: d.efficiency == null ? C.faint : effColor(d.efficiency), fontWeight: 500 }}>
                            {fmtPct1(d.efficiency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Messages tab (line leaders' low-efficiency reasons)
 * ------------------------------------------------------------------ */
function ReasonsTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const items = payload.filter((p) => (p.value || 0) > 0).slice().reverse();
  return (
    <div className="ae-tip">
      <div className="ae-tip-head">{fmtDay(row.date)}</div>
      {items.map((p) => (
        <div key={p.dataKey} className="ae-tip-row">
          <span><i className="ae-dot" style={{ background: p.color }} />{p.name}</span>
          <span>{Number(p.value).toFixed(0)}% ({row[`${p.dataKey}_count`]})</span>
        </div>
      ))}
      <div className="ae-tip-note">{row.total} motivo{row.total === 1 ? '' : 's'} · clic para ver detalle</div>
    </div>
  );
}

function MessagesPanel({ period, selectedLine }) {
  const [range, setRange] = useState('all');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selDate, setSelDate] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (range === 'filter') {
      params.append('startDate', ymd(period.start));
      params.append('endDate', ymd(period.end));
    } else if (range !== 'all') {
      const days = { last7: 7, last30: 30, last90: 90 }[range] || 30;
      const end = new Date();
      params.append('startDate', ymd(addDays(end, -(days - 1))));
      params.append('endDate', ymd(end));
    }
    if (selectedLine !== 'all') params.append('line', selectedLine);
    apiGet(`/api/efficiency-reasons?${params.toString()}`, { headers: authHeaders() })
      .then((r) => { if (!cancelled) setMessages(r.data?.success ? r.data.reasons || [] : []); })
      .catch((e) => {
        if (cancelled) return;
        setMessages([]);
        setError(e?.response?.data?.error || 'No se pudieron cargar los mensajes.');
      })
      .finally(() => { if (!cancelled) { setLoading(false); setSelDate(null); } });
    return () => { cancelled = true; };
  }, [range, period, selectedLine, reload]);

  const chartData = useMemo(() => {
    const byDate = {};
    messages.forEach((m) => {
      if (!m.run_date) return;
      byDate[m.run_date] = byDate[m.run_date] || {};
      (m.reasons || []).forEach((code) => {
        const k = EFFICIENCY_REASON_LABELS[code] ? code : 'others';
        byDate[m.run_date][k] = (byDate[m.run_date][k] || 0) + 1;
      });
    });
    return Object.keys(byDate).sort().map((date) => {
      const counts = byDate[date];
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const row = { date, total };
      Object.keys(EFFICIENCY_REASON_LABELS).forEach((code) => {
        const c = counts[code] || 0;
        row[code] = total ? (c / total) * 100 : 0;
        row[`${code}_count`] = c;
      });
      return row;
    }).filter((r) => r.total > 0);
  }, [messages]);

  const dayMessages = useMemo(() => {
    if (!selDate) return [];
    return messages
      .filter((m) => m.run_date === selDate)
      .sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0)
        || new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at));
  }, [messages, selDate]);

  const rangeLabel = range === 'filter' ? period.rangeText : MESSAGES_RANGE_OPTIONS.find((o) => o.value === range)?.label;

  return (
    <section className="ae-panel ae-messages">
      <PanelHead
        title="Motivos de baja eficiencia"
        subtitle={`${rangeLabel}${selectedLine !== 'all' ? ` · Línea ${selectedLine}` : ''} · ${messages.length} mensajes`}
      >
        <select className="ae-select" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Rango de mensajes">
          {MESSAGES_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" className="ae-clear" onClick={() => setReload((n) => n + 1)}>Actualizar</button>
      </PanelHead>

      <div className="ae-msg-legend">
        {Object.keys(EFFICIENCY_REASON_LABELS).map((k) => (
          <span key={k}><i style={{ background: REASON_COLORS[k] }} />{EFFICIENCY_REASON_LABELS[k]}</span>
        ))}
      </div>

      <div style={{ padding: '0 8px' }}>
        <ChartFrame
          height={320}
          loading={loading}
          empty={error || (chartData.length ? '' : 'Ningún líder de línea reportó motivos en este rango.')}
        >
          {(w, h) => (
            <BarChart
              width={w}
              height={h}
              data={chartData}
              margin={{ top: 14, right: 12, left: 0, bottom: 8 }}
              onClick={(s) => {
                const d = clickedRow(s, chartData, 'date')?.date;
                if (d) setSelDate((p) => (p === d ? null : d));
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtYmdShort} tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: C.grid }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={<ReasonsTooltip />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
              {Object.keys(EFFICIENCY_REASON_LABELS).map((code) => (
                <Bar key={code} dataKey={code} name={EFFICIENCY_REASON_LABELS[code]} stackId="r" fill={REASON_COLORS[code]} maxBarSize={44} isAnimationActive={false}>
                  {chartData.map((row) => (
                    <Cell key={`${code}-${row.date}`} fillOpacity={!selDate || selDate === row.date ? 1 : 0.3} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          )}
        </ChartFrame>
      </div>
      {!loading && !error && chartData.length > 0 && !selDate && (
        <p className="ae-hint" style={{ textAlign: 'center', paddingBottom: 10 }}>Haz clic en una barra para ver los mensajes de ese día.</p>
      )}

      {selDate && (
        <div className="ae-msg-day">
          <div className="ae-dsec-head">
            <h3>Mensajes del {fmtDay(selDate)} ({dayMessages.length})</h3>
            <button type="button" className="ae-clear" onClick={() => setSelDate(null)}>Quitar selección</button>
          </div>
          <div className="ae-table-scroll">
            <table className="ae-table">
              <thead>
                <tr>
                  <th className="ae-th"><span>Línea</span></th>
                  <th className="ae-th"><span>Motivos</span></th>
                  <th className="ae-th"><span>Nota</span></th>
                  <th className="ae-th"><span>Plan para mañana</span></th>
                  <th className="ae-th"><span>Enviado</span></th>
                </tr>
              </thead>
              <tbody>
                {dayMessages.map((m) => {
                  const edited = m.created_at && m.updated_at
                    && new Date(m.updated_at) - new Date(m.created_at) > 60000;
                  return (
                    <tr key={m.id} className="top">
                      <td>
                        Línea {m.line_no}
                        {m.efficiency != null && (
                          <div style={{ color: effColor(Number(m.efficiency)), fontSize: 11.5, fontWeight: 500 }}>
                            {fmtPct1(Number(m.efficiency))}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="ae-reasons">
                          {(m.reasons || []).map((code) => {
                            const k = EFFICIENCY_REASON_LABELS[code] ? code : 'others';
                            return <span key={code}><i style={{ background: REASON_COLORS[k] }} />{EFFICIENCY_REASON_LABELS[k]}</span>;
                          })}
                        </div>
                      </td>
                      <td className="wrap">{m.note || <span className="ae-dim">—</span>}</td>
                      <td className="wrap">{m.action_plan || <span className="ae-dim">—</span>}</td>
                      <td>
                        {formatSentTime(m.created_at || m.updated_at)}
                        {edited && <div className="ae-dim">Editado {formatSentTime(m.updated_at)}</div>}
                        {m.jefe_linea_name && <div className="ae-dim">{m.jefe_linea_name}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================================================================== *
 * Page
 * ================================================================== */
export default function ActualEfficiency({ embedded = false }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('performance');

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  /* ---- filters ---- */
  const [rangeType, setRangeType] = useState('day');
  const [selectedDate, setSelectedDate] = useState(ymd(today));
  const [selectedWeek, setSelectedWeek] = useState(weekString(today));
  const [selectedMonth, setSelectedMonth] = useState(ymd(today).slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()));
  const [customStart, setCustomStart] = useState(ymd(addDays(today, -29)));
  const [customEnd, setCustomEnd] = useState(ymd(today));
  const [selectedStyle, setSelectedStyle] = useState('all');
  const [selectedLine, setSelectedLine] = useState('all');
  const [selectedCustomer, setSelectedCustomer] = useState('all');

  const [availableStyles, setAvailableStyles] = useState([]);
  const [availableLines, setAvailableLines] = useState([]);
  const [availableCustomers, setAvailableCustomers] = useState([]);

  const weekOptions = useMemo(buildWeekOptions, []);
  const yearOptions = useMemo(() => {
    const y = today.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [today]);

  const period = useMemo(
    () => resolvePeriod({ rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd }),
    [rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd]
  );

  const chartScope = useMemo(
    () => resolveChartScope({ rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd }, today),
    [rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd, today]
  );

  // Bucket that matches the current selection, so the trend can highlight it.
  const selectedKey = useMemo(() => {
    switch (chartScope.bucket) {
      case 'week': return selectedWeek;
      case 'month': return selectedMonth;
      case 'year': return String(selectedYear);
      default: return rangeType === 'custom' ? null : selectedDate;
    }
  }, [chartScope.bucket, rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear]);

  // Click a trend bar -> select that día/semana/mes/año (everything reloads).
  const drillTo = useCallback((key) => {
    if (!key) return;
    if (chartScope.bucket === 'week') { setRangeType('week'); setSelectedWeek(key); }
    else if (chartScope.bucket === 'month') { setRangeType('month'); setSelectedMonth(key); }
    else if (chartScope.bucket === 'year') { setRangeType('year'); setSelectedYear(String(key)); }
    else { setRangeType('day'); setSelectedDate(key); }
  }, [chartScope.bucket]);

  /* ---- data ---- */
  const [rail, setRail] = useState({
    lastWeek: null, lastWeekChange: null,
    thisWeek: null, thisWeekChange: null,
    lastDay: null, lastDayChange: null, lastDayDate: null, prevDayDate: null,
  });
  const [railLoading, setRailLoading] = useState(true);
  const [realtime, setRealtime] = useState(null);
  const [rtUpdatedAt, setRtUpdatedAt] = useState('');
  const [periodSum, setPeriodSum] = useState({ current: null, previous: null });
  const [lineData, setLineData] = useState([]);
  const [styles, setStyles] = useState([]);
  const [rows, setRows] = useState([]);

  /* ---- view state ---- */
  const [lineOrder, setLineOrder] = useState('line');
  // Line whose history replaces the line chart (click a bar). null = all lines.
  const [focusLine, setFocusLine] = useState(null);
  const [historyChart, setHistoryChart] = useState('line'); // 'line' | 'bar'
  const [trendRows, setTrendRows] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendNote, setTrendNote] = useState('');
  const trendRef = useRef(null);

  const [styleQuery, setStyleQuery] = useState('');
  const [styleSort, setStyleSort] = useState('efficiency');
  const [drawerStyle, setDrawerStyle] = useState(null);

  const [sortKey, setSortKey] = useState('efficiency');
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
      .get('http://localhost:5000/api/me', { headers: { Authorization: `Bearer ${token}` } })
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

  /* ---------------- helpers ---------------- */
  const filterQS = useCallback(() => {
    let q = '';
    if (selectedStyle !== 'all') q += `&style=${encodeURIComponent(selectedStyle)}`;
    if (selectedLine !== 'all') q += `&lineNo=${encodeURIComponent(selectedLine)}`;
    if (selectedCustomer !== 'all') q += `&customer=${encodeURIComponent(selectedCustomer)}`;
    return q;
  }, [selectedStyle, selectedLine, selectedCustomer]);

  const summary = useCallback(async (start, end, qs = '') => {
    try {
      const res = await apiGet(
        `http://localhost:5000/api/skyrina/period-summary?startDate=${ymd(start)}&endDate=${ymd(end)}${qs}`,
        { headers: authHeaders() }
      );
      if (res.data?.success) {
        const s = res.data.summary;
        const runs = Number(s.totalRuns) || 0;
        return {
          produced: Number(s.totalSewed) || 0,
          target: Number(s.totalTarget) || 0,
          runs,
          efficiency: runs > 0 ? Number(s.avgEfficiency) || 0 : null,
        };
      }
    } catch (e) {
      console.error('period-summary failed', ymd(start), ymd(end), e?.message);
    }
    return { produced: 0, target: 0, runs: 0, efficiency: null };
  }, []);

  /* ---------------- dropdown options ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const headers = authHeaders();
    const qs = `startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;
    Promise.all([
      apiGet(`http://localhost:5000/api/skyrina/available-styles?${qs}`, { headers }).then((r) => (r.data?.success ? r.data.styles : [])).catch(() => []),
      apiGet(`http://localhost:5000/api/skyrina/available-lines?${qs}`, { headers }).then((r) => (r.data?.success ? r.data.lines : [])).catch(() => []),
      apiGet(`http://localhost:5000/api/skyrina/available-customers?${qs}`, { headers }).then((r) => (r.data?.success ? r.data.customers : [])).catch(() => []),
    ]).then(([s, l, c]) => {
      if (cancelled) return;
      setAvailableStyles(s);
      setAvailableLines(l);
      setAvailableCustomers(c);
      setSelectedStyle((prev) => (prev !== 'all' && !s.includes(prev) ? 'all' : prev));
      setSelectedLine((prev) => (prev !== 'all' && !l.includes(prev) ? 'all' : prev));
      setSelectedCustomer((prev) => (prev !== 'all' && c.length && !c.includes(prev) ? 'all' : prev));
    });
    return () => { cancelled = true; };
  }, [user, period]);

  /* ---------------- rail: weeks + last day (whole plant) ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      setRailLoading(true);
      const thisWeekStart = startOfWeek(today);
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      const prevWeekStart = addDays(lastWeekStart, -7);
      const prevWeekEnd = addDays(lastWeekStart, -1);
      const daysIntoWeek = Math.round((today - thisWeekStart) / 86400000);
      const lastWeekSameSpan = addDays(lastWeekStart, daysIntoWeek);

      // Last two days WITH runs before today — "Último día" skips Sundays,
      // holidays and shutdowns instead of showing an empty "ayer".
      const daysPromise = apiGet(
        `http://localhost:5000/api/skyrina/daily-production?startDate=${ymd(addDays(today, -21))}&endDate=${ymd(addDays(today, -1))}`,
        { headers: authHeaders() }
      )
        .then((r) => (r.data?.success ? r.data.days : []))
        .catch(() => []);

      const [lastWeek, prevWeek, thisWeek, lastWeekPartial, days] = await Promise.all([
        summary(lastWeekStart, lastWeekEnd),
        summary(prevWeekStart, prevWeekEnd),
        summary(thisWeekStart, today),
        summary(lastWeekStart, lastWeekSameSpan),
        daysPromise,
      ]);
      if (cancelled) return;

      const worked = days
        .map((d) => ({ ...d, date: String(d.date).slice(0, 10) }))
        .filter((d) => Number(d.runs) > 0)
        .sort((a, b) => b.date.localeCompare(a.date));
      const ld = worked[0];
      const pd = worked[1];
      const shape = (d) => (d ? {
        produced: Number(d.produced) || 0,
        target: Number(d.target) || 0,
        efficiency: Number(d.efficiency) || 0,
      } : null);

      setRail({
        lastWeek,
        lastWeekChange: ppChange(lastWeek.efficiency, prevWeek.efficiency),
        thisWeek,
        // same number of days into last week, so Monday isn't judged against a full week
        thisWeekChange: ppChange(thisWeek.efficiency, lastWeekPartial.efficiency),
        lastDay: shape(ld),
        lastDayDate: ld?.date || null,
        prevDayDate: pd?.date || null,
        lastDayChange: ld && pd ? ppChange(Number(ld.efficiency), Number(pd.efficiency)) : null,
      });
      setRailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, today, summary]);

  /* ---------------- rail: today (live, whole plant) ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiGet(`http://localhost:5000/api/skyrina/realtime-summary?date=${ymd(today)}`, { headers: authHeaders() });
        if (!cancelled && res.data?.success) {
          setRealtime(res.data);
          setRtUpdatedAt(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
        }
      } catch {
        /* keep last good snapshot */
      }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, today]);

  /* ---------------- panels (selected period + filters) ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const headers = authHeaders();
      const qs = filterQS();
      const range = `startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;
      try {
        const [current, previous, lineRes, styleRes, detailRes] = await Promise.all([
          summary(period.start, period.end, qs),
          summary(period.prevStart, period.prevEnd, qs),
          apiGet(`http://localhost:5000/api/skyrina/line-efficiency?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.lines : [])).catch(() => []),
          apiGet(`http://localhost:5000/api/skyrina/style-performance?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.styles : [])).catch(() => []),
          apiGet(`http://localhost:5000/api/skyrina/line-performance-detail?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.lines : [])).catch(() => []),
        ]);
        if (cancelled) return;
        setPeriodSum({ current, previous });
        setLineData(lineRes.map((l) => ({
          lineNo: String(l.lineNo),
          quantity: Number(l.quantity) || 0,
          target: Number(l.target) || 0,
          efficiency: Number(l.efficiency) || 0,
          currentStyle: l.currentStyle || '',
          lastRunDate: l.lastRunDate || null,
          styles: Array.isArray(l.styles) ? l.styles.filter(Boolean) : [],
        })));
        setStyles(styleRes);
        setRows(detailRes);
        setPage(0);
      } catch (err) {
        console.error('Efficiency load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, period, filterQS, summary]);

  // A focused line that the filters no longer include goes back to the plant.
  useEffect(() => {
    if (selectedLine !== 'all') setFocusLine(null);
  }, [selectedLine]);

  /* ---------------- line history (only when a line is selected) ---------------- */
  useEffect(() => {
    if (!user || focusLine == null) return undefined;
    let cancelled = false;
    setTrendLoading(true);
    setTrendNote('');
    let qs = '';
    if (selectedStyle !== 'all') qs += `&style=${encodeURIComponent(selectedStyle)}`;
    qs += `&lineNo=${encodeURIComponent(focusLine)}`;
    if (selectedCustomer !== 'all') qs += `&customer=${encodeURIComponent(selectedCustomer)}`;
    apiGet(
      `http://localhost:5000/api/skyrina/daily-production?startDate=${ymd(chartScope.start)}&endDate=${ymd(chartScope.end)}${qs}`,
      { headers: authHeaders() }
    )
      .then((r) => {
        if (cancelled) return;
        if (!r.data?.success || !Array.isArray(r.data.days)) throw new Error('bad response');
        setTrendRows(r.data.days.map((d) => {
          const runs = Number(d.runs) || 0;
          return {
            date: String(d.date).slice(0, 10),
            runs,
            produced: Number(d.produced) || 0,
            target: Number(d.target) || 0,
            efficiency: runs > 0 ? Number(d.efficiency) || 0 : null,
            samOutput: Number(d.samOutput) || 0,
            availableMinutes: Number(d.availableMinutes) || 0,
          };
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setTrendRows([]);
        setTrendNote('No se pudo cargar el historial (ruta /api/skyrina/daily-production).');
      })
      .finally(() => { if (!cancelled) setTrendLoading(false); });
    return () => { cancelled = true; };
  }, [user, chartScope, focusLine, selectedStyle, selectedCustomer]);

  // From the table or the style panel: show that line's history and scroll to it.
  const openLineHistory = useCallback((lineNo) => {
    setTab('performance');
    setDrawerStyle(null);
    setFocusLine(String(lineNo));
    requestAnimationFrame(() => trendRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  }, []);

  /* ---------------- derived ---------------- */
  const globalEff = periodSum.current?.efficiency ?? null;

  // Fallback when the server doesn't send currentStyle yet: the line's
  // biggest style in the period, from the line × style table.
  const fallbackStyle = useMemo(() => {
    const best = {};
    for (const r of rows) {
      const k = String(r.lineNo);
      const prod = Number(r.produced) || 0;
      if (!best[k] || prod > best[k].prod) best[k] = { style: r.style, prod };
    }
    return best;
  }, [rows]);

  const lineChartData = useMemo(() => {
    const d = lineData.map((l) => ({
      ...l,
      currentStyle: l.currentStyle || fallbackStyle[l.lineNo]?.style || '',
      styles: l.styles?.length ? l.styles : rows.filter((r) => String(r.lineNo) === l.lineNo).map((r) => r.style),
    }));
    if (lineOrder === 'desc') d.sort((a, b) => b.efficiency - a.efficiency);
    else if (lineOrder === 'asc') d.sort((a, b) => a.efficiency - b.efficiency);
    else d.sort((a, b) => (parseInt(a.lineNo, 10) || 0) - (parseInt(b.lineNo, 10) || 0));
    return d;
  }, [lineData, lineOrder, fallbackStyle, rows]);

  const lineCounts = useMemo(() => ({
    above: lineData.filter((l) => l.efficiency >= EFF_GOAL).length,
    below: lineData.filter((l) => l.efficiency < EFF_GOAL).length,
  }), [lineData]);

  const effMax = useMemo(() => {
    let m = 100;
    for (const l of lineChartData) m = Math.max(m, l.efficiency);
    return Math.ceil(m / 10) * 10;
  }, [lineChartData]);

  const trendData = useMemo(() => buildTrend(trendRows, chartScope), [trendRows, chartScope]);
  const trendMax = useMemo(() => {
    let m = 100;
    for (const t of trendData) if (t.efficiency != null) m = Math.max(m, t.efficiency);
    return Math.ceil(m / 10) * 10;
  }, [trendData]);
  const trendActive = trendData.filter((t) => t.efficiency != null).length;
  const trendHasSelected = trendData.some((t) => t.key === selectedKey);

  const styleList = useMemo(() => {
    const q = styleQuery.trim().toLowerCase();
    const list = styles
      .map((s) => ({
        name: s.style || 'No Style',
        target: Number(s.target) || 0,
        produced: Number(s.produced) || 0,
        efficiency: Number(s.efficiency) || 0,
        compliance: Number(s.target) ? (Number(s.produced) / Number(s.target)) * 100 : 0,
      }))
      .filter((s) => !q || s.name.toLowerCase().includes(q));
    if (styleSort === 'produced') list.sort((a, b) => b.produced - a.produced);
    else if (styleSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    else if (styleSort === 'low') list.sort((a, b) => a.efficiency - b.efficiency);
    else list.sort((a, b) => b.efficiency - a.efficiency);
    return list;
  }, [styles, styleQuery, styleSort]);

  const sortedRows = useMemo(() => {
    const copy = rows.map((r) => ({
      ...r,
      target: Number(r.target) || 0,
      produced: Number(r.produced) || 0,
      efficiency: Number(r.efficiency) || 0,
      compliance: Number(r.compliance) || 0,
    }));
    copy.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'lineNo') { av = parseInt(av, 10) || 0; bv = parseInt(bv, 10) || 0; }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const tableTotals = useMemo(() => {
    const target = rows.reduce((a, r) => a + (Number(r.target) || 0), 0);
    const produced = rows.reduce((a, r) => a + (Number(r.produced) || 0), 0);
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
      setSortDir(key === 'style' || key === 'lineNo' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const resetFilters = () => {
    setSelectedStyle('all');
    setSelectedLine('all');
    setSelectedCustomer('all');
  };
  const filtersActive = selectedStyle !== 'all' || selectedLine !== 'all' || selectedCustomer !== 'all';
  const scopeText = [
    selectedCustomer === 'all' ? 'Todos los clientes' : selectedCustomer,
    selectedStyle === 'all' ? 'Todos los estilos' : selectedStyle,
    selectedLine === 'all' ? 'Todas las líneas' : `Línea ${selectedLine}`,
  ].join(' · ');

  if (!user) {
    return (
      <div className="ae-boot">
        <div>
          <div className="ae-spin" />
          <p>Cargando eficiencia…</p>
        </div>
        <style>{css}</style>
      </div>
    );
  }

  const th = (key, label, align = 'left') => (
    <th
      className={`ae-th${align === 'right' ? ' right' : ''}`}
      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key && <span className="ae-caret">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );

  // ---- today card values ----
  const rt = realtime?.summary;
  const rtHasRuns = rt && (Number(rt.totalTarget) > 0 || Number(rt.totalProduced) > 0);
  const rtEnded = !!realtime?.productionEnded;
  const todayEff = rtHasRuns ? Number(rt.dailyEfficiency) || 0 : null;
  const todayRtEff = rtHasRuns && !rtEnded && rt.realtimeEfficiency != null ? Number(rt.realtimeEfficiency) : null;


  return (
    <div className="ae-page">
      {!embedded && <NavCeo />}

      <div className="ae-root">
        {/* ---------- title + filters ---------- */}
        <header className="ae-titlebar">
          <div className="ae-title">
            <h1>Eficiencia real</h1>
            <p>{period.rangeText} · {scopeText}</p>
          </div>

          <div className="ae-filters">
            <Segmented
              label="Vista"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'performance', label: 'Rendimiento' },
                { value: 'messages', label: 'Mensajes' },
              ]}
            />

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
                {weekOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {rangeType === 'month' && (
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} aria-label="Mes" />
            )}
            {rangeType === 'year' && (
              <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} aria-label="Año">
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            {rangeType === 'custom' && (
              <>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="Fecha inicial" />
                <span className="ae-dash">–</span>
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="Fecha final" />
              </>
            )}

            <select value={selectedCustomer} onChange={(e) => setSelectedCustomer(e.target.value)} aria-label="Cliente" className="wide">
              <option value="all">Todos los clientes</option>
              {availableCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {tab === 'performance' && (
              <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} aria-label="Estilo" className="wide">
                <option value="all">Todos los estilos</option>
                {availableStyles.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <select value={selectedLine} onChange={(e) => setSelectedLine(e.target.value)} aria-label="Línea">
              <option value="all">Todas las líneas</option>
              {availableLines.map((l) => <option key={l} value={l}>Línea {l}</option>)}
            </select>

            {filtersActive && (
              <button type="button" className="ae-clear" onClick={resetFilters}>Limpiar filtros</button>
            )}
          </div>
        </header>

        <div className={`ae-grid${tab === 'messages' ? ' ae-grid-msg' : ''}`}>
          {/* ---------- efficiency rail ---------- */}
          <aside className="ae-rail">
            <EffCard
              label="Semana pasada"
              sublabel="Eficiencia global · planta"
              efficiency={rail.lastWeek?.efficiency ?? null}
              change={rail.lastWeekChange}
              changeLabel="vs semana previa"
              produced={rail.lastWeek?.produced}
              target={rail.lastWeek?.target}
              loading={railLoading}
            />
            <EffCard
              label="Esta semana"
              sublabel="Eficiencia global · planta"
              efficiency={rail.thisWeek?.efficiency ?? null}
              change={rail.thisWeekChange}
              changeLabel="vs mismos días"
              produced={rail.thisWeek?.produced}
              target={rail.thisWeek?.target}
              loading={railLoading}
            />
            <EffCard
              label="Hoy"
              sublabel={fmtDay(ymd(today))}
              efficiency={todayEff}
              change={todayEff != null && rail.lastDay ? ppChange(todayEff, rail.lastDay.efficiency) : null}
              changeLabel="vs último día"
              produced={rtHasRuns ? Number(rt.totalProduced) : null}
              target={rtHasRuns ? Number(rt.totalTarget) : null}
              loading={!realtime && railLoading}
              badge={rtHasRuns && (rtEnded
                ? <span className="ae-badge fin">Final</span>
                : <span className="ae-badge live"><i className="ae-live-dot" />En vivo</span>)}
              extra={todayRtEff != null && (
                <div className="ae-kpi-rt">
                  <span>Ritmo actual</span>
                  <b style={{ color: effColor(todayRtEff) }}>{fmtPct1(todayRtEff)}</b>
                </div>
              )}
              caption={rtUpdatedAt && !rtEnded && rtHasRuns ? `Actualizado ${rtUpdatedAt}` : null}
            />
            <EffCard
              label="Último día"
              sublabel={rail.lastDayDate ? fmtDay(rail.lastDayDate) : 'Sin corridas recientes'}
              efficiency={rail.lastDay?.efficiency ?? null}
              change={rail.lastDayChange}
              changeLabel={rail.prevDayDate ? `vs ${fmtYmdShort(rail.prevDayDate)}` : undefined}
              produced={rail.lastDay?.produced}
              target={rail.lastDay?.target}
              loading={railLoading}
            />
            <EffCard
              label={period.label}
              sublabel={filtersActive ? 'Eficiencia global · con filtros' : 'Eficiencia global del período'}
              efficiency={globalEff}
              change={ppChange(globalEff, periodSum.previous?.efficiency ?? null)}
              changeLabel="vs período anterior"
              produced={periodSum.current?.produced}
              target={periodSum.current?.target}
              loading={loading}
              accent
            />
          </aside>

          {tab === 'messages' ? (
            <MessagesPanel period={period} selectedLine={selectedLine} />
          ) : (
            <>
              {/* ---------- eficiencia por línea (one chart) ----------
                  No line selected -> one bar per line for the selected period,
                  with the style running on each line under its label.
                  Line selected    -> that line's history in the same panel,
                  grouped like Overview: día -> días del mes, semana -> semanas
                  del mes, mes -> enero .. mes actual, año -> años. */}
              <section className="ae-panel ae-chart-top" ref={trendRef}>
                <PanelHead
                  title={focusLine ? `Línea ${focusLine} · historial` : 'Eficiencia por línea'}
                  subtitle={focusLine
                    ? `${chartScope.label} · ${trendActive} de ${trendData.length} ${TREND_NOUN[chartScope.bucket]} con producción`
                    : `${period.label} · ${lineCounts.above} líneas ≥ ${EFF_GOAL}% · ${lineCounts.below} debajo`}
                >
                  {focusLine ? (
                    <>
                      <Segmented
                        label="Tipo de gráfico"
                        value={historyChart}
                        onChange={setHistoryChart}
                        options={[{ value: 'line', label: 'Línea' }, { value: 'bar', label: 'Barras' }]}
                      />
                      <button type="button" className="ae-clear" onClick={() => setFocusLine(null)}>Ver todas las líneas</button>
                    </>
                  ) : (
                    <Segmented
                      label="Orden de líneas"
                      value={lineOrder}
                      onChange={setLineOrder}
                      options={[
                        { value: 'line', label: 'Línea' },
                        { value: 'desc', label: 'Mayor' },
                        { value: 'asc', label: 'Menor' },
                      ]}
                    />
                  )}
                </PanelHead>
                <div className="ae-chart-meta">
                  <BandKey />
                  <div className="ae-refkey"><span><i className="dash goal" />Meta {EFF_GOAL}%</span></div>
                </div>
                <p className="ae-hint">
                  {focusLine
                    ? `Haz clic en un punto para ver ese ${TREND_ONE[chartScope.bucket]}.`
                    : 'Debajo de cada línea, el estilo que está corriendo. Haz clic en una línea para ver su historial.'}
                </p>

                <div style={{ padding: '0 6px' }}>
                  {focusLine ? (
                    <ChartFrame
                      height={LINE_CHART_H}
                      loading={trendLoading}
                      empty={trendNote || (trendActive ? '' : `La línea ${focusLine} no tiene corridas en esta ventana.`)}
                    >
                      {(w, h) => (
                        <ComposedChart
                          width={w}
                          height={h}
                          data={trendData}
                          margin={{ top: 24, right: 16, left: 0, bottom: 4 }}
                          onClick={(st) => {
                            const row = clickedRow(st, trendData);
                            if (row && row.efficiency != null) drillTo(row.key);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <CartesianGrid stroke={C.grid} vertical={false} />
                          <XAxis
                            dataKey="axisLabel"
                            interval={trendData.length > 31 ? 'preserveStartEnd' : 0}
                            tick={{ fill: C.axis, fontSize: 11 }}
                            tickLine={false}
                            axisLine={{ stroke: C.grid }}
                          />
                          <YAxis domain={[0, trendMax]} tickFormatter={(v) => `${v}%`} tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                          <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
                          <ReferenceLine y={EFF_GOAL} stroke={C.effInk} strokeDasharray="6 4" strokeWidth={1.5} />
                          {historyChart === 'line' ? (
                            // Line trend: dots coloured by efficiency band, the
                            // selected día/semana/mes/año drawn larger with a ring.
                            // Buckets without runs leave a gap instead of a 0.
                            <Line
                              type="monotone"
                              dataKey="efficiency"
                              stroke={C.blue}
                              strokeWidth={2.5}
                              connectNulls={false}
                              isAnimationActive={false}
                              activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }}
                              dot={({ cx, cy, payload }) => {
                                if (payload.efficiency == null || !Number.isFinite(cy)) return <g key={payload.key} />;
                                const on = trendHasSelected && payload.key === selectedKey;
                                return (
                                  <circle
                                    key={payload.key}
                                    cx={cx}
                                    cy={cy}
                                    r={on ? 7 : 5}
                                    fill={effColor(payload.efficiency)}
                                    stroke={on ? C.ink : '#fff'}
                                    strokeWidth={on ? 2 : 1.5}
                                  />
                                );
                              }}
                            >
                              {trendData.length <= 31 && <LabelList dataKey="efficiency" content={<EffPointLabel />} />}
                            </Line>
                          ) : (
                            <Bar dataKey="efficiency" maxBarSize={52} isAnimationActive={false} cursor="pointer">
                              {trendData.map((t) => (
                                <Cell
                                  key={t.key}
                                  fill={t.efficiency == null ? C.grid : effColor(t.efficiency)}
                                  fillOpacity={!trendHasSelected || t.key === selectedKey ? 1 : 0.4}
                                  stroke={trendHasSelected && t.key === selectedKey ? C.ink : 'none'}
                                  strokeWidth={1}
                                />
                              ))}
                              {trendData.length <= 31 && <LabelList dataKey="efficiency" content={<EffBarLabel />} />}
                            </Bar>
                          )}
                        </ComposedChart>
                      )}
                    </ChartFrame>
                  ) : (
                    <ChartFrame
                      height={LINE_CHART_H}
                      loading={loading}
                      empty={lineChartData.length ? '' : 'Sin corridas en este período.'}
                    >
                      {(w, h) => {
                        const band = lineChartData.length ? (w - 60) / lineChartData.length : w;
                        const slanted = band < 52;
                        return (
                          <ComposedChart
                            width={w}
                            height={h + (slanted ? 36 : 0)}
                            data={lineChartData}
                            margin={{ top: 24, right: 16, left: 0, bottom: 4 }}
                            onClick={(st) => {
                              const ln = clickedRow(st, lineChartData, 'lineNo')?.lineNo;
                              if (ln != null) setFocusLine(String(ln));
                            }}
                            style={{ cursor: 'pointer' }}
                            barCategoryGap="18%"
                          >
                            <CartesianGrid stroke={C.grid} vertical={false} />
                            <XAxis
                              dataKey="lineNo"
                              interval={0}
                              height={slanted ? 76 : 40}
                              tick={<LineTick rows={lineChartData} band={band} slanted={slanted} />}
                              tickLine={false}
                              axisLine={{ stroke: C.grid }}
                            />
                            <YAxis domain={[0, effMax]} tickFormatter={(v) => `${v}%`} tick={{ fill: C.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                            <Tooltip content={<LineTooltip />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
                            <ReferenceLine y={EFF_GOAL} stroke={C.effInk} strokeDasharray="6 4" strokeWidth={1.5} />
                            <Bar dataKey="efficiency" maxBarSize={48} isAnimationActive={false} cursor="pointer">
                              {lineChartData.map((l) => (
                                <Cell
                                  key={l.lineNo}
                                  fill={effColor(l.efficiency)}
                                  fillOpacity={selectedLine === 'all' || selectedLine === l.lineNo ? 1 : 0.4}
                                />
                              ))}
                              <LabelList dataKey="efficiency" content={<EffBarLabel />} />
                            </Bar>
                          </ComposedChart>
                        );
                      }}
                    </ChartFrame>
                  )}
                </div>
              </section>

              {/* ---------- all styles ---------- */}
              <section className="ae-panel ae-styles">
                <PanelHead
                  title="Rendimiento por estilo"
                  subtitle={`${period.label} · ${styleList.length}${styleQuery ? ` de ${styles.length}` : ''} estilos`}
                >
                  <Segmented
                    label="Orden de estilos"
                    value={styleSort}
                    onChange={setStyleSort}
                    options={[
                      { value: 'efficiency', label: 'Mayor efic.' },
                      { value: 'low', label: 'Menor efic.' },
                      { value: 'produced', label: 'Producido' },
                      { value: 'name', label: 'A–Z' },
                    ]}
                  />
                </PanelHead>
                <div className="ae-search">
                  <input
                    type="search"
                    value={styleQuery}
                    onChange={(e) => setStyleQuery(e.target.value)}
                    placeholder="Buscar estilo"
                    aria-label="Buscar estilo"
                  />
                </div>

                <div className="ae-style-scroll">
                  {loading ? (
                    [1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="ae-skel ae-style-skel" />)
                  ) : styleList.length === 0 ? (
                    <div className="ae-empty">
                      {styles.length ? 'Ningún estilo coincide con la búsqueda.' : 'Sin estilos producidos en este período.'}
                    </div>
                  ) : (
                    <ul className="ae-style-list">
                      {styleList.map((s, i) => (
                        <li key={s.name}>
                          <button
                            type="button"
                            className={`ae-style-row${drawerStyle === s.name ? ' on' : ''}`}
                            onClick={() => setDrawerStyle(s.name)}
                            title={`Ver detalle de ${s.name}`}
                          >
                            <span className="ae-style-rank">{i + 1}.</span>
                            <span className="ae-style-name">{s.name}</span>
                            <span className="ae-style-bar">
                              <span className="ae-track">
                                <span style={{ width: `${Math.min(s.efficiency, 100)}%`, background: effColor(s.efficiency) }} />
                                <b style={{ left: `${EFF_GOAL}%` }} />
                              </span>
                              <span className="ae-style-nums">{fmtInt(s.produced)} / {fmtInt(s.target)} pzas · {fmtPct(s.compliance)}</span>
                            </span>
                            <span className="ae-style-eff" style={{ color: effColor(s.efficiency) }}>{fmtPct1(s.efficiency)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="ae-foot-note">Haz clic en un estilo para ver líneas, días y pendiente por producir.</p>
              </section>

              {/* ---------- line performance detail ---------- */}
              <section className="ae-panel ae-table-panel">
                <PanelHead title="Detalle por línea" subtitle={`${sortedRows.length} combinaciones línea × estilo`}>
                  <span className="ae-count good">≥ {EFF_GOAL}%: {lineCounts.above}</span>
                  <span className="ae-count bad">&lt; {EFF_GOAL}%: {lineCounts.below}</span>
                </PanelHead>

                <div className="ae-table-scroll">
                  <table className="ae-table">
                    <thead>
                      <tr>
                        {th('lineNo', 'Línea')}
                        {th('style', 'Estilo')}
                        {th('target', 'Meta', 'right')}
                        {th('produced', 'Prod', 'right')}
                        {th('compliance', 'Cump', 'right')}
                        {th('efficiency', 'Eficiencia', 'right')}
                      </tr>
                    </thead>
                    <tbody>
                      {loading && <tr><td colSpan={6} className="ae-empty">Cargando líneas…</td></tr>}
                      {!loading && !pageRows.length && (
                        <tr><td colSpan={6} className="ae-empty">Sin producción registrada en este período.</td></tr>
                      )}
                      {!loading && pageRows.map((r, i) => (
                        <tr key={`${r.lineNo}-${r.style}-${i}`}>
                          <td>
                            <button type="button" className="ae-link" onClick={() => openLineHistory(r.lineNo)} title={`Tendencia de la línea ${r.lineNo}`}>
                              {r.lineNo}
                            </button>
                          </td>
                          <td className="ae-name">
                            <button type="button" className="ae-link" onClick={() => setDrawerStyle(r.style)} title={`Detalle de ${r.style}`}>
                              {r.style}
                            </button>
                          </td>
                          <td className="ae-num">{fmtInt(r.target)}</td>
                          <td className="ae-num">{fmtInt(r.produced)}</td>
                          <td className="ae-num">{fmtPct(r.compliance)}</td>
                          <td className="ae-num">
                            <span className="ae-eff-cell">
                              <span className="ae-track"><span style={{ width: `${Math.min(r.efficiency, 100)}%`, background: effColor(r.efficiency) }} /></span>
                              <b style={{ color: effColor(r.efficiency) }}>{fmtPct1(r.efficiency)}</b>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {!loading && sortedRows.length > 0 && (
                      <tfoot>
                        <tr>
                          <td className="ae-total-label" colSpan={2}>Total del período</td>
                          <td className="ae-num">{fmtInt(tableTotals.target)}</td>
                          <td className="ae-num">{fmtInt(tableTotals.produced)}</td>
                          <td className="ae-num">{fmtPct(tableTotals.compliance)}</td>
                          <td
                            className="ae-num"
                            style={{ color: globalEff == null ? C.faint : effColor(globalEff) }}
                            title="Eficiencia global del período (ponderada por minutos disponibles)"
                          >
                            {fmtPct1(globalEff)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div className="ae-pager">
                  <span>{firstIdx} – {lastIdx} de {sortedRows.length}</span>
                  <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Página anterior">‹</button>
                  <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} aria-label="Página siguiente">›</button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {drawerStyle && (
        <StyleDrawer
          style={drawerStyle}
          period={period}
          customer={selectedCustomer}
          onClose={() => setDrawerStyle(null)}
          onOpenLine={openLineHistory}
        />
      )}

      <style>{css}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const css = `
.ae-page{min-height:100vh;background:${C.canvas};
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:${C.ink}}
.ae-root{padding:10px}

.ae-boot{min-height:100vh;background:${C.canvas};display:grid;place-items:center;text-align:center}
.ae-boot p{color:${C.muted};margin-top:14px;font-size:14px}
.ae-spin{width:44px;height:44px;border-radius:50%;border:3px solid ${C.grid};
  border-top-color:${C.blue};animation:aespin .9s linear infinite;margin:0 auto}
@keyframes aespin{to{transform:rotate(360deg)}}

.ae-titlebar{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:10px 16px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.ae-title h1{margin:0;font-size:17px;font-weight:500;letter-spacing:.2px}
.ae-title p{margin:2px 0 0;font-size:12px;color:${C.muted}}

.ae-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ae-filters select,.ae-filters input,.ae-select{background:${C.panel};color:${C.ink};border:1px solid ${C.edge};
  border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;cursor:pointer;max-width:210px}
.ae-filters select.wide{max-width:250px}
.ae-filters select:hover,.ae-filters input:hover{border-color:#bdc1c6}
.ae-filters select:focus-visible,.ae-filters input:focus-visible,.ae-select:focus-visible,.ae-search input:focus-visible{
  outline:none;border-color:${C.focus};box-shadow:0 0 0 3px rgba(66,133,244,.28)}
.ae-filters .ae-seg{margin-right:4px}
.ae-dash{color:${C.muted};font-size:13px}
.ae-clear{background:none;border:1px solid ${C.edge};border-radius:8px;padding:6px 12px;
  font-size:12.5px;font-family:inherit;color:${C.muted};cursor:pointer;white-space:nowrap}
.ae-clear:hover{background:${C.hover};color:${C.ink}}
.ae-clear:focus-visible{outline:2px solid ${C.focus};outline-offset:1px}

.ae-grid{display:grid;gap:10px;align-items:start;
  grid-template-columns:220px minmax(0,1fr) minmax(0,1.1fr);
  grid-template-areas:"rail chart chart" "rail styles table"}
.ae-grid-msg{grid-template-areas:"rail msg msg" "rail msg msg"}
.ae-rail{grid-area:rail;display:flex;flex-direction:column;gap:10px;min-width:0}
.ae-chart-top{grid-area:chart;scroll-margin-top:10px}
.ae-styles{grid-area:styles}
.ae-table-panel{grid-area:table}
.ae-messages{grid-area:msg}

.ae-panel{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;
  padding:0 0 4px;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.ae-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  padding:11px 14px 9px;border-bottom:1px solid ${C.grid};flex-wrap:wrap}
.ae-panel-titles h2{margin:0;font-size:13.5px;font-weight:500;color:${C.ink}}
.ae-panel-titles p{margin:2px 0 0;font-size:11.5px;color:${C.faint}}
.ae-panel-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

.ae-seg{display:inline-flex;border:1px solid ${C.edge};border-radius:7px;overflow:hidden}
.ae-seg button{background:${C.panel};border:none;border-right:1px solid ${C.edge};
  padding:5px 10px;font-size:11.5px;font-family:inherit;color:${C.muted};cursor:pointer;white-space:nowrap}
.ae-seg button:last-child{border-right:none}
.ae-seg button:hover{background:${C.hover};color:${C.ink}}
.ae-seg button.on{background:#e8f0fe;color:#1967d2;font-weight:500}
.ae-seg button:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}

/* ---- rail ---- */
.ae-kpi{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:11px 14px 12px}
.ae-kpi-accent{border-left:3px solid ${C.blue}}
.ae-kpi-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ae-kpi-label{color:${C.ink};font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-kpi-sub{color:${C.faint};font-size:11px;margin:1px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-kpi-value{font-size:28px;font-weight:400;line-height:1.1;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.ae-kpi-accent .ae-kpi-value{font-size:31px}
.ae-kpi-delta{margin-top:5px;font-size:11.5px;color:${C.faint}}
.ae-kpi-delta.up{color:${C.up}}
.ae-kpi-delta.down{color:${C.down}}
.ae-kpi-foot{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;padding-top:7px;border-top:1px solid ${C.grid};
  font-size:11px;color:${C.muted};font-variant-numeric:tabular-nums}
.ae-kpi-foot b{font-weight:500;color:${C.ink}}
.ae-kpi-caption{margin-top:6px;font-size:10.5px;color:${C.faint}}
.ae-kpi-rt{display:flex;justify-content:space-between;align-items:baseline;margin-top:7px;
  background:${C.head};border:1px solid ${C.grid};border-radius:6px;padding:5px 8px;font-size:11px;color:${C.muted}}
.ae-kpi-rt b{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}
.ae-ghost{background:${C.grid};border-radius:4px}
.ae-ghost-lg{height:30px;width:65%;margin-top:4px}
.ae-ghost-sm{height:5px;width:100%;margin-top:9px}
.ae-ghost-md{height:11px;width:50%;margin-top:9px}

.ae-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:500;
  padding:2px 7px;border-radius:999px;white-space:nowrap}
.ae-badge.live{background:${C.good};color:${C.goodInk}}
.ae-badge.fin{background:${C.grid};color:${C.muted}}
.ae-live-dot{width:6px;height:6px;border-radius:50%;background:${C.green};display:inline-block;
  animation:ae-pulse 1.4s ease-in-out infinite}
@keyframes ae-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}

.ae-track{position:relative;display:block;height:5px;border-radius:3px;background:${C.grid};margin-top:7px}
.ae-track > span{display:block;height:100%;border-radius:3px;transition:width .35s ease}
.ae-track > b{position:absolute;top:-2px;bottom:-2px;width:1.5px;background:${C.effInk};opacity:.55}
.ae-track-lg{height:7px}

/* ---- chart ---- */
.ae-chart-meta{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
  padding:8px 14px 0}
.ae-bands,.ae-refkey,.ae-msg-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:${C.muted}}
.ae-bands span,.ae-refkey span,.ae-msg-legend span{display:inline-flex;align-items:center;gap:5px}
.ae-bands i,.ae-msg-legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.ae-refkey i.dash{width:20px;height:0;border-top:2px dashed;display:inline-block}
.ae-refkey i.goal{border-color:${C.effInk}}
.ae-msg-legend{padding:8px 14px 2px}
.ae-hint{margin:0;padding:4px 14px 2px;font-size:11px;color:${C.faint}}
.ae-page .recharts-wrapper:focus,.ae-page .recharts-surface:focus{outline:none}
.ae-page .recharts-wrapper:focus-visible{outline:2px solid ${C.focus};outline-offset:2px;border-radius:4px}
.ae-page .recharts-surface:focus-visible{outline:none}
.ae-chart-empty{height:100%;display:grid;place-items:center;text-align:center;
  padding:0 24px;color:${C.muted};font-size:13px;line-height:1.5}
.ae-foot-note{margin:0;padding:6px 14px 8px;font-size:11px;color:${C.faint}}

.ae-tip{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:9px 11px;
  font-size:12px;color:${C.ink};box-shadow:0 2px 8px rgba(60,64,67,.2);min-width:160px}
.ae-tip-head{color:${C.muted};margin-bottom:5px;font-size:11.5px}
.ae-tip-row{display:flex;gap:14px;justify-content:space-between;line-height:1.7}
.ae-tip-row.strong{font-weight:500;border-bottom:1px solid ${C.grid};margin-bottom:3px;padding-bottom:3px}
.ae-tip-note{color:${C.faint};font-size:11px;margin-top:4px}
.ae-tip-clip{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-dot{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:6px}

/* ---- styles list ---- */
.ae-search{padding:8px 14px 4px}
.ae-search input{width:100%;box-sizing:border-box;border:1px solid ${C.edge};border-radius:8px;
  padding:7px 10px;font-size:13px;font-family:inherit;color:${C.ink};background:${C.panel}}
.ae-style-scroll{flex:1;overflow:auto;max-height:470px;min-height:200px;padding:2px 8px}
.ae-style-list{list-style:none;margin:0;padding:0}
.ae-style-row{width:100%;display:grid;grid-template-columns:26px minmax(80px,150px) minmax(0,1fr) 62px;
  align-items:center;gap:10px;background:none;border:none;border-radius:6px;padding:7px 6px;
  font:inherit;color:inherit;text-align:left;cursor:pointer}
.ae-style-row:hover{background:${C.hover}}
.ae-style-row.on{background:#e8f0fe}
.ae-style-row:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}
.ae-style-rank{color:${C.faint};font-size:11.5px;text-align:right;font-variant-numeric:tabular-nums}
.ae-style-name{font-size:12.5px;color:${C.blueInk};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-style-bar .ae-track{margin-top:0}
.ae-style-nums{display:block;margin-top:3px;font-size:10.5px;color:${C.faint};font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-style-eff{text-align:right;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.ae-style-skel{height:30px;margin:8px 6px}

/* ---- table ---- */
.ae-table-panel{display:flex;flex-direction:column;min-height:0}
.ae-table-scroll{flex:1;overflow:auto;min-height:0;max-height:520px}
.ae-table{width:100%;border-collapse:collapse;font-size:12.5px;color:${C.ink}}
.ae-th{position:sticky;top:0;z-index:1;background:${C.head};text-align:left;
  font-weight:500;font-size:12.5px;color:${C.muted};white-space:nowrap;border-bottom:1px solid ${C.edge};padding:0}
.ae-th button,.ae-th > span{display:block;width:100%;background:none;border:none;font:inherit;color:inherit;
  padding:9px 12px;text-align:inherit;cursor:pointer;box-sizing:border-box}
.ae-th > span{cursor:default}
.ae-th.right,.ae-th.right button{text-align:right}
.ae-th button:hover{background:${C.grid};color:${C.ink}}
.ae-th button:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}
.ae-caret{margin-left:5px;font-size:10px}
.ae-table tbody td{padding:8px 12px;border-bottom:1px solid ${C.grid};white-space:nowrap}
.ae-table tbody tr:hover{background:${C.hover}}
.ae-table tr.top td{vertical-align:top}
.ae-table td.wrap{white-space:pre-wrap;word-break:break-word;max-width:260px}
.ae-name{max-width:180px;overflow:hidden;text-overflow:ellipsis}
.ae-num{text-align:right;font-variant-numeric:tabular-nums}
.ae-eff-cell{display:inline-grid;grid-template-columns:56px 52px;align-items:center;gap:8px}
.ae-eff-cell .ae-track{margin-top:0}
.ae-eff-cell b{font-weight:500}
.ae-table tfoot td{position:sticky;bottom:0;background:${C.head};border-top:1px solid ${C.edge};
  padding:9px 12px;font-weight:500;white-space:nowrap}
.ae-total-label{color:${C.muted}}
.ae-empty{padding:22px 12px;text-align:center;color:${C.muted};font-size:13px}
.ae-link{display:inline-block;max-width:100%;vertical-align:bottom;background:none;border:none;font:inherit;
  color:${C.blueInk};cursor:pointer;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-link:hover{text-decoration:underline}
.ae-link:focus-visible{outline:2px solid ${C.focus};outline-offset:1px;border-radius:2px}
.ae-count{font-size:11.5px;font-weight:500;padding:3px 8px;border-radius:999px;font-variant-numeric:tabular-nums}
.ae-count.good{background:${C.good};color:${C.goodInk}}
.ae-count.bad{background:${C.bad};color:${C.badInk}}
.ae-dim{color:${C.faint};font-size:11.5px}

.ae-pager{display:flex;align-items:center;justify-content:flex-end;gap:6px;
  padding:8px 12px;font-size:12px;color:${C.muted};border-top:1px solid ${C.grid}}
.ae-pager button{background:none;border:none;color:${C.muted};font-size:17px;cursor:pointer;
  padding:0 6px;border-radius:3px;line-height:1}
.ae-pager button:hover:not(:disabled){color:${C.ink};background:${C.hover}}
.ae-pager button:disabled{opacity:.35;cursor:default}
.ae-pager button:focus-visible{outline:2px solid ${C.focus};outline-offset:1px}

/* ---- messages ---- */
.ae-msg-day{border-top:1px solid ${C.grid};margin-top:6px}
.ae-msg-day .ae-dsec-head{padding:10px 14px}
.ae-reasons{display:flex;flex-wrap:wrap;gap:4px}
.ae-reasons span{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;background:${C.head};
  border:1px solid ${C.grid};border-radius:999px;padding:2px 8px}
.ae-reasons i{width:7px;height:7px;border-radius:50%;display:inline-block}

/* ---- style side panel ---- */
.ae-drawer-wrap{position:fixed;inset:0;z-index:60}
.ae-drawer-scrim{position:absolute;inset:0;background:rgba(32,33,36,.32);animation:aefade .18s ease}
.ae-drawer{position:absolute;top:0;right:0;bottom:0;width:min(520px,100vw);background:${C.panel};
  box-shadow:-4px 0 18px rgba(60,64,67,.22);display:flex;flex-direction:column;animation:aeslide .22s ease}
@keyframes aefade{from{opacity:0}to{opacity:1}}
@keyframes aeslide{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}
.ae-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;
  padding:14px 16px 12px;border-bottom:1px solid ${C.grid}}
.ae-drawer-title{min-width:0}
.ae-drawer-title h2{margin:0;font-size:17px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-drawer-title p{margin:3px 0 0;font-size:12px;color:${C.muted}}
.ae-icon-btn{background:none;border:none;font-size:24px;line-height:1;color:${C.muted};cursor:pointer;
  width:32px;height:32px;border-radius:50%;flex:none}
.ae-icon-btn:hover{background:${C.hover};color:${C.ink}}
.ae-icon-btn:focus-visible{outline:2px solid ${C.focus};outline-offset:1px}
.ae-drawer-body{flex:1;overflow:auto;padding:14px 16px 24px}
.ae-drawer-error{background:${C.bad};color:${C.badInk};border-radius:6px;padding:10px 12px;font-size:13px}
.ae-sum{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ae-sum > div{background:${C.head};border:1px solid ${C.grid};border-radius:6px;padding:8px 10px;min-width:0}
.ae-sum span{display:block;font-size:11px;color:${C.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ae-sum b{display:block;font-size:20px;font-weight:400;margin-top:2px;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.ae-progress{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:11.5px;color:${C.muted};white-space:nowrap}
.ae-progress .ae-track{flex:1;margin-top:0}
.ae-note{margin:8px 0 0;font-size:12px;color:${C.faint};line-height:1.5}
.ae-dsec{margin-top:20px}
.ae-dsec h3{margin:0 0 8px;font-size:13px;font-weight:500}
.ae-dsec-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.ae-dsec-head h3{margin:0}
.ae-mini{width:100%;border-collapse:collapse;font-size:12px}
.ae-mini th{text-align:left;font-weight:500;color:${C.muted};font-size:11.5px;padding:6px 6px;
  border-bottom:1px solid ${C.edge};background:${C.head};white-space:nowrap}
.ae-mini td{padding:7px 6px;border-bottom:1px solid ${C.grid};white-space:nowrap;font-variant-numeric:tabular-nums}
.ae-mini .r{text-align:right}
.ae-chip{display:inline-block;font-size:11px;font-weight:500;padding:2px 8px;border-radius:999px;white-space:nowrap}
.ae-chip.good{background:${C.good};color:${C.goodInk}}
.ae-chip.warn{background:${C.warn};color:${C.warnInk}}
.ae-chip.idle{background:${C.idle};color:${C.idleInk}}
.ae-orders{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ae-orders li{border:1px solid ${C.grid};border-radius:6px;padding:9px 11px}
.ae-order-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px}
.ae-order-top b{font-weight:500}
.ae-order-meta{font-size:11.5px;color:${C.muted};margin-top:2px}
.ae-order-nums{display:flex;gap:14px;margin-top:6px;font-size:11.5px;color:${C.muted};font-variant-numeric:tabular-nums}
.ae-order-nums b{font-weight:500;color:${C.ink}}
.ae-order-dates{font-size:11px;color:${C.faint};margin-top:4px}

.ae-skel{height:100%;width:100%;border-radius:4px;
  background:linear-gradient(90deg,#f1f3f4 25%,#e8eaed 50%,#f1f3f4 75%);
  background-size:200% 100%;animation:aeshimmer 1.4s ease-in-out infinite}
@keyframes aeshimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.ae-table-scroll::-webkit-scrollbar,.ae-style-scroll::-webkit-scrollbar,.ae-drawer-body::-webkit-scrollbar{width:9px;height:9px}
.ae-table-scroll::-webkit-scrollbar-thumb,.ae-style-scroll::-webkit-scrollbar-thumb,.ae-drawer-body::-webkit-scrollbar-thumb{background:#c4c7c5;border-radius:5px}

@media (max-width:1280px){
  .ae-grid{grid-template-columns:190px minmax(0,1fr) minmax(0,1fr)}
  .ae-style-row{grid-template-columns:22px minmax(70px,120px) minmax(0,1fr) 56px}
}
@media (max-width:1080px){
  .ae-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    grid-template-areas:"rail rail" "chart chart" "styles table"}
  .ae-grid-msg{grid-template-areas:"rail rail" "msg msg"}
  .ae-rail{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
}
@media (max-width:860px){
  .ae-grid{grid-template-columns:1fr;grid-template-areas:"rail" "chart" "styles" "table"}
  .ae-grid-msg{grid-template-areas:"rail" "msg"}
  .ae-rail{grid-template-columns:1fr 1fr}
  .ae-rail .ae-kpi-accent{grid-column:1 / -1}
}
@media (max-width:620px){
  .ae-filters{width:100%}
  .ae-filters select,.ae-filters input{flex:1 1 140px;max-width:none}
  .ae-panel-head{flex-direction:column;align-items:stretch}
  .ae-style-row{grid-template-columns:minmax(0,1fr) 56px}
  .ae-style-rank{display:none}
  .ae-style-bar{grid-column:1 / -1;grid-row:2}
  .ae-sum b{font-size:17px}
}
@media (prefers-reduced-motion:reduce){
  .ae-skel,.ae-spin,.ae-live-dot,.ae-drawer,.ae-drawer-scrim{animation:none}
  .ae-track > span{transition:none}
}
`;