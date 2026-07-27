// components/planner/OrderStatus.jsx
//
// Vista de solo lectura del estado de las órdenes (POs).
// Muestra cada orden con su estado, avance (asignado / total) y lo pendiente.
// La ASIGNACIÓN a líneas se hace en el Plan Board (arrastrar y soltar).
//
import { useState, useEffect, useMemo } from "react";
import { Search, Camera, RefreshCw, Calendar, Timer } from "lucide-react";
import { format } from "date-fns";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const targetOf = (wo) => Number(wo?.total_to_produce) || Number(wo?.quantity) || 0;
const assignedOf = (wo) => Number(wo?.assigned_quantity) || 0;
const remainingOf = (wo) => Math.max(targetOf(wo) - assignedOf(wo), 0);

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

  useEffect(() => { fetchOrders(); }, []);

  const fetchOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setOrders(data.workOrders || []);
      else setError(data.error || "No se pudieron cargar las órdenes");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    const c = { all: orders.length, pending: 0, assigned: 0, in_progress: 0, completed: 0 };
    orders.forEach((o) => { if (c[o.status] != null) c[o.status]++; });
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
            Avance de cada orden. Las asignaciones a línea se hacen en el Plan Board.
          </p>
        </div>
        <button
          onClick={fetchOrders}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
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
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando órdenes…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No se encontraron órdenes.</div>
      ) : (
        <div className="rounded-2xl border bg-white shadow-sm divide-y">
          {filtered.map((o) => {
            const target = targetOf(o);
            const assigned = assignedOf(o);
            const remaining = remainingOf(o);
            const pct = target > 0 ? Math.min((assigned / target) * 100, 100) : 0;
            const meta = STATUS_META[o.status] || { label: o.status, pill: "bg-gray-100 text-gray-700", bar: "bg-gray-400" };

            return (
              <div key={o.id} className="p-4 flex gap-3 items-center hover:bg-gray-50">
                <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                  {o.master_code_photo_url ? (
                    <img src={o.master_code_photo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-4 h-4 text-gray-300" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-sm font-bold text-gray-900 truncate">{o.work_order_no}</p>
                    <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {o.customer_name} · {o.style_code || o.estilo || "—"}{o.color ? ` · ${o.color}` : ""}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-500">
                    {o.sam_minutes ? <span className="inline-flex items-center gap-1"><Timer className="w-3 h-3" />SAM {o.sam_minutes}</span> : null}
                    {o.commitment_date ? <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(o.commitment_date), "dd/MM/yy")}</span> : null}
                  </div>
                </div>

                {/* Progress */}
                <div className="w-44 shrink-0">
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>{Math.round(assigned).toLocaleString()} / {Math.round(target).toLocaleString()}</span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-[11px] mt-1 ${remaining > 0 ? "text-amber-600" : "text-green-600"}`}>
                    {remaining > 0 ? `Faltan ${Math.round(remaining).toLocaleString()} por asignar` : "Totalmente asignada"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}