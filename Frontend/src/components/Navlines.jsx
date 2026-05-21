import { useState } from "react";
import { useNavigate } from "react-router-dom";
// Remove axios import - not needed anymore

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
  const navigate = useNavigate();

  // Generate line numbers 1-26 directly - no API call needed
  const lines = Array.from({ length: 26 }, (_, i) => ({
    line_no: String(i + 1),
    line_name: `Línea ${i + 1}`
  }));

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
                {user?.full_name || user?.username || "Usuario"}
              </div>
              <div className="text-xs text-gray-400">
                {user?.role || "Rol"}
              </div>
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
          </button>
        </div>

        {/* Bottom Row - Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Line Selector */}
          <select
            value={selectedLine || ''}
            onChange={(e) => onLineChange(e.target.value)}
            className="border-2 rounded-lg px-4 py-2.5 text-base bg-white text-gray-900 shadow-sm min-w-[200px]"
          >
            <option value="">Seleccionar Línea</option>
            {lines.map((line) => (
              <option key={line.line_no} value={line.line_no}>
                {line.line_name}
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
          {selectedLine && lastRefreshed && (
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
                {user?.full_name || user?.username || "Usuario"}
              </div>
              <div className="text-sm text-gray-400">
                {user?.role || "Rol"}
              </div>
            </div>

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
    </nav>
  );
}