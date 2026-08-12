// components/planner/OrderStatus.jsx
//
// Vista de solo lectura del estado de las órdenes (POs).
// Muestra cada orden con su estado, avance de ASIGNACIÓN (planeación),
// avance de PRODUCCIÓN (lo reportado por los líderes de línea) y lo pendiente.
// La ASIGNACIÓN a líneas se hace en el Plan Board (arrastrar y soltar).
// La PRODUCCIÓN la reportan los líderes desde LineLeaderPage.
//
// PRODUCIDO POR LÍNEA
// -------------------
// El total de "Producido" viene en produced_quantity de GET /api/work-orders
// (work-orders.js lo arma con PRODUCED_SUBQUERY: suma sewed_qty de las
// operaciones de empaque/terminado de las corridas ligadas a la orden).
// Ese total no dice QUÉ línea cosió qué, así que al expandir una orden se pide
// el desglose por línea, que ya expone el backend y usa exactamente el mismo
// enlace y las mismas operaciones (producedByLineFor en work-orders.js).
//
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Search,
  Camera,
  RefreshCw,
  Calendar,
  Timer,
  Factory,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { format, isValid } from "date-fns";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Desglose de producción por línea para una orden.
// Vive en el módulo de Almacén PT pero solo pide authenticateToken, así que el
// planeador puede leerlo. Si algún día se cierra por rol, registra la misma
// ruta en work-orders.js con producedByLineFor y cambia solo esta línea.
const lineProductionUrl = (orderId) =>
  `${API_URL}/api/finished-warehouse/work-orders/${orderId}/line-production`;

// Cada cuánto se refresca la lista sin intervención del planeador (ms).
const AUTO_REFRESH_MS = 30_000;

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const producedOf = (wo) => Number(wo?.produced_quantity) || 0;
const remainingOf = (wo) => Math.max(targetOf(wo) - assignedOf(wo), 0);
const toGoalOf = (wo) => Math.max(targetOf(wo) - producedOf(wo), 0);

const pctOf = (part, total) => (total > 0 ? Math.min((part / total) * 100, 100) : 0);
const n = (v) => Math.round(Number(v) || 0).toLocaleString();

// 'YYYY-MM-DD' se interpreta como UTC con new Date(), lo que en México adelanta
// un día hacia atrás. Se arma la fecha en local para que la fecha compromiso
// que ve el planeador sea la que capturó.
const parseYMD = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) {
    const d = new Date(s);
    return isValid(d) ? d : null;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const fmtStamp = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isValid(d) ? format(d, "dd/MM HH:mm") : null;
};

const STATUS_META = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700", bar: "bg-yellow-400" },
  assigned: { label: "Asignada", pill: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  in_progress: { label: "En proceso", pill: "bg-purple-100 text-purple-700", bar: "bg-purple-500" },
  completed: { label: "Completada", pill: "bg-green-100 text-green-700", bar: "bg-green-500" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500", bar: "bg-gray-400" },
};

const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "pending", label: "Pendientes" },
  { id: "assigned", label: "Asignadas" },
  { id: "in_progress", label: "En proceso" },
  { id: "completed", label: "Completadas" },
];

