// components/warehouse/FinishedWarehouseDashboard.jsx
// Almacén de Producto Terminado — Dashboard.
//
// Purpose: let the warehouse person SEE the input from the production lines,
// grouped by work order, so they can judge WHEN an order is finished enough to
// build its pre-packing list. Reads two endpoints:
//   GET /api/finished-warehouse/dashboard    → summary tiles
//   GET /api/finished-warehouse/line-input    → work orders + per-line production
//
// Controlled routing (optional): pass onNavigate (same signature as the nav's)
// so the "Ir a pre-empaque" action can switch tabs. If you later let PrePacking
// accept a preselected work order, pass onCreateList(order) to jump straight in.
//
//   <FinishedWarehouseDashboard onNavigate={setTab} />
//
import { useState, useEffect, useCallback } from "react";
import {
  Factory, Clock, RefreshCw, Loader2, AlertCircle, ClipboardList,
  Boxes, Package, ArrowRight, CheckCircle2, PackageCheck, ScanLine,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

async function api(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Compact "hace X" for a line's last hourly capture.
function timeAgo(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "hace segundos";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString();
}

const num = (v) => Math.round(Number(v) || 0).toLocaleString();

// Readiness bucket for one order, from produced vs. ordered.
function readinessOf(order) {
  const ordered = Number(order.orderedTotal) || 0;
  const produced = Number(order.producedTotal) || 0;
  const pct = ordered > 0 ? Math.min(100, Math.round((produced / ordered) * 100)) : 0;
  const hasConfirmed = (order.lists || []).some((l) => l.status === "confirmed");
  let state = "progress";
  if (hasConfirmed) state = "packed";
  else if (ordered > 0 && produced >= ordered) state = "ready";
  else if (produced === 0) state = "waiting";
  return { pct, state, ordered, produced };
}

const FILTERS = [
  ["ready", "Listas para empacar"],
  ["progress", "En progreso"],
  ["all", "Todas"],
];

export default function FinishedWarehouseDashboard({ onNavigate = null, onCreateList = null }) {
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("ready");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d1, d2] = await Promise.all([
        api("/api/finished-warehouse/dashboard").catch(() => ({ dashboard: null })),
        api("/api/finished-warehouse/line-input"),
      ]);
      setSummary(d1.dashboard || null);
      setOrders(d2.orders || []);
    } catch (e) {
      setError(e.message || "No se pudo cargar el tablero");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const goCreate = (order) => {
    if (onCreateList) return onCreateList(order);
    if (onNavigate) return onNavigate("pre-empaque");
  };

  // Attach readiness, then filter + sort (most finished first within a bucket).
  const enriched = orders.map((o) => ({ ...o, _r: readinessOf(o) }));
  const readyCount = enriched.filter((o) => o._r.state === "ready").length;
  const shown = enriched
    .filter((o) => {
      if (filter === "all") return true;
      if (filter === "ready") return o._r.state === "ready";
      return o._r.state === "progress" || o._r.state === "waiting"; // "progress" tab
    })
    .sort((a, b) => b._r.pct - a._r.pct || (Number(b.producedTotal) || 0) - (Number(a.producedTotal) || 0));

  return (
    <div className="max-w-6xl mx-auto p-5 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
          <Factory className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Lo que entra de las líneas, por orden. Arme la lista cuando esté terminada.</p>
        </div>
        <button
          onClick={() => onNavigate && onNavigate("escaneo")}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          <ScanLine className="w-4 h-4" /> Escanear tickets
        </button>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualizar
        </button>
      </header>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Tile icon={ClipboardList} label="Listas borrador" value={summary?.lists?.draft} accent="amber" />
        <Tile icon={CheckCircle2} label="Listas confirmadas" value={summary?.lists?.confirmed} accent="emerald" />
        <Tile icon={Package} label="Piezas en inventario" value={summary?.inventory?.pieces} accent="indigo" />
        <Tile icon={Boxes} label="SKUs" value={summary?.inventory?.skus} accent="gray" />
        <Tile icon={PackageCheck} label="Cajas en inventario" value={summary?.inventory?.boxes} accent="gray" />
      </div>

      {/* Line input */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2 flex-wrap">
          <Factory className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Entrada de líneas</h2>
          <span className="text-xs text-gray-400">{shown.length} orden(es)</span>
          {readyCount > 0 && (
            <span className="text-xs rounded-full px-2 py-0.5 font-medium bg-emerald-50 text-emerald-700">
              {readyCount} lista(s) para empacar
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  filter === key ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="p-4 text-sm text-amber-700 bg-amber-50 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {filter === "ready"
              ? "Ninguna orden está terminada todavía. Cambie el filtro a «En progreso» para ver qué están produciendo las líneas."
              : "Ninguna línea ha reportado producción todavía."}
          </div>
        ) : (
          <div className="divide-y">
            {shown.map((o) => (
              <OrderRow key={o.id} order={o} onCreate={() => goCreate(o)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderRow({ order, onCreate }) {
  const { pct, state, ordered, produced } = order._r;
  const remaining = Math.max(0, ordered - produced);
  const barColor = state === "ready" || state === "packed" ? "bg-emerald-500" : "bg-indigo-500";

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{order.customer_name || "—"}</span>
            <StateBadge state={state} />
          </div>
          <div className="mt-0.5 text-xs text-gray-500 flex items-center gap-2 flex-wrap font-mono">
            <span>PO {order.po || "—"}</span>
            <span className="text-gray-300">·</span>
            <span>MO {order.mo || "—"}</span>
            {order.style && (<><span className="text-gray-300">·</span><span>{order.style}</span></>)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono">
            <b className="text-gray-900">{num(produced)}</b>
            <span className="text-gray-400"> / {num(ordered)} pzas</span>
          </div>
          <div className="text-xs text-gray-400">
            {state === "packed" ? "empacada" : pct >= 100 ? "terminado" : `faltan ${num(remaining)}`}
          </div>
        </div>
      </div>

      {/* Readiness bar */}
      <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Per-line chips */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {(order.lines || []).length === 0 ? (
          <span className="text-xs text-gray-400">Sin capturas de línea todavía.</span>
        ) : (
          order.lines.map((l) => (
            <span
              key={l.line_no}
              className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-gray-100 bg-gray-50 px-2 py-1"
              title={`Última captura ${timeAgo(l.last_reported_at)}`}
            >
              <span className="font-medium text-gray-700">Línea {l.line_no}</span>
              <span className="font-mono text-gray-900">{num(l.finished)}</span>
              <span className="text-gray-300">·</span>
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Clock className="w-3 h-3" />{timeAgo(l.last_reported_at)}
              </span>
            </span>
          ))
        )}
      </div>

      {/* Existing lists + action */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {(order.lists || []).length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {order.lists.map((l, i) => (
              <span
                key={i}
                className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                  l.status === "confirmed" ? "bg-emerald-50 text-emerald-700"
                  : l.status === "cancelled" ? "bg-gray-100 text-gray-500"
                  : "bg-amber-50 text-amber-700"
                }`}
              >
                {l.list_no || "—"} · {l.status === "confirmed" ? "confirmada" : l.status === "cancelled" ? "cancelada" : "borrador"}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={onCreate}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          {(order.lists || []).some((l) => l.status !== "cancelled") ? "Ver en pre-empaque" : "Crear lista"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function StateBadge({ state }) {
  const map = {
    ready: ["Listo para empacar", "bg-emerald-50 text-emerald-700"],
    packed: ["Empacada", "bg-gray-100 text-gray-500"],
    progress: ["En progreso", "bg-indigo-50 text-indigo-700"],
    waiting: ["Sin terminar aún", "bg-gray-100 text-gray-500"],
  };
  const [label, cls] = map[state] || map.progress;
  return <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${cls}`}>{label}</span>;
}

function Tile({ icon: Icon, label, value, accent = "gray" }) {
  const accents = {
    amber: "text-amber-600 bg-amber-50",
    emerald: "text-emerald-600 bg-emerald-50",
    indigo: "text-indigo-600 bg-indigo-50",
    gray: "text-gray-600 bg-gray-100",
  };
  return (
    <div className="bg-white rounded-xl border shadow-sm p-3">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${accents[accent] || accents.gray}`}>
          {Icon && <Icon className="w-4 h-4" />}
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-gray-900">{num(value)}</div>
    </div>
  );
}