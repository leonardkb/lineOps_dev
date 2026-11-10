import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

// Pestañas del Verificador. VerificadorSection.jsx controla cuál está activa
// y la pasa por props; si el navbar se usa sin props se ve igual que antes.
export const VERIFICADOR_TABS = [
  { key: "correccion", name: "Corrección de producción" },
  { key: "reportes", name: "Reportes semanas bloqueadas" },
];

export default function Navbar({ tabs = [], activeTab = null, onTabChange = null }) {
  const [open, setOpen] = useState(false);

  const menu = [{ name: "Cerrar sesión", path: "/" }];

  const selectTab = (key) => {
    onTabChange?.(key);
    setOpen(false);
  };

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        {/* Title / Brand */}
        <Link to="/" className="text-2xl font-bold">
          Seguimiento de verificador
        </Link>

        {/* Desktop Menu */}
        <ul className="hidden md:flex gap-8 font-medium">
          {menu.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `cursor-pointer transition ${
                    isActive ? "text-green-300" : "hover:text-green-300"
                  }`
                }
              >
                {item.name}
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Hamburger Menu Button */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-2xl cursor-pointer"
          aria-label="Abrir menú"
          aria-expanded={open}
        >
          ☰
        </button>
      </div>

      {/* Tabs (visibles en todos los tamaños; en móvil hacen scroll horizontal) */}
      {tabs.length > 0 && (
        <div className="border-t border-gray-800">
          <div
            role="tablist"
            aria-label="Secciones del verificador"
            className="max-w-7xl mx-auto px-6 flex gap-6 overflow-x-auto"
          >
            {tabs.map((t) => {
              const active = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectTab(t.key)}
                  className={`py-3 text-sm font-medium whitespace-nowrap border-b-2 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 ${
                    active
                      ? "border-green-300 text-green-300"
                      : "border-transparent text-gray-300 hover:text-green-300"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <ul className="flex flex-col gap-4 px-6 py-4 font-medium">
            {menu.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block cursor-pointer ${
                      isActive ? "text-green-300" : "hover:text-green-300"
                    }`
                  }
                >
                  {item.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}