// components/planner/StyleLearningCurves.jsx
//
// Tarjeta «Curvas de aprendizaje por estilo» (va debajo de «Resumen por
// cliente» en PlanOverview). Una fila por estilo con curva: líneas, órdenes,
// etapa actual y cuándo llega a su eficiencia final (70%).
//
// Clic en un estilo → panel lateral con:
//   • Por línea: día actual, fecha en que llega al 70% (plan) y cuándo llegó
//     de verdad (primer día con eficiencia real ≥ 70%).
//   • Gráfica: eficiencia de la curva (plan) vs real, por día de producción.
//   • Órdenes que corren dentro de la curva y en qué etapa.
//
// Datos:
//   GET /api/learning-curves?status=all          → curvas (todas las líneas)
//   GET /api/learning-curves/graph?style=X       → puntos plan/real del panel
//   workOrders + assignments (ya cargados por PlannerAnalytics)
//
// «Día N» sigue la misma regla que learning-curves.js: la N-ésima FECHA
// DISTINTA con piezas del estilo en esa línea desde el inicio de la curva.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, X, Loader2, Search, Info, ChevronRight, AlertTriangle,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const DEAD = new Set(["cancelled", "rejected"]);
const LINE_COLORS = ["#4f46e5", "#0891b2", "#d97706", "#db2777", "#059669", "#7c3aed", "#65a30d", "#dc2626"];

// ── Utilidades ─────────────────────────────────────────────────────────────
const norm = (s) => String(s ?? "").trim().toUpperCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const pad = (n) => String(n).padStart(2, "0");
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const pct = (e) => (e == null ? "—" : `${Math.round(Number(e) * 100)}%`);
const fmtInt = (v) => Math.round(num(v)).toLocaleString("es-MX");
const fmtDate = (s, year = false) => {
  const k = ymd(s);
  if (!k) return "—";
  const d = new Date(`${k}T00:00:00`);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-MX", year ? { day: "2-digit", month: "short", year: "2-digit" } : { day: "2-digit", month: "short" });
};
const calDays = (a, b) => {
  const x = new Date(`${ymd(a)}T00:00:00`), y = new Date(`${ymd(b)}T00:00:00`);
  return isNaN(x) || isNaN(y) ? null : Math.round((y - x) / 86400000);
};
const styleOfWo = (wo) => norm(wo?.style_code) || norm(wo?.estilo);
const TYPE_LABEL = { new: "Estilo nuevo", existing: "Estilo existente", custom: "Personalizada" };

// GET con reintentos (mismo criterio que PlannerAnalytics). Nunca lanza.
async function getJSON(path, retries = 2) {
  let last = { ok: false, data: null };
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) return { ok: true, data };
      last = { ok: false, data };
      if (res.status < 500 && res.status !== 429) return last;
    } catch {
      last = { ok: false, data: null };
    }
    if (i < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
  return last;
}

// Etapa del día N (copia de stageForDay del servidor).
function stageForDay(steps, n) {
  let start = 1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.days == null || n < start + s.days) return { index: i, eff: Number(s.eff), startDay: start };
    start += s.days;
  }
  const last = steps[steps.length - 1];
  return { index: steps.length - 1, eff: Number(last.eff), startDay: start };
}
// Día en que empieza la última etapa (p. ej. 7 para estilo nuevo, 5 para existente).
const finalDayOf = (steps) => 1 + steps.slice(0, -1).reduce((a, s) => a + (num(s.days) || 0), 0);

