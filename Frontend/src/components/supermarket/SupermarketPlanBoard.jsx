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
//   cellDetails    casillas anchas con OT, color, PO y piezas legibles; cada
//                  fila crece para que las órdenes apiladas no se encimen, y un
//                  clic en una orden abre el panel lateral con sus tallas y los
//                  días que corre en el plan publicado.
//
// Los datos llegan por props: los carga SupermarketPage y los comparte con las
// demás pestañas.

import { useState, useEffect, useMemo } from "react";
import { format, addDays } from "date-fns";
import { Inbox, AlertTriangle } from "lucide-react";
import PlanBoard from "../planner/PlanBoard";
import PublishedWeekBar, { weekLabel } from "../supermarket/PublishedWeekBar";
import { LoadingState, Notice } from "../supermarket/SupermarketStates";
import { usePanelRequests, PanelRequestCard, needsSending, requestMatches } from "../supermarket/PanelRequests";
import { usePanelStock, stockColor } from "../supermarket/usePanelStock";
import { X } from "lucide-react";

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
  // Solicitudes de paneles de las líneas: se refrescan solas cada 30 s.
  const panels = usePanelRequests({ pollMs: 30000 });
  const [openRequestId, setOpenRequestId] = useState(null);
  const openRequest = panels.requests.find((r) => r.id === openRequestId) || null;
  // Solicitudes cuya orden no aparece en NINGUNA semana publicada (p. ej. la
  // semana en curso, que no se publica): no hay casilla que levantar, así que
  // se avisan aparte para que no se pierdan.
  // Stock de paneles (escaneados) vs. lo asignado en el plan publicado.
  // El stock recibido cubre los días del plan de esa orden+color en orden de
  // fecha: así cada casilla sabe si su día ya tiene paneles o no.
  const stock = usePanelStock({ pollMs: 30000 });
  const { stockCoverage, stockOrderOf } = useMemo(() => {
    const byId = new Map();
    const byNo = new Map();
    for (const o of stock.orders) {
      byId.set(`${o.workOrderId}|${o.color}`, o);
      if (o.workOrderNo) byNo.set(`${o.workOrderNo}|${o.color}`, o);
    }
    const summaryOf = (a) =>
      byId.get(`${a.work_order_id}|${stockColor(a.color)}`) || byNo.get(`${a.work_order_no || ""}|${stockColor(a.color)}`) || null;
    const groupKey = (a) => `${a.work_order_id ?? a.work_order_no}|${stockColor(a.color)}`;

    const groups = new Map();
    for (const a of data?.assignments || []) {
      if (!a.assigned_date || ["cancelled", "rejected"].includes(a.status)) continue;
      const k = groupKey(a);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(a);
    }
    const coverage = new Map();   // id de asignación → { status, covered, qty }
    const orderInfo = new Map();  // orden+color → resumen + asignado
    for (const [k, list] of groups) {
      list.sort((x, y) => String(x.assigned_date).localeCompare(String(y.assigned_date)) || String(x.line_no).localeCompare(String(y.line_no), undefined, { numeric: true }));
      const sm = summaryOf(list[0]);
      const received = sm?.receivedPieces || 0;
      let cum = 0;
      for (const a of list) {
        const qty = Number(a.assigned_quantity) || 0;
        const covered = Math.max(0, Math.min(qty, received - cum));
        coverage.set(a.id, { status: covered >= qty && qty > 0 ? "full" : covered > 0 ? "partial" : "none", covered, qty });
        cum += qty;
      }
      orderInfo.set(k, {
        receivedPanels: sm?.receivedPanels || 0,
        receivedPieces: received,
        cutPieces: sm?.cutPieces || 0,
        sentPieces: sm?.sentPieces || 0,
        onHand: sm?.onHand || 0,
        assigned: cum,
      });
    }
    return { stockCoverage: coverage, stockOrderOf: (a) => orderInfo.get(groupKey(a)) || null };
  }, [stock.orders, data]);

  const offBoard = useMemo(() => {
    const all = data?.assignments || [];
    return panels.requests.filter(
      (r) => needsSending(r) && !all.some((a) => requestMatches(r, a.line_no, a, a.work_order_no))
    );
  }, [panels.requests, data]);

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
    <div className="space-y-3">
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

      {/* Leyenda: lo poco que el tablero codifica con color, dicho en palabras. */}
      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap px-1 text-xs text-gray-500">
        <span>Clic en una casilla: tallas, días y líneas de cada orden.</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-500" /> Cambio de color: preparar tela nueva
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-fuchsia-500" /> Cambio de estilo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-600" /> La línea pidió paneles
        </span>
        <span className="inline-flex items-center gap-1.5" title="Paneles escaneados en Recibir paneles, repartidos en los días del plan en orden de fecha">
          Barra inferior = stock de paneles:
          <span className="w-4 h-1 rounded-full bg-emerald-500" /> cubre el día
          <span className="w-4 h-1 rounded-full bg-amber-400" /> parcial
          <span className="w-4 h-1 rounded-full bg-gray-300" /> sin stock
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border border-amber-200 bg-amber-50" /> Día no laborable
        </span>
        {offBoard.map((r) => (
          <button
            key={r.id}
            onClick={() => setOpenRequestId(r.id)}
            title="La orden no está en ninguna semana publicada; clic para surtir"
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
          >
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-white" />
            </span>
            L{r.line_no} · {String(r.work_order_no || "").split("-")[0]}{r.color ? ` ${r.color}` : ""} · {Math.round(r.balance_qty).toLocaleString()} paneles · fuera del tablero
          </button>
        ))}
      </div>

      <PlanBoard
        readOnly
        cellDetails
        dataOverride={boardData}
        panelRequests={panels.requests}
        onPanelRequestsChanged={() => { panels.reload(); stock.reload(); }}
        stockCoverage={stockCoverage}
        stockOrderOf={stockOrderOf}
        restrictWeeks={shownWeeks}
        heading="Plan Board"
        subheading={
          activeWeek === "all"
            ? `${weeks.length} ${weeks.length === 1 ? "semana publicada" : "semanas publicadas"}`
            : `${weekLabel(activeWeek).top} · ${weekLabel(activeWeek).range}`
        }
      />

      {/* Solicitud abierta desde la franja: sirve aunque su día no esté en el tablero. */}
      {openRequest && (
        <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center p-4" onClick={() => setOpenRequestId(null)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2 text-white">
              <span className="font-semibold">Línea {openRequest.line_no} · {openRequest.work_order_no}{openRequest.color ? ` · ${openRequest.color}` : ""}</span>
              {openRequest.customer_po && <span className="text-white/80 text-sm">PO {openRequest.customer_po}</span>}
              <button onClick={() => setOpenRequestId(null)} aria-label="Cerrar" className="ml-auto h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>
            <PanelRequestCard request={openRequest} onChanged={() => panels.reload()} />
          </div>
        </div>
      )}
    </div>
  );
}