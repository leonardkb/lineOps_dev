import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Shirt,
  Search,
  RefreshCw,
  Users,
  Layers,
  Timer,
  Grid,
  List as ListIcon,
  Image as ImageIcon,
  Copy,
  Check,
  FileText,
  Plus,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
  "Content-Type": "application/json",
});

const num = (n, d = 2) => (Number.isFinite(+n) ? +n : 0).toLocaleString("es-MX", { maximumFractionDigits: d });

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-slate-800 leading-tight">{value}</div>
        <div className="text-xs text-slate-500 truncate">{label}</div>
      </div>
    </div>
  );
}

function Photo({ url, alt }) {
  const [ok, setOk] = useState(true);
  if (!url || !ok) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-300">
        <ImageIcon size={26} />
      </div>
    );
  }
  return <img src={url} alt={alt} onError={() => setOk(false)} className="w-full h-full object-cover" />;
}

export default function ProductCatalogPage({ embedded = false, reloadToken = 0, onOnline, onOpenBom }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [boms, setBoms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [q, setQ] = useState("");
  const [cliente, setCliente] = useState("");
  const [modelo, setModelo] = useState("");
  const [view, setView] = useState("grid");
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, bRes] = await Promise.all([
        fetch(`${API_URL}/api/master-codes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/bom`, { headers: authHeaders() }),
      ]);
      if (pRes.status === 401) { window.location.href = "/login"; return; }
      const pData = await pRes.json();
      const bData = await bRes.json();
      setRecords(Array.isArray(pData) ? pData : pData.records || []);
      setBoms(bData.boms || []);
      setApiOnline(true);
      onOnline?.(true);
    } catch (err) {
      console.error(err);
      setApiOnline(false);
      onOnline?.(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadToken]);

  // Which master_code ids already have a BOM (so we can badge them).
  const bomByMaster = useMemo(() => {
    const map = {};
    boms.forEach((b) => { if (b.masterCodeId) map[b.masterCodeId] = b; });
    return map;
  }, [boms]);

  const clientes = useMemo(
    () => [...new Set(records.map((r) => r.cliente).filter(Boolean))].sort(),
    [records]
  );
  const modelos = useMemo(
    () => [...new Set(records.map((r) => r.modelo).filter(Boolean))].sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return records.filter((r) => {
      if (cliente && r.cliente !== cliente) return false;
      if (modelo && r.modelo !== modelo) return false;
      if (!t) return true;
      return [r.code, r.estilo, r.cliente, r.description].filter(Boolean).join(" ").toLowerCase().includes(t);
    });
  }, [records, q, cliente, modelo]);

  const stats = useMemo(
    () => ({
      total: records.length,
      clients: new Set(records.map((r) => r.cliente).filter(Boolean)).size,
      models: new Set(records.map((r) => r.modelo).filter(Boolean)).size,
      withBom: records.filter((r) => bomByMaster[r.id]).length,
    }),
    [records, bomByMaster]
  );

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    showToast("Código copiado");
  };

  const openBom = (r) => {
    const existing = bomByMaster[r.id];
    const target = existing ? { id: existing.id } : { masterCodeId: r.id };
    // Inside the BOM dashboard, hand off to the parent so it can switch tabs;
    // as a standalone route, navigate to the editor directly.
    if (onOpenBom) return onOpenBom(target);
    navigate(existing ? `/bom?id=${existing.id}` : `/bom?masterCodeId=${r.id}`);
  };

  const body = (
    <>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Shirt} label="Productos" value={stats.total} />
          <StatCard icon={Users} label="Clientes" value={stats.clients} />
          <StatCard icon={Layers} label="Modelos" value={stats.models} />
          <StatCard icon={FileText} label="Con lista de materiales" value={stats.withBom} />
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código, estilo o descripción"
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <select
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            <option value="">Todos los modelos</option>
            {modelos.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={`px-2.5 py-2 ${view === "grid" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`}
              title="Cuadrícula"
            >
              <Grid size={16} />
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-2.5 py-2 ${view === "table" ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`}
              title="Tabla"
            >
              <ListIcon size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-slate-400">
            <RefreshCw size={22} className="animate-spin mx-auto mb-2" />
            Cargando productos…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-slate-400">
            {records.length === 0
              ? "Aún no hay códigos maestros. Créalos desde la página de captura de producto."
              : "Ningún producto coincide con los filtros."}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((r) => {
              const bom = bomByMaster[r.id];
              return (
                <div
                  key={r.id}
                  className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col"
                >
                  <div className="aspect-[4/3] bg-slate-100">
                    <Photo url={r.photoUrl} alt={r.code} />
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => copyCode(r.code)}
                        title="Copiar código"
                        className="font-mono text-xs text-slate-800 hover:text-slate-500 text-left break-all"
                      >
                        {r.code}
                      </button>
                      {bom && (
                        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5">
                          <FileText size={10} /> BOM
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700 line-clamp-2">{r.description || "—"}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      {r.estilo && (
                        <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5">{r.estilo}</span>
                      )}
                      {r.cliente && (
                        <span className="rounded bg-rose-100 text-rose-700 px-1.5 py-0.5">{r.cliente}</span>
                      )}
                      {Number.isFinite(+r.sam) && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">
                          <Timer size={11} /> {num(r.sam)} min
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openBom(r)}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-slate-700 px-3 py-2 text-xs font-medium hover:border-slate-400 hover:bg-slate-50"
                    >
                      {bom ? (
                        <>
                          <FileText size={14} /> Ver lista ({bom.lineCount})
                        </>
                      ) : (
                        <>
                          <Plus size={14} /> Crear lista de materiales
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5 font-medium">Código</th>
                  <th className="px-5 py-2.5 font-medium">Descripción</th>
                  <th className="px-5 py-2.5 font-medium">Estilo</th>
                  <th className="px-5 py-2.5 font-medium">Cliente</th>
                  <th className="px-5 py-2.5 font-medium text-right">SAM</th>
                  <th className="px-5 py-2.5 font-medium">BOM</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r) => {
                  const bom = bomByMaster[r.id];
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <button
                          onClick={() => copyCode(r.code)}
                          className="font-mono text-xs text-slate-800 hover:text-slate-500 inline-flex items-center gap-1"
                        >
                          {r.code} <Copy size={11} className="text-slate-300" />
                        </button>
                      </td>
                      <td className="px-5 py-3 text-slate-700 max-w-xs truncate">{r.description || "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{r.estilo || "—"}</td>
                      <td className="px-5 py-3 text-slate-600">{r.cliente || "—"}</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {Number.isFinite(+r.sam) ? `${num(r.sam)} min` : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {bom ? (
                          <span className="inline-flex items-center gap-1 text-[11px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">
                            <FileText size={11} /> {bom.lineCount}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => openBom(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 text-slate-700 px-2.5 py-1.5 text-xs font-medium hover:border-slate-400 hover:bg-slate-50"
                        >
                          {bom ? "Ver lista" : "Crear BOM"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
          <Check size={15} /> {toast}
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar
        title="Catálogo de productos"
        onRefresh={load}
        isRefreshing={loading}
        showStatus={!loading}
        isOnline={apiOnline}
      />
      {body}
    </div>
  );
}