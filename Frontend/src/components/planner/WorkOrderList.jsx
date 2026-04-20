// components/planner/WorkOrderList.jsx - Debugged Version
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { 
  Eye, 
  Edit, 
  Trash2, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Calendar, 
  Factory, 
  AlertTriangle,
  RefreshCw
} from "lucide-react";

export default function WorkOrderList({ onSelectWorkOrder, onEdit, onDelete }) {
  const [workOrders, setWorkOrders] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => {
    fetchWorkOrders();
    fetchAssignments();
  }, [filter]);

  const fetchWorkOrders = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      let url = "http://localhost:5001/api/work-orders";
      if (filter !== "all") {
        url += `?status=${filter}`;
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setWorkOrders(data.workOrders);
        console.log("Work Orders loaded:", data.workOrders.length);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignments = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/line-assignments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setAssignments(data.assignments);
        console.log("Assignments loaded:", data.assignments.length);
        
        // Debug: Show assignments by work order
        const assignmentMap = {};
        data.assignments.forEach(a => {
          if (!assignmentMap[a.work_order_id]) {
            assignmentMap[a.work_order_id] = [];
          }
          assignmentMap[a.work_order_id].push(a);
        });
        console.log("Assignments by work order:", assignmentMap);
        setDebugInfo(assignmentMap);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    }
  };

  // Add this function before the return statement in WorkOrderList.jsx
