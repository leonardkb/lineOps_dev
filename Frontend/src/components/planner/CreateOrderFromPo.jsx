// components/planner/CreateOrderFromPO.jsx
//
// Reemplaza la captura manual (WorkOrderForm) en "Crear Orden".
// El planificador YA NO reescribe la orden: solo elige una PO existente
// (creada por el comerciante en NuevaOrdenWizard) y la asigna a líneas.
//
// La PO ya es un work_order, así que NO se necesita ningún cambio de backend:
//   - GET /api/work-orders  -> lista las POs (incluye assigned_quantity, status,
//                              total_to_produce, sam_minutes, colores, foto)
//   - LineAssignmentForm    -> hace la asignación real a líneas
//
// Uso:
//   <CreateOrderFromPO onDone={() => setTab("lista")} />
//
import { useState, useEffect, useMemo } from "react";
import {
  Search, Calendar, User, Tag, Layers, Timer, Package,
  ChevronLeft, CheckCircle, AlertCircle, Camera,
} from "lucide-react";
import { format } from "date-fns";
import { API_URL } from "../../lib/masterCodeCatalog";
import LineAssignmentForm from "./LineAssignmentForm";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Cantidad objetivo de la PO (misma prioridad que usa LineAssignmentForm)
const targetOf = (po) =>
  Number(po?.total_to_produce) || Number(po?.quantity) || 0;

const assignedOf = (po) => Number(po?.assigned_quantity) || 0;

const remainingOf = (po) => Math.max(targetOf(po) - assignedOf(po), 0);

