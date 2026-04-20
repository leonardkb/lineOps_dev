import { useState, useEffect } from "react";

export default function EditOperatorModal({ operator, runId, onClose, onOperatorUpdated }) {
  const [operatorNo, setOperatorNo] = useState(operator?.operator_no || "");
  const [operatorName, setOperatorName] = useState(operator?.operator_name || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (operator) {
      setOperatorNo(operator.operator_no);
      setOperatorName(operator.operator_name || "");
    }
  }, [operator]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!operatorNo) {
      setError("El número de operador es requerido");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5000/api/run/${runId}/operators/${operator.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operatorNo: parseInt(operatorNo),
          operatorName: operatorName.trim() || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onOperatorUpdated(data.operator);
          onClose();
        }, 1000);
      } else {
        setError(data.error || "Error al actualizar operador");
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            Editar Operador
          </h3>
          <p className="text-sm text-gray-600">
            Actualizar número y nombre del operador
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {success && (
            <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-lg border border-green-200">
              ✅ Operador actualizado correctamente
            </div>
          )}

          {error && !success && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
              ❌ {error}
            </div>
          )}

          {!success && (
            <>
              <div className="mb-4">
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
                <p className="text-xs text-gray-500 mt-1">
                  Anterior: {operator?.operator_no}
                </p>
              </div>

              <div className="mb-6">
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

              <div className="bg-blue-50 p-3 rounded-lg mb-4">
                <p className="text-xs text-blue-800">
                  <span className="font-medium">Nota:</span> Al cambiar el número de operador, todas sus operaciones y registros horarios se mantendrán asociados al nuevo número.
                </p>
              </div>
            </>
          )}

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
                disabled={loading || !operatorNo}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Actualizando...
                  </>
                ) : (
                  "Actualizar operador"
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}