import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import SplashScreen from "./SplashScreen";

export default function LoginPage() {
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await axios.post("http://localhost:5000/api/login", {
        username,
        password
      });

      const user = response.data.user;

      // normalize role
      const roleNorm = String(user?.role || "")
        .toLowerCase()
        .trim()
        .replace(/[\s_-]/g, "");

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("user", JSON.stringify(user));

      console.log("User role raw:", user?.role, "normalized:", roleNorm);

      if (roleNorm === "lineleader") {
        navigate("/lineleader", { replace: true });
      } else if (roleNorm === "supervisor") {
        navigate("/admin", { replace: true });
      } else if (user.role === 'soporte_it') {
        navigate('/line-tv', { replace: true }); // Redirect soporte_it to LineTvDashboard
      } else if(roleNorm === "engineer") {
        navigate("/planner", { replace: true });
      }else if(roleNorm === "skyrina") {
        navigate("/skyrina", { replace: true });
      }else if(roleNorm === "planner") {
        navigate("/advanced-planning", { replace: true });
      }else if(roleNorm === "master") {
        navigate("/overview", { replace: true });
      }else if(roleNorm === "qualityinspector") {
        navigate("/quality-inspector", { replace: true });
      }
      else {
        navigate("/", { replace: true });
      }

    } catch (err) {
      if (err.response && err.response.data) {
        setError(err.response.data.error || "Error al iniciar sesión");
      } else if (err.code === "ERR_NETWORK") {
        setError(
          "No se puede conectar al servidor. Verifique que el backend esté ejecutándose en el puerto 5000."
        );
      } else {
        setError("Error de red. Intente nuevamente.");
      }
      console.error("Login error:", err);
    } finally {
      setLoading(false);
    }
  };

  // If splash screen is showing, render it
  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-6 sm:p-8">
        
        {/* Title */}
        <h1 className="text-2xl font-semibold text-gray-900 text-center">
          Sistema de Producción de Líneas
        </h1>

        {/* Subtitle */}
        <p className="text-sm text-gray-600 text-center mt-1">
          Ingrese sus credenciales para continuar
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Usuario
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ingrese usuario"
              className="w-full rounded-xl border border-gray-300 px-4 py-2
                         focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ingrese contraseña"
              className="w-full rounded-xl border border-gray-300 px-4 py-2
                         focus:outline-none focus:ring-2 focus:ring-gray-900/20"
              required
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          {/* Login Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gray-900 text-white py-2.5
                       font-medium hover:bg-gray-800 active:bg-gray-900
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>

        {/* Footer Note */}
        <div className="mt-6 text-xs text-gray-500 text-center">
          Solo usuarios autorizados. Contacte al administrador del sistema para obtener acceso.
        </div>

        {/* Server Status */}
        <div className="mt-4 text-xs text-center">
          <button
            onClick={() =>
              window.open("http://localhost:5000/api/health", "_blank")
            }
            className="text-blue-500 hover:underline"
          >
            Verificar estado del servidor
          </button>
          <p className="block mt-1 text-gray-400">developed by LK</p>
        </div>
      </div>
    </div>
  );
}