// components/cutting/NavCutting.jsx
//
// Barra de navegación para el rol "corte". Solo marca + cerrar sesión.
//
import { Scissors, LogOut } from "lucide-react";

export default function NavCutting() {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { user = {}; }
  const name = user.full_name || user.username || "Corte";

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-14 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Scissors className="w-4 h-4" />
            </div>
            <span className="font-bold tracking-tight">Corte</span>
          </div>

          {/* Cerrar sesión */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-gray-300">{name}</span>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white px-3 py-2 rounded-lg hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}