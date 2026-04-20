import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "./Alert";

export default function Navlines({ 
  user, 
  selectedLine, 
  selectedDate,
  onLineChange,
  onDateChange,
  autoRefresh,
  onToggleAutoRefresh,
  onManualRefresh,
  loading,
  lastRefreshed,
  countdown,
  formatCountdown,
  formatTime
}) {
  const [open, setOpen] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const navigate = useNavigate();

  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

  // Fetch alert count
  const fetchAlertCount = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await fetch(`${API_BASE}/api/supervisor/alert-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAlertCount(data.count || 0);
        }
      }
    } catch (error) {
      console.error("Error fetching alert count:", error);
    }
  };

  // Fetch all lines
  const fetchAllLines = async () => {
    setLoadingLines(true);
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const response = await axios.get(`${API_BASE}/api/lines`, { headers });
      if (response.data.success && response.data.lines) {
        setLines(response.data.lines);
      } else {
        // Fallback to line numbers 1-20
        const defaultLines = Array.from({ length: 20 }, (_, i) => ({
          line_no: i + 1,
          line_name: `Línea ${i + 1}`
        }));
        setLines(defaultLines);
      }
    } catch (err) {
      console.error('Error fetching lines:', err);
      // Fallback to line numbers 1-20
      const defaultLines = Array.from({ length: 20 }, (_, i) => ({
        line_no: i + 1,
        line_name: `Línea ${i + 1}`
      }));
      setLines(defaultLines);
    } finally {
      setLoadingLines(false);
    }
  };

  useEffect(() => {
    fetchAlertCount();
    fetchAllLines();

    // Refresh alert count every 2 minutes
    const interval = setInterval(fetchAlertCount, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/', { replace: true });
  };

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        {/* Top Row - Title and User Info */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-2xl font-bold">
            Panel de Línea - TV
          </div>

          {/* Desktop User Info */}
          <div className="hidden md:flex items-center gap-4">
            <div className="text-sm text-gray-200">
              <div className="font-semibold">
                {user?.full_name || user?.username || "Soporte_it"}
              </div>
              <div className="text-xs text-gray-400">
                {user?.role || "Soporte_it"}
              </div>
            </div>

            {/* Alerts Button */}
            <div className="relative">
              <button
                onClick={() => setShowAlerts(!showAlerts)}
                className="relative px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <span>Alertas</span>
                {alertCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {alertCount > 99 ? "99+" : alertCount}
                  </span>
                )}
              </button>

              {/* Alerts Dropdown */}
              {showAlerts && (
                <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50">
                  <Alert supervisorMode={true} />
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden text-2xl cursor-pointer relative"
          >
            ☰
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                {alertCount}
              </span>
            )}
          </button>
        </div>

        {/* Bottom Row - Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Line Selector */}
          <select
            value={selectedLine || ''}
            onChange={(e) => onLineChange(e.target.value)}
            className="border-2 rounded-lg px-4 py-2.5 text-base bg-white text-gray-900 shadow-sm min-w-[200px]"
            disabled={loadingLines}
          >
            <option value="">
              {loadingLines ? 'Cargando líneas...' : 'Seleccionar Línea'}
            </option>
            {lines.map((line) => (
              <option key={line.line_no} value={line.line_no}>
                {line.line_name || `Línea ${line.line_no}`}
              </option>
            ))}
          </select>

          {/* Date Picker */}
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="border-2 rounded-lg px-4 py-2.5 text-base bg-white text-gray-900 shadow-sm"
          />

          {/* Auto-refresh Toggle */}
          <button
            onClick={onToggleAutoRefresh}
            className={`px-4 py-2.5 rounded-lg text-base font-medium flex items-center gap-2 transition-colors ${
              autoRefresh 
                ? 'bg-green-100 text-green-700 hover:bg-green-200 border-2 border-green-300' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-2 border-gray-300'
            }`}
          >
            <span className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
            {autoRefresh ? 'Auto On' : 'Auto Off'}
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={onManualRefresh}
            disabled={loading || !selectedLine}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg text-base font-medium disabled:opacity-50 flex items-center gap-2 shadow-sm transition-colors"
          >
            <span className="text-xl">🔄</span>
            Actualizar
          </button>

          {/* Last Updated Info */}
          {selectedLine && (
            <div className="text-sm text-gray-300 ml-auto flex items-center gap-3">
              <span>Última actualización: {formatTime(lastRefreshed)}</span>
              {autoRefresh && (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  <span className="font-medium">Auto-refresh en {formatCountdown(countdown)}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <div className="flex flex-col gap-4 px-6 py-4">
            {/* User Info Mobile */}
            <div className="pb-3 border-b border-gray-700">
              <div className="font-semibold text-white">
                {user?.full_name || user?.username || "Soporte_it"}
              </div>
              <div className="text-sm text-gray-400">
                {user?.role || "Soporte_it"}
              </div>
            </div>

            {/* Alerts Mobile */}
            <button
              onClick={() => {
                setShowAlerts(!showAlerts);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors flex justify-between items-center"
            >
              <span>Alertas</span>
              {alertCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>

            {/* Logout Mobile */}
            <button
              onClick={handleLogout}
              className="px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-left"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {/* Mobile Alerts Panel */}
      {showAlerts && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-50">
          <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">
                  Alertas de Producción
                </h3>
                <button
                  onClick={() => setShowAlerts(false)}
                  className="text-2xl text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>
              <Alert supervisorMode={true} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}