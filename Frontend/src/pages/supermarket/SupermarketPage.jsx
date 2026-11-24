// SupermarketPage.jsx
//
// Contraparte de AdvancedPlanningPage para el supermercado. Misma estructura:
// nav arriba, encabezado, pestañas, contenido.
//
// La carga del plan vive AQUÍ, no en las pestañas: las dos miran los mismos
// datos, así que cambiar de pestaña no vuelve a pedir nada ni deja una viendo
// una publicación más vieja que la otra.

import { useState, useEffect, useCallback } from "react";
import NavSupermarket from "../../components/supermarket/NavSupermarket";
import SupermarketPlanBoard from "../../components/supermarket/SupermarketPlanBoard";
import PublishedWeeksList from "../../components/supermarket/PublishedWeeksList";
import SupermarketPanels from "../../components/supermarket/SupermarketPanels";
import SupermarketPanelStock from "../../components/supermarket/SupermarketPanelStock";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export default function SupermarketPage() {
  const [activeTab, setActiveTab] = useState("planboard");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);      // sólo la primera carga tapa la pantalla
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/supermarket-plan`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "No se pudo cargar el plan publicado");
      setData(json);
    } catch (err) {
      setError(err.message);
      // Al refrescar conservamos lo que ya se veía: a media jornada, un plan de
      // hace un minuto sirve más que una pantalla en blanco.
      if (initial) setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load({ initial: true }); }, [load]);

  const weeks = data?.weeks || [];

  const tabs = [
    { id: "planboard", label: "Plan Board", visible: true },
    {
      id: "weeks",
      label: "Semanas publicadas",
      // El contador ayuda a notar una publicación nueva sin entrar a la pestaña.
      badge: weeks.length || null,
      visible: true,
    },
    {
      // Paneles a surtir de las órdenes de corte ya cortadas. Trae sus propios
      // datos (/api/cut-orders), no el snapshot semanal, así que no usa `shared`.
      id: "panels",
      label: "Paneles",
      visible: true,
    },
    {
      // Escanear los tickets de inspección: cada panel entra al stock una vez
      // y se ve al momento si llegó lo que se cortó.
      id: "stock",
      label: "Recibir paneles",
      visible: true,
    },
  ];

  const shared = { data, loading, refreshing, error, onRefresh: () => load(), onRetry: () => load({ initial: true }) };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavSupermarket />

      <div className="mx-auto max-w-7xl px-4 pt-4 pb-6 sm:px-6 sm:pt-5">
        {/* Encabezado y pestañas en una sola franja: título a la izquierda,
            pestañas a la derecha, una sola línea inferior para los dos. En
            pantallas angostas las pestañas bajan debajo del título. */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b">
          <div className="pb-2.5 min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900 leading-tight">Supermercado</h1>
            <p className="text-sm text-gray-600">
              Consulte el plan de producción que planeación publicó para surtir material
            </p>
          </div>

          <nav className="flex flex-wrap gap-1" aria-label="Secciones del supermercado">
            {tabs.map(
              (tab) =>
                tab.visible && (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={activeTab === tab.id ? "page" : undefined}
                    className={`-mb-px px-4 py-2.5 text-sm font-medium transition inline-flex items-center gap-2 border-b-2 ${
                      activeTab === tab.id
                        ? "text-gray-900 border-gray-900"
                        : "text-gray-500 border-transparent hover:text-gray-700"
                    }`}
                  >
                    {tab.label}
                    {tab.badge != null && (
                      <span
                        className={`text-xs rounded-full px-1.5 py-0.5 ${
                          activeTab === tab.id ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </button>
                )
            )}
          </nav>
        </div>

        {/* Content */}
        <div className="space-y-6">
          {activeTab === "planboard" && <SupermarketPlanBoard {...shared} />}
          {activeTab === "weeks" && <PublishedWeeksList {...shared} />}
          {activeTab === "panels" && <SupermarketPanels />}
          {activeTab === "stock" && <SupermarketPanelStock />}
        </div>
      </div>
    </div>
  );
}