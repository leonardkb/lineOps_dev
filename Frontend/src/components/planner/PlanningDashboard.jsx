// components/planner/PlanningDashboard.jsx
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar, BarChart3, ClipboardList, AlertTriangle, CheckCircle, Clock } from "lucide-react";

export default function PlanningDashboard() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dashboardData, setDashboardData] = useState(null);
  const [lineLoad, setLineLoad] = useState([]);
  const [upcomingDeadlines, setUpcomingDeadlines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchDashboardData();
    fetchLineLoad();
    fetchUpcomingDeadlines();
  }, [selectedDate]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/dashboard?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setDashboardData(data.summary);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchLineLoad = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/available-lines?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setLineLoad(data.lines);
      }
    } catch (err) {
      console.error("Error fetching line load:", err);
    }
  };

  const fetchUpcomingDeadlines = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `http://localhost:5001/api/planning/dashboard?date=${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success && data.upcomingDeadlines) {
        setUpcomingDeadlines(data.upcomingDeadlines);
      }
    } catch (err) {
      console.error("Error fetching deadlines:", err);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'assigned': return 'bg-blue-100 text-blue-700';
      case 'in_progress': return 'bg-purple-100 text-purple-700';
      case 'completed': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4" />;
      case 'assigned': return <ClipboardList className="w-4 h-4" />;
      case 'in_progress': return <BarChart3 className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      default: return null;
    }
  };

  if (loading && !dashboardData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Cargando dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Dashboard de Planificación</h2>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {dashboardData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Órdenes Totales</p>
                <p className="text-2xl font-bold text-gray-900">
                  {dashboardData.total_work_orders || 0}
                </p>
              </div>
              <ClipboardList className="w-8 h-8 text-gray-400" />
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <span className="text-yellow-600">Pend: {dashboardData.pending_orders || 0}</span>
              <span className="text-blue-600">Asig: {dashboardData.assigned_orders || 0}</span>
              <span className="text-green-600">Comp: {dashboardData.completed_orders || 0}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Cantidad Asignada</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(dashboardData.total_assigned_quantity || 0).toLocaleString()}
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              piezas asignadas para {selectedDate}
            </p>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Utilización</p>
                <p className="text-2xl font-bold text-gray-900">
                  {Math.round(dashboardData.capacity_utilization || 0)}%
                </p>
              </div>
              <div className="w-12 h-12 rounded-full border-4 border-blue-500 flex items-center justify-center">
                <span className="text-sm font-bold text-blue-600">
                  {Math.round(dashboardData.capacity_utilization || 0)}%
                </span>
              </div>
            </div>
            <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(dashboardData.capacity_utilization || 0, 100)}%` }}
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Líneas Activas</p>
                <p className="text-2xl font-bold text-gray-900">
                  {dashboardData.lines_utilized || 0} / {dashboardData.active_lines || 0}
                </p>
              </div>
              <div className="flex -space-x-2">
                {[...Array(Math.min(dashboardData.lines_utilized || 0, 5))].map((_, i) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Line Load Chart */}
      {lineLoad.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="px-5 py-4 border-b">
            <h3 className="font-semibold text-gray-900">Carga por Línea</h3>
            <p className="text-sm text-gray-600">Capacidad vs Asignación para {selectedDate}</p>
          </div>
          <div className="p-5 space-y-4">
            {lineLoad.map(line => (
              <div key={line.line_no}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">Línea {line.line_no}</span>
                  <span className="text-gray-600">
                    {Math.round(line.assigned_quantity || 0)} / {Math.round(line.target_pcs || 0)} piezas
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      (line.utilization_percentage || 0) > 90 ? 'bg-red-500' :
                      (line.utilization_percentage || 0) > 70 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(line.utilization_percentage || 0, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-gray-500">
                    Disponible: {Math.max(0, (line.target_pcs || 0) - (line.assigned_quantity || 0))} pzas
                  </span>
                  <span className="text-gray-500">
                    Utilización: {Math.round(line.utilization_percentage || 0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Deadlines */}
      {upcomingDeadlines.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="px-5 py-4 border-b">
            <h3 className="font-semibold text-gray-900">Próximos Vencimientos</h3>
            <p className="text-sm text-gray-600">Órdenes que terminan en los próximos 3 días</p>
          </div>
          <div className="divide-y">
            {upcomingDeadlines.map(deadline => (
              <div key={deadline.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{deadline.work_order_no}</p>
                  <p className="text-sm text-gray-500">
                    Línea {deadline.line_no} · {deadline.customer_name}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {deadline.assigned_quantity} pzas
                  </p>
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Termina: {format(new Date(deadline.planned_end_date), "dd/MM/yyyy")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}