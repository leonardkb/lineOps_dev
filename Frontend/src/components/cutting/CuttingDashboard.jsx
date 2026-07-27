// components/cutting/CuttingDashboard.jsx
//
// Resumen de corte (solo lectura): número de órdenes de corte, su estado,
// y las órdenes con restante por cortar (con su valor en piezas).
//
import { useState, useEffect, useMemo } from "react";
import { RefreshCw, ClipboardList, Clock, CheckCircle, Scissors } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import { colorForWO } from "../../lib/workOrderColors";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const num = (v) => Number(v) || 0;

const STATUS = {
  pending: { label: "Pendiente", pill: "bg-yellow-100 text-yellow-700" },
  in_progress: { label: "En corte", pill: "bg-purple-100 text-purple-700" },
  completed: { label: "Cortada", pill: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelada", pill: "bg-gray-100 text-gray-500" },
};

export default function CuttingDashboard() {
  const [cutOrders, setCutOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetchCutOrders(); }, []);

  const fetchCutOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/cut-orders`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setCutOrders(data.cutOrders || []);
      else setError(data.error || "No se pudieron cargar las órdenes de corte");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const s = { total: cutOrders.length, pending: 0, in_progress: 0, completed: 0, remainingOrders: 0, remainingQty: 0 };
    cutOrders.forEach((co) => {
      if (s[co.status] != null) s[co.status]++;
      const rem = num(co.remaining_to_cut);
      if (co.status !== "completed" && co.status !== "cancelled" && rem > 0) {
        s.remainingOrders++;
        s.remainingQty += rem;
      }
    });
    return s;
  }, [cutOrders]);

  const cutNo = (co) => `CORTE-${String(co.id).padStart(4, "0")}`;
  const withRemaining = cutOrders.filter(
    (co) => co.status !== "completed" && co.status !== "cancelled" && num(co.remaining_to_cut) > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Resumen de corte</h2>
          <p className="text-sm text-gray-500">Estado de las órdenes de corte y pendientes por cortar</p>
        </div>
        <button
          onClick={fetchCutOrders}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{error}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ClipboardList} label="Órdenes de corte" value={stats.total} tint="text-gray-700" />
        <StatCard icon={Clock} label="En corte" value={stats.in_progress} sub={`${stats.pending} pendientes`} tint="text-purple-600" />
        <StatCard icon={CheckCircle} label="Cortadas" value={stats.completed} tint="text-green-600" />
        <StatCard
          icon={Scissors}
          label="Restante por cortar"
          value={stats.remainingOrders}
          sub={`${Math.round(stats.remainingQty).toLocaleString()} pzas`}
          tint="text-amber-600"
          highlight
        />
      </div>

      {/* Remaining list */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Pendiente por cortar</h3>
          <p className="text-sm text-gray-500">{withRemaining.length} orden(es) con restante</p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : withRemaining.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No hay órdenes con restante por cortar.</div>
        ) : (
          <div className="divide-y max-h-[55vh] overflow-y-auto">
            {withRemaining.map((co) => {
              const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
              return (
                <div key={co.id} className="p-4 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900">{cutNo(co)}</span>
                      <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {co.work_order_no} · {co.customer_name}{co.color ? ` · ${co.color}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-600">{Math.round(num(co.remaining_to_cut)).toLocaleString()}</div>
                    <div className="text-[11px] text-gray-400">de {Math.round(num(co.quantity)).toLocaleString()} pzas</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full status breakdown */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Todas las órdenes de corte</h3>
        </div>
        {cutOrders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Sin órdenes de corte.</div>
        ) : (
          <div className="divide-y max-h-[55vh] overflow-y-auto">
            {cutOrders.map((co) => {
              const meta = STATUS[co.status] || { label: co.status, pill: "bg-gray-100 text-gray-700" };
              const rem = num(co.remaining_to_cut);
              return (
                <div key={co.id} className="p-3 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorForWO(co.work_order_id).dot}`} />
                  <span className="font-mono text-sm font-medium text-gray-800 w-28 shrink-0">{cutNo(co)}</span>
                  <span className="text-xs text-gray-500 flex-1 truncate">{co.work_order_no} · {co.customer_name}</span>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${meta.pill}`}>{meta.label}</span>
                  <span className="text-xs text-gray-500 w-24 text-right">
                    {rem > 0 ? <span className="text-amber-600">Restan {Math.round(rem).toLocaleString()}</span> : `${Math.round(num(co.quantity)).toLocaleString()} pzas`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tint, highlight }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${highlight ? "bg-amber-50 border-amber-200" : "bg-white"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{label}</span>
        {Icon && <Icon className={`w-5 h-5 ${tint}`} />}
      </div>
      <div className={`mt-1 text-2xl font-bold ${tint}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}