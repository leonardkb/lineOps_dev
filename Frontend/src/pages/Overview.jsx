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
//   /api/skyrina/available-customers     -> cliente dropdown
//   /api/skyrina/realtime-summary        -> "Hoy · Tiempo real" KPI card
//
// The "Hoy · Tiempo real" card shows three figures, matching SkyrinaDashboard:
// Producido, META RT and Diario (settled SAM efficiency). realtime-summary
// pro-rates today's Meta by how far into the shift we are (8:00 -> last slot end)
// using PLANT-LOCAL time, so it reports the same META RT the browser-side
// SkyrinaDashboard shows (computing it in the server's own timezone inflated the
// elapsed fraction — 96% / 8,503 instead of 34.8% / 3,100). Like the other rail
// cards it is ALWAYS scoped to *today*, independent of the selected period, and
// it re-polls on an interval while the shift is running. The RT math lives on the
// server so the two dashboards can't drift apart — same rule as the efficiency
// note above.
//
// Piezas equivalentes (mismo criterio que PlanBoard.jsx): eq/pza = SAM ÷
// equivalencia, piezas eq = piezas × eq/pza. Como daily-production ya devuelve
// samOutput = SUM(empacado × SAM), aquí se reduce a samOutput ÷ EQUIVALENCE
// (= 10, el factor global del merchant). Sólo la ruta daily-production trae
// samOutput; en el fallback día-por-día (period-summary) las piezas eq quedan
// en null y la vela simplemente no se dibuja.
//
// El gráfico muestra UNA unidad a la vez (segmented "Unidad": Piezas /
// Equivalentes): barra = producido, línea = meta, ambas en la misma unidad. Las
// cuatro cifras (meta, producido, meta eq, producido eq) y los dos
// cumplimientos viven en el tooltip, que es donde caben sin encimarse.
//
// La META es el objetivo EN PIEZAS EQUIVALENTES. Ojo: line_runs.target_pcs se
// guarda en piezas reales (= operarios × horas × 60 × eficiencia ÷ SAM), así que
// para compararla con las piezas eq hay que multiplicarla por su propio SAM y
// dividir entre la equivalencia — eso es `samTarget` (ver metaEqOf). Con el
// checkbox "Piezas eq." encendido, la línea de Meta y el cumplimiento del
// tooltip pasan a esa unidad; apagado, el gráfico vuelve a piezas reales, que es
// lo que muestran los KPIs y la tabla.
//
// Monitor de producción: the default export is a two-tab page —
//   Producción diaria    -> DailyProduction (this file)
//   Eficiencia por línea -> ActualEfficiency.jsx, rendered with `embedded`
// The active tab lives in the URL (?tab=eficiencia) so it survives a reload and
// can be linked. Each tab mounts on first visit and then stays mounted (just
// hidden), so switching back and forth keeps filters and doesn't refetch.
//
// Every read below (KPIs, series, style, line, dropdowns, realtime) also honours
// an optional customer filter (?customer=), resolved through
// line_runs.work_order_id -> work_orders.customer_name.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, ReferenceLine, Cell,
} from 'recharts';

import NavCeo from '../components/NavCeo';
import ActualEfficiency from './ActualEfficiency';

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
  eq: '#26a69a', eqInk: '#00796b',
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

// Redondeo "bonito" hacia arriba (5, 10, 50, 100, 500…) para el tope del eje.
const niceCeil = (v) => {
  const n = Number(v) || 0;
  if (n <= 0) return 0;
  const step = Math.pow(10, Math.floor(Math.log10(n))) / 2;
  return Math.ceil(n / step) * step;
};

const TOP_CHART_H = 292;
const STYLE_CHART_H = 344;
const PAGE_SIZE = 10;
// Without /api/skyrina/daily-production the series falls back to one request per
// day, so long ranges are refused rather than firing hundreds of calls.
const MAX_FALLBACK_DAYS = 62;

/* ------------------------------------------------------------------ *
 * Piezas equivalentes — misma cuenta que PlanBoard.jsx
 *
 * En el tablero:  eq/pza = SAM ÷ equivalencia ; piezas eq = piezas × eq/pza.
 * Aquí no hace falta el SAM por estilo: /api/skyrina/daily-production ya
 * devuelve samOutput = SUM(empacado × SAM) del día (el mismo numerador de la
 * eficiencia), así que
 *
 *     piezas equivalentes = samOutput ÷ equivalencia
 *
 * es exactamente lo que calcula el tablero, sólo que agregado por día.
 *
 * El factor es global y su dueño es el merchant (PlanBoard lo lee de
 * /api/merchant-plan y cae en 10 si no viene). Aquí se fija en ese mismo 10;
 * si algún día se quiere dinámico, basta leer `equivalence` de esa ruta y
 * guardarlo en estado — el resto del cálculo no cambia.
 * ------------------------------------------------------------------ */
const EQUIVALENCE = 10;

// Devuelve null (no 0) cuando el día no trae SAM, para que la vela no aparezca
// en cero y se note que falta el dato en vez de mentir un vacío.
const toEqPieces = (samMinutes) => {
  const eq = Number(EQUIVALENCE) > 0 ? Number(EQUIVALENCE) : 10;
  const sm = Number(samMinutes) || 0;
  return sm > 0 ? sm / eq : null;
};

/* La Meta se guarda en PIEZAS REALES del estilo que corre:
 *   target_pcs = operarios × horas × 60 × eficiencia ÷ SAM
 * así que para compararla contra las piezas equivalentes hay que pasarla por el
 * mismo factor: meta eq = SUM(target_pcs × SAM) ÷ equivalencia. Ese SUM es
 * `samTarget` y lo tiene que dar el servidor por crew (día, línea, estilo),
 * porque el SAM cambia con la mezcla de estilos del día.
 *
 * Si la ruta todavía no lo manda, se aproxima con el SAM promedio de lo
 * empacado ese día (samOutput ÷ piezas). Es exacto cuando corrió un solo
 * estilo y se marca con "≈" en el tooltip cuando no.
 */
