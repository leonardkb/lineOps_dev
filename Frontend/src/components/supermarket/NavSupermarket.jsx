// components/supermarket/NavSupermarket.jsx
//
// Barra superior del área de supermercado. Misma estructura que NavPlanner
// (marca a la izquierda, menú a la derecha, hamburguesa en móvil) para que
// moverse entre las dos áreas no se sienta como cambiar de aplicación.

import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

export default function NavSupermarket() {
  const [open, setOpen] = useState(false);

  const menu = [
    { name: "Plan del Supermercado", path: "/supermarket-plan" },
    { name: "Cerrar sesión", path: "/" },
  ];

  // Un solo juego de clases para escritorio y móvil: el estado activo no puede
  // divergir entre los dos menús.
  const linkClass = ({ isActive }) =>
    `cursor-pointer transition ${isActive ? "text-green-300" : "hover:text-green-300"}`;

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

        {/* Title / Brand */}
        <Link to="/supermarket-plan" className="text-2xl font-bold">
          Seguimiento de Supermercado
        </Link>

        {/* Desktop Menu */}
        <ul className="hidden md:flex gap-8 font-medium">
          {menu.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end className={linkClass}>
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

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <ul className="flex flex-col gap-4 px-6 py-4 font-medium">
            {menu.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block cursor-pointer ${isActive ? "text-green-300" : "hover:text-green-300"}`
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