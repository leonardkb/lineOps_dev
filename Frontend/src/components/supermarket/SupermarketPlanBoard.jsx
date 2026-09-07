// components/supermarket/SupermarketPlanBoard.jsx
//
// Pestaña "Plan Board" del supermercado. Usa el mismo PlanBoard que el planner
// — no una copia — para que los dos tableros no se separen con el tiempo:
//
//   readOnly       sin arrastrar, sin editar, sin bolsa de órdenes
//   dataOverride   pinta el snapshot publicado, no el tablero vivo
//   restrictWeeks  el calendario se recorta a las semanas enviadas
//
// Diario / Semanal / Mensual funcionan igual que en el tablero del planner; las
// columnas agregadas se arman con las semanas publicadas, así que ninguna vista
// puede mostrar una semana que planeación no envió.
//
// Los datos llegan por props: los carga SupermarketPage y los comparte con las
// demás pestañas.

import { useState, useEffect, useMemo } from "react";
import { format, addDays } from "date-fns";
import { Inbox, AlertTriangle } from "lucide-react";
import PlanBoard from "../planner/PlanBoard";
import PublishedWeekBar, { weekLabel } from "../supermarket/PublishedWeekBar";
import { LoadingState, Notice } from "../supermarket/SupermarketStates";

const ymd = (d) => (typeof d === "string" ? d.slice(0, 10) : format(new Date(d), "yyyy-MM-dd"));

export default function SupermarketPlanBoard({
  data,
  loading = false,
  refreshing = false,
  error = null,
  onRefresh,
  onRetry,
}) {
  const [activeWeek, setActiveWeek] = useState("all");

  const weeks = useMemo(() => data?.weeks || [], [data]);

  // Si planeación retira la semana que se estaba viendo, volvemos a "Todas" en
  // vez de dejar un tablero vacío sin explicación.
  useEffect(() => {
    if (activeWeek !== "all" && !weeks.some((w) => w.weekStart === activeWeek)) setActiveWeek("all");
  }, [weeks, activeWeek]);

  const shownWeeks = useMemo(
    () => (activeWeek === "all" ? weeks.map((w) => w.weekStart) : [activeWeek]),
    [weeks, activeWeek]
  );

  // El snapshot fusionado ya viene en la forma que PlanBoard consume. Al elegir
  // una semana recortamos por fecha para que columnas y totales cuadren con lo
  // que se está viendo.
  const boardData = useMemo(() => {
    if (!data) return null;
    const base = {
      assignments: data.assignments || [],
      holds: data.holds || [],
      holidays: data.holidays || [],
      workOrders: data.workOrders || [],
      lineRuns: data.lineRuns || [],
      plannerLines: data.plannerLines || [],
      merchantPlan: data.merchantPlan || [],
      equivalence: data.equivalence || 10,
      lineOrder: data.lineOrder || [],
    };
    if (activeWeek === "all") return base;

    const start = activeWeek;
    const end = format(addDays(new Date(`${activeWeek}T00:00:00`), 6), "yyyy-MM-dd");
    const inRange = (d) => { const k = ymd(d); return k >= start && k <= end; };

    return {
      ...base,
      assignments: base.assignments.filter((a) => a.assigned_date && inRange(a.assigned_date)),
      holds: base.holds.filter((h) => (h.assigned_date || h.hold_date) && inRange(h.assigned_date || h.hold_date)),
      lineRuns: base.lineRuns.filter((lr) => lr.run_date && inRange(lr.run_date)),
    };
  }, [data, activeWeek]);

  const totals = useMemo(() => {
    const list = activeWeek === "all" ? weeks : weeks.filter((w) => w.weekStart === activeWeek);
    return list.reduce(
      (acc, w) => ({
        pzas: acc.pzas + (Number(w.counts?.boardPzas) || 0),
        cells: acc.cells + (Number(w.counts?.boardCells) || 0),
        pre: acc.pre || !!w.hasPreOrders,
      }),
      { pzas: 0, cells: 0, pre: false }
    );
  }, [weeks, activeWeek]);

  if (loading) return <LoadingState label="Cargando plan del supermercado..." />;

  if (error && !data) {
    return (
      <Notice icon={AlertTriangle} tone="amber" title="No se pudo cargar el plan" onRetry={onRetry}>
        {error}
      </Notice>
    );
  }

  if (weeks.length === 0) {
    return (
      <Notice icon={Inbox} title="Todavía no hay plan publicado" onRetry={onRetry}>
        Planeación aún no envía ninguna semana. En cuanto la envíe, aparecerá aquí.
      </Notice>
    );
  }

  const activeMeta = weeks.find((w) => w.weekStart === activeWeek) || null;

  return (
    <div className="space-y-4">
      <PublishedWeekBar
        weeks={weeks}
        activeWeek={activeWeek}
        onSelectWeek={setActiveWeek}
        onRefresh={onRefresh}
        refreshing={refreshing}
        totals={totals}
        activeMeta={activeMeta}
      />

      {/* Un refresco fallido no borra lo que ya estaba en pantalla; sólo avisa. */}
      {error && data && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          No se pudo actualizar ({error}). Se muestra el último plan cargado.
        </div>
      )}

      <PlanBoard
        readOnly
        cellDetails
        dataOverride={boardData}
        restrictWeeks={shownWeeks}
        heading="Plan Board"
        subheading={
          activeWeek === "all"
            ? `${weeks.length} ${weeks.length === 1 ? "semana publicada" : "semanas publicadas"}`
            : `${weekLabel(activeWeek).top} · ${weekLabel(activeWeek).range}`
        }
      />
    </div>
  );
}