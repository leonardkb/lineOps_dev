import { useMemo, useState } from "react";
import { calcTargetFromSAM, safeNum } from "../utils/calc";
import { STYLE_EFFICIENCY_PRESETS } from "../utils/efficiency";

export default function HeaderForm({ value, onChange, slots, onSaveSuccess }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const set = (k, v) => onChange({ ...value, [k]: v });

  const target = useMemo(() => {
    return calcTargetFromSAM(
      value.operators,
      value.workingHours,
      value.sam,
      value.efficiency
    );
  }, [value.operators, value.workingHours, value.sam, value.efficiency]);

  const targetPerHour = useMemo(() => {
    const wh = safeNum(value.workingHours);
    return wh > 0 ? target / wh : 0;
  }, [target, value.workingHours]);

  const handleSave = async () => {
    setLoading(true);
    setMessage("");

    try {
      // Map slots to include only the fields needed by the backend,
      // and ensure startTime/endTime are passed (they come from buildShiftSlots)
      const slotsData = (slots || []).map((slot) => ({
        label: slot.label,
        hours: slot.hours,
        startTime: slot.startTime,  // now available from timeSlots.js
        endTime: slot.endTime,      // now available from timeSlots.js
      }));

      const payload = {
        line: value.line,
        date: value.date,
        style: value.style,
        operators: value.operators,
        workingHours: value.workingHours,
        sam: value.sam,
        efficiency: value.efficiency || 0.7,
        target: target,
        targetPerHour: targetPerHour,
        slots: slotsData,
      };

      const response = await fetch("http://localhost:5000/api/save-production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        const messageText = `✅ ¡Guardado! ID de corrida: ${data.lineRunId}`;
        setMessage(messageText);

        if (onSaveSuccess) {
          onSaveSuccess(data.lineRunId);
        }
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Error al guardar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">
          Paso 1 — Datos de la Línea
        </h2>
        <p className="text-sm text-gray-600">
          Complete primero esta información.  
          La meta se calculará automáticamente usando SAM y la eficiencia seleccionada.
        </p>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        
        <Field
          label="Línea"
          placeholder="Ej.: Línea 12"
          value={value.line}
          onChange={(v) => set("line", v)}
        />

        <Field
          label="Fecha"
          type="date"
          value={value.date}
          onChange={(v) => set("date", v)}
        />

        <Field
          label="Estilo"
          placeholder="Ej.: POLO-2026"
          value={value.style}
          onChange={(v) => set("style", v)}
        />

        <Field
          label="Operadores (cantidad)"
          placeholder="Ej.: 25"
          value={value.operators}
          onChange={(v) => set("operators", v)}
        />

        <Field
          label="Horas de Trabajo"
          placeholder="Ej.: 8.85"
          value={value.workingHours}
          onChange={(v) => set("workingHours", v)}
        />

        <Field
          label="SAM (minutos/pieza)"
          placeholder="Ej.: 18.5"
          value={value.sam}
          onChange={(v) => set("sam", v)}
        />

        {/* Eficiencia */}
        <label className="block">
          <div className="text-sm font-medium text-gray-800 mb-1">
            Eficiencia
          </div>
          <select
            value={value.efficiency ?? 0.7}
            onChange={(e) => set("efficiency", Number(e.target.value))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                       outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
          >
            {STYLE_EFFICIENCY_PRESETS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500 mt-1">
            Seleccione según la complejidad del estilo o capacidad de la línea.
          </div>
        </label>

        {/* Métricas */}
        <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Metric label="Meta (piezas)" value={target} />
          <Metric label="Meta por hora (piezas)" value={targetPerHour} />
        </div>

        {/* Guardar */}
        <div className="md:col-span-2 lg:col-span-3">
          <button
            onClick={handleSave}
            disabled={loading || !value.line || !value.date}
            className="w-full bg-gray-900 text-white font-medium py-3 rounded-xl 
                       hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? "Guardando..." : "💾 Guardar Datos de Producción"}
          </button>

          {message && (
            <div
              className={`mt-3 p-3 rounded-lg text-sm ${
                message.includes("✅")
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub Components ---------- */

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-gray-800 mb-1">
        {label}
      </div>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                   outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
      />
    </label>
  );
}

function Metric({ label, value }) {
  const n = Number(value);
  return (
    <div className="rounded-xl border bg-gray-50 p-4">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">
        {Number.isFinite(n) ? n.toFixed(2) : "0.00"}
      </div>
    </div>
  );
}