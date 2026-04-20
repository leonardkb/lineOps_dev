// NavCeo.jsx - CEO specific navigation bar
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";

export default function NavCeo() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const menu = [
    { name: "Dashboard", path: "/overview" },
    { name: "Actual Efficiency", path: "/actual-efficiency" },
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  return (
    <nav className="bg-gradient-to-r from-gray-900 to-gray-800 text-white sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
        
        {/* Title / Brand */}
        <Link to="/overview" className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Skyrina CEO Panel
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
                {item.name}
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
          className="md:hidden text-2xl cursor-pointer focus:outline-none"
          aria-label="Toggle menu"
        >
          {open ? "✕" : "☰"}
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
                  {item.name}
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