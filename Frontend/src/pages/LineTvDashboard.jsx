// LineTvDashboard.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Navlines from '../components/Navlines';

// ─── Settings ───────────────────────────────────────────────────────────────
const REFRESH_MS = 5 * 60 * 1000;   // reload data every 5 min
const ROTATE_MS = 20 * 1000;        // change screen every 20 s
const ROWS_PER_PAGE = 10;           // operator rows per table screen
const META_EFF = 70;                // efficiency goal line on the graph
const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const PACKING_KEYWORDS = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];

// ─── Date helpers (local time, not UTC) ─────────────────────────────────────
const localYMD = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const parseYMD = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const addDays = (ymd, n) => {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() + n);
  return localYMD(d);
};

const mondayOf = (ymd) => {
  const d = parseYMD(ymd);
  const diff = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - diff);
  return localYMD(d);
};

const shortDate = (ymd) => {
  const d = parseYMD(ymd);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
};

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// ─── Production calculations ────────────────────────────────────────────────
const isPackingOperation = (name) => {
  const n = (name || '').toLowerCase();
  return PACKING_KEYWORDS.some((k) => n.includes(k));
};

const sumValues = (obj) =>
  Object.values(obj || {}).reduce((acc, v) => acc + (Number(v) || 0), 0);

// Finished garments (empaque) for a run
const calculateFinishedGarments = (runData) => {
  if (!runData) return 0;
  let total = 0;
  for (const block of runData.operations || []) {
    for (const op of block.operations || []) {
      if (isPackingOperation(op.operation_name)) total += sumValues(op.sewed_data);
    }
  }
  return total;
};

const getProductionWindow = (runData, dateStr) => {
  const start = new Date(`${dateStr}T08:00:00`);
  const ends = (runData.slots || [])
    .map((s) => new Date(`${dateStr}T${s.slot_end}`))
    .filter((d) => !Number.isNaN(d.getTime()));
  const end = ends.length
    ? new Date(Math.max(...ends.map((d) => d.getTime())))
    : new Date(`${dateStr}T17:36:00`);
  return { start, end };
};

// SAM produced and minutes available so far, for one run
const realtimeComponents = (runData, dateStr) => {
  if (!runData || !dateStr) return { samProduced: 0, availableMinutes: 0 };
  const now = new Date();
  const { start, end } = getProductionWindow(runData, dateStr);
  const sam = Number(runData.run?.sam_minutes) || 0;
  const operators = runData.operators?.length || 0;
  const samProduced = calculateFinishedGarments(runData) * sam;

  if (now < start) return { samProduced: 0, availableMinutes: 0 };
  if (now >= end) {
    return {
      samProduced,
      availableMinutes: operators * (Number(runData.run?.working_hours) || 0) * 60,
    };
  }
  const elapsedMinutes = Math.min((now - start) / 60000, (end - start) / 60000);
  return { samProduced, availableMinutes: operators * elapsedMinutes };
};

const calculateRealtimeEfficiency = (runData, dateStr) => {
  const { samProduced, availableMinutes } = realtimeComponents(runData, dateStr);
  const eff = availableMinutes > 0 ? (samProduced / availableMinutes) * 100 : 0;
  return Math.round(eff * 100) / 100;
};

// Whole-line real-time efficiency (all styles together), null if not started
const combinedRealtimeEfficiency = (runList, dateStr) => {
  let sam = 0;
  let avail = 0;
  for (const rd of runList) {
    const c = realtimeComponents(rd, dateStr);
    sam += c.samProduced;
    avail += c.availableMinutes;
  }
  return avail > 0 ? (sam / avail) * 100 : null;
};

const computeRealtimeTarget = (runData, dateStr) => {
  if (!runData || !dateStr) return 0;
  const now = new Date();
  const { start, end } = getProductionWindow(runData, dateStr);
  const totalTarget = Number(runData.run?.target_pcs) || 0;
  if (now < start) return 0;
  if (now >= end) return totalTarget;
  const total = end - start;
  if (total <= 0) return 0;
  const cumulative = totalTarget * ((now - start) / total);
  return Math.min(Math.round(cumulative * 100) / 100, totalTarget);
};

// One row per operator × operation:
//   meta       = Objetivo (ahora) of the run — every operation has to move the
//                same number of pieces the line should have finished by now
//   producido  = sewed qty entered for that operation
//   eficiencia = producido / meta
// Operators have no permanent id: match them across days by name (same rule as
// the server endpoint), or by number when the name is empty.
const operatorKeyOf = (name, no) => {
  const n = String(name || '').trim().toLowerCase();
  return n || `#${no}`;
};

const buildOperatorRows = (runData, dateStr) => {
  if (!runData) return [];
  const meta = computeRealtimeTarget(runData, dateStr);

  const rows = [];
  for (const block of runData.operations || []) {
    const operator = block.operator || {};
    for (const op of block.operations || []) {
      const produced = sumValues(op.sewed_data);
      rows.push({
        key: `${operator.id}-${op.id}`,
        operatorId: operator.id,
        operatorKey: operatorKeyOf(operator.operator_name, operator.operator_no),
        operatorNo: operator.operator_no,
        operatorName: operator.operator_name || `Operador ${operator.operator_no ?? ''}`,
        operation: op.operation_name || '—',
        capacityPerHour: Number(op.capacity_per_hour) || 0,
        meta,
        produced,
        efficiency: meta > 0 ? (produced / meta) * 100 : null,
      });
    }
  }
  return rows;
};

