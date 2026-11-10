// components/planner/ClientDetailPanel.jsx
//
// Panel lateral con el detalle de UN cliente. Se abre al hacer clic en una fila
// de «Resumen por cliente» (BoardsHub). Muestra:
//   • Pronóstico: fecha fin del plan vs fecha al ritmo real de las últimas
//     2 semanas (piezas terminadas / días hábiles).
//   • KPIs del cliente (solo órdenes abiertas).
//   • Semanas: producido (real) + planeado (asignaciones futuras) y cuántas
//     entregas del merchant caen en cada semana.
//   • Líneas: en qué líneas se ha cosido, cuánto, última captura y lo que
//     aún tienen planeado.
//   • Entregas por orden: Gantt del plan (inicio → fin) contra la fecha de
//     entrega del merchant (rombo).
//
// Datos: workOrders + assignments ya cargados por PlannerAnalytics, y la
// producción por (orden, línea, día) de GET /api/customer-production.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  X, Loader2, AlertTriangle, CheckCircle2, CalendarClock, Factory,
  TrendingUp, Package, Truck, Info,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

// ── Ajustes ────────────────────────────────────────────────────────────────
const WORKDAYS = new Set([1, 2, 3, 4, 5, 6]); // lun–sáb (0 = domingo)
const PACE_WINDOW_DAYS = 14;                   // ventana para el ritmo real
const HISTORY_WEEKS = 12;                      // semanas de historia en la gráfica
const MAX_WEEKS = 40;                          // tope de columnas
const ROW_PAGE = 60;                           // órdenes por "página" en el Gantt

const DEAD = new Set(["cancelled", "rejected"]);

// ── Utilidades ─────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").trim().toUpperCase();
const lower = (s) => String(s || "").trim().toLowerCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtInt = (v) => Math.round(num(v)).toLocaleString("es-MX");
const pad = (n) => String(n).padStart(2, "0");
const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (k) => new Date(`${k}T00:00:00`);
const fmtDate = (s, year = true) => {
  const k = ymd(s);
  if (!k) return null;
  const d = parse(k);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("es-MX", year
    ? { day: "2-digit", month: "short", year: "2-digit" }
    : { day: "2-digit", month: "short" });
};
const daysBetween = (a, b) => {
  const x = parse(ymd(a)); const y = parse(ymd(b));
  if (isNaN(x) || isNaN(y)) return null;
  return Math.round((y - x) / 86400000);
};
const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return toYmd(d); };
const weekOf = (k) => { const d = parse(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toYmd(d); };
const addWorkdays = (k, n) => {
  const d = parse(k);
  let left = Math.max(0, Math.ceil(n));
  while (left > 0) { d.setDate(d.getDate() + 1); if (WORKDAYS.has(d.getDay())) left--; }
  return toYmd(d);
};
const countWorkdays = (fromK, toK) => {
  let n = 0;
  for (let d = parse(fromK); toYmd(d) <= toK; d.setDate(d.getDate() + 1)) if (WORKDAYS.has(d.getDay())) n++;
  return n;
};
const lineNum = (l) => parseInt(String(l).replace(/\D/g, ""), 10) || 0;
const lineLabel = (l) => (/^l/i.test(String(l)) ? String(l).toUpperCase() : `L${l}`);
const byLine = (a, b) => lineNum(a) - lineNum(b) || String(a).localeCompare(String(b));
const pct = (a, b) => (b > 0 ? Math.min(a / b, 1) : 0);

async function getJSON(path, retries = 2) {
  let last = { ok: false, data: null };
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) return { ok: true, data };
      last = { ok: false, data };
      if (res.status < 500 && res.status !== 429) return last;
    } catch {
      last = { ok: false, data: null };
    }
    if (i < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
  }
  return last;
}

const DELIV = {
  late:    { label: "Atrasada",    bar: "bg-rose-400",    text: "text-rose-600" },
  ontime:  { label: "A tiempo",    bar: "bg-emerald-400", text: "text-emerald-600" },
  sinplan: { label: "Por planear", bar: "bg-amber-300",   text: "text-amber-600" },
  nofecha: { label: "Sin fecha",   bar: "bg-gray-300",    text: "text-gray-400" },
};

