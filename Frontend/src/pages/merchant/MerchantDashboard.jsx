import { useEffect, useMemo, useState } from "react";
import { Hash, Users, Shirt, ClipboardList, RefreshCw, Check, AlertCircle, Search, Factory, Layers, Gauge, PackageCheck, FileText } from "lucide-react";
import StatCard from "../../components/merchant/StatCard";
import FilterBar from "../../components/merchant/Filterbar";
import MasterCodeCard from "../../components/merchant/MasterCodeCard";
import MasterCodeTable from "../../components/merchant/MasterCodeTable";
import MasterCodeDetailModal from "../../components/merchant/MasterCodeDetailModal";
import MasterCodeEditModal from "../../components/merchant/MasterCodeEditModal";
import WorkOrderTable from "../../components/merchant/WorkOrderTable";
import WorkOrderEditModal from "../../components/merchant/WorkOrderEditModal";
import MerchantPlanner from "../../components/merchant/MerchantPlanner";
import PreOrdenesPanel from "../../components/merchant/PreOrdenesPanel";
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

/* ---- Seguimiento (estado PO · líneas · producido vs asignado) ------------ */

const STATUS_META = {
  pending:     { label: "Pendiente",  chip: "bg-slate-100 text-slate-600" },
  assigned:    { label: "Asignada",   chip: "bg-blue-100 text-blue-700" },
  in_progress: { label: "En proceso", chip: "bg-amber-100 text-amber-700" },
  completed:   { label: "Terminada",  chip: "bg-emerald-100 text-emerald-700" },
  cancelled:   { label: "Cancelada",  chip: "bg-rose-100 text-rose-600" },
};
const statusMeta = (s) => STATUS_META[s] || { label: s || "—", chip: "bg-slate-100 text-slate-600" };
const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString();
const clampPct = (n) => Math.min(Math.max(Number(n) || 0, 0), 100);
// Green once producido cierra contra lo asignado, cálido mientras arranca.
const barColor = (p) => (p >= 100 ? "#16a34a" : p >= 75 ? "#65a30d" : p >= 40 ? "#f59e0b" : p > 0 ? "#f97316" : "#cbd5e1");

// Demo fallback so the tab is previewable when /api/merchant/analytics isn't wired.
const DEMO_ANALYTICS = {
  success: true,
  summary: {
    total_pos: 3, assigned_pos: 2, unassigned_pos: 1, completed_pos: 1,
    total_pieces: 1580, produced_pieces: 920,
  },
  detail: [
    { id: 1, work_order_no: "SKM0001-INV-DAMPAN01", customer_name: "Inverdibol", customer_po: "PO-5521",
      style_code: "DAMPAN01", estilo: "FN2808", color: "NEG, BLA", status: "in_progress",
      target_quantity: 780, assigned_quantity: 780, produced_quantity: 420,
      assigned: true, assigned_lines: "1, 3", assigned_days: 2, first_assigned_day: "2026-08-04" },
    { id: 3, work_order_no: "SKM0003-INV-CABTSH02", customer_name: "Inverdibol", customer_po: "PO-5540",
      style_code: "CABTSH02", estilo: "FN3110", color: "BLA", status: "completed",
      target_quantity: 500, assigned_quantity: 500, produced_quantity: 500,
      assigned: true, assigned_lines: "2", assigned_days: 3, first_assigned_day: "2026-07-28" },
    { id: 2, work_order_no: "SKM0002-ZAR-NNALEG03", customer_name: "Zara México", customer_po: "ZR-118",
      style_code: "NNALEG03", estilo: "KD1201", color: "ROS", status: "pending",
      target_quantity: 300, assigned_quantity: 0, produced_quantity: 0,
      assigned: false, assigned_lines: null, assigned_days: 0, first_assigned_day: null },
  ],
};

