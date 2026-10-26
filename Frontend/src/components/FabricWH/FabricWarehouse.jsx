// components/warehouse/FabricWarehouse.jsx
// Almacén de Tela — page shell + nav bar (same dark style as FinishedWarehouseNav).
//
//   import FabricWarehouse from "./components/warehouse/FabricWarehouse";
//   <Route path="/almacen-tela" element={<FabricWarehouse />} />
//
// Pass initialTab to open a specific section (e.g. the inspection team can land
// on "inspeccion").
import { useState } from "react";
import {
  Layers, LayoutDashboard, CloudDownload, MapPin, ScanLine, Boxes,
  Microscope, Undo2, FileBarChart, LogOut,
} from "lucide-react";
import FabricDashboard from "./FabricDashboard";
import FabricSkytexRequest from "./FabricSkytexRequest";
import FabricLocations from "./FabricLocations";
import FabricReceiveScan from "./FabricReceiveScan";
import FabricInventory from "./FabricInventory";
import FabricInspection from "./FabricInspection";
import FabricSupplierReturns from "./FabricSupplierReturns";
import FabricReports from "./FabricReports";

export const FABRIC_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "solicitar", label: "Solicitar a Skytex", icon: CloudDownload },
  { key: "ubicaciones", label: "Ubicaciones", icon: MapPin },
  { key: "recepcion", label: "Recepción", icon: ScanLine },
  { key: "inventario", label: "Inventario", icon: Boxes },
  { key: "inspeccion", label: "Inspección", icon: Microscope },
  { key: "devoluciones", label: "Devoluciones", icon: Undo2 },
  { key: "reportes", label: "Reportes", icon: FileBarChart },
];

export function FabricWarehouseNav({ active = "dashboard", onNavigate = () => {}, items = FABRIC_NAV_ITEMS }) {
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
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <span className="font-bold tracking-tight hidden lg:inline">Almacén de Tela</span>
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
                      isActive ? "bg-white/10 text-white" : "text-gray-300 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {Icon && <Icon className="w-4 h-4 shrink-0" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden xl:inline text-sm text-gray-300">{name}</span>
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

export default function FabricWarehouse({ initialTab = "dashboard", items = FABRIC_NAV_ITEMS }) {
  const [tab, setTab] = useState(initialTab);
  const props = { onNavigate: setTab };

  return (
    <div className="min-h-screen bg-gray-50">
      <FabricWarehouseNav active={tab} onNavigate={setTab} items={items} />
      {tab === "dashboard" && <FabricDashboard {...props} />}
      {tab === "solicitar" && <FabricSkytexRequest {...props} />}
      {tab === "ubicaciones" && <FabricLocations {...props} />}
      {tab === "recepcion" && <FabricReceiveScan {...props} />}
      {tab === "inventario" && <FabricInventory {...props} />}
      {tab === "inspeccion" && <FabricInspection {...props} />}
      {tab === "devoluciones" && <FabricSupplierReturns {...props} />}
      {tab === "reportes" && <FabricReports {...props} />}
    </div>
  );
}