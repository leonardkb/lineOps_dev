// components/cutting/CuttingApp.jsx
//
// Pantalla del rol "corte". Tres vistas:
//   Resumen (solo lectura) · Planear marcadas (planner) · Verificar corte (supervisor)
// Monte esto en la ruta /cutting.
//
import { useState } from "react";
import CuttingDashboard from "../../components/cutting/CuttingDashboard";
import CutPlanning from "../../components/cutting/CutPlanning";
import CutVerification from "../../components/cutting/CutVerification";
import NavCutting from "../../components/cutting/NavCutting";
import CuttingOverview from "../../components/cutting/CuttingOverview";

export default function CuttingApp() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gray-50">

      <NavCutting />

      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-6 flex gap-2 border-b">
          {[
            { id: "overview", label: "Dashboard" },
            { id: "dashboard", label: "Resumen" },
            { id: "planning", label: "Planear marcadas" },
            { id: "verification", label: "Verificar corte" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition ${
                tab === t.id ? "text-gray-900 border-b-2 border-gray-900" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "overview" && <CuttingOverview />}
        {tab === "dashboard" && <CuttingDashboard />}
        {tab === "planning" && <CutPlanning />}
        {tab === "verification" && <CutVerification />}
      </div>
    </div>
  );
}