export default function OrderStatus() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);

  // Desglose por línea: { [orderId]: { loading, error, lines, producedTotal } }
  const [breakdown, setBreakdown] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());

  // Evita que el auto-refresco pise un estado de carga manual.
  const inFlight = useRef(false);
  // Espejo de las órdenes abiertas para poder refrescarlas desde el intervalo
  // sin re-crear el intervalo cada vez que se abre o cierra una.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const fetchOrders = useCallback(async ({ silent = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.workOrders || []);
        setLastUpdated(new Date());
      } else {
        setError(data.error || "No se pudieron cargar las órdenes");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Producción por línea de UNA orden. silent = refresco en segundo plano, no
  // parpadea el bloque ya visible.
  const fetchLineProduction = useCallback(async (orderId, { silent = false } = {}) => {
    setBreakdown((prev) => ({
      ...prev,
      [orderId]: { ...(prev[orderId] || {}), loading: !silent, error: "" },
    }));
    try {
      const res = await fetch(lineProductionUrl(orderId), { headers: authHeaders() });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "No se pudo cargar la producción por línea");
      setBreakdown((prev) => ({
        ...prev,
        [orderId]: {
          loading: false,
          error: "",
          lines: data.lines || [],
          producedTotal: Number(data.producedTotal) || 0,
          orderedTotal: Number(data.orderedTotal) || 0,
        },
      }));
    } catch (err) {
      setBreakdown((prev) => ({
        ...prev,
        [orderId]: { ...(prev[orderId] || {}), loading: false, error: err.message },
      }));
    }
  }, []);

  const toggleExpanded = useCallback(
    (orderId) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(orderId)) {
          next.delete(orderId);
        } else {
          next.add(orderId);
          if (!breakdown[orderId]?.lines) fetchLineProduction(orderId);
        }
        return next;
      });
    },
    [breakdown, fetchLineProduction]
  );

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Refresco automático: la producción se captura en piso, no en esta pantalla.
  // Se refrescan también los desgloses abiertos para que el planeador vea
  // entrar las piezas sin tener que cerrar y abrir la orden.
  useEffect(() => {
    const refreshAll = () => {
      fetchOrders({ silent: true });
      expandedRef.current.forEach((id) => fetchLineProduction(id, { silent: true }));
    };
    const id = setInterval(refreshAll, AUTO_REFRESH_MS);
    window.addEventListener("focus", refreshAll);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refreshAll);
    };
  }, [fetchOrders, fetchLineProduction]);

  const counts = useMemo(() => {
    const c = { all: orders.length, pending: 0, assigned: 0, in_progress: 0, completed: 0 };
    orders.forEach((o) => {
      if (c[o.status] != null) c[o.status]++;
    });
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders
      .filter((o) => (filter === "all" ? true : o.status === filter))
      .filter((o) => {
        if (!q) return true;
        const hay = `${o.work_order_no} ${o.customer_name || ""} ${o.style_code || ""} ${o.estilo || ""} ${o.style_description || ""} ${o.color || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [orders, filter, searchTerm]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Estado de Órdenes</h2>
          <p className="text-sm text-gray-500">
            Avance de cada orden. Las asignaciones a línea se hacen en el Plan Board; la producción
            la reportan los líderes de línea. Abre una orden para ver cuánto cosió cada línea.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Actualizado {format(lastUpdated, "HH:mm:ss")}
            </span>
          )}
          <button
            onClick={() => fetchOrders()}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-sm rounded-full border transition ${
              filter === f.id
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label}
            <span className={`ml-1.5 text-xs ${filter === f.id ? "text-gray-300" : "text-gray-400"}`}>
              {counts[f.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por N° orden, cliente, estilo, color…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
        />
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

      {/* List */}
      {loading && orders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">Cargando órdenes…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No se encontraron órdenes.</div>
      ) : (
        <div className="rounded-2xl border bg-white shadow-sm divide-y">
          {filtered.map((o) => {
            const target = targetOf(o);
            const assigned = assignedOf(o);
            const produced = producedOf(o);
            const remaining = remainingOf(o);
            const toGoal = toGoalOf(o);
            const pctAssigned = pctOf(assigned, target);
            const pctProduced = pctOf(produced, target);
            const isOpen = expanded.has(o.id);
            const detail = breakdown[o.id] || {};
            const commitment = parseYMD(o.commitment_date);
            const meta =
              STATUS_META[o.status] || {
                label: o.status,
                pill: "bg-gray-100 text-gray-700",
                bar: "bg-gray-400",
              };

            return (
              <div key={o.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggleExpanded(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpanded(o.id);
                    }
                  }}
                  className="p-4 flex gap-3 items-center hover:bg-gray-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-gray-900/20 focus-visible:ring-inset"
                >
                  <ChevronRight
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />

                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {o.master_code_photo_url ? (
                      <img
                        src={o.master_code_photo_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-4 h-4 text-gray-300" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-sm font-bold text-gray-900 truncate">
                        {o.work_order_no}
                      </p>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {o.customer_name} · {o.style_code || o.estilo || "—"}
                      {o.color ? ` · ${o.color}` : ""}
                    </p>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                      {o.sam_minutes ? (
                        <span className="inline-flex items-center gap-1">
                          <Timer className="w-3 h-3" />
                          SAM {o.sam_minutes}
                        </span>
                      ) : null}
                      {commitment ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(commitment, "dd/MM/yy")}
                        </span>
                      ) : null}
                      {detail.lines?.length ? (
                        <span className="inline-flex items-center gap-1">
                          <Factory className="w-3 h-3" />
                          {detail.lines.map((l) => l.line_no).join(", ")}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Avance */}
                  <div className="w-56 shrink-0 space-y-2">
                    {/* Asignación (planeación) */}
                    <div>
                      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                        <span>
                          Asignado {n(assigned)} / {n(target)}
                        </span>
                        <span>{Math.round(pctAssigned)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${meta.bar} transition-all duration-500`}
                          style={{ width: `${pctAssigned}%` }}
                        />
                      </div>
                      <p
                        className={`text-[11px] mt-1 ${
                          remaining > 0 ? "text-amber-600" : "text-gray-400"
                        }`}
                      >
                        {remaining > 0 ? `Faltan ${n(remaining)} por asignar` : "Totalmente asignada"}
                      </p>
                    </div>

                    {/* Producción (piso) */}
                    <div>
                      <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                        <span>
                          Producido {n(produced)} / {n(target)}
                        </span>
                        <span>{Math.round(pctProduced)}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${pctProduced}%` }}
                        />
                      </div>
                      <p
                        className={`text-[11px] mt-1 ${
                          toGoal > 0 ? "text-amber-600" : "text-green-600"
                        }`}
                      >
                        {toGoal > 0 ? `Faltan ${n(toGoal)} para la meta` : "Meta alcanzada"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Desglose: cuánto cosió cada línea de esta orden */}
                {isOpen && (
                  <div className="px-4 pb-4 pl-11 bg-gray-50/60">
                    <LineProduction detail={detail} target={target} orderId={o.id} onRetry={fetchLineProduction} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tabla de producción por línea de una orden.
// finished          = piezas terminadas que reportó esa línea para esta orden
// last_reported_at  = última captura por hora de esa línea, para ver actividad
//                     aunque las piezas todavía no lleguen a empaque.
function LineProduction({ detail, target, orderId, onRetry }) {
  const { loading, error, lines } = detail;

  if (loading && !lines) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Cargando producción por línea…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
        <span className="inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetry(orderId);
          }}
          className="underline hover:no-underline shrink-0"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!lines || lines.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-3">
        Ninguna línea ha reportado producción para esta orden. Si la línea sí está cosiendo, revisa
        que la corrida se haya guardado seleccionando esta orden: sin esa liga la captura por hora no
        se puede sumar aquí.
      </p>
    );
  }

  const totalFinished = lines.reduce((s, l) => s + (Number(l.finished) || 0), 0);

  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">Línea</th>
            <th className="text-right font-medium px-3 py-2">Cosido</th>
            <th className="text-right font-medium px-3 py-2 w-32">% de la orden</th>
            <th className="text-right font-medium px-3 py-2">Último reporte</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((l) => {
            const finished = Number(l.finished) || 0;
            const pct = pctOf(finished, target);
            const stamp = fmtStamp(l.last_reported_at);
            return (
              <tr key={l.line_no} className="text-gray-700">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Factory className="w-3 h-3 text-gray-400" />
                    Línea {l.line_no}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{n(finished)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="h-1.5 w-16 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-gray-500 w-9 text-right">
                      {Math.round(pct)}%
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-500">{stamp || "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-gray-50 text-gray-700 font-medium">
          <tr>
            <td className="px-3 py-2">Total cosido</td>
            <td className="px-3 py-2 text-right font-mono">{n(totalFinished)}</td>
            <td className="px-3 py-2 text-right text-gray-500">
              de {n(target)} ({Math.round(pctOf(totalFinished, target))}%)
            </td>
            <td className="px-3 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}