import { useState } from "react";

export default function EditWorkingHoursModal({ 
  isOpen, 
  onClose, 
  currentWorkingHours, 
  onSave,
  isSaving 
}) {
  const [workingHours, setWorkingHours] = useState(currentWorkingHours?.toString() || "");

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const hours = parseFloat(workingHours);
    if (hours > 0) {
      onSave(hours);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Editar Horas de Trabajo
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Al cambiar las horas de trabajo, la meta y los objetivos por hora se recalcularán automáticamente.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="block mb-4">
            <span className="text-sm font-medium text-gray-700">Horas de Trabajo</span>
            <input
              type="number"
              step="0.01"
              min="0.1"
              value={workingHours}
              onChange={(e) => setWorkingHours(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
              placeholder="8.5"
              required
            />
          </label>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !workingHours || parseFloat(workingHours) <= 0}
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50"
            >
              {isSaving ? "Guardando..." : "Guardar Cambios"}
            </button>
          </div>
        </form>

        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-xs text-blue-700">
            <span className="font-medium">Nota:</span> La meta se recalculará usando la fórmula:
            <br />
            Meta = (Operadores × Horas × 60) ÷ SAM × Eficiencia
          </p>
        </div>
      </div>
    </div>
  );
}