// Weekly average efficiency per operator (Monday → selected day).
// Each day: Σ produced / Σ meta over the operator's operations (all orders of that day),
// meta = the order's target. Today uses the live values (meta = Objetivo ahora).
// Weekly average = mean of the days the operator worked.
const buildOperatorWeekAverages = (serverDays, runList, selectedDate) => {
  const monday = mondayOf(selectedDate);
  const today = localYMD();
  const perOperator = new Map(); // key -> Map(date -> { produced, meta })

  const add = (key, date, produced, meta) => {
    if (!perOperator.has(key)) perOperator.set(key, new Map());
    const days = perOperator.get(key);
    const d = days.get(date) || { produced: 0, meta: 0 };
    d.produced += produced;
    d.meta += meta;
    days.set(date, d);
  };

  for (const row of serverDays || []) {
    if (row.date < monday || row.date > selectedDate) continue;
    if (row.date === today && selectedDate === today) continue; // replaced by live values
    add(row.operatorKey, row.date, Number(row.produced) || 0, Number(row.meta) || 0);
  }

  if (selectedDate === today) {
    for (const rd of runList || []) {
      const meta = computeRealtimeTarget(rd, selectedDate);
      for (const block of rd.operations || []) {
        const op = block.operator || {};
        const key = operatorKeyOf(op.operator_name, op.operator_no);
        for (const o of block.operations || []) {
          add(key, today, sumValues(o.sewed_data), meta);
        }
      }
    }
  }

  const result = new Map();
  for (const [key, days] of perOperator) {
    const effs = [...days.values()].filter((d) => d.meta > 0).map((d) => (d.produced / d.meta) * 100);
    if (effs.length) {
      result.set(key, { average: effs.reduce((a, b) => a + b, 0) / effs.length, days: effs.length });
    }
  }
  return result;
};

// Weekly series for the two graphs
const buildWeekSeries = (history, selectedDate, todayEffOverride) => {
  const thisMonday = mondayOf(selectedDate);
  const lastMonday = addDays(thisMonday, -7);
  const today = localYMD();
  const byDate = new Map((history || []).map((h) => [h.date, h]));

  const hasSunday =
    byDate.has(addDays(lastMonday, 6)) || byDate.has(addDays(thisMonday, 6));
  const dayCount = hasSunday ? 7 : 6;

  const build = (monday) =>
    Array.from({ length: dayCount }, (_, i) => {
      const d = addDays(monday, i);
      const h = byDate.get(d);
      let value = h && h.availableMinutes > 0 ? h.efficiency : null;
      let partial = false;
      if (d === today) {
        if (todayEffOverride != null) value = todayEffOverride; // live value
        else if (value != null) partial = true;                  // day still running
      }
      if (d > today) value = null;
      return { date: d, label: `${DAY_LABELS[i]} ${parseYMD(d).getDate()}`, value, partial };
    });

  const average = (points) => {
    const vals = points.filter((p) => p.value != null && !p.partial).map((p) => p.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const last = build(lastMonday);
  const current = build(thisMonday);
  return {
    last: { points: last, average: average(last), from: lastMonday, to: addDays(lastMonday, dayCount - 1) },
    current: { points: current, average: average(current), from: thisMonday, to: addDays(thisMonday, dayCount - 1) },
  };
};

// ─── Formatting & colors ────────────────────────────────────────────────────
const formatNumber = (value) => {
  if (value == null || isNaN(value)) return '0';
  return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 });
};

