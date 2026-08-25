import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, ArrowRight, Trash2, Ban, ClipboardList, Package, Check } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

/* -----------------------------------------------------------------------
 *  Listado de PRE-ÓRDENES sin el marco de página, para poder montarlo en
 *  dos lugares: la pestaña "Pre-órdenes" del MerchantDashboard y la página
 *  /pre-ordenes.
 *
 *  Props
 *    refreshKey      cambia el número y el panel recarga (para "Actualizar")
 *    onCountsChange  ({pending, converted, cancelled, all}) tras cada carga
 *    onToast         (msg, isError) — si no viene, usa su propio toast
 *    showNewButton   muestra el botón "Nueva pre-orden" (default: true)
 * --------------------------------------------------------------------- */

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const TABS = [
  { key: "pending", label: "Pendientes" },
  { key: "converted", label: "Convertidas" },
  { key: "cancelled", label: "Canceladas" },
  { key: "all", label: "Todas" },
];

const STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  converted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};
const STATUS_LABEL = { pending: "Pendiente", converted: "Convertida", cancelled: "Cancelada" };

export default function PreOrdenesPanel({
  refreshKey = 0,
  onCountsChange,
  onToast,
  showNewButton = true,
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, converted: 0, cancelled: 0, all: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [localToast, setLocalToast] = useState(null);

  // Los callbacks del padre se guardan en refs: si entraran en las
  // dependencias de load(), un padre que se re-renderiza al recibir los
  // conteos volvería a disparar la carga en bucle.
  const onToastRef = useRef(onToast);
  const onCountsRef = useRef(onCountsChange);
  useEffect(() => {
    onToastRef.current = onToast;
    onCountsRef.current = onCountsChange;
  });

  const toast = useCallback((msg, isError = false) => {
    if (onToastRef.current) return onToastRef.current(msg, isError);
    setLocalToast({ msg, isError });
    setTimeout(() => setLocalToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/pre-orders?status=${tab}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar las pre-órdenes");
      setRows(data.preOrders || []);
      setCounts(data.counts || {});
      onCountsRef.current?.(data.counts || {});
    } catch (err) {
      toast(err.message, true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.pre_order_no, r.style_code, r.estilo, r.customer_name, r.customer_po, r.style_description]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const totalPieces = visible.reduce((s, r) => s + (parseFloat(r.pieces) || 0), 0);

  const cancel = async (row) => {
    if (!window.confirm(`¿Cancelar la pre-orden ${row.pre_order_no}?`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`${API_URL}/api/pre-orders/${row.id}/cancel`, {
        method: "POST", headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cancelar");
      toast(`${row.pre_order_no} cancelada`);
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`¿Eliminar ${row.pre_order_no}? Esta acción no se puede deshacer.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`${API_URL}/api/pre-orders/${row.id}`, {
        method: "DELETE", headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar");
      toast(`${row.pre_order_no} eliminada`);
      load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setBusyId(null);
    }
  };

  // El wizard completo se encarga del resto: se abre con la pre-orden cargada
  // y, al crear la(s) PO(s), la marca como convertida.
  const complete = (row) => navigate(`/nuevo-orden-wizard?preOrderId=${row.id}`);

  return (
    <div className="space-y-5">
      {/* Filtros por estado + búsqueda */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors
                ${tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t.label}
              <span className={`ml-1.5 font-mono ${tab === t.key ? "text-slate-400" : "text-slate-400"}`}>
                {counts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar PRE, estilo, cliente…"
              className="w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          {showNewButton && (
            <Link
              to="/pre-orden-wizard"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <Plus size={15} /> Nueva pre-orden
            </Link>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Pre-órdenes" value={visible.length.toLocaleString()} icon={ClipboardList} />
        <Stat label="Piezas" value={totalPieces.toLocaleString()} icon={Package} />
        <Stat label="Pendientes" value={(counts.pending ?? 0).toLocaleString()} icon={ClipboardList} />
        <Stat label="Convertidas" value={(counts.converted ?? 0).toLocaleString()} icon={Check} />
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-400">Cargando pre-órdenes…</p>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-500">
              {search ? "Ninguna pre-orden coincide con la búsqueda." : "Aún no hay pre-órdenes aquí."}
            </p>
            {!search && (
              <Link to="/pre-orden-wizard"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                <Plus size={15} /> Crear la primera
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Pre-orden</th>
                  <th className="px-4 py-3 font-semibold">Estilo</th>
                  <th className="px-4 py-3 font-semibold">Cliente</th>
                  <th className="px-4 py-3 font-semibold text-right">Piezas</th>
                  <th className="px-4 py-3 font-semibold">Objetivo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-mono font-bold text-slate-800">{r.pre_order_no}</p>
                      {r.customer_po && <p className="text-[11px] text-slate-400">PO {r.customer_po}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-slate-800">{r.style_code || "—"}</p>
                      <p className="text-[11px] text-slate-400">
                        {r.estilo ? `estilo ${r.estilo}` : "estilo cliente pendiente"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-800">{r.customer_name || "—"}</p>
                      {r.cliente_code && <p className="font-mono text-[11px] text-slate-400">{r.cliente_code}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                      {Number(r.pieces || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.target_date || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                      {r.status === "converted" && r.work_order_nos && (
                        <p className="mt-1 font-mono text-[11px] text-slate-400 max-w-[220px] truncate" title={r.work_order_nos}>
                          {r.work_order_nos}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === "pending" && (
                          <>
                            <button
                              type="button"
                              onClick={() => complete(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                            >
                              Completar a PO <ArrowRight size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => cancel(r)}
                              disabled={busyId === r.id}
                              title="Cancelar"
                              className="p-1.5 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                            >
                              <Ban size={15} />
                            </button>
                          </>
                        )}
                        {r.status !== "converted" && (
                          <button
                            type="button"
                            onClick={() => remove(r)}
                            disabled={busyId === r.id}
                            title="Eliminar"
                            className="p-1.5 rounded text-rose-500 hover:bg-rose-50 disabled:opacity-40"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Toast propio solo cuando el padre no ofrece el suyo */}
      {localToast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg
          ${localToast.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}>
          {localToast.msg}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
        <Icon size={17} />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="font-mono text-lg font-bold text-slate-800 leading-tight">{value}</p>
      </div>
    </div>
  );
}