// ── Modelo de UNA curva (estilo + línea) a partir de las asignaciones ──────
function buildLine(curve, cellsByLineStyle, today) {
  const steps = Array.isArray(curve.steps) && curve.steps.length ? curve.steps : [{ days: null, eff: 0.7 }];
  const style = norm(curve.style);
  const line = String(curve.line_no);
  const cancelled = curve.status !== "active";
  const cutoff = cancelled && curve.cancelled_at ? ymd(curve.cancelled_at) : null;

  const cells = (cellsByLineStyle.get(`${line}|${style}`) || [])
    .filter((c) => c.date >= curve.start_date && (!cutoff || c.date <= cutoff));
  const dates = [...new Set(cells.map((c) => c.date))].sort();
  const dayOf = new Map(dates.map((d, i) => [d, i + 1]));

  const finalDay = finalDayOf(steps);
  const finalEff = Number(steps[steps.length - 1].eff);
  const reachDate = dates[finalDay - 1] || null;
  const currentDay = dates.filter((d) => d <= today).length;
  const stageNow = currentDay > 0 ? stageForDay(steps, currentDay) : null;

  let state;
  if (cancelled) state = "cancelled";
  else if (reachDate && reachDate <= today) state = "reached";
  else if (!dates.length || dates[0] > today) state = "pending";
  else if (!reachDate) state = "short";
  else state = "learning";

  // Órdenes que corren dentro de la curva en esta línea
  const orders = new Map();
  for (const c of cells) {
    const day = dayOf.get(c.date);
    let o = orders.get(c.woId);
    if (!o) { o = { woId: c.woId, line, qty: 0, first: c.date, last: c.date, minDay: day, maxDay: day, colors: new Set() }; orders.set(c.woId, o); }
    o.qty += c.qty;
    if (c.date < o.first) o.first = c.date;
    if (c.date > o.last) o.last = c.date;
    o.minDay = Math.min(o.minDay, day);
    o.maxDay = Math.max(o.maxDay, day);
    if (c.color) o.colors.add(c.color);
  }
  for (const o of orders.values()) {
    o.effFrom = stageForDay(steps, o.minDay).eff;
    o.effTo = stageForDay(steps, o.maxDay).eff;
    o.learning = o.minDay < finalDay; // al menos un día por debajo del 70%
  }

  return {
    id: curve.id, line, style, curve, steps, cancelled,
    dates, finalDay, finalEff, reachDate, currentDay, stageNow, state,
    calToReach: reachDate && dates[0] ? calDays(dates[0], reachDate) : null,
    orders: [...orders.values()],
  };
}

