import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
/**
 * VerificadorPage
 * -----------------------------------------------------------------------------
 * Permite a un usuario "verificador" corregir la producción por hora que el
 * líder de línea capturó. El flujo es:
 *
 *   1. Elegir FECHA de la corrida.
 *   2. Elegir LÍNEA (de las líneas con corridas en esa fecha).
 *   3. Elegir ESTILO (una línea puede tener varios estilos ese día).
 *   4. Editar la cuadrícula operación × hora y guardar.
 *
 * Usa endpoints dedicados /api/verificador/*, que NO tienen el bloqueo de
 * celdas del líder de línea (así el verificador puede sobrescribir
 * cualquier valor ya guardado):
 *
 *   GET  /api/verificador/dates                       -> { dates: [...] }
 *   GET  /api/verificador/lines?date=YYYY-MM-DD        -> { lines: [{run_id,line_no,style}] }
 *   GET  /api/verificador/run/:runId/sewed          -> { run, slots, rows }
 *   POST /api/verificador/update-sewed/:runId       <- { entries:[{operatorNo,operationName,slotLabel,sewedQty}] }
 *
 * Nota backend: estos endpoints usan el middleware `requireVerificador`, que
 * ya incluye el rol "verificador".
 *
 * El navbar (con las pestañas) lo pinta VerificadorSection.jsx; esta página es
 * solo el contenido de la pestaña "Corrección de producción".
 * -----------------------------------------------------------------------------
 */

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// pg serializa columnas DATE como ISO ("2026-08-31T00:00:00.000Z"). Para que la
// comparación `run_date = $1` (columna DATE) sea exacta y no se corra un día por
// zona horaria, siempre usamos el formato YYYY-MM-DD, tanto para mostrar como
// para consultar.
function toYMD(v) {
  if (!v) return "";
  const s = String(v);
  return s.includes("T") ? s.slice(0, 10) : s;
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().trim().replace(/[\s_-]/g, "");
}

// Roles que tienen permiso de verificar/corregir. Debe coincidir con la lista
// del backend (requireVerificador en server.js) para que el guardado no devuelva
// 403. Los nombres van normalizados (sin guiones bajos): quality_head -> qualityhead.
const ALLOWED_ROLES = new Set([
  "verificador",

  "master",
  
  "admin",
]);

