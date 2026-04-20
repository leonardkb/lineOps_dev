import { useState, useEffect, useMemo } from "react";
import HourlyGrid from "./HourlyGrid";
import { safeNum, calcCapacityPerHourFromTimes, calcCapacityPerHourForMultipleOperations } from "../utils/calc";

function normalizeNo(v) {
  const s = String(v ?? "").trim();
  return s === "" ? "" : s;
}

function sumSewedForRow(row, slots) {
  let sum = 0;
  (slots || []).forEach((s) => {
    const v = Number(row.sewed?.[s.id]);
    if (Number.isFinite(v)) sum += v;
  });
  return sum;
}

function sumSewedForRowAtSlot(row, slotId) {
  const v = Number(row.sewed?.[slotId]);
  return Number.isFinite(v) ? v : 0;
}

// History modal component
function CapacityHistoryModal({ operationId, operationName, operatorNo, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (operationId) {
      fetchHistory();
    }
  }, [operationId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/operation-capacity-history/${operationId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setHistory(data.history);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Historial de Capacidad</h3>
            <p className="text-sm text-gray-600">
              Operador {operatorNo} • {operationName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="text-center py-8 text-gray-600">Cargando historial...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-600">Error: {error}</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              No hay cambios de capacidad registrados para esta operación.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((item) => (
                <div key={item.id} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-gray-900">
                      {new Date(item.changed_at).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">
                      por: {item.changed_by_name || item.changed_by_username || 'Sistema'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm">
                      <span className="text-gray-600">Anterior:</span>{' '}
                      <span className="font-medium">{Number(item.old_capacity).toFixed(2)}/hora</span>
                    </div>
                    <div className="text-gray-400">→</div>
                    <div className="text-sm">
                      <span className="text-gray-600">Nuevo:</span>{' '}
                      <span className="font-medium text-blue-600">{Number(item.new_capacity).toFixed(2)}/hora</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ViewEditOperationPlanner({
  runId,
  target,
  slots,
  initialRows,
  slotTargets,
  cumulativeTargets,
  onClose,
  onSave,
}) {
  const [rows, setRows] = useState(initialRows || []);
  const [searchText, setSearchText] = useState("");
  const [operatorFilterNo, setOperatorFilterNo] = useState("ALL");
  const [editingRowId, setEditingRowId] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [historyModal, setHistoryModal] = useState({ open: false, operationId: null, operationName: "", operatorNo: "" });

  useEffect(() => {
    setRows(initialRows || []);
  }, [initialRows]);

  // Calculate capacity per hour for each row based on t1-t5 times
  const computedRows = useMemo(() => {
    // Group rows by operator to calculate multi-operation capacity
    const rowsByOperator = {};
    rows.forEach((row) => {
      const operatorNo = normalizeNo(row.operatorNo);
      if (operatorNo) {
        if (!rowsByOperator[operatorNo]) rowsByOperator[operatorNo] = [];
        rowsByOperator[operatorNo].push(row);
      }
    });

    return rows.map((row) => {
      const operatorNo = normalizeNo(row.operatorNo);
      let capPerOperator = 0;

      if (operatorNo && rowsByOperator[operatorNo]) {
        // Calculate capacity considering all operations for this operator
        capPerOperator = calcCapacityPerHourForMultipleOperations(
          rowsByOperator[operatorNo]
        );
      } else {
        // Fallback to single operation calculation
        capPerOperator = calcCapacityPerHourFromTimes(
          row.t1,
          row.t2,
          row.t3,
          row.t4,
          row.t5
        );
      }

      const newRow = {
        id: row.id,
        operatorNo: row.operatorNo,
        operatorName: row.operatorName,
        operation: row.operation,
        t1: row.t1?.toString() || "",
        t2: row.t2?.toString() || "",
        t3: row.t3?.toString() || "",
        t4: row.t4?.toString() || "",
        t5: row.t5?.toString() || "",
        stitched: row.stitched,
        sewed: row.sewed,
        capPerOperator: capPerOperator,
      };
      
      return newRow;
    });
  }, [rows]);

  // Opciones de No. de Operador para el dropdown
  const operatorNoOptions = useMemo(() => {
    const set = new Set();
    computedRows.forEach((r) => {
      const no = normalizeNo(r.operatorNo);
      if (no) set.add(no);
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [computedRows]);

  // Filtrar filas
  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    return computedRows.filter((r) => {
      const opNo = normalizeNo(r.operatorNo);
      const parentOk = operatorFilterNo === "ALL" ? true : opNo === operatorFilterNo;

      const searchOk =
        !q ||
        (r.operation || "").toLowerCase().includes(q) ||
        (r.operatorName || "").toLowerCase().includes(q) ||
        opNo.toLowerCase().includes(q);

      return parentOk && searchOk;
    });
  }, [computedRows, operatorFilterNo, searchText]);

  // Handle updating a row's t values
  const updateRowField = (rowId, field, value) => {
    setRows(prevRows => 
      prevRows.map(row => {
        if (row.id === rowId) {
          const updatedRow = {
            id: row.id,
            operatorNo: row.operatorNo,
            operatorName: row.operatorName,
            operation: row.operation,
            t1: row.t1,
            t2: row.t2,
            t3: row.t3,
            t4: row.t4,
            t5: row.t5,
            stitched: row.stitched,
            sewed: row.sewed,
            [field]: value,
          };
          return updatedRow;
        }
        return row;
      })
    );
  };

  // Start editing a row
  const startEditing = (rowId) => {
    setEditingRowId(rowId);
    setSaveMessage("");
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingRowId(null);
    setSaveMessage("");
  };

  // Show history
  const showHistory = (row) => {
    const operationId = row.id.replace('db_', '');
    setHistoryModal({
      open: true,
      operationId: operationId,
      operationName: row.operation,
      operatorNo: row.operatorNo
    });
  };

  // Save changes to a specific operation
  const saveOperationChanges = async (row) => {
    if (!runId) {
      setSaveMessage("❌ No hay ID de corrida disponible");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const token = localStorage.getItem("token");
      
      const operationData = {
        operatorNo: row.operatorNo,
        operationName: row.operation,
        t1: parseFloat(row.t1) || 0,
        t2: parseFloat(row.t2) || 0,
        t3: parseFloat(row.t3) || 0,
        t4: parseFloat(row.t4) || 0,
        t5: parseFloat(row.t5) || 0,
        capacityPerHour: row.capPerOperator || 0
      };

      const response = await fetch(`http://localhost:5000/api/update-operation/${runId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(operationData),
      });

      const data = await response.json();

      if (data.success) {
        setSaveMessage(data.capacityChanged 
          ? "✅ Operación actualizada correctamente. Cambio registrado en el historial." 
          : "✅ Operación actualizada correctamente.");
        setEditingRowId(null);
        
        if (onSave) {
          onSave();
        }
      } else {
        setSaveMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setSaveMessage(`❌ Error al guardar: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map();
    visibleRows.forEach((r) => {
      const no = normalizeNo(r.operatorNo) || "UNASSIGNED";
      if (!map.has(no)) map.set(no, []);
      map.get(no).push(r);
    });

    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "UNASSIGNED") return 1;
      if (b === "UNASSIGNED") return -1;
      return Number(a) - Number(b);
    });

    return keys.map((k) => {
      const rows = map.get(k);
      
      // For each hour/slot, take the MINIMUM production across all operations (bottleneck)
      const perHourTotals = (slots || []).map((s) => {
        let minProduction = Infinity;
        rows.forEach((row) => {
          const production = sumSewedForRowAtSlot(row, s.id);
          if (production < minProduction) {
            minProduction = production;
          }
        });
        return minProduction === Infinity ? 0 : minProduction;
      });
      
      // Total operator production = sum of bottleneck per hour across slots
      const operatorTotal = perHourTotals.reduce((sum, val) => sum + val, 0);
      
      return { 
        operatorNo: k, 
        rows, 
        operatorTotal, 
        perHourTotals
      };
    });
  }, [visibleRows, slots]);

  // Total sewed calculation using MIN per operator per hour
  const totalSewed = useMemo(() => {
    const operatorMap = new Map();
    computedRows.forEach((row) => {
      const operatorNo = normalizeNo(row.operatorNo);
      if (!operatorNo) return;
      if (!operatorMap.has(operatorNo)) operatorMap.set(operatorNo, []);
      operatorMap.get(operatorNo).push(row);
    });
    
    let total = 0;
    for (const rows of operatorMap.values()) {
      const perHourTotals = (slots || []).map((s) => {
        let minProduction = Infinity;
        rows.forEach((row) => {
          const production = sumSewedForRowAtSlot(row, s.id);
          if (production < minProduction) {
            minProduction = production;
          }
        });
        return minProduction === Infinity ? 0 : minProduction;
      });
      total += perHourTotals.reduce((sum, val) => sum + val, 0);
    }
    
    return total;
  }, [computedRows, slots]);

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      {/* History Modal */}
      {historyModal.open && (
        <CapacityHistoryModal
          operationId={historyModal.operationId}
          operationName={historyModal.operationName}
          operatorNo={historyModal.operatorNo}
          onClose={() => setHistoryModal({ open: false, operationId: null, operationName: "", operatorNo: "" })}
        />
      )}

      <div className="px-5 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Operaciones y seguimiento por hora</h2>
        <p className="text-sm text-gray-600">
          Consulta y edita los tiempos de las operaciones. La capacidad por hora se recalcula automáticamente.
          Los cambios de capacidad quedan registrados en el historial.
        </p>
      </div>

      {/* Controles de filtro */}
      <div className="px-5 py-4 border-b bg-gray-50">
        <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="w-full sm:w-72">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar operaciones..."
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              />
            </div>

            <div className="w-full sm:w-60">
              <select
                value={operatorFilterNo}
                onChange={(e) => setOperatorFilterNo(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="ALL">Todos los operadores</option>
                {operatorNoOptions.map((no) => (
                  <option key={no} value={no}>
                    Operador {no}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => {
                setSearchText("");
                setOperatorFilterNo("ALL");
              }}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
            >
              Restablecer filtros
            </button>
          </div>

          <div className="text-sm text-gray-600">
            Total cosido: <span className="font-semibold text-green-600">{totalSewed}</span>
          </div>
        </div>
      </div>

      {/* Mensaje de guardado */}
      {saveMessage && (
        <div className={`mx-5 mt-4 p-3 rounded-lg text-sm ${
          saveMessage.includes("✅") 
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {saveMessage}
        </div>
      )}

      {/* Grupos de operaciones */}
      <div className="p-5 space-y-6">
        {groups.length === 0 ? (
          <div className="rounded-xl border bg-gray-50 p-8 text-center text-gray-600">
            No se encontraron operaciones.
          </div>
        ) : (
          groups.map((g) => {
            const opNoLabel =
              g.operatorNo === "UNASSIGNED" ? "Sin asignar" : `Operador ${g.operatorNo}`;

            return (
              <div
                key={g.operatorNo}
                className="rounded-2xl border border-gray-200 overflow-hidden"
              >
                {/* Encabezado del operador */}
                <div className="px-5 py-4 bg-gray-50 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-gray-900">{opNoLabel}</div>
                    <div className="text-sm text-gray-600">
                      Nombre: {g.rows[0]?.operatorName || "No especificado"}
                    </div>
                  </div>

                  {/* Simple total display */}
                  <div className="text-sm text-gray-600 mb-3">
                    Total producido:{" "}
                    <span className="font-semibold text-green-600">{g.operatorTotal}</span>
                  </div>

                  {/* Totales por hora */}
                  {slots?.length > 0 && (
                    <div className="grid grid-cols-10 gap-1">
                      {slots.map((s, i) => (
                        <div key={s.id} className="text-center">
                          <div className="text-xs text-gray-500 font-medium mb-1">{s.label}</div>
                          <div className="text-sm font-semibold text-green-600 bg-white rounded border px-1 py-0.5">
                            {g.perHourTotals[i]}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lista de operaciones */}
                <div className="p-5 space-y-5">
                  {g.rows.map((row, idx) => {
                    const isEditing = editingRowId === row.id;
                    
                    return (
                      <div
                        key={row.id}
                        className="rounded-xl border border-gray-200 overflow-hidden"
                      >
                        <div className="p-4 bg-white border-b">
                          <div className="flex items-center justify-between mb-4">
                            <div className="font-semibold text-gray-900">
                              {row.operation || `Operación ${idx + 1}`}
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-medium text-blue-600">
                                Capacidad: {row.capPerOperator?.toFixed(2) || "0.00"}/hora
                              </div>
                              <button
                                onClick={() => showHistory(row)}
                                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 border border-gray-200 rounded-lg"
                                title="Ver historial de cambios de capacidad"
                              >
                                📋 Historial
                              </button>
                              {!isEditing ? (
                                <button
                                  onClick={() => startEditing(row.id)}
                                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 border border-gray-200 rounded-lg"
                                >
                                  Editar tiempos
                                </button>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => saveOperationChanges(row)}
                                    disabled={isSaving}
                                    className="text-sm bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50"
                                  >
                                    {isSaving ? "Guardando..." : "Guardar"}
                                  </button>
                                  <button
                                    onClick={cancelEditing}
                                    className="text-sm bg-gray-200 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-300"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Tiempos editables o de solo lectura */}
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                            {['t1', 't2', 't3', 't4', 't5'].map((field) => (
                              <div key={field}>
                                <div className="text-gray-500 mb-1">{field} (seg)</div>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={row[field] || ""}
                                    onChange={(e) => updateRowField(row.id, field, e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 px-2 py-1 focus:ring-2 focus:ring-blue-200 outline-none"
                                    placeholder="0.00"
                                  />
                                ) : (
                                  <div className="font-medium">{row[field] || "-"}</div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Mostrar capacidad recalculada cuando se está editando */}
                          {isEditing && (
                            <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                              <div className="text-sm text-blue-800">
                                Capacidad calculada: <span className="font-bold">{row.capPerOperator?.toFixed(2)}</span> piezas/hora
                              </div>
                              <div className="text-xs text-blue-600 mt-1">
                                * Al guardar, este cambio quedará registrado en el historial
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Tabla por hora para esta operación */}
                        <div className="p-4">
                          <HourlyGrid
                            target={target}
                            slots={slots}
                            stitched={row.sewed}
                            showStitchedInput={false}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}