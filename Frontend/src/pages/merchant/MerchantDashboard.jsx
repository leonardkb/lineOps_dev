import { useEffect, useMemo, useState } from "react";
import { Hash, Users, Shirt, ClipboardList, RefreshCw, Check, AlertCircle, Search } from "lucide-react";
import StatCard from "../../components/merchant/StatCard";
import FilterBar from "../../components/merchant/Filterbar";
import MasterCodeCard from "../../components/merchant/MasterCodeCard";
import MasterCodeTable from "../../components/merchant/MasterCodeTable";
import MasterCodeDetailModal from "../../components/merchant/MasterCodeDetailModal";
import MasterCodeEditModal from "../../components/merchant/MasterCodeEditModal";
import WorkOrderTable from "../../components/merchant/WorkOrderTable";
import WorkOrderEditModal from "../../components/merchant/WorkOrderEditModal";
import MerchantPlanner from "../../components/merchant/MerchantPlanner";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

/* Demo data shown when the backend is not reachable, so the UI is previewable */
const DEMO_RECORDS = [
  {
    code: "DAMPAN01130INV-NEG-FN2808",
    type: "DAM", modelo: "PAN", correlativo: "01", talla: "130",
    cliente: "INV", color: "NEG", estilo: "FN2808",
    description: "Pantalón dama invierno, tela franela, color negro",
    sam: 12.5, photoUrl: null, createdAt: "2026-06-28T10:15:00Z",
  },
  {
    code: "CABTSH02138INV-BLA-FN3110",
    type: "CAB", modelo: "TSH", correlativo: "02", talla: "138",
    cliente: "INV", color: "BLA", estilo: "FN3110",
    description: "T-shirt caballero manga corta, algodón peinado, blanco",
    sam: 8.2, photoUrl: null, createdAt: "2026-06-30T14:40:00Z",
  },
  {
    code: "NNALEG03006ZAR-ROS-KD1201",
    type: "NNA", modelo: "LEG", correlativo: "03", talla: "006",
    cliente: "ZAR", color: "ROS", estilo: "KD1201",
    description: "Legging niña talla infantil, licra rosada",
    sam: 6.75, photoUrl: null, createdAt: "2026-07-01T09:05:00Z",
  },
];

const DEMO_ORDERS = [
  {
    id: 1, work_order_no: "SKM0001-INV-DAMPAN01", customer_name: "Inverdibol",
    style_code: "DAMPAN01", estilo: "FN2808", style_description: "Pantalón dama invierno",
    color: "NEG, BLA", quantity: 800, total_to_produce: 780, commitment_date: "2026-08-15",
    status: "in_progress", master_code_photo_url: null, created_at: "2026-07-10T10:00:00Z",
  },
  {
    id: 2, work_order_no: "SKM0002-ZAR-NNALEG03", customer_name: "Zara México",
    style_code: "NNALEG03", estilo: "KD1201", style_description: "Legging niña licra",
    color: "ROS", quantity: 300, total_to_produce: 300, commitment_date: "2026-08-30",
    status: "pending", master_code_photo_url: null, created_at: "2026-07-12T09:30:00Z",
  },
];