const metaEqOf = ({ samTarget, target, samOutput, produced }) => {
  if (Number(samTarget) > 0) return { metaEq: toEqPieces(samTarget), metaEqApprox: false };
  if (Number(target) > 0 && Number(produced) > 0 && Number(samOutput) > 0) {
    return { metaEq: toEqPieces(target * (samOutput / produced)), metaEqApprox: true };
  }
  return { metaEq: null, metaEqApprox: false };
};

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
 * Trend-chart scope — the top chart shows a *series of buckets* whose
 * granularity follows the selected period, independent of the KPI `period`:
 *   día    -> one bar per DAY   across the selected date's month, plus
 *             context from the previous month: the LEAD_IN_DAYS before the
 *             1st, or every previous-month day with runs when "Solo con
 *             corridas" is on (the whole previous month is fetched once)
 *   semana -> one bar per WEEK  across the weeks touching that month
 *   mes    -> one bar per MONTH (Enero .. mes actual del año elegido)
 *   año    -> one bar per YEAR  (año actual y el siguiente: 2026, 2027)
 *   rango  -> one bar per DAY   across the custom range (sin cambios)
 * Los KPIs, la tabla y los estilos siguen usando el período puntual.
 * ------------------------------------------------------------------ */
const TREND_NOUN = { day: 'días', week: 'semanas', month: 'meses', year: 'años' };

// Días del mes anterior que se muestran como contexto en la vista "Día".
const LEAD_IN_DAYS = 7;

function resolveChartScope(state, today) {
  const { rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd } = state;

  switch (rangeType) {
    case 'week': {
      const wStart = weekStart(selectedWeek);
      const mid = addDays(wStart, 3); // Thursday decides the owning month
      const mStart = new Date(mid.getFullYear(), mid.getMonth(), 1);
      const mEnd = new Date(mid.getFullYear(), mid.getMonth() + 1, 0);
      return {
        bucket: 'week',
        start: startOfWeek(mStart),
        end: addDays(startOfWeek(mEnd), 6),
        label: `Por semana · ${sentence(mStart.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))}`,
      };
    }
    case 'month': {
      const y = Number(selectedMonth.split('-')[0]) || today.getFullYear();
      const lastMonth = y === today.getFullYear() ? today.getMonth() : 11;
      return {
        bucket: 'month',
        start: new Date(y, 0, 1),
        end: new Date(y, lastMonth + 1, 0),
        label: `Por mes · ${y}`,
      };
    }
    case 'year': {
      const y = Number(selectedYear) || today.getFullYear();
      const from = Math.min(y, today.getFullYear());
      const to = Math.max(y, today.getFullYear() + 1);
      return {
        bucket: 'year',
        start: new Date(from, 0, 1),
        end: new Date(to, 11, 31),
        label: `Por año · ${from}–${to}`,
      };
    }
    case 'custom': {
      let s = fromYMD(customStart);
      let e = fromYMD(customEnd);
      if (e < s) [s, e] = [e, s];
      return { bucket: 'day', start: s, end: e, label: `Por día · ${fmtShort(s)} – ${fmtShort(e)}` };
    }
    case 'day':
    default: {
      const d = fromYMD(selectedDate);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        bucket: 'day',
        // Fetch the whole previous month; focusStart marks where the selected
        // month begins. chartData decides how much of that context is shown.
        start: new Date(d.getFullYear(), d.getMonth() - 1, 1),
        end: mEnd,
        focusStart: mStart,
        label: `Por día · ${sentence(mStart.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))}`,
      };
    }
  }
}

