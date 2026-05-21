import { useEffect, useState } from "react";
import MetaSummary from "./MetaSummary";
import ViewEditOperationPlanner from "./ViewEditOperationPlanner";
import AddOperatorModal from "./AddOperatorModal";
import EditWorkingHoursModal from "./EditWorkingHoursModal";
import DeleteOperatorModal from "./DeleteOperatorModal";
import EditEfficiencyModal from "./EditEfficiencyModal";
import EditOperatorModal from "./EditOperatorModal";
import OperatorCountEditModal from "./OperatorCountEditModal";
import EditShiftSlotsModal from "./EditShiftSlotsModal";

// Helper to ensure dates are compared as YYYY-MM-DD strings
const normalizeDate = (dateStr) => {
  if (!dateStr) return "";
  // If it's already YYYY-MM-DD, return it
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }
  } catch (e) {}
  return dateStr;
};

export default function SavedRunsViewer({ onBack }) {
  const [lineRuns, setLineRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runData, setRunData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showEditWorkingHours, setShowEditWorkingHours] = useState(false);
  const [isUpdatingWorkingHours, setIsUpdatingWorkingHours] = useState(false);
  const [message, setMessage] = useState("");
  const [activePanel, setActivePanel] = useState("select"); // select, summary, operations
  const [showEditEfficiency, setShowEditEfficiency] = useState(false);
  const [isUpdatingEfficiency, setIsUpdatingEfficiency] = useState(false);
  const [operatorToEdit, setOperatorToEdit] = useState(null);
  // Operators state
  const [operators, setOperators] = useState([]);
  const [showAddOperator, setShowAddOperator] = useState(false);
  const [operatorToDelete, setOperatorToDelete] = useState(null);

  // Copy dialog state
  const [copyDialog, setCopyDialog] = useState({ open: false, run: null });
  const [newDate, setNewDate] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);

  // Date filter state
  const [filterDate, setFilterDate] = useState("");

  const [showOperatorModal, setShowOperatorModal] = useState(false);

  const [showEditShiftSlots, setShowEditShiftSlots] = useState(false);
  const [isUpdatingShiftSlots, setIsUpdatingShiftSlots] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [runToDelete, setRunToDelete] = useState(null);
const [isDeleting, setIsDeleting] = useState(false);

  // Cargar todas las corridas guardadas
  useEffect(() => {
    fetchLineRuns();
  }, []);


  // Add delete handler function after handleCopyRun
