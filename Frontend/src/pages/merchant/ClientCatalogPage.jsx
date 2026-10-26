import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Search,
  Check,
  X,
  RefreshCw,
  Globe,
  Home,
  Hash,
  AlertCircle,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
  "Content-Type": "application/json",
});

const MARKETS = [
  { code: "domestico", label: "Doméstico", icon: Home, tint: "bg-sky-100 text-sky-700" },
  { code: "export", label: "Exportación", icon: Globe, tint: "bg-violet-100 text-violet-700" },
];
const marketMeta = (m) => MARKETS.find((x) => x.code === m) || MARKETS[0];

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

export default function ClientCatalogPage({ embedded = false, reloadToken = 0, onOnline }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [q, setQ] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState({ name: "", code: "", market_type: "domestico" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/customers`, { headers: authHeaders() });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json();
      setCustomers(data.customers || []);
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

  const addCustomer = async () => {
    setFormError("");
    if (!form.name.trim()) return setFormError("El nombre del cliente es obligatorio");
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/customers`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || null,
          market_type: form.market_type,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear el cliente");
      setCustomers((cs) => [...cs, data.customer].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: "", code: "", market_type: "domestico" });
      showToast("Cliente agregado");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (marketFilter !== "all" && c.market_type !== marketFilter) return false;
      if (!t) return true;
      return [c.name, c.code].filter(Boolean).join(" ").toLowerCase().includes(t);
    });
  }, [customers, q, marketFilter]);

  const stats = useMemo(() => {
    const exportCount = customers.filter((c) => c.market_type === "export").length;
    const coded = customers.filter((c) => c.code).length;
    return { total: customers.length, export: exportCount, domestic: customers.length - exportCount, coded };
  }, [customers]);

  const body = (
    <>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Clientes" value={stats.total} />
          <StatCard icon={Home} label="Doméstico" value={stats.domestic} />
          <StatCard icon={Globe} label="Exportación" value={stats.export} />
          <StatCard icon={Hash} label="Con código" value={stats.coded} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* ---- List ---- */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar cliente por nombre o código"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div className="flex gap-1.5">
                {[{ code: "all", label: "Todos" }, ...MARKETS].map((m) => (
                  <button
                    key={m.code}
                    onClick={() => setMarketFilter(m.code)}
                    className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-all ${
                      marketFilter === m.code
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-sm text-slate-400">
                <RefreshCw size={22} className="animate-spin mx-auto mb-2" />
                Cargando clientes…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-400">
                {customers.length === 0
                  ? "Aún no hay clientes. Agrega el primero con el formulario de la derecha."
                  : "Ningún cliente coincide con la búsqueda."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                      <th className="px-5 py-2.5 font-medium">Cliente</th>
                      <th className="px-5 py-2.5 font-medium">Código</th>
                      <th className="px-5 py-2.5 font-medium">Mercado</th>
                      <th className="px-5 py-2.5 font-medium">Alta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((c) => {
                      const mm = marketMeta(c.market_type);
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-5 py-3 font-medium text-slate-800">{c.name}</td>
                          <td className="px-5 py-3">
                            {c.code ? (
                              <span className="font-mono text-xs text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
                                {c.code}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${mm.tint}`}>
                              <mm.icon size={12} /> {mm.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-500">
                            {c.created_at ? new Date(c.created_at).toLocaleDateString("es-MX") : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- Add form ---- */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm h-fit lg:sticky lg:top-6">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                <Plus size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Nuevo cliente</h2>
                <p className="text-xs text-slate-500">Se agrega al catálogo compartido</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && addCustomer()}
                  placeholder="p. ej. Inverdibol"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Código <span className="text-slate-400 font-normal">(3 letras, opcional)</span>
                </label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().slice(0, 10) }))}
                  onKeyDown={(e) => e.key === "Enter" && addCustomer()}
                  placeholder="INV"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:border-slate-400"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Debe coincidir con el segmento «cliente» del código maestro para enlazarlos.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mercado</label>
                <div className="grid grid-cols-2 gap-2">
                  {MARKETS.map((m) => {
                    const active = form.market_type === m.code;
                    return (
                      <button
                        key={m.code}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, market_type: m.code }))}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                        }`}
                      >
                        <m.icon size={15} /> {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-600">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {formError}
                </div>
              )}

              <button
                onClick={addCustomer}
                disabled={saving}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
                  saving ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                Agregar cliente
              </button>
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
            toast.kind === "error" ? "bg-rose-600" : "bg-slate-900"
          }`}
        >
          {toast.kind === "error" ? <X size={15} /> : <Check size={15} />}
          {toast.msg}
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar
        title="Catálogo de clientes"
        onRefresh={load}
        isRefreshing={loading}
        showStatus={!loading}
        isOnline={apiOnline}
      />
      {body}
    </div>
  );
}