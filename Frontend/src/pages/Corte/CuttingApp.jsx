// components/cutting/CuttingApp.jsx
//
// Pantalla del rol "corte". Dos vistas: Resumen (solo lectura) y Registrar corte.
// Monte esto en la ruta /cutting.
//
import { useState } from "react";
import { Scissors } from "lucide-react";
import CuttingDashboard from "../../components/cutting/CuttingDashboard";
import CuttingEntry from "../../components/cutting/CuttingEntry";
import NavCutting from "../../components/cutting/NavCutting";

export default function CuttingApp() {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gray-50">
      <NavCutting />

      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-6 flex gap-2 border-b">
          {[
            { id: "dashboard", label: "Resumen" },
            { id: "entry", label: "Registrar corte" },
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

        {tab === "dashboard" && <CuttingDashboard />}
        {tab === "entry" && <CuttingEntry />}
      </div>
    </div>
  );
}