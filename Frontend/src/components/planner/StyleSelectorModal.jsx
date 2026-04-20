// components/planner/StyleSelectorModal.jsx
import { useState, useEffect } from "react";
import { X, Search, Calendar, Users, Target, Clock } from "lucide-react";
import { format } from "date-fns";

export default function StyleSelectorModal({ isOpen, onClose, onSelectStyle }) {
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStyleGroup, setSelectedStyleGroup] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchStyles();
    }
  }, [isOpen]);

  const fetchStyles = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/line-runs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        // Group by style name
        const grouped = {};
        data.runs.forEach(run => {
          if (!grouped[run.style]) {
            grouped[run.style] = [];
          }
          grouped[run.style].push(run);
        });
        setStyles(grouped);
      }
    } catch (err) {
      console.error("Error fetching styles:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectStyle = (styleGroup, latestRun) => {
    onSelectStyle({
      style: styleGroup,
      line_no: latestRun.line_no,
      target_pcs: latestRun.target_pcs,
      run_date: latestRun.run_date,
      working_hours: latestRun.working_hours,
      operators_count: latestRun.operators_count,
      sam_minutes: latestRun.sam_minutes,
      efficiency: latestRun.efficiency,
      target_per_hour: latestRun.target_per_hour
    });
    onClose();
  };

  const filteredStyles = Object.entries(styles).filter(([styleName]) =>
    styleName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Seleccionar Estilo</h2>
            <p className="text-sm text-gray-500">Elija un estilo existente para pre-llenar la orden</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nombre de estilo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        {/* Styles List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Cargando estilos...</div>
          ) : filteredStyles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No se encontraron estilos
            </div>
          ) : (
            <div className="space-y-4">
              {filteredStyles.map(([styleName, runs]) => {
                const latestRun = runs[0];
                const totalRuns = runs.length;
                const avgTarget = runs.reduce((sum, r) => sum + r.target_pcs, 0) / totalRuns;
                
                return (
                  <div
                    key={styleName}
                    onClick={() => handleSelectStyle(styleName, latestRun)}
                    className="border rounded-xl p-4 hover:bg-gray-50 cursor-pointer transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 text-lg">{styleName}</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2 text-sm">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-600">Última corrida:</span>
                            <span className="font-medium">
                              {format(new Date(latestRun.run_date), "dd/MM/yyyy")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-600">Línea:</span>
                            <span className="font-medium">{latestRun.line_no}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Target className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-600">Meta diaria:</span>
                            <span className="font-medium">
                              {Math.round(latestRun.target_pcs).toLocaleString()} pzas
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-600">Ritmo:</span>
                            <span className="font-medium">
                              {Math.round(latestRun.target_per_hour)} pzas/h
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-3 text-xs text-gray-500">
                          <span>📊 {totalRuns} corridas registradas</span>
                          <span>⏱️ SAM: {latestRun.sam_minutes} min</span>
                          <span>👥 Operadores: {latestRun.operators_count}</span>
                          <span>⚡ Eficiencia: {Math.round(latestRun.efficiency * 100)}%</span>
                        </div>
                      </div>
                      <button className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                        Seleccionar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
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