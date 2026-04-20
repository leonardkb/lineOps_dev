import { useState, useEffect } from "react";

export default function OperatorCountEditModal({ runId, currentCount, onClose, onUpdate }) {
  const [operatorCount, setOperatorCount] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");

  // Initialize state when currentCount changes
  useEffect(() => {
    if (currentCount !== undefined && currentCount !== null) {
      setOperatorCount(currentCount.toString());
    }
  }, [currentCount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    
    const count = parseInt(operatorCount);
    if (isNaN(count) || count <= 0) {
      setError("Por favor ingrese un número válido de operadores (mayor a 0)");
      return;
    }

    setIsUpdating(true);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/update-operator-count/${runId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ operatorsCount: count }),
      });

      const data = await response.json();

      if (data.success) {
        onUpdate({
          operatorsCount: count,
          newTarget: data.newTarget,
          newTargetPerHour: data.newTargetPerHour,
        });
        onClose();
      } else {
        setError(data.error || "Error al actualizar el número de operadores");
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // If runId is missing, don't render the modal
  if (!runId) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Editar número de operadores
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Cambiar el número de operadores recalculará automáticamente la meta de producción.
        </p>
        
        <form onSubmit={handleSubmit}>
          <label className="block mb-4">
            <span className="text-sm font-medium text-gray-700">Número de operadores</span>
            <input
              type="number"
              min="1"
              step="1"
              value={operatorCount}
              onChange={(e) => setOperatorCount(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
              placeholder="Ej: 15"
            />
          </label>
          
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
              {error}
            </div>
          )}
          
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
              disabled={isUpdating}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isUpdating}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50"
            >
              {isUpdating ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}