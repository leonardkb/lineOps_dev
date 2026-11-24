// components/planner/LearningCurves.jsx
//
// Curvas de aprendizaje por ESTILO + LÍNEA en el Plan Board.
//
//   Estilo NUEVO      días 1-2 → 25% · días 3-4 → 50% · días 5-6 → 60% · día 7+ → 70%
//   Estilo EXISTENTE  días 1-2 → 50% · días 3-4 → 60% · día 5+   → 70%
//
// "Día N" = la N-ésima fecha DISTINTA con piezas del estilo en esa línea desde
// el inicio de la curva (misma regla que learning-curves.js en el servidor).
// Cuentan las casillas de POs y las reservas de pre-órdenes (PRE####).
// En esos días la eficiencia del estándar se reemplaza por la de la curva
// (nunca por encima del estándar):
//     piezas/día = operarios × horas × 60 × eficiencia_curva ÷ SAM
//
// Piezas:
//   helpers puros      lcKey, stageForDay, curveDayOn, curveFactor, buildCurveIndex
//   <LearningCurvePrompt>   pregunta al soltar un estilo nuevo / aplica a uno existente
//   <LearningCurvesModal>   lista de curvas + gráfica por estilo
import { useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertCircle, TrendingUp, Plus, Search } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

// ---------------------------------------------------------------------------
// Helpers (sin React)
// ---------------------------------------------------------------------------
export const LC_PRESETS = {
  new: [
    { days: 2, eff: 0.25 },
    { days: 2, eff: 0.5 },
    { days: 2, eff: 0.6 },
    { days: null, eff: 0.7 },
  ],
  existing: [
    { days: 2, eff: 0.5 },
    { days: 2, eff: 0.6 },
    { days: null, eff: 0.7 },
  ],
};
export const LC_TYPE_LABEL = { new: "Estilo nuevo", existing: "Estilo existente", custom: "Personalizada" };

const normStyleKey = (s) => String(s ?? "").trim().toUpperCase();
const normLineNo = (l) => (l == null ? "" : String(l).trim());
export const lcKey = (style, line) => `${normStyleKey(style)}|${normLineNo(line)}`;

export const normEff = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1 ? n / 100 : n;
};
const pct = (e) => (e == null ? "—" : `${Math.round(Number(e) * 100)}%`);
const dm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—");

export function stageForDay(steps, n) {
  let start = 1;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.days == null || n < start + s.days) {
      return { index: i, eff: Number(s.eff), dayInStage: n - start + 1, startDay: start, isFinal: i === steps.length - 1 };
    }
    start += s.days;
  }
  const last = steps[steps.length - 1];
  return { index: steps.length - 1, eff: Number(last.eff), dayInStage: 1, startDay: start, isFinal: true };
}

// "Día 1-2", "Día 7+"
export const stepRanges = (steps) => {
  let start = 1;
  return steps.map((s) => {
    const label = s.days == null ? `Día ${start}+` : s.days === 1 ? `Día ${start}` : `Días ${start}-${start + s.days - 1}`;
    if (s.days != null) start += s.days;
    return { ...s, label };
  });
};

// Día de curva de `date`. sortedDates = fechas ya asignadas del estilo en la
// línea (≥ inicio); extra = fechas que se están planeando ahora (soltar).
export function curveDayOn(curve, sortedDates, date, extra = null) {
  if (!curve || !date || date < curve.start_date) return null;
  const set = new Set();
  for (const d of sortedDates || []) if (d < date) set.add(d);
  if (extra) for (const d of extra) if (d >= curve.start_date && d < date) set.add(d);
  const day = set.size + 1;
  return { day, ...stageForDay(curve.steps, day) };
}

// Factor sobre la capacidad estándar (≤ 1).
export function curveFactor(curveEff, stdEff) {
  const std = normEff(stdEff);
  if (!std || curveEff == null) return 1;
  return Math.min(Number(curveEff), std) / std;
}

