// NavIT.jsx — barra de navegación del Panel de TI (mismo estilo que NavDashboard).
//   • Secciones del panel como botones (desktop) y en el menú ☰ (móvil)
//   • «Alertas»: intentos de inicio de sesión fallidos de hoy, con badge
//   • Usuario y «Cerrar sesión» (registra la salida en la bitácora)
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, ScrollText } from "lucide-react";

const fmtTime = (v) =>
  new Date(v).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "numeric", minute: "2-digit" });

function AlertList({ alerts, onSeeAll }) {
  return (
    <div className="text-gray-900">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="font-semibold">Intentos fallidos de hoy</div>
        <div className="text-xs text-gray-500">Contraseña incorrecta o usuario que no existe</div>
      </div>
      {alerts.length === 0 ? (
        <div className="px-4 py-6 text-sm text-gray-500 text-center">Sin intentos fallidos hoy.</div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-gray-100">
          {alerts.map((a) => (
            <li key={a.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
              <span className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-3.5 h-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium truncate">{a.username || "—"}</span>
                <span className="block text-xs text-gray-500">
                  {a.user_id ? "Contraseña incorrecta" : "Usuario no existe"} · {a.ip || "IP desconocida"}
                </span>
              </span>
              <span className="text-xs text-gray-400 tabular-nums shrink-0">{fmtTime(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="p-2 border-t border-gray-200">
        <button
          onClick={onSeeAll}
          className="w-full px-3 py-2 text-sm font-medium text-indigo-600 rounded-lg hover:bg-indigo-50 flex items-center justify-center gap-2"
        >
          <ScrollText className="w-4 h-4" /> Ver en la bitácora
        </button>
      </div>
    </div>
  );
}

export default function NavIT({ user, roleLabel, tabs = [], tab, onTab, alerts = [], onSeeAlerts, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const navigate = useNavigate();
  const alertCount = alerts.length;

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem("token");
      if (token) await fetch("/api/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch (_) { /* salir aunque falle el registro */ }
    if (onLogout) onLogout();
    navigate("/");
  };

  const seeAll = () => {
    setShowAlerts(false);
    setOpen(false);
    onSeeAlerts?.();
  };

  const name = user?.full_name || user?.username || "Administrador";

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">

        {/* Title */}
        <div className="text-2xl font-bold whitespace-nowrap">
          Panel de TI
        </div>

        {/* Desktop sections */}
        <div className="hidden lg:flex items-center gap-1 bg-gray-800 rounded-lg p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
                tab === t.id ? "bg-white text-gray-900" : "text-gray-300 hover:text-white hover:bg-gray-700"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-6 font-medium">

          {/* User Info */}
          <div className="text-sm text-gray-200">
            <div className="font-semibold">{name}</div>
            <div className="text-xs text-gray-400">{roleLabel || "Administrador"}</div>
          </div>

          {/* Alerts Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="relative px-4 py-2 text-sm font-medium bg-gray-800 text-white
               rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <span>Alertas</span>
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white
                text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </button>

            {showAlerts && (
              <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl
              shadow-xl border border-gray-200 z-50 overflow-hidden">
                <AlertList alerts={alerts} onSeeAll={seeAll} />
              </div>
            )}
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm font-medium bg-gray-800 text-white
            rounded-lg hover:bg-gray-700 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-2xl cursor-pointer relative"
          aria-label="Menú"
        >
          ☰
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs
             rounded-full h-5 w-5 flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </button>
      </div>

      {/* Tablet sections (md, below lg) */}
      <div className="hidden md:flex lg:hidden max-w-7xl mx-auto px-6 pb-3 gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
              tab === t.id ? "bg-white text-gray-900" : "text-gray-300 hover:text-white hover:bg-gray-800"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <div className="flex flex-col gap-4 px-6 py-4 font-medium">

            {/* User Info Mobile */}
            <div className="pb-3 border-b border-gray-700">
              <div className="font-semibold text-white">{name}</div>
              <div className="text-sm text-gray-400">{roleLabel || "Administrador"}</div>
            </div>

            {/* Sections Mobile */}
            <div className="flex flex-col gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { onTab(t.id); setOpen(false); }}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center gap-3 ${
                    tab === t.id ? "bg-white text-gray-900" : "bg-gray-700 text-white hover:bg-gray-600"
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Alerts Mobile */}
            <button
              onClick={() => { setShowAlerts(!showAlerts); setOpen(false); }}
              className="w-full text-left px-4 py-3 bg-gray-700 text-white
              rounded-lg hover:bg-gray-600 transition-colors flex justify-between
              items-center"
            >
              <span>Alertas</span>
              {alertCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full
                h-6 w-6 flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>

            {/* Logout Mobile */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white
                rounded-lg hover:bg-gray-700 transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Alerts Panel */}
      {showAlerts && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-50" onClick={() => setShowAlerts(false)}>
          <div
            className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Alertas de acceso</h3>
              <button onClick={() => setShowAlerts(false)} className="text-2xl text-gray-500 hover:text-gray-700" aria-label="Cerrar">
                ×
              </button>
            </div>
            <AlertList alerts={alerts} onSeeAll={seeAll} />
          </div>
        </div>
      )}
    </nav>
  );
}