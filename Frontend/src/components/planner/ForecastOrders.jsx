// components/planner/ForecastOrders.jsx
//
// Pronósticos del cliente (Forecast Board):
//   • ForecastOrderModal       crear / editar un pronóstico FC####
//   • ForecastOrdersListModal  lista con editar / quitar del tablero / cancelar / borrar
//
// Un pronóstico NO viene del merchant: lo captura el planner con lo mínimo
// para poder cargarlo a una línea:
//   estilo · cliente · cantidad · descripción · temporada · fecha de entrega ·
//   no. de operarios · SAM · horas de trabajo (· eficiencia, opcional = 100 %)
// Con eso el tablero calcula su capacidad por día:
//   pzas/día = operarios × horas × 60 × eficiencia ÷ SAM
import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Plus, Pencil, Trash2, Ban, RotateCcw, Eraser, Search, ArrowRightLeft, Copy } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const EMPTY = {
  styleName: "", customerName: "", customerId: null, quantity: "", styleDescription: "",
  season: "", handoverDate: "", operators: "", samMinutes: "", workingHours: "", efficiencyPct: "100", notes: "",
};

export const forecastToForm = (r) => ({
  styleName: r.style_name || "",
  customerName: r.customer_name || "",
  customerId: r.customer_id ?? null,
  quantity: r.quantity != null ? String(Number(r.quantity)) : "",
  styleDescription: r.style_description || "",
  season: r.season || "",
  handoverDate: r.handover_date ? String(r.handover_date).slice(0, 10) : "",
  operators: r.operators_count != null ? String(r.operators_count) : "",
  samMinutes: r.sam_minutes != null ? String(Number(r.sam_minutes)) : "",
  workingHours: r.working_hours != null ? String(Number(r.working_hours)) : "",
  efficiencyPct: r.efficiency != null ? String(Math.round(Number(r.efficiency) * 1000) / 10) : "100",
  notes: r.notes || "",
});

const n = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString();
const dmy = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");

