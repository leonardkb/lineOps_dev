// components/planner/PlanBoard.jsx
import { useState, useEffect } from "react";
import { format, addDays, differenceInDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, LayoutGrid, List, ZoomIn, ZoomOut, Clock, Package, Users } from "lucide-react";

export default function PlanBoard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState("week"); // day, week, month
  const [assignments, setAssignments] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [lineRuns, setLineRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      
      // Fetch assignments
      const assignmentsRes = await fetch("http://localhost:5001/api/line-assignments", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const assignmentsData = await assignmentsRes.json();
      if (assignmentsData.success) {
        setAssignments(assignmentsData.assignments);
      }
      
      // Fetch work orders
      const workOrdersRes = await fetch("http://localhost:5001/api/work-orders", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const workOrdersData = await workOrdersRes.json();
      if (workOrdersData.success) {
        setWorkOrders(workOrdersData.workOrders);
      }
      
      // Fetch line runs (for capacity info)
      const lineRunsRes = await fetch("http://localhost:5001/api/line-runs", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const lineRunsData = await lineRunsRes.json();
      if (lineRunsData.success) {
        setLineRuns(lineRunsData.runs);
      }
      
    } catch (err) {
      console.error("Error fetching plan board data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Get all unique line numbers
  const lines = [...new Set(assignments.map(a => a.line_no))].sort((a, b) => a - b);
  
  // Generate date range based on view mode
  const getDateRange = () => {
    if (viewMode === "day") {
      return [currentDate];
    } else if (viewMode === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    } else {
      // month view - show 5 weeks
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = addDays(start, 34); // 5 weeks
      return eachDayOfInterval({ start, end });
    }
  };

  const dateRange = getDateRange();
  
  // Get assignments for a specific line and date
  const getAssignmentForLineAndDate = (lineNo, date) => {
    return assignments.find(a => {
      if (a.line_no !== lineNo) return false;
      const startDate = new Date(a.planned_start_date);
      const endDate = new Date(a.planned_end_date);
      return date >= startDate && date <= endDate;
    });
  };
  
  // Calculate days remaining for an assignment
  const getDaysRemaining = (assignment) => {
    const endDate = new Date(assignment.planned_end_date);
    const today = new Date();
    const diff = differenceInDays(endDate, today);
    return diff;
  };
  
  // Get status color
  const getStatusColor = (status, daysRemaining) => {
    if (status === 'completed') return 'bg-green-100 border-green-300 text-green-800';
    if (status === 'in_progress') return 'bg-blue-100 border-blue-300 text-blue-800';
    if (daysRemaining < 0) return 'bg-red-100 border-red-300 text-red-800';
    if (daysRemaining <= 2) return 'bg-yellow-100 border-yellow-300 text-yellow-800';
    return 'bg-gray-50 border-gray-200 text-gray-700';
  };
  
  // Navigate
  const goPrevious = () => {
    if (viewMode === "day") {
      setCurrentDate(addDays(currentDate, -1));
    } else if (viewMode === "week") {
      setCurrentDate(addDays(currentDate, -7));
    } else {
      setCurrentDate(addDays(currentDate, -30));
    }
  };
  
  const goNext = () => {
    if (viewMode === "day") {
      setCurrentDate(addDays(currentDate, 1));
    } else if (viewMode === "week") {
      setCurrentDate(addDays(currentDate, 7));
    } else {
      setCurrentDate(addDays(currentDate, 30));
    }
  };
  
  const goToday = () => {
    setCurrentDate(new Date());
  };
  
  // Get line capacity for a specific date
  const getLineCapacity = (lineNo, date) => {
    const lineRun = lineRuns.find(lr => lr.line_no === lineNo && isSameDay(new Date(lr.run_date), date));
    return lineRun ? Math.round(lineRun.target_pcs) : null;
  };
  
  // Calculate total assigned for a line on a date
  const getTotalAssignedForLine = (lineNo, date) => {
    const assignment = getAssignmentForLineAndDate(lineNo, date);
    return assignment ? Math.round(assignment.assigned_quantity) : 0;
  };
  
  // Render assignment card
  const AssignmentCard = ({ assignment, date, lineNo }) => {
    const workOrder = workOrders.find(wo => wo.id === assignment.work_order_id);
    const daysRemaining = getDaysRemaining(assignment);
    const statusColor = getStatusColor(assignment.status, daysRemaining);
    const startDate = new Date(assignment.planned_start_date);
    const endDate = new Date(assignment.planned_end_date);
    const isStartDate = isSameDay(date, startDate);
    const isEndDate = isSameDay(date, endDate);
    
    // Determine display style based on position in the timeline
    let displayStyle = "";
    if (isStartDate && isEndDate) {
      displayStyle = "rounded-md";
    } else if (isStartDate) {
      displayStyle = "rounded-l-md";
    } else if (isEndDate) {
      displayStyle = "rounded-r-md";
    } else {
      displayStyle = "rounded-none";
    }
    
    return (
      <div
        className={`absolute inset-x-1 py-1 px-2 text-xs ${statusColor} border ${displayStyle} cursor-pointer hover:shadow-md transition z-10`}
        style={{
          top: "2px",
          bottom: "2px",
          left: isStartDate ? "4px" : "0",
          right: isEndDate ? "4px" : "0",
        }}
        onClick={() => setSelectedAssignment(assignment)}
        onMouseEnter={() => setHoveredCell({ lineNo, date, assignment })}
        onMouseLeave={() => setHoveredCell(null)}
      >
        <div className="font-medium truncate">{workOrder?.work_order_no}</div>
        <div className="text-xs truncate">
          {Math.round(assignment.assigned_quantity).toLocaleString()} pzas
        </div>
        {isStartDate && (
          <div className="absolute -top-1 left-1 text-[8px] text-gray-500">▶</div>
        )}
        {isEndDate && (
          <div className="absolute -bottom-1 right-1 text-[8px] text-gray-500">◼</div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gray-500">Cargando Plan Board...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Plan Board</h2>
            <p className="text-sm text-gray-600">Visualización de asignaciones por línea y fecha</p>
          </div>
          
          {/* View Controls */}
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode("day")}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  viewMode === "day" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Día
              </button>
              <button
                onClick={() => setViewMode("week")}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  viewMode === "week" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Semana
              </button>
              <button
                onClick={() => setViewMode("month")}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  viewMode === "month" ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Mes
              </button>
            </div>
            
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Hoy
            </button>
            
            <div className="flex gap-1">
              <button
                onClick={goPrevious}
                className="p-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goNext}
                className="p-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        
        {/* Date Range Display */}
        <div className="mt-3 text-sm text-gray-500">
          {viewMode === "day" && format(currentDate, "EEEE, d MMMM yyyy")}
          {viewMode === "week" && `${format(dateRange[0], "d MMM")} - ${format(dateRange[dateRange.length - 1], "d MMM yyyy")}`}
          {viewMode === "month" && format(currentDate, "MMMM yyyy")}
        </div>
      </div>
      
      {/* Plan Board Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Header Row - Dates */}
          <div className="grid border-b" style={{ gridTemplateColumns: `100px repeat(${dateRange.length}, minmax(120px, 1fr))` }}>
            <div className="sticky left-0 bg-white z-20 p-3 font-semibold text-gray-700 border-r">
              Línea / Fecha
            </div>
            {dateRange.map((date, idx) => (
              <div
                key={idx}
                className={`p-3 text-center border-r last:border-r-0 ${
                  isSameDay(date, new Date()) ? "bg-blue-50" : ""
                }`}
              >
                <div className="font-medium text-gray-900">
                  {format(date, "EEE")}
                </div>
                <div className="text-sm text-gray-500">
                  {format(date, "dd/MM")}
                </div>
              </div>
            ))}
          </div>
          
          {/* Lines Rows */}
          {lines.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No hay asignaciones. Asigne órdenes de trabajo a líneas para verlas en el Plan Board.
            </div>
          ) : (
            lines.map(lineNo => (
              <div
                key={lineNo}
                className="grid border-b hover:bg-gray-50 transition"
                style={{ gridTemplateColumns: `100px repeat(${dateRange.length}, minmax(120px, 1fr))` }}
              >
                {/* Line Header */}
                <div className="sticky left-0 bg-white z-10 p-3 border-r font-medium">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-900">Línea {lineNo}</span>
                    <span className="text-xs text-gray-400">
                      {lineRuns.find(lr => lr.line_no === lineNo && isSameDay(new Date(lr.run_date), new Date()))?.target_pcs 
                        ? `${Math.round(lineRuns.find(lr => lr.line_no === lineNo && isSameDay(new Date(lr.run_date), new Date())).target_pcs).toLocaleString()} pzas/día`
                        : 'Sin datos'}
                    </span>
                  </div>
                </div>
                
                {/* Date Cells */}
                {dateRange.map((date, idx) => {
                  const assignment = getAssignmentForLineAndDate(lineNo, date);
                  const capacity = getLineCapacity(lineNo, date);
                  const assignedQty = getTotalAssignedForLine(lineNo, date);
                  const isToday = isSameDay(date, new Date());
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  
                  return (
                    <div
                      key={idx}
                      className={`relative p-2 border-r last:border-r-0 min-h-[80px] ${
                        isToday ? "bg-blue-50" : ""
                      } ${isWeekend ? "bg-gray-50" : ""}`}
                    >
                      {assignment ? (
                        <AssignmentCard
                          assignment={assignment}
                          date={date}
                          lineNo={lineNo}
                        />
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-xs text-gray-400">
                          {capacity && (
                            <span className="text-green-600">
                              {capacity.toLocaleString()} pzas
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Hover Tooltip */}
                      {hoveredCell?.lineNo === lineNo && isSameDay(hoveredCell.date, date) && hoveredCell.assignment && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 w-64 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 pointer-events-none">
                          <div className="font-medium mb-1">{hoveredCell.assignment.work_order_no}</div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Estilo:</span>
                              <span>{hoveredCell.assignment.style_description}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Cantidad:</span>
                              <span>{Math.round(hoveredCell.assignment.assigned_quantity).toLocaleString()} pzas</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Inicio:</span>
                              <span>{format(new Date(hoveredCell.assignment.planned_start_date), "dd/MM/yyyy")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Fin:</span>
                              <span>{format(new Date(hoveredCell.assignment.planned_end_date), "dd/MM/yyyy")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Estado:</span>
                              <span className="capitalize">{hoveredCell.assignment.status}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Legend */}
      <div className="px-5 py-3 border-t bg-gray-50 flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
          <span className="text-gray-600">Completada</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div>
          <span className="text-gray-600">En Progreso</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
          <span className="text-gray-600">Próximo a vencer (≤2 días)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
          <span className="text-gray-600">Atrasada</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-50 border border-gray-200 rounded"></div>
          <span className="text-gray-600">Sin asignación</span>
        </div>
      </div>
      
      {/* Assignment Details Modal */}
      {selectedAssignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h3 className="font-semibold text-gray-900">Detalles de Asignación</h3>
            </div>
            <div className="p-6 space-y-3">
              {(() => {
                const wo = workOrders.find(w => w.id === selectedAssignment.work_order_id);
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Orden:</span>
                      <span className="font-medium">{selectedAssignment.work_order_no}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Estilo:</span>
                      <span>{selectedAssignment.style_description}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Línea:</span>
                      <span>{selectedAssignment.line_no}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Cantidad:</span>
                      <span>{Math.round(selectedAssignment.assigned_quantity).toLocaleString()} pzas</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Inicio:</span>
                      <span>{format(new Date(selectedAssignment.planned_start_date), "dd/MM/yyyy")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Fin:</span>
                      <span>{format(new Date(selectedAssignment.planned_end_date), "dd/MM/yyyy")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Estado:</span>
                      <span className="capitalize">{selectedAssignment.status}</span>
                    </div>
                    {wo && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cliente:</span>
                          <span>{wo.customer_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Total Orden:</span>
                          <span>{Math.round(wo.quantity).toLocaleString()} pzas</span>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="px-6 py-4 border-t flex justify-end">
              <button
                onClick={() => setSelectedAssignment(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}