const handleDeleteRun = async () => {
  if (!runToDelete) return;

  setIsDeleting(true);
  setMessage("");

  try {
    const token = localStorage.getItem("token");
    const response = await fetch(`http://localhost:5000/api/run/${runToDelete.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (data.success) {
      setMessage(`✅ ${data.message}`);
      setShowDeleteConfirm(false);
      setRunToDelete(null);
      
      // Refresh the runs list
      await fetchLineRuns();
      
      // If the deleted run was currently selected, clear selection
      if (selectedRun === runToDelete.id) {
        setSelectedRun(null);
        setRunData(null);
        setOperators([]);
        setActivePanel("select");
      }
    } else {
      setMessage(`❌ Error: ${data.error}`);
    }
  } catch (err) {
    setMessage(`❌ No se pudo eliminar la corrida: ${err.message}`);
  } finally {
    setIsDeleting(false);
  }
};

  const fetchLineRuns = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5000/api/line-runs", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();

      if (data.success) {
        setLineRuns(data.runs);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ No se pudieron cargar las corridas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch operators for the current run
  const fetchOperators = async (runId) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/run/${runId}/operators`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setOperators(data.operators);
      }
    } catch (err) {
      console.error("Error fetching operators:", err);
    }
  };

  const handleSelectRun = async (runId) => {
    setLoading(true);
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/run/${runId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();

      if (data.success) {
        setSelectedRun(runId);
        setRunData(data);
        await fetchOperators(runId);
        setActivePanel("summary");
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ No se pudo cargar la corrida: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle operator added
  const handleOperatorAdded = (newOperator) => {
    setOperators([...operators, { ...newOperator, operations_count: 0 }]);
    setMessage(`✅ Operador ${newOperator.operator_no} agregado correctamente`);
    // Refresh the run data to get updated operations
    if (selectedRun) {
      handleSelectRun(selectedRun);
    }
  };

  const handleOperatorUpdate = (updatedData) => {
    // Fix: update nested run object properly
    setRunData({
      ...runData,
      run: {
        ...runData.run,
        operators_count: updatedData.operatorsCount,
        target_pcs: updatedData.newTarget,
        target_per_hour: updatedData.newTargetPerHour,
      }
    });
  };

  const handleUpdateWorkingHours = async (newWorkingHours) => {
    if (!selectedRun) return;

    setIsUpdatingWorkingHours(true);
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/update-working-hours/${selectedRun}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workingHours: newWorkingHours }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage(`✅ Horas de trabajo actualizadas. Nueva meta: ${data.newTarget.toFixed(2)} piezas`);
        setShowEditWorkingHours(false);
        
        // Refresh the run data to show updated values
        await handleSelectRun(selectedRun);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Error al actualizar: ${err.message}`);
    } finally {
      setIsUpdatingWorkingHours(false);
    }
  };

  const handleUpdateShiftSlots = async (updatedSlots) => {
    if (!selectedRun) return;

    setIsUpdatingShiftSlots(true);
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/update-shift-slots/${selectedRun}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ slots: updatedSlots }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage(`✅ Distribución de turnos actualizada. Nueva meta: ${data.newTarget.toFixed(2)} piezas`);
        setShowEditShiftSlots(false);
        
        // Refresh the run data to show updated values
        await handleSelectRun(selectedRun);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Error al actualizar: ${err.message}`);
    } finally {
      setIsUpdatingShiftSlots(false);
    }
  };

  const handleOperatorUpdated = (updatedOperator) => {
    setOperators(operators.map(op => 
      op.id === updatedOperator.id ? updatedOperator : op
    ));
    setMessage(`✅ Operador actualizado correctamente`);
    // Refresh the run data to get updated operations
    if (selectedRun) {
      handleSelectRun(selectedRun);
    }
  };

  const handleUpdateEfficiency = async (newEfficiency) => {
    if (!selectedRun) return;

    setIsUpdatingEfficiency(true);
    setMessage("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/update-efficiency/${selectedRun}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ efficiency: newEfficiency }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage(`✅ Eficiencia actualizada. Nueva meta: ${data.newTarget.toFixed(2)} piezas`);
        setShowEditEfficiency(false);
        
        // Refresh the run data to show updated values
        await handleSelectRun(selectedRun);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Error al actualizar: ${err.message}`);
    } finally {
      setIsUpdatingEfficiency(false);
    }
  };

  // Handle operator deleted
  const handleOperatorDeleted = (deletedOperatorId) => {
    setOperators(operators.filter(op => op.id !== deletedOperatorId));
    setMessage(`✅ Operador eliminado correctamente`);
    // Refresh the run data to get updated operations
    if (selectedRun) {
      handleSelectRun(selectedRun);
    }
  };

  // Convertir slots de BD a formato frontend
  const getSlotsFromData = () => {
    if (!runData?.slots) return [];

    return runData.slots.map((slot) => ({
      id: slot.id,  // Database ID - important for updates
      label: slot.slot_label,
      hours: parseFloat(slot.planned_hours),
      startTime: slot.slot_start,
      endTime: slot.slot_end,
    }));
  };

  // Convertir operaciones de BD a formato rows del frontend
  // In SavedRunsViewer.jsx - REPLACE the getRowsFromData function
const getRowsFromData = () => {
  if (!runData?.operations) return [];

  // Create mapping from slot_label to slot_id
  const slotLabelToId = {};
  if (runData?.slots) {
    runData.slots.forEach(slot => {
      slotLabelToId[slot.slot_label] = slot.id;
    });
  }

  const rows = [];

  runData.operations.forEach((opGroup) => {
    opGroup.operations.forEach((op) => {
      const stitched = {};
      const sewed = {};

      // Get planned/stitched data - map from label to ID
      if (op.stitched_data && typeof op.stitched_data === 'object') {
        Object.entries(op.stitched_data).forEach(([slotLabel, qty]) => {
          if (slotLabel && slotLabel !== '') {
            const slotId = slotLabelToId[slotLabel];
            if (slotId) {
              stitched[slotId] = qty;
            }
          }
        });
      }

      // Get actual/sewed data from line leader - map from label to ID
      if (op.sewed_data && typeof op.sewed_data === 'object') {
        Object.entries(op.sewed_data).forEach(([slotLabel, qty]) => {
          if (slotLabel && slotLabel !== '') {
            const slotId = slotLabelToId[slotLabel];
            if (slotId) {
              sewed[slotId] = qty;
            }
          }
        });
      }

      rows.push({
        id: `db_${op.id}`,
        operatorNo: opGroup.operator.operator_no.toString(),
        operatorName: opGroup.operator.operator_name || "",
        operation: op.operation_name,
        t1: op.t1_sec?.toString() || "",
        t2: op.t2_sec?.toString() || "",
        t3: op.t3_sec?.toString() || "",
        t4: op.t4_sec?.toString() || "",
        t5: op.t5_sec?.toString() || "",
        capPerOperator: parseFloat(op.capacity_per_hour) || 0,
        stitched,
        sewed,
      });
    });
  });

  return rows;
};

  // Metas por slot
  const getSlotTargets = () => {
    if (!runData?.slotTargets) return [];
    return runData.slotTargets.map((st) => parseFloat(st.slot_target) || 0);
  };

  const getCumulativeTargets = () => {
    if (!runData?.slotTargets) return [];
    return runData.slotTargets.map((st) => parseFloat(st.cumulative_target) || 0);
  };

  // --- Copy / Duplicate handler ---
  const handleCopyRun = async () => {
    if (!copyDialog.run || !newDate) return;

    setCopyLoading(true);
    setMessage("");
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/duplicate-run/${copyDialog.run.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newDate }),
      });

      const data = await response.json();
      if (data.success) {
        setMessage(`✅ Corrida duplicada correctamente. Nuevo ID: ${data.newRunId}`);
        setCopyDialog({ open: false, run: null });
        setNewDate("");
        await fetchLineRuns();
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ No se pudo duplicar: ${err.message}`);
    } finally {
      setCopyLoading(false);
    }
  };

  // Filtrar runs por fecha seleccionada
  const filteredRuns = filterDate
    ? lineRuns.filter((run) => normalizeDate(run.run_date) === normalizeDate(filterDate))
    : lineRuns;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ver corridas guardadas</h1>
          <p className="text-sm text-gray-600">
            Selecciona una corrida guardada para ver la información
          </p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl px-4 py-2 text-sm font-medium border border-gray-200 hover:bg-gray-50"
        >
          ← Regresar al planificador
        </button>
      </div>

      {/* Mensajes */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      {/* Panel de selección */}
      {activePanel === "select" && (
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b">
            <h2 className="font-semibold text-gray-900">Seleccionar corrida de línea</h2>
            <p className="text-sm text-gray-600">
              Elige una corrida de producción guardada para ver
            </p>
          </div>

          <div className="p-5">
            {/* Filtro por fecha */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-64">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Filtrar por fecha"
                />
              </div>
              {filterDate && (
                <button
                  onClick={() => setFilterDate("")}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Limpiar filtro
                </button>
              )}
              <span className="text-sm text-gray-600">
                {filteredRuns.length} corrida(s) encontrada(s)
              </span>
            </div>

            {filteredRuns.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                {filterDate
                  ? `No hay corridas para la fecha ${filterDate}`
                  : "No se encontraron corridas guardadas. Primero guarda una corrida desde el planificador."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRuns.map((run) => (
  <div
    key={run.id}
    className="rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:bg-gray-50 transition flex flex-col h-full"
  >
    <div 
      className="flex-grow cursor-pointer"
      onClick={() => handleSelectRun(run.id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-gray-900">{run.line_no}</div>
        <div className="text-xs text-gray-500">
          {new Date(run.run_date).toLocaleDateString()}
        </div>
      </div>
      <div className="text-sm text-gray-600 mb-1">Estilo: {run.style}</div>
      <div className="text-sm text-gray-600 mb-1">Operadores: {run.operators_count}</div>
      <div className="text-sm text-gray-600">Meta: {run.target_pcs} pzas</div>
      <div className="mt-3 text-xs text-gray-500">
        Creado: {new Date(run.created_at).toLocaleString()}
      </div>
    </div>

    {/* Action Buttons */}
    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end gap-3">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setCopyDialog({ open: true, run });
          setNewDate("");
        }}
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        📋 Copiar
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setRunToDelete(run);
          setShowDeleteConfirm(true);
        }}
        className="text-sm text-red-600 hover:text-red-800 font-medium"
      >
        🗑️ Eliminar
      </button>
    </div>
  </div>
))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de copia */}
      {copyDialog.open && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Duplicar corrida
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Copiar línea {copyDialog.run?.line_no} – {copyDialog.run?.style} a una nueva fecha.
            </p>
            <label className="block mb-4">
              <span className="text-sm font-medium text-gray-700">Nueva fecha</span>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setCopyDialog({ open: false, run: null })}
                className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCopyRun}
                disabled={!newDate || copyLoading}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50"
              >
                {copyLoading ? "Copiando..." : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
{showDeleteConfirm && runToDelete && (
  <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Confirmar eliminación
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        ¿Estás seguro de que deseas eliminar esta corrida?
      </p>
      <div className="bg-gray-50 p-3 rounded-lg mb-4">
        <p className="text-sm font-medium text-gray-900">Línea: {runToDelete.line_no}</p>
        <p className="text-sm text-gray-600">Estilo: {runToDelete.style}</p>
        <p className="text-sm text-gray-600">Fecha: {new Date(runToDelete.run_date).toLocaleDateString()}</p>
      </div>
      <p className="text-xs text-red-600 mb-4">
        ⚠️ Esta acción eliminará permanentemente la corrida, incluyendo todos los operadores,
        operaciones, metas horarias y datos de producción asociados. No se puede deshacer.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => {
            setShowDeleteConfirm(false);
            setRunToDelete(null);
          }}
          className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleDeleteRun}
          disabled={isDeleting}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
        >
          {isDeleting ? "Eliminando..." : "Sí, eliminar"}
        </button>
      </div>
    </div>
  </div>
)}

      {/* Vista de detalles */}
      {activePanel !== "select" && runData && (
        <div className="space-y-6">
          {/* Encabezado de la corrida */}
          <div className="rounded-2xl border bg-white shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {runData.run.line_no} • {runData.run.style}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-800">
                    {new Date(runData.run.run_date).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Operadores: {runData.run.operators_count}</span>
                    <button
                      onClick={() => setShowOperatorModal(true)}
                      className="ml-1 text-blue-600 hover:text-blue-800"
                      title="Editar número de operadores"
                    >
                      ✎
                    </button>
                  </div>
                  <span className="flex items-center gap-1">
                    Horas trabajadas: {runData.run.working_hours}
                    <button
                      onClick={() => setShowEditShiftSlots(true)}
                      className="ml-1 text-blue-600 hover:text-blue-800"
                      title="Editar distribución de horas y descansos"
                    >
                      ✎
                    </button>
                  </span>
                  <span>SAM: {runData.run.sam_minutes} min</span>
                  <span className="flex items-center gap-1">
                    Eficiencia: {Math.round(runData.run.efficiency * 100)}%
                    <button
                      onClick={() => setShowEditEfficiency(true)}
                      className="ml-1 text-blue-600 hover:text-blue-800"
                      title="Editar eficiencia"
                    >
                      ✎
                    </button>
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setActivePanel("summary")}
                  className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                    activePanel === "summary"
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Resumen
                </button>
                <button
                  onClick={() => setActivePanel("operations")}
                  className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                    activePanel === "operations"
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-800 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  Operaciones
                </button>
                <button
                  onClick={() => {
                    setActivePanel("select");
                    setSelectedRun(null);
                    setRunData(null);
                    setOperators([]);
                  }}
                  className="rounded-xl px-4 py-2 text-sm font-medium border border-gray-200 hover:bg-gray-50"
                >
                  Regresar a la lista
                </button>
              </div>
            </div>
          </div>

          {/* Panel de resumen */}
          {activePanel === "summary" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MetaSummary
                  header={{
                    line: runData.run.line_no,
                    date: runData.run.run_date,
                    style: runData.run.style,
                    operators: runData.run.operators_count.toString(),
                    workingHours: runData.run.working_hours.toString(),
                    sam: runData.run.sam_minutes.toString(),
                    efficiency: runData.run.efficiency,
                  }}
                  target={parseFloat(runData.run.target_pcs)}
                  slots={getSlotsFromData()}
                />
              </div>

              {/* Lista de operadores con opciones de agregar/eliminar */}
              <div className="rounded-2xl border bg-white shadow-sm">
                <div className="px-5 py-4 border-b flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">Operadores asignados</h2>
                    <p className="text-sm text-gray-600">
                      {operators.length || 0} operador(es) asignado(s)
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddOperator(true)}
                    className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-xl hover:bg-gray-800"
                  >
                    + Agregar operador
                  </button>
                </div>

                <div className="p-5 max-h-[500px] overflow-y-auto">
                  {operators && operators.length > 0 ? (
                    <div className="space-y-3">
                      {operators.map((operator) => (
                        <div key={operator.id} className="rounded-lg border border-gray-200 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              Operador {operator.operator_no}
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setOperatorToEdit(operator)}
                                className="text-blue-600 hover:text-blue-800"
                                title="Editar operador"
                              >
                                ✎
                              </button>
                              <div className="text-sm text-gray-600">
                                {operator.operations_count || 0} operaciones
                              </div>
                              <button
                                onClick={() => setOperatorToDelete(operator)}
                                className="text-red-600 hover:text-red-800"
                                title="Eliminar operador"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          {operator.operator_name && (
                            <div className="text-sm text-gray-600 mb-3">
                              Nombre: {operator.operator_name}
                            </div>
                          )}

                          <button
                            onClick={() => setActivePanel("operations")}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            Ver operaciones →
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-600">
                      Todavía no hay operadores asignados
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Panel de operaciones */}
          {activePanel === "operations" && (
            <div>
              <div className="mb-4 rounded-2xl border bg-white shadow-sm p-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="font-semibold text-gray-900">Operaciones por operador</h2>
                    <p className="text-sm text-gray-600">
                      Consulta las operaciones y la producción por hora (solo lectura)
                    </p>
                  </div>
                </div>
              </div>

              <ViewEditOperationPlanner
                runId={selectedRun}
                target={parseFloat(runData.run.target_pcs)}
                slots={getSlotsFromData()}
                initialRows={getRowsFromData()}
                slotTargets={getSlotTargets()}
                cumulativeTargets={getCumulativeTargets()}
              />
            </div>
          )}
        </div>
      )}

      {showOperatorModal && (
        <OperatorCountEditModal
          runId={runData?.run?.id}
          currentCount={runData?.run?.operators_count}
          onClose={() => setShowOperatorModal(false)}
          onUpdate={handleOperatorUpdate}
        />
      )}

      {/* Add Operator Modal */}
      {showAddOperator && selectedRun && (
        <AddOperatorModal
          runId={selectedRun}
          slots={getSlotsFromData()}
          onClose={() => setShowAddOperator(false)}
          onOperatorAdded={handleOperatorAdded}
        />
      )}

      {/* Delete Operator Modal */}
      {operatorToDelete && (
        <DeleteOperatorModal
          operator={{ ...operatorToDelete, run_id: selectedRun }}
          onClose={() => setOperatorToDelete(null)}
          onOperatorDeleted={handleOperatorDeleted}
        />
      )}

      {/* Edit Working Hours Modal */}
      <EditWorkingHoursModal
        isOpen={showEditWorkingHours}
        onClose={() => setShowEditWorkingHours(false)}
        currentWorkingHours={runData?.run?.working_hours}
        onSave={handleUpdateWorkingHours}
        isSaving={isUpdatingWorkingHours}
      />

      {/* Edit Efficiency Modal */}
      <EditEfficiencyModal
        isOpen={showEditEfficiency}
        onClose={() => setShowEditEfficiency(false)}
        currentEfficiency={runData?.run?.efficiency}
        onSave={handleUpdateEfficiency}
        isSaving={isUpdatingEfficiency}
      />

      {/* Edit Operator Modal */}
      {operatorToEdit && (
        <EditOperatorModal
          operator={operatorToEdit}
          runId={selectedRun}
          onClose={() => setOperatorToEdit(null)}
          onOperatorUpdated={handleOperatorUpdated}
        />
      )}

      {/* Edit Shift Slots Modal */}
      <EditShiftSlotsModal
        isOpen={showEditShiftSlots}
        onClose={() => setShowEditShiftSlots(false)}
        slots={getSlotsFromData()}
        onSave={handleUpdateShiftSlots}
        isSaving={isUpdatingShiftSlots}
      />
    </div>
  );
}