// components/warehouse/FinishedWarehouseNav.jsx
// Barra de navegación del Almacén de Producto Terminado.
// Mismo estilo que NavCutting (oscura) + pestañas de sección + cerrar sesión.
//
// Controlada por props: pase la sección activa y un handler de navegación.
//   const [tab, setTab] = useState("pre-empaque");
//   <FinishedWarehouseNav active={tab} onNavigate={setTab} />
//
import { Warehouse, LayoutDashboard, ClipboardList, Boxes, LogOut } from "lucide-react";

export const WAREHOUSE_NAV_ITEMS = [
  { key: "dashboard",   label: "Dashboard",   icon: LayoutDashboard },
  { key: "pre-empaque", label: "Pre-empaque", icon: ClipboardList },
  { key: "inventario",  label: "Inventario",  icon: Boxes },
];

export default function FinishedWarehouseNav({
  active = "dashboard",
  onNavigate = () => {},
  items = WAREHOUSE_NAV_ITEMS,
}) {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { user = {}; }
  const name = user.full_name || user.username || "Almacén";

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-14 flex items-center justify-between gap-4">
          {/* Marca + pestañas */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <Warehouse className="w-4 h-4" />
              </div>
              <span className="font-bold tracking-tight hidden sm:inline">Almacén PT</span>
            </div>

            <div className="flex items-center gap-1 ml-1 sm:ml-3 overflow-x-auto no-scrollbar">
              {items.map(({ key, label, icon: Icon }) => {
                const isActive = key === active;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onNavigate(key)}
                    aria-current={isActive ? "page" : undefined}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                      isActive
                        ? "bg-white/10 text-white"
                        : "text-gray-300 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Usuario + cerrar sesión */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline text-sm text-gray-300">{name}</span>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white px-3 py-2 rounded-lg hover:bg-white/10"
            >
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}