const formatDecimal = (value) => {
  if (value == null || isNaN(value)) return '0';
  return Number(value).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// Efficiency color bands — one source for KPIs, operator table, bars and graph
//   dark green ≥ 90% · light green 80–89% · lime green 70–79% · orange 60–69% · red < 60%
const EFF_BANDS = [
  { min: 90, label: '≥ 90%', color: '#15803d', text: 'text-green-700', bar: 'bg-green-700', border: 'border-green-700', row: 'bg-green-400' },  // dark green
  { min: 80, label: '80–89%', color: '#22c55e', text: 'text-green-500', bar: 'bg-green-500', border: 'border-green-500', row: 'bg-green-200' }, // light green
  { min: 70, label: '70–79%', color: '#84cc16', text: 'text-lime-500', bar: 'bg-lime-500', border: 'border-lime-500', row: 'bg-lime-200' },   // lime green
  { min: 60, label: '60–69%', color: '#f97316', text: 'text-orange-500', bar: 'bg-orange-500', border: 'border-orange-500', row: 'bg-orange-200' },
  { min: -Infinity, label: '< 60%', color: '#dc2626', text: 'text-red-600', bar: 'bg-red-600', border: 'border-red-600', row: 'bg-red-300' },
];

const getEffBand = (eff) =>
  eff == null || isNaN(eff) ? null : EFF_BANDS.find((b) => eff >= b.min);

const getEfficiencyColor = (eff) => getEffBand(eff)?.text || 'text-gray-500';
const getProgressBarColor = (eff) => getEffBand(eff)?.bar || 'bg-gray-400';
const getEfficiencyHex = (eff) => getEffBand(eff)?.color || '#6b7280';
const getRowBackground = (eff) => getEffBand(eff)?.row || '';
const getBorderColor = (eff) => getEffBand(eff)?.border || 'border-gray-300';

const getStatusColor = (variancePct) => {
  if (isNaN(variancePct)) return { border: 'border-gray-400', badge: 'bg-gray-100 text-gray-800', icon: '⚪', label: 'Sin datos' };
  if (variancePct < -15) return { border: 'border-red-500', badge: 'bg-red-100 text-red-800', icon: '🔴', label: 'Crítico' };
  if (variancePct < -5) return { border: 'border-orange-500', badge: 'bg-orange-100 text-orange-800', icon: '🟠', label: 'Atrasado' };
  if (variancePct <= 5) return { border: 'border-green-500', badge: 'bg-green-100 text-green-800', icon: '🟢', label: 'En Ruta' };
  if (variancePct <= 15) return { border: 'border-yellow-500', badge: 'bg-yellow-100 text-yellow-800', icon: '🟡', label: 'Adelantado' };
  return { border: 'border-blue-500', badge: 'bg-blue-100 text-blue-800', icon: '🔵', label: 'Superando' };
};

// Work order number of a run (line_runs has no style_code, so this replaces "N/A")
const workOrderLabel = (runData) => {
  const wo = runData?.run?.work_order_no;
  return wo ? `OT ${wo}` : 'Sin OT';
};

const getRunCardData = (runData, dateStr) => {
  const rt = computeRealtimeTarget(runData, dateStr);
  const finished = calculateFinishedGarments(runData);
  const rtEff = calculateRealtimeEfficiency(runData, dateStr);
  const variance = finished - rt;
  return {
    realtimeTarget: rt,
    finishedGarments: finished,
    displayEfficiency: Math.min(rtEff, 100),
    operatorsCount: runData.operators?.length || 0,
    sam: Number(runData.run?.sam_minutes) || 0,
    styleName: runData.run?.style || 'N/A',
    workOrder: workOrderLabel(runData),
    variance,
    variancePct: rt > 0 ? (variance / rt) * 100 : 0,
  };
};

// ─── KPI strip (shown above the graphs) ─────────────────────────────────────
function KpiStrip({ lineNo, runData, dateStr }) {
  const d = getRunCardData(runData, dateStr);
  const status = getStatusColor(d.variancePct);

  return (
    <div className={`bg-white border-4 ${status.border} rounded-xl shadow-lg px-5 py-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl font-black text-gray-900">Línea {lineNo}</span>
          <span className="text-lg text-gray-600 font-semibold truncate">
            {d.workOrder} - {d.styleName}
          </span>
        </div>
        <span className={`${status.badge} px-4 py-1 rounded-full text-lg font-bold shrink-0`}>
          {status.icon} {status.label}
        </span>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-blue-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-blue-900">🎯 Objetivo (ahora)</div>
          <div className="text-4xl font-black text-blue-900">{formatNumber(d.realtimeTarget)}</div>
        </div>
        <div className="bg-green-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-green-900">✅ Cosido</div>
          <div className="text-4xl font-black text-green-900">{formatNumber(d.finishedGarments)}</div>
        </div>
        <div className="bg-gray-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-gray-700">📊 Variación</div>
          <div className={`text-4xl font-black ${d.variance > 0 ? 'text-green-600' : d.variance < 0 ? 'text-red-600' : 'text-gray-600'}`}>
            {d.variance > 0 ? '+' : ''}{formatNumber(d.variance)}
          </div>
        </div>
        <div className="bg-gray-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-gray-700">⚡ Eficiencia RT</div>
          <div className={`text-4xl font-black ${getEfficiencyColor(d.displayEfficiency)}`}>
            {formatDecimal(d.displayEfficiency)}%
          </div>
          <div className="w-full bg-gray-300 rounded-full h-1.5 mt-1">
            <div
              className={`h-1.5 rounded-full ${getProgressBarColor(d.displayEfficiency)}`}
              style={{ width: `${d.displayEfficiency}%` }}
            />
          </div>
        </div>
        <div className="bg-gray-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-gray-700">⏱️ SAM</div>
          <div className="text-4xl font-black text-gray-900">{formatDecimal(d.sam)}</div>
        </div>
        <div className="bg-gray-100 rounded-lg px-3 py-2 text-center">
          <div className="text-sm font-bold text-gray-700">👥 Operadores</div>
          <div className="text-4xl font-black text-gray-900">{d.operatorsCount}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Multi work order KPI card (2+ orders on the same line/day) ─────────────
// One row where every column reads "OT 1 / OT 2 / …" in the same order,
// plus a line total underneath.
function SlashValues({ items, render }) {
  return (
    <div className="flex flex-nowrap items-baseline justify-end gap-x-2 whitespace-nowrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-baseline gap-2 whitespace-nowrap">
          {i > 0 && <span className="text-gray-300 font-normal">/</span>}
          {render(item, i)}
        </span>
      ))}
    </div>
  );
}

function MultiStyleKpiTable({ lineNo, runList, dateStr }) {
  const items = runList.map((rd) => getRunCardData(rd, dateStr));
  const totalTarget = items.reduce((a, d) => a + d.realtimeTarget, 0);
  const totalSewed = items.reduce((a, d) => a + d.finishedGarments, 0);
  const totalVariance = totalSewed - totalTarget;
  const totalStatus = getStatusColor(totalTarget > 0 ? (totalVariance / totalTarget) * 100 : 0);

  const varianceClass = (v) => (v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-gray-600');
  const signed = (v) => `${v > 0 ? '+' : ''}${formatNumber(v)}`;

  return (
    <div className={`bg-white border-4 ${totalStatus.border} rounded-xl shadow-lg overflow-hidden`}>
      <div className="flex items-center justify-between px-5 py-2">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-black text-gray-900">Línea {lineNo}</span>
          <span className="text-lg text-gray-600 font-semibold">{runList.length} órdenes hoy</span>
        </div>
        <span className={`${totalStatus.badge} px-4 py-1 rounded-full text-lg font-bold`}>
          {totalStatus.icon} {totalStatus.label}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 text-gray-700 text-base whitespace-nowrap">
            <tr>
              <th className="px-2.5 py-2 text-left">Orden / Estilo</th>
              <th className="px-2.5 py-2 text-right">🎯 Objetivo (ahora)</th>
              <th className="px-2.5 py-2 text-right">✅ Cosido</th>
              <th className="px-2.5 py-2 text-right">📊 Variación</th>
              <th className="px-2.5 py-2 text-right">⚡ Eficiencia RT</th>
              <th className="px-2.5 py-2 text-right">⏱️ SAM</th>
              <th className="px-2.5 py-2 text-right">👥 Oper.</th>
              <th className="px-2.5 py-2 text-center">Estado</th>
            </tr>
          </thead>
          <tbody>
            {/* One row, values separated by "/" in work-order order */}
            <tr className={`border-t border-gray-200 ${items.length > 2 ? 'text-lg' : 'text-xl'}`}>
              <td className="px-2.5 py-2">
                <div className="font-black text-gray-900 whitespace-nowrap">
                  {items.map((d) => d.workOrder).join(' / ')}
                </div>
                <div className="text-sm text-gray-500 max-w-xs">
                  {items.map((d) => d.styleName).join(' / ')}
                </div>
              </td>
              <td className="px-2.5 py-2 text-right font-black text-blue-900">
                <SlashValues items={items} render={(d) => formatNumber(d.realtimeTarget)} />
              </td>
              <td className="px-2.5 py-2 text-right font-black text-green-900">
                <SlashValues items={items} render={(d) => formatNumber(d.finishedGarments)} />
              </td>
              <td className="px-2.5 py-2 text-right font-black">
                <SlashValues items={items} render={(d) => (
                  <span className={varianceClass(d.variance)}>{signed(d.variance)}</span>
                )} />
              </td>
              <td className="px-2.5 py-2 text-right font-black">
                <SlashValues items={items} render={(d) => (
                  <span className={getEfficiencyColor(d.displayEfficiency)}>{formatDecimal(d.displayEfficiency)}%</span>
                )} />
              </td>
              <td className="px-2.5 py-2 text-right font-bold text-gray-900">
                <SlashValues items={items} render={(d) => formatDecimal(d.sam)} />
              </td>
              <td className="px-2.5 py-2 text-right font-bold text-gray-900">
                <SlashValues items={items} render={(d) => d.operatorsCount} />
              </td>
              <td className="px-2.5 py-2">
                <div className="flex flex-nowrap items-center justify-center gap-1">
                  {items.map((d, i) => {
                    const st = getStatusColor(d.variancePct);
                    return (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-gray-300">/</span>}
                        <span title={st.label} className={`${st.badge} px-2.5 py-0.5 rounded-full text-sm font-bold whitespace-nowrap`}>
                          {st.icon}{items.length > 2 ? '' : ` ${st.label}`}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </td>
            </tr>

            <tr className="border-t-4 border-gray-300 bg-gray-50 text-2xl">
              <td className="px-2.5 py-2 font-black text-gray-900">Total línea</td>
              <td className="px-2.5 py-2 text-right font-black text-blue-900">{formatNumber(totalTarget)}</td>
              <td className="px-2.5 py-2 text-right font-black text-green-900">{formatNumber(totalSewed)}</td>
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Weekly comparison graph (plain SVG, no extra library) ─────────────────
// Smooth curve through the points without overshooting (monotone cubic)
const smoothPath = (pts) => {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const n = pts.length;
  const dx = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const m = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  }
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += ` C${pts[i].x + c},${pts[i].y + m[i] * c} ${pts[i + 1].x - c},${pts[i + 1].y - m[i + 1] * c} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
};

// One graph, two lines (last week + this week) on the same weekday axis.
// Both lines start at the Y axis (Monday) and end with a weekly-average badge.
function WeekComparisonChart({ lastWeek, currentWeek }) {
  const W = 1200;
  const H = 400;
  const PAD = { l: 58, r: 190, t: 30, b: 58 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const dayCount = Math.max(lastWeek.points.length, currentWeek.points.length);

  const allValues = [...lastWeek.points, ...currentWeek.points]
    .map((p) => p.value).filter((v) => v != null);
  const yMax = Math.max(100, Math.ceil(Math.max(0, ...allValues) / 25) * 25);
  const ticks = [];
  for (let v = 0; v <= yMax; v += 25) ticks.push(v);

  const x = (i) => PAD.l + (dayCount <= 1 ? 0 : (i * plotW) / (dayCount - 1));
  const y = (v) => PAD.t + plotH - (v / yMax) * plotH;

  const series = [
    { key: 'last', name: 'Semana pasada', color: '#94a3b8', width: 4, data: lastWeek },
    { key: 'current', name: 'Semana actual', color: '#2563eb', width: 5, data: currentWeek },
  ].map((s) => ({
    ...s,
    plotted: s.data.points
      .map((p, i) => ({ ...p, i, x: x(i), y: p.value != null ? y(p.value) : null }))
      .filter((p) => p.y != null),
  }));

  // Value labels: the higher point of each day gets its label above, the lower one below
  const labelBelow = (s, p) => {
    const other = series.find((o) => o.key !== s.key).plotted.find((q) => q.i === p.i);
    if (!other) return false;
    return p.y > other.y || (p.y === other.y && s.key === 'last');
  };

  // Average badges in the right gutter, pushed apart if they collide
  const badges = series
    .filter((s) => s.data.average != null)
    .map((s) => ({ ...s, avg: s.data.average, by: y(s.data.average) }))
    .sort((a, b) => a.by - b.by);
  const BADGE_H = 54;
  for (let i = 1; i < badges.length; i++) {
    if (badges[i].by - badges[i - 1].by < BADGE_H + 6) badges[i].by = badges[i - 1].by + BADGE_H + 6;
  }
  badges.forEach((b) => {
    b.by = Math.min(Math.max(b.by, PAD.t + BADGE_H / 2), PAD.t + plotH - BADGE_H / 2);
  });

  const delta = lastWeek.average != null && currentWeek.average != null
    ? currentWeek.average - lastWeek.average : null;

  const dayNumber = (ymd) => (ymd ? parseYMD(ymd).getDate() : '');

  return (
    <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h3 className="text-2xl font-black text-gray-900">Eficiencia por día · semana pasada vs semana actual</h3>
          <div className="text-base text-gray-500 font-semibold">
            {shortDate(lastWeek.from)} – {shortDate(lastWeek.to)} vs {shortDate(currentWeek.from)} – {shortDate(currentWeek.to)}
          </div>
        </div>
        {delta != null && (
          <span className={`shrink-0 px-4 py-1.5 rounded-full text-lg font-bold ${delta >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {delta >= 0 ? '↑ +' : '↓ '}{formatDecimal(delta)} pts vs semana pasada
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1 text-base text-gray-700">
        <div className="flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-2 font-semibold">
              <span className="inline-block w-8 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
          <span className="w-px h-5 bg-gray-300" />
          {EFF_BANDS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-2 font-semibold text-purple-800">
          <span className="inline-block w-8 border-t-2 border-dashed border-purple-700" />
          Meta {META_EFF}%
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label={`Promedio semana pasada ${lastWeek.average != null ? formatDecimal(lastWeek.average) + '%' : 'sin datos'}, semana actual ${currentWeek.average != null ? formatDecimal(currentWeek.average) + '%' : 'sin datos'}`}>
        {/* grid + Y axis labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.l - 10} y={y(t) + 5} textAnchor="end" fontSize="15" fill="#6b7280">{t}%</text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + plotH} stroke="#d1d5db" strokeWidth="1.5" />

        {/* X axis: weekday + both dates */}
        {Array.from({ length: dayCount }, (_, i) => {
          const anchor = i === 0 ? 'start' : i === dayCount - 1 ? 'end' : 'middle';
          const lx = i === 0 ? x(i) - 4 : i === dayCount - 1 ? x(i) + 4 : x(i);
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={PAD.t + plotH} y2={PAD.t + plotH + 6} stroke="#d1d5db" />
              <text x={lx} y={PAD.t + plotH + 24} textAnchor={anchor} fontSize="16" fontWeight="700" fill="#374151">
                {DAY_LABELS[i]}
              </text>
              <text x={lx} y={PAD.t + plotH + 44} textAnchor={anchor} fontSize="13" fill="#6b7280">
                {dayNumber(lastWeek.points[i]?.date)} / {dayNumber(currentWeek.points[i]?.date)}
              </text>
            </g>
          );
        })}

        {/* Meta line */}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(META_EFF)} y2={y(META_EFF)}
          stroke="#6d28d9" strokeWidth="2" strokeDasharray="8 6" />

        {/* Lines */}
        {series.map((s) => (
          <path key={s.key} d={smoothPath(s.plotted)} fill="none" stroke={s.color}
            strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* Points + value labels */}
        {series.map((s) =>
          s.plotted.map((p) => {
            const below = labelBelow(s, p);
            const c = getEfficiencyHex(p.value);
            const isLast = p.i === dayCount - 1;
            const anchor = p.i === 0 ? 'start' : isLast ? 'end' : 'middle';
            const lx = p.i === 0 ? p.x + 6 : isLast ? p.x - 6 : p.x;
            return (
              <g key={`${s.key}-${p.date}`}>
                <circle cx={p.x} cy={p.y} r={p.partial ? 8 : 7}
                  fill={p.partial ? '#ffffff' : c} stroke={p.partial ? c : s.color} strokeWidth="3" />
                <text x={lx} y={below ? p.y + 28 : p.y - 15} textAnchor={anchor}
                  fontSize="16" fontWeight="800" fill={c}
                  stroke="#ffffff" strokeWidth="4" paintOrder="stroke">
                  {formatDecimal(p.value)}%{p.partial ? '*' : ''}
                </text>
              </g>
            );
          })
        )}

        {/* Weekly average badges at the end of the graph */}
        {badges.map((b) => (
          <g key={b.key}>
            <line x1={W - PAD.r} x2={W - PAD.r + 14} y1={y(b.avg)} y2={b.by}
              stroke={b.color} strokeWidth="2" strokeDasharray="4 3" />
            <rect x={W - PAD.r + 14} y={b.by - BADGE_H / 2} width={PAD.r - 18} height={BADGE_H} rx="10"
              fill="#ffffff" stroke={b.color} strokeWidth="3" />
            <text x={W - PAD.r + 28} y={b.by - 6} fontSize="14" fontWeight="700" fill="#374151">
              Prom. {b.key === 'last' ? 'sem. pasada' : 'sem. actual'}
            </text>
            <text x={W - PAD.r + 28} y={b.by + 18} fontSize="22" fontWeight="900" fill={getEfficiencyHex(b.avg)}>
              {formatDecimal(b.avg)}%
            </text>
          </g>
        ))}

        {allValues.length === 0 && (
          <text x={PAD.l + plotW / 2} y={PAD.t + plotH / 2} textAnchor="middle" fontSize="20" fill="#9ca3af">
            Sin producción registrada en estas dos semanas
          </text>
        )}
      </svg>

      {currentWeek.points.some((p) => p.partial) && (
        <div className="text-sm text-gray-500">* Día en curso, no entra en el promedio</div>
      )}
    </div>
  );
}

// ─── Operator table screen ──────────────────────────────────────────────────
function OperatorTable({ lineNo, runData, rows, page, pages, weekAverages }) {
  const styleName = runData.run?.style || 'N/A';

  return (
    <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 overflow-hidden">
      <div className="bg-gray-900 text-white px-5 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <span className="text-2xl font-black">👥 Operadores - Línea {lineNo}</span>
          <span className="text-lg text-gray-300 font-semibold ml-3 truncate">
            {workOrderLabel(runData)} - {styleName}
          </span>
        </div>
        {pages > 1 && <span className="text-lg font-bold text-gray-300 shrink-0">Página {page} de {pages}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-100 text-gray-700 text-lg">
            <tr>
              <th className="px-4 py-3 w-16 text-center">No.</th>
              <th className="px-4 py-3">Operador</th>
              <th className="px-4 py-3">Operación</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Capacidad/hora</th>
              <th className="px-4 py-3 text-right">Meta (ahora)</th>
              <th className="px-4 py-3 text-right">Producido</th>
              <th className="px-4 py-3 w-64">Eficiencia</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Prom. semana</th>
            </tr>
          </thead>
          <tbody className="text-xl">
            {rows.map((r, i) => {
              const sameOperatorAsAbove = i > 0 && rows[i - 1].operatorId === r.operatorId;
              const barWidth = r.efficiency == null ? 0 : Math.min(r.efficiency, 100);
              return (
                <tr
                  key={r.key}
                  className={`${sameOperatorAsAbove ? '' : 'border-t-2 border-gray-200'} ${
                    getRowBackground(r.efficiency)
                  }`}
                >
                  <td className="px-4 py-2.5 text-center font-bold text-gray-500">
                    {sameOperatorAsAbove ? '' : r.operatorNo}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-gray-900">
                    {sameOperatorAsAbove ? '' : r.operatorName}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{r.operation}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-700">
                    {r.capacityPerHour > 0 ? formatNumber(r.capacityPerHour) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-blue-900">{formatNumber(r.meta)}</td>
                  <td className="px-4 py-2.5 text-right font-black text-green-900">{formatNumber(r.produced)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-24 text-right font-black text-gray-900">
                        {r.efficiency == null ? '—' : `${formatDecimal(r.efficiency)}%`}
                      </span>
                      <div className="flex-1 bg-white/80 rounded-full h-3">
                        <div className={`h-3 rounded-full ${getProgressBarColor(r.efficiency)}`} style={{ width: `${barWidth}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {!sameOperatorAsAbove && (() => {
                      const w = weekAverages?.get(r.operatorKey);
                      if (!w) return <span className="text-gray-500 font-bold">—</span>;
                      return (
                        <div className="inline-flex flex-col items-center">
                          <span className={`bg-white border-2 ${getBorderColor(w.average)} rounded-full px-3 py-0.5 font-black ${getEfficiencyColor(w.average)}`}>
                            {formatDecimal(w.average)}%
                          </span>
                          <span className="text-xs font-semibold text-gray-700 mt-0.5">
                            {w.days} {w.days === 1 ? 'día' : 'días'}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function LineTvDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(searchParams.get('date') || localYMD());
  const [lineNo, setLineNo] = useState(searchParams.get('line') || '');
  const [runDataList, setRunDataList] = useState([]);
  const [weekHistory, setWeekHistory] = useState([]);
  const [operatorWeekDays, setOperatorWeekDays] = useState([]);
  const [weekError, setWeekError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [nextRefreshAt, setNextRefreshAt] = useState(Date.now() + REFRESH_MS);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [nowTick, setNowTick] = useState(Date.now());

  // Screen rotation
  const [screenIndex, setScreenIndex] = useState(0);
  const [rotationPaused, setRotationPaused] = useState(false);
  const [rotationCycle, setRotationCycle] = useState(0);

  const requestIdRef = useRef(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }
    axios.get(`http://localhost:5000/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setUser(res.data.user))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, []);

  // Renew login every hour so the TV never expires
useEffect(() => {
  const renew = async () => {
    try {
      const res = await axios.post('http://localhost:5000/api/refresh-token', {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.data?.token) localStorage.setItem('token', res.data.token);
    } catch (err) {
      console.error('Token renew failed:', err); // retries next hour
    }
  };
  renew();
  const t = setInterval(renew, 60 * 60 * 1000);
  return () => clearInterval(t);
}, []);


  // 1-second clock: drives the countdown and keeps "ahora" values live
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // New day: if the TV was showing "today", move to the new today (same line)
  const lastTodayRef = useRef(localYMD());
  useEffect(() => {
    const today = localYMD();
    if (today === lastTodayRef.current) return;
    const previousToday = lastTodayRef.current;
    lastTodayRef.current = today;
    if (date === previousToday) handleDateChange(today);
  }, [nowTick]);

  // Auto-refresh when the countdown reaches zero
  useEffect(() => {
    if (!autoRefresh || !lineNo || !date) return;
    if (nowTick >= nextRefreshAt) {
      setNextRefreshAt(Date.now() + REFRESH_MS);
      loadAll(lineNo, date, true);
    }
  }, [nowTick]);

  const countdown = Math.max(0, Math.round((nextRefreshAt - nowTick) / 1000));

  const loadRuns = async (line, selectedDate, headers, reqId, isRefresh) => {
    const isStale = () => reqId !== requestIdRef.current;
    try {
      const runsRes = await axios.get(`http://localhost:5000/api/line-runs/${line}`, { headers });
      if (isStale()) return;
      if (!runsRes.data.success) {
        setError('No se pudo obtener información de la línea');
        return;
      }

      const runsOnDate = runsRes.data.runs.filter((run) => toYMD(run.run_date) === selectedDate);
      if (runsOnDate.length === 0) {
        setRunDataList([]);
        setError('No hay datos de producción para esta fecha');
        return;
      }

      const allRunData = [];
      for (const run of runsOnDate) {
        try {
          const detailRes = await axios.get(`http://localhost:5000/api/get-run-data/${run.id}`, { headers });
          if (detailRes.data.success) allRunData.push(detailRes.data);
        } catch (err) {
          console.error(`Error fetching run ${run.id}:`, err.message);
        }
      }
      if (isStale()) return;

      if (allRunData.length === 0) {
        setError('No se pudieron cargar los datos detallados');
        return;
      }
      setRunDataList(allRunData);
      setError('');
    } catch (err) {
      if (isStale()) return;
      console.error('Error fetching line data:', err);
      // On a background refresh keep the last good data on screen
      if (!isRefresh) setRunDataList([]);
      setError('Error al cargar los datos: ' + (err.response?.data?.error || err.message));
    }
  };

  const loadWeek = async (line, selectedDate, headers, reqId) => {
    const monday = mondayOf(selectedDate);
    try {
      const res = await axios.get(`http://localhost:5000/api/line-tv/week-efficiency/${line}`, {
        headers,
        params: { startDate: addDays(monday, -7), endDate: addDays(monday, 6) },
      });
      if (reqId !== requestIdRef.current) return;
      setWeekHistory(res.data.history || []);
      setWeekError('');
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      console.error('Error fetching week efficiency:', err);
      setWeekError('No se pudo cargar la eficiencia semanal');
    }
  };

  const loadOperatorWeek = async (line, selectedDate, headers, reqId) => {
    try {
      const res = await axios.get(`http://localhost:5000/api/line-tv/operator-week-efficiency/${line}`, {
        headers,
        params: { startDate: mondayOf(selectedDate), endDate: selectedDate },
      });
      if (reqId !== requestIdRef.current) return;
      setOperatorWeekDays(res.data.days || []);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      console.error('Error fetching operator week efficiency:', err);
      // Table still works; the "Prom. semana" column shows only today's live values
    }
  };

  const loadAll = async (line, selectedDate, isRefresh = false) => {
    if (!line || !selectedDate) return;
    const reqId = ++requestIdRef.current;
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` };
    setLoading(true);
    await Promise.all([
      loadRuns(line, selectedDate, headers, reqId, isRefresh),
      loadWeek(line, selectedDate, headers, reqId),
      loadOperatorWeek(line, selectedDate, headers, reqId),
    ]);
    if (reqId === requestIdRef.current) {
      setLoading(false);
      setLastRefreshed(new Date());
    }
  };

  useEffect(() => {
    if (lineNo && date) {
      setNextRefreshAt(Date.now() + REFRESH_MS);
      loadAll(lineNo, date);
    }
  }, [lineNo, date]);

  const handleManualRefresh = () => {
    setNextRefreshAt(Date.now() + REFRESH_MS);
    loadAll(lineNo, date, true);
  };

  const toggleAutoRefresh = () => {
    if (!autoRefresh) setNextRefreshAt(Date.now() + REFRESH_MS);
    setAutoRefresh(!autoRefresh);
  };

  const handleDateChange = (newDate) => {
    setDate(newDate);
    setRunDataList([]);
    setWeekHistory([]);
    setOperatorWeekDays([]);
    setError('');
    setScreenIndex(0);
  };

  const handleLineChange = (newLine) => {
    setLineNo(newLine);
    setRunDataList([]);
    setWeekHistory([]);
    setOperatorWeekDays([]);
    setError('');
    setScreenIndex(0);
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (d) =>
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // ─── Screens: [graphs, operators page 1, page 2, …] for each style ─────────
  const screens = useMemo(() => {
    if (!runDataList.length) return [];
    const list = [{ type: 'charts', title: 'Eficiencia semanal' }];
    runDataList.forEach((rd, runIndex) => {
      const rows = buildOperatorRows(rd, date);
      const pages = Math.ceil(rows.length / ROWS_PER_PAGE);
      for (let p = 0; p < pages; p++) {
        list.push({
          type: 'operators',
          runIndex,
          page: p + 1,
          pages,
          rows: rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE),
          title: `Operadores${runDataList.length > 1 ? ` ${workOrderLabel(rd)}` : ''}${pages > 1 ? ` (${p + 1}/${pages})` : ''}`,
        });
      }
    });
    return list;
  }, [runDataList, date, nowTick]);

  const screenCount = screens.length;
  const activeIndex = screenCount ? screenIndex % screenCount : 0;
  const activeScreen = screens[activeIndex];

  // Change screen every 20 s (timer restarts after a manual jump)
  useEffect(() => {
    if (screenCount <= 1 || rotationPaused) return;
    const t = setTimeout(() => setScreenIndex((i) => (i + 1) % screenCount), ROTATE_MS);
    return () => clearTimeout(t);
  }, [screenIndex, screenCount, rotationPaused, rotationCycle]);

  const goToScreen = (i) => {
    setScreenIndex(i);
    setRotationCycle((c) => c + 1);
  };

  const toggleRotation = () => {
    if (rotationPaused) setRotationCycle((c) => c + 1);
    setRotationPaused(!rotationPaused);
  };

  const operatorWeekAverages = useMemo(
    () => buildOperatorWeekAverages(operatorWeekDays, runDataList, date),
    [operatorWeekDays, runDataList, date, nowTick]
  );

  const weekSeries = useMemo(() => {
    const todayEff = date === localYMD() ? combinedRealtimeEfficiency(runDataList, date) : null;
    return buildWeekSeries(weekHistory, date, todayEff);
  }, [weekHistory, runDataList, date, nowTick]);

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900"></div>
      </div>
    );
  }

  const showSpinner = loading && lineNo && runDataList.length === 0;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <style>{`
        @keyframes tvScreenProgress { from { width: 0%; } to { width: 100%; } }
        @media (prefers-reduced-motion: reduce) { .tv-progress { animation: none !important; width: 100% !important; } }
      `}</style>

      <Navlines
        user={user}
        selectedLine={lineNo}
        selectedDate={date}
        onLineChange={handleLineChange}
        onDateChange={handleDateChange}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
        onManualRefresh={handleManualRefresh}
        loading={loading}
        lastRefreshed={lastRefreshed}
        countdown={countdown}
        formatCountdown={formatCountdown}
        formatTime={formatTime}
      />

      <main className="flex-1 max-w-screen-2xl mx-auto px-4 py-4 w-full">
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-6 py-4 rounded-lg mb-4 text-xl font-semibold">
            ⚠️ {error}
          </div>
        )}

        {showSpinner && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
            <p className="mt-3 text-lg text-gray-600">Cargando datos...</p>
          </div>
        )}

        {lineNo && activeScreen && (
          <>
            {/* Screen indicator */}
            {screenCount > 1 && (
              <div className="mb-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-lg font-bold text-gray-700">{activeScreen.title}</span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {screens.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => goToScreen(i)}
                          aria-label={`Ir a ${s.title}`}
                          className={`h-3 rounded-full transition-all ${i === activeIndex ? 'w-8 bg-gray-900' : 'w-3 bg-gray-400 hover:bg-gray-600'}`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={toggleRotation}
                      className="px-3 py-1 text-sm font-semibold rounded-lg bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {rotationPaused ? '▶ Reanudar' : '⏸ Pausar'}
                    </button>
                  </div>
                </div>
                <div className="mt-2 h-1.5 bg-gray-300 rounded-full overflow-hidden">
                  {!rotationPaused && (
                    <div
                      key={`${activeIndex}-${rotationCycle}`}
                      className="tv-progress h-full bg-gray-900"
                      style={{ animation: `tvScreenProgress ${ROTATE_MS}ms linear forwards` }}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Screen 1: KPIs + weekly graphs */}
            {activeScreen.type === 'charts' && (
              <div className="space-y-4">
                {runDataList.length > 1 ? (
                  <MultiStyleKpiTable lineNo={lineNo} runList={runDataList} dateStr={date} />
                ) : (
                  <KpiStrip lineNo={lineNo} runData={runDataList[0]} dateStr={date} />
                )}

                {weekError ? (
                  <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-800 px-6 py-4 rounded-lg text-lg font-semibold">
                    ⚠️ {weekError}
                  </div>
                ) : (
                  <WeekComparisonChart lastWeek={weekSeries.last} currentWeek={weekSeries.current} />
                )}
              </div>
            )}

            {/* Screens 2…n: operator table pages */}
            {activeScreen.type === 'operators' && (
              <OperatorTable
                lineNo={lineNo}
                runData={runDataList[activeScreen.runIndex]}
                rows={activeScreen.rows}
                page={activeScreen.page}
                pages={activeScreen.pages}
                weekAverages={operatorWeekAverages}
              />
            )}
          </>
        )}

        {!loading && lineNo && runDataList.length === 0 && !error && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-800 px-6 py-8 rounded-lg text-center">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-2xl font-bold mb-3">No hay datos disponibles</h3>
            <p className="text-lg">No se encontraron datos de producción para la línea {lineNo} en la fecha {date}</p>
          </div>
        )}

        {!lineNo && (
          <div className="bg-white rounded-xl shadow-2xl p-16 text-center">
            <div className="text-7xl mb-6">📺</div>
            <h2 className="text-4xl font-black text-gray-800 mb-3">Selecciona una línea</h2>
            <p className="text-xl text-gray-500">para ver los datos en tiempo real</p>
          </div>
        )}
      </main>
    </div>
  );
}