const deleteWorkOrder = async (id) => {
  if (!confirm("¿Está seguro de cancelar esta orden?")) return;
  try {
    const token = localStorage.getItem("token");
    const response = await fetch(`http://localhost:5001/api/work-orders/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (data.success) {
      fetchWorkOrders();
      if (onDelete) onDelete(id);
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
};

  const recalculateStatuses = async () => {
    setRefreshing(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch("http://localhost:5001/api/work-orders/recalculate-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        await fetchWorkOrders();
        await fetchAssignments();
        alert(data.message);
      } else {
        alert(data.error || "Error refreshing statuses");
      }
    } catch (err) {
      alert("Error refreshing statuses: " + err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const getWorkOrderAssignments = (workOrderId) => {
    const found = assignments.filter(a => a.work_order_id === workOrderId);
    console.log(`Assignments for work order ${workOrderId}:`, found.length);
    return found;
  };

  const calculateWorkOrderStatus = (workOrder) => {
    const assignmentsList = getWorkOrderAssignments(workOrder.id);
    
    // Calculate total assigned quantity
    let totalAssigned = 0;
    assignmentsList.forEach(a => {
      const qty = parseFloat(a.assigned_quantity) || 0;
      totalAssigned += qty;
    });
    
    const totalQuantity = parseFloat(workOrder.quantity) || 0;
    const remaining = Math.max(0, totalQuantity - totalAssigned);
    
    // Determine correct status based on assignments
    let correctStatus = workOrder.status;
    
    if (totalAssigned >= totalQuantity && totalQuantity > 0) {
      // All pieces are assigned - should be completed
      correctStatus = 'completed';
    } else if (totalAssigned > 0) {
      // Some pieces assigned but not all
      correctStatus = 'assigned';
    } else {
      // No pieces assigned
      correctStatus = 'pending';
    }
    
    // If work order is cancelled, keep it as cancelled
    if (workOrder.status === 'cancelled') {
      correctStatus = 'cancelled';
    }
    
    console.log(`Work Order ${workOrder.work_order_no}: Total=${totalQuantity}, Assigned=${totalAssigned}, Status=${correctStatus}`);
    
    return {
      totalAssigned: Math.round(totalAssigned),
      remaining: Math.round(remaining),
      completionPercentage: totalQuantity > 0 ? (totalAssigned / totalQuantity) * 100 : 0,
      correctStatus,
      isFullyAssigned: totalAssigned >= totalQuantity && totalQuantity > 0,
      hasAssignments: totalAssigned > 0,
      assignmentsCount: assignmentsList.length
    };
  };

  const calculateDaysNeeded = (workOrder, statusInfo) => {
    // Get daily production rate from assignments
    const assignmentsList = getWorkOrderAssignments(workOrder.id);
    let dailyRate = 500; // Default fallback
    
    if (assignmentsList.length > 0) {
      // Use the most recent assignment's production rate
      const lastAssignment = assignmentsList[assignmentsList.length - 1];
      dailyRate = lastAssignment?.required_production_rate || 500;
    }
    
    const remaining = statusInfo.remaining;
    const daysNeeded = remaining > 0 ? Math.ceil(remaining / dailyRate) : 0;
    
    return {
      daysNeeded,
      dailyRate: Math.round(dailyRate),
      remaining: statusInfo.remaining,
      totalAssigned: statusInfo.totalAssigned,
      completionPercentage: statusInfo.completionPercentage
    };
  };

  const updateStatus = async (id, newStatus) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`http://localhost:5001/api/work-orders/${id}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await response.json();
      if (data.success) {
        fetchWorkOrders();
        fetchAssignments();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const getStatusBadge = (status, statusInfo) => {
    // Use corrected status from calculation
    const displayStatus = statusInfo.correctStatus;
    
    const config = {
      pending: { color: "bg-yellow-100 text-yellow-700", icon: <Clock className="w-3 h-3" />, label: "Pendiente" },
      assigned: { color: "bg-blue-100 text-blue-700", icon: <Factory className="w-3 h-3" />, label: "Asignada" },
      in_progress: { color: "bg-purple-100 text-purple-700", icon: <Calendar className="w-3 h-3" />, label: "En Progreso" },
      completed: { color: "bg-green-100 text-green-700", icon: <CheckCircle className="w-3 h-3" />, label: "Completada" },
      cancelled: { color: "bg-red-100 text-red-700", icon: <XCircle className="w-3 h-3" />, label: "Cancelada" },
    };
    
    const c = config[displayStatus] || config.pending;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.color}`}>
        {c.icon}
        {c.label}
      </span>
    );
  };

  const filteredOrders = workOrders.filter(order => {
    const matchesSearch = searchTerm === "" || 
      order.work_order_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.style_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.customer_name && order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesSearch;
  });

  // Sort orders: pending first, then assigned, then completed
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const statusOrder = { pending: 0, assigned: 1, in_progress: 2, completed: 3, cancelled: 4 };
    const statusA = calculateWorkOrderStatus(a).correctStatus;
    const statusB = calculateWorkOrderStatus(b).correctStatus;
    return (statusOrder[statusA] || 5) - (statusOrder[statusB] || 5);
  });

  return (
    <div className="bg-white rounded-xl border">
      <div className="px-5 py-4 border-b">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Órdenes de Trabajo</h2>
            <p className="text-sm text-gray-600">
              {filteredOrders.length} órdenes encontradas | {assignments.length} asignaciones cargadas
            </p>
          </div>
          <button
            onClick={recalculateStatuses}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Actualizar Estados
          </button>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Buscar por número, estilo o cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", "pending", "assigned", "in_progress", "completed"].map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  filter === status
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {status === "all" ? "Todas" : 
                 status === "pending" ? "Pendientes" :
                 status === "assigned" ? "Asignadas" :
                 status === "in_progress" ? "En Progreso" : "Completadas"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500">Cargando órdenes...</div>
      ) : error ? (
        <div className="p-8 text-center text-red-500">{error}</div>
      ) : sortedOrders.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No hay órdenes de trabajo
          <button
            onClick={recalculateStatuses}
            className="block mx-auto mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
          >
            Actualizar Estados
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {sortedOrders.map((order) => {
            const statusInfo = calculateWorkOrderStatus(order);
            const daysInfo = calculateDaysNeeded(order, statusInfo);
            const assignmentsList = getWorkOrderAssignments(order.id);
            
            return (
              <div key={order.id} className="p-4 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="font-medium text-gray-900">{order.work_order_no}</span>
                      {getStatusBadge(order.status, statusInfo)}
                      {statusInfo.isFullyAssigned && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3" />
                          100% Completado
                        </span>
                      )}
                      {statusInfo.completionPercentage > 0 && !statusInfo.isFullyAssigned && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">
                          <Factory className="w-3 h-3" />
                          {Math.round(statusInfo.completionPercentage)}% Completado
                        </span>
                      )}
                      {statusInfo.assignmentsCount === 0 && statusInfo.totalAssigned > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">
                          <AlertTriangle className="w-3 h-3" />
                          Datos Inconsistentes
                        </span>
                      )}
                    </div>
                    
                    {/* Style Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm mb-3">
                      <div>
                        <span className="text-gray-500">Estilo:</span>
                        <span className="ml-1 text-gray-700 font-medium">
                          {order.style_description || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Cliente:</span>
                        <span className="ml-1 text-gray-700">
                          {order.customer_name || "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Cantidad:</span>
                        <span className="ml-1 font-semibold text-gray-900">
                          {Math.round(order.quantity).toLocaleString()} pzas
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Línea(s):</span>
                        <span className="ml-1 text-gray-700">
                          {assignmentsList.length > 0 
                            ? [...new Set(assignmentsList.map(a => a.line_no))].join(', ')
                            : statusInfo.totalAssigned > 0 ? "Datos pendientes de carga" : "No asignada"}
                        </span>
                      </div>
                    </div>
                    
                    {/* Days Calculation Section */}
                    <div className="bg-gray-50 rounded-lg p-3 mt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className="text-xs font-medium text-gray-700">
                          Estimación de Producción
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-gray-500">Días necesarios:</span>
                          <span className="ml-1 font-semibold text-blue-600">
                            {daysInfo.daysNeeded > 0 ? `${daysInfo.daysNeeded} días` : 'Completado'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ritmo diario:</span>
                          <span className="ml-1 font-medium">
                            {Math.round(daysInfo.dailyRate).toLocaleString()} pzas/día
                          </span>
                        </div>
                        {daysInfo.remaining > 0 && (
                          <div>
                            <span className="text-gray-500">Pendiente:</span>
                            <span className="ml-1 font-medium text-orange-600">
                              {Math.round(daysInfo.remaining).toLocaleString()} pzas
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="text-gray-500">Asignaciones:</span>
                          <span className="ml-1 font-medium">
                            {assignmentsList.length} {assignmentsList.length === 1 ? 'asignación' : 'asignaciones'}
                          </span>
                        </div>
                      </div>
                      
                      {/* Progress Bar */}
                      {statusInfo.completionPercentage > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                statusInfo.isFullyAssigned ? 'bg-green-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${Math.min(statusInfo.completionPercentage, 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between mt-1 text-xs">
                            <span className="text-gray-500">
                              {Math.round(statusInfo.totalAssigned).toLocaleString()} pzas asignadas
                            </span>
                            <span className="text-gray-500">
                              {Math.round(order.quantity).toLocaleString()} pzas totales
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Created Date */}
                    <div className="mt-2 text-xs text-gray-400">
                      Creada: {format(new Date(order.created_at), "dd/MM/yyyy HH:mm")}
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => onSelectWorkOrder && onSelectWorkOrder(order)}
                      className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                      title="Ver detalles / Asignar"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {!statusInfo.isFullyAssigned && order.status !== "cancelled" && (
                      <>
                        <button
                          onClick={() => onEdit && onEdit(order)}
                          className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => updateStatus(order.id, "completed")}
                          className="p-2 text-gray-500 hover:text-green-600 rounded-lg hover:bg-gray-100"
                          title="Marcar completada"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    {order.status !== "completed" && order.status !== "cancelled" && (
                      <button
                        onClick={() => deleteWorkOrder(order.id)}
                        className="p-2 text-gray-500 hover:text-red-600 rounded-lg hover:bg-gray-100"
                        title="Cancelar orden"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}