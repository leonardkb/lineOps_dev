// components/supermarket/PublishedWeekBar.jsx
//
// Selector de semanas publicadas + resumen de lo que hay que surtir.
// Vive DENTRO de la pestaña Plan Board, no arriba: la barra de navegación del
// área es NavSupermarket.
//
// Componente presentacional: no pide datos ni guarda estado. Todo entra por
// props y las acciones salen por callbacks.

import { format, addDays, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { RefreshCw, Loader2, Check } from "lucide-react";

export const weekLabel = (weekStart) => {
  const s = new Date(`${weekStart}T00:00:00`);
  return {
    top: `Semana ${getWeek(s, { weekStartsOn: 1 })}`,
    range: `${format(s, "dd/MM")} – ${format(addDays(s, 6), "dd/MM/yyyy")}`,
  };
};

export default function PublishedWeekBar({
  weeks = [],
  activeWeek = "all",
  onSelectWeek,
  onRefresh,
  refreshing = false,
  totals = { pzas: 0, cells: 0, pre: false },
  activeMeta = null,
}) {
  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap border-b">
        {/* Lo que el supermercado necesita de un vistazo: cuánto surtir. */}
        <dl className="flex items-center gap-6">
          <div>
            <dd className="font-semibold text-gray-900 tabular-nums leading-tight">
              {Math.round(totals.pzas).toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-500 leading-tight">piezas</dt>
          </div>
          <div>
            <dd className="font-semibold text-gray-900 tabular-nums leading-tight">
              {totals.cells.toLocaleString()}
            </dd>
            <dt className="text-xs text-gray-500 leading-tight">casillas</dt>
          </div>
          {totals.pre && (
            <span className="text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2.5 py-1">
              Incluye pre-órdenes
            </span>
          )}
        </dl>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualizar
        </button>
      </div>

      <nav className="px-5 py-3 flex items-center gap-1.5 flex-wrap" aria-label="Semanas publicadas">
        <button
          onClick={() => onSelectWeek("all")}
          aria-current={activeWeek === "all" ? "true" : undefined}
          title={activeWeek === "all" ? "En uso — el tablero muestra todas las semanas publicadas" : "Ver todas las semanas publicadas"}
          className={`px-3 py-1.5 text-sm rounded-lg border transition inline-flex items-center gap-1.5 ${
            activeWeek === "all"
              ? "bg-gray-900 text-white border-gray-900 ring-2 ring-gray-900 ring-offset-1"
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
          }`}
        >
          {activeWeek === "all" && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
          Todas
          <span className={`text-xs ${activeWeek === "all" ? "text-gray-400" : "text-gray-400"}`}>{weeks.length}</span>
        </button>

        {weeks.map((w) => {
          const lbl = weekLabel(w.weekStart);
          const on = activeWeek === w.weekStart;
          return (
            <button
              key={w.weekStart}
              onClick={() => onSelectWeek(w.weekStart)}
              aria-current={on ? "true" : undefined}
              title={on ? "Semana en uso — el tablero muestra sólo esta semana" : "Ver sólo esta semana"}
              className={`px-3 py-1.5 text-sm rounded-lg border transition inline-flex items-center gap-2 ${
                on
                  ? "bg-gray-900 text-white border-gray-900 ring-2 ring-gray-900 ring-offset-1"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {/* La semana seleccionada queda marcada como "en uso": el tablero
                  de abajo muestra sólo esa semana. */}
              {on && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
              <span className="font-medium">{lbl.top}</span>
              <span className={`text-xs tabular-nums ${on ? "text-gray-400" : "text-gray-500"}`}>
                {lbl.range}
              </span>
              {w.hasPreOrders && (
                <span
                  title="Esta semana incluye pre-órdenes"
                  className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${
                    on ? "bg-violet-500 text-white" : "bg-violet-50 text-violet-700 border border-violet-200"
                  }`}
                >
                  Pre
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {activeMeta && (
        <div className="px-5 pb-3 flex items-center gap-3 flex-wrap text-xs text-gray-500">
          <span>
            Publicado {format(new Date(activeMeta.publishedAt), "d MMM yyyy, HH:mm", { locale: es })}
            {activeMeta.revision > 1 && ` · revisión ${activeMeta.revision}`}
          </span>
          {activeMeta.note && (
            <span className="text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {activeMeta.note}
            </span>
          )}
        </div>
      )}
    </div>
  );
}