// Fold the raw per-day rows (each carrying samOutput + availableMinutes) into
// day/week/month/year buckets. Efficiency is re-derived the SAME way the server
// does it — SUM(samOutput) / SUM(availableMinutes) — never by averaging the
// per-day percentages, which would give a slow day an equal vote. Piezas
// equivalentes viajan igual: SUM(samOutput) ÷ equivalencia.
function bucketDays(rows, bucket, focusStart) {
  if (bucket === 'day') {
    return rows.map((d, i) => {
      const dt = fromYMD(d.date);
      return {
        key: d.date,
        // Días previos al mes elegido: se dibujan atenuados y no entran en los
        // totales del pie del gráfico.
        lead: !!focusStart && dt < focusStart,
        // Just the day number keeps a full month of ticks legible and in order;
        // the 1st of each month (and the first bar) carries the short month.
        axisLabel: dt.getDate() === 1 || i === 0 ? fmtShort(dt) : String(dt.getDate()),
        tipLabel: fmtDayLabel(d.date),
        sortAt: dt.getTime(),
        runs: d.runs,
        produced: d.produced,
        target: d.target,
        efficiency: d.efficiency,
        samOutput: d.samOutput || 0,
        samTarget: d.samTarget || 0,
        // piezas equivalentes del día = samOutput ÷ equivalencia
        eqPcs: toEqPieces(d.samOutput),
        ...metaEqOf(d),
      };
    });
  }

  const groups = new Map();
  for (const d of rows) {
    const date = fromYMD(d.date);
    let key;
    let axisLabel;
    let tipLabel;
    if (bucket === 'week') {
      key = weekString(date);
      const ws = weekStart(key);
      const n = key.split('-W')[1];
      axisLabel = `S${n}`;
      tipLabel = `Semana ${n} · ${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`;
    } else if (bucket === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      axisLabel = sentence(date.toLocaleDateString('es-MX', { month: 'short' }).replace(/\./g, ''));
      tipLabel = sentence(date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
    } else {
      key = String(date.getFullYear());
      axisLabel = key;
      tipLabel = key;
    }

    let g = groups.get(key);
    if (!g) {
      g = { key, axisLabel, tipLabel, sortAt: date.getTime(),
            runs: 0, produced: 0, target: 0, samOutput: 0, samTarget: 0,
            availableMinutes: 0, hasTarget: false };
      groups.set(key, g);
    }
    g.runs += d.runs || 0;
    g.produced += d.produced || 0;
    if (d.target != null) { g.target += d.target; g.hasTarget = true; }
    g.samOutput += d.samOutput || 0;
    g.samTarget += d.samTarget || 0;
    g.availableMinutes += d.availableMinutes || 0;
  }

  return [...groups.values()]
    .sort((a, b) => a.sortAt - b.sortAt)
    .map((g) => ({
      key: g.key,
      axisLabel: g.axisLabel,
      tipLabel: g.tipLabel,
      sortAt: g.sortAt,
      runs: g.runs,
      produced: g.produced,
      target: g.hasTarget ? g.target : null,
      efficiency: g.availableMinutes > 0 ? (g.samOutput / g.availableMinutes) * 100 : null,
      samOutput: g.samOutput,
      samTarget: g.samTarget,
      // Las piezas equivalentes se suman por samOutput, nunca promediando las
      // de cada día: un día corto no puede pesar igual que uno completo.
      eqPcs: toEqPieces(g.samOutput),
      ...metaEqOf({
        samTarget: g.samTarget,
        target: g.hasTarget ? g.target : 0,
        samOutput: g.samOutput,
        produced: g.produced,
      }),
    }));
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
 * "Hoy · Tiempo real" card — the rail's real-time twin of SkyrinaDashboard's
 * META / META RT / DIARIO tiles. Values arrive pre-computed from
 * /api/skyrina/realtime-summary; nothing is derived here (see header note).
 * Shows exactly three figures, as requested:
 *   - Producido : pieces packed so far today (big number)
 *   - Meta RT   : Meta pro-rated to the elapsed part of the shift, plus its
 *                 share of the full day Meta
 *   - Diario    : settled daily SAM efficiency (same value as SkyrinaDashboard's
 *                 DIARIO tile). The live "Ef. RT" figure is intentionally omitted.
 * ------------------------------------------------------------------ */
function RealtimeKpiCard({ data, loading, updatedAt }) {
  const s = data?.summary;
  const ended = !!data?.productionEnded;

  const meta = s?.totalTarget ?? null;
  const metaRt = s?.realtimeTarget ?? null;
  const prod = s?.totalProduced ?? null;

  // Only three figures, matching SkyrinaDashboard's request: Producido (big),
  // Meta RT, and Diario (settled daily efficiency). No live RT efficiency here.
  const dailyEff = s?.dailyEfficiency ?? null;
  const hasEff = dailyEff != null;

  const metaShare = meta ? (metaRt / meta) * 100 : null;
  const hasData = data && prod != null;

  return (
    <div className="dp-kpi dp-kpi-tall dp-kpi-rt">
      <div className="dp-rt-head">
        <span className="dp-kpi-label" title="Producción de hoy en tiempo real">Hoy · Tiempo real</span>
        {!loading && hasData && (
          ended ? (
            <span className="dp-rt-badge fin">Final</span>
          ) : (
            <span className="dp-rt-badge live"><i className="dp-live-dot" />En vivo</span>
          )
        )}
      </div>

      {loading && !hasData ? (
        <>
          <div className="dp-kpi-ghost dp-kpi-ghost-lg" />
          <div className="dp-kpi-ghost dp-kpi-ghost-md" />
        </>
      ) : (
        <>
          <div className="dp-kpi-value">{prod != null ? fmtInt(prod) : '–'}</div>
          <div className="dp-kpi-delta" title="Piezas empacadas hoy">Producido</div>

          <div className="dp-rt-grid">
            <div className="dp-rt-cell">
              <div className="dp-rt-k">Meta RT</div>
              <div className="dp-rt-v">{metaRt == null ? '–' : fmtInt(metaRt)}</div>
              <div className="dp-rt-sub">
                {metaShare == null ? 'Sin meta' : `${Math.round(metaShare)}% de ${fmtInt(meta)}`}
              </div>
            </div>
            <div className="dp-rt-cell">
              <div className="dp-rt-k">Diario</div>
              <div className="dp-rt-v" style={{ color: hasEff ? effColor(dailyEff) : C.faint }}>
                {fmtPct1(dailyEff)}
              </div>
              <div className="dp-rt-sub">Eficiencia SAM</div>
            </div>
          </div>

          <div className="dp-kpi-eff-track" aria-hidden="true" style={{ marginTop: 9 }}>
            <span
              style={{
                width: `${Math.min(Math.max(Number(dailyEff) || 0, 0), 100)}%`,
                background: hasEff ? effColor(dailyEff) : 'transparent',
              }}
            />
          </div>

          {updatedAt && !ended && <div className="dp-kpi-caption">Actualizado {updatedAt}</div>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chart pieces
 * ------------------------------------------------------------------ */
function BucketTick({ x, y, payload, index, data }) {
  const i = index ?? payload?.index ?? 0;
  const row = data?.[i] || {};
  // Single baseline, one label per bucket, left-to-right in date order.
  return (
    <text x={x} y={y + 14} fill={C.axis} fontSize={11} textAnchor="middle">
      {row.axisLabel ?? payload?.value}
    </text>
  );
}

// Produced quantity + SAM efficiency for each bar of the trend chart.
// - Produced: inside the bar (white) when it fits, otherwise just above it.
// - Efficiency: always above the produced number, in its band colour, so it
//   reads the same as the efficiency line / KPI cards. Server value, verbatim.
// This is rendered by the overlay bar that sits AFTER the Meta / Eficiencia
// lines, so the labels paint on top of them. Each number gets a knock-out
// background (white pill for the %, bar-coloured halo for the quantity) so a
// line passing behind a number stops at its edge instead of crossing it.
// `data`, `showEff`, `selectedKey`, `barColor`, `barColorSel` come from the
// chart; recharts adds `index`.
function BarValueLabel({
  x, y, width, height, value, index, data, showEff,
  selectedKey, barColor = C.blue, barColorSel = C.blueInk,
}) {
  if (!value || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 26) return null; // too narrow to read
  const cx = x + width / 2;
  const inside = height >= 26;

  const eff = showEff ? data?.[index]?.efficiency : null;
  const hasEff = eff != null && Number.isFinite(Number(eff));
  // Up to two decimals when the value has them (44.77%), at least one
  // otherwise (85.3%, 80.0%) — trailing zero of the 2nd decimal is dropped.
  let effText = null;
  if (hasEff) {
    let t = Number(eff).toFixed(2);
    if (t.endsWith('0')) t = t.slice(0, -1);
    effText = `${t}%`;
  }

  const prodY = inside ? y + 15 : y - 5;
  const effY = inside ? y - 6 : y - 20;

  const row = data?.[index];
  const fillUnder = row && row.key === selectedKey ? barColorSel : barColor;
  // Halo colour = whatever is behind the number: the bar itself, or the panel.
  const prodHalo = inside ? fillUnder : C.panel;

  // Pill sized to the text (≈6.1 px per char at 10 px semibold).
  const pillW = effText ? effText.length * 6.1 + 8 : 0;
  const pillH = 14;

  return (
    <g pointerEvents="none">
      <text
        x={cx}
        y={prodY}
        fill={inside ? '#ffffff' : C.muted}
        fontSize={11}
        textAnchor="middle"
        stroke={prodHalo}
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {fmtInt(value)}
      </text>
      {hasEff && (
        <>
          <rect
            x={cx - pillW / 2}
            y={effY - 10.5}
            width={pillW}
            height={pillH}
            rx={3}
            fill={C.panel}
          />
          <text
            x={cx}
            y={effY}
            fill={effColor(eff)}
            fontSize={10}
            fontWeight={600}
            textAnchor="middle"
          >
            {effText}
          </text>
        </>
      )}
    </g>
  );
}

/* Tooltip: las CUATRO cifras del bucket, agrupadas por unidad, con la unidad
 * activa del gráfico marcada en negritas. Así el gráfico puede mostrar una sola
 * unidad (legible) sin esconder la otra. */
function DailyTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const { target: meta, produced: prod, eqPcs: eqp, metaEq, efficiency: eff } = row;
  const hasRuns = meta != null || row.runs > 0;

  const cumpPz = meta ? (prod / meta) * 100 : null;
  // El factor se cancela en esta división: cumplimiento eq = SAM producido ÷
  // SAM planeado. Cambiar la equivalencia no mueve el porcentaje.
  const cumpEq = metaEq ? (eqp / metaEq) * 100 : null;
  const strong = (u) => (unit === u ? { fontWeight: 500 } : undefined);

  return (
    <div className="dp-tip">
      <div className="dp-tip-head">{row.tipLabel}</div>
      {!hasRuns ? (
        <div className="dp-tip-note">Sin corridas programadas</div>
      ) : (
        <>
          <div className="dp-tip-group">Piezas</div>
          <div className="dp-tip-row" style={strong('pzas')}>
            <span style={{ color: C.meta }}>Meta</span>
            <span>{meta == null ? '–' : fmtInt(meta)}</span>
          </div>
          <div className="dp-tip-row" style={strong('pzas')}>
            <span style={{ color: C.blueInk }}>Producido</span>
            <span>{fmtInt(prod)}</span>
          </div>
          <div className="dp-tip-row" style={strong('pzas')}>
            <span>Cumplimiento</span>
            <span>{cumpPz == null ? '–' : fmtPct(cumpPz)}</span>
          </div>

          <div className="dp-tip-group">Equivalentes (SAM ÷ {EQUIVALENCE})</div>
          <div className="dp-tip-row" style={strong('eq')}>
            <span style={{ color: C.meta }}>Meta eq.</span>
            <span>{metaEq == null ? '–' : `${row.metaEqApprox ? '≈ ' : ''}${fmtInt(metaEq)}`}</span>
          </div>
          <div className="dp-tip-row" style={strong('eq')}>
            <span style={{ color: C.eqInk }}>Producido eq.</span>
            <span>{eqp == null ? '–' : fmtInt(eqp)}</span>
          </div>
          <div className="dp-tip-row" style={strong('eq')}>
            <span>Cumplimiento eq.</span>
            <span>{cumpEq == null ? '–' : fmtPct(cumpEq)}</span>
          </div>

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


/* ================================================================== *
 * Page
 * ================================================================== */
function DailyProduction({ embedded = false }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  /* ---- filters ---- */
  // Lands on TODAY (was 'month'): the board opens on the live day so the
  // "Hoy · Tiempo real" card is immediately relevant. Semana / mes / año / rango
  // are all still one click away in the period dropdown.
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
    () =>
      resolvePeriod({
        rangeType, selectedDate, selectedWeek, selectedMonth,
        selectedYear, customStart, customEnd,
      }),
    [rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd]
  );

  // Independent scope for the trend chart (bucket + window). See resolveChartScope.
  const chartScope = useMemo(
    () =>
      resolveChartScope({
        rangeType, selectedDate, selectedWeek, selectedMonth,
        selectedYear, customStart, customEnd,
      }, today),
    [rangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStart, customEnd, today]
  );

  // The key of the bucket that matches the current selection, so the trend chart
  // can highlight the active bar (día/semana/mes/año keys line up with the state).
  const selectedKey = useMemo(() => {
    switch (chartScope.bucket) {
      case 'week': return selectedWeek;
      case 'month': return selectedMonth;
      case 'year': return String(selectedYear);
      default: return selectedDate;
    }
  }, [chartScope.bucket, selectedDate, selectedWeek, selectedMonth, selectedYear]);

  // Click-to-drill: selecting a bucket in the chart sets the matching filter, which
  // drives `period` -> KPIs, tabla y estilos se recargan para ese día/semana/mes/año.
  const drillTo = useCallback((bucket, key) => {
    if (!key) return;
    if (bucket === 'week') { setRangeType('week'); setSelectedWeek(key); }
    else if (bucket === 'month') { setRangeType('month'); setSelectedMonth(key); }
    else if (bucket === 'year') { setRangeType('year'); setSelectedYear(String(key)); }
    else { setRangeType('day'); setSelectedDate(key); }
  }, []);

  const handleBucketClick = useCallback((state) => {
    const key = state?.activeLabel ?? state?.activePayload?.[0]?.payload?.key;
    drillTo(chartScope.bucket, key != null ? String(key) : null);
  }, [chartScope.bucket, drillTo]);

  // Table drill: clicking a product filters by that estilo; clicking a línea value
  // filters by that line. Both flow through `period` so every panel refetches.
  const drillStyle = useCallback((st) => {
    if (st && st !== 'No Style') setSelectedStyle(st);
  }, []);
  const drillLine = useCallback((ln) => {
    if (ln != null && ln !== '') setSelectedLine(String(ln));
  }, []);

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

  // "Hoy · Tiempo real" card — always today, refreshed on an interval.
  const [realtime, setRealtime] = useState(null);
  const [rtUpdatedAt, setRtUpdatedAt] = useState('');

  const [chartOrder, setChartOrder] = useState('date');
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [showEfficiency, setShowEfficiency] = useState(true);
  // Unidad del gráfico: 'pzas' (piezas reales) o 'eq' (piezas equivalentes).
  // Una sola unidad a la vez — las cuatro cifras viven en el tooltip.
  const [unit, setUnit] = useState('pzas');
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
    if (selectedCustomer !== 'all') q += `&customer=${encodeURIComponent(selectedCustomer)}`;
    return q;
  }, [selectedStyle, selectedLine, selectedCustomer]);

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
        // Kept so week/month/year buckets can re-derive efficiency the server's
        // way: SUM(samOutput) / SUM(availableMinutes).
        samOutput: Number(d.samOutput) || 0,
        availableMinutes: Number(d.availableMinutes) || 0,
        // SUM(meta × SAM) del día — la meta en minutos SAM, de donde salen las
        // piezas equivalentes planeadas. Opcional: ver metaEqOf.
        samTarget: Number(d.samTarget) || 0,
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
      apiGet(`http://localhost:5000/api/skyrina/available-customers?${qs}`, { headers })
        .then((r) => (r.data?.success ? r.data.customers : []))
        .catch(() => []),
    ]).then(([s, l, c]) => {
      if (cancelled) return;
      setAvailableStyles(s);
      setAvailableLines(l);
      setAvailableCustomers(c);
      setSelectedStyle((prev) => (prev !== 'all' && !s.includes(prev) ? 'all' : prev));
      setSelectedLine((prev) => (prev !== 'all' && !l.includes(prev) ? 'all' : prev));
      // Keep a chosen customer even if they have no runs in the newly-selected
      // period, so switching Día->Mes doesn't silently wipe the filter; only
      // drop it when the route returns a list that genuinely excludes it.
      setSelectedCustomer((prev) => (prev !== 'all' && c.length && !c.includes(prev) ? 'all' : prev));
    });

    return () => {
      cancelled = true;
    };
  }, [user, period]);

  /* ---------------- week cards ---------------- *
   * "Semana pasada" y "Esta semana" son fijas: siempre la planta completa y
   * siempre relativas a HOY. No dependen del período (día/semana/mes/año), ni
   * de los filtros, ni del clic en el gráfico o la tabla — por eso viven en su
   * propio efecto y no se recargan cuando cambia lo demás. */
  const [weekLoading, setWeekLoading] = useState(true);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      setWeekLoading(true);
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const thisWeekStart = startOfWeek(today);
      const lastWeekStart = addDays(thisWeekStart, -7);
      const lastWeekEnd = addDays(thisWeekStart, -1);
      const prevWeekStart = addDays(lastWeekStart, -7);
      const prevWeekEnd = addDays(lastWeekStart, -1);
      const daysIntoWeek = Math.round((today - thisWeekStart) / 86400000);
      const weekBeforeSameSpan = addDays(lastWeekStart, daysIntoWeek);

      try {
        const [lastWeek, prevWeek, thisWeek, lastWeekPartial] = await Promise.all([
          summary(lastWeekStart, lastWeekEnd, headers, ''),
          summary(prevWeekStart, prevWeekEnd, headers, ''),
          summary(thisWeekStart, today, headers, ''),
          summary(lastWeekStart, weekBeforeSameSpan, headers, ''),
        ]);
        if (cancelled) return;
        setKpis((k) => ({
          ...k,
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
        }));
      } catch (err) {
        console.error('Week cards load failed:', err);
      } finally {
        if (!cancelled) setWeekLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, today, summary]);

  /* ---------------- load panels ---------------- */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const qs = filterQS();
      const range = `startDate=${ymd(period.start)}&endDate=${ymd(period.end)}`;

      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const prevMonthSameDay = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth(), 0).getDate())
      );

      try {
        const [
          thisMonth, prevMonth, current, previous,
          series, styleRes, lineRes,
        ] = await Promise.all([
          summary(monthStart, today, headers, qs),
          summary(prevMonthStart, prevMonthSameDay, headers, qs),
          summary(period.start, period.end, headers, qs),
          summary(period.prevStart, period.prevEnd, headers, qs),
          dailySeries(chartScope.start, chartScope.end, headers, qs),
          apiGet(`http://localhost:5000/api/skyrina/style-performance?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.styles : []))
            .catch(() => []),
          apiGet(`http://localhost:5000/api/skyrina/line-performance-detail?${range}${qs}`, { headers })
            .then((r) => (r.data?.success ? r.data.lines : []))
            .catch(() => []),
        ]);

        if (cancelled) return;

        setKpis((k) => ({
          ...k,
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
        }));

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
  }, [user, period, chartScope, filterQS, today, summary, dailySeries]);

  /* ---------------- realtime "Hoy" card ---------------- *
   * Always scoped to TODAY (not the selected period, exactly like the week rail
   * cards) and re-polled every 60 s. The server flags productionEnded, so once
   * the shift closes the numbers simply settle instead of us stopping the timer
   * on the client and risking a stale "En vivo" badge. Runs through the shared
   * limiter, so it queues politely behind the heavier panel loads. */
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const todayStr = ymd(today);

    const load = async () => {
      const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
      const qs = filterQS();
      try {
        const res = await apiGet(`http://localhost:5000/api/skyrina/realtime-summary?date=${todayStr}${qs}`, { headers });
        if (!cancelled && res.data?.success) {
          setRealtime(res.data);
          setRtUpdatedAt(
            new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
          );
        }
      } catch {
        /* keep the last good snapshot on a transient failure */
      }
    };

    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, today, filterQS]);

  /* ---------------- derived ---------------- */
  // Fold raw days into the scope's buckets (día/semana/mes/año), then apply the
  // display toggles. allBuckets keeps the whole window for the footnote count.
  const allBuckets = useMemo(
    () => bucketDays(daily, chartScope.bucket, chartScope.focusStart),
    [daily, chartScope.bucket, chartScope.focusStart]
  );
  // Los días de contexto (mes anterior) se ven en el gráfico pero no cuentan en
  // el pie: el total sigue siendo el del mes elegido.
  const focusBuckets = useMemo(() => allBuckets.filter((b) => !b.lead), [allBuckets]);
  const activeBuckets = useMemo(
    () => focusBuckets.filter((b) => b.target != null || b.produced > 0).length,
    [focusBuckets]
  );

  const chartData = useMemo(() => {
    let d = [...allBuckets];
    if (hideEmptyDays) {
      // Solo con corridas: todos los días con corridas, del mes anterior al actual.
      d = d.filter((x) => x.produced > 0 || x.target != null);
    } else if (chartScope.focusStart) {
      // Vista normal: sólo la última semana del mes anterior como contexto.
      const from = addDays(chartScope.focusStart, -LEAD_IN_DAYS).getTime();
      d = d.filter((x) => !x.lead || x.sortAt >= from);
    }
    if (chartOrder === 'asc') d.sort((a, b) => a.produced - b.produced);
    else if (chartOrder === 'desc') d.sort((a, b) => b.produced - a.produced);
    if (chartScope.bucket === 'day') {
      // Por fecha: el mes va en la primera barra y en cada día 1. Ordenado por
      // Mayor/Menor los meses se mezclan, así que los días previos lo llevan siempre.
      d = d.map((x, i) => {
        const dt = fromYMD(x.key);
        const withMonth = chartOrder === 'date' ? i === 0 || dt.getDate() === 1 : x.lead;
        return { ...x, axisLabel: withMonth ? fmtShort(dt) : String(dt.getDate()) };
      });
    }
    return d;
  }, [allBuckets, chartOrder, hideEmptyDays, chartScope.focusStart, chartScope.bucket]);

  // Días de contexto visibles (mes anterior) y subtítulo del gráfico.
  const leadCount = useMemo(() => chartData.filter((b) => b.lead).length, [chartData]);
  const chartSubtitle = useMemo(() => {
    if (!chartScope.focusStart) return chartScope.label;
    const prev = addDays(chartScope.focusStart, -1).toLocaleDateString('es-MX', { month: 'long' });
    return hideEmptyDays
      ? `${chartScope.label} · con los días con corridas de ${prev}`
      : `${chartScope.label} · con los ${LEAD_IN_DAYS} días previos`;
  }, [chartScope.focusStart, chartScope.label, hideEmptyDays]);

  // Línea divisoria en el día 1 (sólo en orden por fecha y si ese día se ve).
  const monthStartKey = useMemo(() => {
    if (!chartScope.focusStart || chartOrder !== 'date') return null;
    const k = ymd(chartScope.focusStart);
    return chartData.some((b) => b.key === k) ? k : null;
  }, [chartScope.focusStart, chartOrder, chartData]);

  // La unidad decide qué series se dibujan; todo lo demás es idéntico.
  const eqMode = unit === 'eq';
  const barKey = eqMode ? 'eqPcs' : 'produced';
  const metaKey = eqMode ? 'metaEq' : 'target';
  const barColor = eqMode ? C.eq : C.blue;
  const barColorSel = eqMode ? C.eqInk : C.blueInk;

  // Totales de la ventana para la nota al pie, en las dos unidades. Se suman
  // sobre allBuckets (la ventana completa) para que "Solo con corridas" no
  // cambie el total — los días sin corridas aportan 0 de todos modos.
  const totals2 = useMemo(() => {
    let pz = 0, eq = 0;
    for (const b of focusBuckets) { pz += b.produced || 0; eq += b.eqPcs || 0; }
    return { pz, eq };
  }, [focusBuckets]);

  // Tope del eje izquierdo: el mayor de producido / meta / piezas eq.
  const leftMax = useMemo(() => {
    let m = 0;
    for (const b of chartData) m = Math.max(m, b[barKey] || 0, b[metaKey] || 0);
    return niceCeil(m * 1.05);
  }, [chartData, barKey, metaKey]);

  const tickInterval = useMemo(() => {
    if (chartScope.bucket !== 'day') return 0; // few, wide labels — show all
    return chartData.length > 45 ? Math.ceil(chartData.length / 45) - 1 : 0;
  }, [chartData.length, chartScope.bucket]);

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
    setSelectedCustomer('all');
  };
  const filtersActive =
    selectedStyle !== 'all' || selectedLine !== 'all' || selectedCustomer !== 'all';
  const scopeText = [
    selectedCustomer === 'all' ? 'Todos los clientes' : selectedCustomer,
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
      {!embedded && <NavCeo />}

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

            <select value={selectedCustomer} onChange={(e) => setSelectedCustomer(e.target.value)} aria-label="Cliente" className="wide">
              <option value="all">Todos los clientes</option>
              {availableCustomers.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>

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
              loading={weekLoading}
            />
            <KpiCard
              label="Esta semana"
              value={kpis.thisWeek}
              change={kpis.thisWeekChange}
              efficiency={kpis.thisWeekEff}
              efficiencyChange={kpis.thisWeekEffChange}
              loading={weekLoading}
            />
            <RealtimeKpiCard
              data={realtime}
              loading={loading && !realtime}
              updatedAt={rtUpdatedAt}
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
            <PanelHead title="Producción" subtitle={chartSubtitle}>
              <Segmented
                label="Unidad"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'pzas', label: 'Piezas' },
                  { value: 'eq', label: 'Equivalentes' },
                ]}
              />
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
                Solo con corridas
              </label>
              <label className="dp-check">
                <input type="checkbox" checked={showEfficiency} onChange={(e) => setShowEfficiency(e.target.checked)} />
                Eficiencia
              </label>
            </PanelHead>

            <Legend
              items={[
                { label: eqMode ? 'Meta eq.' : 'Meta', color: C.meta, type: 'line' },
                { label: eqMode ? 'Producido eq.' : 'Producido', color: barColor, type: 'square' },
                ...(showEfficiency
                  ? [
                      { label: 'Eficiencia', color: C.eff, type: 'line' },
                      { label: 'Meta 70%', color: C.effInk, type: 'line' },
                    ]
                  : []),
              ]}
            />
            <p className="dp-hint">
              {eqMode
                ? `Piezas equivalentes = SAM producido ÷ ${EQUIVALENCE}. Meta y producido se comparan en la misma unidad; el tooltip trae también las piezas reales.`
                : 'Piezas reales cosidas y empacadas. El tooltip trae también los equivalentes.'}
              {' '}Haz clic en una barra para filtrar los KPIs y la tabla por ese período.
            </p>

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
                  // extra top room so the efficiency label over the tallest bar isn't clipped
                  margin={{ top: showEfficiency ? 30 : 16, right: showEfficiency ? 6 : 14, left: 0, bottom: 24 }}
                  onClick={handleBucketClick}
                  style={{ cursor: 'pointer' }}
                  barCategoryGap={chartData.length > 31 ? '12%' : '20%'}
                >
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis
                    dataKey="key"
                    tick={<BucketTick data={chartData} />}
                    tickLine={false}
                    axisLine={{ stroke: C.grid }}
                    interval={tickInterval}
                    height={42}
                  />
                  {/* Twin of the x-axis above, hidden. Only the label overlay bar
                      uses it: bars on different x-axes don't share a category
                      slot, so the overlay lands exactly on top of the real bar. */}
                  <XAxis xAxisId="labels" dataKey="key" hide />
                  {/* pieces (left) and % (right) can't share a scale — 1.2k pieces
                      would flatten an 80 % line onto the axis */}
                  <YAxis
                    yAxisId="left"
                    // Tope calculado a mano (ver leftMax) para que el eje no
                    // brinque al cambiar de unidad y la meta quepa siempre.
                    domain={[0, leftMax || 'auto']}
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
                  <Tooltip content={<DailyTooltip unit={unit} />} cursor={{ fill: 'rgba(60,64,67,0.06)' }} />
                  <Bar
                    yAxisId="left"
                    dataKey={barKey}
                    name={eqMode ? 'Producido eq.' : 'Producido'}
                    fill={barColor}
                    maxBarSize={44}
                    isAnimationActive={false}
                    cursor="pointer"
                  >
                    {chartData.map((b) => (
                      <Cell
                        key={b.key}
                        fill={b.key === selectedKey ? barColorSel : barColor}
                      />
                    ))}
                  </Bar>
                  {/* Meta en la unidad elegida: piezas reales (target_pcs) o
                      equivalentes (target × SAM ÷ equivalencia). */}
                  <Line
                    yAxisId="left"
                    type="linear"
                    dataKey={metaKey}
                    name={eqMode ? 'Meta eq.' : 'Meta'}
                    stroke={C.meta}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  {monthStartKey && (
                    <ReferenceLine
                      yAxisId="left"
                      x={monthStartKey}
                      stroke={C.muted}
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      ifOverflow="visible"
                      position="start"
                      label={{
                        value: sentence(chartScope.focusStart.toLocaleDateString('es-MX', { month: 'long' })),
                        position: 'insideTopLeft',
                        fill: C.muted,
                        fontSize: 10,
                        dx: -2,
                      }}
                    />
                  )}
                  {showEfficiency && (
                    <ReferenceLine
                      yAxisId="right"
                      y={70}
                      stroke={C.effInk}
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                      label={{ value: 'Meta 70%', position: 'right', fill: C.effInk, fontSize: 10, dy: -4 }}
                    />
                  )}
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
                  {/* Label overlay — declared LAST so the numbers paint above the
                      Meta and Eficiencia lines. Same data/axes as the real bar,
                      but invisible: it only carries the labels. */}
                  <Bar
                    xAxisId="labels"
                    yAxisId="left"
                    dataKey={barKey}
                    fill="none"
                    maxBarSize={44}
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  >
                    <LabelList
                      dataKey={barKey}
                      content={
                        <BarValueLabel
                          data={chartData}
                          showEff={showEfficiency}
                          selectedKey={selectedKey}
                          barColor={barColor}
                          barColorSel={barColorSel}
                        />
                      }
                    />
                  </Bar>
                </ComposedChart>
              )}
            </ChartFrame>

            {!loading && allBuckets.length > 0 && (
              <p className="dp-foot-note">
                {activeBuckets} de {focusBuckets.length} {TREND_NOUN[chartScope.bucket]} con producción
                {' · '}Producido{' '}
                <b style={{ color: C.blueInk, fontWeight: 500 }}>{fmtInt(totals2.pz)}</b> pzas
                {totals2.eq > 0 && (
                  <>
                    {' / '}
                    <b style={{ color: C.eqInk, fontWeight: 500 }}>{fmtInt(totals2.eq)}</b> eq
                  </>
                )}
                {kpis.periodEff != null && (
                  <>
                    {' · '}Eficiencia global{' '}
                    <b style={{ color: effColor(kpis.periodEff), fontWeight: 500 }}>
                      {fmtPct1(kpis.periodEff)}
                    </b>
                  </>
                )}
                {leadCount > 0 && (
                  <span style={{ color: C.muted }}>
                    {' · '}Antes de la línea punteada: {leadCount} días del mes anterior como contexto (no suman al total)
                  </span>
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
            <PanelHead title="Cumplimiento por producto y línea" subtitle={`${sortedRows.length} combinaciones`} />

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
                          <td className="dp-name" title={r.style}>
                            <button
                              type="button"
                              className="dp-drill"
                              onClick={() => drillStyle(r.style)}
                              title={`Filtrar por ${r.style}`}
                            >
                              {r.style}
                            </button>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="dp-drill"
                              onClick={() => drillLine(r.lineNo)}
                              title={`Filtrar por línea ${r.lineNo}`}
                            >
                              {r.lineNo}
                            </button>
                          </td>
                          <td className="dp-num">{fmtInt(r.target)}</td>
                          <td className="dp-num">{fmtInt(r.produced)}</td>
                          <td className="dp-num dp-eff-num" style={{ color: effColor(r.efficiency) }}>
                            {fmtPct1(r.efficiency)}
                          </td>
                          <td className="dp-num">{fmtPct(r.compliance)}</td>
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
                      <td className="dp-num">{fmtPct(totals.compliance)}</td>
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


/* ================================================================== *
 * Monitor de producción — tab shell
 * ================================================================== */
const MONITOR_TABS = [
  { key: 'produccion', label: 'Producción diaria' },
  { key: 'eficiencia', label: 'Line Performance' },
];

export default function Overview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = MONITOR_TABS.some((t) => t.key === requested) ? requested : 'produccion';

  // Mount a tab the first time it is opened, then keep it alive.
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  const select = useCallback((key) => {
    const next = new URLSearchParams(params);
    if (key === 'produccion') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const onKeyDown = (e) => {
    const i = MONITOR_TABS.findIndex((t) => t.key === tab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % MONITOR_TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + MONITOR_TABS.length) % MONITOR_TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = MONITOR_TABS.length - 1;
    if (j == null) return;
    e.preventDefault();
    select(MONITOR_TABS[j].key);
    document.getElementById(`pm-tab-${MONITOR_TABS[j].key}`)?.focus();
  };

  return (
    <div className="pm-page">
      <NavCeo />

      <div className="pm-tabs" role="tablist" aria-label="Monitor de producción" onKeyDown={onKeyDown}>
        {MONITOR_TABS.map((t) => (
          <button
            key={t.key}
            id={`pm-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`pm-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={tab === t.key ? 'on' : ''}
            onClick={() => select(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visited.has('produccion') && (
        <div role="tabpanel" id="pm-panel-produccion" aria-labelledby="pm-tab-produccion" hidden={tab !== 'produccion'}>
          <DailyProduction embedded />
        </div>
      )}
      {visited.has('eficiencia') && (
        <div role="tabpanel" id="pm-panel-eficiencia" aria-labelledby="pm-tab-eficiencia" hidden={tab !== 'eficiencia'}>
          <ActualEfficiency embedded />
        </div>
      )}

      <style>{pmCss}</style>
    </div>
  );
}

const pmCss = `
.pm-page{min-height:100vh;background:${C.canvas}}
.pm-page [role="tabpanel"] > div{min-height:0}
.pm-tabs{display:flex;gap:2px;padding:8px 20px 0;background:${C.panel};
  border-bottom:1px solid ${C.edge};
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.pm-tabs button{background:none;border:none;border-bottom:3px solid transparent;
  padding:9px 16px 8px;font:inherit;font-size:13.5px;color:${C.muted};cursor:pointer;
  border-radius:6px 6px 0 0;margin-bottom:-1px}
.pm-tabs button:hover{background:${C.hover};color:${C.ink}}
.pm-tabs button.on{color:#1967d2;border-bottom-color:#1a73e8;font-weight:500}
.pm-tabs button:focus-visible{outline:2px solid ${C.focus};outline-offset:-2px}
@media (max-width:620px){
  .pm-tabs{padding:6px 8px 0;overflow-x:auto}
  .pm-tabs button{white-space:nowrap;padding:9px 12px 8px}
}
`;

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

/* ---- "Hoy · Tiempo real" card ---- */
.dp-kpi-rt{border-left:3px solid ${C.green};display:flex;flex-direction:column}
.dp-rt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.dp-rt-head .dp-kpi-label{margin-bottom:0}
.dp-rt-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;
  letter-spacing:.3px;text-transform:uppercase;padding:2px 7px;border-radius:999px;white-space:nowrap}
.dp-rt-badge.live{background:#e6f4ea;color:${C.goodInk}}
.dp-rt-badge.fin{background:${C.grid};color:${C.muted}}
.dp-live-dot{width:6px;height:6px;border-radius:50%;background:${C.green};display:inline-block;
  animation:dp-pulse 1.4s ease-in-out infinite}
@keyframes dp-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}

.dp-rt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.dp-rt-cell{background:${C.head};border:1px solid ${C.grid};border-radius:6px;padding:7px 9px;min-width:0}
.dp-rt-k{font-size:10.5px;color:${C.muted};margin-bottom:2px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.dp-rt-v{font-size:17px;font-weight:500;color:${C.ink};line-height:1.1;
  font-variant-numeric:tabular-nums;letter-spacing:-.2px}
.dp-rt-sub{margin-top:3px;font-size:10.5px;color:${C.faint};white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){.dp-live-dot{animation:none}}

.dp-legend{display:flex;gap:18px;align-items:center;padding:8px 0 2px 14px;
  font-size:12.5px;color:${C.ink}}
.dp-legend-item{display:flex;align-items:center;gap:6px}
.dp-swatch{width:16px;height:12px;display:inline-block;border-radius:1px}
.dp-swatch-line{width:22px;height:2px;display:inline-block}

.dp-chart-empty{height:100%;display:grid;place-items:center;text-align:center;
  padding:0 24px;color:${C.muted};font-size:13px;line-height:1.5}
.dp-foot-note{margin:0;padding:2px 14px 8px;font-size:11px;color:${C.faint};text-align:right}
.dp-hint{margin:0;padding:4px 14px 2px;font-size:11px;color:${C.faint}}

.dp-tip{background:${C.panel};border:1px solid ${C.edge};border-radius:6px;padding:9px 11px;
  font-size:12px;color:${C.ink};box-shadow:0 2px 8px rgba(60,64,67,.2);min-width:150px}
.dp-tip-head{color:${C.muted};margin-bottom:5px;font-size:11.5px}
.dp-tip-group{font-size:10px;text-transform:uppercase;letter-spacing:.04em;
  color:#80868b;margin:6px 0 2px;border-top:1px solid #e8eaed;padding-top:5px}
.dp-tip-group:first-of-type{border-top:0;margin-top:2px;padding-top:0}
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
.dp-drill{display:inline-block;max-width:100%;vertical-align:bottom;background:none;border:none;font:inherit;color:${C.blueInk};cursor:pointer;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-drill:hover{text-decoration:underline}
.dp-drill:focus-visible{outline:2px solid ${C.focus};outline-offset:1px;border-radius:2px}
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