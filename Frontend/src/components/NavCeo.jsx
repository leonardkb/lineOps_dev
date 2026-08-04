// NavCeo.jsx - CEO specific side bar (collapsible)
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

export default function NavCeo({ collapsed = false, setCollapsed = () => {} }) {
  const [open, setOpen] = useState(false); // controls the mobile drawer
  const navigate = useNavigate();

  const menu = [
    { name: "Dashboard", path: "/overview", icon: "📊" },
    { name: "Actual Efficiency", path: "/actual-efficiency", icon: "⚡" },
    { name: "Quality Monitor", path: "/quality-monitor", icon: "✓" },
    { name: "Mechanics", path: "/mecanics", icon: "🔧" },
  ];

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 py-3 rounded-lg transition duration-200 border-l-4 ${
      collapsed ? "px-4 md:justify-center md:px-0" : "px-4"
    } ${
      isActive
        ? "bg-blue-500/15 text-blue-400 border-blue-400"
        : "text-gray-300 border-transparent hover:bg-white/5 hover:text-blue-400"
    }`;

  return (
    <>
      {/* Mobile top bar with hamburger (hidden on desktop) */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-gray-900 text-white px-4 py-3 shadow-lg">
        <Link
          to="/overview"
          className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent"
        >
          Skyrina CEO Panel
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="text-2xl cursor-pointer focus:outline-none"
          aria-label="Open menu"
        >
          ☰
        </button>
      </div>

      {/* Backdrop behind the mobile drawer */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar: fixed on desktop, slide-in drawer on mobile */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-64 flex flex-col
          bg-gradient-to-b from-gray-900 to-gray-800 text-white shadow-2xl
          transform transition-all duration-300 md:translate-x-0
          ${collapsed ? "md:w-16" : "md:w-64"}
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand + toggles */}
        <div
          className={`flex items-center justify-between py-5 border-b border-gray-700 ${
            collapsed ? "px-4 md:justify-center md:px-0" : "px-5"
          }`}
        >
          <Link
            to="/overview"
            onClick={() => setOpen(false)}
            className={`text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent ${
              collapsed ? "md:hidden" : ""
            }`}
          >
            Skyrina CEO Panel
          </Link>

          {/* Mobile close (hidden on desktop) */}
          <button
            onClick={() => setOpen(false)}
            className="md:hidden text-xl cursor-pointer focus:outline-none"
            aria-label="Close menu"
          >
            ✕
          </button>

          {/* Desktop collapse / expand toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:inline-flex text-gray-400 hover:text-blue-400 text-xl cursor-pointer focus:outline-none"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expandir" : "Contraer"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1 font-medium">
            {menu.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={linkClass}
                  title={collapsed ? item.name : undefined}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className={collapsed ? "md:hidden" : ""}>{item.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Logout pinned to the bottom */}
        <div className="px-3 py-4 border-t border-gray-700">
          <button
            onClick={() => {
              setOpen(false);
              handleLogout();
            }}
            title={collapsed ? "Cerrar sesión" : undefined}
            className={`flex items-center gap-3 w-full py-3 rounded-lg text-gray-300
              hover:bg-red-500/10 hover:text-red-400 transition duration-200 cursor-pointer ${
                collapsed ? "px-4 md:justify-center md:px-0" : "px-4"
              }`}
          >
            <span className="text-lg">⏻</span>
            <span className={collapsed ? "md:hidden" : ""}>Cerrar sesión</span>
          </button>
        </div>
      </aside>
    </>
  );
}