// components/planner/PlannerAnalytics.jsx
//
// Analíticas de planeación. Shell de alto fijo (sin scroll de página): el
// encabezado, los KPIs, las pestañas y los filtros quedan siempre a la vista;
// SOLO la tabla interior hace scroll.
//
// Pestañas — cada una trae SUS PROPIOS KPIs, leyenda y barra de distribución:
//   • SAM               Merchant vs Producción por estilo / línea.
//                       Regla: SAM producción (line_runs.sam_minutes) debe ser
//                       MENOR que SAM merchant (work_orders.sam_minutes).
//   • Estado de órdenes Avance, estado y FECHAS: entrega del merchant
//                       (commitment_date) vs fin de plan del planner
//                       (máx. assigned_date en line_assignments).
//   • Tablero           El Plan Board del planner en modo consulta.

import { useState, useEffect, useMemo } from "react";
import {
  LayoutGrid, Gauge, Search, Loader2, CheckCircle2, AlertTriangle,
  MinusCircle, ArrowUpDown, Layers, Info, CalendarClock, Package,
  ClipboardList, Truck,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import PlanBoard from "./PlanBoard";
import NavCeo from "../NavCeo";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const norm = (s) => String(s || "").trim().toUpperCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtSam = (v) => (v > 0 ? v.toFixed(2) : "—");
const fmtInt = (v) => Math.round(num(v)).toLocaleString();
const DEAD = new Set(["cancelled", "rejected"]);

const ymd = (s) => (s ? String(s).slice(0, 10) : "");
const fmtDate = (s) => {
  const k = ymd(s);
  if (!k) return null;
  const d = new Date(`${k}T00:00:00`);
  return isNaN(d) ? null : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
};
const daysBetween = (aStr, bStr) => {
  const a = new Date(`${ymd(aStr)}T00:00:00`);
  const b = new Date(`${ymd(bStr)}T00:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

// ── SAM compliance ─────────────────────────────────────────────────────────
const samStatusOf = (merchantSam, prodSam) => {
  if (!(merchantSam > 0) || !(prodSam > 0)) return "nodata";
  return prodSam < merchantSam ? "ok" : "bad";
};
const SAM_ST = {
  ok:     { label: "Cumple",   accent: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", bar: "bg-emerald-500", Icon: CheckCircle2 },
  bad:    { label: "Incumple", accent: "bg-rose-400",    chip: "bg-rose-50 text-rose-700 ring-rose-600/20",          bar: "bg-rose-500",    Icon: AlertTriangle },
  nodata: { label: "Sin dato", accent: "bg-gray-200",    chip: "bg-gray-100 text-gray-500 ring-gray-500/20",         bar: "bg-gray-300",    Icon: MinusCircle },
};

// ── Delivery verdict (planner finish vs merchant delivery) ──────────────────
const DELIV = {
  ontime:  { label: "A tiempo",   accent: "bg-emerald-400", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  late:    { label: "Atrasada",   accent: "bg-rose-400",    chip: "bg-rose-50 text-rose-700 ring-rose-600/20",          Icon: AlertTriangle },
  sinplan: { label: "Por planear",accent: "bg-amber-300",   chip: "bg-amber-50 text-amber-700 ring-amber-600/20",       Icon: CalendarClock },
  nofecha: { label: "Sin fecha",  accent: "bg-gray-200",    chip: "bg-gray-100 text-gray-500 ring-gray-500/20",         Icon: MinusCircle },
};

// ── Order status vocabulary ─────────────────────────────────────────────────
const ORDER_ST = {
  pending:     { label: "Pendiente",  chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  in_progress: { label: "En proceso", chip: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  completed:   { label: "Completada", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  cancelled:   { label: "Cancelada",  chip: "bg-gray-100 text-gray-500 ring-gray-500/20" },
  rejected:    { label: "Rechazada",  chip: "bg-gray-100 text-gray-500 ring-gray-500/20" },
};
const orderStChip = (raw) => ORDER_ST[String(raw || "").toLowerCase()]
  || { label: raw ? String(raw) : "—", chip: "bg-gray-100 text-gray-500 ring-gray-500/20" };

export default function PlannerAnalytics() {
  const [tab, setTab] = useState("sam");     // "sam" | "orders" | "board"
  const [boardVisited, setBoardVisited] = useState(false);

  const [workOrders, setWorkOrders] = useState([]);
  const [lineRuns, setLineRuns] = useState([]);
  const [merchantPlan, setMerchantPlan] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  // SAM view controls
  const [grain, setGrain] = useState("style");   // "style" | "line"
  const [samOnly, setSamOnly] = useState("all");  // "all" | "bad" | "nodata"
  // Orders view controls
  const [ordOnly, setOrdOnly] = useState("all");  // "all" | "late" | "unplanned" | "open"
  const [ordProc, setOrdProc] = useState("all");  // "all" | "pending" | "in_progress" | "completed"
  // shared
  const [search, setSearch] = useState("");
  const [worstFirst, setWorstFirst] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErrored(false);
      try {
        const [woRes, lrRes, mpRes, asRes] = await Promise.all([
          fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/line-runs`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/merchant-plan`, { headers: authHeaders() }).catch(() => null),
          fetch(`${API_URL}/api/line-assignments`, { headers: authHeaders() }).catch(() => null),
        ]);
        const wo = await woRes.json();
        const lr = await lrRes.json();
        const mp = mpRes && mpRes.ok ? await mpRes.json().catch(() => null) : null;
        const as = asRes && asRes.ok ? await asRes.json().catch(() => null) : null;
        if (cancelled) return;
        setWorkOrders(wo?.success ? wo.workOrders || [] : []);
        setLineRuns(lr?.success ? lr.runs || [] : []);
        setMerchantPlan(mp?.success ? mp.plan || [] : []);
        setAssignments(as?.success ? as.assignments || [] : []);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (tab === "board") setBoardVisited(true); }, [tab]);
  // Cambiar de pestaña limpia la búsqueda para no arrastrar un filtro que no aplica.
  useEffect(() => { setSearch(""); }, [tab]);

  // ── SAM model ─────────────────────────────────────────────────────────────
  const { styleRows, lineRows, orderSamRows } = useMemo(() => {
    const styles = new Map();
    const ensure = (code, seed = {}) => {
      let e = styles.get(code);
      if (!e) {
        e = {
          styleCode: code, estilo: "", description: "",
          merchantSam: 0, planSam: 0, woSam: 0, samSeen: new Set(),
          customers: new Set(), ...seed,
        };
        styles.set(code, e);
      }
      return e;
    };

    // Per-order SAM snapshot, keyed by work order id, so a LINE row can resolve
    // the merchant SAM of the exact order on its run (line_runs.work_order_id)
    // instead of a by-style guess.
    const woSamById = new Map();

    // (1) Work orders carry a per-order SAM snapshot. Collect every distinct SAM
    //     seen for the style so we can detect when one style_code disagrees with
    //     itself (e.g. CABPTS01 = 26.74 on one order, 18.78 on another).
    for (const wo of workOrders) {
      const code = norm(wo.style_code) || norm(wo.estilo);
      if (!code) continue;
      const e = ensure(code, { styleCode: wo.style_code || wo.estilo || code, estilo: wo.estilo || "" });
      const sam = num(wo.sam_minutes);
      if (sam > 0) {
        if (!(e.woSam > 0)) e.woSam = sam;
        e.samSeen.add(sam);
        if (wo.id != null) woSamById.set(String(wo.id), sam);
      }
      if (!e.description && wo.style_description) e.description = wo.style_description;
      if (wo.customer_name) e.customers.add(wo.customer_name);
    }
    // (2) The merchant plan is the AUTHORITATIVE merchant source (same convention
    //     as the Plan Board) — it takes precedence over the work-order snapshot.
    for (const r of merchantPlan) {
      const code = norm(r.style_code) || norm(r.estilo);
      if (!code) continue;
      const e = ensure(code, { styleCode: r.style_code || r.estilo || code, estilo: r.estilo || "" });
      const sam = num(r.sam_minutes);
      if (sam > 0) {
        if (!(e.planSam > 0)) e.planSam = sam;
        e.samSeen.add(sam);
      }
      if (!e.description && r.style_description) e.description = r.style_description;
      if (r.customer_name) e.customers.add(r.customer_name);
    }

    // (3) Resolve ONE representative merchant SAM per style and flag inconsistency.
    //     Prefer the authoritative merchant plan; else the work-order snapshot.
    //     When a style_code carries several DIFFERENT SAMs, the "first wins" rule
    //     used to pick whichever order happened to iterate first — which is how a
    //     stale 18.78 could mask the real 26.74 and raise a false "Incumple". We
    //     now pick deterministically (plan first, else the largest snapshot so a
    //     stale low value can't trip compliance) and mark the row conflicted.
    for (const e of styles.values()) {
      const distinct = [...e.samSeen].filter((x) => x > 0).sort((a, b) => a - b);
      e.merchantSamConflict = distinct.length > 1;
      e.merchantSamValues = distinct;
      e.merchantSam = e.planSam > 0 ? e.planSam : (distinct.length ? distinct[distinct.length - 1] : 0);
    }

    const latest = new Map(); // line|code -> run
    for (const run of lineRuns) {
      const code = norm(run.style);
      if (!code) continue;
      const key = `${String(run.line_no)}|${code}`;
      const t = new Date(run.run_date).getTime();
      const tt = Number.isFinite(t) ? t : -Infinity;
      const prev = latest.get(key);
      if (!prev || tt >= prev._t) latest.set(key, { ...run, _t: tt });
    }
    const prodByStyle = new Map();
    // Worst (max) production SAM by exact order, then by style_code — used to give
    // each order row a production comparison even though runs are keyed line+style.
    const prodSamByWo = new Map();
    const prodSamByStyle = new Map();
    for (const run of latest.values()) {
      const code = norm(run.style);
      const arr = prodByStyle.get(code) || [];
      arr.push({ line: String(run.line_no), prodSam: num(run.sam_minutes), efficiency: num(run.efficiency) });
      prodByStyle.set(code, arr);
      const ps = num(run.sam_minutes);
      if (ps > 0) {
        prodSamByStyle.set(code, Math.max(prodSamByStyle.get(code) || 0, ps));
        if (run.work_order_id != null) {
          const k = String(run.work_order_id);
          prodSamByWo.set(k, Math.max(prodSamByWo.get(k) || 0, ps));
        }
      }
    }

    // The merchant SAM for a SPECIFIC order+color, from the authoritative merchant
    // plan when it lists that order, else the order's own work_orders snapshot.
    const mpSamByOrder = new Map(); // norm(work_order_no)|COLOR -> sam
    for (const r of merchantPlan) {
      const s = num(r.sam_minutes);
      if (!(s > 0)) continue;
      const no = norm(r.work_order_no);
      if (no) mpSamByOrder.set(`${no}|${norm(r.color)}`, s);
    }

    const styleRows = [];
    for (const [code, e] of styles) {
      const prod = prodByStyle.get(code) || [];
      const sams = prod.map((p) => p.prodSam).filter((x) => x > 0);
      const worst = sams.length ? Math.max(...sams) : 0;
      const has = e.merchantSam > 0 && sams.length > 0;
      styleRows.push({
        key: code, styleCode: e.styleCode || code, description: e.description,
        merchantSam: e.merchantSam, prodSam: worst, lineCount: prod.length,
        delta: has ? e.merchantSam - worst : null,
        pct: has ? worst / e.merchantSam : null,
        status: samStatusOf(e.merchantSam, worst),
        merchantSamConflict: e.merchantSamConflict, merchantSamValues: e.merchantSamValues,
        search: `${e.styleCode} ${e.estilo} ${e.description} ${[...e.customers].join(" ")}`.toUpperCase(),
      });
    }
    const lineRows = [];
    for (const run of latest.values()) {
      const code = norm(run.style);
      const e = styles.get(code);
      // Prefer the SAM of the exact order on this run (line_runs.work_order_id)
      // over the style-level representative, so a line comparison is order-accurate
      // even when the style_code is inconsistent across orders.
      const runWoSam = run.work_order_id != null ? (woSamById.get(String(run.work_order_id)) || 0) : 0;
      const merchantSam = runWoSam > 0 ? runWoSam : (e ? e.merchantSam : 0);
      const prodSam = num(run.sam_minutes);
      const has = merchantSam > 0 && prodSam > 0;
      lineRows.push({
        key: `${String(run.line_no)}|${code}`, line: String(run.line_no),
        styleCode: e?.styleCode || run.style, description: e?.description || "",
        merchantSam, prodSam, delta: has ? merchantSam - prodSam : null,
        pct: has ? prodSam / merchantSam : null,
        status: samStatusOf(merchantSam, prodSam), efficiency: num(run.efficiency),
        // Conflict is only meaningful when this row fell back to the style-level
        // value; an order-accurate row (runWoSam) is unambiguous.
        merchantSamConflict: runWoSam > 0 ? false : !!e?.merchantSamConflict,
        merchantSamValues: e?.merchantSamValues || [],
        search: `L${String(run.line_no)} ${e?.styleCode || run.style} ${e?.description || ""}`.toUpperCase(),
      });
    }
    // Per-ORDER breakdown: one row for every work order of a style, showing its
    // color, description, PO and its OWN merchant SAM — so all the SAMs a style
    // carries are visible side by side instead of collapsed to one representative.
    const orderSamRows = [];
    for (const wo of workOrders) {
      if (DEAD.has(String(wo.status || "").toLowerCase())) continue;
      const code = norm(wo.style_code) || norm(wo.estilo);
      if (!code) continue;
      const e = styles.get(code);
      const mSam = mpSamByOrder.get(`${norm(wo.work_order_no)}|${norm(wo.color)}`) || num(wo.sam_minutes);
      const pSam = (wo.id != null ? prodSamByWo.get(String(wo.id)) : 0) || prodSamByStyle.get(code) || 0;
      const has = mSam > 0 && pSam > 0;
      orderSamRows.push({
        key: `wo-${wo.id}`,
        styleCode: wo.style_code || wo.estilo || code,
        description: wo.style_description || e?.description || "",
        color: wo.color || "—",
        no: wo.work_order_no || `#${wo.id}`,
        customer: wo.customer_name || "",
        po: wo.customer_po || "",
        merchantSam: mSam, prodSam: pSam,
        delta: has ? mSam - pSam : null,
        pct: has ? pSam / mSam : null,
        status: samStatusOf(mSam, pSam),
        // Flag when this order's SAM disagrees with a sibling order of the same style.
        styleConflict: !!e?.merchantSamConflict,
        search: `${wo.work_order_no || ""} ${wo.customer_name || ""} ${wo.customer_po || ""} ${wo.style_code || ""} ${wo.estilo || ""} ${wo.color || ""} ${wo.style_description || ""}`.toUpperCase(),
      });
    }
    return { styleRows, lineRows, orderSamRows };
  }, [workOrders, lineRuns, merchantPlan]);

  // ── Orders model (status + delivery dates) ──────────────────────────────────
  const orderRows = useMemo(() => {
    // Fechas de plan por orden: mín/máx assigned_date (sin canceladas/rechazadas).
    const plan = new Map(); // wo_id -> { start, finish, assigned }
    for (const a of assignments) {
      if (DEAD.has(String(a.status || "").toLowerCase())) continue;
      const id = a.work_order_id;
      const d = ymd(a.assigned_date);
      if (id == null || !d) continue;
      let p = plan.get(id);
      if (!p) { p = { start: d, finish: d, assigned: 0 }; plan.set(id, p); }
      if (d < p.start) p.start = d;
      if (d > p.finish) p.finish = d;
      p.assigned += num(a.assigned_quantity);
    }

    const rows = [];
    for (const wo of workOrders) {
      const st = String(wo.status || "").toLowerCase();
      const target = num(wo.total_to_produce) || num(wo.quantity);
      const produced = num(wo.produced_quantity);
      const assigned = num(wo.assigned_quantity);
      const p = plan.get(wo.id);
      const merchantDate = ymd(wo.commitment_date);
      const finish = p?.finish || "";
      const start = p?.start || "";

      // Lifecycle state, derived from status + real production so it's meaningful
      // regardless of the raw status vocabulary (planned/released/completed):
      //   completada  = status completed, or produced has reached the target
      //   en proceso  = something has been produced but not finished
      //   pendiente   = nothing produced yet
      //   cancelada/rechazada keep their dead status.
      const dead = DEAD.has(st);
      let proc;
      if (dead) proc = st;
      else if (st === "completed" || (target > 0 && produced >= target)) proc = "completed";
      else if (produced > 0) proc = "in_progress";
      else proc = "pending";

      let deliv;
      if (!merchantDate) deliv = "nofecha";
      else if (!finish) deliv = "sinplan";
      else deliv = daysBetween(merchantDate, finish) > 0 ? "late" : "ontime";
      const delta = merchantDate && finish ? daysBetween(merchantDate, finish) : null;

      rows.push({
        key: wo.id,
        no: wo.work_order_no || `#${wo.id}`,
        customer: wo.customer_name || "",
        po: wo.customer_po || "",
        styleCode: wo.style_code || wo.estilo || "",
        orderStatus: st,
        proc,
        dead,
        target, produced, assigned,
        progress: target > 0 ? Math.min(produced / target, 1) : 0,
        merchantDate, planStart: start, planFinish: finish,
        deliv, delta,
        search: `${wo.work_order_no || ""} ${wo.customer_name || ""} ${wo.customer_po || ""} ${wo.style_code || ""} ${wo.estilo || ""}`.toUpperCase(),
      });
    }
    return rows;
  }, [workOrders, assignments]);

  // ── Per-tab KPIs + distribution + legend ────────────────────────────────────
  const samKpis = useMemo(() => {
    let ok = 0, bad = 0, nodata = 0, sum = 0;
    for (const r of styleRows) {
      if (r.status === "ok") { ok++; sum += r.delta; }
      else if (r.status === "bad") { bad++; sum += r.delta; }
      else nodata++;
    }
    const judged = ok + bad;
    return {
      cards: [
        { label: "Cumplen", value: ok, tone: "ok", Icon: CheckCircle2 },
        { label: "Incumplen", value: bad, tone: bad ? "bad" : "muted", Icon: AlertTriangle },
        { label: "Sin dato", value: nodata, tone: "muted", Icon: MinusCircle },
        { label: "% cumplimiento", value: `${judged ? Math.round((ok / judged) * 100) : 0}%`, tone: judged && ok / judged >= 0.8 ? "ok" : "bad", Icon: Gauge },
      ],
      dist: [
        { count: ok, cls: "bg-emerald-500", label: "Cumplen" },
        { count: bad, cls: "bg-rose-500", label: "Incumplen" },
        { count: nodata, cls: "bg-gray-300", label: "Sin dato" },
      ],
      hint: (<><Info className="w-3.5 h-3.5" /> La SAM de producción debe ser <b className="text-gray-700">menor</b> que la del merchant.</>),
    };
  }, [styleRows]);

  const ordKpis = useMemo(() => {
    let ontime = 0, late = 0, pend = 0;
    for (const r of orderRows) {
      if (r.dead) continue;
      if (r.deliv === "ontime") ontime++;
      else if (r.deliv === "late") late++;
      else pend++; // sinplan + nofecha
    }
    const judged = ontime + late;
    return {
      cards: [
        { label: "A tiempo", value: ontime, tone: "ok", Icon: CheckCircle2 },
        { label: "Atrasadas", value: late, tone: late ? "bad" : "muted", Icon: AlertTriangle },
        { label: "Por planear", value: pend, tone: "muted", Icon: CalendarClock },
        { label: "% a tiempo", value: `${judged ? Math.round((ontime / judged) * 100) : 0}%`, tone: judged && ontime / judged >= 0.8 ? "ok" : "bad", Icon: Truck },
      ],
      dist: [
        { count: ontime, cls: "bg-emerald-500", label: "A tiempo" },
        { count: late, cls: "bg-rose-500", label: "Atrasadas" },
        { count: pend, cls: "bg-amber-300", label: "Por planear" },
      ],
      hint: (<><Info className="w-3.5 h-3.5" /> El fin de plan debe caer <b className="text-gray-700">antes o el mismo día</b> que la entrega del merchant.</>),
    };
  }, [orderRows]);

  const boardKpis = useMemo(() => {
    const active = workOrders.filter((w) => !DEAD.has(String(w.status || "").toLowerCase()));
    const pzs = active.reduce((s, w) => s + (num(w.total_to_produce) || num(w.quantity)), 0);
    const lines = new Set();
    for (const r of lineRuns) if (r.line_no != null) lines.add(String(r.line_no));
    for (const a of assignments) if (a.line_no != null) lines.add(String(a.line_no));
    return {
      cards: [
        { label: "Órdenes activas", value: fmtInt(active.length), tone: "muted", Icon: ClipboardList },
        { label: "Pzas por producir", value: fmtInt(pzs), tone: "muted", Icon: Package },
        { label: "Líneas", value: lines.size, tone: "muted", Icon: LayoutGrid },
      ],
      dist: null, hint: null,
    };
  }, [workOrders, lineRuns, assignments]);

  const activeKpis = tab === "sam" ? samKpis : tab === "orders" ? ordKpis : boardKpis;

  // ── Visible rows ────────────────────────────────────────────────────────────
  const samVisible = useMemo(() => {
    const base = grain === "style" ? styleRows : grain === "line" ? lineRows : orderSamRows;
    const q = norm(search);
    const rank = { bad: 0, nodata: 1, ok: 2 };
    // The per-order grain groups by style so every SAM of a style sits together;
    // the other grains keep the worst/best-delta ordering.
    if (grain === "order") {
      return base
        .filter((r) => (samOnly === "bad" ? r.status === "bad" : samOnly === "nodata" ? r.status === "nodata" : true))
        .filter((r) => (q ? r.search.includes(q) : true))
        .slice()
        .sort((a, b) =>
          String(a.styleCode).localeCompare(String(b.styleCode)) ||
          (b.merchantSam - a.merchantSam) ||
          String(a.color).localeCompare(String(b.color))
        );
    }
    return base
      .filter((r) => (samOnly === "bad" ? r.status === "bad" : samOnly === "nodata" ? r.status === "nodata" : true))
      .filter((r) => (q ? r.search.includes(q) : true))
      .slice()
      .sort((a, b) => {
        if ((a.delta == null) !== (b.delta == null)) return a.delta == null ? 1 : -1;
        if (a.delta == null) return String(a.styleCode).localeCompare(String(b.styleCode));
        if (worstFirst) return rank[a.status] - rank[b.status] || a.delta - b.delta;
        return b.delta - a.delta;
      });
  }, [grain, styleRows, lineRows, orderSamRows, samOnly, search, worstFirst]);

  const ordVisible = useMemo(() => {
    const q = norm(search);
    const rank = { late: 0, sinplan: 1, nofecha: 2, ontime: 3 };
    return orderRows
      .filter((r) => {
        if (ordOnly === "late") return r.deliv === "late";
        if (ordOnly === "unplanned") return r.deliv === "sinplan" || r.deliv === "nofecha";
        if (ordOnly === "open") return !r.dead && r.orderStatus !== "completed";
        return true;
      })
      .filter((r) => (ordProc === "all" ? true : r.proc === ordProc))
      .filter((r) => (q ? r.search.includes(q) : true))
      .slice()
      .sort((a, b) => {
        if (rank[a.deliv] !== rank[b.deliv]) return rank[a.deliv] - rank[b.deliv];
        const da = a.delta == null ? -Infinity : a.delta;
        const db = b.delta == null ? -Infinity : b.delta;
        return worstFirst ? db - da : da - db; // más atrasadas primero
      });
  }, [orderRows, ordOnly, ordProc, search, worstFirst]);

  return (
    <div className="h-[calc(100dvh-64px)] flex flex-col bg-gray-50 text-gray-900 overflow-hidden">
        <NavCeo />
      {/* Encabezado + KPIs (fijos) */}
      <header className="shrink-0 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-3 pb-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">Analíticas de Planeación</h1>
            <p className="text-xs text-gray-500">
              {tab === "sam" && "SAM del merchant contra la SAM de producción."}
              {tab === "orders" && "Estado, avance y fechas de entrega: merchant vs plan del planner."}
              {tab === "board" && "El tablero que armó planeación, en modo consulta."}
            </p>
          </div>
          <KpiStrip cards={activeKpis.cards} loading={loading} />
        </div>

        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
          <div role="tablist" className="flex gap-1 overflow-x-auto">
            <Tab active={tab === "sam"} onClick={() => setTab("sam")} Icon={Gauge}>SAM: Merchant vs Producción</Tab>
            <Tab active={tab === "orders"} onClick={() => setTab("orders")} Icon={ClipboardList}>Estado de órdenes</Tab>
            <Tab active={tab === "board"} onClick={() => setTab("board")} Icon={LayoutGrid}>Tablero del planner</Tab>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 min-h-0">
        {tab === "board" ? (
          <div className="h-full overflow-auto">
            {boardVisited && (
              <PlanBoard readOnly heading="Tablero del planner" subheading="Vista de consulta." />
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-3">
            {/* Distribución + leyenda + regla (fijo) */}
            {activeKpis.dist && (
              <div className="shrink-0 flex items-center gap-4 flex-wrap">
                <DistributionBar segments={activeKpis.dist} />
                {activeKpis.hint && (
                  <p className="text-[11px] text-gray-500 inline-flex items-center gap-1 shrink-0">{activeKpis.hint}</p>
                )}
              </div>
            )}

            {/* Controles (fijo) */}
            <div className="shrink-0 mt-3 flex items-center gap-2 flex-wrap">
              {tab === "sam" ? (
                <>
                  <Segmented value={grain} onChange={setGrain} options={[
                    { v: "style", label: "Por estilo", Icon: Layers },
                    { v: "line", label: "Por línea", Icon: LayoutGrid },
                    { v: "order", label: "Por orden", Icon: ClipboardList },
                  ]} />
                  <Segmented value={samOnly} onChange={setSamOnly} options={[
                    { v: "all", label: "Todos" },
                    { v: "bad", label: "Solo incumplen" },
                    { v: "nodata", label: "Sin dato" },
                  ]} />
                </>
              ) : (
                <>
                  <Segmented value={ordOnly} onChange={setOrdOnly} options={[
                    { v: "all", label: "Todas" },
                    { v: "open", label: "Abiertas" },
                    { v: "late", label: "Atrasadas" },
                    { v: "unplanned", label: "Por planear" },
                  ]} />
                  <Segmented value={ordProc} onChange={setOrdProc} options={[
                    { v: "all", label: "Todo estado" },
                    { v: "pending", label: "Pendientes", Icon: CalendarClock },
                    { v: "in_progress", label: "En proceso", Icon: Loader2 },
                    { v: "completed", label: "Completadas", Icon: CheckCircle2 },
                  ]} />
                </>
              )}

              <div className="relative ml-auto">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tab === "sam" ? "Buscar estilo o cliente…" : "Buscar orden, cliente o PO…"}
                  className="pl-8 pr-3 py-1.5 w-56 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
              <button
                onClick={() => setWorstFirst((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                <ArrowUpDown className="w-4 h-4" />
                {worstFirst ? "Peores primero" : "Mejores primero"}
              </button>
            </div>

            {/* Tabla (único scroll) */}
            <div className="mt-3 flex-1 min-h-0 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-auto">
                {loading ? (
                  <Centered><Loader2 className="w-5 h-5 animate-spin" /> Cargando…</Centered>
                ) : errored ? (
                  <Centered>No se pudieron cargar los datos. Revisa tu conexión y vuelve a intentar.</Centered>
                ) : tab === "sam" ? (
                  samVisible.length === 0
                    ? <Centered>{samOnly === "bad" ? "Ningún estilo incumple: todo corre por debajo de la SAM del merchant." : "No hay estilos con este filtro."}</Centered>
                    : grain === "style" ? <StyleTable rows={samVisible} /> : grain === "line" ? <LineTable rows={samVisible} /> : <OrderTable rows={samVisible} />
                ) : (
                  ordVisible.length === 0
                    ? <Centered>{ordOnly === "late" ? "No hay órdenes atrasadas. El plan cae dentro de las fechas del merchant." : "No hay órdenes con este filtro."}</Centered>
                    : <OrdersTable rows={ordVisible} />
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── KPI strip ─────────────────────────────────────────────────────────── */
function KpiStrip({ cards, loading }) {
  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>;
  }
  return (
    <div className="flex items-stretch gap-2 sm:gap-2.5">
      {cards.map((c) => <Kpi key={c.label} {...c} />)}
    </div>
  );
}
function Kpi({ label, value, tone = "muted", Icon }) {
  const tones = {
    ok:   { n: "text-emerald-600", i: "bg-emerald-50 text-emerald-600" },
    bad:  { n: "text-rose-600",    i: "bg-rose-50 text-rose-600" },
    warn: { n: "text-amber-600",   i: "bg-amber-50 text-amber-600" },
    muted:{ n: "text-gray-800",    i: "bg-gray-100 text-gray-500" },
  };
  const t = tones[tone] || tones.muted;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white ring-1 ring-gray-200 min-w-[96px]">
      {Icon && <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${t.i}`}><Icon className="w-4 h-4" /></span>}
      <div className="leading-none">
        <div className={`text-lg font-bold tabular-nums ${t.n}`}>{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-1 whitespace-nowrap">{label}</div>
      </div>
    </div>
  );
}

/* ── Tab ───────────────────────────────────────────────────────────────── */
function Tab({ active, onClick, Icon, children }) {
  return (
    <button
      role="tab" aria-selected={active} onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition whitespace-nowrap
        ${active ? "border-indigo-500 text-indigo-600 bg-gray-50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}
    >
      <Icon className="w-4 h-4" />{children}
    </button>
  );
}

/* ── Distribution bar with inline legend ───────────────────────────────── */
function DistributionBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  return (
    <div className="flex items-center gap-3 flex-1 min-w-[220px]">
      <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-gray-100 flex">
        {segments.map((s, i) => (
          <span key={i} className={s.cls} style={{ width: `${(s.count / total) * 100}%` }} title={`${s.label}: ${s.count}`} />
        ))}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {segments.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={`w-2 h-2 rounded-full ${s.cls}`} />{s.label}<b className="text-gray-700 tabular-nums">{s.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── SAM tables ─────────────────────────────────────────────────────────── */
function StyleTable({ rows }) {
  return (
    <table className="w-full text-sm border-collapse">
      <THead cols={["Estilo", "SAM merchant", "SAM producción", "Prod. vs estándar", "Δ (min)", "Estado"]}
             align={["l", "r", "r", "l", "r", "r"]} />
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => {
          const s = SAM_ST[r.status];
          return (
            <tr key={r.key} className="group hover:bg-gray-50/70">
              <td className={`w-1 p-0 ${s.accent}`} />
              <td className="pl-3 pr-3 py-2.5">
                <div className="font-semibold text-gray-900 leading-tight">{r.styleCode}</div>
                <div className="text-[11px] text-gray-400 truncate max-w-[240px]">
                  {r.description || "—"}{r.lineCount > 1 && ` · ${r.lineCount} líneas`}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {fmtSam(r.merchantSam)}
                {r.merchantSamConflict && (
                  <span
                    title={`SAM inconsistente para este estilo entre órdenes: ${r.merchantSamValues.map((v) => v.toFixed(2)).join(" · ")} min. Se muestra la del plan del merchant o, si no hay, la mayor. Conviene unificarla en el origen.`}
                    className="ml-1 align-middle text-amber-500 cursor-help"
                  >⚠</span>
                )}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.status === "bad" ? "text-rose-600" : r.status === "nodata" ? "text-gray-400" : "text-gray-900"}`}>{fmtSam(r.prodSam)}</td>
              <td className="px-3 py-2.5 w-44"><Meter pct={r.pct} status={r.status} /></td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaTone(r.delta)}`}>{fmtDelta(r.delta, 2)}</td>
              <td className="px-3 py-2.5 pr-4 text-right"><Chip cfg={s} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
function LineTable({ rows }) {
  return (
    <table className="w-full text-sm border-collapse">
      <THead cols={["Línea", "Estilo", "SAM merchant", "SAM producción", "Prod. vs estándar", "Δ (min)", "Efic.", "Estado"]}
             align={["l", "l", "r", "r", "l", "r", "r", "r"]} />
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => {
          const s = SAM_ST[r.status];
          return (
            <tr key={r.key} className="hover:bg-gray-50/70">
              <td className={`w-1 p-0 ${s.accent}`} />
              <td className="pl-3 pr-3 py-2.5 font-semibold text-gray-900">L{r.line}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium text-gray-800">{r.styleCode}</div>
                <div className="text-[11px] text-gray-400 truncate max-w-[200px]">{r.description || "—"}</div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {fmtSam(r.merchantSam)}
                {r.merchantSamConflict && (
                  <span
                    title={`SAM inconsistente para este estilo entre órdenes: ${r.merchantSamValues.map((v) => v.toFixed(2)).join(" · ")} min. Conviene unificarla en el origen.`}
                    className="ml-1 align-middle text-amber-500 cursor-help"
                  >⚠</span>
                )}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.status === "bad" ? "text-rose-600" : r.status === "nodata" ? "text-gray-400" : "text-gray-900"}`}>{fmtSam(r.prodSam)}</td>
              <td className="px-3 py-2.5 w-40"><Meter pct={r.pct} status={r.status} /></td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaTone(r.delta)}`}>{fmtDelta(r.delta, 2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.efficiency > 0 ? `${Math.round(r.efficiency * 100)}%` : "—"}</td>
              <td className="px-3 py-2.5 pr-4 text-right"><Chip cfg={s} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* Per-order SAM breakdown: every order of a style with its color, description and
   its own merchant SAM, so all the SAMs a style carries are visible at once. */
function OrderTable({ rows }) {
  return (
    <table className="w-full text-sm border-collapse">
      <THead cols={["Estilo", "Color", "Orden / PO", "SAM merchant", "SAM producción", "Prod. vs estándar", "Δ (min)", "Estado"]}
             align={["l", "l", "l", "r", "r", "l", "r", "r"]} />
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => {
          const s = SAM_ST[r.status];
          return (
            <tr key={r.key} className="hover:bg-gray-50/70">
              <td className={`w-1 p-0 ${s.accent}`} />
              <td className="pl-3 pr-3 py-2.5">
                <div className="font-semibold text-gray-900 leading-tight">{r.styleCode}</div>
                <div className="text-[11px] text-gray-400 truncate max-w-[220px]">{r.description || "—"}</div>
              </td>
              <td className="px-3 py-2.5 text-gray-700">{r.color || "—"}</td>
              <td className="px-3 py-2.5">
                <div className="font-medium text-gray-800">{r.no}</div>
                <div className="text-[11px] text-gray-400 truncate max-w-[200px]">{r.customer || r.po || "—"}</div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {fmtSam(r.merchantSam)}
                {r.styleConflict && (
                  <span
                    title="Este estilo tiene SAM distintas entre órdenes. Compare las filas del mismo estilo y unifíquela en el origen."
                    className="ml-1 align-middle text-amber-500 cursor-help"
                  >⚠</span>
                )}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${r.status === "bad" ? "text-rose-600" : r.status === "nodata" ? "text-gray-400" : "text-gray-900"}`}>{fmtSam(r.prodSam)}</td>
              <td className="px-3 py-2.5 w-40"><Meter pct={r.pct} status={r.status} /></td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaTone(r.delta)}`}>{fmtDelta(r.delta, 2)}</td>
              <td className="px-3 py-2.5 pr-4 text-right"><Chip cfg={s} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Orders table (status + delivery dates) ─────────────────────────────── */
function OrdersTable({ rows }) {
  return (
    <table className="w-full text-sm border-collapse">
      <THead cols={["Orden", "Avance", "Entrega merchant", "Fin de plan", "Δ días", "Entrega"]}
             align={["l", "l", "r", "r", "r", "r"]} />
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => {
          const d = DELIV[r.deliv];
          const os = orderStChip(r.proc);
          const md = fmtDate(r.merchantDate);
          const pf = fmtDate(r.planFinish);
          const ps = fmtDate(r.planStart);
          return (
            <tr key={r.key} className={`hover:bg-gray-50/70 ${r.dead ? "opacity-55" : ""}`}>
              <td className={`w-1 p-0 ${d.accent}`} />
              <td className="pl-3 pr-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-gray-900">{r.no}</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ring-1 ${os.chip}`}>{os.label}</span>
                </div>
                <div className="text-[11px] text-gray-400 truncate max-w-[260px]">
                  {[r.customer, r.po && `PO ${r.po}`, r.styleCode].filter(Boolean).join(" · ") || "—"}
                </div>
              </td>
              <td className="px-3 py-2.5 w-52">
                <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                  <span className="tabular-nums">{fmtInt(r.produced)} / {fmtInt(r.target)}</span>
                  <span className="tabular-nums font-medium text-gray-700">{Math.round(r.progress * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${r.progress >= 1 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${r.progress * 100}%` }} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">{md || <span className="text-gray-300">sin fecha</span>}</td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                {pf ? (
                  <div className="leading-tight">
                    <div className="tabular-nums text-gray-800">{pf}</div>
                    {ps && ps !== pf && <div className="text-[10px] text-gray-400 tabular-nums">inicia {ps}</div>}
                  </div>
                ) : <span className="text-gray-300">sin plan</span>}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${r.delta == null ? "text-gray-300" : r.delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                {r.delta == null ? "—" : r.delta > 0 ? `+${r.delta}` : `${r.delta}`}
              </td>
              <td className="px-3 py-2.5 pr-4 text-right"><Chip cfg={d} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Shared bits ────────────────────────────────────────────────────────── */
function THead({ cols, align }) {
  return (
    <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur border-b border-gray-200">
      <tr className="text-[11px] uppercase tracking-wide text-gray-500">
        <th className="w-1 p-0" />
        {cols.map((c, i) => (
          <th key={c} className={`px-3 py-2.5 font-medium ${align[i] === "r" ? "text-right" : "text-left"} ${i === 0 ? "pl-3" : ""} ${i === cols.length - 1 ? "pr-4" : ""}`}>{c}</th>
        ))}
      </tr>
    </thead>
  );
}
function Meter({ pct, status }) {
  if (pct == null) return <span className="text-[11px] text-gray-300">sin corrida</span>;
  const w = Math.min(pct * 100, 100);
  const s = SAM_ST[status];
  return (
    <div className="relative h-2 rounded-full bg-gray-100" title={`${Math.round(pct * 100)}% de la SAM merchant`}>
      <div className={`absolute inset-y-0 left-0 rounded-full ${s.bar}`} style={{ width: `${w}%` }} />
      <div className="absolute inset-y-[-2px] right-0 w-px bg-gray-400/70" />
    </div>
  );
}
function Chip({ cfg }) {
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${cfg.chip}`}>
      {Icon && <Icon className="w-3.5 h-3.5" />}{cfg.label}
    </span>
  );
}
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-gray-100 border border-gray-200">
      {options.map((o) => {
        const active = value === o.v;
        const Icon = o.Icon;
        return (
          <button key={o.v} onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded-md transition whitespace-nowrap
              ${active ? "bg-white text-gray-900 shadow-sm font-medium" : "text-gray-500 hover:text-gray-800"}`}>
            {Icon && <Icon className="w-3.5 h-3.5" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}
function Centered({ children }) {
  return <div className="h-full min-h-[240px] flex items-center justify-center gap-2 text-sm text-gray-500 px-6 text-center">{children}</div>;
}

/* helpers */
const deltaTone = (d) => (d == null ? "text-gray-300" : d > 0 ? "text-emerald-600" : "text-rose-600");
const fmtDelta = (d, dp) => (d == null ? "—" : d > 0 ? `+${d.toFixed(dp)}` : d.toFixed(dp));