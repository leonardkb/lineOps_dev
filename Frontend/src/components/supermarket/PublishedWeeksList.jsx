// components/supermarket/PublishedWeeksList.jsx
//
// Pestaña "Semanas publicadas": qué envió planeación, cuándo, y con qué nota.
//
// Existe por la revisión. Cuando planeación reenvía una semana el tablero
// cambia bajo los pies del supermercado; aquí se ve el sello de publicación y
// el número de revisión, que es la única señal de que lo de ayer ya no aplica.
//
// Todo sale de los datos que ya cargó SupermarketPage — no pide nada extra.

import { format, addDays, getWeek } from "date-fns";
import { es } from "date-fns/locale";
import { Inbox, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { LoadingState, Notice } from "./SupermarketStates";

export default function PublishedWeeksList({
  data,
  loading = false,
  refreshing = false,
  error = null,
  onRefresh,
  onRetry,
}) {
  const weeks = data?.weeks || [];

  if (loading) return <LoadingState label="Cargando semanas publicadas..." />;

  if (error && !data) {
    return (
      <Notice icon={AlertTriangle} tone="amber" title="No se pudo cargar" onRetry={onRetry}>
        {error}
      </Notice>
    );
  }

  if (weeks.length === 0) {
    return (
      <Notice icon={Inbox} title="Todavía no hay semanas publicadas" onRetry={onRetry}>
        Cuando planeación envíe una semana, aparecerá aquí con su fecha de publicación.
      </Notice>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          {weeks.length} {weeks.length === 1 ? "semana publicada" : "semanas publicadas"}
        </p>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualizar
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="text-left font-medium px-5 py-2.5">Semana</th>
              <th className="text-left font-medium px-5 py-2.5">Rango</th>
              <th className="text-right font-medium px-5 py-2.5">Piezas</th>
              <th className="text-right font-medium px-5 py-2.5">Casillas</th>
              <th className="text-left font-medium px-5 py-2.5">Publicado</th>
              <th className="text-left font-medium px-5 py-2.5">Nota</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {weeks.map((w) => {
              const s = new Date(`${w.weekStart}T00:00:00`);
              return (
                <tr key={w.weekStart} className="hover:bg-gray-50">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="font-medium text-gray-900">
                      Semana {getWeek(s, { weekStartsOn: 1 })}
                    </span>
                    {w.hasPreOrders && (
                      <span className="ml-2 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                        Pre
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600 tabular-nums whitespace-nowrap">
                    {format(s, "dd/MM")} – {format(addDays(s, 6), "dd/MM/yyyy")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-900">
                    {Math.round(Number(w.counts?.boardPzas) || 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                    {(Number(w.counts?.boardCells) || 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                    {format(new Date(w.publishedAt), "d MMM yyyy, HH:mm", { locale: es })}
                    {w.revision > 1 && (
                      <span
                        title="Planeación reenvió esta semana; lo anterior ya no aplica"
                        className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                      >
                        rev {w.revision}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-600 max-w-xs">
                    {w.note || <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}