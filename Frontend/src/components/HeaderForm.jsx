import { useEffect, useMemo, useState } from "react";
import { calcTargetFromSAM, safeNum } from "../utils/calc";
import { STYLE_EFFICIENCY_PRESETS } from "../utils/efficiency";
import { API_URL } from "../lib/masterCodeCatalog";

/* ---------- Field readers for /api/planning/line-work-orders rows ----------
   That endpoint returns work_order_id + sam (aliased from sam_minutes).
   We still read defensively so it survives minor payload changes. */
const getWoId = (wo) => wo?.work_order_id ?? wo?.id ?? null;
const getWoNo = (wo) => wo?.work_order_no ?? wo?.workOrderNo ?? "";
const getWoStyle = (wo) =>
  wo?.style_description ??
  wo?.styleDescription ??
  wo?.style_code ??
  wo?.styleCode ??
  wo?.estilo ??
  "";
const getWoSam = (wo) => {
  const v = wo?.sam ?? wo?.sam_minutes ?? wo?.samMinutes ?? "";
  return v === null || v === undefined ? "" : v;
};

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export default function HeaderForm({ value, onChange, slots, onSaveSuccess }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Lines that actually have a work order assigned (from line_assignments)
  const [assignedLines, setAssignedLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState("");

  // Work orders assigned to the currently selected line
  const [lineWorkOrders, setLineWorkOrders] = useState([]);
  const [woLoading, setWoLoading] = useState(false);
  const [woError, setWoError] = useState("");

  const set = (k, v) => onChange({ ...value, [k]: v });

  // Load the distinct lines that have active assignments
  useEffect(() => {
    const fetchAssignedLines = async () => {
      setLinesLoading(true);
      setLinesError("");
      try {
        const res = await fetch(`${API_URL}/api/line-assignments`, {
          headers: authHeaders(),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.assignments)) {
          const uniq = new Set(
            data.assignments
              .filter(
                (a) => !["cancelled", "rejected"].includes(String(a.status))
              )
              .map((a) => String(a.line_no ?? "").trim())
              .filter(Boolean)
          );
          setAssignedLines(
            Array.from(uniq).sort(
              (a, b) => Number(a) - Number(b) || a.localeCompare(b)
            )
          );
        } else {
          setLinesError(data.error || "No se pudieron cargar las líneas asignadas.");
        }
      } catch (err) {
        setLinesError(`Error al cargar líneas: ${err.message}`);
      } finally {
        setLinesLoading(false);
      }
    };
    fetchAssignedLines();
  }, []);

  // Load the work orders assigned to the selected line
  useEffect(() => {
    const line = String(value.line ?? "").trim();
    if (!line) {
      setLineWorkOrders([]);
      return;
    }

    let cancelled = false;
    const fetchLineWorkOrders = async () => {
      setWoLoading(true);
      setWoError("");
      try {
        const res = await fetch(
          `${API_URL}/api/planning/line-work-orders?line=${encodeURIComponent(line)}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.success && Array.isArray(data.workOrders)) {
          // One work order can have several assignment rows — show each once.
          const seen = new Set();
          const unique = [];
          for (const wo of data.workOrders) {
            const id = String(getWoId(wo));
            if (id && !seen.has(id)) {
              seen.add(id);
              unique.push(wo);
            }
          }
          setLineWorkOrders(unique);
        } else {
          setWoError(data.error || "No se pudieron cargar las órdenes de esta línea.");
          setLineWorkOrders([]);
        }
      } catch (err) {
        if (!cancelled) {
          setWoError(`Error al cargar órdenes: ${err.message}`);
          setLineWorkOrders([]);
        }
      } finally {
        if (!cancelled) setWoLoading(false);
      }
    };
    fetchLineWorkOrders();
    return () => {
      cancelled = true;
    };
  }, [value.line]);

  // Changing the line clears the previously chosen work order (single write)
  const handleLineChange = (line) => {
    onChange({ ...value, line, workOrderId: null, workOrderNo: "" });
  };

  // Selecting a work order auto-fills style + SAM in ONE update to avoid
  // stale-state overwrites from calling set() several times in a row.
  const handleWorkOrderSelect = (woId) => {
    if (!woId) {
      onChange({ ...value, workOrderId: null, workOrderNo: "" });
      return;
    }
    const wo = (lineWorkOrders || []).find(
      (w) => String(getWoId(w)) === String(woId)
    );
    if (!wo) return;

    onChange({
      ...value,
      workOrderId: getWoId(wo),
      workOrderNo: getWoNo(wo),
      style: getWoStyle(wo),
      sam: getWoSam(wo),
    });
  };

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
        workOrderId: value.workOrderId || null,
        workOrderNo: value.workOrderNo || "",
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

  const selectedWorkOrderId = value.workOrderId ?? "";

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

      {/* Line Engineer — pick a line and the work order assigned to it */}
      <div className="px-5 pt-5">
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              Asignación de Orden de Trabajo
            </h3>
            <p className="text-xs text-gray-600">
              Seleccione la línea y la orden de trabajo asignada. El estilo y el
              SAM se completarán automáticamente.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Line selector — only lines with an assigned work order */}
            <label className="block">
              <div className="text-sm font-medium text-gray-800 mb-1">
                Línea (No.)
              </div>
              <select
                value={value.line ?? ""}
                onChange={(e) => handleLineChange(e.target.value)}
                disabled={linesLoading}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                           outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {linesLoading
                    ? "Cargando líneas…"
                    : assignedLines.length
                    ? "Seleccionar línea…"
                    : "Sin líneas con órdenes asignadas"}
                </option>
                {assignedLines.map((ln) => (
                  <option key={ln} value={ln}>
                    Línea {ln}
                  </option>
                ))}
              </select>
            </label>

            {/* Work order selector */}
            <label className="block">
              <div className="text-sm font-medium text-gray-800 mb-1">
                Orden de Trabajo
              </div>
              <select
                value={selectedWorkOrderId}
                onChange={(e) => handleWorkOrderSelect(e.target.value)}
                disabled={!value.line || woLoading}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                           outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!value.line
                    ? "Primero seleccione una línea"
                    : woLoading
                    ? "Cargando órdenes…"
                    : lineWorkOrders.length
                    ? "Seleccionar orden…"
                    : "Sin órdenes para esta línea"}
                </option>
                {lineWorkOrders.map((wo) => {
                  const id = getWoId(wo);
                  const no = getWoNo(wo);
                  const style = getWoStyle(wo);
                  return (
                    <option key={id} value={id}>
                      {no}
                      {style ? ` — ${style}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {(linesError || woError) && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {linesError || woError}
            </div>
          )}

          {value.workOrderId && (
            <div className="text-xs text-blue-800 bg-white border border-blue-200 rounded-lg px-3 py-2">
              ✅ Orden <strong>{value.workOrderNo}</strong> seleccionada · Estilo:{" "}
              <strong>{value.style || "—"}</strong> · SAM:{" "}
              <strong>{value.sam || "—"}</strong> min (autocompletados)
            </div>
          )}
        </div>
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