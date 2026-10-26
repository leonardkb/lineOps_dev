import { useEffect, useMemo, useState } from "react";
import {
  Shirt,
  Plus,
  Send,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  Check,
  X,
  Users,
  Calculator,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  ClipboardList,
  ArrowRight,
  ImageOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../../lib/masterCodeCatalog";
import BomNavbar from "../../components/merchant/BomNavbar";
import StyleOrderWizard from "../../components/merchant/StyleOrderWizard";
import StyleCostingWizard from "../../components/merchant/StyleCostingWizard";
import { SendToSampleModal, ConvertToPreOrderModal, STYLE_STATUS } from "../../components/merchant/StyleActionModals";

// Style Data: every style lives here. Create a style (number → BOM → tallas →
// confección → colorway → imagen), complete it, and from then on send it to
// muestras, cost it, or convert it to a pre-order. Pre-orders then follow the
// existing "convertir a PO" flow.

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

const STATUS_META = STYLE_STATUS;

export default function BomDashboard() {
  const [view, setView] = useState("list"); // "list" | "client" | "wizard" | "costing"
  const [editingId, setEditingId] = useState(null); // null = new order
  const [presetCustomer, setPresetCustomer] = useState(""); // seeds the wizard when creating from a client card
  const [costingId, setCostingId] = useState(null); // style order being costed
  const [activeClient, setActiveClient] = useState(null); // client whose styles we're viewing

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState(null);
  const [sendFor, setSendFor] = useState(null); // order being sent to sample
  const [convertFor, setConvertFor] = useState(null); // order being converted to pre-order
  const navigate = useNavigate();

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/style-orders`, { headers: authHeaders() });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const data = await res.json();
      setOrders(data.orders || []);
      setOnline(true);
    } catch (err) {
      console.error(err);
      setOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const refresh = () => {
    setBusy(true);
    load().finally(() => setTimeout(() => setBusy(false), 400));
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return orders;
    return orders.filter((o) =>
      [o.styleCode, o.styleNo, o.orderNo, o.styleName, o.customerName, o.preOrderNo].filter(Boolean).join(" ").toLowerCase().includes(t)
    );
  }, [orders, q]);

  // Group the styles by client so the dashboard can lead with client cards.
  // The list of clients is derived from existing style orders; a brand-new
  // client is created on the fly by starting a style with that customer name.
  const clients = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const name = (o.customerName || "").trim() || "Sin cliente";
      const c = map.get(name) || { name, count: 0, latest: null, statuses: new Set() };
      c.count += 1;
      c.statuses.add(o.status);
      if (!c.latest || (o.updatedAt || "") > (c.latest || "")) c.latest = o.updatedAt;
      map.set(name, c);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [orders]);

  const clientOrders = useMemo(
    () => (activeClient ? orders.filter((o) => ((o.customerName || "").trim() || "Sin cliente") === activeClient) : []),
    [orders, activeClient]
  );

  // client card → start a style for that client (or a brand-new client name)
  const startStyleForClient = (name) => {
    setPresetCustomer(name);
    setEditingId(null);
    setView("wizard");
  };
  const openClient = (name) => { setActiveClient(name); setView("client"); };
  const addClient = () => {
    const name = window.prompt("Nombre del nuevo cliente")?.trim();
    if (name) startStyleForClient(name);
  };
  const openCosting = (o) => { setCostingId(o.id); setView("costing"); };

  const removeOrder = async (o) => {
    const extra = o.preOrderId ? `\n\nLa pre-orden ${o.preOrderNo || ""} NO se elimina.` : "";
    if (!window.confirm(`¿Eliminar el estilo ${o.styleCode || o.styleNo || o.id}?${extra}`)) return;
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${o.id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setOrders((os) => os.filter((x) => x.id !== o.id));
      showToast("Orden eliminada");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // where to go back after a sub-view closes (client view if we came from one)
  const backView = () => setView(activeClient ? "client" : "list");

  const modals = (
    <>
      {sendFor && (
        <SendToSampleModal
          order={sendFor}
          onClose={() => setSendFor(null)}
          onSent={() => { setSendFor(null); showToast("Enviado a muestras"); load(); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
      {convertFor && (
        <ConvertToPreOrderModal
          order={convertFor}
          onClose={() => { setConvertFor(null); load(); }}
          onConverted={(d) => showToast(`Pre-orden ${d.preOrderNo || ""} creada`)}
        />
      )}
    </>
  );

  // ---- wizard view --------------------------------------------------------
  if (view === "wizard") {
    return (
      <div className="min-h-screen bg-slate-100">
        <StyleOrderWizard
          orderId={editingId}
          presetCustomer={editingId ? "" : presetCustomer}
          onDone={() => { setPresetCustomer(""); setEditingId(null); backView(); load(); }}
          onAction={(action, row) => {
            if (action === "costing" && row?.id) { setEditingId(null); setCostingId(row.id); setView("costing"); }
          }}
        />
      </div>
    );
  }

  // ---- costing view -------------------------------------------------------
  if (view === "costing") {
    return (
      <div className="min-h-screen bg-slate-100">
        <StyleCostingWizard
          orderId={costingId}
          onDone={() => { setCostingId(null); backView(); load(); }}
        />
      </div>
    );
  }

  // ---- single-client view: that client's styles + create/cost actions -----
  if (view === "client") {
    return (
      <div className="min-h-screen bg-slate-100">
        <BomNavbar title="Datos de estilo" subtitle="Cliente · estilos y costeo" onRefresh={refresh} isRefreshing={busy} showStatus isOnline={online} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setActiveClient(null); setView("list"); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
            >
              <ChevronLeft size={16} /> Clientes
            </button>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                <span className="text-sm font-bold">{initials(activeClient)}</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-semibold text-slate-800 truncate">{activeClient}</h1>
                <p className="text-xs text-slate-500">{clientOrders.length} {clientOrders.length === 1 ? "estilo" : "estilos"}</p>
              </div>
            </div>
            <button
              onClick={() => startStyleForClient(activeClient)}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} /> Crear estilo
            </button>
          </div>

          <OrdersTable
            rows={clientOrders}
            loading={loading}
            emptyText={`Aún no hay estilos para ${activeClient}. Crea el primero con el botón de arriba.`}
            onEdit={(o) => { setEditingId(o.id); setView("wizard"); }}
            onCost={openCosting}
            onSend={setSendFor}
            onConvert={setConvertFor}
            onOpenPreOrder={(o) => navigate(`/nuevo-orden-wizard?preOrderId=${o.preOrderId}`)}
            onDelete={removeOrder}
          />
        </main>

        {modals}
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  // ---- list view ----------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-100">
      <BomNavbar
        title="Datos de estilo"
        subtitle="Crear estilo · muestras · costeo · pre-orden"
        onRefresh={refresh}
        isRefreshing={busy}
        showStatus
        isOnline={online}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por número de estilo, estilo del cliente, nombre o cliente"
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <button
            onClick={() => { setEditingId(null); setView("wizard"); }}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus size={16} /> Crear estilo
          </button>
        </div>

        {/* Clients — pick a client to create a style, or start a new client */}
        {!q.trim() && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Users size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Clientes</h2>
              <span className="text-xs text-slate-400">Selecciona un cliente para crear sus datos de estilo</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {clients.map((c) => (
                <ClientCard key={c.name} client={c} onOpen={() => openClient(c.name)} onCreate={() => startStyleForClient(c.name)} />
              ))}
              <button
                onClick={addClient}
                className="group flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-white px-4 py-5 text-slate-400 hover:border-slate-400 hover:text-slate-600"
              >
                <FolderPlus size={22} />
                <span className="text-xs font-medium">Nuevo cliente</span>
              </button>
            </div>
          </section>
        )}

        {/* All styles */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Shirt size={15} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">{q.trim() ? "Resultados" : "Todos los estilos"}</h2>
          </div>
          <OrdersTable
            rows={filtered}
            loading={loading}
            showClient
            emptyText={orders.length === 0
              ? "Aún no hay estilos. Elige un cliente arriba o crea el primero; puedes subir el tech pack para autocompletarlo."
              : "Ningún estilo coincide con la búsqueda."}
            onEdit={(o) => { setEditingId(o.id); setView("wizard"); }}
            onCost={openCosting}
            onSend={setSendFor}
            onConvert={setConvertFor}
            onOpenPreOrder={(o) => navigate(`/nuevo-orden-wizard?preOrderId=${o.preOrderId}`)}
            onDelete={removeOrder}
          />
        </section>
      </main>

      {modals}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

// ==========================================================================
//  Client card + shared styles table + toast
// ==========================================================================
const initials = (name) =>
  (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function ClientCard({ client, onOpen, onCreate }) {
  return (
    <div className="group relative rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition-all">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <span className="text-sm font-bold">{initials(client.name)}</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{client.name}</div>
            <div className="text-[11px] text-slate-400">{client.count} {client.count === 1 ? "estilo" : "estilos"}</div>
          </div>
        </div>
      </button>
      <button
        onClick={onCreate}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-900 hover:text-white transition-colors"
      >
        <Plus size={13} /> Crear estilo
      </button>
    </div>
  );
}

function OrdersTable({ rows, loading, emptyText, showClient, onEdit, onCost, onSend, onConvert, onOpenPreOrder, onDelete }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400">
          <RefreshCw size={22} className="animate-spin mx-auto mb-2" />
          Cargando estilos…
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400 px-6">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-2.5 font-medium">Estilo</th>
                <th className="px-5 py-2.5 font-medium">Nombre</th>
                {showClient && <th className="px-5 py-2.5 font-medium">Cliente</th>}
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((o) => {
                const st = STATUS_META[o.status] || STATUS_META.draft;
                const isDraft = o.status === "draft";
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <button onClick={() => onEdit(o)} className="flex items-center gap-3 text-left">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
                          {o.imageUrl ? <img src={o.imageUrl} alt="" className="h-full w-full object-cover" /> : <ImageOff size={15} />}
                        </span>
                        <span>
                          <span className="block font-mono text-sm font-bold tracking-wider text-slate-800">{o.styleCode || "—"}</span>
                          <span className="block font-mono text-[10px] text-slate-400">{o.styleNo || o.orderNo || ""}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-5 py-3 text-slate-700 max-w-xs truncate">{o.styleName || "—"}</td>
                    {showClient && <td className="px-5 py-3 text-slate-600">{o.customerName || "—"}</td>}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center text-[11px] rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                      {o.preOrderNo && <div className="mt-0.5 font-mono text-[10px] text-violet-600">{o.preOrderNo}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {isDraft ? (
                          <button
                            onClick={() => onEdit(o)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                          >
                            Continuar <ChevronRight size={13} />
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => onSend(o)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                            >
                              <Send size={13} /> Muestras
                            </button>
                            <button
                              onClick={() => onCost(o)}
                              title="Costeo del estilo"
                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                            >
                              <Calculator size={13} /> Costeo
                            </button>
                            {o.preOrderId ? (
                              <button
                                onClick={() => onOpenPreOrder(o)}
                                title={`Convertir ${o.preOrderNo || "la pre-orden"} a PO`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
                              >
                                A PO <ArrowRight size={13} />
                              </button>
                            ) : (
                              <button
                                onClick={() => onConvert(o)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
                              >
                                <ClipboardList size={13} /> Pre-orden
                              </button>
                            )}
                          </>
                        )}
                        <button onClick={() => onEdit(o)} title="Editar" className="p-1.5 text-slate-400 hover:text-slate-700">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => onDelete(o)} title="Eliminar" className="p-1.5 text-slate-300 hover:text-rose-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
        toast.kind === "error" ? "bg-rose-600" : "bg-slate-900"
      }`}
    >
      {toast.kind === "error" ? <X size={15} /> : <Check size={15} />}
      {toast.msg}
    </div>
  );
}