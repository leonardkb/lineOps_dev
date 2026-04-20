import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

export default function NavSkyrina({ 
  userName = "Usuario", 
  date = new Date().toISOString().split('T')[0],
  onDateChange,
  autoRefresh = true,
  onToggleAutoRefresh,
  onManualRefresh,
  loading = false,
  lastRefreshed = new Date(),
  countdown = 300,
  formatCountdown = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`,
  formatTime = (d) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-gradient-to-r from-gray-900 to-gray-800 text-white sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
        {/* Top Row - Brand and User */}
        <div className="flex items-center justify-between mb-2">
          {/* Title / Brand with user name */}
          <div className="flex items-center gap-2">
            <Link to="/skyrina" className="text-lg font-bold flex items-center gap-1.5">
             
              <span className="hidden sm:inline">Skyrina Panel</span>
              <span className="sm:hidden">Skyrina</span>
            </Link>
           
          </div>

          {/* Desktop Menu */}
          <ul className="hidden md:flex gap-3 font-medium">
            <li>
              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  window.location.href = '/';
                }}
                className="cursor-pointer transition px-3 py-1.5 rounded-lg text-sm hover:bg-white/10 flex items-center gap-1.5"
              >
                
                <span>Cerrar sesión</span>
              </button>
            </li>
          </ul>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden text-xl cursor-pointer p-1.5 hover:bg-white/10 rounded-lg"
          >
            ☰
          </button>
        </div>

        {/* Bottom Row - Controls (always visible) */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white/5 rounded-lg p-2">
          {/* Left side - Date and refresh info */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-white/10 rounded-lg border border-white/20">
              <input
                type="date"
                value={date}
                onChange={onDateChange}
                className="w-32 sm:w-36 rounded-lg border-0 bg-transparent px-2 py-1 text-xs font-medium text-white focus:ring-2 focus:ring-white/30 [color-scheme:dark]"
              />
            </div>
            
            <div className="text-xs text-gray-300 flex items-center gap-2">
              <span>🕒 {formatTime(lastRefreshed)}</span>
              {autoRefresh && (
                <span className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></span>
                  <span className="font-medium">{formatCountdown(countdown)}</span>
                </span>
              )}
            </div>
          </div>

          {/* Right side - Controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleAutoRefresh}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                autoRefresh 
                  ? 'bg-green-600 text-white hover:bg-green-700 border border-green-400' 
                  : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-300 animate-pulse' : 'bg-gray-400'}`}></span>
              {autoRefresh ? 'Auto On' : 'Auto Off'}
            </button>

            <button
              onClick={onManualRefresh}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1 shadow-sm border border-blue-400"
            >
              <span className="text-sm">🔄</span>
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden border-t border-gray-700">
          <ul className="flex flex-col gap-1 px-3 py-2 font-medium">
            <li className="px-3 py-2 text-sm text-gray-300 border-b border-gray-700 flex items-center gap-2">
              <span>👤</span>
              <span className="truncate">{userName}</span>
            </li>
            <li>
              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  window.location.href = '/';
                }}
                className="w-full text-left cursor-pointer px-3 py-2 rounded-lg text-sm hover:bg-white/10 flex items-center gap-2"
              >
                <span>🚪</span>
                <span>Cerrar sesión</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}