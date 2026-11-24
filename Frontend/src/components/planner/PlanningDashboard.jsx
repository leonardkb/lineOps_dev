// components/planner/PlanningDashboard.jsx
//
// Planificación Avanzada → «Dashboard».
// Mismo formato que «Resumen plan» (PlanOverview): KPIs compactos, tarjetas
// Card/Table y chips de estado.
//
//   • KPIs del día seleccionado: órdenes, piezas asignadas, utilización,
//     líneas activas, sobrecargadas, capacidad libre, vencimientos, mejoras.
//   • Carga por línea del día (con las órdenes de cada línea).
//   • Próximos vencimientos (3 días).
//   • ¿Qué línea entrega antes?  Para cada orden abierta simula el resto de sus
//     piezas en cada línea (capacidad libre + ritmo del estilo en esa línea +
//     curva de aprendizaje) y lo compara con su línea actual.
//   • Ritmo por estilo: las líneas donde cada estilo activo rinde más.
//
// Fuentes: /api/planning/dashboard, /api/planning/available-lines,
// /api/work-orders, /api/line-assignments y /api/planning/style-fit
// (planning-style-fit.js: eficiencia real por estilo × línea).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ClipboardList, BarChart3, Gauge, Factory, AlertTriangle, PackageOpen, CalendarClock,
  Zap, LayoutGrid, Search, RefreshCw, Loader2, Calendar, Shirt, TrendingUp,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";
import { Kpi, Card, Table } from "./ForecastOverview";

// ── utilidades (mismas convenciones que PlanOverview) ──────────────────────
const DEAD = new Set(["cancelled", "rejected"]);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => Math.round(num(v)).toLocaleString();
const pct = (e) => `${Math.round(num(e) * 100)}%`;
// Fecha de un DATE/ISO sin correr la zona horaria.
const ymd = (v) => {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayYmd = () => ymd(new Date());
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isWeekend = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
};
const daysBetween = (a, b) => (a && b ? Math.round((new Date(`${ymd(b)}T00:00:00`) - new Date(`${ymd(a)}T00:00:00`)) / 86400000) : null);
const fmtDate = (s) => {
  const k = ymd(s);
  return k ? new Date(`${k}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
};
const lineLabel = (l) => `L${String(l).replace(/^L/i, "")}`;
const sortLines = (a, b) => (Number(String(a).replace(/\D/g, "")) || 0) - (Number(String(b).replace(/\D/g, "")) || 0) || String(a).localeCompare(String(b));
const styleKey = (wo) => String(wo?.style_code || wo?.estilo || "").trim().toUpperCase();

// Curvas de aprendizaje: las mismas que learning-curves.js.
const CURVES = {
  new: [{ days: 2, eff: 0.25 }, { days: 2, eff: 0.5 }, { days: 2, eff: 0.6 }, { days: null, eff: 0.7 }],
  existing: [{ days: 2, eff: 0.5 }, { days: 2, eff: 0.6 }, { days: null, eff: 0.7 }],
};
const curveEff = (steps, n) => {
  let start = 1;
  for (const s of steps) {
    if (s.days == null || n < start + s.days) return s.eff;
    start += s.days;
  }
  return steps[steps.length - 1].eff;
};

const MIN_HIST_DAYS = 2;      // días con empaque para confiar en el historial de estilo × línea
const HORIZON = 220;          // días hábiles simulados
const MIN_FREE = 0.05;        // < 5 % libre en el día = día lleno

const SRC = {
  hist: { label: "probado", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", tip: "Eficiencia real de este estilo en esta línea" },
  line: { label: "estimado", chip: "bg-amber-50 text-amber-700 ring-amber-600/20", tip: "Sin historial del estilo aquí: eficiencia real de la línea + curva de aprendizaje" },
  std:  { label: "estándar", chip: "bg-gray-100 text-gray-600 ring-gray-500/20", tip: "Sin historial: eficiencia configurada de la línea + curva de aprendizaje" },
};

const Chip = ({ className = "", title, children }) => (
  <span title={title} className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${className}`}>{children}</span>
);

