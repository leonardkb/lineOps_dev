
import { useState, useEffect } from "react";

export default function Alert({ lineNo, selectedDate }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

  // Fetch alerts for the selected line and date
  const fetchAlerts = async () => {
    if (!lineNo || !selectedDate) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const response = await axios.get(
        `${API_BASE}/api/alerts/line/${lineNo}/date/${selectedDate}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data?.success) {
        setAlerts(response.data.alerts || []);
      }
    } catch (error) {
      console.error("Error fetching alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Generate alerts from operator details (client-side alternative)
  const generateAlertsFromOperatorData = (operatorDetails) => {
    if (!operatorDetails || operatorDetails.length === 0) return [];
    
    const alertList = [];
    
    operatorDetails.forEach((operator) => {
      const variance = operator.totalSewed - operator.plannedQty;
      const efficiency = parseFloat(operator.efficiency);
      
      // Alert for negative variance
      if (variance < 0) {
        const severity = Math.abs(variance) > (operator.plannedQty * 0.3) ? "HIGH" : 
                        Math.abs(variance) > (operator.plannedQty * 0.1) ? "MEDIUM" : "LOW";
        
        alertList.push({
          type: "VARIANCE",
          severity,
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          style: operator.style,
          plannedQty: operator.plannedQty,
          sewedQty: operator.totalSewed,
          variance: variance,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has negative variance of ${Math.abs(variance)} pieces for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert for low efficiency
      if (efficiency < 0.8 && efficiency > 0) {
        alertList.push({
          type: "EFFICIENCY",
          severity: efficiency < 0.6 ? "HIGH" : "MEDIUM",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          efficiency: efficiency,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has low efficiency of ${(efficiency * 100).toFixed(1)}% for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
      
      // Alert for zero production
      if (operator.totalSewed === 0 && operator.plannedQty > 0) {
        alertList.push({
          type: "NO_PRODUCTION",
          severity: "HIGH",
          operatorNo: operator.operatorNo,
          operatorName: operator.operatorName,
          operationName: operator.operationName,
          message: `Operator ${operator.operatorNo} (${operator.operatorName}) has zero production for ${operator.operationName}`,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    return alertList;
  };

  // Update alerts when operator details change
  useEffect(() => {
    // If you have operatorDetails prop, generate alerts from it
    // Otherwise fetch from API
  }, [lineNo, selectedDate]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "HIGH": return "bg-red-100 text-red-800 border-red-200";
      case "MEDIUM": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "LOW": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case "VARIANCE": return "⚠️";
      case "EFFICIENCY": return "📊";
      case "NO_PRODUCTION": return "🛑";
      default: return "ℹ️";
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!lineNo || !selectedDate) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 text-center">
        <p className="text-gray-500">Select a line and date to view alerts</p>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center">
          <div className="flex-shrink-0 text-green-500">✅</div>
          <div className="ml-3">
            <p className="text-sm font-medium text-green-800">
              No alerts for Line {lineNo} on {new Date(selectedDate).toLocaleDateString()}
            </p>
            <p className="text-xs text-green-600 mt-1">
              All operators are meeting their targets
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold text-gray-900">Production Alerts</h3>
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>
      
      {alerts.map((alert, index) => (
        <div 
          key={index} 
          className={`border rounded-lg p-4 ${getSeverityColor(alert.severity)}`}
        >
          <div className="flex items-start">
            <div className="flex-shrink-0 text-lg mr-3">
              {getAlertIcon(alert.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-semibold">{alert.message}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-1 bg-white/50 rounded">
                      Operator: {alert.operatorNo}
                    </span>
                    <span className="text-xs px-2 py-1 bg-white/50 rounded">
                      Operation: {alert.operationName}
                    </span>
                    {alert.style && (
                      <span className="text-xs px-2 py-1 bg-white/50 rounded">
                        Style: {alert.style}
                      </span>
                    )}
                    {alert.variance !== undefined && (
                      <span className="text-xs px-2 py-1 bg-white/50 rounded">
                        Variance: {alert.variance}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded ${alert.severity === 'HIGH' ? 'bg-red-200' : alert.severity === 'MEDIUM' ? 'bg-yellow-200' : 'bg-blue-200'}`}>
                  {alert.severity}
                </span>
              </div>
              {alert.timestamp && (
                <p className="text-xs text-gray-600 mt-2">
                  {new Date(alert.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}