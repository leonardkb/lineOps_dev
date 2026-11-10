// components/planner/BoardsHub.jsx
//
// Analíticas de Planeación → pestaña «Tableros». Una sola pestaña con cuatro
// vistas, elegidas con el selector de arriba (se recuerda la última).
// Primero el pronóstico, luego el plan:
//   • Resumen pronóstico  ForecastOverview  (pronósticos FC#### del cliente)
//   • Tablero pronóstico  PlanBoard mode="forecast" (consulta)
//   • Resumen plan        PlanOverview      (órdenes SKM reales)
//   • Plan Board          PlanBoard         (consulta + candados de semana)
// En «Resumen plan», un clic en un cliente de «Resumen por cliente» abre el
// panel lateral ClientDetailPanel (líneas, producción por semana, entregas).
// Cada resumen tiene además un botón para abrir su tablero.
import { useState } from "react";
import { BarChart3, LayoutGrid, PieChart, TrendingUp } from "lucide-react";
import PlanBoard from "./PlanBoard";
import PlanOverview from "./PlanOverview";
import ForecastOverview from "./ForecastOverview";
import ClientDetailPanel from "./ClientDetailPanel";

const VIEWS = [
  { key: "fc-summary", group: "fc", label: "Resumen pronóstico", Icon: BarChart3 },
  { key: "fc-board", group: "fc", label: "Tablero pronóstico", Icon: TrendingUp },
  { key: "plan-summary", group: "plan", label: "Resumen plan", Icon: PieChart },
  { key: "plan-board", group: "plan", label: "Plan Board", Icon: LayoutGrid },
];
const STORE = "planAnalytics.boardsView";

export default function BoardsHub({ workOrders, assignments, loading, errored, onRetry }) {
  const [view, setView] = useState(() => {
    try {
      const v = localStorage.getItem(STORE);
      return VIEWS.some((x) => x.key === v) ? v : "fc-summary"; // la primera vez: el resumen de pronóstico
    } catch { return "fc-summary"; }
  });
  // Cliente abierto en el panel lateral (null = cerrado)
  const [clientSel, setClientSel] = useState(null);

  const pick = (k) => {
    setView(k);
    setClientSel(null);
    try { localStorage.setItem(STORE, k); } catch { /* ignore */ }
  };

  const btn = (v) => {
    const on = view === v.key;
    const onCls = v.group === "fc" ? "bg-teal-600 text-white shadow-sm" : "bg-gray-900 text-white shadow-sm";
    return (
      <button key={v.key} role="tab" aria-selected={on} onClick={() => pick(v.key)}
        className={`h-8 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition ${on ? onCls : "text-gray-700 hover:text-gray-900 hover:bg-white/70"}`}>
        <v.Icon className="w-4 h-4" /> {v.label}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Selector: pronóstico (teal) primero | plan (gris) */}
      <div className="shrink-0 w-full px-3 sm:px-4 lg:px-5 pt-3 flex items-center gap-2 flex-wrap">
        <div role="tablist" aria-label="Vista" className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          <span className="inline-flex items-center gap-1 pl-2 pr-1.5 text-[13px] font-extrabold uppercase tracking-wide text-teal-700">
            <TrendingUp className="w-4 h-4" /> Pronóstico
          </span>
          {VIEWS.filter((v) => v.group === "fc").map(btn)}
          <span className="mx-2 h-6 w-px bg-gray-300" aria-hidden />
          <span className="inline-flex items-center gap-1 pl-1 pr-1.5 text-[13px] font-extrabold uppercase tracking-wide text-gray-800">
            <LayoutGrid className="w-4 h-4" /> Plan
          </span>
          {VIEWS.filter((v) => v.group === "plan").map(btn)}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {view === "plan-summary" && (
          <PlanOverview workOrders={workOrders} assignments={assignments} loading={loading} errored={errored}
            onRetry={onRetry} onOpenBoard={() => pick("plan-board")}
            onSelectClient={setClientSel} />
        )}
        {view === "plan-board" && (
          <div className="h-full overflow-auto">
            <PlanBoard
              key="plan-ro"
              readOnly
              canLockWeeks
              heading="Tablero del planner"
              subheading="Vista de consulta. En la vista Semanal, use el candado junto a cada semana para bloquearla o desbloquearla: una semana bloqueada no la puede mover el planner."
            />
          </div>
        )}
        {view === "fc-summary" && <ForecastOverview onOpenBoard={() => pick("fc-board")} />}
        {view === "fc-board" && (
          <div className="h-full overflow-auto">
            <PlanBoard
              key="forecast-ro"
              mode="forecast"
              readOnly
              heading="Tablero de pronóstico"
              subheading="Vista de consulta de los pronósticos del cliente cargados a las líneas. Toque una casilla para ver su detalle."
            />
          </div>
        )}
      </div>

      {clientSel && (
        <ClientDetailPanel
          customer={clientSel}
          workOrders={workOrders}
          assignments={assignments}
          onClose={() => setClientSel(null)}
        />
      )}
    </div>
  );
}