// ════════════════════════════════════════════════════════════════════════════
export default function ClientDetailPanel({ customer, workOrders = [], assignments = [], onClose }) {
  const [shown, setShown] = useState(false);
  const [prod, setProd] = useState({ loading: true, rows: [], resolved: true, failed: false });
  const [filter, setFilter] = useState("open"); // open | late | unplanned | all
  const [limit, setLimit] = useState(ROW_PAGE);
  const closeRef = useRef(null);

  // Entrada deslizada + foco en «Cerrar» + Esc para salir
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => { setShown(false); setTimeout(() => onClose?.(), 180); };

  // Producción por orden/línea/día del cliente
  useEffect(() => {
    let cancelled = false;
    setProd((p) => ({ ...p, loading: true, failed: false }));
    setFilter("open"); setLimit(ROW_PAGE);
    (async () => {
      const r = await getJSON(`http://localhost:5000/api/customer-production?customer=${encodeURIComponent(customer)}`);
      if (cancelled) return;
      if (r.ok && r.data?.success) setProd({ loading: false, rows: r.data.rows || [], resolved: r.data.resolved !== false, failed: false });
      else setProd({ loading: false, rows: [], resolved: true, failed: true });
    })();
    return () => { cancelled = true; };
  }, [customer]);

  const m = useMemo(
    () => buildModel({ customer, workOrders, assignments, prodRows: prod.rows }),
    [customer, workOrders, assignments, prod.rows]
  );

  const visibleOrders = useMemo(() => {
    const f = m.orders.filter((o) =>
      filter === "all" ? true
        : filter === "late" ? o.open && o.deliv === "late"
        : filter === "unplanned" ? o.open && (o.deliv === "sinplan" || o.deliv === "nofecha")
        : o.open
    );
    return f;
  }, [m.orders, filter]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="client-panel-title">
      <div
        className={`absolute inset-0 bg-gray-900/30 motion-safe:transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={close}
      />
      <aside
        className={`relative h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col motion-safe:transition-transform duration-200 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Encabezado */}
        <header className="shrink-0 border-b border-gray-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Detalle de cliente</p>
              <h2 id="client-panel-title" className="text-xl font-bold tracking-tight truncate">{customer}</h2>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.lineList.length === 0
                  ? <span className="text-xs text-gray-400">Sin línea</span>
                  : m.lineList.map((l) => (
                    <span key={l} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{lineLabel(l)}</span>
                  ))}
              </div>
            </div>
            <button
              ref={closeRef}
              onClick={close}
              aria-label="Cerrar detalle"
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Cuerpo (único scroll) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          <Forecast m={m} loading={prod.loading} />

          <Kpis m={m} />

          {(prod.failed || !prod.resolved) && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {prod.failed
                ? "No se pudo cargar la producción por línea. Los totales por orden sí están actualizados; cierra y vuelve a abrir el panel para reintentar."
                : "La captura de piso no está ligada a las órdenes; la producción por línea y por semana no está disponible."}
            </p>
          )}

          <Section Icon={TrendingUp} title="Producción y plan por semana"
            aside={<Legend items={[["bg-violet-500", "Producido"], ["bg-teal-300", "Planeado"]]} />}>
            {prod.loading ? <Loading /> : <WeeklyChart m={m} />}
          </Section>

          <Section Icon={Factory} title="Líneas que han producido"
            aside={<Legend items={[["bg-violet-500", "Producido"], ["bg-teal-300", "Planeado pendiente"]]} />}>
            {prod.loading ? <Loading /> : <LinesBreakdown m={m} />}
          </Section>

          <Section Icon={Truck} title="Entregas por orden"
            aside={<Legend items={[["bg-emerald-400", "Plan a tiempo"], ["bg-rose-400", "Plan atrasado"], ["diamond", "Entrega merchant"]]} />}>
            <div className="mb-3 flex flex-wrap gap-1">
              {[
                ["open", `Abiertas (${m.counts.open})`],
                ["late", `Atrasadas (${m.counts.late})`],
                ["unplanned", `Por planear (${m.counts.unplanned})`],
                ["all", `Todas (${m.orders.length})`],
              ].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => { setFilter(v); setLimit(ROW_PAGE); }}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${filter === v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <DeliveryGantt rows={visibleOrders.slice(0, limit)} today={m.today} emptyFilter={filter} />
            {visibleOrders.length > limit && (
              <button
                onClick={() => setLimit((n) => n + ROW_PAGE)}
                className="mt-3 w-full rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Mostrar {Math.min(ROW_PAGE, visibleOrders.length - limit)} órdenes más de {visibleOrders.length - limit}
              </button>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Modelo
function buildModel({ customer, workOrders, assignments, prodRows }) {
  const today = toYmd(new Date());
  const key = norm(customer);
  const wos = workOrders.filter((w) => norm(w.customer_name) === key);
  const ids = new Set(wos.map((w) => String(w.id)));

  // ── Plan (asignaciones) ──
  const planByWo = new Map();      // id -> { start, finish, lines:Set }
  const futureByLine = new Map();  // line -> pzas planeadas pendientes
  const planEndByLine = new Map(); // line -> último día asignado
  const futureByWeek = new Map();  // semana -> pzas planeadas pendientes
  const todayAssigned = new Map(); // wo|line -> pzas asignadas hoy
  for (const a of assignments) {
    const id = String(a.work_order_id);
    if (!ids.has(id) || DEAD.has(lower(a.status))) continue;
    const d = ymd(a.assigned_date);
    if (!d) continue;
    const line = String(a.line_no ?? "");
    const q = num(a.assigned_quantity);
    let p = planByWo.get(id);
    if (!p) { p = { start: d, finish: d, lines: new Set() }; planByWo.set(id, p); }
    if (d < p.start) p.start = d;
    if (d > p.finish) p.finish = d;
    if (line) p.lines.add(line);
    if (line && (!planEndByLine.has(line) || d > planEndByLine.get(line))) planEndByLine.set(line, d);
    if (d > today) {
      futureByLine.set(line, (futureByLine.get(line) || 0) + q);
      const w = weekOf(d);
      futureByWeek.set(w, (futureByWeek.get(w) || 0) + q);
    } else if (d === today) {
      const k = `${id}|${line}`;
      todayAssigned.set(k, (todayAssigned.get(k) || 0) + q);
    }
  }

  // ── Producción real (orden, línea, día) ──
  const lines = new Map();        // line -> { produced, lastDay, orders:Set }
  const prodLinesByWo = new Map();
  const producedByWeek = new Map();
  const todayProduced = new Map();
  let firstDay = null;
  let paceSum = 0;
  const paceFrom = addDays(today, -(PACE_WINDOW_DAYS - 1));
  for (const r of prodRows) {
    const id = String(r.work_order_id);
    const line = String(r.line_no ?? "");
    const q = num(r.produced);
    const d = ymd(r.day);
    if (!d || q <= 0) continue;
    let L = lines.get(line);
    if (!L) { L = { produced: 0, lastDay: d, orders: new Set() }; lines.set(line, L); }
    L.produced += q;
    if (d > L.lastDay) L.lastDay = d;
    L.orders.add(id);
    if (!prodLinesByWo.has(id)) prodLinesByWo.set(id, new Set());
    prodLinesByWo.get(id).add(line);
    const w = weekOf(d);
    producedByWeek.set(w, (producedByWeek.get(w) || 0) + q);
    if (!firstDay || d < firstDay) firstDay = d;
    if (d >= paceFrom && d <= today) paceSum += q;
    if (d === today) todayProduced.set(`${id}|${line}`, (todayProduced.get(`${id}|${line}`) || 0) + q);
  }
  // Lo que queda del día de hoy cuenta como planeado de esta semana
  const thisWeek = weekOf(today);
  for (const [k, q] of todayAssigned) {
    const rest = Math.max(q - (todayProduced.get(k) || 0), 0);
    if (!rest) continue;
    const line = k.split("|")[1];
    futureByWeek.set(thisWeek, (futureByWeek.get(thisWeek) || 0) + rest);
    futureByLine.set(line, (futureByLine.get(line) || 0) + rest);
  }

  // ── Órdenes ──
  const orders = wos.map((wo) => {
    const id = String(wo.id);
    const st = lower(wo.status);
    const target = num(wo.total_to_produce) || num(wo.quantity);
    const produced = num(wo.produced_quantity);
    const assigned = num(wo.assigned_quantity);
    const dead = DEAD.has(st);
    const completed = st === "completed" || (target > 0 && produced >= target);
    const p = planByWo.get(id);
    const merchantDate = ymd(wo.commitment_date);
    const planStart = p?.start || "";
    const planFinish = p?.finish || "";
    let deliv;
    if (!merchantDate) deliv = "nofecha";
    else if (!planFinish) deliv = "sinplan";
    else deliv = daysBetween(merchantDate, planFinish) > 0 ? "late" : "ontime";
    const lineSet = new Set([...(p?.lines || []), ...(prodLinesByWo.get(id) || [])]);
    return {
      id, no: wo.work_order_no || `#${wo.id}`,
      style: wo.style_code || wo.estilo || "", color: wo.color || "", po: wo.customer_po || "",
      target, produced, assigned, open: !dead && !completed, dead, completed,
      merchantDate, planStart, planFinish, deliv,
      delta: merchantDate && planFinish ? daysBetween(merchantDate, planFinish) : null,
      lines: [...lineSet].filter(Boolean).sort(byLine),
    };
  });
  const rank = { late: 0, sinplan: 1, nofecha: 2, ontime: 3 };
  orders.sort((a, b) =>
    (a.open === b.open ? 0 : a.open ? -1 : 1) ||
    rank[a.deliv] - rank[b.deliv] ||
    (b.delta ?? -1e9) - (a.delta ?? -1e9) ||
    String(a.merchantDate || "9").localeCompare(String(b.merchantDate || "9"))
  );

  // ── Totales (órdenes abiertas) ──
  const open = orders.filter((o) => o.open);
  const sum = (arr, f) => arr.reduce((s, o) => s + f(o), 0);
  const target = sum(open, (o) => o.target);
  const produced = sum(open, (o) => Math.min(o.produced, o.target || o.produced));
  const assigned = sum(open, (o) => Math.min(o.assigned, o.target || o.assigned));
  const remaining = sum(open, (o) => Math.max(o.target - o.produced, 0));
  const unassigned = sum(open, (o) => Math.max(o.target - Math.max(o.assigned, o.produced), 0));
  const finish = open.reduce((mx, o) => (o.planFinish > mx ? o.planFinish : mx), "");
  const lastCommit = open.reduce((mx, o) => (o.merchantDate > mx ? o.merchantDate : mx), "");
  const producedAll = prodRows.length
    ? [...lines.values()].reduce((s, L) => s + L.produced, 0)
    : sum(orders, (o) => o.produced);

  const paceDays = countWorkdays(paceFrom, today);
  const pace = paceDays > 0 ? paceSum / paceDays : 0;
  const paceFinish = pace > 0 && remaining > 0 ? addWorkdays(today, remaining / pace) : null;

  const counts = {
    open: open.length,
    late: open.filter((o) => o.deliv === "late").length,
    unplanned: open.filter((o) => o.deliv === "sinplan" || o.deliv === "nofecha").length,
  };

  // ── Semanas ──
  const lastPlanWeek = [...futureByWeek.keys()].sort().pop() || thisWeek;
  const lastDueWeek = lastCommit ? weekOf(lastCommit) : thisWeek;
  let start = weekOf(addDays(today, -7 * HISTORY_WEEKS));
  if (firstDay && weekOf(firstDay) > start) start = weekOf(firstDay);
  if (!firstDay) start = thisWeek;
  let end = [lastPlanWeek, lastDueWeek, thisWeek, paceFinish ? weekOf(paceFinish) : thisWeek].sort().pop();
  const weeks = [];
  for (let w = start; w <= end && weeks.length < MAX_WEEKS; w = addDays(w, 7)) weeks.push(w);
  const dueByWeek = new Map();
  for (const o of open) {
    if (!o.merchantDate) continue;
    const w = weekOf(o.merchantDate);
    const e = dueByWeek.get(w) || { n: 0, late: 0 };
    e.n++; if (o.deliv === "late") e.late++;
    dueByWeek.set(w, e);
  }
  const weekRows = weeks.map((w) => ({
    week: w,
    produced: producedByWeek.get(w) || 0,
    planned: futureByWeek.get(w) || 0,
    due: dueByWeek.get(w) || null,
    isCurrent: w === thisWeek,
    isFinish: finish && weekOf(finish) === w,
    isPace: paceFinish && weekOf(paceFinish) === w,
  }));

  // ── Líneas ──
  const allLines = new Set([...lines.keys(), ...futureByLine.keys()]);
  const lineRows = [...allLines].filter(Boolean).map((l) => ({
    line: l,
    produced: lines.get(l)?.produced || 0,
    lastDay: lines.get(l)?.lastDay || "",
    orders: lines.get(l)?.orders.size || 0,
    planned: futureByLine.get(l) || 0,
    planEnd: planEndByLine.get(l) || "",
  })).sort((a, b) => b.produced - a.produced || b.planned - a.planned || byLine(a.line, b.line));
  const lineList = [...new Set([...allLines, ...orders.flatMap((o) => o.lines)])].filter(Boolean).sort(byLine);

  return {
    today, orders, counts, lineList, lineRows, weekRows,
    totals: { target, produced, assigned, remaining, unassigned, finish, lastCommit, producedAll },
    pace, paceFinish, paceDays,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Secciones

function Forecast({ m, loading }) {
  const { totals, pace, paceFinish, today, counts } = m;
  if (counts.open === 0) {
    return (
      <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
        Este cliente no tiene órdenes abiertas.
        {totals.producedAll > 0 && <> Ha producido <b className="text-gray-900">{fmtInt(totals.producedAll)} pzas</b> en total.</>}
      </div>
    );
  }
  const planGap = paceFinish && totals.finish ? daysBetween(totals.finish, paceFinish) : null;
  const commitGap = totals.finish && totals.lastCommit ? daysBetween(totals.lastCommit, totals.finish) : null;
  return (
    <div className="rounded-2xl border border-gray-200 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500">Termina según el plan</p>
          <p className="text-2xl font-bold tracking-tight">{fmtDate(totals.finish) || "Sin plan"}</p>
          <p className="text-xs text-gray-500">
            {totals.finish
              ? <>Faltan <b className="text-gray-800">{daysBetween(today, totals.finish)}</b> días
                {commitGap != null && (commitGap > 0
                  ? <> · <span className="text-rose-600">{commitGap} d después de la última entrega</span></>
                  : <> · dentro de la última entrega ({fmtDate(totals.lastCommit)})</>)}</>
              : "Ninguna orden abierta tiene asignaciones."}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Termina al ritmo real</p>
          {loading ? (
            <p className="text-2xl font-bold text-gray-300">…</p>
          ) : paceFinish ? (
            <>
              <p className={`text-2xl font-bold tracking-tight ${planGap > 0 ? "text-rose-600" : "text-gray-900"}`}>{fmtDate(paceFinish)}</p>
              <p className="text-xs text-gray-500">
                {fmtInt(pace)} pzas/día en las últimas 2 semanas
                {planGap != null && (planGap > 0
                  ? <> · <span className="text-rose-600">{planGap} d después del plan</span></>
                  : planGap < 0 ? <> · {-planGap} d antes del plan</> : <> · igual que el plan</>)}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-gray-300">Sin ritmo</p>
              <p className="text-xs text-gray-500">No hubo producción en las últimas 2 semanas.</p>
            </>
          )}
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1 text-[11px] text-gray-400">
        <Info className="w-3.5 h-3.5" />
        Ritmo = piezas terminadas ÷ días hábiles (lun–sáb) de los últimos {PACE_WINDOW_DAYS} días, aplicado a las {fmtInt(totals.remaining)} pzas que faltan.
      </p>
    </div>
  );
}

function Kpis({ m }) {
  const t = m.totals;
  const cards = [
    { label: "Órdenes abiertas", value: fmtInt(m.counts.open), Icon: Package },
    { label: "Pzas abiertas", value: fmtInt(t.target), Icon: Package },
    { label: "Producido", value: `${Math.round(pct(t.produced, t.target) * 100)}%`, sub: `${fmtInt(t.produced)} pzas`, Icon: CheckCircle2 },
    { label: "Asignado", value: `${Math.round(pct(t.assigned, t.target) * 100)}%`, sub: `${fmtInt(t.unassigned)} sin asignar`, Icon: CalendarClock },
    { label: "Faltan por producir", value: fmtInt(t.remaining), Icon: Factory },
    { label: "Atrasadas", value: fmtInt(m.counts.late), tone: m.counts.late ? "bad" : "muted", Icon: AlertTriangle },
    { label: "Por planear", value: fmtInt(m.counts.unplanned), tone: m.counts.unplanned ? "warn" : "muted", Icon: CalendarClock },
    { label: "Producido histórico", value: fmtInt(t.producedAll), sub: "todas las órdenes", Icon: TrendingUp },
  ];
  const tone = { bad: "text-rose-600", warn: "text-amber-600", muted: "text-gray-900" };
  return (
    <div className="space-y-2">
      {/* Barra de avance: producido / asignado sin producir / sin asignar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100" title="Producido · asignado · sin asignar">
        <div className="bg-violet-500" style={{ width: `${pct(t.produced, t.target) * 100}%` }} />
        <div className="bg-teal-300" style={{ width: `${Math.max(pct(t.assigned, t.target) - pct(t.produced, t.target), 0) * 100}%` }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map(({ label, value, sub, Icon, tone: tn = "muted" }) => (
          <div key={label} className="rounded-xl border border-gray-200 px-3 py-2">
            <p className="flex items-center gap-1 text-[11px] text-gray-500"><Icon className="w-3.5 h-3.5" />{label}</p>
            <p className={`text-lg font-semibold tabular-nums ${tone[tn]}`}>{value}</p>
            {sub && <p className="text-[11px] text-gray-400 tabular-nums">{sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyChart({ m }) {
  const rows = m.weekRows;
  if (!rows.some((r) => r.produced || r.planned || r.due)) {
    return <Empty>Sin producción ni plan para mostrar.</Empty>;
  }
  const max = Math.max(...rows.map((r) => r.produced + r.planned), 1);
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${rows.length * 18}px` }}>
        {/* Marcadores de fin */}
        <div className="flex h-4 gap-[3px]">
          {rows.map((r) => (
            <div key={r.week} className="relative flex-1 min-w-[12px]">
              {(r.isFinish || r.isPace) && (
                <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold ${r.isPace && !r.isFinish ? "text-gray-500" : "text-gray-900"}`}>
                  {r.isFinish && r.isPace ? "Fin" : r.isFinish ? "Fin plan" : "Ritmo"}
                </span>
              )}
            </div>
          ))}
        </div>
        {/* Columnas */}
        <div className="flex h-36 items-end gap-[3px] border-b border-gray-200">
          {rows.map((r) => (
            <div
              key={r.week}
              className={`group relative flex h-full flex-1 min-w-[12px] flex-col justify-end rounded-t ${r.isCurrent ? "bg-gray-50" : ""}`}
              title={`Semana del ${fmtDate(r.week)}\nProducido: ${fmtInt(r.produced)}\nPlaneado: ${fmtInt(r.planned)}${r.due ? `\nEntregas: ${r.due.n}${r.due.late ? ` (${r.due.late} atrasadas)` : ""}` : ""}`}
            >
              {r.planned > 0 && <div className="w-full rounded-t-sm bg-teal-300" style={{ height: `${(r.planned / max) * 100}%` }} />}
              {r.produced > 0 && <div className={`w-full bg-violet-500 ${r.planned ? "" : "rounded-t-sm"}`} style={{ height: `${(r.produced / max) * 100}%` }} />}
              {(r.isFinish || r.isPace) && (
                <div className={`pointer-events-none absolute inset-y-0 left-1/2 border-l ${r.isFinish ? "border-gray-900" : "border-dashed border-gray-400"}`} />
              )}
            </div>
          ))}
        </div>
        {/* Entregas del merchant por semana */}
        <div className="mt-1 flex gap-[3px]">
          {rows.map((r) => (
            <div key={r.week} className="flex-1 min-w-[12px] text-center">
              {r.due && (
                <span className={`inline-block min-w-[14px] rounded px-0.5 text-[10px] font-semibold leading-4 ${r.due.late ? "bg-rose-100 text-rose-700" : "bg-gray-100 text-gray-600"}`}>
                  {r.due.n}
                </span>
              )}
            </div>
          ))}
        </div>
        {/* Fechas cada 4 semanas */}
        <div className="mt-0.5 flex gap-[3px]">
          {rows.map((r, i) => (
            <div key={r.week} className="relative flex-1 min-w-[12px]">
              {(i % 4 === 0 || r.isCurrent) && (
                <span className={`absolute left-0 whitespace-nowrap text-[10px] ${r.isCurrent ? "font-semibold text-gray-900" : "text-gray-400"}`}>
                  {r.isCurrent ? "Hoy" : fmtDate(r.week, false)}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="h-4" />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Los números bajo las barras son las entregas del merchant de esa semana; en rojo si alguna tiene el plan atrasado.
      </p>
    </div>
  );
}

function LinesBreakdown({ m }) {
  const rows = m.lineRows;
  if (rows.length === 0) return <Empty>Ninguna línea ha producido ni tiene plan para este cliente.</Empty>;
  const max = Math.max(...rows.map((r) => r.produced + r.planned), 1);
  return (
    <div className="divide-y divide-gray-100">
      {rows.map((r) => {
        const stale = r.lastDay && daysBetween(r.lastDay, m.today) > 7;
        return (
          <div key={r.line} className="grid grid-cols-[3rem_minmax(0,1fr)_7.5rem] items-center gap-3 py-2">
            <span className="text-sm font-semibold">{lineLabel(r.line)}</span>
            <div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="bg-violet-500" style={{ width: `${(r.produced / max) * 100}%` }} />
                <div className="bg-teal-300" style={{ width: `${(r.planned / max) * 100}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                {fmtInt(r.produced)} producidas
                {r.orders > 0 && <> en {r.orders} {r.orders === 1 ? "orden" : "órdenes"}</>}
                {r.planned > 0 && <> · {fmtInt(r.planned)} planeadas hasta {fmtDate(r.planEnd)}</>}
              </p>
            </div>
            <div className="text-right text-[11px] leading-tight">
              {r.lastDay ? (
                <>
                  <p className="text-gray-400">Última captura</p>
                  <p className={stale ? "text-amber-600 font-medium" : "text-gray-700"}>{fmtDate(r.lastDay)}</p>
                </>
              ) : (
                <p className="text-gray-400">Aún sin producir</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeliveryGantt({ rows, today, emptyFilter }) {
  if (rows.length === 0) {
    return (
      <Empty>
        {emptyFilter === "late" ? "Ninguna orden abierta tiene el plan después de la entrega."
          : emptyFilter === "unplanned" ? "Todas las órdenes abiertas tienen plan y fecha de entrega."
          : "No hay órdenes con este filtro."}
      </Empty>
    );
  }
  // Dominio del eje: hoy … última fecha relevante
  const dates = [today];
  for (const r of rows) for (const d of [r.planStart, r.planFinish, r.merchantDate]) if (d) dates.push(d);
  dates.sort();
  const lo = addDays(dates[0], -2);
  const hi = addDays(dates[dates.length - 1], 3);
  const span = Math.max(daysBetween(lo, hi), 1);
  const pos = (k) => `${(daysBetween(lo, k) / span) * 100}%`;
  // Inicio de cada mes dentro del dominio
  const months = [];
  for (let d = parse(lo); toYmd(d) <= hi; d.setMonth(d.getMonth() + 1, 1)) {
    const k = toYmd(new Date(d.getFullYear(), d.getMonth(), 1));
    if (k >= lo) months.push(k);
  }

  return (
    <div className="text-xs">
      {/* Eje de meses */}
      <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4rem] gap-3">
        <div />
        <div className="relative h-4">
          {months.map((k) => (
            <span key={k} className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-gray-400" style={{ left: pos(k) }}>
              {parse(k).toLocaleDateString("es-MX", { month: "short", year: "2-digit" })}
            </span>
          ))}
        </div>
        <div />
      </div>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {rows.map((o) => {
          const cfg = DELIV[o.deliv];
          return (
            <div key={o.id} className={`grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4rem] items-center gap-3 py-1.5 ${o.open ? "" : "opacity-50"}`}>
              {/* Orden */}
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">
                  {o.no} <span className="font-normal text-gray-500">{o.style}{o.color && ` · ${o.color}`}</span>
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <div className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full bg-violet-500" style={{ width: `${pct(o.produced, o.target) * 100}%` }} />
                  </div>
                  <span className="truncate text-[10px] text-gray-500 tabular-nums">
                    {fmtInt(o.produced)}/{fmtInt(o.target)}
                    {o.lines.length > 0 && <> · {o.lines.map(lineLabel).join(" ")}</>}
                  </span>
                </div>
              </div>
              {/* Barra de plan + entrega */}
              <div
                className="relative h-6"
                title={`Plan: ${fmtDate(o.planStart) || "—"} → ${fmtDate(o.planFinish) || "—"}\nEntrega merchant: ${fmtDate(o.merchantDate) || "sin fecha"}`}
              >
                <div className="absolute inset-y-0 border-l border-dashed border-gray-300" style={{ left: pos(today) }} />
                {o.planStart && o.planFinish && (
                  <div
                    className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${cfg.bar}`}
                    style={{ left: pos(o.planStart), width: `max(4px, ${(Math.max(daysBetween(o.planStart, o.planFinish), 0) / span) * 100}%)` }}
                  />
                )}
                {o.merchantDate && (
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-white bg-gray-900"
                    style={{ left: pos(o.merchantDate) }}
                  />
                )}
              </div>
              {/* Veredicto */}
              <div className="text-right leading-tight">
                <p className={`font-semibold tabular-nums ${cfg.text}`}>
                  {o.deliv === "late" ? `+${o.delta} d` : o.deliv === "ontime" ? (o.delta === 0 ? "justo" : `${o.delta} d`) : "—"}
                </p>
                <p className="text-[10px] text-gray-400">{o.deliv === "ontime" || o.deliv === "late" ? fmtDate(o.merchantDate, false) : cfg.label}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        La línea punteada es hoy. Días positivos = el plan termina después de la entrega del merchant.
      </p>
    </div>
  );
}

// ── Piezas chicas ──────────────────────────────────────────────────────────
function Section({ Icon, title, aside, children }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className="w-4 h-4 text-teal-600" />{title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          {cls === "diamond"
            ? <span className="inline-block h-2 w-2 rotate-45 bg-gray-900" />
            : <span className={`inline-block h-2 w-3 rounded-sm ${cls}`} />}
          {label}
        </span>
      ))}
    </div>
  );
}

function Loading() {
  return <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />Cargando producción…</div>;
}

function Empty({ children }) {
  return <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">{children}</p>;
}