// Map lcKey → { curve, sorted } con las fechas asignadas de cada curva activa.
// rows = asignaciones del tablero; styleKeyOf(a) y ymd(v) vienen del tablero.
// includeHolds: las reservas PRE#### (a.is_hold) también cuentan como días de
// la curva (igual que el servidor). Sin él se ignoran, como antes.
export function buildCurveIndex(curves, rows, styleKeyOf, ymd, { includeHolds = false } = {}) {
  const m = new Map();
  for (const c of curves || []) if (c.status === "active") m.set(lcKey(c.style, c.line_no), { curve: c, dates: new Set(), sorted: [] });
  if (!m.size) return m;
  for (const a of rows || []) {
    if ((a.is_hold && !includeHolds) || ["cancelled", "rejected"].includes(a.status)) continue;
    if (!(parseFloat(a.assigned_quantity) > 0)) continue;
    const e = m.get(lcKey(styleKeyOf(a), a.line_no));
    if (!e) continue;
    const d = ymd(a.assigned_date);
    if (d && d >= e.curve.start_date) e.dates.add(d);
  }
  for (const e of m.values()) e.sorted = [...e.dates].sort();
  return m;
}

// Texto del re-planeo que devuelve el servidor (null si no se pidió).
export const replanText = (rp) => {
  if (!rp) return null;
  if (!rp.recomputed) {
    if (rp.reason === "locked") return `No se re-planeó: ${rp.error || "semana bloqueada por el CEO"}.`;
    if (rp.reason === "no-standard") return "No se re-planeó: el estilo no tiene estándar.";
    return "No había días planeados que re-acomodar.";
  }
  const parts = [`Re-planeado desde ${dm(rp.from)}: ${rp.daysBefore} → ${rp.daysAfter} día(s)`];
  if (rp.lockedCells > 0) parts.push(`${rp.lockedCells} casilla(s) en semana bloqueada se quedaron igual`);
  const left = (rp.unplaced || []).reduce((a, u) => a + (u.qty || 0), 0);
  if (left > 0) parts.push(`${left.toLocaleString()} pzas no cupieron en el horizonte y regresaron a la bolsa`);
  return parts.join(" · ") + ".";
};

