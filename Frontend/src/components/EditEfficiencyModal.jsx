import { useState, useEffect } from "react";

export default function EditEfficiencyModal({ 
  isOpen, 
  onClose, 
  currentEfficiency, 
  onSave, 
  isSaving 
}) {
  const [efficiency, setEfficiency] = useState("");
  const [error, setError] = useState("");

  // Update when currentEfficiency changes
  useEffect(() => {
    if (currentEfficiency !== undefined) {
      // Convert decimal to percentage for display (0.75 -> 75)
      setEfficiency((currentEfficiency * 100).toString());
    }
  }, [currentEfficiency]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    const effValue = parseFloat(efficiency);
    
    if (isNaN(effValue) || effValue <= 0 || effValue > 100) {
      setError("La eficiencia debe ser un número entre 1 y 100");
      return;
    }

    // Convert percentage to decimal (75 -> 0.75)
    onSave(effValue / 100);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Editar eficiencia
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Modifica el porcentaje de eficiencia para esta corrida. La meta se recalculará automáticamente.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Eficiencia (%)
            </label>
            <div className="relative">
              <input
                type="number"
                value={efficiency}
                onChange={(e) => setEfficiency(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-12 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
                placeholder="75"
                step="0.1"
                min="0.1"
                max="100"
                required
                disabled={isSaving}
                autoFocus
              />
              <span className="absolute right-3 top-2 text-sm text-gray-500">
                %
              </span>
            </div>
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
              disabled={isSaving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50"
              disabled={isSaving}
            >
              {isSaving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}