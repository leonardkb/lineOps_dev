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
  // Work orders assigned to the copied line for the chosen date
  const [copyWorkOrders, setCopyWorkOrders] = useState([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState("");
  const [loadingCopyWorkOrders, setLoadingCopyWorkOrders] = useState(false);

  // Date filter state
  const [filterDate, setFilterDate] = useState("");
  // Line number and style filter state
  const [filterLine, setFilterLine] = useState("");
  const [filterStyle, setFilterStyle] = useState("");

  const [showOperatorModal, setShowOperatorModal] = useState(false);

  const [showEditShiftSlots, setShowEditShiftSlots] = useState(false);
  const [isUpdatingShiftSlots, setIsUpdatingShiftSlots] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
const [runToDelete, setRunToDelete] = useState(null);
const [isDeleting, setIsDeleting] = useState(false);

// Multi-select delete state
const [selectMode, setSelectMode] = useState(false);
const [selectedIds, setSelectedIds] = useState(() => new Set());
const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
const [bulkDeleting, setBulkDeleting] = useState(false);
const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  // Cargar todas las corridas guardadas
  useEffect(() => {
    fetchLineRuns();
  }, []);

  // Cargar las órdenes de trabajo asignadas a la línea para la fecha elegida
  // cada vez que se abre el diálogo de copia o cambia la fecha.
  useEffect(() => {
    if (!copyDialog.open || !copyDialog.run || !newDate) {
      setCopyWorkOrders([]);
      setSelectedWorkOrderId("");
      return;
    }

    let cancelled = false;
    const loadCopyWorkOrders = async () => {
      setLoadingCopyWorkOrders(true);
      try {
        const token = localStorage.getItem("token");
        const params = new URLSearchParams({
          line: String(copyDialog.run.line_no),
          date: normalizeDate(newDate),
        });
        const response = await fetch(`http://localhost:5000/api/planning/line-work-orders?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (cancelled) return;
        if (data.success) {
          setCopyWorkOrders(data.workOrders || []);
          // Preseleccionar si sólo hay una orden asignada ese día
          if ((data.workOrders || []).length === 1) {
            setSelectedWorkOrderId(String(data.workOrders[0].work_order_id));
          } else {
            setSelectedWorkOrderId("");
          }
        } else {
          setCopyWorkOrders([]);
          setSelectedWorkOrderId("");
        }
      } catch (err) {
        if (!cancelled) {
          setCopyWorkOrders([]);
          setSelectedWorkOrderId("");
        }
      } finally {
        if (!cancelled) setLoadingCopyWorkOrders(false);
      }
    };

    loadCopyWorkOrders();
    return () => {
      cancelled = true;
    };
  }, [copyDialog.open, copyDialog.run, newDate]);


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

// Entrar/salir del modo selección múltiple
const toggleSelectMode = () => {
  setSelectMode((prev) => {
    if (prev) setSelectedIds(new Set()); // limpiar al salir
    return !prev;
  });
};

// Marcar/desmarcar una corrida
const toggleRunSelection = (runId) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    return next;
  });
};

// Seleccionar/deseleccionar todas las corridas visibles (filtradas)
const toggleSelectAll = (runs) => {
  setSelectedIds((prev) => {
    const allSelected = runs.length > 0 && runs.every((r) => prev.has(r.id));
    if (allSelected) return new Set();
    return new Set(runs.map((r) => r.id));
  });
};

// Eliminar en lote: reutiliza el endpoint individual DELETE /api/run/:id
const handleBulkDelete = async () => {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return;

  setBulkDeleting(true);
  setMessage("");
  setBulkProgress({ done: 0, total: ids.length });

  const token = localStorage.getItem("token");
  const failed = [];
  let done = 0;

  for (const id of ids) {
    try {
      const response = await fetch(`http://localhost:5000/api/run/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) failed.push({ id, error: data.error });
    } catch (err) {
      failed.push({ id, error: err.message });
    } finally {
      done += 1;
      setBulkProgress({ done, total: ids.length });
    }
  }

  const deletedCount = ids.length - failed.length;
  if (failed.length === 0) {
    setMessage(`✅ ${deletedCount} corrida(s) eliminada(s) correctamente.`);
  } else {
    setMessage(
      `⚠️ ${deletedCount} eliminada(s), ${failed.length} fallaron. Primer error: ${failed[0].error}`
    );
  }

  // Si la corrida abierta fue eliminada, limpiar la vista
  if (selectedRun && selectedIds.has(selectedRun)) {
    setSelectedRun(null);
    setRunData(null);
    setOperators([]);
    setActivePanel("select");
  }

  await fetchLineRuns();
  setShowBulkDeleteConfirm(false);
  setBulkDeleting(false);
  setSelectMode(false);
  setSelectedIds(new Set());
  setBulkProgress({ done: 0, total: 0 });
};

  // Confirmar un borrador: quita la marca is_draft y lo vuelve una corrida
  // normal. El borrador lo crea el planificador al asignar una orden a una
  // línea que ingeniería aún no había configurado ese día.
  const [confirmingId, setConfirmingId] = useState(null);
  const handleConfirmDraft = async (run) => {
    if (!run) return;
    setConfirmingId(run.id);
    setMessage("");
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/run/${run.id}/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setMessage(`✅ Corrida de la línea ${run.line_no} confirmada.`);
        await fetchLineRuns();
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ No se pudo confirmar la corrida: ${err.message}`);
    } finally {
      setConfirmingId(null);
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
        body: JSON.stringify({
          newDate,
          workOrderId: selectedWorkOrderId ? parseInt(selectedWorkOrderId, 10) : null,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setMessage(`✅ Corrida duplicada correctamente. Nuevo ID: ${data.newRunId}`);
        setCopyDialog({ open: false, run: null });
        setNewDate("");
        setCopyWorkOrders([]);
        setSelectedWorkOrderId("");
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

  // Opciones distintas de línea y estilo a partir de las corridas cargadas
  const lineOptions = Array.from(
    new Set(lineRuns.map((run) => run.line_no).filter((v) => v != null && v !== ""))
  ).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const styleOptions = Array.from(
    new Set(lineRuns.map((run) => run.style).filter((v) => v != null && v !== ""))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  // Filtrar runs por fecha, línea y estilo (todos combinables)
  const filteredRuns = lineRuns.filter((run) => {
    if (filterDate && normalizeDate(run.run_date) !== normalizeDate(filterDate)) return false;
    if (filterLine && String(run.line_no) !== String(filterLine)) return false;
    if (filterStyle && String(run.style) !== String(filterStyle)) return false;
    return true;
  });

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
            {/* Filtros: fecha, línea y estilo */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-56">
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                  placeholder="Filtrar por fecha"
                />
              </div>
              <div className="w-full sm:w-48">
                <select
                  value={filterLine}
                  onChange={(e) => setFilterLine(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 bg-white"
                >
                  <option value="">Todas las líneas</option>
                  {lineOptions.map((line) => (
                    <option key={line} value={line}>
                      Línea {line}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full sm:w-48">
                <select
                  value={filterStyle}
                  onChange={(e) => setFilterStyle(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 bg-white"
                >
                  <option value="">Todos los estilos</option>
                  {styleOptions.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </div>
              {(filterDate || filterLine || filterStyle) && (
                <button
                  onClick={() => {
                    setFilterDate("");
                    setFilterLine("");
                    setFilterStyle("");
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Limpiar filtros
                </button>
              )}
              <span className="text-sm text-gray-600">
                {filteredRuns.length} corrida(s) encontrada(s)
              </span>

              {/* Controles de selección múltiple */}
              <div className="ml-auto flex flex-wrap items-center gap-3">
                {!selectMode ? (
                  <button
                    onClick={toggleSelectMode}
                    disabled={filteredRuns.length === 0}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Seleccionar
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSelectAll(filteredRuns)}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      {filteredRuns.length > 0 && filteredRuns.every((r) => selectedIds.has(r.id))
                        ? "Deseleccionar todo"
                        : "Seleccionar todo"}
                    </button>
                    <button
                      onClick={() => setShowBulkDeleteConfirm(true)}
                      disabled={selectedIds.size === 0}
                      className="rounded-xl bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      🗑️ Eliminar seleccionadas ({selectedIds.size})
                    </button>
                    <button
                      onClick={toggleSelectMode}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                  </>
                )}
              </div>
            </div>

            {filteredRuns.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                {filterDate || filterLine || filterStyle
                  ? "No hay corridas que coincidan con los filtros seleccionados."
                  : "No se encontraron corridas guardadas. Primero guarda una corrida desde el planificador."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRuns.map((run) => {
  const isSelected = selectedIds.has(run.id);
  return (
  <div
    key={run.id}
    className={`rounded-xl border p-4 transition flex flex-col h-full ${
      selectMode && isSelected
        ? "border-red-400 ring-2 ring-red-200 bg-red-50/40"
        : run.is_draft
        ? "border-amber-300 bg-amber-50/40 hover:border-amber-400"
        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
    }`}
  >
    <div
      className="flex-grow cursor-pointer"
      onClick={() =>
        selectMode ? toggleRunSelection(run.id) : handleSelectRun(run.id)
      }
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {selectMode && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleRunSelection(run.id)}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
          )}
          <div className="font-semibold text-gray-900">{run.line_no}</div>
          {run.is_draft && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">Borrador</span>
          )}
        </div>
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

    {/* Action Buttons — se ocultan en modo selección */}
    {!selectMode && (
    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-end gap-3">
      {run.is_draft && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleConfirmDraft(run);
          }}
          disabled={confirmingId === run.id}
          className="text-sm text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
        >
          {confirmingId === run.id ? "Confirmando..." : "✅ Confirmar"}
        </button>
      )}
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
    )}
  </div>
  );
})}
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

            {/* Orden de trabajo asignada a la línea para esa fecha */}
            <label className="block mb-4">
              <span className="text-sm font-medium text-gray-700">
                Orden de trabajo asignada
              </span>
              <select
                value={selectedWorkOrderId}
                onChange={(e) => setSelectedWorkOrderId(e.target.value)}
                disabled={!newDate || loadingCopyWorkOrders}
                className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {loadingCopyWorkOrders ? "Cargando..." : "Sin orden de trabajo"}
                </option>
                {copyWorkOrders.map((wo) => (
                  <option key={wo.assignment_id || wo.work_order_id} value={wo.work_order_id}>
                    {wo.work_order_no}
                    {wo.estilo ? ` – ${wo.estilo}` : ""}
                    {wo.color ? ` (${wo.color})` : ""}
                    {wo.assigned_quantity != null ? ` · ${wo.assigned_quantity} pzas` : ""}
                  </option>
                ))}
              </select>
              {!newDate ? (
                <span className="mt-1 block text-xs text-gray-500">
                  Elige una fecha para ver las órdenes asignadas a la línea.
                </span>
              ) : !loadingCopyWorkOrders && copyWorkOrders.length === 0 ? (
                <span className="mt-1 block text-xs text-amber-600">
                  No hay órdenes de trabajo asignadas a la línea {copyDialog.run?.line_no} en esa fecha.
                </span>
              ) : null}
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setCopyDialog({ open: false, run: null });
                  setNewDate("");
                  setCopyWorkOrders([]);
                  setSelectedWorkOrderId("");
                }}
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

{/* Modal de confirmación de eliminación en lote */}
{showBulkDeleteConfirm && (
  <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Eliminar varias corridas
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        Vas a eliminar <span className="font-semibold">{selectedIds.size}</span> corrida(s).
      </p>
      <p className="text-xs text-red-600 mb-4">
        ⚠️ Esta acción eliminará permanentemente cada corrida seleccionada, incluyendo todos
        los operadores, operaciones, metas horarias y datos de producción asociados. No se
        puede deshacer.
      </p>
      {bulkDeleting && (
        <p className="text-sm text-gray-600 mb-4">
          Eliminando {bulkProgress.done} de {bulkProgress.total}...
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setShowBulkDeleteConfirm(false)}
          disabled={bulkDeleting}
          className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleBulkDelete}
          disabled={bulkDeleting}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
        >
          {bulkDeleting ? "Eliminando..." : `Sí, eliminar ${selectedIds.size}`}
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
                    workOrderNo: runData.run.work_order_no,
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