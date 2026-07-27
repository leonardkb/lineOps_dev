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

export default function AdvancedPlanningPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  // "edit" (edit an existing order) or "assign" (assign to a line) — decides
  // which hidden tab is available for the currently selected order.
  const [woMode, setWoMode] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [message, setMessage] = useState("");

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
    { id: "cut", label: "Corte", visible: true },
    // Hidden contextual tabs
    { id: "edit", label: "Editar Orden", visible: woMode === "edit" && selectedWorkOrder !== null },
    { id: "assign", label: "Asignar", visible: woMode === "assign" && selectedWorkOrder !== null },
  ];

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

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Planificación Avanzada</h1>
          <p className="text-sm text-gray-600">
            Gestione órdenes de trabajo y asignaciones a líneas de producción
          </p>
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
        <div className="mb-6 flex flex-wrap gap-2 border-b">
          {tabs.map(
            (tab) =>
              tab.visible && (
                <button
                  key={tab.id}
                  onClick={() => {
                    // The always-visible tabs are not tied to a selected order.
                    if (["dashboard", "list", "planboard", "status", "cut"].includes(tab.id)) {
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

          {activeTab === "planboard" && <PlanBoard />}

          {/* Read-only order status view (assignment happens in Plan Board) */}
          {activeTab === "status" && <OrderStatus />}

          {activeTab === "cut" && <CutOrders />}

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