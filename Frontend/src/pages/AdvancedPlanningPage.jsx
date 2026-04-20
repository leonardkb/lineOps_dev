// AdvancedPlanningPage.jsx - Complete Fixed Version
import { useState, useEffect } from "react";
import NavPlanner from "../components/planner/NavPlanner";
import PlanningDashboard from "../components/planner/PlanningDashboard";
import WorkOrderList from "../components/planner/WorkOrderList";
import WorkOrderForm from "../components/planner/WorkOrderForm";
import LineAssignmentForm from "../components/planner/LineAssignmentForm";
import { format } from "date-fns";
import PlanBoard from "../components/planner/PlanBoard";

export default function AdvancedPlanningPage() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [message, setMessage] = useState("");

  const [workOrderData, setWorkOrderData] = useState({
    workOrderNo: "",          // Changed from workOrderNumber
    totalQuantity: "",        // Fixed: Changed from quantity
    warehouseStock: "",       // Added
    extraQuantity: "",        // Added
    totalToProduce: "",       // Added
    commitmentDate: "",       // Added
    customerId: "",           // Changed from customerName
    customerName: "",         // Keep for display
    styleDescription: "",     //style description from run  
    color: "",                // color from run
    fabricSupplier: "",       // fabric supplier from run
    styleCode: "",            // style code from run
    lineNo: "",               // line number from run
    runDate: "",              // run date from run
    fabrics: [],              // Added
  });

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserRole(user.role);
  }, []);

  const handleSelectWorkOrder = (workOrder) => {
    setSelectedWorkOrder(workOrder);
    setActiveTab("assign");
  };

  const handleCreateWorkOrder = () => {
    setSelectedWorkOrder(null);
    setWorkOrderData({
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
      lineNo: "",
      runDate: "",
      fabrics: [],
    });
    setActiveTab("create");
  };

  const handleWorkOrderChange = (field, value) => {
    setWorkOrderData(prev => ({ ...prev, [field]: value }));
  };

  const handleStyleSelect = (run) => {
    setSelectedRun(run);
    setWorkOrderData(prev => ({
      ...prev,
      styleDescription: run.style,
      styleCode: run.style,
      lineNo: run.line_no,
      runDate: run.run_date,
    }));
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", visible: true },
    { id: "list", label: "Órdenes", visible: true },
    { id: "planboard", label: "Plan Board", visible: true },
    { id: "create", label: "Crear Orden", visible: ["engineer", "supervisor", "soporte_it", "skyrina", "planner"].includes(userRole) },
    { id: "assign", label: "Asignar", visible: selectedWorkOrder !== null },
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
          <h1 className="text-2xl font-semibold text-gray-900">
            Planificación Avanzada
          </h1>
          <p className="text-sm text-gray-600">
            Gestione órdenes de trabajo y asignaciones a líneas de producción
          </p>
        </div>

        {/* Message Display */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.includes("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2 border-b">
          {tabs.map(tab => tab.visible && (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "text-gray-900 border-b-2 border-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="space-y-6">
          {activeTab === "dashboard" && <PlanningDashboard />}
          {activeTab === "planboard" && <PlanBoard />}
          
          {activeTab === "list" && (
            <WorkOrderList 
              onSelectWorkOrder={handleSelectWorkOrder}
              onEdit={(order) => {
                console.log("Editing order:", order); // Debug log
                setSelectedWorkOrder(order);
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
                  lineNo: order.line_no || "",
                  runDate: order.run_date || "",
                  fabrics: order.fabrics || [],
                });
                setActiveTab("create");
              }}
              onDelete={(id) => {
                setMessage(`✅ Orden cancelada exitosamente`);
              }}
            />
          )}
          
          {activeTab === "create" && (
            <WorkOrderForm
              workOrderData={workOrderData}
              onChange={handleWorkOrderChange}
              selectedRun={selectedRun}
              onSuccess={(updatedOrder) => {
                setMessage(`✅ Orden ${updatedOrder?.work_order_no || ''} ${selectedWorkOrder ? 'actualizada' : 'creada'} exitosamente`);
                setActiveTab("list");
                // Reset form only for create mode, not for edit
                if (!selectedWorkOrder) {
                  setWorkOrderData({
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
                    lineNo: "",
                    runDate: "",
                    fabrics: [],
                  });
                  setSelectedRun(null);
                }
                setSelectedWorkOrder(null);
              }}
              isEditMode={selectedWorkOrder !== null}
              workOrderId={selectedWorkOrder?.id}  // ✅ CRITICAL FIX: Pass the work order ID
            />
          )}
          
          {activeTab === "assign" && selectedWorkOrder && (
            <LineAssignmentForm
              workOrder={selectedWorkOrder}
              onAssignmentComplete={() => {
                setShowAssignmentForm(false);
                setActiveTab("list");
                setSelectedWorkOrder(null);
                setMessage("✅ Asignación completada exitosamente");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}