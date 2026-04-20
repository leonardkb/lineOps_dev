import { useState } from "react";

export default function DeleteOperatorModal({ operator, onClose, onOperatorDeleted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5000/api/run/${operator.run_id}/operators/${operator.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (data.success) {
        onOperatorDeleted(operator.id);
        onClose();
      } else {
        setError(data.error || "Error deleting operator");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Eliminar operador
        </h3>
        
        <p className="text-sm text-gray-600 mb-4">
          ¿Estás seguro que deseas eliminar al operador{" "}
          <span className="font-semibold">{operator.operator_no}</span>
          {operator.operator_name && ` - ${operator.operator_name}`}?
        </p>
        
        <p className="text-sm text-red-600 mb-4">
          ⚠️ Esta acción eliminará todas las operaciones y datos por hora asociados a este operador.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Eliminando..." : "Eliminar operador"}
          </button>
        </div>
      </div>
    </div>
  );
}