import { useState } from "react";
import { useNavigate } from "react-router-dom";

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

  // Lines 1-26, no API call needed
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
      <div className="max-w-screen-2xl mx-auto px-4 py-2 flex flex-wrap lg:flex-nowrap items-center gap-2">
        {/* Title */}
        <div className="text-lg font-bold whitespace-nowrap mr-2">
          Panel de Línea - TV
        </div>

        {/* Line selector */}
        <select
          value={selectedLine || ''}
          onChange={(e) => onLineChange(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-white text-gray-900 w-32"
        >
          <option value="">Seleccionar Línea</option>
          {lines.map((line) => (
            <option key={line.line_no} value={line.line_no}>
              {line.line_name}
            </option>
          ))}
        </select>

        {/* Date */}
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-white text-gray-900"
        />

        {/* Auto-refresh toggle */}
        <button
          onClick={onToggleAutoRefresh}
          className={`px-2.5 py-1 rounded-md text-sm font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors border ${
            autoRefresh
              ? 'bg-green-100 text-green-700 hover:bg-green-200 border-green-300'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
          {autoRefresh ? 'Auto On' : 'Auto Off'}
        </button>

        {/* Manual refresh */}
        <button
          onClick={onManualRefresh}
          disabled={loading || !selectedLine}
          className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap transition-colors"
        >
          <span>🔄</span>
          Actualizar
        </button>

        {/* Last updated + countdown */}
        {selectedLine && lastRefreshed && (
          <div className="text-xs text-gray-300 flex items-center gap-2 whitespace-nowrap ml-1">
            <span>Actualizado: {formatTime(lastRefreshed)}</span>
            {autoRefresh && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                <span className="font-medium">en {formatCountdown(countdown)}</span>
              </span>
            )}
          </div>
        )}

        {/* User + logout (desktop) */}
        <div className="hidden md:flex items-center gap-3 ml-auto">
          <div className="text-right leading-tight whitespace-nowrap">
            <div className="text-sm font-semibold text-gray-200">
              {user?.full_name || user?.username || "Usuario"}
            </div>
            <div className="text-[11px] text-gray-400">{user?.role || "Rol"}</div>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1 text-sm font-medium bg-gray-800 text-white rounded-md hover:bg-gray-700 transition-colors whitespace-nowrap"
          >
            Cerrar sesión
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setOpen(!open)}
          aria-label="Menú"
          className="md:hidden text-xl ml-auto"
        >
          ☰
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="pb-2 border-b border-gray-700">
              <div className="font-semibold text-white">
                {user?.full_name || user?.username || "Usuario"}
              </div>
              <div className="text-sm text-gray-400">{user?.role || "Rol"}</div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-left"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}