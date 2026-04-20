import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

export default function NavPlanner() {
  const [open, setOpen] = useState(false);

  const menu = [
    { name: "Planificador de Línea", path: "/advanced-planning" },
    { name: "Cerrar sesión", path: "/" },
    
  ];

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        
        {/* Title / Brand */}
        <Link to="/" className="text-2xl font-bold">
          Seguimiento de Planning
        </Link>

        {/* Desktop Menu */}
        <ul className="hidden md:flex gap-8 font-medium">
          {menu.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `cursor-pointer transition ${
                    isActive
                      ? "text-green-300"
                      : "hover:text-green-300"
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
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block cursor-pointer ${
                      isActive
                        ? "text-green-300"
                        : "hover:text-green-300"
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