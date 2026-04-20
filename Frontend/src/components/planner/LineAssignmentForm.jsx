// components/planner/LineAssignmentForm.jsx - COMPLETELY FIXED VERSION
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar, AlertCircle, CheckCircle, Calculator, Plus, Trash2, Layers } from "lucide-react";

export default function LineAssignmentForm({ workOrder, onAssignmentComplete }) {
  const [availableLines, setAvailableLines] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [existingAssignments, setExistingAssignments] = useState([]);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [capacitySource, setCapacitySource] = useState(null);
  const [capacityDate, setCapacityDate] = useState(null);

  // FIXED: Get total to produce - priority: quantity > total_to_produce > totalToProduce
  const getTotalToProduce = () => {
    // Log the workOrder to debug
    console.log("🔍 WorkOrder received:", {
      id: workOrder?.id,
      work_order_no: workOrder?.work_order_no,
      quantity: workOrder?.quantity,
      total_to_produce: workOrder?.total_to_produce,
      totalToProduce: workOrder?.totalToProduce
    });
    
    // Try different field names that might contain the total quantity
    const total = workOrder?.quantity || 
                  workOrder?.total_to_produce || 
                  workOrder?.totalToProduce || 
                  0;
    return typeof total === 'number' ? total : parseFloat(total) || 0;
  };

  // Initialize with one empty assignment slot
  useEffect(() => {
    setAssignments([{
      id: Date.now(),
      lineNo: "",
      quantity: 0,
      lineData: null,
      daysInfo: null
    }]);
  }, []);

  useEffect(() => {
    fetchAvailableLines();
    fetchExistingAssignments();
  }, [selectedDate]);

  // Add this at the top of your LineAssignmentForm component
useEffect(() => {
  console.log("🎯 Current Work Order:", {
    id: workOrder?.id,
    work_order_no: workOrder?.work_order_no,
    quantity: workOrder?.quantity
  });
}, [workOrder]);

  const fetchAvailableLines = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/available-lines?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setAvailableLines(data.lines);
        setCapacitySource(data.capacitySource || 'exact');
        setCapacityDate(data.capacityDate || selectedDate);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchExistingAssignments = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/line-assignments?workOrderId=${workOrder.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        // Only keep active assignments — exclude cancelled/rejected
        const active = data.assignments.filter(
          a => !['cancelled', 'rejected'].includes(a.status)
        );
        setExistingAssignments(active);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    }
  };

  // Calculate days needed for a specific line and quantity
  const calculateDaysNeeded = (lineData, quantity) => {
    if (!lineData || !quantity || quantity <= 0) return null;
    
    const qty = quantity;
    const samMinutes = parseFloat(lineData.sam_minutes) || 3.5;
    const operators = parseInt(lineData.operators_count) || 20;
    const workingHours = parseFloat(lineData.working_hours) || 8;
    const efficiency = parseFloat(lineData.efficiency) || 0.85;
    
    const totalMinutesNeeded = qty * samMinutes;
    const dailyAvailableMinutes = operators * workingHours * 60;
    const effectiveDailyMinutes = dailyAvailableMinutes * efficiency;
    const rawDaysNeeded = totalMinutesNeeded / effectiveDailyMinutes;
    const daysNeeded = Math.ceil(rawDaysNeeded);
    
    const piecesPerDay = effectiveDailyMinutes / samMinutes;
    const piecesPerHour = piecesPerDay / workingHours;
    
    const startDate = new Date(selectedDate);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + daysNeeded);
    
    return {
      daysNeeded,
      rawDaysNeeded: Math.round(rawDaysNeeded * 10) / 10,
      startDate: format(startDate, "dd/MM/yyyy"),
      endDate: format(endDate, "dd/MM/yyyy"),
      dailyRate: Math.floor(piecesPerDay),
      hourlyRate: Math.floor(piecesPerHour),
      totalMinutesNeeded: Math.round(totalMinutesNeeded),
      effectiveDailyMinutes: Math.round(effectiveDailyMinutes),
      minutesPerPiece: Math.round((samMinutes / efficiency) * 100) / 100,
      efficiency: Math.round(efficiency * 100),
      quantity: qty
    };
  };

  const handleAddAssignment = () => {
    setAssignments([...assignments, {
      id: Date.now(),
      lineNo: "",
      quantity: 0,
      lineData: null,
      daysInfo: null
    }]);
  };

  const handleRemoveAssignment = (id) => {
    if (assignments.length === 1) {
      setError("Debe tener al menos una asignación");
      return;
    }
    setAssignments(assignments.filter(a => a.id !== id));
  };

  // Helper to get max available for a line
  const getMaxAvailableForLineInternal = (lineNo, excludeAssignmentId = null) => {
    const line = availableLines.find(l => l.line_no === lineNo);
    if (!line) return 0;
    
    let maxAvailable = line.available_capacity;
    
    // Subtract other assignments from the current session
    const otherAssignmentsToSameLine = assignments
      .filter(a => a.lineNo === lineNo && a.quantity && a.id !== excludeAssignmentId)
      .reduce((sum, a) => sum + (a.quantity || 0), 0);
    
    maxAvailable = maxAvailable - otherAssignmentsToSameLine;
    
    return Math.max(0, maxAvailable);
  };

  // FIXED: Get total to assign in current session
  const getTotalToAssignInternal = () => {
    return assignments.reduce((sum, a) => sum + (a.quantity || 0), 0);
  };

  // FIXED: Get already assigned — existingAssignments is pre-filtered (no cancelled)
  const getAlreadyAssignedInternal = () => {
    return existingAssignments.reduce(
      (sum, a) => sum + (parseFloat(a.assigned_quantity) || 0), 0
    );
  };

  // FIXED: Get remaining to assign (total - already saved in DB)
  const getRemainingToAssignInternal = () => {
    const totalToProduce = getTotalToProduce();
    const alreadyAssigned = getAlreadyAssignedInternal();
    return Math.max(0, totalToProduce - alreadyAssigned);
  };

  const handleAssignmentChange = (id, field, value) => {
    setAssignments(prev => prev.map(assignment => {
      if (assignment.id === id) {
        const updated = { ...assignment };
        
        if (field === 'lineNo') {
          const selectedLine = availableLines.find(l => l.line_no === value);
          updated.lineNo = value;
          updated.lineData = selectedLine;
          updated.quantity = 0;
          updated.daysInfo = null;
          setError("");
        }
        
        if (field === 'quantity') {
          let qty = parseInt(value);
          if (isNaN(qty)) qty = 0;
          if (qty < 0) qty = 0;
          
          // Check against max available for this line
          if (updated.lineData) {
            const maxAvailable = getMaxAvailableForLineInternal(updated.lineNo, id);
            if (qty > maxAvailable && maxAvailable > 0) {
              qty = maxAvailable;
              setError(`⚠️ Línea ${updated.lineNo}: Solo tiene capacidad para ${Math.floor(maxAvailable).toLocaleString()} piezas en esta fecha.`);
              setTimeout(() => setError(""), 3000);
            }
          }
          
          // Check against remaining to assign
          const remaining = getRemainingToAssignInternal();
          const currentTotalWithoutThis = getTotalToAssignInternal() - (updated.quantity || 0);
          if (currentTotalWithoutThis + qty > remaining) {
            qty = Math.max(0, remaining - currentTotalWithoutThis);
            if (qty > 0 && qty !== parseInt(value)) {
              setError(`⚠️ Solo quedan ${remaining.toLocaleString()} piezas pendientes por asignar.`);
              setTimeout(() => setError(""), 3000);
            }
          }
          
          updated.quantity = qty;
          
          // Update days info
          if (updated.lineData && qty > 0) {
            updated.daysInfo = calculateDaysNeeded(updated.lineData, qty);
          } else {
            updated.daysInfo = null;
          }
        }
        
        return updated;
      }
      return assignment;
    }));
  };

  const handleSubmitAssignments = async () => {
    const validAssignments = assignments.filter(a => a.lineNo && a.quantity > 0);
    
    if (validAssignments.length === 0) {
      setError("Por favor complete al menos una asignación válida");
      return;
    }
    
    const totalToAssign = getTotalToAssignInternal();
    const remainingToAssign = getRemainingToAssignInternal();
    
    if (totalToAssign > remainingToAssign) {
      setError(`La cantidad total a asignar (${totalToAssign.toLocaleString()} pzas) excede lo pendiente (${remainingToAssign.toLocaleString()} pzas)`);
      return;
    }
    
    // Check each assignment against line capacity
    for (const assignment of validAssignments) {
      const maxAvailable = getMaxAvailableForLineInternal(assignment.lineNo, assignment.id);
      const qty = assignment.quantity;
      
      if (qty > maxAvailable) {
        setError(`❌ Línea ${assignment.lineNo}: Solo tiene capacidad para ${Math.floor(maxAvailable).toLocaleString()} piezas en esta fecha.`);
        return;
      }
    }
    
    setLoading(true);
    setError("");
    setMessage("");
    
    try {
      const token = localStorage.getItem("token");
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      
      for (const assignment of validAssignments) {
        try {
          const response = await fetch("http://localhost:5001/api/line-assignments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              workOrderId: workOrder.id,
              lineNo: assignment.lineNo,
              assignedDate: selectedDate,
              quantity: assignment.quantity,
              plannedStartDate: selectedDate,
            }),
          });
          
          const data = await response.json();
          if (data.success) {
            successCount++;
          } else {
            errorCount++;
            errors.push(`Línea ${assignment.lineNo}: ${data.error}`);
          }
        } catch (err) {
          errorCount++;
          errors.push(`Línea ${assignment.lineNo}: ${err.message}`);
        }
      }
      
      await fetchExistingAssignments();
      await fetchAvailableLines();
      
      setAssignments([{
        id: Date.now(),
        lineNo: "",
        quantity: 0,
        lineData: null,
        daysInfo: null
      }]);
      
      if (successCount > 0) {
        const successMsg = `✅ ${successCount} asignación(es) creada(s) exitosamente.`;
        const errorMsg = errorCount > 0 ? `\n❌ ${errorCount} fallaron: ${errors.join("; ")}` : "";
        setMessage(successMsg + errorMsg);
        
        const newRemaining = getRemainingToAssignInternal();
        if (newRemaining <= 0 && onAssignmentComplete) {
          setTimeout(() => onAssignmentComplete(), 2000);
        }
      } else {
        setError("No se pudo crear ninguna asignación. " + (errors.length ? errors.join("; ") : ""));
      }
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Derived display values (all computed from state, no functions needed) ───

  // Sum all active existing assignments (cancelled already excluded in fetchExistingAssignments)
  const alreadyAssigned = existingAssignments.reduce(
    (sum, a) => sum + (parseFloat(a.assigned_quantity) || 0), 0
  );

  // Total quantity this work order needs to produce
  const totalToProduce = getTotalToProduce();

  // How many pieces still need a line assigned (pending = total - already saved to DB)
  const remainingToAssign = Math.max(0, totalToProduce - alreadyAssigned);

  // How many pieces the planner has typed into the form RIGHT NOW (this session)
  const totalToAssign = getTotalToAssignInternal();

  // What will still be pending AFTER the planner clicks "Assign"
  const afterAssignmentPending = Math.max(0, remainingToAssign - totalToAssign);

  const isFullyAssigned = remainingToAssign <= 0;

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Asignar a Línea de Producción</h2>
            <p className="text-sm text-gray-600">
              Orden: {workOrder?.work_order_no} - {workOrder?.style_description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-gray-400" />
            <span className="text-sm text-gray-600">Puede asignar a múltiples líneas</span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
        {/* Work Order Info */}
        <div className="bg-gray-50 rounded-xl p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Total a Producir</p>
              <p className="text-lg font-semibold text-gray-900">
                {Math.round(totalToProduce).toLocaleString()} pzas
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Ya Asignado</p>
              <p className="text-lg font-semibold text-blue-600">
                {Math.round(alreadyAssigned).toLocaleString()} pzas
              </p>
              {existingAssignments.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {existingAssignments.length} asignación{existingAssignments.length !== 1 ? 'es' : ''}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">Pendiente por Asignar</p>
              <p className={`text-lg font-semibold ${isFullyAssigned ? 'text-green-600' : 'text-orange-600'}`}>
                {Math.round(remainingToAssign).toLocaleString()} pzas
              </p>
              {totalToAssign > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">
                  → {Math.round(afterAssignmentPending).toLocaleString()} tras sesión
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">A Asignar en Esta Sesión</p>
              <p className={`text-lg font-semibold ${totalToAssign > 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                {Math.round(totalToAssign).toLocaleString()} pzas
              </p>
              {totalToAssign > 0 && (
                <p className={`text-xs mt-0.5 font-medium ${afterAssignmentPending <= 0 ? 'text-green-500' : 'text-orange-400'}`}>
                  {afterAssignmentPending <= 0 ? '✓ Orden completa' : `Restará: ${Math.round(afterAssignmentPending).toLocaleString()}`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Date Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Asignación</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          {capacitySource === 'fallback' && capacityDate && (
            <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
              <span>No hay configuración de líneas para esta fecha. Se muestra la capacidad proyectada basada en la última configuración disponible ({capacityDate}).</span>
            </div>
          )}
        </div>

        {/* Assignment Slots */}
        {!isFullyAssigned && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Asignaciones</h3>
              <button
                type="button"
                onClick={handleAddAssignment}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
              >
                <Plus className="w-4 h-4" />
                Agregar Línea
              </button>
            </div>
            
            {assignments.map((assignment, index) => (
              <div key={assignment.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500">Asignación #{index + 1}</span>
                  {assignments.length > 1 && (
                    <button type="button" onClick={() => handleRemoveAssignment(assignment.id)} className="p-1 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Seleccionar Línea</label>
                    <select
                      value={assignment.lineNo}
                      onChange={(e) => handleAssignmentChange(assignment.id, 'lineNo', e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                    >
                      <option value="">Seleccionar línea...</option>
                      {availableLines.map(line => {
                        const maxAvailable = getMaxAvailableForLineInternal(line.line_no);
                        return (
                          <option key={line.line_no} value={line.line_no} disabled={maxAvailable <= 0}>
                            Línea {line.line_no} - {Math.round(line.target_pcs).toLocaleString()} pzas/día - 
                            Disponible: {Math.floor(maxAvailable).toLocaleString()} pzas
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Cantidad a Asignar</label>
                    <input
                      type="number"
                      value={assignment.quantity || ""}
                      onChange={(e) => handleAssignmentChange(assignment.id, 'quantity', e.target.value)}
                      min="1"
                      disabled={!assignment.lineNo}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-100"
                      placeholder="Cantidad en piezas"
                    />
                    {assignment.lineData && (
                      <p className="text-xs text-gray-400 mt-1">
                        Máx: {Math.floor(getMaxAvailableForLineInternal(assignment.lineNo, assignment.id)).toLocaleString()} pzas
                      </p>
                    )}
                  </div>
                </div>
                
                {assignment.daysInfo && assignment.quantity > 0 && (
                  <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Calculator className="w-3 h-3 text-blue-600 mt-0.5" />
                      <div className="text-xs text-blue-800">
                        <p className="font-medium">Estimación para Línea {assignment.lineNo}</p>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <span>Días: {assignment.daysInfo.daysNeeded}</span>
                          <span>Ritmo: {assignment.daysInfo.dailyRate.toLocaleString()} pzas/día</span>
                          <span>Fin: {assignment.daysInfo.endDate}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {/* Assignment Summary */}
            {totalToAssign > 0 && (
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Resumen de Asignaciones</span>
                </div>
                <div className="space-y-1.5 text-sm text-blue-700">
                  {assignments.filter(a => a.lineNo && a.quantity > 0).map((a, idx) => (
                    <div key={idx} className="flex justify-between items-center">
                      <span>Línea {a.lineNo} :</span>
                      <span className="font-semibold">{Math.round(a.quantity).toLocaleString()} pzas</span>
                    </div>
                  ))}
                  <div className="pt-2 mt-1 border-t border-blue-200 space-y-1">
                    <div className="flex justify-between font-semibold text-blue-800">
                      <span>Total a asignar:</span>
                      <span>{Math.round(totalToAssign).toLocaleString()} pzas</span>
                    </div>
                    <div className="flex justify-between text-xs text-blue-600">
                      <span>Pendiente después de asignar:</span>
                      <span className={afterAssignmentPending <= 0 ? "text-green-600 font-bold" : "text-orange-500 font-semibold"}>
                        {Math.round(afterAssignmentPending).toLocaleString()} pzas
                        {afterAssignmentPending <= 0 && ' ✓'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Existing Assignments Display */}
            {existingAssignments.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Asignaciones Existentes</h3>
                <div className="space-y-2">
                  {existingAssignments.map((a, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 w-20">Línea {a.line_no} :</span>
                      <span className="flex-1 text-center font-medium text-gray-800">
                        {Math.round(parseFloat(a.assigned_quantity) || 0).toLocaleString()} pzas
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        a.status === 'completed'   ? 'bg-green-100 text-green-700' :
                        a.status === 'planned'     ? 'bg-blue-100 text-blue-700' :
                        a.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                        a.status === 'released'    ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {a.status === 'completed'   ? '✓ Completada' :
                         a.status === 'planned'     ? '📋 Planificada' :
                         a.status === 'in_progress' ? '⚙️ En proceso' :
                         a.status === 'released'    ? '🚀 Liberada' : a.status}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-3 mt-2 border-t border-gray-200 flex justify-between font-semibold text-sm">
                  <span className="text-gray-700">Total Asignado:</span>
                  <span className="text-blue-600">{Math.round(alreadyAssigned).toLocaleString()} pzas</span>
                </div>
              </div>
            )}
            
            {/* Error/Message Display */}
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            
            {message && (
              <div className="bg-green-50 text-green-700 p-3 rounded-xl text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{message}</span>
              </div>
            )}
            
            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSubmitAssignments}
                disabled={loading || totalToAssign === 0}
                className="flex-1 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Asignando..." : `Asignar ${totalToAssign > 0 ? totalToAssign.toLocaleString() : ""} Piezas`}
              </button>
              <button
                onClick={() => onAssignmentComplete && onAssignmentComplete()}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        
        {/* Fully Assigned Message */}
        {isFullyAssigned && (
          <div className="bg-green-50 rounded-xl p-6 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-green-800 mb-2">Orden Completamente Asignada</h3>
            <p className="text-sm text-green-700">
              Esta orden ya tiene todas sus {Math.round(totalToProduce).toLocaleString()} piezas asignadas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}