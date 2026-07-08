import { useEffect, useMemo, useState } from "react";
import { Hash, Users, Timer, Shirt, Plus, RefreshCw, Check, AlertCircle } from "lucide-react";
import StatCard from "../../components/merchant/StatCard";
import FilterBar from "../../components/merchant/Filterbar";
import MasterCodeCard from "../../components/merchant/MasterCodeCard";
import MasterCodeTable from "../../components/merchant/MasterCodeTable";
import MasterCodeDetailModal from "../../components/merchant/MasterCodeDetailModal";
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

export default function MerchantDashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [filters, setFilters] = useState({ q: "", tipo: "", modelo: "", talla: "" });
  const [view, setView] = useState("grid"); // "grid" | "table"
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      
      // Build query string from filters
      const params = new URLSearchParams();
      if (filters.q) params.append('q', filters.q);
      if (filters.tipo) params.append('tipo', filters.tipo);
      if (filters.modelo) params.append('modelo', filters.modelo);
      if (filters.talla) params.append('talla', filters.talla);
      
      const url = `${API_URL}/api/master-codes${params.toString() ? '?' + params.toString() : ''}`;
      
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!res.ok) {
        if (res.status === 401) {
          // Unauthorized - redirect to login
          window.location.href = '/login';
          return;
        }
        throw new Error(`API error: ${res.status}`);
      }
      
      const data = await res.json();
      
      // Map the database fields to match the component's expected format
      setRecords(
        data.map((r) => ({
          ...r,
          // Ensure consistent field names
          type: r.type || r.tipo,
          sam: r.sam || r.sam_minutes,
          photoUrl: r.photoUrl || null,
          createdAt: r.createdAt ? new Date(r.createdAt).toLocaleString() : new Date().toLocaleString(),
        }))
      );
      setApiOnline(true);
    } catch (err) {
      console.error("Fetch error:", err);
      // Backend not running → show demo data so the UI is usable
      setRecords(DEMO_RECORDS);
      setApiOnline(false);
      if (err.message !== 'API error: 401') {
        showToast("⚠️ Usando datos de demostración - API no disponible", true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch when component mounts or filters change
  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.tipo, filters.modelo, filters.talla]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toUpperCase();
    return records.filter((r) => {
      if (filters.tipo && r.type !== filters.tipo && r.tipo !== filters.tipo) return false;
      if (filters.modelo && r.modelo !== filters.modelo) return false;
      if (filters.talla && r.talla !== filters.talla) return false;
      if (q) {
        const hay = `${r.code} ${r.description || ''} ${r.cliente || ''} ${r.estilo || ''} ${r.color || ''}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, filters]);

  const stats = useMemo(() => {
    const clients = new Set(records.map((r) => r.cliente || r.cliente)).size;
    const models = new Set(records.map((r) => r.modelo)).size;
    const avgSam = records.length
      ? (records.reduce((s, r) => s + Number(r.sam || r.sam_minutes || 0), 0) / records.length).toFixed(2)
      : "0.00";
    return { total: records.length, clients, models, avgSam };
  }, [records]);

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    showToast("📋 Código copiado");
  };

  const duplicateCode = (code) => {
    // Navigate to merchant page with copy parameter
    window.location.href = `/merchant?copy=${encodeURIComponent(code)}`;
  };

  const deleteRecord = async (record) => {
    if (!window.confirm(`¿Eliminar ${record.code}?`)) return;
    
    if (apiOnline) {
      try {
        const token = localStorage.getItem('token');
        const id = record.id || record._id || record.code;
        const res = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(id)}`, { 
          method: "DELETE",
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/login';
            return;
          }
          throw new Error('Failed to delete');
        }
        
        // Remove from local state
        setRecords((rs) => rs.filter((r) => r.code !== record.code && r.id !== record.id));
        setSelected(null);
        showToast("✅ Código eliminado");
        return;
      } catch (err) {
        console.error("Delete error:", err);
        showToast("❌ No se pudo eliminar en el servidor", true);
        return;
      }
    }
    
    // Fallback: remove from local state only
    setRecords((rs) => rs.filter((r) => r.code !== record.code));
    setSelected(null);
    showToast("✅ Código eliminado (local)");
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
    // Refetch with new filters
    fetchRecords();
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
       <MerchantNavbar
        title="Dashboard · Códigos maestros"
        onRefresh={fetchRecords}
        isRefreshing={loading}
        showStatus={!loading}
        isOnline={apiOnline}
      />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Hash} label="Códigos maestros" value={stats.total} />
          <StatCard icon={Users} label="Clientes" value={stats.clients} />
          <StatCard icon={Shirt} label="Modelos distintos" value={stats.models} />
         
        </div>

        {/* Filters */}
        <FilterBar 
          filters={filters} 
          onChange={handleFilterChange} 
          view={view} 
          onViewChange={setView} 
        />

        {/* Content */}
        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm">
            <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
            Cargando códigos…
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
            <p className="text-slate-500 text-sm">
              {records.length === 0 ? (
                apiOnline ? 
                  "No hay códigos maestros en la base de datos. ¡Crea el primero!" :
                  "No se pudieron cargar los datos. Verifica la conexión con el servidor."
              ) : (
                "No hay códigos que coincidan con los filtros."
              )}
            </p>
            {records.length > 0 && (
              <button
                type="button"
                onClick={() => handleFilterChange({ q: "", tipo: "", modelo: "", talla: "" })}
                className="mt-2 text-xs text-slate-900 font-semibold hover:underline"
              >
                Limpiar filtros
              </button>
            )}
            {!apiOnline && !loading && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg max-w-md mx-auto">
                <p className="text-xs text-amber-700">
                  ⚠️ El servidor no está disponible. Mostrando datos de demostración.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Asegúrate de que el backend esté corriendo en {API_URL}
                </p>
              </div>
            )}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((r) => (
              <MasterCodeCard
                key={r.id || r.code}
                record={r}
                onOpen={setSelected}
                onCopy={copyCode}
                onDuplicate={duplicateCode}
                onDelete={deleteRecord}
              />
            ))}
          </div>
        ) : (
          <MasterCodeTable
            records={filtered}
            onOpen={setSelected}
            onCopy={copyCode}
            onDuplicate={duplicateCode}
            onDelete={deleteRecord}
          />
        )}

        <p className="text-xs text-slate-400 text-right">
          Mostrando {filtered.length} de {records.length} códigos
          {apiOnline && ` · Conectado a ${API_URL}`}
        </p>
      </main>

      {/* Detail modal */}
      {selected && (
        <MasterCodeDetailModal
          record={selected}
          onClose={() => setSelected(null)}
          onCopy={copyCode}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}
        >
          {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}