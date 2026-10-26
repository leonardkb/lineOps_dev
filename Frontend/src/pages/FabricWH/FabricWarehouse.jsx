// pages/FabricWH/FabricWarehouse.jsx
// Almacén de Tela — page shell: side menu (collapsible), top bar, toasts,
// confirm dialogs, roll detail drawer and one URL per section.
//
// App.jsx:
//   <Route path="/fabric-warehouse" element={<FabricWarehouse />} />
//   <Route path="/fabric-warehouse/:tab" element={<FabricWarehouse />} />
//
//   /fabric-warehouse               Dashboard
//   /fabric-warehouse/recepcion     Recepción
//   /fabric-warehouse/inventario    Inventario
//   /fabric-warehouse/solicitar     Solicitar a Skytex
//   /fabric-warehouse/ubicaciones   Ubicaciones
//   /fabric-warehouse/inspeccion    Inspección
//   /fabric-warehouse/devoluciones  Devoluciones
//   /fabric-warehouse/reportes      Reportes
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import FabricWarehouseNav, {
  FabricTopbar, useSidebarState, SIDEBAR_W,
} from "../../components/FabricWH/FabricWarehouseNav";
import { FabricUIProvider, api } from "../../components/FabricWH/fabricShared";
import FabricDashboard from "../../components/FabricWH/FabricDashboard";
import FabricSkytexRequest from "../../components/FabricWH/FabricSkytexRequest";
import FabricLocations from "../../components/FabricWH/FabricLocations";
import FabricReceiveScan from "../../components/FabricWH/FabricReceiveScan";
import FabricInventory from "../../components/FabricWH/FabricInventory";
import FabricInspection from "../../components/FabricWH/FabricInspection";
import FabricSupplierReturns from "../../components/FabricWH/FabricSupplierReturns";
import FabricReports from "../../components/FabricWH/FabricReports";

export const FABRIC_BASE_PATH = "/fabric-warehouse";

const SECTIONS = {
  dashboard: FabricDashboard,
  recepcion: FabricReceiveScan,
  inventario: FabricInventory,
  solicitar: FabricSkytexRequest,
  ubicaciones: FabricLocations,
  inspeccion: FabricInspection,
  devoluciones: FabricSupplierReturns,
  reportes: FabricReports,
};

export default function FabricWarehouse() {
  const { tab = "dashboard" } = useParams();
  const navigate = useNavigate();
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebarState();
  const [badges, setBadges] = useState({});
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Pending-work counters for the side menu. Refreshed on navigation, when a
  // screen reports a change (notifyChange) and every minute.
  const loadBadges = useCallback(async () => {
    try {
      const d = await api("/dashboard");
      const b = d.dashboard || {};
      setBadges({
        noLocation: b.byStatus?.requested?.rolls || 0,
        arriving: b.byStatus?.assigned?.rolls || 0,
        inspection: b.openInspectionRequests || 0,
        aged: b.aging?.rolls || 0,
      });
    } catch { /* badges are optional */ }
  }, []);
  useEffect(() => { loadBadges(); }, [loadBadges, tab]);
  useEffect(() => {
    const t = setInterval(loadBadges, 60000);
    window.addEventListener("fabric:changed", loadBadges);
    return () => { clearInterval(t); window.removeEventListener("fabric:changed", loadBadges); };
  }, [loadBadges]);

  const goTo = useCallback((key) => {
    navigate(key === "dashboard" ? FABRIC_BASE_PATH : `${FABRIC_BASE_PATH}/${key}`);
    window.scrollTo(0, 0);
  }, [navigate]);

  if (!localStorage.getItem("token")) return <Navigate to="/" replace />;
  if (!SECTIONS[tab]) return <Navigate to={FABRIC_BASE_PATH} replace />;

  const Section = SECTIONS[tab];
  const padLeft = isDesktop ? (collapsed ? SIDEBAR_W.closed : SIDEBAR_W.open) : 0;

  return (
    <FabricUIProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <FabricWarehouseNav
          active={tab}
          onNavigate={goTo}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          badges={badges}
        />
        <div className="transition-[padding] duration-200 ease-out" style={{ paddingLeft: padLeft }}>
          <FabricTopbar
            active={tab}
            onNavigate={goTo}
            onOpenMobile={() => setMobileOpen(true)}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
          />
          <main className="px-4 sm:px-6 lg:px-8 py-6 pb-28">
            <div className="max-w-[1400px] mx-auto">
              <Section key={tab} onNavigate={goTo} />
            </div>
          </main>
        </div>
      </div>
    </FabricUIProvider>
  );
}