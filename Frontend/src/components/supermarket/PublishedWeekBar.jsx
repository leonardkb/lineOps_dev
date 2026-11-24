// components/supermarket/PublishedWeekBar.jsx
//
// Selector de semanas publicadas + resumen de lo que hay que surtir.
// Vive DENTRO de la pestaña Plan Board, justo encima del tablero, en UNA sola
// franja con el mismo lenguaje que la barra del PlanBoard (segmentos grises,
// activo en blanco), para que se lea como parte del tablero y no como otra
// tarjeta. Menos alto = el tablero empieza más arriba.
//
// Componente presentacional: no pide datos ni guarda estado.

import { format, addDays, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { RefreshCw, Loader2 } from "lucide-react";

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
  const seg = (on) =>
    `h-8 px-3 text-sm whitespace-nowrap rounded-md transition inline-flex items-center gap-2 ${
      on ? "bg-white shadow-sm text-gray-900 font-semibold" : "text-gray-600 hover:text-gray-900"
    }`;

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-4 py-2.5 flex items-center gap-x-5 gap-y-2 flex-wrap">
        <nav className="flex bg-gray-200/60 rounded-lg p-0.5 overflow-x-auto max-w-full" aria-label="Semanas publicadas">
          <button
            onClick={() => onSelectWeek("all")}
            aria-pressed={activeWeek === "all"}
            title="Ver todas las semanas publicadas"
            className={seg(activeWeek === "all")}
          >
            Todas <span className="text-xs text-gray-400 tabular-nums">{weeks.length}</span>
          </button>
          {weeks.map((w) => {
            const lbl = weekLabel(w.weekStart);
            const on = activeWeek === w.weekStart;
            return (
              <button
                key={w.weekStart}
                onClick={() => onSelectWeek(w.weekStart)}
                aria-pressed={on}
                title={w.hasPreOrders ? "Ver sólo esta semana (incluye pre-órdenes)" : "Ver sólo esta semana"}
                className={seg(on)}
              >
                {lbl.top}
                <span className={`text-xs tabular-nums font-normal ${on ? "text-gray-500" : "text-gray-400"}`}>{lbl.range}</span>
                {w.hasPreOrders && (
                  <span className="text-[10px] font-semibold rounded px-1 py-0.5 bg-violet-100 text-violet-700">Pre</span>
                )}
                {w.revision > 1 && (
                  <span
                    title={`Revisión ${w.revision}: planeación reenvió esta semana`}
                    className="text-[10px] font-semibold rounded px-1 py-0.5 bg-amber-100 text-amber-800"
                  >
                    rev {w.revision}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <dl className="flex items-baseline gap-4 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dd className="font-bold text-gray-900 tabular-nums">{Math.round(totals.pzas).toLocaleString()}</dd>
            <dt className="text-gray-500">pzas</dt>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dd className="font-semibold text-gray-700 tabular-nums">{totals.cells.toLocaleString()}</dd>
            <dt className="text-gray-500">casillas</dt>
          </div>
        </dl>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto h-8 px-3 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualizar
        </button>
      </div>

      {activeMeta && (
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 flex-wrap text-xs text-gray-500">
          <span>
            Publicado {format(new Date(activeMeta.publishedAt), "d MMM yyyy, HH:mm", { locale: es })}
            {activeMeta.revision > 1 && ` · revisión ${activeMeta.revision}`}
          </span>
          {activeMeta.note && (
            <span className="text-gray-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{activeMeta.note}</span>
          )}
        </div>
      )}
    </div>
  );
}