const LINE_STATE = {
  learning:  { label: "Aprendiendo",      chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/20", rank: 0 },
  short:     { label: "Faltan días",      chip: "bg-amber-50 text-amber-700 ring-amber-600/20",   rank: 1 },
  pending:   { label: "Por iniciar",      chip: "bg-gray-100 text-gray-600 ring-gray-500/20",     rank: 2 },
  reached:   { label: "En eficiencia final", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", rank: 3 },
  cancelled: { label: "Cancelada",        chip: "bg-gray-100 text-gray-400 ring-gray-400/20",     rank: 4 },
};

// ════════════════════════════════════════════════════════════════════════════
export default function StyleLearningCurves({ workOrders = [], assignments = [], compact = false }) {
  const [curves, setCurves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true); setErrored(false);
      const r = await getJSON("/api/learning-curves?status=all");
      if (off) return;
      if (r.ok && r.data?.success) setCurves(r.data.curves || []);
      else setErrored(true);
      setLoading(false);
    })();
    return () => { off = true; };
  }, [reloadKey]);

  const woById = useMemo(() => new Map(workOrders.map((w) => [String(w.id), w])), [workOrders]);

  // Celdas del tablero agrupadas por línea + estilo (para contar días y órdenes)
  const cellsByLineStyle = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (DEAD.has(String(a.status || "").toLowerCase())) continue;
      const qty = num(a.assigned_quantity);
      const date = ymd(a.assigned_date);
      if (!(qty > 0) || !date || a.line_no == null) continue;
      const wo = woById.get(String(a.work_order_id));
      const style = styleOfWo(wo);
      if (!style) continue;
      const k = `${String(a.line_no).trim()}|${style}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ date, qty, woId: String(a.work_order_id), color: a.color || wo?.color || "" });
    }
    return m;
  }, [assignments, woById]);

  const today = todayLocal();

  const styles = useMemo(() => {
    const by = new Map();
    for (const c of curves) {
      const key = norm(c.style);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(buildLine(c, cellsByLineStyle, today));
    }
    const descOf = new Map();
    for (const w of workOrders) {
      const s = styleOfWo(w);
      if (s && w.style_description && !descOf.has(s)) descOf.set(s, w.style_description);
    }
    const out = [];
    for (const [style, all] of by) {
      // Si hay curva activa y cancelada en la misma línea, cuenta la activa
      const lines = all.sort((a, b) => LINE_STATE[a.state].rank - LINE_STATE[b.state].rank || a.line.localeCompare(b.line, undefined, { numeric: true }));
      const live = lines.filter((l) => !l.cancelled);
      const orderIds = new Set(live.flatMap((l) => l.orders.map((o) => o.woId)));
      const state = live.length ? lines[0].state : "cancelled";
      out.push({
        style, description: descOf.get(style) || "", lines, live,
        orderCount: orderIds.size, state,
        search: `${style} ${descOf.get(style) || ""} ${lines.map((l) => `L${l.line}`).join(" ")}`.toUpperCase(),
      });
    }
    return out.sort((a, b) => LINE_STATE[a.state].rank - LINE_STATE[b.state].rank || a.style.localeCompare(b.style));
  }, [curves, cellsByLineStyle, workOrders, today]);

  const visible = useMemo(() => {
    const q = norm(search);
    return styles
      .filter((s) => showCancelled || s.live.length)
      .filter((s) => (q ? s.search.includes(q) : true));
  }, [styles, search, showCancelled]);

  const counts = useMemo(() => {
    const c = { learning: 0, reached: 0 };
    for (const s of styles) for (const l of s.live) {
      if (l.state === "reached") c.reached++;
      else if (l.state === "learning" || l.state === "short") c.learning++;
    }
    return c;
  }, [styles]);

  const sel = selected ? styles.find((s) => s.style === selected) : null;
  const closePanel = useCallback(() => setSelected(null), []);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className={`${compact ? "px-3 py-2" : "px-4 py-3"} border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap`}>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" /> Curvas de aprendizaje por estilo
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {loading ? "Cargando…" : `${counts.learning} líneas aprendiendo · ${counts.reached} ya en eficiencia final. Toque un estilo para ver la gráfica.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="rounded border-gray-300" />
            Incluir canceladas
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar estilo o línea…"
              className={`pl-7 pr-2 py-1 ${compact ? "w-36" : "w-44"} text-xs rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
            />
          </div>
        </div>
      </div>

      <div className={`${compact ? "max-h-[250px]" : "max-h-[420px]"} overflow-auto`}>
        {loading ? (
          <Empty><Loader2 className="w-4 h-4 animate-spin" /> Cargando curvas…</Empty>
        ) : errored ? (
          <Empty>
            No se pudieron cargar las curvas de aprendizaje.
            <button onClick={() => setReloadKey((k) => k + 1)} className="ml-2 rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700">Reintentar</button>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty>{styles.length ? "Ningún estilo coincide con la búsqueda." : "Ningún estilo tiene curva de aprendizaje. Se crean desde el Plan Board al asignar un estilo a una línea."}</Empty>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur border-b border-gray-200">
              <tr className="text-[11px] text-gray-500 text-left">
                <th className="px-4 py-2 font-medium">Estilo</th>
                <th className="px-3 py-2 font-medium">Líneas</th>
                <th className="px-3 py-2 font-medium text-right">Órdenes</th>
                <th className={`px-3 py-2 font-medium ${compact ? "w-40" : "w-56"}`}>Etapa actual</th>
                <th className="px-3 py-2 font-medium">Llega a eficiencia final</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((s) => {
                const lead = s.live[0] || s.lines[0];
                const active = selected === s.style;
                return (
                  <tr
                    key={s.style}
                    tabIndex={0}
                    onClick={() => setSelected(s.style)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(s.style))}
                    className={`cursor-pointer focus:outline-none focus-visible:bg-indigo-50 ${active ? "bg-indigo-50/60" : "hover:bg-gray-50"}`}
                  >
                    <td className={compact ? "px-3 py-1.5" : "px-4 py-2.5"}>
                      <div className="font-semibold text-gray-900 leading-tight">{s.style}</div>
                      <div className="text-[11px] text-gray-400 truncate max-w-[220px]">{s.description || "—"}</div>
                    </td>
                    <td className={`px-3 ${compact ? "py-1.5" : "py-2.5"}`}>
                      <div className="flex flex-wrap gap-1">
                        {s.lines.map((l) => (
                          <span key={l.id} title={LINE_STATE[l.state].label}
                            className={`px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ${LINE_STATE[l.state].chip}`}>L{l.line}</span>
                        ))}
                      </div>
                    </td>
                    <td className={`px-3 ${compact ? "py-1.5" : "py-2.5"} text-right tabular-nums text-gray-700`}>{s.orderCount}</td>
                    <td className={`px-3 ${compact ? "py-1.5" : "py-2.5"}`}><StageBar line={lead} /></td>
                    <td className={`px-3 ${compact ? "py-1.5" : "py-2.5"}`}>
                      <div className="space-y-0.5">
                        {s.live.slice(0, compact ? 1 : 3).map((l) => <ReachLine key={l.id} l={l} />)}
                        {s.live.length > (compact ? 1 : 3) && <div className="text-[11px] text-gray-400">+{s.live.length - (compact ? 1 : 3)} líneas más</div>}
                        {!s.live.length && <span className="text-[11px] text-gray-400">Curva cancelada</span>}
                      </div>
                    </td>
                    <td className="pr-3 text-gray-300"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {sel && (
        <CurvePanel
          entry={sel}
          woById={woById}
          onClose={closePanel}
        />
      )}
    </section>
  );
}

// Una línea del resumen «llega a 70%»
function ReachLine({ l }) {
  const target = pct(l.finalEff);
  let text, tone = "text-gray-600";
  if (l.state === "reached") { text = `${target} desde ${fmtDate(l.reachDate)}`; tone = "text-emerald-700"; }
  else if (l.state === "learning" || l.state === "pending") text = `${target} el ${fmtDate(l.reachDate)} · día ${l.finalDay}`;
  else if (l.state === "short") { text = `faltan ${l.finalDay - l.dates.length} días planeados para el ${target}`; tone = "text-amber-700"; }
  else text = "—";
  if (l.state === "pending" && !l.reachDate) text = `sin días planeados`;
  return (
    <div className={`text-[11px] tabular-nums ${tone}`}>
      <b className="font-semibold text-gray-800">L{l.line}</b> {text}
    </div>
  );
}

// Barra de etapas: cada bloque es una etapa, ancho según sus días; se llena
// hasta el día actual.
function StageBar({ line }) {
  if (!line) return null;
  const { steps, currentDay, finalDay } = line;
  const finalWidth = Math.max(1, Math.round(finalDay / 3));
  const widths = steps.map((s, i) => (i === steps.length - 1 ? finalWidth : num(s.days) || 1));
  const total = widths.reduce((a, b) => a + b, 0);
  let start = 1;
  return (
    <div>
      <div className="flex gap-0.5 h-4" aria-label={`Día ${currentDay} de la curva`}>
        {steps.map((s, i) => {
          const days = i === steps.length - 1 ? null : num(s.days);
          const segStart = start;
          if (days) start += days;
          const fill = days == null
            ? (currentDay >= segStart ? 1 : 0)
            : Math.max(0, Math.min(1, (currentDay - segStart + 1) / days));
          const isFinal = i === steps.length - 1;
          return (
            <div key={i} className="relative rounded-sm bg-gray-100 overflow-hidden" style={{ width: `${(widths[i] / total) * 100}%` }}>
              <div className={`absolute inset-y-0 left-0 ${isFinal ? "bg-emerald-500" : "bg-indigo-400"} ${line.cancelled ? "opacity-40" : ""}`} style={{ width: `${fill * 100}%` }} />
              <span className={`relative z-[1] block text-center text-[9px] leading-4 font-semibold ${fill > 0.5 ? "text-white" : "text-gray-500"}`}>{pct(s.eff)}</span>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
        {line.currentDay > 0 ? `L${line.line} · día ${line.currentDay} · ${pct(line.stageNow?.eff)}` : `L${line.line} · aún no arranca`}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="min-h-[90px] flex items-center justify-center gap-2 text-sm text-gray-500 px-6 py-6 text-center">{children}</div>;
}

// ════════════════════════════════════════════════════════════════════════════
// Panel lateral
// ════════════════════════════════════════════════════════════════════════════
function CurvePanel({ entry, woById, onClose }) {
  const [graph, setGraph] = useState(null);
  const [gLoading, setGLoading] = useState(true);
  const [gError, setGError] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());
  const [shown, setShown] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(id); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  useEffect(() => {
    let off = false;
    setGLoading(true); setGError(false); setHidden(new Set());
    (async () => {
      const r = await getJSON(`/api/learning-curves/graph?style=${encodeURIComponent(entry.style)}`);
      if (off) return;
      if (r.ok && r.data?.success) setGraph(r.data);
      else setGError(true);
      setGLoading(false);
    })();
    return () => { off = true; };
  }, [entry.style]);

  // Color fijo por línea (orden de la tarjeta)
  const colorOf = useMemo(() => {
    const m = new Map();
    entry.lines.forEach((l, i) => m.set(l.id, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [entry.lines]);

  // Series de la gráfica + primer día real ≥ eficiencia final, por curva
  const series = useMemo(() => {
    if (!graph?.series) return [];
    return graph.series
      .filter((s) => entry.lines.some((l) => l.id === s.curve.id))
      .map((s) => {
        const steps = s.curve.steps || [];
        const finalEff = Number(steps[steps.length - 1]?.eff ?? 0.7);
        const hit = s.points.find((p) => p.actual_efficiency != null && p.actual_efficiency >= finalEff - 0.0005);
        return { ...s, id: s.curve.id, line: String(s.curve.line_no), finalEff, actualReach: hit || null, color: colorOf.get(s.curve.id) || LINE_COLORS[0] };
      });
  }, [graph, entry.lines, colorOf]);

  const actualById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);

  const orders = useMemo(() => {
    const rows = [];
    for (const l of entry.lines) {
      if (l.cancelled && entry.live.length) continue;
      for (const o of l.orders) {
        const wo = woById.get(o.woId);
        rows.push({
          ...o, key: `${l.id}-${o.woId}`, finalEff: l.finalEff,
          no: wo?.work_order_no || `#${o.woId}`,
          customer: wo?.customer_name || "",
          color: [...o.colors].join(", ") || wo?.color || "—",
        });
      }
    }
    return rows.sort((a, b) => a.first.localeCompare(b.first) || a.line.localeCompare(b.line, undefined, { numeric: true }));
  }, [entry, woById]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="lc-panel-title">
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-gray-900/30 transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col
          transition-transform duration-200 ease-out motion-reduce:transition-none ${shown ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Encabezado */}
        <div className="shrink-0 px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="lc-panel-title" className="text-lg font-bold text-gray-900 leading-tight">{entry.style}</h2>
            <p className="text-xs text-gray-500 truncate">{entry.description || "Curva de aprendizaje"}</p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Cerrar panel"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-6">
          {/* Líneas: tiempo para llegar al 70% */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Líneas y tiempo para llegar a la eficiencia final</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {entry.lines.filter((l) => showLine(l, entry)).map((l) => (
                <LineCard key={l.id} l={l} color={colorOf.get(l.id)} actual={actualById.get(l.id)} loadingGraph={gLoading} />
              ))}
            </div>
          </section>

          {/* Gráfica */}
          <section>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <h3 className="text-sm font-semibold text-gray-800">Eficiencia por día de producción</h3>
              <div className="flex flex-wrap gap-1">
                {series.map((s) => {
                  const off = hidden.has(s.id);
                  return (
                    <button key={s.id}
                      onClick={() => setHidden((h) => { const n = new Set(h); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                      aria-pressed={!off}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 transition
                        ${off ? "ring-gray-200 text-gray-400" : "ring-gray-300 text-gray-700 bg-white"}`}>
                      <span className="w-2 h-2 rounded-full" style={{ background: off ? "#d1d5db" : s.color }} />L{s.line}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl ring-1 ring-gray-200 p-3">
              {gLoading ? (
                <Empty><Loader2 className="w-4 h-4 animate-spin" /> Cargando gráfica…</Empty>
              ) : gError ? (
                <Empty><AlertTriangle className="w-4 h-4 text-amber-500" /> No se pudo cargar la gráfica. Cierre y vuelva a abrir el estilo.</Empty>
              ) : !series.some((s) => s.points.length) ? (
                <Empty>Este estilo aún no tiene días asignados dentro de la curva.</Empty>
              ) : (
                <CurveChart series={series.filter((s) => !hidden.has(s.id))} />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 3" /></svg>Curva planeada</span>
                <span className="inline-flex items-center gap-1.5"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#6b7280" strokeWidth="2" /><circle cx="11" cy="4" r="3" fill="#6b7280" /></svg>Eficiencia real (empaque)</span>
                <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#10b981" strokeWidth="1.5" /></svg>Eficiencia final</span>
              </div>
            </div>
          </section>

          {/* Órdenes */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Órdenes dentro de la curva <span className="text-gray-400 font-normal">({orders.length})</span></h3>
            {orders.length === 0 ? (
              <div className="text-sm text-gray-500 rounded-xl ring-1 ring-gray-200 px-4 py-6 text-center">No hay órdenes asignadas a este estilo desde el inicio de la curva.</div>
            ) : (
              <div className="rounded-xl ring-1 ring-gray-200 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-[11px] text-gray-500 text-left">
                      <th className="px-3 py-2 font-medium">Orden</th>
                      <th className="px-3 py-2 font-medium">Línea</th>
                      <th className="px-3 py-2 font-medium">Color</th>
                      <th className="px-3 py-2 font-medium">Días de curva</th>
                      <th className="px-3 py-2 font-medium text-right">Pzas</th>
                      <th className="px-3 py-2 font-medium">Eficiencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orders.map((o) => (
                      <tr key={o.key}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-gray-900">{o.no}</div>
                          <div className="text-[11px] text-gray-400 truncate max-w-[180px]">{o.customer || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                            <span className="w-2 h-2 rounded-full" style={{ background: colorOf.get(entry.lines.find((l) => l.line === o.line)?.id) }} />L{o.line}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 truncate max-w-[120px]">{o.color}</td>
                        <td className="px-3 py-2 tabular-nums text-gray-700 whitespace-nowrap">
                          {o.minDay === o.maxDay ? `Día ${o.minDay}` : `Días ${o.minDay}–${o.maxDay}`}
                          <div className="text-[11px] text-gray-400">{fmtDate(o.first)}{o.last !== o.first && ` – ${fmtDate(o.last)}`}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtInt(o.qty)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${o.learning ? "bg-indigo-50 text-indigo-700 ring-indigo-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}`}>
                            {o.effFrom === o.effTo ? pct(o.effTo) : `${pct(o.effFrom)} → ${pct(o.effTo)}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="text-[11px] text-gray-400 inline-flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            «Día N» es el N-ésimo día con piezas del estilo en esa línea desde el inicio de la curva; fines de semana y días sin el estilo no cuentan. La eficiencia real sale de piezas empacadas × SAM ÷ minutos disponibles.
          </p>
        </div>
      </aside>
    </div>
  );
}

// Canceladas solo se muestran si el estilo no tiene ninguna curva viva
const showLine = (l, entry) => !l.cancelled || !entry.live.length;

// Meta de piezas del día con la curva: piezas/día al estándar × (ef. curva ÷ ef. estándar).
// Sin estándar capturado se usa lo asignado ese día.
const metaOf = (s, p) => {
  const std = num(s?.standard_efficiency), tgt = num(s?.standard_target);
  if (std > 0 && tgt > 0) return { qty: Math.floor(tgt * (num(p.planned_efficiency) / std)), fromStd: true };
  return { qty: num(p.planned_qty), fromStd: false };
};

// Resumen de la línea a hoy: meta y producido acumulados, ef. plan del día
// actual, ef. real (último día capturado y promedio ponderado por meta).
function lineStats(actual) {
  if (!actual?.points?.length) return null;
  const pts = actual.points;
  const past = pts.filter((p) => p.is_past);
  const cur = past[past.length - 1] || pts[0];
  let meta = 0, prod = 0, wEff = 0, wSum = 0, fromStd = true;
  for (const p of past) {
    const m = metaOf(actual, p);
    fromStd = fromStd && m.fromStd;
    meta += m.qty;
    prod += num(p.produced);
    if (p.actual_efficiency != null) { const w = Math.max(m.qty, 1); wEff += p.actual_efficiency * w; wSum += w; }
  }
  const withReal = past.filter((p) => p.actual_efficiency != null);
  return {
    started: past.length > 0,
    cur, curMeta: metaOf(actual, cur),
    meta, prod, fromStd,
    lastReal: withReal[withReal.length - 1] || null,
    avgReal: wSum > 0 ? wEff / wSum : null,
  };
}

function LineCard({ l, color, actual, loadingGraph }) {
  const st = LINE_STATE[l.state];
  const target = pct(l.finalEff);
  const real = actual?.actualReach;
  const stats = lineStats(actual);
  const wait = loadingGraph ? "…" : "—";
  return (
    <div className="rounded-xl ring-1 ring-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="font-semibold text-gray-900">Línea {l.line}</span>
          <span className="text-[11px] text-gray-400">{TYPE_LABEL[l.curve.curve_type] || ""}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${st.chip}`}>{st.label}</span>
      </div>
      <div className="mt-2"><StageBar line={l} /></div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-gray-500">Inicio</dt>
        <dd className="text-right tabular-nums text-gray-800">{fmtDate(l.dates[0] || l.curve.start_date, true)}</dd>
        <dt className="text-gray-500">Llega a {target} (plan)</dt>
        <dd className="text-right tabular-nums text-gray-800">
          {l.reachDate ? <>{fmtDate(l.reachDate, true)} <span className="text-gray-400">· día {l.finalDay}</span></> : <span className="text-amber-700">faltan {l.finalDay - l.dates.length} días</span>}
        </dd>
        <dt className="text-gray-500">Tiempo para {target}</dt>
        <dd className="text-right tabular-nums text-gray-800">
          {l.calToReach != null ? `${l.finalDay - 1} días prod. · ${l.calToReach} naturales` : `${l.finalDay - 1} días prod.`}
        </dd>
        <dt className="text-gray-500">Llegó a {target} (real)</dt>
        <dd className={`text-right tabular-nums ${real ? "text-emerald-700 font-medium" : "text-gray-400"}`}>
          {real ? `${fmtDate(real.date, true)} · día ${real.day}` : actual ? "aún no" : wait}
        </dd>
      </dl>

      {/* Meta, producido y eficiencias */}
      <dl className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-gray-500">{stats?.started ? `Meta día ${stats.cur.day}` : "Meta día 1"}</dt>
        <dd className="text-right tabular-nums text-gray-800" title={stats && !stats.curMeta.fromStd ? "Sin estándar capturado: se usa lo asignado" : undefined}>
          {stats ? `${fmtInt(stats.curMeta.qty)} pzas` : wait}
        </dd>
        <dt className="text-gray-500">Producido / meta</dt>
        <dd className="text-right tabular-nums text-gray-800">
          {!stats ? wait : !stats.started ? <span className="text-gray-400">aún no arranca</span> : (
            <>
              {fmtInt(stats.prod)} / {fmtInt(stats.meta)}
              {stats.meta > 0 && (
                <span className={`ml-1 font-medium ${stats.prod >= stats.meta ? "text-emerald-700" : "text-rose-600"}`}>
                  {Math.round((stats.prod / stats.meta) * 100)}%
                </span>
              )}
            </>
          )}
        </dd>
        <dt className="text-gray-500">Ef. plan</dt>
        <dd className="text-right tabular-nums text-gray-800">
          {stats ? <>{pct(stats.cur.planned_efficiency)} <span className="text-gray-400">· día {stats.cur.day}</span></> : wait}
        </dd>
        <dt className="text-gray-500">Ef. real</dt>
        <dd className="text-right tabular-nums">
          {!stats?.lastReal ? <span className="text-gray-400">{stats ? "sin captura" : wait}</span> : (
            <>
              <span className={`font-medium ${stats.lastReal.actual_efficiency >= stats.lastReal.planned_efficiency ? "text-emerald-700" : "text-rose-600"}`}>
                {pct(stats.lastReal.actual_efficiency)}
              </span>
              <span className="text-gray-400"> · prom. {pct(stats.avgReal)}</span>
            </>
          )}
        </dd>
      </dl>

      {actual?.points?.length > 0 && <DayTable l={l} actual={actual} />}
    </div>
  );
}

// Detalle por día de UNA línea: meta, producido, ef. plan y ef. real.
function DayTable({ l, actual }) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer select-none text-[11px] font-medium text-indigo-600 hover:text-indigo-800 list-none inline-flex items-center gap-1">
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        Detalle por día ({actual.points.length})
      </summary>
      <div className="mt-1.5 max-h-56 overflow-auto rounded-lg ring-1 ring-gray-100">
        <table className="w-full text-[11px] tabular-nums border-collapse">
          <thead className="sticky top-0 bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Día</th>
              <th className="px-2 py-1 text-left font-medium">Fecha</th>
              <th className="px-2 py-1 text-right font-medium">Meta</th>
              <th className="px-2 py-1 text-right font-medium">Prod.</th>
              <th className="px-2 py-1 text-right font-medium">Ef. plan</th>
              <th className="px-2 py-1 text-right font-medium">Ef. real</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {actual.points.map((p) => {
              const m = metaOf(actual, p);
              const reach = p.day === l.finalDay;
              const hasReal = p.actual_efficiency != null;
              return (
                <tr key={p.day} className={`${p.is_past ? "text-gray-800" : "text-gray-400"} ${reach ? "bg-emerald-50/60" : ""}`}>
                  <td className="px-2 py-1">{p.day}{reach && <span className="ml-1 text-emerald-700 font-medium">{pct(l.finalEff)}</span>}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td className="px-2 py-1 text-right" title={m.fromStd ? `Asignado ${fmtInt(p.planned_qty)}` : "Sin estándar: se usa lo asignado"}>{fmtInt(m.qty)}</td>
                  <td className={`px-2 py-1 text-right ${p.produced != null && m.qty > 0 ? (p.produced >= m.qty ? "text-emerald-700" : "text-rose-600") : ""}`}>
                    {p.produced != null ? fmtInt(p.produced) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right">{pct(p.planned_efficiency)}</td>
                  <td className={`px-2 py-1 text-right font-medium ${hasReal ? (p.actual_efficiency >= p.planned_efficiency ? "text-emerald-700" : "text-rose-600") : ""}`}>
                    {hasReal ? pct(p.actual_efficiency) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── Gráfica SVG: x = día de producción, y = eficiencia ─────────────────────
function CurveChart({ series }) {
  const [hover, setHover] = useState(null);
  const W = 680, H = 260, M = { l: 40, r: 14, t: 12, b: 28 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  const maxDay = Math.max(2, ...series.map((s) => s.points.length), ...series.map((s) => finalDayOf(s.curve.steps || []) + 1));
  const maxEff = Math.max(
    1,
    ...series.flatMap((s) => s.points.map((p) => p.actual_efficiency || 0)),
  );
  const yMax = Math.min(1.5, Math.ceil(maxEff * 10) / 10);
  const x = (d) => M.l + ((d - 1) / Math.max(1, maxDay - 1)) * iw;
  const y = (e) => M.t + ih - (Math.max(0, e) / yMax) * ih;
  const finalEffs = [...new Set(series.map((s) => s.finalEff))];
  const yTicks = [];
  for (let v = 0; v <= yMax + 1e-9; v += 0.25) yTicks.push(v);
  const xStep = maxDay > 30 ? 5 : maxDay > 14 ? 2 : 1;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const d = Math.round(((px - M.l) / iw) * (maxDay - 1)) + 1;
    setHover(d >= 1 && d <= maxDay ? d : null);
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label="Eficiencia planeada y real por día de producción">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#f3f4f6" />
            <text x={M.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {Array.from({ length: maxDay }, (_, i) => i + 1).filter((d) => d === 1 || d % xStep === 0).map((d) => (
          <text key={d} x={x(d)} y={H - 10} textAnchor="middle" fontSize="10" fill="#9ca3af">{d}</text>
        ))}
        <text x={W - M.r} y={H - 0} textAnchor="end" fontSize="10" fill="#9ca3af">día de producción</text>

        {finalEffs.map((f) => (
          <g key={f}>
            <line x1={M.l} x2={W - M.r} y1={y(f)} y2={y(f)} stroke="#10b981" strokeWidth="1.25" />
            <text x={W - M.r} y={y(f) - 4} textAnchor="end" fontSize="10" fontWeight="600" fill="#059669">{pct(f)}</text>
          </g>
        ))}

        {hover && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="#d1d5db" />}

        {series.map((s) => {
          // Curva planeada en escalones
          let dPlan = "";
          s.points.forEach((p, i) => {
            const px = x(p.day), py = y(p.planned_efficiency);
            if (i === 0) dPlan = `M${px},${py}`;
            else dPlan += ` L${px},${y(s.points[i - 1].planned_efficiency)} L${px},${py}`;
          });
          const act = s.points.filter((p) => p.actual_efficiency != null);
          const dAct = act.map((p, i) => `${i ? "L" : "M"}${x(p.day)},${y(p.actual_efficiency)}`).join(" ");
          const reachDay = finalDayOf(s.curve.steps || []);
          return (
            <g key={s.id}>
              <path d={dPlan} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="5 4" opacity="0.7" />
              {act.length > 1 && <path d={dAct} fill="none" stroke={s.color} strokeWidth="2" />}
              {act.map((p) => <circle key={p.day} cx={x(p.day)} cy={y(p.actual_efficiency)} r={hover === p.day ? 4.5 : 3} fill={s.color} />)}
              {reachDay <= s.points.length && (
                <circle cx={x(reachDay)} cy={y(s.points[reachDay - 1].planned_efficiency)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <Tooltip day={hover} series={series} leftPct={(x(hover) / W) * 100} />
      )}
    </div>
  );
}

function Tooltip({ day, series, leftPct }) {
  const rows = series.map((s) => ({ s, p: s.points[day - 1] })).filter((r) => r.p);
  if (!rows.length) return null;
  const right = leftPct > 60;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-lg bg-white/95 shadow-lg ring-1 ring-gray-200 px-3 py-2 text-[11px] min-w-[180px]"
      style={right ? { right: `${100 - leftPct + 2}%` } : { left: `${leftPct + 2}%` }}
    >
      <div className="font-semibold text-gray-800 mb-1">Día {day}</div>
      {rows.map(({ s, p }) => (
        <div key={s.id} className="flex items-start gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: s.color }} />
          <div className="tabular-nums text-gray-600">
            <b className="text-gray-800">L{s.line}</b> · {fmtDate(p.date)}
            <div>Plan {pct(p.planned_efficiency)} · Real {p.actual_efficiency != null ? pct(p.actual_efficiency) : p.is_past ? "sin captura" : "—"}</div>
            <div className="text-gray-400">{fmtInt(p.planned_qty)} pzas plan{p.produced != null && ` · ${fmtInt(p.produced)} empacadas`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}