export default function VerificadorPage() {
  const navigate = useNavigate();

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);
  const getToken = () => localStorage.getItem("token");

  // ----- Selección -----
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [linesForDate, setLinesForDate] = useState([]); // [{run_id, line_no, style}]
  const [selectedLine, setSelectedLine] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  // ----- Datos de la corrida seleccionada -----
  const [runInfo, setRunInfo] = useState(null);
  const [slots, setSlots] = useState([]); // [{slot_id, slot_order, slot_label}]
  const [grid, setGrid] = useState([]); // [{operatorNo, operatorName, operationId, operationName, cells:{slotLabel:qty}}]
  const [original, setOriginal] = useState({}); // { "opId|slot": "12" } valores originales para detectar cambios

  // ----- Filtros operador / operación (para acotar la cuadrícula) -----
  const [selectedOperator, setSelectedOperator] = useState("all"); // operator_no o "all"
  const [selectedOperation, setSelectedOperation] = useState("all"); // operation_id o "all"

  // ----- UI -----
  const [loadingDates, setLoadingDates] = useState(true);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // ========== fetch helper ==========
  const fetchJson = useCallback(async (url, options = {}) => {
    const token = getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("No tienes permiso o tu sesión expiró. Inicia sesión de nuevo.");
    }
    if (res.status === 404) {
      throw new Error(`La ruta ${url} no existe en el servidor (404).`);
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `El servidor respondió ${res.status}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `${url} devolvió HTML en vez de JSON. Revisa el proxy de /api en vite.config.js.`
      );
    }
    return res.json();
  }, []);

  // ========== auth + carga de fechas ==========
  useEffect(() => {
    const token = getToken();
    if (!token || !user) {
      navigate("/", { replace: true });
      return;
    }
    if (!ALLOWED_ROLES.has(normalizeRole(user.role))) {
      // Sin permiso para verificar: regresar a una vista neutra.
      navigate("/", { replace: true });
      return;
    }

    (async () => {
      setLoadingDates(true);
      setErrMsg("");
      try {
        const json = await fetchJson("http://localhost:5000/api/verificador/dates");
        const list = (json.dates || []).map(toYMD).filter(Boolean);
        // Únicos y ordenados desc por si el backend repite valores.
        const uniq = Array.from(new Set(list)).sort().reverse();
        setDates(uniq);
      } catch (e) {
        setErrMsg(e.message || "No se pudieron cargar las fechas.");
      } finally {
        setLoadingDates(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== al cambiar fecha: cargar líneas de esa fecha ==========
  const handleDateChange = async (date) => {
    setSelectedDate(date);
    setSelectedLine("");
    setSelectedRunId("");
    setLinesForDate([]);
    resetGrid();
    setOkMsg("");
    setErrMsg("");
    if (!date) return;

    try {
      const json = await fetchJson(`http://localhost:5000/api/verificador/lines?date=${encodeURIComponent(date)}`);
      setLinesForDate(json.lines || []);
    } catch (e) {
      setErrMsg(e.message || "No se pudieron cargar las líneas de esa fecha.");
    }
  };

  // Líneas distintas disponibles en la fecha elegida.
  const availableLines = useMemo(() => {
    const set = new Map();
    for (const r of linesForDate) set.set(String(r.line_no), r.line_no);
    return Array.from(set.values()).sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    );
  }, [linesForDate]);

  // Estilos (con su run_id) para la línea elegida.
  const stylesForLine = useMemo(() => {
    if (!selectedLine) return [];
    return linesForDate
      .filter((r) => String(r.line_no) === String(selectedLine))
      .map((r) => ({ runId: r.run_id, style: r.style }));
  }, [linesForDate, selectedLine]);

  const handleLineChange = (line) => {
    setSelectedLine(line);
    setSelectedRunId("");
    resetGrid();
    setOkMsg("");
    setErrMsg("");
  };

  const handleStyleChange = async (runId) => {
    setSelectedRunId(runId);
    setOkMsg("");
    setErrMsg("");
    if (!runId) {
      resetGrid();
      return;
    }
    await loadSewed(runId);
  };

  function resetGrid() {
    setRunInfo(null);
    setSlots([]);
    setGrid([]);
    setOriginal({});
    setSelectedOperator("all");
    setSelectedOperation("all");
  }

  // ========== cargar cuadrícula operación × hora ==========
  async function loadSewed(runId) {
    setLoadingGrid(true);
    setErrMsg("");
    try {
      const json = await fetchJson(`http://localhost:5000/api/verificador/run/${runId}/sewed`);
      setRunInfo(json.run || null);

      const slotList = (json.slots || []).slice().sort(
        (a, b) => safeNum(a.slot_order) - safeNum(b.slot_order)
      );
      setSlots(slotList);

      // Agrupar filas (operation_id) con sus celdas por slot_label.
      const byOp = new Map();
      const orig = {};
      for (const row of json.rows || []) {
        const key = row.operation_id;
        if (!byOp.has(key)) {
          byOp.set(key, {
            operatorNo: row.operator_no,
            operatorName: row.operator_name,
            operationId: row.operation_id,
            operationName: row.operation_name,
            cells: {},
          });
        }
        const val = String(safeNum(row.sewed_qty));
        byOp.get(key).cells[row.slot_label] = val;
        orig[`${row.operation_id}|${row.slot_label}`] = val;
      }

      // Orden estable: por número de operador, luego por nombre de operación.
      const rows = Array.from(byOp.values()).sort((a, b) => {
        const n = safeNum(a.operatorNo) - safeNum(b.operatorNo);
        if (n !== 0) return n;
        return String(a.operationName).localeCompare(String(b.operationName));
      });

      setGrid(rows);
      setOriginal(orig);
    } catch (e) {
      setErrMsg(e.message || "No se pudo cargar la producción de esta corrida.");
      resetGrid();
    } finally {
      setLoadingGrid(false);
    }
  }

  // ========== edición de celdas ==========
  const setCell = (operationId, slotLabel, value) => {
    // Solo dígitos (piezas). Cadena vacía permitida mientras escribe.
    const clean = value === "" ? "" : String(Math.max(0, Math.floor(safeNum(value))));
    setGrid((prev) =>
      prev.map((r) =>
        r.operationId === operationId
          ? { ...r, cells: { ...r.cells, [slotLabel]: clean } }
          : r
      )
    );
    setOkMsg("");
  };

  const isDirty = (operationId, slotLabel, value) => {
    const o = original[`${operationId}|${slotLabel}`] ?? "";
    return String(safeNum(value)) !== String(safeNum(o));
  };

  const dirtyCount = useMemo(() => {
    let c = 0;
    for (const r of grid) {
      for (const s of slots) {
        const v = r.cells[s.slot_label] ?? "";
        if (isDirty(r.operationId, s.slot_label, v)) c++;
      }
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, slots, original]);

  const resetCell = (operationId, slotLabel) => {
    const o = original[`${operationId}|${slotLabel}`] ?? "0";
    setCell(operationId, slotLabel, o);
  };

  // ========== filtros operador / operación ==========
  // Operadores distintos de la corrida (por operator_no).
  const operatorOptions = useMemo(() => {
    const map = new Map();
    for (const r of grid) {
      if (!map.has(String(r.operatorNo))) {
        map.set(String(r.operatorNo), {
          operatorNo: r.operatorNo,
          operatorName: r.operatorName,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => safeNum(a.operatorNo) - safeNum(b.operatorNo)
    );
  }, [grid]);

  // Operaciones del operador seleccionado (o de todos si "all").
  const operationOptions = useMemo(() => {
    const rows =
      selectedOperator === "all"
        ? grid
        : grid.filter((r) => String(r.operatorNo) === String(selectedOperator));
    const map = new Map();
    for (const r of rows) {
      if (!map.has(String(r.operationId))) {
        map.set(String(r.operationId), {
          operationId: r.operationId,
          operationName: r.operationName,
          operatorNo: r.operatorNo,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      String(a.operationName).localeCompare(String(b.operationName))
    );
  }, [grid, selectedOperator]);

  const handleOperatorChange = (val) => {
    setSelectedOperator(val);
    // Al cambiar de operador, la operación elegida podría no pertenecerle.
    setSelectedOperation("all");
  };

  // Cuadrícula visible tras aplicar los filtros de operador y operación.
  const visibleGrid = useMemo(() => {
    return grid.filter((r) => {
      if (selectedOperator !== "all" && String(r.operatorNo) !== String(selectedOperator)) {
        return false;
      }
      if (selectedOperation !== "all" && String(r.operationId) !== String(selectedOperation)) {
        return false;
      }
      return true;
    });
  }, [grid, selectedOperator, selectedOperation]);

  // Totales por columna (hora) y por fila (operación) — sobre lo VISIBLE.
  const rowTotal = (r) =>
    slots.reduce((sum, s) => sum + safeNum(r.cells[s.slot_label]), 0);
  const colTotal = (slotLabel) =>
    visibleGrid.reduce((sum, r) => sum + safeNum(r.cells[slotLabel]), 0);
  const grandTotal = visibleGrid.reduce((sum, r) => sum + rowTotal(r), 0);

  // ========== guardar cambios ==========
  async function handleSave() {
    if (!selectedRunId) return;
    const entries = [];
    for (const r of grid) {
      for (const s of slots) {
        const v = r.cells[s.slot_label] ?? "";
        if (isDirty(r.operationId, s.slot_label, v)) {
          entries.push({
            operatorNo: r.operatorNo,
            operationName: r.operationName,
            slotLabel: s.slot_label,
            sewedQty: safeNum(v),
          });
        }
      }
    }

    if (entries.length === 0) {
      setErrMsg("No hay cambios por guardar.");
      return;
    }

    setSaving(true);
    setErrMsg("");
    setOkMsg("");
    try {
      const json = await fetchJson(`http://localhost:5000/api/verificador/update-sewed/${selectedRunId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!json.success) {
        setErrMsg(json.error || "No se pudieron guardar los cambios.");
        return;
      }
      setOkMsg(`✅ ${json.updatedCount ?? entries.length} valor(es) corregido(s) y guardado(s).`);
      // Recargar para reflejar lo guardado y limpiar el estado "modificado".
      await loadSewed(selectedRunId);
    } catch (e) {
      setErrMsg(e.message || "Error de red al guardar.");
    } finally {
      setSaving(false);
    }
  }

  // ========== render ==========
  return (
    <div>
      {/* Barra superior mínima (sin depender de la nav del líder de línea) */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-sm font-semibold text-white">
              Verificador
            </span>
            <span className="text-sm text-gray-600">
              Corrección de producción por hora
            </span>
          </div>
          <div className="text-sm text-gray-500">
            {user?.full_name || user?.username || ""}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-4">
        {/* ---- Selección: Fecha -> Línea -> Estilo ---- */}
        <div className="rounded-3xl border bg-white shadow-sm p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            1. Selecciona la corrida
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Elige la fecha, la línea y el estilo cuya captura del líder de línea
            quieres revisar.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Fecha */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fecha
              </label>
              <select
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                disabled={loadingDates}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
              >
                <option value="">
                  {loadingDates ? "Cargando…" : "— Selecciona fecha —"}
                </option>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Línea */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Línea
              </label>
              <select
                value={selectedLine}
                onChange={(e) => handleLineChange(e.target.value)}
                disabled={!selectedDate || availableLines.length === 0}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">
                  {!selectedDate
                    ? "Elige fecha primero"
                    : availableLines.length === 0
                    ? "Sin líneas"
                    : "— Selecciona línea —"}
                </option>
                {availableLines.map((l) => (
                  <option key={l} value={l}>
                    Línea {l}
                  </option>
                ))}
              </select>
            </div>

            {/* Estilo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estilo
              </label>
              <select
                value={selectedRunId}
                onChange={(e) => handleStyleChange(e.target.value)}
                disabled={!selectedLine || stylesForLine.length === 0}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">
                  {!selectedLine
                    ? "Elige línea primero"
                    : stylesForLine.length === 0
                    ? "Sin estilos"
                    : "— Selecciona estilo —"}
                </option>
                {stylesForLine.map((s) => (
                  <option key={s.runId} value={s.runId}>
                    {s.style || `Corrida ${s.runId}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ---- Mensajes ---- */}
        {errMsg && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errMsg}
          </div>
        )}
        {okMsg && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
            {okMsg}
          </div>
        )}

        {/* ---- Cuadrícula editable ---- */}
        {loadingGrid && (
          <div className="rounded-3xl border bg-white shadow-sm p-5 text-gray-600">
            Cargando producción…
          </div>
        )}

        {!loadingGrid && selectedRunId && grid.length > 0 && (
          <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
            <div className="p-5 flex flex-wrap items-start justify-between gap-3 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  2. Corrige la producción por hora
                </h2>
                <div className="mt-1 text-sm text-gray-700">
                  Línea {runInfo?.line_no} • {toYMD(runInfo?.run_date)} •{" "}
                  <span className="font-medium">{runInfo?.style}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Edita cualquier celda. Las celdas modificadas se resaltan en
                  ámbar. A diferencia del líder de línea, aquí puedes sobrescribir
                  valores ya guardados.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-gray-500">Cambios sin guardar</div>
                  <div className="text-xl font-bold text-gray-900">{dirtyCount}</div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving || dirtyCount === 0}
                  className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>

            {/* ---- Filtro por operador / operación ---- */}
            <div className="p-5 border-b bg-gray-50/60">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Operador
                  </label>
                  <select
                    value={selectedOperator}
                    onChange={(e) => handleOperatorChange(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
                  >
                    <option value="all">Todos los operadores</option>
                    {operatorOptions.map((o) => (
                      <option key={o.operatorNo} value={o.operatorNo}>
                        Op. {o.operatorNo}
                        {o.operatorName ? ` — ${o.operatorName}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Operación
                  </label>
                  <select
                    value={selectedOperation}
                    onChange={(e) => setSelectedOperation(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900"
                  >
                    <option value="all">
                      {selectedOperator === "all"
                        ? "Todas las operaciones"
                        : "Todas las operaciones de este operador"}
                    </option>
                    {operationOptions.map((op) => (
                      <option key={op.operationId} value={op.operationId}>
                        {op.operationName}
                        {selectedOperator === "all" ? ` (Op. ${op.operatorNo})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(selectedOperator !== "all" || selectedOperation !== "all") && (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Mostrando {visibleGrid.length} de {grid.length} fila(s)
                  </span>
                  <button
                    onClick={() => {
                      setSelectedOperator("all");
                      setSelectedOperation("all");
                    }}
                    className="text-xs font-semibold text-gray-700 underline underline-offset-2 hover:text-gray-900"
                  >
                    Limpiar filtro
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 border-b">
                      Op.
                    </th>
                    <th className="px-3 py-3 text-left font-semibold text-gray-700 border-b">
                      Operación
                    </th>
                    {slots.map((s) => (
                      <th
                        key={s.slot_label}
                        className="px-2 py-3 text-center font-semibold text-gray-700 border-b whitespace-nowrap"
                      >
                        {s.slot_label}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center font-semibold text-gray-700 border-b bg-gray-100">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGrid.length === 0 && (
                    <tr>
                      <td
                        colSpan={2 + slots.length + 1}
                        className="px-3 py-6 text-center text-sm text-gray-500 border-b"
                      >
                        Ninguna fila coincide con el filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {visibleGrid.map((r) => (
                    <tr key={r.operationId} className="odd:bg-white even:bg-gray-50/40">
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-2 border-b whitespace-nowrap">
                        <div className="font-semibold text-gray-900">
                          {r.operatorNo}
                        </div>
                        <div className="text-xs text-gray-500">
                          {r.operatorName || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 border-b text-gray-800">
                        {r.operationName}
                      </td>
                      {slots.map((s) => {
                        const v = r.cells[s.slot_label] ?? "";
                        const dirty = isDirty(r.operationId, s.slot_label, v);
                        return (
                          <td key={s.slot_label} className="px-1.5 py-1.5 border-b text-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={v}
                              onChange={(e) =>
                                setCell(r.operationId, s.slot_label, e.target.value)
                              }
                              onDoubleClick={() =>
                                resetCell(r.operationId, s.slot_label)
                              }
                              title={
                                dirty
                                  ? `Original: ${original[`${r.operationId}|${s.slot_label}`] ?? 0} · doble clic para restaurar`
                                  : "Doble clic para restaurar"
                              }
                              className={`w-16 rounded-lg border text-center px-1 py-1.5 outline-none transition-colors ${
                                dirty
                                  ? "border-amber-400 bg-amber-50 font-semibold text-amber-900 ring-1 ring-amber-300"
                                  : "border-gray-200 bg-white text-gray-800 focus:border-gray-900"
                              }`}
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 border-b text-center font-semibold text-gray-900 bg-gray-100">
                        {rowTotal(r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100">
                    <td className="sticky left-0 z-10 bg-gray-100 px-3 py-3 font-semibold text-gray-800" colSpan={2}>
                      Total por hora
                    </td>
                    {slots.map((s) => (
                      <td
                        key={s.slot_label}
                        className="px-2 py-3 text-center font-semibold text-gray-900"
                      >
                        {colTotal(s.slot_label)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center font-bold text-gray-900 bg-gray-200">
                      {grandTotal}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Barra de acción inferior (repetida para comodidad en tablas largas) */}
            <div className="p-4 border-t flex items-center justify-end gap-3">
              <span className="text-sm text-gray-500">
                {dirtyCount > 0
                  ? `${dirtyCount} cambio(s) pendiente(s)`
                  : "Sin cambios pendientes"}
              </span>
              <button
                onClick={handleSave}
                disabled={saving || dirtyCount === 0}
                className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        )}

        {/* Estado vacío tras seleccionar corrida sin filas */}
        {!loadingGrid && selectedRunId && grid.length === 0 && (
          <div className="rounded-3xl border bg-white shadow-sm p-5 text-gray-600">
            Esta corrida no tiene operaciones u horas configuradas.
          </div>
        )}

        {/* Estado inicial */}
        {!selectedRunId && !loadingGrid && (
          <div className="rounded-3xl border border-dashed bg-white/60 p-8 text-center text-gray-500">
            Selecciona fecha, línea y estilo para ver y corregir la producción por
            hora capturada por el líder de línea.
          </div>
        )}
      </div>
    </div>
  );
}