import { Link, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Plus, RefreshCw, LogOut, Tag } from "lucide-react";

export default function MerchantNavbar({
  title,
  onRefresh,
  isRefreshing = false,
  showRefresh = true,
  showStatus = false,
  isOnline = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/");
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header className="bg-slate-900 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Brand + Title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
            <Tag size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            <p className="text-xs text-slate-400 hidden sm:block">
              Gestiona los códigos maestros de producto
            </p>
          </div>
        </div>

        {/* Right: Navigation + Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status indicator (optional) */}
          {showStatus && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2.5 py-1 ${
                isOnline
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {isOnline ? "✅ Conectado" : "⚠️ Demo"}
            </span>
          )}

          {/* Navigation Links */}
          <Link
            to="/merchant-dashboard"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              isActive("/merchant-dashboard")
                ? "bg-white text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
          >
            <LayoutDashboard size={14} />
            Dashboard
          </Link>

          <Link
            to="/merchant"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              isActive("/merchant")
                ? "bg-white text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
          >
            <Plus size={14} />
            Nuevo código
          </Link>

          {/* Refresh Button */}
          {showRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
              Actualizar
            </button>
          )}

          {/* Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-2 text-xs font-semibold transition-colors"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </header>
  );
}