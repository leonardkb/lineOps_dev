import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "./Alert"; // Import the Alert component

export default function NavAdmin({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const navigate = useNavigate();

  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

  // Fetch alert count
  const fetchAlertCount = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const response = await fetch(`${API_BASE}/api/supervisor/alert-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAlertCount(data.count || 0);
        }
      }
    } catch (error) {
      console.error("Error fetching alert count:", error);
    }
  };

  useEffect(() => {
    fetchAlertCount();

    // Refresh alert count every 2 minutes
    const interval = setInterval(fetchAlertCount, 2 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    }
  };

  return (
    <nav className="bg-gray-900 text-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

        {/* Title */}
        <div className="text-2xl font-bold">
          Panel de Supervisor
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-6 font-medium">

          {/* User Info */}
          <div className="text-sm text-gray-200">
            <div className="font-semibold">
              {user?.full_name || user?.username || "Supervisor"}
            </div>
            <div className="text-xs text-gray-400">
              Supervisor
            </div>
          </div>

          {/* Alerts Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="relative px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <span>Alertas</span>

              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </button>

            {/* Alerts Dropdown Menu */}
            {showAlerts && (
              <div className="absolute right-0 mt-2 
              w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50">
                <Alert supervisorMode={true} />
              </div>
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin")}
              className="px-4 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Ir al panel
            </button>

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium border border-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden text-2xl cursor-pointer relative"
        >
          ☰
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 
            bg-red-500 text-white text-xs rounded-full
             h-5 w-5 flex items-center justify-center">
              {alertCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {open && (
        <div className="bg-gray-800 md:hidden">
          <div className="flex flex-col gap-4 px-6 py-4 font-medium">

            {/* User Info Mobile */}
            <div className="pb-3 border-b border-gray-700">
              <div className="font-semibold text-white">
                {user?.full_name || user?.username || "Supervisor"}
              </div>
              <div className="text-sm text-gray-400">
                Supervisor
              </div>
            </div>

            {/* Alerts Mobile */}
            <button
              onClick={() => {
                setShowAlerts(!showAlerts);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors flex justify-between items-center"
            >
              <span>Alertas</span>

              {alertCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center">
                  {alertCount}
                </span>
              )}
            </button>

            {/* Navigation Buttons Mobile */}
            <button
              onClick={() => {
                navigate("/admin");
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              Ir al panel
            </button>

            <button
              onClick={() => {
                handleLogout();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 border border-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {/* Mobile Alerts Panel */}
      {showAlerts && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-50">
          <div className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">

                <h3 className="text-xl font-bold text-gray-900">
                  Alertas de Producción
                </h3>

                <button
                  onClick={() => setShowAlerts(false)}
                  className="text-2xl text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>

              <Alert supervisorMode={true} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}