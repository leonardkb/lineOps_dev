// AdvancedPlanningPage.jsx - Complete Fixed Version
import { useState, useEffect } from "react";
import NavPlanner from "../components/planner/NavPlanner";
import PlanningDashboard from "../components/planner/PlanningDashboard";
import WorkOrderList from "../components/planner/WorkOrderList";
import WorkOrderForm from "../components/planner/WorkOrderForm";
import OrderStatus from "../components/planner/OrderStatus";
import CutOrders from "../components/planner/CutOrders";
import LineAssignmentForm from "../components/planner/LineAssignmentForm";
import PlanBoard from "../components/planner/PlanBoard";
import HolidaysManager from "../components/planner/HolidaysManager";
// Daily line efficiency (same screen as the Skyrina page, compact embedded mode)
import SkyrinaDashboard from "./SkyrinaDashboard";

// Tabs that stand on their own — switching to one drops the selected order.
const STANDALONE_TABS = ["dashboard", "list", "planboard", "status", "efficiency", "cut", "holidays"];

export default function AdvancedPlanningPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  // "edit" (edit an existing order) or "assign" (assign to a line) — decides
  // which hidden tab is available for the currently selected order.
  const [woMode, setWoMode] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [message, setMessage] = useState("");
  // Which board the "Plan Board" tab shows: the real plan or the customer
  // forecast. Remembered per browser.
  const [boardMode, setBoardMode] = useState(() => {
    try { return localStorage.getItem("planboard.mode") === "forecast" ? "forecast" : "plan"; } catch { return "plan"; }
  });
  const changeBoardMode = (m) => {
    setBoardMode(m);
    try { localStorage.setItem("planboard.mode", m); } catch { /* ignore */ }
  };

  const [workOrderData, setWorkOrderData] = useState({
    workOrderNo: "",
    totalQuantity: "",
    warehouseStock: "",
    extraQuantity: "",
    totalToProduce: "",
    commitmentDate: "",
    customerId: "",
    customerName: "",
    styleDescription: "",
    color: "",
    fabricSupplier: "",
    styleCode: "",
    estilo: "",
    lineNo: "",
    runDate: "",
    fabrics: [],
    masterCodeId: "",
    samMinutes: "",
  });

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserRole(user.role);
  }, []);

  // From the list: assign a work order to a line.
  const handleSelectWorkOrder = (workOrder) => {
    setSelectedWorkOrder(workOrder);
    setWoMode("assign");
    setActiveTab("assign");
  };

  const clearSelection = () => {
    setSelectedWorkOrder(null);
    setWoMode(null);
  };

  const handleWorkOrderChange = (field, value) => {
    setWorkOrderData((prev) => ({ ...prev, [field]: value }));
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", visible: true },
    { id: "list", label: "Órdenes", visible: true },
    { id: "planboard", label: "Plan Board", visible: true },
    { id: "status", label: "Estado de Órdenes", visible: true },
    { id: "efficiency", label: "Eficiencia Diaria", visible: true },
    { id: "cut", label: "Corte", visible: true },
    { id: "holidays", label: "Días Festivos", visible: true },
    // Hidden contextual tabs
    { id: "edit", label: "Editar Orden", visible: woMode === "edit" && selectedWorkOrder !== null },
    { id: "assign", label: "Asignar", visible: woMode === "assign" && selectedWorkOrder !== null },
  ];

  const isEfficiencyTab = activeTab === "efficiency";

  // Clear message after 5 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavPlanner />

      {/* The efficiency board uses the full width and a tighter header so all
          lines fit on screen without scrolling. */}
      <div
        className={`mx-auto ${
          isEfficiencyTab ? "max-w-[1920px] px-4 pt-3 pb-0" : "max-w-7xl p-4 sm:p-6"
        }`}
      >
        <div className={isEfficiencyTab ? "mb-2" : "mb-6"}>
          <h1 className={`${isEfficiencyTab ? "text-lg" : "text-2xl"} font-semibold text-gray-900`}>
            Planificación Avanzada
          </h1>
          {!isEfficiencyTab && (
            <p className="text-sm text-gray-600">
              Gestione órdenes de trabajo y asignaciones a líneas de producción
            </p>
          )}
        </div>

        {/* Message Display */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className={`${isEfficiencyTab ? "mb-3" : "mb-6"} flex flex-wrap gap-2 border-b`}>
          {tabs.map(
            (tab) =>
              tab.visible && (
                <button
                  key={tab.id}
                  onClick={() => {
                    // The always-visible tabs are not tied to a selected order.
                    if (STANDALONE_TABS.includes(tab.id)) {
                      clearSelection();
                    }
                    setActiveTab(tab.id);
                  }}
                  className={`px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "text-gray-900 border-b-2 border-gray-900"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              )
          )}
        </div>

        {/* Content */}
        <div className="space-y-6">
          {activeTab === "dashboard" && <PlanningDashboard />}

          {/* Plan Board / Pronóstico: the selector sits in the board's own title.
              `key` remounts the board so each one loads only its own data. */}
          {activeTab === "planboard" && (
            <PlanBoard key={boardMode} mode={boardMode} onModeChange={changeBoardMode} />
          )}

          {/* Read-only order status view (assignment happens in Plan Board) */}
          {activeTab === "status" && <OrderStatus />}

          {/* Daily line efficiency — read-only, auto-refreshes every 5 min */}
          {activeTab === "efficiency" && <SkyrinaDashboard embedded />}

          {activeTab === "cut" && <CutOrders />}

          {/* Non-working days: block them here, the Plan Board honours them */}
          {activeTab === "holidays" && <HolidaysManager />}

          {/* Efficiency changes are made per style / line from the Plan Board's
              style standard form (sent to the CEO for approval). */}

          {activeTab === "list" && (
            <WorkOrderList
              onSelectWorkOrder={handleSelectWorkOrder}
              onEdit={(order) => {
                setSelectedWorkOrder(order);
                setWoMode("edit");
                setWorkOrderData({
                  workOrderNo: order.work_order_no,
                  totalQuantity: order.total_quantity || order.quantity,
                  warehouseStock: order.warehouse_stock || 0,
                  extraQuantity: order.extra_quantity || 0,
                  totalToProduce: order.total_to_produce || order.quantity,
                  commitmentDate: order.commitment_date,
                  customerId: order.customer_id,
                  customerName: order.customer_name,
                  styleDescription: order.style_description,
                  color: order.color || "",
                  fabricSupplier: order.fabric_supplier || "",
                  styleCode: order.style_code || "",
                  estilo: order.estilo || "",
                  lineNo: order.line_no || "",
                  runDate: order.run_date || "",
                  fabrics: order.fabrics || [],
                  masterCodeId: order.master_code_id || "",
                  samMinutes: order.sam_minutes || "",
                });
                setActiveTab("edit");
              }}
              onDelete={() => {
                setMessage(`✅ Orden cancelada exitosamente`);
              }}
            />
          )}

          {/* Edit an existing order */}
          {activeTab === "edit" && selectedWorkOrder && (
            <WorkOrderForm
              workOrderData={workOrderData}
              onChange={handleWorkOrderChange}
              selectedRun={null}
              onSuccess={(updatedOrder) => {
                setMessage(
                  `✅ Orden ${updatedOrder?.work_order_no || ""} actualizada exitosamente`
                );
                clearSelection();
                setActiveTab("list");
              }}
              isEditMode={true}
              workOrderId={selectedWorkOrder?.id}
            />
          )}

          {/* Assign a selected order to a line (alternative to Plan Board) */}
          {activeTab === "assign" && selectedWorkOrder && (
            <LineAssignmentForm
              workOrder={selectedWorkOrder}
              onAssignmentComplete={() => {
                setMessage("✅ Asignación completada exitosamente");
                clearSelection();
                setActiveTab("list");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}