// NavFactoryDirector.jsx - Factory Director navigation bar
// Same menu, badges and permissions as the CEO panel (NavCeo.jsx). On the
// backend the "factory_director" role is aliased to "master" (see ROLE_ALIASES
// in server1.js), so every screen and approval below works exactly as for the CEO.
import { useState, useEffect, useCallback } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { API_URL } from "../lib/masterCodeCatalog";

const LAST_SEEN_KEY = "actualEff_lastSeen_factory_director";

export default function NavFactoryDirector() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Pending efficiency-change requests waiting for CEO approval → badge on
  // "Plan Analytics". Counts BOTH sources:
  //   • /api/efficiency-change-requests    (older efficiency permissions)
  //   • /api/planner/style-eff-requests    (Plan Board style standards, general or per line)
  // Refreshed on mount, on window focus, every 60s, and whenever the efficiency
  // screens dispatch "efficiency-permissions-updated".
  const [pendingEff, setPendingEff] = useState(0);

  // Mensajes de baja eficiencia enviados por los jefes de línea (modal 4:45 pm)
  // → badge en "Actual Efficiency". Se cuentan los NO vistos de CUALQUIER día:
  // los que tienen updated_at posterior a la última vez que el CEO abrió esa
  // pantalla (guardado en localStorage como LAST_SEEN_KEY).
  const [pendingReasons, setPendingReasons] = useState(0);

  const loadPending = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    // Each source is counted on its own: if one fails, the other still shows.
    const count = async (url, pick) => {
      try {
        const res = await fetch(`${API_URL}${url}`, { headers });
        const data = await res.json().catch(() => null);
        return data?.success ? Number(pick(data)) || 0 : null;
      } catch {
        return null;
      }
    };
    const [legacy, styleStd] = await Promise.all([
      count("/api/efficiency-change-requests?status=pending", (d) => d.pendingCount ?? (d.requests?.length || 0)),
      count("/api/planner/style-eff-requests?status=pending", (d) => d.requests?.length || 0),
    ]);
    if (legacy == null && styleStd == null) return; // both failed — keep the last value
    setPendingEff((legacy || 0) + (styleStd || 0));
  }, []);

  const loadReasons = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      // Sin filtro de fecha: incluye también mensajes NO vistos de días previos.
      const res = await fetch(`${API_URL}/api/efficiency-reasons`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        const rows = Array.isArray(data.reasons) ? data.reasons : [];
        // Mientras el CEO está en la pantalla, todo cuenta como visto.
        if (location.pathname === "/actual-efficiency") {
          localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
          setPendingReasons(0);
          return;
        }
        const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
        const unseen = rows.filter((r) => {
          const t = new Date(r.updated_at).getTime();
          return Number.isFinite(t) ? t > lastSeen : true;
        }).length;
        setPendingReasons(unseen);
      }
    } catch {
      /* ignore — badge just won't update */
    }
  }, [location.pathname]);

  useEffect(() => {
    loadPending();
    loadReasons();
    const id = setInterval(() => {
      loadPending();
      loadReasons();
    }, 60000);
    const onFocus = () => {
      loadPending();
      loadReasons();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("efficiency-permissions-updated", loadPending);
    window.addEventListener("efficiency-reasons-updated", loadReasons);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("efficiency-permissions-updated", loadPending);
      window.removeEventListener("efficiency-reasons-updated", loadReasons);
    };
  }, [loadPending, loadReasons]);

  // Al entrar a "Actual Efficiency", marca los mensajes como vistos y apaga el badge.
  useEffect(() => {
    if (location.pathname === "/actual-efficiency") {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      setPendingReasons(0);
    }
  }, [location.pathname]);

  const menu = [
    { name: "Production Monitor", path: "/overview" },
    { name: "Actual Efficiency", path: "/actual-efficiency", badge: "reasons" },
    { name: "Plan Analytics", path: "/planner-analytics", badge: "eff" },
    { name: "Quality Monitor", path: "/quality-monitor" },
    { name: "Mechanics", path: "/mecanics" },
    { name: "Merchant Analytics", path: "/merchant-analytics" },
    { name: "Cut-Analytics", path: "/cut-order-analytics" },
    { name: "FWH-Analytics", path: "/fwh-analytics" },
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  // Cuenta y tooltip por tipo de badge del item de menú.
  const badgeFor = (item) => {
    if (item.badge === "eff") {
      return {
        count: pendingEff,
        title: `${pendingEff} solicitud(es) de eficiencia pendiente(s)`,
      };
    }
    if (item.badge === "reasons") {
      return {
        count: pendingReasons,
        title: `${pendingReasons} mensaje(s) de líneas por baja eficiencia`,
      };
    }
    return null;
  };

  const Badge = ({ count = 0, title = "", className = "" }) =>
    count > 0 ? (
      <span
        title={title}
        className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none ${className}`}
      >
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  const anyPending = pendingEff > 0 || pendingReasons > 0;

  return (
    <nav className="bg-gradient-to-r from-gray-900 to-gray-800 text-white sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
        
        {/* Title / Brand */}
        <Link to="/overview" className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Skyrina Factory Director Panel
        </Link>

        {/* Desktop Menu */}
        <ul className="hidden md:flex gap-6 lg:gap-8 font-medium">
          {menu.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `cursor-pointer transition duration-200 ${
                    isActive
                      ? "text-blue-400 border-b-2 border-blue-400 pb-1"
                      : "hover:text-blue-400 hover:border-b-2 hover:border-blue-400 pb-1"
                  }`
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.name}
                  {item.badge && <Badge {...badgeFor(item)} />}
                </span>
              </NavLink>
            </li>
          ))}
          <li>
            <button
              onClick={handleLogout}
              className="cursor-pointer transition duration-200 hover:text-red-400"
            >
              Cerrar sesión
            </button>
          </li>
        </ul>

        {/* Hamburger Menu Button */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-2xl cursor-pointer focus:outline-none relative"
          aria-label="Toggle menu"
        >
          {open ? "✕" : "☰"}
          {/* Dot on the hamburger so pending items are visible while collapsed */}
          {!open && anyPending && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden border-t border-gray-700">
          <ul className="flex flex-col gap-3 px-6 py-4 font-medium">
            {menu.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block py-2 cursor-pointer transition duration-200 ${
                      isActive
                        ? "text-blue-400 border-l-4 border-blue-400 pl-3"
                        : "hover:text-blue-400 hover:border-l-4 hover:border-blue-400 hover:pl-3"
                    }`
                  }
                >
                  <span className="inline-flex items-center gap-2">
                    {item.name}
                    {item.badge && <Badge {...badgeFor(item)} />}
                  </span>
                </NavLink>
              </li>
            ))}
            <li className="pt-2 border-t border-gray-700">
              <button
                onClick={() => {
                  setOpen(false);
                  handleLogout();
                }}
                className="block w-full text-left py-2 cursor-pointer transition duration-200 hover:text-red-400"
              >
                Cerrar sesión
              </button>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}