// Barra de carga: verde < 70 %, ámbar < 90 %, rojo ≥ 90 %; marca la sobrecarga.
const LoadBar = ({ pct: p }) => {
  const v = num(p);
  const tone = v > 100 ? "bg-rose-600" : v >= 90 ? "bg-rose-500" : v >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(v, 100)}%` }} />
      </div>
      <span className={`w-10 text-right text-[11px] tabular-nums ${v > 100 ? "font-semibold text-rose-700" : "text-gray-600"}`}>{Math.round(v)}%</span>
    </div>
  );
};

// Ritmo de un estilo en una línea: pzas/día, eficiencia y de dónde sale.
const RateCell = ({ o, highlight = false }) => (
  <div className={`inline-flex flex-col rounded-lg px-2 py-1 ${highlight ? "bg-teal-50 ring-1 ring-teal-600/20" : "bg-gray-50"}`} title={SRC[o.source].tip}>
    <span className="text-[12px] font-semibold text-gray-900 tabular-nums">
      {lineLabel(o.line)} · {fmt(o.perDay)}<span className="text-[10px] font-normal text-gray-500"> pzas/día</span>
    </span>
    <span className="text-[10px] text-gray-500">
      efic. {pct(o.base)} · <span className={o.source === "hist" ? "text-emerald-700" : o.source === "line" ? "text-amber-700" : "text-gray-500"}>{SRC[o.source].label}</span>
    </span>
  </div>
);

// En 2xl: la tarjeta dentro de .pd-fill llena su contenedor y su cuerpo (último
// hijo de Card) hace scroll; los encabezados de tabla quedan fijos arriba.
const FILL_CSS = `
@media (min-width: 1536px) {
  .pd-fill > :first-child { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .pd-fill > :first-child > :last-child { flex: 1 1 0%; min-height: 0; overflow-y: auto; }
  /* el envoltorio con scroll horizontal de Table rompería el encabezado fijo */
  .pd-fill .overflow-x-auto, .pd-sticky .overflow-x-auto { overflow: visible; }
  .pd-fill thead th, .pd-sticky thead th { position: sticky; top: 0; z-index: 1; background: #fff; }
}
`;

// ── Ancho completo en pantallas grandes ─────────────────────────────────────
// La página que contiene el dashboard lo centra en un contenedor de ancho fijo.
// Desde BLEED_MIN px de ventana el dashboard se sale de ese contenedor y ocupa
// todo el ancho (con BLEED_GUTTER px de margen a cada lado). Se calcula con la
// caja de contenido del padre, así no hay scroll horizontal ni depende de 100vw.
const BLEED_MIN = 1280;
const BLEED_GUTTER = 24;
function useFullBleed() {
  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!parent) return undefined;
    const update = () => {
      const vw = document.documentElement.clientWidth;
      if (vw < BLEED_MIN) { setStyle(null); return; }
      const r = parent.getBoundingClientRect();
      const cs = getComputedStyle(parent);
      const left = r.left + parseFloat(cs.paddingLeft || 0) + parseFloat(cs.borderLeftWidth || 0) - BLEED_GUTTER;
      const right = vw - (r.right - parseFloat(cs.paddingRight || 0) - parseFloat(cs.borderRightWidth || 0)) - BLEED_GUTTER;
      const ml = Math.max(0, Math.round(left));
      const mr = Math.max(0, Math.round(right));
      setStyle((prev) => {
        if (!ml && !mr) return null;
        if (prev && prev.marginLeft === -ml && prev.marginRight === -mr) return prev;
        return { marginLeft: -ml, marginRight: -mr };
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return [ref, style];
}

export default function PlanningDashboard() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [summary, setSummary] = useState(null);
  const [deadlines, setDeadlines] = useState([]);
  const [lineLoad, setLineLoad] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [fit, setFit] = useState(null);
  const [fitError, setFitError] = useState("");
  const [loadingDay, setLoadingDay] = useState(false);
  const [loadingBase, setLoadingBase] = useState(false);
  const [error, setError] = useState("");
  const [recFilter, setRecFilter] = useState("better"); // better | unplanned | late | all
  const [search, setSearch] = useState("");
  const [bleedRef, bleedStyle] = useFullBleed();

  const get = useCallback(async (path) => {
    const token = localStorage.getItem("token");
    try {
      const r = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      return await r.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, []);

  // Datos del día seleccionado (una sola llamada al dashboard: resumen + vencimientos).
  const loadDay = useCallback(async () => {
    setLoadingDay(true);
    const [dash, lines] = await Promise.all([
      get(`/api/planning/dashboard?date=${selectedDate}`),
      get(`/api/planning/available-lines?date=${selectedDate}`),
    ]);
    if (dash.success) {
      setSummary(dash.summary);
      setDeadlines(dash.upcomingDeadlines || []);
      setError("");
    } else setError(dash.error || "No se pudo cargar el resumen del día.");
    if (lines.success) setLineLoad(lines.lines || []);
    setLoadingDay(false);
  }, [get, selectedDate]);

  // Datos que no dependen de la fecha: órdenes, asignaciones y rendimiento por estilo.
  const loadBase = useCallback(async () => {
    setLoadingBase(true);
    const [wos, asg, sf] = await Promise.all([
      get("/api/work-orders"),
      get("/api/line-assignments"),
      get("/api/planning/style-fit?days=120"),
    ]);
    if (wos.success) setWorkOrders(wos.workOrders || []);
    if (asg.success) setAssignments(asg.assignments || []);
    if (sf.success) { setFit(sf); setFitError(""); }
    else setFitError(sf.error || "Sin datos de rendimiento por estilo.");
    setLoadingBase(false);
  }, [get]);

  useEffect(() => { loadDay(); }, [loadDay]);
  useEffect(() => { loadBase(); }, [loadBase]);
  const refresh = () => { loadDay(); loadBase(); };

  const live = useMemo(
    () => assignments.filter((a) => !DEAD.has(String(a.status || "").toLowerCase()) && a.work_order_id != null && ymd(a.assigned_date)),
    [assignments]
  );
  const woById = useMemo(() => new Map(workOrders.map((w) => [String(w.id), w])), [workOrders]);

  // ── Carga del día seleccionado ───────────────────────────────────────────
  const dayLines = useMemo(() => {
    const byLine = new Map();
    for (const a of live) {
      if (ymd(a.assigned_date) !== selectedDate) continue;
      const ln = String(a.line_no);
      const m = byLine.get(ln) || new Map();
      const wo = woById.get(String(a.work_order_id));
      const cur = m.get(a.work_order_id) || {
        id: a.work_order_id,
        no: a.work_order_no || wo?.work_order_no || `#${a.work_order_id}`,
        style: a.style_description || wo?.style_description || "",
        qty: 0,
      };
      cur.qty += num(a.assigned_quantity);
      m.set(a.work_order_id, cur);
      byLine.set(ln, m);
    }
    return lineLoad
      .map((l) => ({
        line: String(l.line_no),
        target: num(l.target_pcs),
        assigned: num(l.assigned_quantity),
        free: num(l.available_capacity),
        util: num(l.utilization_percentage),
        holiday: !!l.holiday,
        orders: [...(byLine.get(String(l.line_no))?.values() || [])].sort((a, b) => b.qty - a.qty),
      }))
      .sort((a, b) => sortLines(a.line, b.line));
  }, [lineLoad, live, woById, selectedDate]);

  const dayKpi = useMemo(() => ({
    overloaded: dayLines.filter((l) => l.util > 100).length,
    idle: dayLines.filter((l) => !l.holiday && l.assigned <= 0).length,
    free: dayLines.reduce((t, l) => t + l.free, 0),
    capacity: dayLines.reduce((t, l) => t + l.target, 0),
  }), [dayLines]);

  const deadlineRows = useMemo(() => {
    const m = new Map();
    for (const d of deadlines) {
      const k = `${d.id}|${d.line_no}`;
      const g = m.get(k) || { ...d, assigned_quantity: 0 };
      g.assigned_quantity += num(d.assigned_quantity);
      if (ymd(d.planned_end_date) > ymd(g.planned_end_date)) g.planned_end_date = d.planned_end_date;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => ymd(a.planned_end_date).localeCompare(ymd(b.planned_end_date)));
  }, [deadlines]);

  // ── Modelo de ritmo por estilo × línea ───────────────────────────────────
  const model = useMemo(() => {
    if (!fit) return null;
    const today = fit.today || todayYmd();

    const cfg = new Map();
    for (const l of fit.lines || []) {
      const minutes = num(l.operators_count) * num(l.working_hours) * 60;
      if (minutes <= 0) continue;
      cfg.set(String(l.line_no), { minutes, cap: num(l.target_pcs), std: num(l.efficiency) || 0.7, ops: num(l.operators_count), hours: num(l.working_hours) });
    }

    const hist = new Map();
    const lineAgg = new Map();
    const styleAgg = new Map();
    for (const r of fit.history || []) {
      hist.set(`${r.style}|${r.line_no}`, r);
      const la = lineAgg.get(r.line_no) || { samOut: 0, minutes: 0, days: 0 };
      la.samOut += num(r.sam_out); la.minutes += num(r.minutes); la.days += num(r.days);
      lineAgg.set(r.line_no, la);
      const sa = styleAgg.get(r.style) || { samOut: 0, produced: 0 };
      sa.samOut += num(r.sam_out); sa.produced += num(r.produced);
      styleAgg.set(r.style, sa);
    }
    const lineEff = new Map([...lineAgg].map(([k, v]) => [k, { eff: v.minutes > 0 ? Math.min(v.samOut / v.minutes, 1.5) : 0, days: v.days }]));
    const styleSam = new Map([...styleAgg].map(([k, v]) => [k, v.produced > 0 ? v.samOut / v.produced : 0]));
    const seen = new Set(fit.seenStyles || []);

    // Días hábiles de planta desde hoy.
    const plantOff = new Set([...(fit.lockedDays || []), ...(fit.holidays || []).filter((h) => h.line_no == null).map((h) => h.d)]);
    const lineOff = new Set((fit.holidays || []).filter((h) => h.line_no != null).map((h) => `${h.line_no}|${h.d}`));
    const workdays = [];
    for (let d = today, guard = 0; workdays.length < HORIZON && guard < HORIZON * 3; d = addDays(d, 1), guard++) {
      if (!isWeekend(d) && !plantOff.has(d)) workdays.push(d);
    }
    const dayIdx = new Map(workdays.map((d, i) => [d, i]));

    // Ritmo de un estilo en una línea (pzas por día completo, sin curva).
    const rate = (S, L, sam) => {
      const c = cfg.get(L);
      if (!c || !(sam > 0)) return null;
      const h = hist.get(`${S}|${L}`);
      if (h && h.days >= MIN_HIST_DAYS && h.efficiency > 0) {
        return { line: L, source: "hist", base: h.efficiency, curve: null, perDay: (c.minutes * h.efficiency) / sam, histDays: h.days };
      }
      const le = lineEff.get(L);
      const useLine = le && le.days >= 3 && le.eff > 0;
      const base = useLine ? le.eff : c.std;
      return {
        line: L, source: useLine ? "line" : "std", base,
        curve: seen.has(S) ? CURVES.existing : CURVES.new, preset: seen.has(S) ? "existing" : "new",
        perDay: (c.minutes * base) / sam, histDays: h?.days || 0,
      };
    };

    return { today, cfg, hist, lineEff, styleSam, seen, workdays, dayIdx, lineOff, rate, window: fit.window };
  }, [fit]);

  // ── ¿Qué línea entrega antes? ────────────────────────────────────────────
  const recs = useMemo(() => {
    if (!model) return [];
    const { today, cfg, workdays, lineOff, rate, styleSam } = model;

    // Carga por línea-día desde hoy (asignaciones vivas + reservas PRE).
    const load = new Map();
    const own = new Map();          // `${wo}|${line}|${d}` → pzas de la propia orden
    const past = new Map();         // `${style}|${line}` → fechas pasadas con el estilo (día de la curva)
    const future = new Map();       // wo → { pcs, lines: Map, last }
    const assignedAll = new Map();  // wo → pzas asignadas (todas las fechas)
    for (const a of live) {
      const d = ymd(a.assigned_date);
      const L = String(a.line_no);
      const q = num(a.assigned_quantity);
      const wo = String(a.work_order_id);
      assignedAll.set(wo, (assignedAll.get(wo) || 0) + q);
      if (d < today) {
        const S = styleKey(a) || styleKey(woById.get(wo));
        const k = `${S}|${L}`;
        if (!past.has(k)) past.set(k, new Set());
        past.get(k).add(d);
        continue;
      }
      load.set(`${L}|${d}`, (load.get(`${L}|${d}`) || 0) + q);
      own.set(`${wo}|${L}|${d}`, (own.get(`${wo}|${L}|${d}`) || 0) + q);
      const f = future.get(wo) || { pcs: 0, lines: new Map(), last: null };
      f.pcs += q;
      f.lines.set(L, (f.lines.get(L) || 0) + q);
      if (!f.last || d > f.last) f.last = d;
      future.set(wo, f);
    }
    for (const h of fit?.holds || []) load.set(`${h.line_no}|${h.d}`, (load.get(`${h.line_no}|${h.d}`) || 0) + num(h.qty));

    const simulate = (woId, S, L, pcs, sam) => {
      const r = rate(S, L, sam);
      const c = cfg.get(L);
      if (!r || !c) return null;
      let rem = pcs;
      let n = past.get(`${S}|${L}`)?.size || 0;
      let start = null;
      for (let i = 0; i < workdays.length; i++) {
        const d = workdays[i];
        if (lineOff.has(`${L}|${d}`)) continue;
        const used = (load.get(`${L}|${d}`) || 0) - (own.get(`${woId}|${L}|${d}`) || 0);
        const free = c.cap > 0 ? Math.max(0, 1 - used / c.cap) : used > 0 ? 0 : 1;
        if (free < MIN_FREE) continue;
        n++;
        const eff = r.curve ? Math.min(curveEff(r.curve, n), r.base) : r.base;
        if (start == null) start = d;
        rem -= (free * c.minutes * eff) / sam;
        if (rem <= 0.5) return { ...r, start, finish: d, idx: i };
      }
      return { ...r, start, finish: null, idx: Infinity };
    };

    const out = [];
    for (const wo of workOrders) {
      const st = String(wo.status || "").toLowerCase();
      if (DEAD.has(st) || st === "completed") continue;
      const id = String(wo.id);
      const target = num(wo.total_to_produce) || num(wo.quantity);
      const produced = num(wo.produced_quantity);
      if (target > 0 && produced >= target) continue;
      const assigned = Math.max(num(wo.assigned_quantity), assignedAll.get(id) || 0);
      const unassigned = Math.max(target - assigned, 0);
      const f = future.get(id);
      const pcs = (f?.pcs || 0) + unassigned;
      if (pcs <= 0) continue;

      const S = styleKey(wo);
      const sam = num(wo.sam_minutes) || styleSam.get(S) || 0;
      const curLines = f ? [...f.lines.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l) : [];
      const primary = curLines[0] || null;
      const base = {
        id, no: wo.work_order_no || `#${id}`, customer: wo.customer_name || "—", style: S || "—",
        styleName: wo.style_description || "", pcs, unassigned, futurePcs: f?.pcs || 0,
        curLines, boardFinish: f?.last || null, delivery: ymd(wo.commitment_date) || null, sam,
        search: `${wo.work_order_no} ${wo.customer_name} ${wo.style_code} ${wo.estilo} ${wo.customer_po}`.toUpperCase(),
      };
      if (!(sam > 0)) { out.push({ ...base, kind: primary ? "planned" : "unplanned", noSam: true, better: false, options: [] }); continue; }

      const cur = primary ? simulate(id, S, primary, pcs, sam) : null;
      const options = [...cfg.keys()]
        .filter((L) => L !== primary)
        .map((L) => simulate(id, S, L, pcs, sam))
        .filter((o) => o && o.finish)
        .sort((a, b) => a.idx - b.idx || b.perDay - a.perDay);
      const best = options[0] || null;

      let gain = null;
      if (cur && best) gain = cur.idx === Infinity ? HORIZON : cur.idx - best.idx;
      const better = primary
        ? !!best && (gain >= 1 || (gain === 0 && best.perDay >= (cur?.perDay || 0) * 1.1))
        : !!best;
      const curFinish = cur?.finish || base.boardFinish;
      const lateNow = !!(base.delivery && curFinish && curFinish > base.delivery);
      const fixesLate = !!(lateNow && best && best.finish <= base.delivery);
      const altSlack = best && base.delivery ? daysBetween(best.finish, base.delivery) : null;

      out.push({ ...base, kind: primary ? "planned" : "unplanned", cur, best, options: options.slice(0, 3), gain, better, lateNow, fixesLate, altSlack,
        rateGain: cur && best && cur.perDay > 0 ? best.perDay / cur.perDay - 1 : null });
    }
    return out;
  }, [model, live, workOrders, woById, fit]);

  const recKpi = useMemo(() => ({
    better: recs.filter((r) => r.kind === "planned" && r.better).length,
    fixes: recs.filter((r) => r.fixesLate).length,
    unplanned: recs.filter((r) => r.kind === "unplanned").length,
  }), [recs]);

  const visibleRecs = useMemo(() => {
    const q = search.trim().toUpperCase();
    return recs
      .filter((r) => {
        if (recFilter === "better") return r.kind === "planned" && r.better;
        if (recFilter === "unplanned") return r.kind === "unplanned";
        if (recFilter === "late") return r.lateNow;
        return true;
      })
      .filter((r) => (q ? r.search.includes(q) : true))
      .sort((a, b) => Number(b.fixesLate) - Number(a.fixesLate) || (b.gain ?? -1) - (a.gain ?? -1) || String(a.delivery || "9999").localeCompare(String(b.delivery || "9999")));
  }, [recs, recFilter, search]);

  // ── Ritmo por estilo (estilos con piezas pendientes) ─────────────────────
  const styleRank = useMemo(() => {
    if (!model) return [];
    const g = new Map();
    for (const r of recs) {
      if (r.style === "—" || !(r.sam > 0)) continue;
      const s = g.get(r.style) || { style: r.style, name: r.styleName, orders: 0, pcs: 0, samSum: 0, lines: new Set() };
      s.orders++; s.pcs += r.pcs; s.samSum += r.sam * r.pcs;
      r.curLines.forEach((l) => s.lines.add(l));
      g.set(r.style, s);
    }
    return [...g.values()]
      .map((s) => {
        const sam = s.pcs > 0 ? s.samSum / s.pcs : 0;
        const all = [...model.cfg.keys()].map((L) => model.rate(s.style, L, sam)).filter(Boolean).sort((a, b) => b.perDay - a.perDay);
        const current = all.filter((o) => s.lines.has(o.line));
        const curBest = current[0] || null;
        const top = all.slice(0, 3);
        const lift = curBest && top[0] && curBest.perDay > 0 ? top[0].perDay / curBest.perDay - 1 : null;
        const proven = all.filter((o) => o.source === "hist").length;
        return { ...s, sam, top, curBest, lift, proven, lines: [...s.lines].sort(sortLines) };
      })
      .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1) || b.pcs - a.pcs);
  }, [model, recs]);

  const busy = loadingDay || loadingBase;

  return (
    <div ref={bleedRef} style={bleedStyle || undefined} className="h-full overflow-auto">
      <div className="w-full px-3 sm:px-4 lg:px-5 py-3 space-y-4">
        {/* Barra superior */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">Dashboard de Planificación</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-gray-500">Fuente: Plan Board + producción real{model?.window ? ` (${model.window.days} días)` : ""}</span>
            <label className="h-8 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2">
              <Calendar className="w-4 h-4 text-gray-500" aria-hidden />
              <span className="sr-only">Fecha</span>
              <input type="date" value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="text-sm bg-transparent focus:outline-none" />
            </label>
            <button onClick={refresh} title="Actualizar" aria-label="Actualizar"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={loadDay} className="font-semibold hover:underline">Reintentar</button>
          </div>
        )}

        {!summary && loadingDay ? (
          <div className="py-24 flex justify-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <Kpi Icon={ClipboardList} label="Órdenes totales" value={fmt(summary?.total_work_orders)}
                sub={`${fmt(summary?.pending_orders)} pend · ${fmt(summary?.assigned_orders)} asig · ${fmt(summary?.completed_orders)} comp`} />
              <Kpi Icon={BarChart3} label="Pzas asignadas" value={fmt(summary?.total_assigned_quantity)} sub={`para ${fmtDate(selectedDate)}`} />
              <Kpi Icon={Gauge} label="Utilización" value={`${Math.round(num(summary?.capacity_utilization))}%`}
                sub={`de ${fmt(dayKpi.capacity)} pzas de capacidad`}
                tone={num(summary?.capacity_utilization) > 100 ? "bad" : num(summary?.capacity_utilization) >= 70 ? "ok" : "warn"} />
              <Kpi Icon={Factory} label="Líneas activas" value={`${fmt(summary?.lines_utilized)} / ${fmt(summary?.active_lines)}`}
                sub={dayKpi.idle ? `${dayKpi.idle} sin carga` : "todas con carga"} tone={dayKpi.idle ? "warn" : "ok"} />
              <Kpi Icon={AlertTriangle} label="Sobrecargadas" value={fmt(dayKpi.overloaded)} sub="carga > 100 %" tone={dayKpi.overloaded ? "bad" : "ok"} />
              <Kpi Icon={PackageOpen} label="Capacidad libre" value={fmt(dayKpi.free)} sub="pzas disponibles ese día" tone="info" />
              <Kpi Icon={CalendarClock} label="Vencen en 3 días" value={fmt(new Set(deadlineRows.map((d) => d.id)).size)} sub="órdenes con fin de plan" tone={deadlineRows.length ? "warn" : "muted"} />
              <Kpi Icon={Zap} label="Entregan antes" value={model ? fmt(recKpi.better) : "—"}
                sub={model ? `${fmt(recKpi.fixes)} corrigen atraso` : "sin datos de ritmo"} tone={recKpi.fixes ? "bad" : recKpi.better ? "warn" : "ok"} />
            </div>

            {/* En 2xl la fila mide lo que mide «Próximos vencimientos» (mín. 340 px,
                máx. ~480 px de lista). «Carga por línea» y «Dónde rinde más» van en
                absoluto para no estirar la fila y hacen scroll dentro de su tarjeta,
                así «¿Qué línea entrega antes?» queda a la vista sin bajar. */}
            <style>{FILL_CSS}</style>
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] 2xl:grid-cols-[1.5fr_1fr_1fr] gap-4 lg:items-start 2xl:items-stretch">
              {/* Carga por línea del día */}
              <div className="relative min-w-0 2xl:min-h-[340px]"><div className="pd-fill 2xl:absolute 2xl:inset-0">
              <Card title={`Carga por línea · ${fmtDate(selectedDate)}`} Icon={LayoutGrid}>
                {dayLines.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No hay líneas configuradas para esta fecha.</p>
                ) : (
                  <Table cols={["Línea", "Órdenes del día", "Asignado / cap.", "Carga", "Libre"]} align={["l", "l", "r", "l", "r"]}>
                    {dayLines.map((l) => (
                      <tr key={l.line} className={`border-t border-gray-100 ${l.util > 100 ? "bg-rose-50/40" : ""}`}>
                        <td className="py-2 px-2 font-semibold whitespace-nowrap">{lineLabel(l.line)}</td>
                        <td className="py-2 px-2">
                          {l.holiday ? (
                            <Chip className="bg-gray-100 text-gray-500 ring-gray-500/20">Día bloqueado</Chip>
                          ) : l.orders.length === 0 ? (
                            <span className="text-[11px] text-gray-400">Sin órdenes</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {l.orders.map((o) => (
                                <span key={o.id} title={o.style}
                                  className="inline-flex items-center gap-1 rounded-full bg-gray-50 ring-1 ring-inset ring-gray-200 pl-1.5 pr-2 py-0.5 text-[11px]">
                                  <span className={`w-2 h-2 rounded-full ${colorForWO(o.id).dot}`} aria-hidden />
                                  <span className="font-mono font-medium text-gray-800">{o.no}</span>
                                  <span className="text-gray-500 tabular-nums">{fmt(o.qty)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(l.assigned)} / {fmt(l.target)}</td>
                        <td className="py-2 px-2 min-w-[120px]"><LoadBar pct={l.util} /></td>
                        <td className={`py-2 px-2 text-right tabular-nums ${l.free > 0 ? "text-emerald-700 font-semibold" : "text-gray-400"}`}>{l.free > 0 ? fmt(l.free) : "—"}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
              </div></div>

              {/* En 2xl esta columna se reparte: vencimientos y estilos van lado a lado */}
              <div className="min-w-0 flex flex-col gap-4 2xl:contents">
                {/* Próximos vencimientos */}
                <Card title="Próximos vencimientos (3 días)" Icon={CalendarClock}>
                  <div className="pd-sticky 2xl:max-h-[480px] 2xl:overflow-y-auto">
                  {deadlineRows.length === 0 ? (
                    <p className="text-sm text-gray-500 py-6 text-center">Ninguna orden termina en los próximos 3 días.</p>
                  ) : (
                    <Table cols={["Orden", "Línea", "Pzas", "Fin plan", "Entrega"]} align={["l", "l", "r", "l", "l"]}>
                      {deadlineRows.map((d) => {
                        const late = d.commitment_date && ymd(d.planned_end_date) > ymd(d.commitment_date);
                        return (
                          <tr key={`${d.id}-${d.line_no}`} className="border-t border-gray-100">
                            <td className="py-2 px-2">
                              <div className="font-mono font-semibold text-gray-900 text-[12px] whitespace-nowrap">{d.work_order_no}</div>
                              <div className="text-[11px] text-gray-600 max-w-[160px] truncate">{d.customer_name || "—"}</div>
                            </td>
                            <td className="py-2 px-2 font-medium">{lineLabel(d.line_no)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmt(d.assigned_quantity)}</td>
                            <td className="py-2 px-2 whitespace-nowrap">{fmtDate(d.planned_end_date)}</td>
                            <td className={`py-2 px-2 whitespace-nowrap ${late ? "text-rose-700 font-semibold" : ""}`}>{fmtDate(d.commitment_date)}</td>
                          </tr>
                        );
                      })}
                    </Table>
                  )}
                  </div>
                </Card>

                {/* Ritmo por estilo */}
                <div className="relative min-w-0 2xl:min-h-[340px]"><div className="pd-fill 2xl:absolute 2xl:inset-0">
                <Card title="Dónde rinde más cada estilo" Icon={Shirt}>
                  {!model ? (
                    <p className="text-sm text-gray-500 py-6 text-center">{loadingBase ? "Calculando…" : fitError || "Sin datos."}</p>
                  ) : styleRank.length === 0 ? (
                    <p className="text-sm text-gray-500 py-6 text-center">No hay estilos con piezas pendientes y SAM capturado.</p>
                  ) : (
                    <div className="max-h-[460px] overflow-y-auto 2xl:max-h-none 2xl:overflow-visible divide-y divide-gray-100 -mx-1">
                      {styleRank.map((s) => (
                        <div key={s.style} className="px-1 py-2.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-mono font-semibold text-[12px] text-gray-900">{s.style}</span>
                              <span className="ml-2 text-[11px] text-gray-500">{fmt(s.pcs)} pzas · {s.orders} órd. · SAM {s.sam.toFixed(2)}</span>
                            </div>
                            {s.lift != null && s.lift >= 0.1 && (
                              <Chip className="bg-teal-50 text-teal-700 ring-teal-600/20" title="Ritmo de la mejor línea vs. la mejor de sus líneas actuales">
                                <TrendingUp className="w-3 h-3 mr-0.5" aria-hidden />+{Math.round(s.lift * 100)}%
                              </Chip>
                            )}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">
                            Actual: {s.curBest ? <>{lineLabel(s.curBest.line)} · <span className="tabular-nums">{fmt(s.curBest.perDay)}</span> pzas/día</> : "sin línea asignada"}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {s.top.map((o) => <RateCell key={o.line} o={o} highlight={s.lines.includes(o.line)} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
                </div></div>
              </div>
            </div>

            {/* Recomendaciones */}
            <Card
              title="¿Qué línea entrega antes?"
              Icon={Zap}
              right={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-[12px]">
                    {[["better", `Con mejora (${recKpi.better})`], ["late", "Atrasadas"], ["unplanned", `Por planear (${recKpi.unplanned})`], ["all", "Todas"]].map(([k, l]) => (
                      <button key={k} onClick={() => setRecFilter(k)}
                        className={`px-2.5 py-1 rounded-md ${recFilter === k ? "bg-white shadow-sm font-semibold text-gray-900" : "text-gray-500 hover:text-gray-800"}`}>{l}</button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" aria-hidden />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="OT, cliente, estilo, PO…" aria-label="Buscar orden"
                      className="h-8 w-48 pl-7 pr-2 text-[12px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  </div>
                </div>
              }
            >
              {!model ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {loadingBase ? "Calculando ritmos por línea…" : `No se pudo calcular: ${fitError || "sin datos"}. Revisa que planning-style-fit.js esté registrado en el servidor.`}
                </p>
              ) : (
                <>
                  <Table
                    cols={["Orden", "Pzas a producir", "Línea actual", "Fin actual", "Mejor alternativa", "Fin alternativa", "Ganas", "Entrega", "Otras opciones"]}
                    align={["l", "r", "l", "l", "l", "l", "r", "l", "l"]}
                  >
                    {visibleRecs.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 align-top">
                        <td className="py-2 px-2">
                          <div className="font-mono font-semibold text-gray-900 text-[12px] whitespace-nowrap">{r.no}</div>
                          <div className="text-[11px] text-gray-600 max-w-[190px] truncate">{r.style} · {r.customer}</div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {fmt(r.pcs)}
                          {r.unassigned > 0 && <div className="text-[10px] text-amber-700">{fmt(r.unassigned)} sin asignar</div>}
                        </td>
                        <td className="py-2 px-2">
                          {r.cur ? <RateCell o={r.cur} /> : <span className="text-[11px] text-gray-400">{r.curLines.length ? r.curLines.map(lineLabel).join(", ") : "—"}</span>}
                          {r.curLines.length > 1 && <div className="text-[10px] text-gray-500 mt-0.5">también {r.curLines.slice(1).map(lineLabel).join(", ")}</div>}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {r.cur ? (r.cur.finish ? fmtDate(r.cur.finish) : "> horizonte") : "—"}
                          {r.boardFinish && <div className="text-[10px] text-gray-500">tablero: {fmtDate(r.boardFinish)}</div>}
                        </td>
                        <td className="py-2 px-2">
                          {r.noSam ? <span className="text-[11px] text-gray-400">Falta SAM en la orden</span>
                            : r.best ? <RateCell o={r.best} highlight={r.better} />
                            : <span className="text-[11px] text-gray-400">Ninguna línea termina dentro del horizonte</span>}
                          {r.best?.curve && (
                            <div className="text-[10px] text-amber-700 mt-0.5">incluye curva de aprendizaje ({r.best.preset === "new" ? "estilo nuevo" : "estilo existente"})</div>
                          )}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap font-medium">
                          {r.best ? fmtDate(r.best.finish) : "—"}
                          {r.best?.start && <div className="text-[10px] font-normal text-gray-500">inicia {fmtDate(r.best.start)}</div>}
                        </td>
                        <td className={`py-2 px-2 text-right tabular-nums font-semibold ${r.gain > 0 ? "text-emerald-700" : r.gain < 0 ? "text-gray-400" : "text-gray-500"}`}>
                          {r.gain == null ? "—" : r.gain > 0 ? (r.gain >= HORIZON ? `> ${HORIZON} d háb.` : `${r.gain} d háb.`) : r.gain === 0 ? "mismo día" : `${r.gain} d`}
                          {r.rateGain != null && Math.abs(r.rateGain) >= 0.05 && (
                            <div className={`text-[10px] font-normal ${r.rateGain > 0 ? "text-emerald-700" : "text-gray-500"}`}>ritmo {r.rateGain > 0 ? "+" : ""}{Math.round(r.rateGain * 100)}%</div>
                          )}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {fmtDate(r.delivery)}
                          {r.fixesLate ? <div className="mt-0.5"><Chip className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">Corrige atraso</Chip></div>
                            : r.lateNow ? <div className="mt-0.5"><Chip className="bg-rose-50 text-rose-700 ring-rose-600/20">Atrasada</Chip></div>
                            : r.altSlack != null ? <div className="text-[10px] text-gray-500">holgura alt. {r.altSlack > 0 ? `+${r.altSlack}` : r.altSlack} d</div> : null}
                        </td>
                        <td className="py-2 px-2 text-[11px] text-gray-600">
                          {r.options.slice(1).map((o) => (
                            <div key={o.line} className="whitespace-nowrap tabular-nums">{lineLabel(o.line)} · {fmtDate(o.finish)} · {fmt(o.perDay)}/d</div>
                          ))}
                          {r.options.length <= 1 && "—"}
                        </td>
                      </tr>
                    ))}
                    {visibleRecs.length === 0 && (
                      <tr><td colSpan={9} className="py-8 text-center text-sm text-gray-500">
                        {recFilter === "better" ? "Ninguna orden planeada termina antes en otra línea." : "Sin órdenes con este filtro."}
                      </td></tr>
                    )}
                  </Table>
                  <p className="mt-2 text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                    <span><b className="text-gray-700">Pzas/día</b>: operarios × horas × 60 × eficiencia ÷ SAM de la orden, a día completo.</span>
                    <span><b className="text-gray-700">Probado</b>: eficiencia real del estilo en esa línea (≥ {MIN_HIST_DAYS} días con empaque). <b className="text-gray-700">Estimado</b>: eficiencia real de la línea + curva de aprendizaje.</span>
                    <span><b className="text-gray-700">Fin</b>: el resto de la orden simulado desde hoy en la capacidad libre de cada línea (asignaciones, reservas PRE, fines de semana y festivos). Actual y alternativa usan el mismo cálculo; «tablero» es el último día asignado hoy.</span>
                    <span><b className="text-gray-700">Ganas</b>: días hábiles que se adelanta la entrega al mover la orden.</span>
                  </p>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}