function Field({ label, required, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[12px] font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400";

// ---------------------------------------------------------------------------
// Crear / editar
// props:
//   initial          fila del servidor | null para nuevo
//                    (initial.__baseLine = línea a precargar, desde la tarjeta)
//   today            "YYYY-MM-DD" del tablero (la re-planeación arranca aquí)
//   holidayDatesFor  (lineNo, fromYmd, days) => ["YYYY-MM-DD", …] festivos
//   onClose(), onSaved(row, recalculated[])
//
// CAMBIO DE CAPACIDAD (operarios / SAM / horas / eficiencia) de un pronóstico
// que ya está en el tablero: primero se eligen las LÍNEAS donde aplica (las
// líneas donde está el pronóstico, y/o «General» para líneas nuevas). Al
// guardar, el servidor re-calcula esas líneas: mismas piezas desde hoy,
// re-empacadas día por día con las nuevas pzas/día.
// ---------------------------------------------------------------------------
const CAP_KEYS = ["operators", "samMinutes", "workingHours", "efficiencyPct"];
const capOf = (p) => ({
  operators: p?.operators_count != null ? String(p.operators_count) : "",
  samMinutes: p?.sam_minutes != null ? String(Number(p.sam_minutes)) : "",
  workingHours: p?.working_hours != null ? String(Number(p.working_hours)) : "",
  efficiencyPct: p?.efficiency != null ? String(Math.round(Number(p.efficiency) * 1000) / 10) : "100",
});
const perDayOf = (c) => {
  const ops = n(c.operators), hrs = n(c.workingHours), sam = n(c.samMinutes);
  const eff = (n(c.efficiencyPct) || 100) / 100;
  return ops > 0 && hrs > 0 && sam > 0 ? (ops * hrs * 60 * eff) / sam : 0;
};
const sameCap = (a, b) => CAP_KEYS.every((k) => n(a[k]) === n(b[k]));

export function ForecastOrderModal({ initial = null, today = null, holidayDatesFor = null, onClose, onSaved }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState(() => (initial ? forecastToForm(initial) : EMPTY));
  const [nextNo, setNextNo] = useState(initial?.forecast_no || "");
  const [customers, setCustomers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ---- capacidad por línea -------------------------------------------------
  const general = useMemo(() => capOf(initial || {}), [initial]);
  const ownByLine = useMemo(() => {
    const m = new Map();
    (initial?.line_params || []).forEach((lp) => m.set(String(lp.line_no), capOf(lp)));
    return m;
  }, [initial]);
  // Líneas donde el pronóstico tiene casillas (las que se pueden re-calcular).
  const boardLines = useMemo(
    () => [...new Set((initial?.lines || []).map(String))].sort((x, y) => (Number(x) || 0) - (Number(y) || 0) || x.localeCompare(y)),
    [initial]
  );
  const effOf = (ln) => ownByLine.get(ln) || general;
  // "Valores de": de qué se precargan los campos (General o una línea).
  const startBase = initial?.__baseLine && boardLines.includes(String(initial.__baseLine)) ? String(initial.__baseLine) : "general";
  const [base, setBase] = useState(startBase);
  const baseCap = base === "general" ? general : effOf(base);
  // Selección de líneas a las que aplica el cambio.
  const defaultPick = (b) => (b === "general"
    ? new Set(["general", ...boardLines.filter((ln) => !ownByLine.has(ln))])
    : new Set([b]));
  const [pick, setPick] = useState(() => defaultPick(startBase));
  useEffect(() => {
    if (!isEdit) return;
    const c = base === "general" ? general : effOf(base);
    setForm((f) => ({ ...f, ...c }));
    setPick(defaultPick(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const formCap = { operators: form.operators, samMinutes: form.samMinutes, workingHours: form.workingHours, efficiencyPct: form.efficiencyPct };
  const capChanged = isEdit && !sameCap(formCap, baseCap);
  // Hay que elegir líneas sólo si el pronóstico ya está en el tablero.
  const needsPick = capChanged && boardLines.length > 0;
  const togglePick = (k) => setPick((prev) => { const nx = new Set(prev); if (nx.has(k)) nx.delete(k); else nx.add(k); return nx; });

  useEffect(() => {
    fetch(`${API_URL}/api/customers`, { headers: authHeaders() })
      .then((r) => r.json()).then((d) => { if (d?.success) setCustomers(d.customers || []); })
      .catch(() => {});
    if (!isEdit) {
      fetch(`${API_URL}/api/forecast-orders/next-number`, { headers: authHeaders() })
        .then((r) => r.json()).then((d) => { if (d?.success) setNextNo(d.sequence); })
        .catch(() => {});
    }
  }, [isEdit]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const onCustomer = (e) => {
    const v = e.target.value;
    const hit = customers.find((c) => String(c.name).toLowerCase() === v.trim().toLowerCase());
    setForm((f) => ({ ...f, customerName: v, customerId: hit ? hit.id : null }));
  };

  // Vista previa de capacidad con los números capturados.
  const preview = useMemo(() => {
    const perDay = perDayOf(formCap);
    const qty = n(form.quantity);
    if (!(perDay > 0)) return null;
    return { perDay, perHour: perDay / (n(form.workingHours) || 1), days: qty > 0 ? Math.ceil(qty / perDay) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.operators, form.workingHours, form.samMinutes, form.efficiencyPct, form.quantity]);

  const save = async () => {
    setError("");
    const missing = [];
    if (!form.styleName.trim()) missing.push("estilo");
    if (!form.customerName.trim()) missing.push("cliente");
    if (!(n(form.quantity) > 0)) missing.push("cantidad");
    if (!(parseInt(form.operators, 10) > 0)) missing.push("no. de operarios");
    if (!(n(form.samMinutes) > 0)) missing.push("SAM");
    if (!(n(form.workingHours) > 0) || n(form.workingHours) > 24) missing.push("horas de trabajo (0–24)");
    const eff = n(form.efficiencyPct);
    if (form.efficiencyPct !== "" && (!(eff > 0) || eff > 100)) missing.push("eficiencia (1–100 %)");
    if (needsPick && pick.size === 0) missing.push("elija al menos una línea donde aplicar la nueva capacidad");
    if (missing.length) { setError(`Falta / inválido: ${missing.join(", ")}`); return; }

    // Con el pronóstico en el tablero, la capacidad NO va en el PUT: va por
    // líneas en /capacity (que también re-calcula). El PUT conserva la general.
    const capInPut = !isEdit || boardLines.length === 0 ? formCap : general;

    setSaving(true);
    try {
      const body = {
        styleName: form.styleName.trim(),
        customerName: form.customerName.trim(),
        customerId: form.customerId,
        quantity: n(form.quantity),
        styleDescription: form.styleDescription,
        season: form.season,
        handoverDate: form.handoverDate || null,
        operators: parseInt(capInPut.operators, 10),
        samMinutes: n(capInPut.samMinutes),
        workingHours: n(capInPut.workingHours),
        efficiency: capInPut.efficiencyPct === "" ? 100 : n(capInPut.efficiencyPct), // 85 o 0.85
        notes: form.notes,
      };
      const res = await fetch(`${API_URL}/api/forecast-orders${isEdit ? `/${initial.id}` : ""}`, {
        method: isEdit ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      let row = data.forecastOrder;
      let recalculated = [];

      if (needsPick) {
        const lines = [...pick].filter((k) => k !== "general");
        const from = today || new Date().toISOString().slice(0, 10);
        const blockedDates = {};
        if (holidayDatesFor) lines.forEach((ln) => { blockedDates[ln] = holidayDatesFor(ln, from, 2200); });
        const r2 = await fetch(`${API_URL}/api/forecast-orders/${initial.id}/capacity`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            operators: parseInt(form.operators, 10),
            samMinutes: n(form.samMinutes),
            workingHours: n(form.workingHours),
            efficiency: form.efficiencyPct === "" ? 100 : eff,
            lines,
            applyGeneral: pick.has("general"),
            fromDate: from,
            blockedDates,
          }),
        });
        const d2 = await r2.json().catch(() => null);
        if (!d2?.success) throw new Error(`Datos guardados, pero no se pudo re-calcular: ${d2?.error || `HTTP ${r2.status}`}`);
        row = d2.forecastOrder || row;
        recalculated = d2.recalculated || [];
      }
      onSaved?.(row, recalculated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const newPerDay = perDayOf(formCap);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose?.()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">
              {isEdit ? "Editar pronóstico" : "Nuevo pronóstico del cliente"}
              {nextNo && <span className="ml-2 font-mono text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">{nextNo}</span>}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {isEdit && boardLines.length
                ? `En el tablero en: ${boardLines.map((l) => `L${l}`).join(", ")}. Si cambia la capacidad, elija las líneas y se re-calculan al guardar.`
                : "Se queda en la bolsa del Tablero de pronóstico; arrástrelo a una línea para reservar su capacidad."}
            </p>
          </div>
          <button onClick={() => !saving && onClose?.()} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Estilo" required>
              <input autoFocus value={form.styleName} onChange={set("styleName")} maxLength={120} className={inputCls} placeholder="Nombre del estilo" />
            </Field>
            <Field label="Cliente" required hint={form.customerId ? "Cliente del catálogo" : form.customerName ? "Cliente nuevo (texto libre)" : null}>
              <input value={form.customerName} onChange={onCustomer} list="fc-customers" maxLength={150} className={inputCls} placeholder="Nombre del cliente" />
              <datalist id="fc-customers">
                {customers.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </Field>
            <Field label="Cantidad (pzas)" required>
              <input type="number" min="1" step="1" value={form.quantity} onChange={set("quantity")} className={inputCls} />
            </Field>
            <Field label="Temporada">
              <input value={form.season} onChange={set("season")} maxLength={60} className={inputCls} placeholder="p. ej. SS27" />
            </Field>
            <Field label="Descripción del estilo" className="sm:col-span-2">
              <textarea rows={2} value={form.styleDescription} onChange={set("styleDescription")} className={inputCls} />
            </Field>
            <Field label="Fecha de entrega (handover)">
              <input type="date" value={form.handoverDate} onChange={set("handoverDate")} className={inputCls} />
            </Field>
          </div>

          <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div className="text-[12px] font-semibold text-teal-800">Datos para cargar a la línea</div>
              {isEdit && boardLines.length > 0 && (
                <label className="text-[11px] text-teal-800 inline-flex items-center gap-1.5">
                  Valores de
                  <select value={base} onChange={(e) => setBase(e.target.value)}
                    className="border border-teal-200 rounded-md bg-white px-1.5 py-0.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-teal-400">
                    <option value="general">General</option>
                    {boardLines.map((ln) => (
                      <option key={ln} value={ln}>Línea {ln}{ownByLine.has(ln) ? " (propios)" : ""}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="No. de operarios" required>
                <input type="number" min="1" step="1" value={form.operators} onChange={set("operators")} className={inputCls} />
              </Field>
              <Field label="SAM (min)" required>
                <input type="number" min="0.01" step="0.01" value={form.samMinutes} onChange={set("samMinutes")} className={inputCls} />
              </Field>
              <Field label="Horas de trabajo" required>
                <input type="number" min="0.5" max="24" step="0.25" value={form.workingHours} onChange={set("workingHours")} className={inputCls} />
              </Field>
              <Field label="Eficiencia %" hint="Opcional · 100 %">
                <input type="number" min="1" max="100" step="1" value={form.efficiencyPct} onChange={set("efficiencyPct")} className={inputCls} />
              </Field>
            </div>
            <div className="mt-2 text-[12px] text-teal-900">
              {preview ? (
                <>
                  Capacidad: <b>{fmt(preview.perDay)} pzas/día</b> ({fmt(preview.perHour)}/h)
                  {preview.days != null && <> · necesita <b>{preview.days}</b> día(s)-línea para {fmt(form.quantity)} pzas</>}
                  {capChanged && perDayOf(baseCap) > 0 && <span className="text-teal-700"> · antes {fmt(perDayOf(baseCap))} pzas/día</span>}
                </>
              ) : (
                <span className="text-teal-700/70">Capture operarios, SAM y horas para ver la capacidad por día.</span>
              )}
            </div>

            {/* Elegir líneas donde aplica el cambio de capacidad */}
            {needsPick && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="text-[12px] font-semibold text-amber-900">Aplicar la nueva capacidad a:</div>
                <p className="text-[11px] text-amber-800 mb-2">
                  Las líneas marcadas se re-calculan al guardar: sus piezas desde hoy se vuelven a repartir con {fmt(newPerDay)} pzas/día
                  (antes de hoy no se toca). Las no marcadas se quedan como están.
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 rounded-md bg-white border border-amber-200 px-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={pick.has("general")} onChange={() => togglePick("general")}
                      className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                    <span className="text-[12px] font-semibold text-gray-800 w-20">General</span>
                    <span className="text-[11px] text-gray-500 flex-1">líneas nuevas donde se arrastre después</span>
                    <span className="text-[11px] tabular-nums text-gray-600">{fmt(perDayOf(general))} → <b className="text-teal-700">{fmt(newPerDay)}</b> pzas/día</span>
                  </label>
                  {boardLines.map((ln) => {
                    const cur = effOf(ln);
                    return (
                      <label key={ln} className="flex items-center gap-2 rounded-md bg-white border border-amber-200 px-2.5 py-1.5 cursor-pointer">
                        <input type="checkbox" checked={pick.has(ln)} onChange={() => togglePick(ln)}
                          className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                        <span className="text-[12px] font-semibold text-gray-800 w-20">Línea {ln}</span>
                        <span className="text-[11px] text-gray-500 flex-1">
                          {cur.operators} op · SAM {cur.samMinutes} · {cur.workingHours} h{n(cur.efficiencyPct) < 100 ? ` · ${cur.efficiencyPct}%` : ""}
                          {ownByLine.has(ln) && <span className="ml-1 text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-1.5">propios</span>}
                        </span>
                        <span className="text-[11px] tabular-nums text-gray-600">{fmt(perDayOf(cur))} → <b className="text-teal-700">{fmt(newPerDay)}</b> pzas/día</span>
                      </label>
                    );
                  })}
                </div>
                {!pick.has("general") && [...pick].length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-800">Las líneas marcadas guardan estos valores como propios; la general no cambia.</p>
                )}
              </div>
            )}
          </div>

          <Field label="Notas">
            <input value={form.notes} onChange={set("notes")} maxLength={2000} className={inputCls} />
          </Field>

          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={() => onClose?.()} disabled={saving} className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={save} disabled={saving || (needsPick && pick.size === 0)} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {!isEdit ? "Crear pronóstico" : needsPick ? "Guardar y re-calcular" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista
// props: onClose(), onEdit(row), onNew(), onChanged() → el tablero recarga
// ---------------------------------------------------------------------------
export function ForecastOrdersListModal({ onClose, onEdit, onNew, onChanged, onConvert }) {
  const [status, setStatus] = useState("active");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ active: 0, cancelled: 0, all: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status });
      if (search.trim()) qs.set("search", search.trim());
      const r = await fetch(`${API_URL}/api/forecast-orders?${qs}`, { headers: authHeaders() });
      const d = await r.json();
      if (!d?.success) throw new Error(d?.error || "Error");
      setRows(d.forecastOrders || []);
      setCounts(d.counts || counts);
      setError("");
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t); }, [status, search]);

  const act = async (row, kind) => {
    const msgs = {
      clear: `¿Quitar del tablero todas las celdas de ${row.forecast_no}? El pronóstico regresa completo a la bolsa.`,
      cancel: `¿Cancelar ${row.forecast_no}? Sus celdas en el tablero se liberan.`,
      delete: `¿Borrar ${row.forecast_no} definitivamente? Esta acción no se puede deshacer.`,
    };
    if (msgs[kind] && !window.confirm(msgs[kind])) return;
    const req = {
      clear: [`/api/forecast-holds?forecastOrderId=${row.id}`, "DELETE"],
      cancel: [`/api/forecast-orders/${row.id}/cancel`, "POST"],
      reactivate: [`/api/forecast-orders/${row.id}/reactivate`, "POST"],
      delete: [`/api/forecast-orders/${row.id}`, "DELETE"],
    }[kind];
    setBusyId(row.id);
    try {
      const r = await fetch(`${API_URL}${req[0]}`, { method: req[1], headers: authHeaders() });
      const d = await r.json().catch(() => null);
      if (!d?.success) throw new Error(d?.error || `HTTP ${r.status}`);
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

  const tabs = [["active", "Activos"], ["converted", "Convertidos"], ["cancelled", "Cancelados"], ["all", "Todos"]];

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-semibold text-gray-900 text-lg">Pronósticos del cliente</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar FC, estilo, cliente, temporada…"
                className="h-9 w-64 pl-8 pr-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-300" />
            </div>
            <button onClick={onNew} className="h-9 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-700">
              <Plus className="w-4 h-4" /> Nuevo
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="px-5 pt-3 flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={`px-3 py-1.5 text-sm rounded-lg ${status === k ? "bg-teal-600 text-white font-semibold" : "text-gray-600 hover:bg-gray-100"}`}>
              {label} <span className="opacity-70">({counts[k] ?? 0})</span>
            </button>
          ))}
        </div>
        {error && <div className="mx-5 mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <div className="py-10 flex justify-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No hay pronósticos.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="py-2 pr-3">FC</th><th className="py-2 pr-3">Estilo</th><th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3">Temp.</th><th className="py-2 pr-3 text-right">Cantidad</th>
                    <th className="py-2 pr-3 text-right">En tablero</th><th className="py-2 pr-3">Entrega</th>
                    <th className="py-2 pr-3">Op · SAM · h</th><th className="py-2 pr-3 text-right">pzas/día</th>
                    <th className="py-2 pr-3">Líneas</th><th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const held = Number(r.held_quantity) || 0;
                    const qty = Number(r.quantity) || 0;
                    const late = r.handover_date && r.last_day && r.last_day > r.handover_date;
                    const cancelled = r.status === "cancelled";
                    const converted = r.status === "converted";
                    const isOpen = r.status === "active" || r.status === "partially_converted";
                    const conv = Number(r.converted_pieces) || 0;
                    return (
                      <tr key={r.id} className={`border-b last:border-0 ${cancelled ? "opacity-60" : ""}`}>
                        <td className="py-2 pr-3 font-mono font-semibold text-teal-800">
                          {r.forecast_no}
                          {r.status === "partially_converted" && <div className="font-sans text-[10px] font-semibold text-indigo-700">parcial</div>}
                          {converted && <div className="font-sans text-[10px] font-semibold text-emerald-700">convertido</div>}
                        </td>
                        <td className="py-2 pr-3"><div className="font-medium text-gray-900">{r.style_name}</div>
                          {r.style_description && <div className="text-[11px] text-gray-500 max-w-[220px] truncate" title={r.style_description}>{r.style_description}</div>}</td>
                        <td className="py-2 pr-3">{r.customer_name}</td>
                        <td className="py-2 pr-3">{r.season || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {fmt(qty)}
                          {conv > 0 && (
                            <div className="text-[10px] text-indigo-700 max-w-[170px] truncate" title={r.work_order_nos || ""}>
                              {fmt(conv)} → {r.work_order_nos || "SKM"}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <span className={held >= qty - conv && held > 0 ? "text-emerald-700 font-semibold" : held > 0 ? "text-amber-700" : "text-gray-400"}>{fmt(held)}</span>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {dmy(r.handover_date)}
                          {late && <span className="ml-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-1.5">termina {dmy(r.last_day).slice(0, 5)}</span>}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-gray-600">
                          {r.operators_count} · {Number(r.sam_minutes)} · {Number(r.working_hours)}
                          {Number(r.efficiency) < 1 && <span className="text-gray-400"> · {Math.round(Number(r.efficiency) * 100)}%</span>}
                          {(r.line_params || []).length > 0 && (
                            <span className="ml-1 text-[10px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-1.5"
                              title={(r.line_params || []).map((lp) => `L${lp.line_no}: ${lp.operators_count} op · SAM ${Number(lp.sam_minutes)} · ${Number(lp.working_hours)} h`).join("\n")}>
                              +{r.line_params.length} línea(s) propia(s)
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmt(r.target_pcs)}</td>
                        <td className="py-2 pr-3 text-gray-600">{(r.lines || []).length ? (r.lines || []).map((l) => `L${l}`).join(", ") : "—"}</td>
                        <td className="py-2 whitespace-nowrap text-right">
                          {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin inline text-gray-400" /> : (
                            <span className="inline-flex gap-1">
                              {isOpen && onConvert && <IconBtn title="Convertir a SKM" onClick={() => onConvert(r)}><ArrowRightLeft className="w-4 h-4 text-indigo-600" /></IconBtn>}
                              {isOpen && <IconBtn title="Editar" onClick={() => onEdit?.(r)}><Pencil className="w-4 h-4" /></IconBtn>}
                              {isOpen && held > 0 && <IconBtn title="Quitar del tablero" onClick={() => act(r, "clear")}><Eraser className="w-4 h-4" /></IconBtn>}
                              {isOpen && <IconBtn title="Cancelar" onClick={() => act(r, "cancel")}><Ban className="w-4 h-4" /></IconBtn>}
                              {cancelled && <IconBtn title="Reactivar" onClick={() => act(r, "reactivate")}><RotateCcw className="w-4 h-4" /></IconBtn>}
                              {conv === 0 && <IconBtn title="Borrar" danger onClick={() => act(r, "delete")}><Trash2 className="w-4 h-4" /></IconBtn>}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }) {
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={`p-1.5 rounded-md border border-transparent ${danger ? "text-rose-600 hover:bg-rose-50 hover:border-rose-200" : "text-gray-600 hover:bg-gray-100 hover:border-gray-200"}`}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tarjeta de detalle de una reserva (FC#### en el pronóstico, PRE#### en el
// Plan Board). Se abre al tocar la casilla; mismo formato que la tarjeta de PO.
// props:
//   hold     casilla tocada (fila de holdRows: line_no, assigned_date, assigned_quantity…)
//   cells    TODAS las casillas de esa orden en el tablero
//   order    { no, kind:"forecast"|"pre", customer, style, description, season,
//              customerPo, quantity, delivery, sam, operators, hours, efficiency, notes }
//   today    "YYYY-MM-DD"
//   onPick(cell)            ir a otra casilla de la orden
//   onRemoveCell(cell)      quitar esta casilla
//   onRemoveCells(cells, label)  quitar varias (la orden en esta línea / todo)
//   onEdit()                editar pronóstico (sólo FC)
//   busy, onClose
// ---------------------------------------------------------------------------
const ymd10 = (v) => (v ? String(v).slice(0, 10) : "");
const dayDiff = (a, b) => Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);

export function HoldDetailsCard({ hold, cells, order, today, onPick, onRemoveCell, onRemoveCells, onEdit, onConvert, busy, onClose }) {
  const isFc = order.kind === "forecast";
  const accent = isFc
    ? { bar: "bg-teal-600", soft: "bg-teal-200", chip: "bg-teal-600", text: "text-teal-700", ring: "ring-teal-600" }
    : { bar: "bg-violet-600", soft: "bg-violet-200", chip: "bg-violet-600", text: "text-violet-700", ring: "ring-violet-600" };
  const qtyOf = (c) => Number(c.assigned_quantity) || 0;
  const selDay = ymd10(hold.assigned_date);
  const sameLine = (c) => String(c.line_no) === String(hold.line_no);

  // Este día (misma orden, misma línea, mismo día; puede haber varios colores)
  const dayQty = cells.filter((c) => sameLine(c) && ymd10(c.assigned_date) === selDay).reduce((t, c) => t + qtyOf(c), 0);

  // Plan de la orden en el tablero
  const total = Number(order.quantity) || 0;
  const pastQty = cells.filter((c) => ymd10(c.assigned_date) < today).reduce((t, c) => t + qtyOf(c), 0);
  const nextQty = cells.filter((c) => ymd10(c.assigned_date) >= today).reduce((t, c) => t + qtyOf(c), 0);
  const placed = pastQty + nextQty;
  const freeQty = Math.max(total - placed, 0);
  const base = Math.max(total, placed, 1);
  const lines = [...new Set(cells.map((c) => String(c.line_no)))].sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));

  // Termina / entrega
  const ends = cells.map((c) => ymd10(c.assigned_date)).filter(Boolean).sort();
  const termina = ends[ends.length - 1] || null;
  const entrega = ymd10(order.delivery) || null;
  const slack = termina && entrega ? dayDiff(entrega, termina) : null;

  // Días en esta línea
  const byDay = new Map();
  cells.filter(sameLine).forEach((c) => {
    const d = ymd10(c.assigned_date);
    const g = byDay.get(d) || { d, qty: 0, cell: c };
    g.qty += qtyOf(c);
    byDay.set(d, g);
  });
  const lineDays = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
  const maxDay = Math.max(1, ...lineDays.map((g) => g.qty));
  const lineCells = cells.filter(sameLine);

  // Capacidad (sólo si hay datos)
  const sam = Number(order.sam) || 0;
  const perDay = sam > 0 && order.operators > 0 && order.hours > 0
    ? (order.operators * order.hours * 60 * (Number(order.efficiency) || 1)) / sam : 0;

  const goLine = (ln) => {
    const on = cells.filter((c) => String(c.line_no) === ln);
    if (!on.length) return;
    const t = new Date(`${selDay}T00:00:00`).getTime();
    on.sort((a, b) => Math.abs(new Date(`${ymd10(a.assigned_date)}T00:00:00`) - t) - Math.abs(new Date(`${ymd10(b.assigned_date)}T00:00:00`) - t));
    onPick(on[0]);
  };

  const Label = ({ children, right }) => (
    <div className="flex items-baseline justify-between gap-2 mb-1.5">
      <span className="text-[12px] font-semibold text-gray-800">{children}</span>
      {right != null && <span className="text-[11px] text-gray-500 tabular-nums">{right}</span>}
    </div>
  );
  const Info = ({ k, v, mono, wide }) => (
    <div className={`min-w-0 ${wide ? "col-span-full" : ""}`}>
      <div className="text-[11px] text-gray-500">{k}</div>
      <div className={`text-[13px] font-semibold text-gray-900 ${wide ? "whitespace-pre-wrap break-words" : "truncate"} ${mono ? "font-mono" : ""}`}>{v || "—"}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Detalles de ${order.no}`}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[780px] max-h-[92vh] flex flex-col overflow-hidden text-[12px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="relative pl-5 pr-3 py-3 border-b flex items-start gap-3">
          <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${accent.bar}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-gray-900 text-[15px] tracking-tight font-mono">{order.no}</h3>
              <span className={`text-[10px] font-bold rounded-full text-white px-2 py-0.5 ${accent.chip}`}>{isFc ? "PRONÓSTICO" : "PRE-ORDEN"}</span>
            </div>
            <div className="text-[12px] text-gray-500 truncate mt-0.5">
              {order.customer || "—"} · {order.style || "—"}
            </div>
          </div>
          <span className="shrink-0 text-[12px] font-semibold rounded-lg bg-gray-900 text-white px-2.5 py-1">Línea {hold.line_no}</span>
          <span className="shrink-0 text-[12px] rounded-lg border border-gray-200 text-gray-700 px-2.5 py-1">{dmy(selDay)}</span>
          <button onClick={onClose} className="shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-[1.05fr_1fr] md:divide-x divide-gray-200">
          {/* Izquierda */}
          <div className="p-4 space-y-4">
            <section>
              <Label right={total > 0 ? `${Math.round((dayQty / total) * 100)}% del total` : null}>Este día</Label>
              <div className="flex items-end gap-6">
                <div>
                  <div className="text-[22px] font-bold text-gray-900 leading-none tabular-nums">{fmt(dayQty)}</div>
                  <div className="text-[11px] text-gray-500 mt-1">pzas reservadas</div>
                </div>
                {perDay > 0 && (
                  <div>
                    <div className="text-[22px] font-bold text-gray-900 leading-none tabular-nums">{fmt(perDay)}</div>
                    <div className="text-[11px] text-gray-500 mt-1">capacidad pzas/día</div>
                  </div>
                )}
              </div>
              {perDay > 0 && (
                <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${accent.bar}`} style={{ width: `${Math.min(100, (dayQty / perDay) * 100)}%` }} />
                </div>
              )}
            </section>

            <section>
              <Label right={`${fmt(placed)} / ${fmt(total)} pzas`}>Plan en el tablero</Label>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden flex">
                <div className="h-full bg-slate-500" style={{ width: `${(pastQty / base) * 100}%` }} />
                <div className={`h-full ${accent.bar}`} style={{ width: `${(nextQty / base) * 100}%` }} />
                <div className={`h-full ${accent.soft}`} style={{ width: `${(freeQty / base) * 100}%` }} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-500" />Antes de hoy {fmt(pastQty)}</span>
                <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${accent.bar}`} />Desde hoy {fmt(nextQty)}</span>
                <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${accent.soft}`} />Sin asignar {fmt(freeQty)}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-500">Líneas:</span>
                {lines.map((ln) => (
                  <button key={ln} onClick={() => goLine(ln)}
                    className={`min-w-[26px] h-6 px-1.5 rounded-md text-[11px] font-bold ${ln === String(hold.line_no) ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                    {ln}
                  </button>
                ))}
              </div>
            </section>

            <section className={`rounded-xl border px-3 py-2.5 grid grid-cols-3 gap-2 ${slack == null ? "border-gray-200 bg-gray-50" : slack < 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div><div className="text-[11px] text-gray-500">Termina</div><div className="text-[13px] font-semibold text-gray-900">{dmy(termina)}</div></div>
              <div><div className="text-[11px] text-gray-500">Entrega</div><div className="text-[13px] font-semibold text-gray-900">{dmy(entrega)}</div></div>
              <div className="text-right">
                {slack == null ? (
                  <div className="text-[11px] text-gray-500 pt-1">{entrega ? "—" : "sin fecha de entrega"}</div>
                ) : (
                  <>
                    <div className={`text-[16px] font-bold tabular-nums ${slack < 0 ? "text-rose-700" : "text-emerald-700"}`}>{slack > 0 ? `+${slack}` : slack} d</div>
                    <div className={`text-[11px] ${slack < 0 ? "text-rose-600" : "text-emerald-600"}`}>{slack < 0 ? "de atraso" : "de holgura"}</div>
                  </>
                )}
              </div>
            </section>

            <section>
              <Label right={`${lineDays.length} día(s)`}>Días en la Línea {hold.line_no}</Label>
              <div className="flex items-end gap-2 overflow-x-auto pb-1">
                {lineDays.map((g) => {
                  const on = g.d === selDay;
                  return (
                    <button key={g.d} onClick={() => onPick(g.cell)} className="flex flex-col items-center gap-1 shrink-0" title={`${dmy(g.d)} · ${fmt(g.qty)} pzas`}>
                      <span className={`text-[10px] tabular-nums ${on ? "font-bold text-gray-900" : "text-gray-500"}`}>{fmt(g.qty)}</span>
                      <span className="w-6 h-14 rounded-md bg-gray-100 flex items-end overflow-hidden">
                        <span className={`w-full ${on ? `${accent.bar} ring-2 ring-offset-1 ${accent.ring}` : "bg-slate-300"}`} style={{ height: `${Math.max(8, (g.qty / maxDay) * 100)}%` }} />
                      </span>
                      <span className={`text-[10px] tabular-nums ${on ? "font-bold text-gray-900" : "text-gray-500"}`}>{dmy(g.d).slice(0, 5)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Derecha */}
          <div className="p-4 space-y-4 bg-gray-50/50">
            {isFc || sam > 0 ? (
              <section>
                <Label right={isFc ? (order.ownLine ? "propios de la línea" : "generales") : null}>Datos para la Línea {hold.line_no}</Label>
                <div className="rounded-xl border border-gray-200 bg-white p-3 grid grid-cols-2 gap-3">
                  <Info k="No. de operarios" v={order.operators ? fmt(order.operators) : null} />
                  <Info k="SAM (min)" v={sam > 0 ? String(sam) : null} />
                  <Info k="Horas de trabajo" v={order.hours ? String(order.hours) : null} />
                  <Info k="Eficiencia" v={order.efficiency ? `${Math.round(Number(order.efficiency) * 100)}%` : null} />
                  <Info k="Capacidad" v={perDay > 0 ? `${fmt(perDay)} pzas/día` : null} />
                  <Info k="Días-línea" v={perDay > 0 && total > 0 ? `${Math.ceil(total / perDay)} día(s)` : null} />
                </div>
              </section>
            ) : null}

            <section className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info k="Cliente" v={order.customer} />
              <Info k={isFc ? "Estilo" : "Estilo N°"} v={order.style} mono={!isFc} />
              <Info k="Temporada" v={order.season} />
              {!isFc && <Info k="PO cliente" v={order.customerPo} />}
              <Info k="Total" v={total > 0 ? `${fmt(total)} pzas` : null} />
              <Info k="Entrega" v={dmy(entrega)} />
              {order.description && <Info k="Descripción del estilo" v={order.description} wide />}
              {order.notes && <Info k="Notas" v={order.notes} wide />}
              {Number(order.convertedPieces) > 0 && (
                <Info k="Ya convertido a SKM" v={`${fmt(order.convertedPieces)} pzas → ${order.workOrderNos || "SKM"}`} wide />
              )}
            </section>
          </div>
        </div>

        {/* Acciones */}
        <div className="px-4 py-3 border-t bg-gray-50 flex flex-wrap items-center justify-end gap-2">
          {isFc && onEdit && (
            <button onClick={onEdit} disabled={busy}
              className="mr-auto px-3 py-2 text-[12px] font-medium rounded-lg border border-teal-200 bg-white text-teal-700 hover:bg-teal-50 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Pencil className="w-3.5 h-3.5" /> Editar / cambiar capacidad
            </button>
          )}
          {isFc && onConvert && (
            <button onClick={onConvert} disabled={busy}
              className="px-3 py-2 text-[12px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Convertir a SKM
            </button>
          )}
          {onRemoveCell && <button onClick={() => onRemoveCell(hold)} disabled={busy}
            className="px-3 py-2 text-[12px] font-medium rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            Quitar este día
          </button>}
          {onRemoveCells && lineCells.length > 1 && (
            <button onClick={() => onRemoveCells(lineCells, `${order.no} en la Línea ${hold.line_no}`)} disabled={busy}
              className="px-3 py-2 text-[12px] font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              Quitar de la Línea {hold.line_no} ({lineCells.length})
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Cerrar</button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Convertir un pronóstico en orden(es) SKM reales
//
// Una SKM necesita lo que el pronóstico no tiene: el código maestro del estilo
// (tipo · modelo · correlativo), el cliente del catálogo con su código de 3
// letras, y las cantidades por color × talla con su estilo cliente (6). El
// formulario precarga todo lo que sí sabe el pronóstico y crea las órdenes con
// el MISMO endpoint del wizard (POST /api/production-orders, auto-numeradas
// SKM####-CLI-ESTILO). Después liga las SKMs al pronóstico
// (POST /api/forecast-orders/:id/convert), que libera sus casillas y las pone
// en el plan del merchant para que aparezcan en la bolsa del Plan Board.
// Convertir menos piezas que las pendientes = conversión PARCIAL: el resto
// sigue como pronóstico en el tablero.
// ---------------------------------------------------------------------------
const code = (v, len) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, len);

export function ConvertForecastModal({ forecast, today = null, onClose, onConverted }) {
  const open = Math.max(0, (Number(forecast.quantity) || 0) - (Number(forecast.converted_pieces) || 0));
  const [customers, setCustomers] = useState([]);
  const [h, setH] = useState(() => ({
    customerId: forecast.customer_id ? String(forecast.customer_id) : "",
    clienteCode: "",
    tipo: "", modelo: "", correlativo: "",
    estilo: "",
    description: forecast.style_description || forecast.style_name || "",
    sam: forecast.sam_minutes != null ? String(Number(forecast.sam_minutes)) : "",
    season: forecast.season || "",
    customerPo: "",
    commitmentDate: forecast.handover_date ? String(forecast.handover_date).slice(0, 10) : "",
  }));
  const [rows, setRows] = useState(() => [{ color: "", estilo: "", talla: "", quantity: open ? String(open) : "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // SKMs ya creadas: si ligar falla, "Reintentar" sólo liga (no duplica órdenes).
  const [created, setCreated] = useState(null); // { ids, nos, pieces }

  useEffect(() => {
    fetch(`${API_URL}/api/customers`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        const list = d.customers || [];
        setCustomers(list);
        // Cliente del pronóstico: por id, si no por nombre.
        const hit = list.find((c) => String(c.id) === String(forecast.customer_id)) ||
          list.find((c) => String(c.name).trim().toLowerCase() === String(forecast.customer_name || "").trim().toLowerCase());
        if (hit) setH((x) => ({ ...x, customerId: String(hit.id), clienteCode: x.clienteCode || code(hit.code, 3) }));
      })
      .catch(() => {});
  }, [forecast]);

  const setF = (k, f = (v) => v) => (e) => setH((x) => ({ ...x, [k]: f(e.target.value) }));
  const onCustomer = (e) => {
    const id = e.target.value;
    const c = customers.find((x) => String(x.id) === id);
    setH((x) => ({ ...x, customerId: id, clienteCode: c?.code ? code(c.code, 3) : x.clienteCode }));
  };
  const setRow = (i, k, f = (v) => v) => (e) => {
    const v = f(e.target.value);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };
  const addRow = (from = null) => setRows((rs) => [...rs, from ? { ...from, talla: "", quantity: "" } : { color: "", estilo: "", talla: "", quantity: "" }]);
  const delRow = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const total = rows.reduce((t, r) => t + (n(r.quantity) > 0 ? n(r.quantity) : 0), 0);
  const partial = total > 0 && total < open;
  const over = total > open;
  const masterPreview = `${code(h.tipo, 3) || "TIP"}${code(h.modelo, 3) || "MOD"}${code(h.correlativo, 2) || "00"}`;

  const validate = () => {
    const e = [];
    if (!h.customerId) e.push("cliente del catálogo");
    if (code(h.clienteCode, 3).length !== 3) e.push("código de cliente (3)");
    if (!code(h.tipo, 3)) e.push("tipo");
    if (!code(h.modelo, 3)) e.push("modelo");
    if (code(h.correlativo, 2).length !== 2) e.push("correlativo (2)");
    if (!h.description.trim()) e.push("descripción");
    if (!(n(h.sam) > 0)) e.push("SAM");
    rows.forEach((r, i) => {
      const est = code(r.estilo, 6) || code(h.estilo, 6);
      if (!code(r.color, 3) || !code(r.talla, 3) || !(n(r.quantity) > 0)) e.push(`renglón ${i + 1}: color, talla y cantidad`);
      else if (est.length !== 6) e.push(`renglón ${i + 1}: estilo cliente (6)`);
    });
    if (!(total > 0)) e.push("cantidad total");
    return [...new Set(e)];
  };

  const link = async (ids, nos, pieces) => {
    const r = await fetch(`${API_URL}/api/forecast-orders/${forecast.id}/convert`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ workOrderIds: ids, workOrderNos: nos, convertedPieces: pieces, fromDate: today || undefined }),
    });
    const d = await r.json().catch(() => null);
    if (!d?.success) throw new Error(`Las SKM ${nos.join(", ")} se crearon, pero no se pudieron ligar al pronóstico: ${d?.error || `HTTP ${r.status}`}. Toque «Reintentar ligar».`);
    return d;
  };

  const submit = async () => {
    setError("");
    if (created) {
      // Sólo falta ligar (las SKM ya existen).
      setBusy(true);
      try { const d = await link(created.ids, created.nos, created.pieces); onConverted?.({ ...d, workOrderNos: created.nos, pieces: created.pieces }); }
      catch (err) { setError(err.message); }
      finally { setBusy(false); }
      return;
    }
    const errs = validate();
    if (errs.length) { setError(`Falta / inválido: ${errs.join(", ")}`); return; }
    if (over && !window.confirm(`Va a convertir ${fmt(total)} pzas y el pronóstico sólo tiene ${fmt(open)} pendientes. ¿Continuar?`)) return;

    const lines = rows.map((r) => ({
      color: code(r.color, 3),
      talla: code(r.talla, 3),
      estilo: code(r.estilo, 6) || code(h.estilo, 6),
      quantity: n(r.quantity),
      customerPo: h.customerPo.trim() || undefined,
      commitmentDate: h.commitmentDate || undefined,
    }));
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/production-orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tipo: code(h.tipo, 3), modelo: code(h.modelo, 3), correlativo: code(h.correlativo, 2),
          clienteCode: code(h.clienteCode, 3), customerId: parseInt(h.customerId, 10),
          estilo: code(h.estilo, 6) || lines[0].estilo,
          description: h.description.trim(), sam: n(h.sam), season: h.season.trim() || undefined,
          customerPo: h.customerPo.trim() || undefined, commitmentDate: h.commitmentDate || undefined,
          // `orders` => el servidor auto-numera SKM####-CLI-ESTILO (una PO por color+estilo).
          orders: [{ commitmentDate: h.commitmentDate || undefined, lines }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.success) throw new Error(data?.error || `No se pudo crear la orden (HTTP ${res.status})`);
      const wos = data.workOrders || (data.workOrder ? [data.workOrder] : []);
      const ids = wos.map((w) => w.id);
      const nos = wos.map((w) => w.work_order_no).filter(Boolean);
      const pieces = wos.reduce((t, w) => t + (Number(w.quantity) || 0), 0) || total;
      setCreated({ ids, nos, pieces });
      const d = await link(ids, nos, pieces);
      onConverted?.({ ...d, workOrderNos: nos, pieces });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cell = "w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400";
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose?.()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg inline-flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
              Convertir <span className="font-mono text-teal-700">{forecast.forecast_no}</span> en orden SKM
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {forecast.style_name} · {forecast.customer_name} · <b>{fmt(open)}</b> pzas pendientes
              {Number(forecast.converted_pieces) > 0 && <> · ya convertidas {fmt(forecast.converted_pieces)} ({forecast.work_order_nos})</>}
            </p>
          </div>
          <button onClick={() => !busy && onClose?.()} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {created ? (
            <div className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
              Órdenes creadas: <b className="font-mono">{created.nos.join(", ")}</b>. Falta ligarlas al pronóstico.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Cliente (catálogo)" required className="sm:col-span-2"
                  hint={!h.customerId && forecast.customer_name ? `El pronóstico dice «${forecast.customer_name}»: elija el cliente del catálogo.` : null}>
                  <select value={h.customerId} onChange={onCustomer} className={inputCls}>
                    <option value="">— Elegir —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Código cliente" required hint="3 letras (p. ej. NIK)">
                  <input value={h.clienteCode} onChange={setF("clienteCode", (v) => code(v, 3))} className={`${inputCls} uppercase font-mono`} />
                </Field>
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[12px] font-semibold text-indigo-900">Código maestro del estilo</span>
                  <span className="text-[11px] text-indigo-700">Orden: <span className="font-mono font-semibold">SKM####-{code(h.clienteCode, 3) || "CLI"}-{masterPreview}</span></span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  <Field label="Tipo" required><input value={h.tipo} onChange={setF("tipo", (v) => code(v, 3))} placeholder="DAM" className={`${inputCls} uppercase font-mono`} /></Field>
                  <Field label="Modelo" required><input value={h.modelo} onChange={setF("modelo", (v) => code(v, 3))} placeholder="CHA" className={`${inputCls} uppercase font-mono`} /></Field>
                  <Field label="Correlativo" required><input value={h.correlativo} onChange={setF("correlativo", (v) => code(v, 2))} placeholder="06" className={`${inputCls} uppercase font-mono`} /></Field>
                  <Field label="Estilo cliente" hint="6 · por defecto" className="sm:col-span-1"><input value={h.estilo} onChange={setF("estilo", (v) => code(v, 6))} placeholder="FN2890" className={`${inputCls} uppercase font-mono`} /></Field>
                  <Field label="SAM" required><input type="number" min="0.01" step="0.01" value={h.sam} onChange={setF("sam")} className={inputCls} /></Field>
                  <Field label="Temporada"><input value={h.season} onChange={setF("season")} className={inputCls} /></Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <Field label="Descripción" required className="sm:col-span-3"><input value={h.description} onChange={setF("description")} className={inputCls} /></Field>
                  <Field label="PO cliente"><input value={h.customerPo} onChange={setF("customerPo")} className={inputCls} /></Field>
                  <Field label="Fecha de entrega"><input type="date" value={h.commitmentDate} onChange={setF("commitmentDate")} className={inputCls} /></Field>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold text-gray-800">Cantidades por color × talla</span>
                  <span className={`text-[12px] tabular-nums ${over ? "text-rose-700 font-semibold" : partial ? "text-amber-700 font-semibold" : "text-gray-600"}`}>
                    {fmt(total)} / {fmt(open)} pzas
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                      <tr><th className="px-2 py-1.5 text-left">Color (3)</th><th className="px-2 py-1.5 text-left">Estilo cliente (6)</th>
                        <th className="px-2 py-1.5 text-left">Talla (3)</th><th className="px-2 py-1.5 text-right">Cantidad</th><th /></tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1"><input value={r.color} onChange={setRow(i, "color", (v) => code(v, 3))} placeholder="NEG" className={`${cell} font-mono`} /></td>
                          <td className="px-2 py-1"><input value={r.estilo} onChange={setRow(i, "estilo", (v) => code(v, 6))} placeholder={code(h.estilo, 6) || "FN2890"} className={`${cell} font-mono`} /></td>
                          <td className="px-2 py-1"><input value={r.talla} onChange={setRow(i, "talla", (v) => code(v, 3))} placeholder="M" className={`${cell} font-mono`} /></td>
                          <td className="px-2 py-1"><input type="number" min="1" step="1" value={r.quantity} onChange={setRow(i, "quantity")} className={`${cell} text-right`} /></td>
                          <td className="px-1 py-1 whitespace-nowrap text-right">
                            <button title="Otra talla del mismo color" onClick={() => addRow(r)} className="p-1 rounded text-gray-500 hover:bg-gray-100"><Copy className="w-4 h-4" /></button>
                            <button title="Quitar" onClick={() => delRow(i)} disabled={rows.length === 1} className="p-1 rounded text-rose-500 hover:bg-rose-50 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => addRow()} className="mt-2 text-[12px] font-medium text-indigo-700 hover:underline inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Agregar renglón</button>
                {partial && (
                  <p className="mt-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Conversión parcial: se convierten {fmt(total)} pzas; quedan <b>{fmt(open - total)}</b> como pronóstico en el tablero
                    (se liberan primero sus días más cercanos).
                  </p>
                )}
                {!partial && total > 0 && (
                  <p className="mt-2 text-[12px] text-gray-600">
                    Conversión total: el pronóstico pasa a «Convertido» y sus casillas se liberan. Una SKM por color + estilo cliente.
                  </p>
                )}
              </div>
            </>
          )}
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">La SKM aparece en la bolsa del Plan Board, en la semana donde estaba el pronóstico.</span>
          <div className="flex gap-2">
            <button onClick={() => onClose?.()} disabled={busy} className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
            <button onClick={submit} disabled={busy} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
              {created ? "Reintentar ligar" : partial ? `Convertir ${fmt(total)} pzas` : "Convertir a SKM"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}