export default function CreateOrderFromPO({ onDone }) {
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [onlyAssignable, setOnlyAssignable] = useState(true);
  const [selectedPO, setSelectedPO] = useState(null);

  useEffect(() => {
    fetchPOs();
  }, []);

  const fetchPOs = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setPos(data.workOrders || []);
      } else {
        setError(data.error || "No se pudieron cargar las órdenes");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cuando se termina de asignar, refrescamos para actualizar lo pendiente.
  const handleAssignmentComplete = async () => {
    await fetchPOs();
    // Re-seleccionar la PO actualizada (por si queda saldo por asignar).
    if (selectedPO) {
      const refreshed = pos.find((p) => p.id === selectedPO.id);
      if (refreshed) setSelectedPO(refreshed);
    }
  };

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return pos
      .filter((po) => {
        if (onlyAssignable && remainingOf(po) <= 0) return false;
        if (!q) return true;
        const hay = `${po.work_order_no} ${po.customer_name || ""} ${po.style_code || ""} ${po.estilo || ""} ${po.style_description || ""} ${po.color || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        // Primero las que urgen por fecha de compromiso, luego por creación.
        const da = a.commitment_date ? new Date(a.commitment_date).getTime() : Infinity;
        const db = b.commitment_date ? new Date(b.commitment_date).getTime() : Infinity;
        if (da !== db) return da - db;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  }, [pos, searchTerm, onlyAssignable]);

  // ---------------------------------------------------------------------
  //  Vista de asignación (PO ya elegida)
  // ---------------------------------------------------------------------
  if (selectedPO) {
    const target = targetOf(selectedPO);
    const assigned = assignedOf(selectedPO);
    const remaining = remainingOf(selectedPO);

    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedPO(null)}
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ChevronLeft className="w-4 h-4" /> Elegir otra PO
        </button>

        {/* Resumen de la PO (solo lectura — toda la info viene de la PO) */}
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
              {selectedPO.master_code_photo_url ? (
                <img src={selectedPO.master_code_photo_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-5 h-5 text-gray-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-mono font-bold text-gray-900 text-lg">{selectedPO.work_order_no}</h2>
                <StatusPill status={selectedPO.status} />
              </div>
              <p className="text-sm text-gray-600 truncate">{selectedPO.style_description || "—"}</p>
            </div>
          </div>

          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
            <Field icon={User} label="Cliente" value={selectedPO.customer_name} />
            <Field icon={Tag} label="Estilo" value={selectedPO.style_code || selectedPO.estilo} />
            <Field icon={Layers} label="Color(es)" value={selectedPO.color} />
            <Field icon={Timer} label="SAM" value={selectedPO.sam_minutes ? `${selectedPO.sam_minutes} min` : "—"} />
            <Field
              icon={Calendar}
              label="Compromiso"
              value={selectedPO.commitment_date ? format(new Date(selectedPO.commitment_date), "dd/MM/yyyy") : "—"}
            />
            <Field icon={Package} label="Total a producir" value={`${Math.round(target).toLocaleString()} pzas`} />
            <Field label="Ya asignado" value={`${Math.round(assigned).toLocaleString()} pzas`} />
            <Field
              label="Por asignar"
              value={`${Math.round(remaining).toLocaleString()} pzas`}
              highlight={remaining > 0}
            />
          </div>

          {Array.isArray(selectedPO.colors) && selectedPO.colors.length > 0 && (
            <div className="px-5 pb-5">
              <p className="text-xs text-gray-500 mb-1">Desglose por color</p>
              <div className="flex flex-wrap gap-2">
                {selectedPO.colors.map((c, i) => (
                  <span key={i} className="text-xs bg-gray-100 rounded-full px-2 py-0.5 text-gray-700">
                    {c.color}: {Math.round(c.quantity).toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Asignación a líneas — reutiliza tu componente existente tal cual */}
        {remaining > 0 ? (
          <LineAssignmentForm
            workOrder={selectedPO}
            onAssignmentComplete={handleAssignmentComplete}
          />
        ) : (
          <div className="rounded-2xl border bg-green-50 p-5 flex items-center gap-3 text-green-800">
            <CheckCircle className="w-5 h-5" />
            <div>
              <p className="font-medium">Esta PO ya está totalmente asignada.</p>
              <p className="text-sm text-green-700">No queda cantidad por asignar a líneas.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  //  Vista de selección de PO
  // ---------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Crear Orden — Seleccionar PO</h2>
          <p className="text-sm text-gray-500">
            Elija una orden de producción existente. Toda la información ya viene de la PO;
            solo debe asignarla a líneas.
          </p>
        </div>
        {onDone && (
          <button
            onClick={onDone}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cerrar
          </button>
        )}
      </div>

      {/* Búsqueda + filtro */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por N° PO, cliente, estilo, color…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 select-none">
          <input
            type="checkbox"
            checked={onlyAssignable}
            onChange={(e) => setOnlyAssignable(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          Solo con cantidad por asignar
        </label>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando órdenes de producción…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No se encontraron POs {onlyAssignable ? "con cantidad por asignar" : ""}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((po) => {
            const target = targetOf(po);
            const assigned = assignedOf(po);
            const remaining = remainingOf(po);
            const pct = target > 0 ? Math.min((assigned / target) * 100, 100) : 0;

            return (
              <div
                key={po.id}
                onClick={() => setSelectedPO(po)}
                className="border rounded-xl p-4 hover:bg-gray-50 cursor-pointer transition flex gap-3"
              >
                <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                  {po.master_code_photo_url ? (
                    <img src={po.master_code_photo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-5 h-5 text-gray-300" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-sm font-bold text-gray-900 truncate">{po.work_order_no}</p>
                    <StatusPill status={po.status} />
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {po.customer_name} · {po.style_code || po.estilo || "—"}
                    {po.color ? ` · ${po.color}` : ""}
                  </p>

                  <div className="mt-2 flex items-center gap-3 text-xs text-gray-600">
                    <span>🎯 {Math.round(target).toLocaleString()} pzas</span>
                    {po.sam_minutes ? <span>⏱️ SAM {po.sam_minutes}</span> : null}
                    {po.commitment_date ? (
                      <span>📅 {format(new Date(po.commitment_date), "dd/MM/yy")}</span>
                    ) : null}
                  </div>

                  {/* Progreso de asignación */}
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? "bg-green-500" : "bg-blue-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {remaining > 0
                        ? `Por asignar: ${Math.round(remaining).toLocaleString()} pzas`
                        : "Totalmente asignada"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, value, highlight }) {
  return (
    <div className={`rounded-xl p-3 border ${highlight ? "bg-blue-50 border-blue-100" : "bg-gray-50 border-gray-100"}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-400" />}
        <span className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-sm font-semibold ${highlight ? "text-blue-700" : "text-gray-900"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: "bg-yellow-100 text-yellow-700",
    assigned: "bg-blue-100 text-blue-700",
    in_progress: "bg-purple-100 text-purple-700",
    completed: "bg-green-100 text-green-700",
  };
  const label = {
    pending: "Pendiente",
    assigned: "Asignada",
    in_progress: "En proceso",
    completed: "Completada",
  };
  return (
    <span className={`text-[11px] rounded-full px-2 py-0.5 ${map[status] || "bg-gray-100 text-gray-700"}`}>
      {label[status] || status}
    </span>
  );
}