// ---------------------------------------------------------------------------
// Vista de etapas (barra segmentada)
// ---------------------------------------------------------------------------
function StepsStrip({ steps, activeIndex = null }) {
  return (
    <ol className="flex gap-1.5" aria-label="Etapas de la curva">
      {stepRanges(steps).map((s, i) => {
        const on = activeIndex === i;
        return (
          <li
            key={i}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-center ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-800"}`}
            style={!on ? { backgroundImage: `linear-gradient(to top, rgba(37,99,235,.12) ${Math.round(s.eff * 100)}%, transparent 0)` } : undefined}
          >
            <span className="block text-base font-semibold tabular-nums">{pct(s.eff)}</span>
            <span className={`block text-[11px] ${on ? "text-gray-200" : "text-gray-500"}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// <LearningCurvePrompt>
//   mode "drop":  al soltar un estilo nuevo → Crear curva y asignar / Asignar sin curva
//   mode "apply": aplicar a un estilo existente (fecha y tipo editables)
// ---------------------------------------------------------------------------
export function LearningCurvePrompt({
  mode = "drop", style, lineNo, startDate, isNewStyle = true, defaultType, context,
  existingCurve = null, busy = false, error = null, result = null,
  onCreate, onSkip, onCancel, onCancelCurve, onViewGraph,
}) {
  const [type, setType] = useState(defaultType || (isNewStyle ? "new" : "existing"));
  const [start, setStart] = useState(startDate || "");
  const [replan, setReplan] = useState(true);
  useEffect(() => { setType(defaultType || (isNewStyle ? "new" : "existing")); }, [defaultType, isNewStyle]);
  useEffect(() => { setStart(startDate || ""); }, [startDate]);
  const steps = LC_PRESETS[type];
  const isDrop = mode === "drop";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-prompt-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div>
            <h2 id="lc-prompt-title" className="text-lg font-semibold text-gray-900">
              {isDrop ? `¿Crear curva de aprendizaje para ${style}?` : `Curva de aprendizaje · ${style}`}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {isDrop
                ? `Es un estilo nuevo. La Línea ${lineNo} arrancará con menos piezas por día mientras aprende.`
                : `Línea ${lineNo}. La capacidad de los primeros días del estilo se reduce según la curva.`}
            </p>
            {context && <p className="text-xs text-gray-400 mt-1">{context}</p>}
          </div>
          <button onClick={onCancel} disabled={busy} aria-label="Cerrar" className="p-1.5 -mr-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-4 space-y-4">
          {existingCurve && !result && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 flex items-center justify-between gap-3">
              <span>
                Ya tiene una curva activa ({LC_TYPE_LABEL[existingCurve.curve_type] || existingCurve.curve_type}) desde {dm(existingCurve.start_date)}.
              </span>
              {onCancelCurve && (
                <button onClick={() => onCancelCurve(existingCurve)} disabled={busy} className="shrink-0 text-xs font-semibold underline disabled:opacity-50">
                  Quitar curva
                </button>
              )}
            </div>
          )}

          {!result && !existingCurve && (
            <>
              {!isDrop && (
                <div className="grid grid-cols-2 gap-3">
                  <fieldset>
                    <legend className="block text-sm font-medium text-gray-700 mb-1">Tipo de curva</legend>
                    <div className="flex rounded-xl border border-gray-200 p-0.5 bg-gray-50">
                      {["existing", "new"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setType(t)}
                          aria-pressed={type === t}
                          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${type === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-800"}`}
                        >
                          {LC_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Día 1 de la curva</span>
                    <input
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                  </label>
                </div>
              )}
              <StepsStrip steps={steps} />
              <p className="text-xs text-gray-500">
                Solo cuentan los días con piezas del estilo en la línea. La eficiencia nunca supera el estándar del estilo.
              </p>
              {!isDrop && (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={replan} onChange={(e) => setReplan(e.target.checked)} className="mt-0.5" />
                  <span>
                    Re-acomodar los días ya planeados de este estilo en la Línea {lineNo}
                    <span className="block text-xs text-gray-500">Desde mañana; las piezas que ya no caben pasan a días siguientes. Hoy, lo enviado a líderes y las semanas bloqueadas no se mueven.</span>
                  </span>
                </label>
              )}
            </>
          )}

          {result && (
            <div className="space-y-2">
              <p className="text-sm text-gray-800">
                Curva aplicada desde {dm(result.curve?.start_date)}: {(result.curve?.steps || []).map((s) => pct(s.eff)).join(" → ")}.
              </p>
              {result.replan && <p className="text-sm text-gray-700">{replanText(result.replan)}</p>}
              {(result.overloads || []).length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
                  <p className="px-3 py-2 text-sm text-amber-900">
                    {result.overloads.length} día(s) quedan por encima de la capacidad con curva{result.replan?.recomputed ? " (hoy, enviados a líderes o en semana bloqueada: no se re-acomodan)" : ""}. Mueva el excedente a días posteriores.
                  </p>
                  <table className="w-full text-xs">
                    <thead className="text-amber-900/70 text-left">
                      <tr><th className="px-3 py-1 font-medium">Fecha</th><th className="px-3 py-1 font-medium">Día · Ef.</th><th className="px-3 py-1 font-medium text-right">Asignado / Cap.</th><th className="px-3 py-1 font-medium text-right">Excede</th></tr>
                    </thead>
                    <tbody>
                      {result.overloads.slice(0, 8).map((o) => (
                        <tr key={o.date} className="border-t border-amber-200/70">
                          <td className="px-3 py-1">{dm(o.date)}</td>
                          <td className="px-3 py-1">Día {o.day} · {pct(o.efficiency)}</td>
                          <td className="px-3 py-1 text-right tabular-nums">
                            {o.qty.toLocaleString()} / {o.capacity.toLocaleString()}
                            {o.held > 0 && <span className="block text-[10px] text-violet-700">{o.held.toLocaleString()} en reserva PRE</span>}
                          </td>
                          <td className="px-3 py-1 text-right tabular-nums font-semibold text-amber-900">+{o.excess.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-green-700">Los días ya asignados caben en la capacidad con curva.</p>
              )}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 text-sm text-red-700"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-2xl flex flex-wrap justify-end gap-2">
          {result || existingCurve ? (
            <>
              {onViewGraph && (
                <button onClick={onViewGraph} disabled={busy} className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
                  Ver gráfica
                </button>
              )}
              <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">Cerrar</button>
            </>
          ) : isDrop ? (
            <>
              <button onClick={onSkip} disabled={busy} className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">
                Asignar sin curva
              </button>
              <button onClick={() => onCreate(type, startDate)} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Crear curva y asignar
              </button>
            </>
          ) : (
            <>
              <button onClick={onCancel} disabled={busy} className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancelar</button>
              <button onClick={() => onCreate(type, start, replan)} disabled={busy || !start} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Aplicar curva
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfica de curva por estilo (SVG, sin dependencias)
//   Línea escalonada = eficiencia planeada (curva, tope en el estándar)
//   Punteada         = eficiencia estándar de la línea
//   Puntos           = eficiencia real (empaque), días ya producidos
// ---------------------------------------------------------------------------
const SERIES_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2"];

export function LearningCurveChart({ series }) {
  const W = 640, H = 260, M = { l: 40, r: 16, t: 14, b: 32 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const maxDay = Math.max(
    8,
    ...series.map((s) => s.points.length),
    ...series.map((s) => (s.curve.steps || []).reduce((a, x) => a + (x.days || 0), 0) + 2)
  );
  const yMax = Math.min(
    1,
    Math.max(
      0.8,
      ...series.map((s) => s.standard_efficiency || 0),
      ...series.flatMap((s) => s.points.map((p) => p.actual_efficiency || 0))
    ) + 0.05
  );
  const x = (d) => M.l + ((d - 0.5) / maxDay) * iw;
  const y = (e) => M.t + ih - (Math.max(0, Math.min(e, yMax)) / yMax) * ih;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].filter((t) => t <= yMax + 1e-9);
  const xStep = maxDay > 20 ? 5 : maxDay > 10 ? 2 : 1;

  const stepPath = (s) => {
    const std = s.standard_efficiency;
    let d = "";
    for (let day = 1; day <= maxDay; day++) {
      const e = stageForDay(s.curve.steps, day).eff;
      const v = std ? Math.min(e, std) : e;
      const x0 = x(day - 0.5), x1 = x(day + 0.5);
      d += day === 1 ? `M${x0},${y(v)} H${x1}` : ` V${y(v)} H${x1}`;
    }
    return d;
  };

  return (
    <figure className="w-full">
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px] h-auto" role="img" aria-label="Gráfica de curva de aprendizaje por día">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{Math.round(t * 100)}%</text>
            </g>
          ))}
          {Array.from({ length: maxDay }, (_, i) => i + 1)
            .filter((d) => d === 1 || d % xStep === 0)
            .map((d) => (
              <text key={d} x={x(d)} y={H - M.b + 16} textAnchor="middle" fontSize="11" fill="#6b7280">{d}</text>
            ))}
          <text x={M.l + iw / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="#9ca3af">Día de la curva</text>

          {series.map((s, i) => {
            const c = SERIES_COLORS[i % SERIES_COLORS.length];
            const cur = s.current_day;
            return (
              <g key={s.curve.id}>
                {s.standard_efficiency && (
                  <line x1={M.l} x2={W - M.r} y1={y(s.standard_efficiency)} y2={y(s.standard_efficiency)} stroke={c} strokeOpacity="0.45" strokeDasharray="4 4" />
                )}
                <path d={stepPath(s)} fill="none" stroke={c} strokeWidth="2.5" strokeOpacity={s.curve.status === "active" ? 1 : 0.4} />
                {cur > 0 && cur <= maxDay && (
                  <circle cx={x(cur)} cy={y(Math.min(stageForDay(s.curve.steps, cur).eff, s.standard_efficiency || 1))} r="6" fill="white" stroke={c} strokeWidth="2.5">
                    <title>{`Línea ${s.curve.line_no} · hoy va en el día ${cur}`}</title>
                  </circle>
                )}
                {s.points.filter((p) => p.actual_efficiency != null).map((p) => (
                  <circle key={p.date} cx={x(p.day)} cy={y(p.actual_efficiency)} r="3.5" fill={c}>
                    <title>{`Línea ${s.curve.line_no} · día ${p.day} (${dm(p.date)}): real ${pct(p.actual_efficiency)} · plan ${pct(p.planned_efficiency)} · ${p.produced ?? 0} pzas`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {series.map((s, i) => (
          <span key={s.curve.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            Línea {s.curve.line_no}{s.curve.status !== "active" ? " (cancelada)" : ""}
          </span>
        ))}
        <span className="text-gray-400">Escalón = plan · punteada = estándar · puntos = real · círculo = hoy</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// <LearningCurvesModal>  lista de curvas + gráfica por estilo + nueva curva
// ---------------------------------------------------------------------------
export function LearningCurvesModal({ canEdit = false, lines = [], styles = [], initialStyle = null, onCreate, onCancelCurve, onClose }) {
  const [curves, setCurves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(initialStyle ? normStyleKey(initialStyle) : null);
  const [graph, setGraph] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [form, setForm] = useState(null); // { style, lineNo, type, start }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadCurves = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/learning-curves?status=all`, { headers: authHeaders() });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || "No se pudieron cargar las curvas");
      setCurves(d.curves || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const loadGraph = async (style) => {
    if (!style) { setGraph(null); return; }
    setGraphLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/learning-curves/graph?style=${encodeURIComponent(style)}`, { headers: authHeaders() });
      const d = await r.json();
      setGraph(d.success ? d : null);
    } catch {
      setGraph(null);
    } finally {
      setGraphLoading(false);
    }
  };
  useEffect(() => { loadCurves(); }, []);
  useEffect(() => { loadGraph(sel); }, [sel]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Estilos con curva, más los del tablero (para crear una nueva).
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of curves) {
      const k = normStyleKey(c.style);
      if (!m.has(k)) m.set(k, { style: k, active: 0, total: 0 });
      const g = m.get(k);
      g.total++;
      if (c.status === "active") g.active++;
    }
    const term = q.trim().toUpperCase();
    return [...m.values()]
      .filter((g) => !term || g.style.includes(term))
      .sort((a, b) => (b.active - a.active) || a.style.localeCompare(b.style));
  }, [curves, q]);

  useEffect(() => {
    if (!sel && groups.length) setSel(groups[0].style);
  }, [groups, sel]);

  const styleCurves = curves.filter((c) => normStyleKey(c.style) === sel);
  const activeSeries = (graph?.series || []).filter((s) => s.curve.status === "active");
  const shownSeries = activeSeries.length ? activeSeries : (graph?.series || []).slice(0, 3);

  const submitForm = async () => {
    if (!form?.style || !form?.lineNo || !form?.start) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await onCreate({ style: form.style, lineNo: form.lineNo, type: form.type, startDate: form.start, replan: !!form.replan });
      const over = res?.overloads || [];
      const rp = replanText(res?.replan);
      setNotice(over.length
        ? { warn: true, text: `Curva creada. ${rp ? rp + " " : ""}${over.length} día(s) exceden la capacidad con curva (p. ej. ${dm(over[0].date)}: +${over[0].excess} pzas).` }
        : { warn: false, text: `Curva creada.${rp ? " " + rp : ""}` });
      const st = normStyleKey(form.style);
      setForm(null);
      await loadCurves();
      if (st === sel) loadGraph(st); else setSel(st);
    } catch (e) {
      setNotice({ warn: true, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const cancelCurve = async (c) => {
    if (!window.confirm(`¿Quitar la curva de ${c.style} en la Línea ${c.line_no}? La línea vuelve a su eficiencia estándar y sus días planeados (desde mañana) se re-acomodan.`)) return;
    setBusy(true);
    try {
      const res = await onCancelCurve(c);
      const rp = replanText(res?.replan);
      setNotice({ warn: false, text: `Curva quitada.${rp ? " " + rp : ""}` });
      await loadCurves();
      loadGraph(sel);
    } catch (e) {
      setNotice({ warn: true, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = "w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 bg-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-modal-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b">
          <div>
            <h2 id="lc-modal-title" className="text-xl font-semibold text-gray-900">Curvas de aprendizaje</h2>
            <p className="text-sm text-gray-500">Eficiencia por día de cada estilo mientras la línea aprende.</p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                onClick={() => setForm({ style: sel || "", lineNo: "", type: "existing", start: new Date().toISOString().slice(0, 10), replan: true })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                <Plus className="w-4 h-4" /> Nueva curva
              </button>
            )}
            <button onClick={onClose} aria-label="Cerrar" className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Estilos */}
          <aside className="md:w-60 shrink-0 border-b md:border-b-0 md:border-r flex flex-col min-h-0 max-h-48 md:max-h-none">
            <div className="p-3 border-b bg-gray-50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar estilo"
                  aria-label="Buscar estilo"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {loading && <li className="px-2 py-6 text-center text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline" /> Cargando…</li>}
              {!loading && groups.length === 0 && (
                <li className="px-2 py-6 text-center text-sm text-gray-500">
                  {canEdit ? "Sin curvas. Cree una con «Nueva curva» o al soltar un estilo nuevo." : "Sin curvas registradas."}
                </li>
              )}
              {groups.map((g) => (
                <li key={g.style}>
                  <button
                    onClick={() => setSel(g.style)}
                    aria-current={sel === g.style}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${sel === g.style ? "bg-gray-900 text-white" : "hover:bg-gray-100 text-gray-800"}`}
                  >
                    <span className="font-medium truncate">{g.style}</span>
                    <span className={`text-[11px] shrink-0 ${sel === g.style ? "text-gray-300" : "text-gray-500"}`}>
                      {g.active > 0 ? `${g.active} activa${g.active === 1 ? "" : "s"}` : "historial"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Detalle del estilo */}
          <section className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">
            {error && <p className="flex items-center gap-2 text-sm text-red-700"><AlertCircle className="w-4 h-4" /> {error}</p>}
            {notice && (
              <p className={`text-sm rounded-xl px-3 py-2 ${notice.warn ? "bg-amber-50 text-amber-900 border border-amber-200" : "bg-green-50 text-green-800 border border-green-200"}`}>{notice.text}</p>
            )}

            {form && (
              <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                <h3 className="font-semibold text-gray-900">Nueva curva</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Estilo</span>
                    <input list="lc-styles" value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value.toUpperCase() })} className={fieldCls} />
                    <datalist id="lc-styles">{styles.map((s) => <option key={s} value={s} />)}</datalist>
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Línea</span>
                    <select value={form.lineNo} onChange={(e) => setForm({ ...form, lineNo: e.target.value })} className={fieldCls}>
                      <option value="">Elegir…</option>
                      {lines.map((l) => <option key={l} value={l}>Línea {l}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Tipo</span>
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={fieldCls}>
                      <option value="existing">{LC_TYPE_LABEL.existing}</option>
                      <option value="new">{LC_TYPE_LABEL.new}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Día 1</span>
                    <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={fieldCls} />
                  </label>
                </div>
                <StepsStrip steps={LC_PRESETS[form.type]} />
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!form.replan} onChange={(e) => setForm({ ...form, replan: e.target.checked })} />
                  Re-acomodar los días ya planeados (desde mañana)
                </label>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setForm(null)} disabled={busy} className="px-3 py-1.5 text-sm text-gray-700 rounded-lg hover:bg-gray-100">Cancelar</button>
                  <button
                    onClick={submitForm}
                    disabled={busy || !form.style || !form.lineNo || !form.start}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />} Crear curva
                  </button>
                </div>
              </div>
            )}

            {sel && (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-gray-500" /> {sel}</h3>
                  {graphLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                </div>

                {shownSeries.length > 0 ? (
                  <LearningCurveChart series={shownSeries} />
                ) : !graphLoading && (
                  <p className="text-sm text-gray-500">Este estilo no tiene curvas.</p>
                )}

                {styleCurves.length > 0 && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-left text-xs">
                        <tr>
                          <th className="px-3 py-2 font-medium">Línea</th>
                          <th className="px-3 py-2 font-medium">Tipo</th>
                          <th className="px-3 py-2 font-medium">Desde</th>
                          <th className="px-3 py-2 font-medium">Hoy</th>
                          <th className="px-3 py-2 font-medium">Etapas</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {styleCurves.map((c) => {
                          const s = (graph?.series || []).find((x) => x.curve.id === c.id);
                          const cur = s?.current_day || 0;
                          const st = cur > 0 ? stageForDay(c.steps, cur) : null;
                          const capped = st && s?.standard_efficiency ? Math.min(st.eff, s.standard_efficiency) : st?.eff;
                          return (
                            <tr key={c.id} className={`border-t border-gray-100 ${c.status !== "active" ? "text-gray-400" : "text-gray-800"}`}>
                              <td className="px-3 py-2 font-medium">L{c.line_no}</td>
                              <td className="px-3 py-2">{LC_TYPE_LABEL[c.curve_type] || c.curve_type}{c.status !== "active" ? " · cancelada" : ""}</td>
                              <td className="px-3 py-2 tabular-nums">{dm(c.start_date)}</td>
                              <td className="px-3 py-2 tabular-nums">{c.status === "active" ? (st ? `Día ${cur} · ${pct(capped)}` : "Por iniciar") : "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-xs">{(c.steps || []).map((x) => pct(x.eff)).join(" → ")}</td>
                              <td className="px-3 py-2 text-right">
                                {canEdit && c.status === "active" && (
                                  <button onClick={() => cancelCurve(c)} disabled={busy} className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50">Quitar</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {shownSeries.some((s) => s.points.length) && (
                  <details className="rounded-xl border border-gray-200">
                    <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer">Detalle por día</summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-gray-500 text-left">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Línea</th>
                            <th className="px-3 py-1.5 font-medium">Día</th>
                            <th className="px-3 py-1.5 font-medium">Fecha</th>
                            <th className="px-3 py-1.5 font-medium text-right">Ef. plan</th>
                            <th className="px-3 py-1.5 font-medium text-right">Ef. real</th>
                            <th className="px-3 py-1.5 font-medium text-right">Asignado</th>
                            <th className="px-3 py-1.5 font-medium text-right">Producido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownSeries.flatMap((s) => s.points.map((p) => (
                            <tr key={`${s.curve.id}-${p.date}`} className="border-t border-gray-100">
                              <td className="px-3 py-1.5">L{s.curve.line_no}</td>
                              <td className="px-3 py-1.5 tabular-nums">{p.day}</td>
                              <td className="px-3 py-1.5 tabular-nums">{dm(p.date)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{pct(p.planned_efficiency)}</td>
                              <td className={`px-3 py-1.5 text-right tabular-nums ${p.actual_efficiency != null && p.actual_efficiency < p.planned_efficiency ? "text-rose-700 font-semibold" : ""}`}>
                                {p.actual_efficiency != null ? pct(p.actual_efficiency) : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                {p.planned_qty.toLocaleString()}
                                {p.held_qty > 0 && <span className="block text-[10px] text-violet-700">{p.held_qty.toLocaleString()} PRE</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{p.produced != null ? p.produced.toLocaleString() : "—"}</td>
                            </tr>
                          )))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}