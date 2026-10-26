// components/planner/StyleStandards.jsx
//
// Planner-owned production standards per style (SAM, operators, working hours,
// efficiency), with an optional standard of its own PER LINE. These drive the
// Plan Board capacity instead of the line engineers' runs:
//
//     pieces/day = operators × hours × 60 × efficiency ÷ SAM
//
// Two pieces:
//   <StyleParamsFormModal>   create / edit ONE style (opened on drop or from the list)
//   <StyleStandardsListModal> browse styles (all, or those on a line-day) and edit
//
// SCOPE: each style has a GENERAL standard (every line) and a line can get its
// OWN standard. The form edits one scope at a time (picker at the top); a line
// standard changes that line only, the general one changes every line that has
// no standard of its own.
//
// EFFICIENCY needs the CEO: on a style that already has a standard the planner
// can change SAM, operators and hours directly, but a new efficiency is sent as
// a request (for that scope) and only applies once the CEO approves it. A NEW
// style's first efficiency is accepted as entered.
import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Search, AlertCircle, ShieldCheck, Clock, RotateCcw } from "lucide-react";

export const normStyle = (s) => String(s ?? "").trim().toUpperCase();
const normLineNo = (l) => (l == null ? "" : String(l).trim());

// Key of a line's own standard in the board maps: "STYLE|LINE".
export const lineKey = (style, line) => `${normStyle(style)}|${normLineNo(line)}`;
// Key of a pending efficiency request: "STYLE" (general) or "STYLE|LINE".
export const effKey = (style, line) => (normLineNo(line) ? lineKey(style, line) : normStyle(style));
// The standard that applies to a style on a line: its own, else the general.
export const paramsForLine = (styleParams, lineParams, style, line) => {
  const ln = normLineNo(line);
  return (ln && lineParams?.[lineKey(style, ln)]) || styleParams?.[normStyle(style)] || null;
};
const sortLines = (arr) =>
  [...new Set(arr.map(normLineNo).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export const targetOfParams = (p) => {
  const sam = Number(p?.sam_minutes) || 0;
  if (!(sam > 0)) return 0;
  return ((Number(p.operators_count) || 0) * (Number(p.working_hours) || 0) * 60 * (Number(p.efficiency) || 0)) / sam;
};

const fmt = (n, d = 0) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "—";

// Row values (from the DB) → editable strings. Efficiency is shown in %.
const toForm = (p) =>
  p
    ? {
        sam: String(Number(p.sam_minutes) || ""),
        ops: String(Number(p.operators_count) || ""),
        hours: String(Number(p.working_hours) || ""),
        effPct: p.efficiency != null ? String(Math.round(Number(p.efficiency) * (Number(p.efficiency) > 1 ? 1 : 100) * 100) / 100) : "",
        notes: p.notes || "",
      }
    : { sam: "", ops: "", hours: "", effPct: "", notes: "" };

function Field({ label, suffix, value, onChange, placeholder, step = "any", autoFocus, disabled }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-gray-900/10 bg-white">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm outline-none bg-transparent disabled:text-gray-400"
        />
        {suffix && <span className="pr-3 text-xs text-gray-400 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

/**
 * props:
 *   style         style code being edited (required)
 *   existing      current planner row for the style, or null (new style)
 *   suggestion    last production record for the style { sam_minutes, operators_count,
 *                 working_hours, efficiency, run_date, line_no } — only a hint
 *   merchantSam   SAM captured by the merchant on the order (hint for new styles)
 *   context       short text of what triggered the form ("Soltar OT-123 en L4 · 29/09")
 *   canEdit       false → read-only view
 *   saving        disables the buttons while the PUT is in flight
 *   onSave(body)  body = { samMinutes, operatorsCount, workingHours, efficiency, notes }
 *   onCancel()
 *   saveLabel     text of the primary button (e.g. "Guardar y asignar")
 *
 *   Per-line scope (optional — without these the form edits the general standard only):
 *   lineOptions   lines the planner can pick (lines with the style + those with their own)
 *   lineNo        line preselected when the form opens ("" / null = general)
 *   lineOverrides { "4": row } each line's OWN standard for this style
 *   pendingEffs   { "": request, "4": request } pending efficiency requests by scope
 *   onResetLine(line)  line goes back to the general standard
 *   onSave(body)  body also carries lineNo (null = general)
 */
export function StyleParamsFormModal({
  style, existing, suggestion, merchantSam, context, canEdit = true, saving = false,
  onSave, onCancel, saveLabel, pendingEff = null, onCancelEffRequest,
  lineOptions = null, lineNo = null, lineOverrides = null, pendingEffs = null, onResetLine,
}) {
  const general = existing; // the style's general standard (null = new style)
  const lines = useMemo(
    () => sortLines([...(lineOptions || []), ...Object.keys(lineOverrides || {}), ...(lineNo ? [lineNo] : [])]),
    [lineOptions, lineOverrides, lineNo]
  );
  // A brand-new style is always captured as its general standard first.
  const [scope, setScope] = useState(() => (general ? normLineNo(lineNo) : ""));
  useEffect(() => { setScope(general ? normLineNo(lineNo) : ""); }, [style, lineNo, !!general]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = scope ? lineOverrides?.[scope] || null : null;
  const inherited = !!scope && !own;          // line follows the general standard today
  const current = scope ? own || general : general; // what applies on this scope now
  const scopePending = pendingEffs ? pendingEffs[scope] || null : (scope ? null : pendingEff);
  const ownLines = Object.keys(lineOverrides || {});

  const [form, setForm] = useState(() => toForm(current));
  const [error, setError] = useState(null);
  const [effReason, setEffReason] = useState("");
  useEffect(() => { setForm(toForm(current)); setError(null); setEffReason(""); }, [style, scope, current]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const preview = useMemo(() => {
    const p = {
      sam_minutes: Number(form.sam),
      operators_count: Number(form.ops),
      working_hours: Number(form.hours),
      efficiency: Number(form.effPct) / 100,
    };
    const minutes = p.operators_count * p.working_hours * 60 * p.efficiency;
    // What applies NOW when the efficiency is still waiting for the CEO.
    const nowP = current ? { ...p, efficiency: Number(current.efficiency) } : p;
    return {
      minutes, pcs: targetOfParams(p), perHour: p.working_hours > 0 ? targetOfParams(p) / p.working_hours : 0,
      pcsNow: targetOfParams(nowP),
    };
  }, [form, current]);

  const isNew = !general;
  const currentEffPct = current ? Math.round(Number(current.efficiency) * 10000) / 100 : null;
  const effChanged = !isNew && form.effPct !== "" && Math.abs(Number(form.effPct) - currentEffPct) > 1e-6;
  const submit = () => {
    const sam = Number(form.sam), ops = Number(form.ops), hours = Number(form.hours), eff = Number(form.effPct);
    if (!(sam > 0)) return setError("Ingrese el SAM (minutos por pieza).");
    if (!(Number.isInteger(ops) && ops > 0)) return setError("Ingrese el número de operarios (entero mayor a 0).");
    if (!(hours > 0 && hours <= 24)) return setError("Ingrese las horas de trabajo (entre 0 y 24).");
    if (!(eff > 0 && eff <= 100)) return setError("Ingrese la eficiencia en % (1 a 100).");
    if (effChanged && !effReason.trim()) return setError("Indique el motivo del cambio de eficiencia para el CEO.");
    setError(null);
    onSave({
      samMinutes: sam, operatorsCount: ops, workingHours: hours, efficiency: eff / 100,
      notes: form.notes || null, efficiencyReason: effChanged ? effReason.trim() : null,
      lineNo: scope || null,
    });
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    const e = Number(suggestion.efficiency) || 0;
    setForm((f) => ({
      ...f,
      sam: String(Number(suggestion.sam_minutes) || ""),
      ops: String(Number(suggestion.operators_count) || ""),
      hours: String(Number(suggestion.working_hours) || ""),
      effPct: e ? String(Math.round((e > 1 ? e : e * 100) * 100) / 100) : "",
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => !saving && onCancel()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-params-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && canEdit && !saving) submit(); }}
      >
        <div className="px-6 py-4 border-b flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 id="style-params-title" className="font-semibold text-gray-900">
              {isNew ? "Estilo nuevo" : "Estándar del estilo"} <span className="font-mono">{style}</span>
              {scope && <span className="text-gray-500 font-normal"> · Línea {scope}</span>}
            </h3>
            {context && <p className="text-sm text-gray-500 truncate">{context}</p>}
          </div>
          <button onClick={onCancel} disabled={saving} aria-label="Cerrar" className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {!isNew && lines.length > 0 && (
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1.5">Aplicar a</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Alcance del estándar">
                {["", ...lines].map((ln) => {
                  const on = scope === ln;
                  const hasOwn = !!ln && !!lineOverrides?.[ln];
                  return (
                    <button
                      key={ln || "general"}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={saving}
                      onClick={() => setScope(ln)}
                      title={ln ? (hasOwn ? `La Línea ${ln} tiene estándar propio` : `La Línea ${ln} usa el estándar general`) : "Todas las líneas sin estándar propio"}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] transition ${
                        on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {ln ? `L${ln}` : "General"}
                      {hasOwn && <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-white" : "bg-indigo-500"}`} />}
                      {pendingEffs?.[ln] && <Clock className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[12px] text-gray-500">
                {!scope
                  ? <>Aplica a todas las líneas{ownLines.length ? <> excepto {sortLines(ownLines).map((l) => `L${l}`).join(", ")}, que {ownLines.length > 1 ? "tienen" : "tiene"} estándar propio</> : null}.</>
                  : inherited
                    ? <>La Línea {scope} usa hoy el estándar general. Al guardar se crea un estándar propio solo para L{scope}; las demás líneas no cambian.</>
                    : <>Estándar propio de la Línea {scope}: solo cambia esta línea. General: {fmt(targetOfParams(general))} pzas/día.</>}
              </p>
              {scope && own && canEdit && onResetLine && (
                <button
                  type="button"
                  onClick={() => onResetLine(scope)}
                  disabled={saving}
                  className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-indigo-700 hover:underline disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> Volver al estándar general en L{scope}
                </button>
              )}
            </div>
          )}

          {isNew && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Planeación no tiene historial de este estilo. Ingrese SAM, operarios, horas y eficiencia para
                calcular la capacidad; se guardarán como estándar general y después podrá ajustar cada línea.
              </span>
            </div>
          )}

          {isNew && suggestion && canEdit && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-[13px] text-gray-700">
              <p>
                Producción registró este estilo en la Línea {suggestion.line_no} el {suggestion.run_date}:
                SAM {Number(suggestion.sam_minutes)} min, {Number(suggestion.operators_count)} operarios,{" "}
                {Number(suggestion.working_hours)} h, eficiencia{" "}
                {Math.round((Number(suggestion.efficiency) > 1 ? Number(suggestion.efficiency) : Number(suggestion.efficiency) * 100))}%.
              </p>
              <button onClick={applySuggestion} className="mt-2 text-[13px] font-medium text-indigo-700 hover:underline">
                Usar estos valores como punto de partida
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="SAM" suffix="min/pza" value={form.sam} onChange={set("sam")} autoFocus disabled={!canEdit}
              placeholder={merchantSam ? String(merchantSam) : "p. ej. 12.5"}
            />
            <Field label="Operarios" suffix="personas" step="1" value={form.ops} onChange={set("ops")} disabled={!canEdit} placeholder="p. ej. 24" />
            <Field label="Horas de trabajo" suffix="h/día" value={form.hours} onChange={set("hours")} disabled={!canEdit} placeholder="p. ej. 9" />
            <Field label="Eficiencia" suffix="%" value={form.effPct} onChange={set("effPct")} disabled={!canEdit} placeholder="p. ej. 75" />
          </div>
          {canEdit && merchantSam > 0 && String(form.sam) !== String(merchantSam) && (
            <button onClick={() => set("sam")(String(merchantSam))} className="-mt-2 text-[12px] text-indigo-700 hover:underline">
              Usar el SAM del merchant ({merchantSam} min)
            </button>
          )}

          {!isNew && (
            <p className="-mt-1 text-[12px] text-gray-500 flex gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
              SAM, operarios y horas se aplican al guardar. Un cambio de eficiencia se envía al CEO y se aplica
              solo cuando lo aprueba (actual: {currentEffPct}%).
            </p>
          )}

          {scopePending && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[13px] text-violet-800">
              <div className="flex gap-2">
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Solicitud pendiente con el CEO: eficiencia {Math.round(Number(scopePending.current_efficiency) * 100)}% →{" "}
                  <b>{Math.round(Number(scopePending.requested_efficiency) * 100)}%</b>
                  {scopePending.requested_by ? `, solicitada por ${scopePending.requested_by}` : ""}
                  {scopePending.requested_at ? ` el ${new Date(scopePending.requested_at).toLocaleDateString()}` : ""}.
                  {scopePending.reason ? ` Motivo: ${scopePending.reason}` : ""}
                </span>
              </div>
              {canEdit && onCancelEffRequest && (
                <button onClick={() => onCancelEffRequest(scopePending)} disabled={saving} className="mt-2 text-[13px] font-medium text-violet-700 hover:underline">
                  Retirar la solicitud
                </button>
              )}
            </div>
          )}

          {effChanged && canEdit && (
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Motivo del cambio de eficiencia <span className="text-gray-400 font-normal">(para el CEO)</span>
              </span>
              <textarea
                rows={2}
                value={effReason}
                onChange={(e) => setEffReason(e.target.value)}
                placeholder="p. ej. se incorporó una máquina automática en la operación de cierre"
                className="w-full rounded-xl border border-amber-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/20"
              />
              <span className="block mt-1 text-[12px] text-amber-700">
                Se enviará una solicitud de {currentEffPct}% → {Number(form.effPct)}%
                {scope ? ` solo para la Línea ${scope}` : ""}
                {scopePending ? " y reemplazará la solicitud pendiente" : ""}. Hasta que el CEO la apruebe se sigue usando {currentEffPct}%.
              </span>
            </label>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Notas</span>
            <input
              type="text"
              value={form.notes}
              disabled={!canEdit}
              onChange={(e) => set("notes")(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 disabled:text-gray-400"
            />
          </label>

          <div className="rounded-xl bg-blue-50 p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-blue-700">Minutos efectivos por día</span><span className="font-medium text-blue-900">{preview.minutes > 0 ? fmt(preview.minutes) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-blue-700">Piezas por hora</span><span className="font-medium text-blue-900">{preview.perHour > 0 ? fmt(preview.perHour, 1) : "—"}</span></div>
            {effChanged ? (
              <>
                <div className="flex justify-between pt-1 border-t border-blue-200"><span className="text-blue-700">Capacidad por día al guardar ({currentEffPct}%)</span><span className="font-semibold text-blue-900">{preview.pcsNow > 0 ? `${fmt(preview.pcsNow)} pzas` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-blue-700">Si el CEO aprueba ({Number(form.effPct)}%)</span><span className="font-medium text-blue-900">{preview.pcs > 0 ? `${fmt(preview.pcs)} pzas` : "—"}</span></div>
              </>
            ) : (
              <div className="flex justify-between pt-1 border-t border-blue-200"><span className="text-blue-700">Capacidad por día</span><span className="font-semibold text-blue-900">{preview.pcs > 0 ? `${fmt(preview.pcs)} pzas` : "—"}</span></div>
            )}
          </div>

          {current?.updated_at && (
            <p className="text-[11px] text-gray-400">
              Última modificación{inherited ? " del estándar general" : ""}: {new Date(current.updated_at).toLocaleString()}{current.updated_by ? ` por ${current.updated_by}` : ""}
            </p>
          )}
          {!canEdit && <p className="text-[12px] text-gray-500">Solo el planeador puede modificar estos valores.</p>}
          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onCancel} disabled={saving} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50">Cancelar</button>
          {canEdit && (
            <button onClick={submit} disabled={saving} className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 inline-flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? "Guardando…" : saveLabel || "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * props:
 *   title, subtitle
 *   styleParams   { STYLE: row }
 *   styles        optional list of style codes to show (e.g. those on a line-day);
 *                 omit to list every stored standard
 *   headerSlot    optional node rendered above the list (e.g. a date picker)
 *   lineNo        optional: show what applies on THIS line (its own standard, else the general)
 *   lineParams    { "STYLE|LINE": row } each line's own standard
 *   onEdit(style) open the form for that style
 *   onClose()
 */
export function StyleStandardsListModal({
  title, subtitle, styleParams, styles, headerSlot, onEdit, onClose, pendingEffByStyle = {},
  lineNo = null, lineParams = {},
}) {
  const [q, setQ] = useState("");
  const ln = normLineNo(lineNo);
  // Lines with their own standard, per style (for the "all styles" view).
  const ownByStyle = useMemo(() => {
    const m = {};
    for (const k of Object.keys(lineParams || {})) {
      const [st, l] = k.split("|");
      (m[st] = m[st] || []).push(l);
    }
    return m;
  }, [lineParams]);
  const rows = useMemo(() => {
    const keys = styles ? [...new Set(styles.map(normStyle).filter(Boolean))] : Object.keys(styleParams || {});
    const needle = normStyle(q);
    return keys
      .filter((k) => !needle || k.includes(needle))
      .sort((a, b) => a.localeCompare(b))
      .map((k) => {
        const own = ln ? lineParams?.[lineKey(k, ln)] || null : null;
        return { style: k, p: own || styleParams?.[k] || null, own: !!own, pend: pendingEffByStyle[effKey(k, ln)] || null };
      });
  }, [styleParams, lineParams, styles, q, ln, pendingEffByStyle]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-start gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 pt-4 space-y-3">
          {headerSlot}
          {!styles && (
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar estilo"
                className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          )}
        </div>
        <div className="p-6 pt-3 overflow-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">{styles ? "No hay estilos asignados en este día." : "Aún no hay estándares guardados."}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">Estilo</th>
                  <th className="py-2 px-2 font-medium text-right">SAM</th>
                  <th className="py-2 px-2 font-medium text-right">Operarios</th>
                  <th className="py-2 px-2 font-medium text-right">Horas</th>
                  <th className="py-2 px-2 font-medium text-right">Efic.</th>
                  <th className="py-2 px-2 font-medium text-right">Pzas/día</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(({ style, p, own, pend }) => (
                  <tr key={style} className="hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <span className="font-mono font-semibold text-gray-900">{style}</span>
                      {ln && p && (
                        <span
                          className={`ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${own ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-500"}`}
                          title={own ? `Estándar propio de la Línea ${ln}` : "Usa el estándar general del estilo"}
                        >
                          {own ? `propio L${ln}` : "general"}
                        </span>
                      )}
                      {!ln && ownByStyle[style]?.length > 0 && (
                        <span
                          className="ml-1.5 inline-flex rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                          title={`Con estándar propio: ${sortLines(ownByStyle[style]).map((l) => `L${l}`).join(", ")}`}
                        >
                          +{ownByStyle[style].length} línea{ownByStyle[style].length > 1 ? "s" : ""}
                        </span>
                      )}
                    </td>
                    {p ? (
                      <>
                        <td className="py-2 px-2 text-right tabular-nums">{Number(p.sam_minutes)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{Number(p.operators_count)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{Number(p.working_hours)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {Math.round(Number(p.efficiency) * 100)}%
                          {pend && (
                            <span
                              className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                              title="Cambio de eficiencia pendiente de aprobación del CEO"
                            >
                              <Clock className="w-3 h-3" />
                              {Math.round(Number(pend.requested_efficiency) * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">{fmt(targetOfParams(p))}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="py-2 px-2 text-right text-amber-700 text-[13px]">Sin estándar de planeación</td>
                    )}
                    <td className="py-2 pl-2 text-right">
                      <button onClick={() => onEdit(style)} className="px-2.5 py-1 text-[12px] rounded-lg border border-gray-200 hover:bg-gray-100">
                        {p ? "Editar" : "Capturar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Choose which lines get their existing cells re-planned after a standard
 * change. A general standard applies to every line without its own standard
 * for NEW drops; a line standard to that line only. Lines left unchecked keep
 * their current cells exactly as they are.
 *
 * props:
 *   style       style code
 *   recompute   preview summary from the server ({ lines, unplaced, from, target_pcs })
 *   note        optional extra line (e.g. "la eficiencia se envía al CEO")
 *   scopeLine   line whose own standard changed (null = the general standard)
 *   confirmLabel, skipLabel
 *   onConfirm(lines[])   selected line numbers ([] = none)
 *   onCancel()
 */
export function ReplanLinesModal({ style, recompute, note, scopeLine = null, confirmLabel = "Guardar y re-planear", skipLabel = "Guardar sin re-planear", onConfirm, onCancel }) {
  const lines = recompute?.lines || [];
  const [sel, setSel] = useState(() => new Set(lines.map((l) => String(l.line_no))));
  const lostByLine = useMemo(() => {
    const m = {};
    for (const u of recompute?.unplaced || []) m[String(u.line_no)] = (m[String(u.line_no)] || 0) + (Number(u.qty) || 0);
    return m;
  }, [recompute]);
  const toggle = (ln) => setSel((s) => { const n = new Set(s); n.has(ln) ? n.delete(ln) : n.add(ln); return n; });
  const all = sel.size === lines.length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-900">
            Re-planear <span className="font-mono">{style}</span>
            {scopeLine && <span className="text-gray-500 font-normal"> · Línea {scopeLine}</span>}
          </h3>
          <p className="text-sm text-gray-500">
            Elija las líneas cuyas celdas se re-planean {recompute?.from ? `desde el ${recompute.from}` : "a partir de mañana"}.
            Las líneas sin marcar conservan sus celdas tal como están.
          </p>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={all}
              onChange={() => setSel(all ? new Set() : new Set(lines.map((l) => String(l.line_no))))}
              className="rounded border-gray-300"
            />
            Todas las líneas ({lines.length})
          </label>
          <ul className="divide-y rounded-xl border border-gray-200">
            {lines.map((l) => {
              const ln = String(l.line_no);
              const lost = lostByLine[ln] || 0;
              return (
                <li key={ln}>
                  <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={sel.has(ln)} onChange={() => toggle(ln)} className="rounded border-gray-300" />
                    <span className="font-semibold text-gray-900 w-12">L{ln}</span>
                    <span className="flex-1 text-[13px] text-gray-600">
                      {l.orders} orden(es) · {l.daysBefore} → <b className="text-gray-900">{l.daysAfter}</b> día(s)
                      {l.lockedCells > 0 && <span className="text-gray-500"> · 🔒 {l.lockedCells} fija(s)</span>}
                      {lost > 0 && <span className="text-rose-600"> · {Math.round(lost).toLocaleString()} pzas no caben</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-gray-500">
            Hoy, los días pasados, las semanas bloqueadas 🔒 y las celdas ya enviadas a producción nunca se mueven.{" "}
            {scopeLine
              ? `El nuevo estándar se usa solo en la Línea ${scopeLine} para lo que se asigne de aquí en adelante.`
              : "El nuevo estándar se usa en las líneas sin estándar propio para lo que se asigne de aquí en adelante."}
          </p>
          {recompute?.lockedCells > 0 && (
            <p className="text-[12px] text-gray-500">
              🔒 {recompute.lockedCells} celda(s) en semanas bloqueadas por el CEO se quedan como están; el resto se
              re-planea saltando esas semanas.
            </p>
          )}
          {!scopeLine && recompute?.excludedLines?.length > 0 && (
            <p className="text-[12px] text-gray-500">
              No se {recompute.excludedLines.length > 1 ? "tocan" : "toca"} {recompute.excludedLines.map((l) => `L${l}`).join(", ")}:{" "}
              {recompute.excludedLines.length > 1 ? "tienen" : "tiene"} estándar propio.
            </p>
          )}
          {note && <p className="text-[12px] text-amber-700">{note}</p>}
        </div>
        <div className="px-6 py-4 border-t flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cancelar</button>
          <button onClick={() => onConfirm([])} className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">{skipLabel}</button>
          <button
            onClick={() => onConfirm([...sel])}
            disabled={sel.size === 0}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
          >
            {confirmLabel}{sel.size > 0 && sel.size < lines.length ? ` (${sel.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}