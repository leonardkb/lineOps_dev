import { useState, useMemo } from "react";
import { calcCapacityPerHourFromTimes, calcCapacityPerHourForMultipleOperations } from "../utils/calc";

export default function AddOperatorModal({ runId, slots, onClose, onOperatorAdded }) {
  const [operatorNo, setOperatorNo] = useState("");
  const [operatorName, setOperatorName] = useState("");
  
  // State for multiple operations
  const [operations, setOperations] = useState([
    {
      id: Date.now(),
      operationName: "",
      t1: "",
      t2: "",
      t3: "",
      t4: "",
      t5: ""
    }
  ]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Add a new operation row
  const addOperation = () => {
    setOperations([
      ...operations,
      {
        id: Date.now() + Math.random(),
        operationName: "",
        t1: "",
        t2: "",
        t3: "",
        t4: "",
        t5: ""
      }
    ]);
  };

  // Remove an operation row
  const removeOperation = (id) => {
    if (operations.length > 1) {
      setOperations(operations.filter(op => op.id !== id));
    }
  };

  // Update operation field
  const updateOperation = (id, field, value) => {
    setOperations(operations.map(op => 
      op.id === id ? { ...op, [field]: value } : op
    ));
  };

  // Calculate capacity for a single operation
  const calculateOperationCapacity = (op) => {
    return calcCapacityPerHourFromTimes(op.t1, op.t2, op.t3, op.t4, op.t5);
  };

  // Calculate total capacity for the operator considering all operations
  const calculateTotalOperatorCapacity = useMemo(() => {
    // Filter out operations without names (they won't be saved)
    const validOperations = operations.filter(op => op.operationName.trim() !== "");
    
    if (validOperations.length === 0) return 0;
    
    // Create a copy of operations with proper number values for the calculation
    const operationsForCalc = validOperations.map(op => ({
      t1: op.t1 ? parseFloat(op.t1) : 0,
      t2: op.t2 ? parseFloat(op.t2) : 0,
      t3: op.t3 ? parseFloat(op.t3) : 0,
      t4: op.t4 ? parseFloat(op.t4) : 0,
      t5: op.t5 ? parseFloat(op.t5) : 0,
    }));
    
    // Use the multi-operation calculation from calc.js
    return calcCapacityPerHourForMultipleOperations(operationsForCalc);
  }, [operations]);

  // Get individual operation capacities for display
  const operationCapacities = useMemo(() => {
    return operations.map(op => ({
      ...op,
      capacity: calculateOperationCapacity(op)
    }));
  }, [operations]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate required fields
    if (!operatorNo) {
      setError("El número de operador es requerido");
      return;
    }
    
    // Check if at least one operation has a name
    const validOperations = operations.filter(op => op.operationName.trim() !== "");
    if (validOperations.length === 0) {
      setError("Al menos una operación es requerida");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      
      // First, add the operator
      const operatorResponse = await fetch(`http://localhost:5000/api/run/${runId}/operators`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operatorNo: parseInt(operatorNo),
          operatorName: operatorName.trim() || null,
        }),
      });

      const operatorData = await operatorResponse.json();

      if (!operatorData.success) {
        setError(operatorData.error || "Error al agregar operador");
        setLoading(false);
        return;
      }

      // Then, add all operations for this operator
      let successCount = 0;
      const savedOperations = [];

      for (const op of validOperations) {
        // Calculate individual operation capacity
        const capacityPerHour = calculateOperationCapacity(op);

        const operationPayload = {
          operatorNo: parseInt(operatorNo),
          operatorName: operatorName.trim() || null,
          operationName: op.operationName,
          t1: op.t1 || null,
          t2: op.t2 || null,
          t3: op.t3 || null,
          t4: op.t4 || null,
          t5: op.t5 || null,
          capacityPerHour: capacityPerHour,
        };

        const operationResponse = await fetch(`http://localhost:5000/api/add-operation/${runId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(operationPayload),
        });

        const operationData = await operationResponse.json();

        if (operationData.success) {
          successCount++;
          savedOperations.push({
            id: operationData.operationId,
            name: op.operationName,
            capacity: capacityPerHour
          });
        }
      }

      if (successCount > 0) {
        setSuccess(true);
        // Short timeout to show success message, then close
        setTimeout(() => {
          onOperatorAdded({
            ...operatorData.operator,
            operationsCount: successCount,
            totalCapacity: calculateTotalOperatorCapacity,
            operations: savedOperations
          });
          onClose();
        }, 1000);
      } else {
        setError("No se pudo agregar ninguna operación");
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Check if there are any valid operations with names
  const hasValidOperations = operationCapacities.some(op => op.operationName.trim() !== "");
  
  // Calculate total for display
  const totalCapacityValue = calculateTotalOperatorCapacity;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold text-gray-900">
            Agregar nuevo operador y operaciones
          </h3>
          <p className="text-sm text-gray-600">
            Ingresa los datos del operador y sus operaciones
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* Success message - shown briefly before closing */}
          {success && (
            <div className="mb-4 p-4 bg-green-50 text-green-700 text-base rounded-lg border border-green-200 text-center">
              ✅ Operador y operaciones agregados correctamente
            </div>
          )}

          {/* Error message */}
          {error && !success && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
              ❌ {error}
            </div>
          )}

          {/* Only show form fields if not successful */}
          {!success && (
            <>
              {/* Operator Information Section */}
              <div className="mb-6">
                <h4 className="text-md font-medium text-gray-900 mb-3">Información del Operador</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Número de operador *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={operatorNo}
                      onChange={(e) => setOperatorNo(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                      placeholder="Ej: 101"
                      required
                      disabled={loading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre del operador
                    </label>
                    <input
                      type="text"
                      value={operatorName}
                      onChange={(e) => setOperatorName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                      placeholder="Opcional"
                      disabled={loading}
                    />
                  </div>
                </div>
              </div>

              {/* Total Operator Capacity Display */}
              {hasValidOperations && (
                <div className="mb-6 p-4 bg-purple-50 rounded-xl border border-purple-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-purple-800">Capacidad total del operador</div>
                      <div className="text-xs text-purple-600">
                        Calculada con {operationCapacities.filter(op => op.operationName.trim() !== "").length} operación(es)
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-purple-900">
                      {totalCapacityValue.toFixed(2)} <span className="text-sm font-normal">pzas/hora</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Operations Section */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-md font-medium text-gray-900">Operaciones</h4>
                  <button
                    type="button"
                    onClick={addOperation}
                    className="text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-xl hover:bg-gray-200"
                    disabled={loading}
                  >
                    + Agregar otra operación
                  </button>
                </div>

                {operationCapacities.map((op, index) => {
                  const hasName = op.operationName.trim() !== "";
                  
                  return (
                    <div key={op.id} className="mb-6 p-4 border border-gray-200 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-sm font-medium text-gray-700">
                          Operación #{index + 1}
                          {hasName && op.capacity > 0 && (
                            <span className="ml-2 text-xs text-blue-600">
                              (Capacidad individual: {op.capacity.toFixed(2)}/h)
                            </span>
                          )}
                        </h5>
                        {operations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeOperation(op.id)}
                            className="text-sm text-red-600 hover:text-red-800"
                            disabled={loading}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>

                      {/* Operation Name */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre de la operación *
                        </label>
                        <input
                          type="text"
                          value={op.operationName}
                          onChange={(e) => updateOperation(op.id, 'operationName', e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                          placeholder="Ej: Pegar cuello, Unir mangas, etc."
                          required={index === 0}
                          disabled={loading}
                        />
                      </div>

                      {/* Time Fields */}
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Tiempos de operación (segundos)
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">t1</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={op.t1}
                              onChange={(e) => updateOperation(op.id, 't1', e.target.value)}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                              placeholder="0.00"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">t2</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={op.t2}
                              onChange={(e) => updateOperation(op.id, 't2', e.target.value)}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                              placeholder="0.00"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">t3</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={op.t3}
                              onChange={(e) => updateOperation(op.id, 't3', e.target.value)}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                              placeholder="0.00"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">t4</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={op.t4}
                              onChange={(e) => updateOperation(op.id, 't4', e.target.value)}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                              placeholder="0.00"
                              disabled={loading}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">t5</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={op.t5}
                              onChange={(e) => updateOperation(op.id, 't5', e.target.value)}
                              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
                              placeholder="0.00"
                              disabled={loading}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Individual Operation Capacity Display */}
                      {hasName && op.capacity > 0 && (
                        <div className="mt-2 p-2 bg-blue-50 rounded-lg">
                          <div className="text-sm text-blue-800">
                            Capacidad de esta operación: <span className="font-bold">{op.capacity.toFixed(2)}</span> piezas/hora
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Slot Information Preview */}
              {slots && slots.length > 0 && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Horarios disponibles</h4>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => (
                      <span key={slot.id} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs">
                        {slot.label}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    * Los datos por hora se pueden ingresar después de guardar el operador
                  </p>
                </div>
              )}
            </>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
              disabled={loading || success}
            >
              Cancelar
            </button>
            {!success && (
              <button
                type="submit"
                disabled={loading || !operatorNo || !operations[0]?.operationName}
                className="px-6 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Guardando...
                  </>
                ) : (
                  `Guardar operador y ${operations.filter(op => op.operationName).length || 1} operación(es)`
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}