// components/planner/MasterCodeSelectorModal.jsx
import { useState, useEffect } from "react";
import { X, Search, Timer, Camera } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

/*
  Lets a planner pick an existing merchant master code to pre-fill a work
  order's style info and, critically, its real SAM — so line-assignment
  day/rate math is based on the actual style being produced rather than
  whatever SAM happens to be configured on the line that day.

  <MasterCodeSelectorModal isOpen={bool} onClose={fn} onSelectMasterCode={fn} />
  onSelectMasterCode receives: { id, code, description, color, cliente, estilo, talla, sam, photoUrl }
*/
export default function MasterCodeSelectorModal({ isOpen, onClose, onSelectMasterCode }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetchMasterCodes();
    }
  }, [isOpen]);

  const fetchMasterCodes = async () => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/api/master-codes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Tu cuenta no tiene permiso para ver los códigos maestros"
            : "No se pudieron cargar los códigos maestros"
        );
      }
      const data = await response.json();
      setCodes(data);
    } catch (err) {
      console.error("Error fetching master codes:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (mc) => {
    onSelectMasterCode({
      id: mc.id,
      code: mc.code,
      type: mc.type,
      modelo: mc.modelo,
      correlativo: mc.correlativo,
      description: mc.description,
      color: mc.color,
      cliente: mc.cliente,
      estilo: mc.estilo,
      talla: mc.talla,
      sam: mc.sam,
      photoUrl: mc.photoUrl || null,
    });
    onClose();
  };

  const filtered = codes.filter((c) => {
    const q = searchTerm.trim().toUpperCase();
    if (!q) return true;
    const hay = `${c.code} ${c.description || ""} ${c.cliente || ""} ${c.estilo || ""}`.toUpperCase();
    return hay.includes(q);
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Seleccionar código maestro</h2>
            <p className="text-sm text-gray-500">
              El SAM del código se usará para calcular la capacidad de línea
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por código, descripción, cliente o estilo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Cargando códigos maestros...</div>
          ) : error ? (
            <div className="text-center py-12 text-red-600 text-sm">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No se encontraron códigos maestros
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((mc) => (
                <div
                  key={mc.id}
                  onClick={() => handleSelect(mc)}
                  className="flex gap-3 border rounded-xl p-3 hover:bg-gray-50 cursor-pointer transition"
                >
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {mc.photoUrl ? (
                      <img src={mc.photoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Camera className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-bold text-gray-900 truncate">{mc.code}</p>
                    <p className="text-xs text-gray-500 line-clamp-2">{mc.description}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">
                        <Timer className="w-3 h-3" /> SAM {mc.sam} min
                      </span>
                      <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                        {mc.type} · {mc.modelo}
                      </span>
                      <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                        Talla {mc.talla}
                      </span>
                      {mc.cliente && (
                        <span className="text-[11px] text-gray-400">Cliente (código): {mc.cliente}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}