export default function MerchantDashboard() {
  const [tab, setTab] = useState("master"); // "master" | "po" | "plan"

  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [filters, setFilters] = useState({ q: "", tipo: "", modelo: "", cliente: "" });
  const [poQuery, setPoQuery] = useState("");
  const [view, setView] = useState("grid"); // "grid" | "table"
  const [selected, setSelected] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const authHeaders = () => ({
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  });

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.append('q', filters.q);
      if (filters.tipo) params.append('tipo', filters.tipo);
      if (filters.modelo) params.append('modelo', filters.modelo);
      if (filters.cliente) params.append('cliente', filters.cliente);

      const url = `${API_URL}/api/master-codes${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, { headers: authHeaders() });

      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setRecords(
        data.map((r) => ({
          ...r,
          type: r.type || r.tipo,
          sam: r.sam || r.sam_minutes,
          photoUrl: r.photoUrl || null,
          createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString() : new Date().toLocaleString(),
        }))
      );
      setApiOnline(true);
    } catch (err) {
      console.error("Fetch error:", err);
      setRecords(DEMO_RECORDS);
      setApiOnline(false);
      if (err.message !== 'API error: 401') {
        showToast("⚠️ Usando datos de demostración - API no disponible", true);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.workOrders || []);
    } catch (err) {
      console.error("Orders fetch error:", err);
      setOrders(DEMO_ORDERS);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Master codes: refetch (debounced) when filters change.
  useEffect(() => {
    const t = setTimeout(fetchRecords, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.tipo, filters.modelo, filters.cliente]);

  // Orders: load once on mount.
  useEffect(() => { fetchOrders(); }, []);

  const refreshAll = () => { fetchRecords(); fetchOrders(); };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toUpperCase();
    return records.filter((r) => {
      if (filters.tipo && r.type !== filters.tipo && r.tipo !== filters.tipo) return false;
      if (filters.modelo && r.modelo !== filters.modelo) return false;
      if (filters.cliente && r.cliente !== filters.cliente) return false;
      if (q) {
        const hay = `${r.code} ${r.description || ''} ${r.cliente || ''} ${r.estilo || ''} ${r.color || ''}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, filters]);

  const filteredOrders = useMemo(() => {
    const q = poQuery.trim().toUpperCase();
    if (!q) return orders;
    return orders.filter((o) =>
      `${o.work_order_no} ${o.customer_name || ''} ${o.style_code || ''} ${o.estilo || ''} ${o.style_description || ''} ${o.color || ''}`
        .toUpperCase().includes(q)
    );
  }, [orders, poQuery]);

  const clientes = useMemo(
    () => [...new Set(records.map((r) => r.cliente).filter(Boolean))].sort(),
    [records]
  );

  const stats = useMemo(() => {
    const clients = new Set(records.map((r) => r.cliente).filter(Boolean)).size;
    const models = new Set(records.map((r) => r.modelo)).size;
    return { total: records.length, clients, models, pos: orders.length };
  }, [records, orders]);

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    showToast("📋 Código copiado");
  };

  const duplicateCode = (code) => {
    window.location.href = `/merchant?copy=${encodeURIComponent(code)}`;
  };

  // ---- Edit: master codes -------------------------------------------------
  const openEditRecord = (record) => {
    setSelected(null);
    setEditingRecord(record);
  };

  const handleMasterSaved = (updated, original) => {
    setRecords((rs) =>
      rs.map((r) => {
        const same = original?.id ? r.id === original.id : r.code === original?.code;
        return same ? { ...r, ...updated } : r;
      })
    );
    setEditingRecord(null);
    showToast("✅ Código actualizado");
    if (apiOnline) fetchRecords(); // resync (fresh photo URLs, correlativo, etc.)
  };

  // ---- Edit: production orders -------------------------------------------
  const openEditOrder = (order) => setEditingOrder(order);

  const handleOrderSaved = (updated, original) => {
    setOrders((os) =>
      os.map((o) => {
        const same = original?.id ? o.id === original.id : o.work_order_no === original?.work_order_no;
        return same ? { ...o, ...updated } : o;
      })
    );
    setEditingOrder(null);
    showToast("✅ Orden actualizada");
    if (apiOnline) fetchOrders();
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`¿Eliminar ${record.code}?`)) return;
    if (apiOnline) {
      try {
        const id = record.id || record._id || record.code;
        const res = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(id)}`, {
          method: "DELETE", headers: authHeaders(),
        });
        if (!res.ok) {
          if (res.status === 401) { window.location.href = '/login'; return; }
          throw new Error('Failed to delete');
        }
        setRecords((rs) => rs.filter((r) => (record.id ? r.id !== record.id : r.code !== record.code)));
        setSelected(null);
        showToast("✅ Código eliminado");
        return;
      } catch (err) {
        console.error("Delete error:", err);
        showToast("❌ No se pudo eliminar en el servidor", true);
        return;
      }
    }
    setRecords((rs) => rs.filter((r) => r.code !== record.code));
    setSelected(null);
    showToast("✅ Código eliminado (local)");
  };

  const handleFilterChange = (newFilters) => setFilters(newFilters);

  const TabButton = ({ id, label, count }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all
        ${tab === id ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:border-slate-400"}`}
    >
      {label}
      <span className={`text-[11px] rounded-full px-1.5 py-0.5 ${tab === id ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar
        title="Dashboard · Códigos maestros y PO"
        onRefresh={refreshAll}
        isRefreshing={loading || ordersLoading}
        showStatus={!loading}
        isOnline={apiOnline}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Hash} label="Códigos maestros" value={stats.total} />
          <StatCard icon={Users} label="Clientes" value={stats.clients} />
          <StatCard icon={Shirt} label="Modelos distintos" value={stats.models} />
          <StatCard icon={ClipboardList} label="Órdenes de producción" value={stats.pos} />
        </div>

        {/* View switch: master codes vs POs */}
        <div className="flex gap-2">
          <TabButton id="master" label="Códigos maestros" count={records.length} />
          <TabButton id="po" label="Órdenes de producción" count={orders.length} />
          <TabButton id="plan" label="Planeación" count={orders.length} />
        </div>

        {/* ---------------- MASTER CODES ---------------- */}
        {tab === "master" && (
          <>
            <FilterBar
              filters={filters}
              onChange={handleFilterChange}
              view={view}
              onViewChange={setView}
              clientes={clientes}
            />

            {loading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando códigos…
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <p className="text-slate-500 text-sm">
                  {records.length === 0
                    ? (apiOnline ? "No hay códigos maestros. ¡Crea el primero!" : "No se pudieron cargar los datos.")
                    : "No hay códigos que coincidan con los filtros."}
                </p>
                {records.length > 0 && (
                  <button type="button" onClick={() => handleFilterChange({ q: "", tipo: "", modelo: "", cliente: "" })}
                    className="mt-2 text-xs text-slate-900 font-semibold hover:underline">
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : view === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map((r) => (
                  <MasterCodeCard key={r.id || r.code} record={r}
                    onOpen={setSelected} onCopy={copyCode} onDuplicate={duplicateCode} onEdit={openEditRecord} onDelete={deleteRecord} />
                ))}
              </div>
            ) : (
              <MasterCodeTable records={filtered}
                onOpen={setSelected} onCopy={copyCode} onDuplicate={duplicateCode} onEdit={openEditRecord} onDelete={deleteRecord} />
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {filtered.length} de {records.length} códigos
              {apiOnline && ` · Conectado a ${API_URL}`}
            </p>
          </>
        )}

        {/* ---------------- PRODUCTION ORDERS ---------------- */}
        {tab === "po" && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={poQuery}
                  onChange={(e) => setPoQuery(e.target.value)}
                  placeholder="Buscar por N° de orden, cliente, estilo…"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            {ordersLoading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando órdenes…
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <p className="text-slate-500 text-sm">
                  {orders.length === 0 ? "Aún no hay órdenes de producción." : "No hay órdenes que coincidan con la búsqueda."}
                </p>
              </div>
            ) : (
              <WorkOrderTable orders={filteredOrders} onEdit={openEditOrder} />
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {filteredOrders.length} de {orders.length} órdenes
              {apiOnline && ` · Conectado a ${API_URL}`}
            </p>
          </>
        )}

        {/* ---------------- PLANNING BOARD ---------------- */}
        {tab === "plan" && (
          <MerchantPlanner
            orders={orders}
            loading={ordersLoading}
            apiOnline={apiOnline}
            onRefresh={fetchOrders}
          />
        )}
      </main>

      {/* Detail modal (master codes) */}
      {selected && (
        <MasterCodeDetailModal
          record={selected}
          onClose={() => setSelected(null)}
          onCopy={copyCode}
          onEdit={openEditRecord}
        />
      )}

      {/* Edit modal (master codes) */}
      {editingRecord && (
        <MasterCodeEditModal
          record={editingRecord}
          apiOnline={apiOnline}
          onClose={() => setEditingRecord(null)}
          onSaved={handleMasterSaved}
        />
      )}

      {/* Edit modal (production orders) */}
      {editingOrder && (
        <WorkOrderEditModal
          order={editingOrder}
          apiOnline={apiOnline}
          onClose={() => setEditingOrder(null)}
          onSaved={handleOrderSaved}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
          {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}