function StatusChip({ status }) {
  const m = statusMeta(status);
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${m.chip}`}>{m.label}</span>;
}

// The lines a PO was dropped onto: "1, 3" -> [L1] [L3].
function LineBadges({ lines }) {
  const parts = String(lines || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return <span className="text-xs text-amber-600">Sin asignar</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((l) => (
        <span key={l} className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 text-[11px] font-mono font-semibold">
          L{l}
        </span>
      ))}
    </div>
  );
}

// Producido contra lo asignado (o contra el objetivo cuando aún no hay asignación).
function ProducedVsAssigned({ produced, assigned, target }) {
  const base = Number(assigned) > 0 ? Number(assigned) : Number(target) || 0;
  const p = base > 0 ? clampPct((Number(produced) / base) * 100) : 0;
  const refLabel = Number(assigned) > 0 ? "asig." : "obj.";
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-900">{fmtInt(produced)}</span>
        <span className="text-slate-400">/ {fmtInt(base)} <span className="text-[10px]">{refLabel}</span></span>
      </div>
      <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: barColor(p) }} />
      </div>
    </div>
  );
}

export default function MerchantDashboard() {
  const [tab, setTab] = useState("master"); // "master" | "pre" | "po" | "plan" | "estado"

  // Pre-órdenes: el panel se monta al abrir su pestaña, pero los conteos se
  // piden al cargar el dashboard para que el KPI y el badge no salgan en 0.
  const [preCounts, setPreCounts] = useState({ pending: 0, converted: 0, cancelled: 0, all: 0 });
  const [preRefresh, setPreRefresh] = useState(0);

  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [filters, setFilters] = useState({ q: "", tipo: "", modelo: "", cliente: "" });
  const [poQuery, setPoQuery] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [estadoQuery, setEstadoQuery] = useState("");
  const [estadoStatus, setEstadoStatus] = useState("all");
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

  // PO status / lines / producido vs asignado. Reads the same read-only endpoint
  // the CEO monitor uses, but scoped to this merchant's own tracking table. A wide
  // window (last ~12 months) so older still-open POs remain visible.
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - 365);
      const ymd = (d) => d.toISOString().slice(0, 10);
      const params = new URLSearchParams({ startDate: ymd(start), endDate: ymd(end) });
      const res = await fetch(`${API_URL}/api/merchant/analytics?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { window.location.href = '/login'; return; }
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'analytics failed');
      setAnalytics(data);
    } catch (err) {
      console.error("Analytics fetch error:", err);
      setAnalytics(DEMO_ANALYTICS);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Solo los conteos por estado (el panel trae el detalle cuando se abre).
  const fetchPreCounts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pre-orders?status=pending`, { headers: authHeaders() });
      if (!res.ok) return;                       // sin backend todavía: se queda en 0
      const data = await res.json();
      if (data.counts) setPreCounts(data.counts);
    } catch { /* el dashboard sigue funcionando sin pre-órdenes */ }
  };

  // Permite entrar directo a una pestaña: /merchant-dashboard?tab=pre
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (["master", "pre", "po", "estado", "plan"].includes(t)) setTab(t);
  }, []);

  // Master codes: refetch (debounced) when filters change.
  useEffect(() => {
    const t = setTimeout(fetchRecords, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.tipo, filters.modelo, filters.cliente]);

  // Orders + PO tracking: load once on mount.
  useEffect(() => { fetchOrders(); fetchAnalytics(); fetchPreCounts(); }, []);

  const refreshAll = () => {
    fetchRecords(); fetchOrders(); fetchAnalytics(); fetchPreCounts();
    setPreRefresh((n) => n + 1);          // recarga el panel si está abierto
  };

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

  const estadoRows = useMemo(() => {
    const rows = analytics?.detail || [];
    const q = estadoQuery.trim().toUpperCase();
    return rows.filter((r) => {
      if (estadoStatus !== "all" && r.status !== estadoStatus) return false;
      if (q) {
        const hay = `${r.work_order_no} ${r.customer_name || ""} ${r.customer_po || ""} ${r.style_code || ""} ${r.estilo || ""} ${r.color || ""}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [analytics, estadoQuery, estadoStatus]);

  const estadoSummary = useMemo(() => {
    const rows = analytics?.detail || [];
    const assigned = rows.reduce((s, r) => s + (Number(r.assigned_quantity) || 0), 0);
    const produced = rows.reduce((s, r) => s + (Number(r.produced_quantity) || 0), 0);
    return {
      total: rows.length,
      assignedPos: rows.filter((r) => r.assigned).length,
      unassignedPos: rows.filter((r) => !r.assigned).length,
      assigned,
      produced,
      progress: assigned > 0 ? Math.round((produced / assigned) * 100) : 0,
    };
  }, [analytics]);

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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard icon={Hash} label="Códigos maestros" value={stats.total} />
          <StatCard icon={Users} label="Clientes" value={stats.clients} />
          <StatCard icon={Shirt} label="Modelos distintos" value={stats.models} />
          <StatCard icon={ClipboardList} label="Órdenes de producción" value={stats.pos} />
          <StatCard icon={FileText} label="Pre-órdenes pendientes" value={preCounts.pending ?? 0} />
        </div>

        {/* View switch: master codes vs POs */}
        <div className="flex gap-2">
          <TabButton id="master" label="Códigos maestros" count={records.length} />
          <TabButton id="pre" label="Pre-órdenes" count={preCounts.pending ?? 0} />
          <TabButton id="po" label="Órdenes de producción" count={orders.length} />
          <TabButton id="estado" label="Seguimiento" count={analytics?.detail?.length ?? 0} />
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

        {/* ---------------- PRE-ÓRDENES ---------------- */}
        {tab === "pre" && (
          <PreOrdenesPanel
            refreshKey={preRefresh}
            onCountsChange={setPreCounts}
            onToast={showToast}
          />
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

        {/* ---------------- PO TRACKING (estado · líneas · producido vs asignado) ---------------- */}
        {tab === "estado" && (
          <>
            {/* KPIs for tracking */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={ClipboardList} label="POs en seguimiento" value={estadoSummary.total} />
              <StatCard icon={Layers} label="Asignadas a línea" value={`${estadoSummary.assignedPos} / ${estadoSummary.total}`} />
              <StatCard icon={PackageCheck} label="Producido / asignado" value={`${fmtInt(estadoSummary.produced)} / ${fmtInt(estadoSummary.assigned)}`} />
              <StatCard icon={Gauge} label="Avance vs asignado" value={`${estadoSummary.progress}%`} />
            </div>

            {/* Filters */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={estadoQuery}
                  onChange={(e) => setEstadoQuery(e.target.value)}
                  placeholder="Buscar por N° de orden, cliente, estilo, color…"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <select
                value={estadoStatus}
                onChange={(e) => setEstadoStatus(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="all">Todos los estados</option>
                {Object.keys(STATUS_META).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>

            {analyticsLoading ? (
              <div className="text-center py-20 text-slate-400 text-sm">
                <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                Cargando seguimiento…
              </div>
            ) : estadoRows.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
                <Factory size={26} className="mx-auto mb-2 text-slate-300" />
                <p className="text-slate-500 text-sm">
                  {(analytics?.detail?.length ?? 0) === 0
                    ? "Aún no hay órdenes para dar seguimiento."
                    : "No hay órdenes que coincidan con los filtros."}
                </p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Orden</th>
                        <th className="px-4 py-3 font-medium">Estilo / color</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                        <th className="px-4 py-3 font-medium">Líneas asignadas</th>
                        <th className="px-4 py-3 font-medium text-right">Asignado</th>
                        <th className="px-4 py-3 font-medium">Producido vs asignado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {estadoRows.map((r) => (
                        <tr key={r.id || r.work_order_no} className="align-top hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <span className="font-mono font-semibold text-slate-800">{r.work_order_no}</span>
                            <span className="block text-[11px] text-slate-400 truncate max-w-[200px]">
                              {r.customer_name || "—"}{r.customer_po ? ` · ${r.customer_po}` : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono text-slate-700">{r.style_code || r.estilo || "—"}</span>
                            {r.color && <span className="block text-[11px] text-slate-400 font-mono">{r.color}</span>}
                          </td>
                          <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                          <td className="px-4 py-3">
                            <LineBadges lines={r.assigned_lines} />
                            {r.assigned_days > 1 && (
                              <span className="block text-[10px] text-slate-400 mt-0.5">{r.assigned_days} días</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-700">
                            {fmtInt(r.assigned_quantity)}
                            <span className="block text-[10px] text-slate-400">obj. {fmtInt(r.target_quantity)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <ProducedVsAssigned
                              produced={r.produced_quantity}
                              assigned={r.assigned_quantity}
                              target={r.target_quantity}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 text-right">
              Mostrando {estadoRows.length} de {analytics?.detail?.length ?? 0} órdenes
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