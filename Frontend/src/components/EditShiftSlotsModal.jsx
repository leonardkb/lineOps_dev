import { useState } from "react";

export default function EditShiftSlotsModal({ isOpen, onClose, slots, onSave, isSaving }) {
  const [editedSlots, setEditedSlots] = useState(() => 
    slots.map(slot => ({ 
      slotId: slot.id,
      slotLabel: slot.label,
      plannedHours: slot.hours 
    }))
  );

  if (!isOpen) return null;

  const handleHourChange = (index, value) => {
    const newHours = parseFloat(value) || 0;
    const updated = [...editedSlots];
    updated[index] = { ...updated[index], plannedHours: newHours };
    setEditedSlots(updated);
  };

  const handleSave = () => {
    onSave(editedSlots);
  };

  const totalHours = editedSlots.reduce((sum, slot) => sum + (slot.plannedHours || 0), 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Editar Distribución de Turnos
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Modifica las horas planeadas para cada período (incluye descansos)
        </p>

        <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
          {editedSlots.map((slot, idx) => (
            <div key={slot.slotId || idx} className="flex items-center gap-3">
              <div className="w-24 font-medium text-gray-700">
                {slot.slotLabel}
              </div>
              <input
                type="number"
                step="0.5"
                min="0"
                value={slot.plannedHours}
                onChange={(e) => handleHourChange(idx, e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-gray-900/10"
              />
              <span className="text-sm text-gray-500">horas</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-gray-50 p-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total horas trabajadas:</span>
            <span className="font-semibold text-gray-900">{totalHours.toFixed(2)} hrs</span>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || totalHours <= 0}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50"
          >
            {isSaving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}