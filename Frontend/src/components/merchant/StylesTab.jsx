// components/merchant/StylesTab.jsx
//
// The "Estilos" tab of the merchant dashboard (and, standalone, the old
// Datos de estilo page).
//   <StylesTab embedded reloadToken={n} onOnline={fn} onCount={fn} />
//     embedded    → no navbar of its own; the create/edit wizard and the
//                   costing view open as a full-screen layer over the dashboard
//     reloadToken → bump it to refetch (dashboard "refresh" button)
//     onOnline    → API reachability, like the other tabs
//     onCount     → number of styles, for the tab badge / stat card
//     onOpenOrders(style, poNo?) → open the production-order tab filtered to
//                   the style's POs (or one PO). Without it, navigates to
//                   /merchant-dashboard?tab=po.
//
// Layout: a panel with two tabs —
//   Filtros      search + tipo / modelo / cliente / estado chips (same feel as
//                Códigos maestros)
//   Proveedores  one compact row per supplier: what it supplies (telas /
//                avíos / empaque counts) and which styles use it. "Ver estilos"
//                filters the list below; "Materiales" opens the full item list
//                in a side panel only when it's needed.
// → then the styles, as cards or a table. Proveedores come from the suppliers captured in each style's BOM
// (telas, avíos, empaque); spelling variants ("NIKE-APPROVED VENDOR" vs
// "NIKE APPROVED VENDOR") are merged.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Send, Pencil, Trash2, RefreshCw, Search, Check, X, Calculator, ChevronRight,
  ClipboardList, ArrowRight, ImageOff, Factory, ShoppingCart, MoreHorizontal, Copy, AlertTriangle, LayoutGrid, Table2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL, TIPOS, MODELOS, SEGMENTS } from "../../lib/masterCodeCatalog";
import BomNavbar from "./BomNavbar";
import StyleOrderWizard from "./StyleOrderWizard";
import StyleCostingWizard from "./StyleCostingWizard";
import { SendToSampleModal, ConvertToPreOrderModal, SendToPurchasingModal, STYLE_STATUS } from "./StyleActionModals";

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });
const STATUS_META = STYLE_STATUS;
const STATUS_ORDER = ["draft", "completed", "sent_to_sample", "approved", "pre_order", "in_production", "archived"];
const EMPTY_FILTERS = { q: "", tipo: "", modelo: "", cliente: "", status: "", supplier: "" };

const segColor = (key) => SEGMENTS?.find?.((s) => s.key === key)?.color || "text-slate-800";
const norm = (v) => String(v || "").trim().toLowerCase();
// Supplier identity: case, accents, spaces and punctuation don't matter, so
// "NIKE-APPROVED VENDOR", "Nike approved vendor" and "NIKE APPROVED VENDOR"
// are one supplier.
const supplierKey = (v) =>
  String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export default function StylesTab({ embedded = false, reloadToken = 0, onOnline, onCount, onOpenOrders }) {
  const [view, setView] = useState("list"); // "list" | "wizard" | "costing"
  const [layout, setLayout] = useState("table"); // "grid" | "table"
  const [editingId, setEditingId] = useState(null); // null = new style
  const [copyFromId, setCopyFromId] = useState(null); // new style based on this one
  const [costingId, setCostingId] = useState(null);

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [panelTab, setPanelTab] = useState("filtros"); // "filtros" | "proveedores"
  const [supplierQ, setSupplierQ] = useState("");
  const [supplierSort, setSupplierSort] = useState("styles"); // "styles" | "materials" | "name"
  const [materialsOf, setMaterialsOf] = useState(null);       // supplier key whose materials panel is open
  const [toast, setToast] = useState(null);
  const [sendFor, setSendFor] = useState(null);
  const [convertFor, setConvertFor] = useState(null);
  const [purchaseFor, setPurchaseFor] = useState(null); // style whose BOM goes to compras
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
      onOnline?.(true);
      onCount?.((data.orders || []).length);
    } catch (err) {
      console.error(err);
      setOnline(false);
      onOnline?.(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadToken]);

  const refresh = () => {
    setBusy(true);
    load().finally(() => setTimeout(() => setBusy(false), 400));
  };

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: f[k] === v ? "" : v })); // tap again to clear
  const activeCount = Object.entries(filters).filter(([, v]) => v).length;

  // Everything except the supplier filter — the supplier cards count against
  // this, so they reflect the tipo / cliente / estado currently picked.
  const matchesBase = (o, f) => {
    if (f.tipo && o.tipo !== f.tipo) return false;
    if (f.modelo && o.modelo !== f.modelo) return false;
    if (f.cliente && norm(o.customerName) !== norm(f.cliente)) return false;
    if (f.status && o.status !== f.status) return false;
    const t = norm(f.q);
    if (t) {
      const hay = [o.styleCode, o.styleNo, o.orderNo, o.styleName, o.customerName, o.preOrderNo,
        ...(o.purchaseRequests || []).map((p) => p.no),
        ...(o.suppliers || []).map((s) => s.name), ...(o.workOrders || []).map((w) => w.no)]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  };
  const baseFiltered = useMemo(() => orders.filter((o) => matchesBase(o, filters)), [orders, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(
    () => (filters.supplier ? baseFiltered.filter((o) => (o.suppliers || []).some((s) => supplierKey(s.name) === filters.supplier)) : baseFiltered),
    [baseFiltered, filters.supplier]
  );

  // Suppliers from the BOM of each style (telas · avíos · empaque).
  const suppliers = useMemo(() => {
    const map = new Map();
    for (const o of baseFiltered) {
      const styleLabel = o.styleCode || o.styleNo || `#${o.id}`;
      for (const s of o.suppliers || []) {
        const k = supplierKey(s.name);
        if (!k) continue;
        const e = map.get(k) || { key: k, names: new Map(), styleIds: new Set(), styleLabels: new Set(), fabric: 0, trim: 0, packaging: 0, items: new Map() };
        e.styleIds.add(o.id);
        e.styleLabels.add(styleLabel);              // a style counts once even if it spells the supplier two ways
        const n = s.name.trim();
        e.names.set(n, (e.names.get(n) || 0) + (s.fabric || 0) + (s.trim || 0) + (s.packaging || 0) + 1);
        e.fabric += s.fabric || 0;
        e.trim += s.trim || 0;
        e.packaging += s.packaging || 0;
        // the same item (kind + code + name) across styles is listed once,
        // with the styles that use it
        for (const it of s.items || []) {
          const ik = `${it.kind}|${norm(it.code)}|${norm(it.name)}`;
          const cur = e.items.get(ik) || { key: ik, kind: it.kind, code: it.code || "", name: it.name || "", unit: it.unit || "", qtys: new Set(), styles: new Set() };
          cur.styles.add(styleLabel);
          cur.qtys.add(`${it.qty || ""} ${it.unit || ""}`.trim());
          e.items.set(ik, cur);
        }
        map.set(k, e);
      }
    }
    const kindRank = { fabric: 0, trim: 1, packaging: 2 };
    return [...map.values()]
      .map((e) => ({
        key: e.key,
        // show the spelling used most often
        name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
        variants: [...e.names.keys()],
        styles: e.styleIds.size,
        styleLabels: [...e.styleLabels].sort(),
        fabric: e.fabric, trim: e.trim, packaging: e.packaging,
        items: [...e.items.values()]
          // consumption is per style: show it only when every style agrees
          .map(({ qtys, ...it }) => ({ ...it, styles: [...it.styles].sort(), qtyLabel: qtys.size === 1 ? [...qtys][0] : qtys.size > 1 ? "varía" : "" }))
          .sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9) || (a.code || a.name).localeCompare(b.code || b.name, "es")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [baseFiltered]);
  const visibleSuppliers = useMemo(() => {
    const t = supplierKey(supplierQ);
    const xs = t
      ? suppliers.filter((s) => supplierKey(s.name).includes(t) || s.items.some((it) => supplierKey(`${it.code} ${it.name}`).includes(t)))
      : suppliers;
    const byName = (a, b) => a.name.localeCompare(b.name, "es");
    const sorters = {
      name: byName,
      styles: (a, b) => b.styles - a.styles || byName(a, b),
      materials: (a, b) => b.items.length - a.items.length || byName(a, b),
    };
    return [...xs].sort(sorters[supplierSort] || byName);
  }, [suppliers, supplierQ, supplierSort]);
  const materialsSupplier = materialsOf ? suppliers.find((s) => s.key === materialsOf) : null;
  const activeSupplier = filters.supplier ? (suppliers.find((s) => s.key === filters.supplier)?.name || filters.supplier) : "";

  // chip options: all tipos / modelos (like Códigos maestros), clients and
  // statuses from the styles that exist
  const clientes = useMemo(
    () => [...new Map(orders.filter((o) => o.customerName).map((o) => [norm(o.customerName), o.customerName.trim()])).values()].sort(),
    [orders]
  );
  const statuses = useMemo(() => STATUS_ORDER.filter((s) => orders.some((o) => o.status === s)), [orders]);

  const newStyle = () => { setEditingId(null); setCopyFromId(null); setView("wizard"); };
  const editStyle = (o) => { setEditingId(o.id); setCopyFromId(null); setView("wizard"); };
  const copyStyle = (o) => { setEditingId(null); setCopyFromId(o.id); setView("wizard"); };
  const openCosting = (o) => { setCostingId(o.id); setView("costing"); };

  const removeOrder = async (o) => {
    const extra = o.preOrderId ? `\n\nLa pre-orden ${o.preOrderNo || ""} NO se elimina.` : "";
    if (!window.confirm(`¿Eliminar el estilo ${o.styleCode || o.styleNo || o.id}?${extra}`)) return;
    try {
      const res = await fetch(`${API_URL}/api/style-orders/${o.id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setOrders((os) => os.filter((x) => x.id !== o.id));
      onCount?.(orders.length - 1);
      showToast("Estilo eliminado");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const actions = {
    onEdit: editStyle,
    onCost: openCosting,
    onSend: setSendFor,
    onConvert: setConvertFor,
    onOpenPreOrder: (o) => navigate(`/nuevo-orden-wizard?preOrderId=${o.preOrderId}`),
    onOpenOrders: (o, poNo) => {
      if (onOpenOrders) onOpenOrders(o, poNo);
      else window.location.href = "/merchant-dashboard?tab=po";
    },
    onPurchase: setPurchaseFor,
    onCopy: copyStyle,
    onDelete: removeOrder,
  };

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
      {purchaseFor && (
        <SendToPurchasingModal
          styleId={purchaseFor.id}
          onClose={() => { setPurchaseFor(null); load(); }}
          onSent={(d) => showToast(`${d.requestNo} enviada a compras`)}
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

  // Wizard / costing: a full page standalone, a full-screen layer when embedded.
  const fullView = embedded ? "fixed inset-0 z-40 overflow-y-auto bg-slate-100" : "min-h-screen bg-slate-100";

  if (view === "wizard") {
    return (
      <div className={fullView}>
        <StyleOrderWizard
          key={editingId ? `e${editingId}` : copyFromId ? `c${copyFromId}` : "new"}
          orderId={editingId}
          copyFromId={copyFromId}
          onDone={() => { setEditingId(null); setCopyFromId(null); setView("list"); load(); }}
          onAction={(action, row) => {
            if (action === "costing" && row?.id) { setEditingId(null); setCostingId(row.id); setView("costing"); }
            if (action === "purchase" && row?.id) { setPurchaseFor(row); }
            if (action === "orders" && row) { setEditingId(null); setView("list"); load(); actions.onOpenOrders(row); }
          }}
        />
      </div>
    );
  }

  if (view === "costing") {
    return (
      <div className={fullView}>
        <StyleCostingWizard orderId={costingId} onDone={() => { setCostingId(null); setView("list"); load(); }} />
      </div>
    );
  }

  // ---- list ----------------------------------------------------------------
  const body = (
    <>
      {/* Panel: Filtros | Proveedores */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 pt-3">
          <div role="tablist" className="flex gap-1">
            {[
              ["filtros", "Filtros", activeCount - (filters.supplier ? 1 : 0)],
              ["proveedores", "Proveedores", suppliers.length],
            ].map(([id, label, n]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={panelTab === id}
                onClick={() => setPanelTab(id)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold transition-colors ${
                  panelTab === id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-700"
                }`}
              >
                {label}
                {n > 0 && (
                  <span className={`rounded-full px-1.5 text-[11px] ${panelTab === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{n}</span>
                )}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 pb-2">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
              {[["grid", LayoutGrid, "Tarjetas"], ["table", Table2, "Tabla"]].map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayout(id)}
                  title={label}
                  aria-label={label}
                  className={`rounded-md p-1.5 ${layout === id ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"}`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
            <button
              onClick={newStyle}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Plus size={16} /> Crear estilo
            </button>
          </div>
        </div>

        {panelTab === "filtros" ? (
          <div className="space-y-4 p-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Buscar por número de estilo, estilo del cliente, nombre, cliente o proveedor…"
                className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-500"
              />
            </div>
            <ChipRow label="Tipo" options={TIPOS.map((t) => ({ value: t.code, code: t.code, text: t.label }))} value={filters.tipo} onPick={(v) => setFilter("tipo", v)} />
            <ChipRow label="Modelo" options={MODELOS.map((m) => ({ value: m.code, code: m.code, text: m.label }))} value={filters.modelo} onPick={(v) => setFilter("modelo", v)} />
            {clientes.length > 0 && (
              <ChipRow label="Cliente" options={clientes.map((c) => ({ value: c, code: c }))} value={filters.cliente} onPick={(v) => setFilter("cliente", v)} />
            )}
            {statuses.length > 1 && (
              <ChipRow label="Estado" options={statuses.map((s) => ({ value: s, text: STATUS_META[s]?.label || s }))} value={filters.status} onPick={(v) => setFilter("status", v)} />
            )}
            {activeSupplier && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                Proveedor:
                <button onClick={() => setFilter("supplier", filters.supplier)} className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 font-medium text-white">
                  {activeSupplier} <X size={12} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={supplierQ}
                  onChange={(e) => setSupplierQ(e.target.value)}
                  placeholder="Buscar proveedor, código o material…"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm outline-none focus:border-slate-500"
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Ordenar
                <select value={supplierSort} onChange={(e) => setSupplierSort(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700 outline-none focus:border-slate-500">
                  <option value="styles">Más estilos</option>
                  <option value="materials">Más materiales</option>
                  <option value="name">Nombre A–Z</option>
                </select>
              </label>
            </div>
            {activeCount - (filters.supplier ? 1 : 0) > 0 && (
              <p className="text-[11px] text-slate-400">Solo proveedores de los estilos que pasan los filtros activos.</p>
            )}
            {suppliers.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                {orders.length
                  ? "Ningún estilo tiene proveedor capturado. Escríbelo en las líneas de telas, avíos o empaque del BOM y aparecerá aquí."
                  : "Los proveedores aparecen aquí cuando capturas el BOM de un estilo."}
              </div>
            ) : visibleSuppliers.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Ningún proveedor coincide con «{supplierQ}».</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                <li aria-hidden className="hidden px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[2.5rem_minmax(10rem,1.3fr)_minmax(9rem,1fr)_minmax(9rem,1.2fr)_auto] sm:gap-x-3">
                  <span /><span>Proveedor</span><span>Suministra</span><span>Estilos</span><span className="w-[11.5rem]" />
                </li>
                {visibleSuppliers.map((s) => (
                  <SupplierRow
                    key={s.key}
                    supplier={s}
                    active={filters.supplier === s.key}
                    onToggle={() => setFilter("supplier", s.key)}
                    onMaterials={() => setMaterialsOf(s.key)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>


      {materialsSupplier && (
        <SupplierMaterialsPanel
          supplier={materialsSupplier}
          active={filters.supplier === materialsSupplier.key}
          onFilter={() => { setFilter("supplier", materialsSupplier.key); setMaterialsOf(null); }}
          onClose={() => setMaterialsOf(null)}
        />
      )}

      {/* Styles */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            {activeSupplier ? `Estilos con ${activeSupplier}` : activeCount ? "Resultados" : "Todos los estilos"}
          </h2>
          <span className="text-xs text-slate-400">{filtered.length} de {orders.length}</span>
          {activeCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
              <X size={12} /> Limpiar filtros
            </button>
          )}
        </div>

        {loading && orders.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-20 text-center text-sm text-slate-400">
            <RefreshCw size={22} className="animate-spin mx-auto mb-2" /> Cargando estilos…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-16 px-6 text-center text-sm text-slate-400">
            {orders.length === 0
              ? "Aún no hay estilos. Crea el primero con «Crear estilo»; puedes subir el tech pack para autocompletarlo."
              : "Ningún estilo coincide con los filtros."}
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((o) => <StyleCard key={o.id} o={o} {...actions} />)}
          </div>
        ) : (
          <StylesTable rows={filtered} {...actions} />
        )}
      </section>

      {modals}
      {toast && <Toast toast={toast} />}
    </>
  );

  return embedded ? (
    <div className="space-y-5">{body}</div>
  ) : (
    <div className="min-h-screen bg-slate-100">
      <BomNavbar title="Estilos" subtitle="Crear estilo · muestras · costeo · pre-orden" onRefresh={refresh} isRefreshing={busy} showStatus isOnline={online} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">{body}</main>
    </div>
  );
}

// ==========================================================================
//  Pieces
// ==========================================================================
function ChipRow({ label, hint, options, value, onPick, more }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              aria-pressed={active}
              title={o.title}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"
              }`}
            >
              {o.code && <span className={`font-mono font-bold ${active ? "" : "text-slate-700"}`}>{o.code}</span>}
              {o.text && <span>{o.text}</span>}
              {o.count != null && (
                <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{o.count}</span>
              )}
            </button>
          );
        })}
        {more && (
          <button type="button" onClick={more.toggle} className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800">
            {more.open ? "Ver menos" : `Ver todos (${more.total})`}
          </button>
        )}
      </div>
    </div>
  );
}

const KIND = {
  fabric: { label: "Tela", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  trim: { label: "Avío", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  packaging: { label: "Empaque", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};
const initials = (name) =>
  (String(name || "").match(/[A-Za-zÀ-ÿ0-9]+/g) || ["?"]).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Imported tech-pack names come with noise like "*** A0069494 PM#069494__ …";
// show them cleaned (the full text stays in the tooltip).
const cleanName = (n) => String(n || "").replace(/^[\s*#\-_]+/, "").replace(/_{2,}/g, " ").replace(/\s{2,}/g, " ").trim();

function KindCounts({ s, size = "sm" }) {
  const parts = [
    ["fabric", s.fabric, "tela", "telas"],
    ["trim", s.trim, "avío", "avíos"],
    ["packaging", s.packaging, "empaque", "empaques"],
  ].filter(([, n]) => n > 0);
  if (!parts.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map(([k, n, one, many]) => (
        <span key={k} className={`rounded-md border px-1.5 ${size === "sm" ? "py-0.5 text-[11px]" : "py-1 text-xs"} ${KIND[k].cls}`}>
          {plural(n, one, many)}
        </span>
      ))}
    </span>
  );
}

function SupplierRow({ supplier: s, active, onToggle, onMaterials }) {
  const shown = s.styleLabels.slice(0, 4);
  return (
    <li className={`grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[2.5rem_minmax(10rem,1.3fr)_minmax(9rem,1fr)_minmax(9rem,1.2fr)_auto] ${active ? "bg-slate-50" : ""}`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
        {initials(s.name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-800" title={s.variants.join("\n")}>{s.name}</div>
        <div className="text-[11px] text-slate-500">
          {plural(s.styles, "estilo", "estilos")} · {plural(s.items.length, "material", "materiales")}
          {s.variants.length > 1 && <span className="text-slate-400" title={s.variants.join("\n")}> · {s.variants.length} formas de escribirlo</span>}
        </div>
      </div>
      <div className="col-start-2 sm:col-start-auto"><KindCounts s={s} /></div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-start-auto" title={s.styleLabels.join(", ")}>
        {shown.map((l) => (
          <span key={l} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{l}</span>
        ))}
        {s.styleLabels.length > shown.length && <span className="text-[10px] text-slate-400">+{s.styleLabels.length - shown.length}</span>}
      </div>
      <div className="col-start-2 flex items-center gap-1.5 sm:col-start-auto sm:justify-end">
        <button type="button" onClick={onMaterials}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-400">
          Materiales
        </button>
        <button type="button" onClick={onToggle}
          className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${active ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
          {active ? "Quitar filtro" : "Ver estilos"}
        </button>
      </div>
    </li>
  );
}

// Side panel with the supplier's materials — only when asked for.
function SupplierMaterialsPanel({ supplier: s, active, onFilter, onClose }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const t = norm(q);
  const items = t ? s.items.filter((it) => [it.code, it.name, ...it.styles].join(" ").toLowerCase().includes(t)) : s.items;
  const groups = ["fabric", "trim", "packaging"].map((k) => [k, items.filter((it) => it.kind === k)]).filter(([, xs]) => xs.length);
  const groupLabel = { fabric: "Telas", trim: "Avíos", packaging: "Empaque" };
  // A catalog code is one specific item. Several different materials under the
  // same code (typical after a tech-pack import) would merge into one line for
  // compras — point it out.
  const sharedCodes = useMemo(() => {
    const byCode = new Map();
    for (const it of s.items) {
      if (!it.code) continue;
      const names = byCode.get(it.code) || new Set();
      names.add(norm(it.name));
      byCode.set(it.code, names);
    }
    return [...byCode].filter(([, names]) => names.size > 1).map(([code, names]) => ({ code, n: names.size }));
  }, [s]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Materiales de ${s.name}`}>
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700">{initials(s.name)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-slate-800">{s.name}</h2>
            <p className="text-xs text-slate-500">{plural(s.styles, "estilo", "estilos")} · {plural(s.items.length, "material", "materiales")}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, material o estilo…"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {sharedCodes.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {sharedCodes.map((c) => `${c.n} materiales distintos usan el código ${c.code}`).join(" · ")}.
                Cada material debería tener su propio código de catálogo; si no, compras los verá como uno solo.
                Corrígelo en el BOM del estilo.
              </span>
            </div>
          )}
          {groups.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nada coincide con «{q}».</p>}
          {groups.map(([k, xs]) => (
            <div key={k} className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`rounded border px-1.5 text-[10px] ${KIND[k].cls}`}>{groupLabel[k]}</span>
                <span className="text-[11px] text-slate-400">{xs.length}</span>
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {xs.map((it) => (
                  <li key={it.key} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {it.code && <span className="shrink-0 font-mono text-xs font-semibold text-slate-800">{it.code}</span>}
                        <span className="truncate text-xs text-slate-600" title={it.name}>{cleanName(it.name) || "—"}</span>
                      </div>
                      <div className="truncate text-[10px] text-slate-400" title={it.styles.join(", ")}>{it.styles.join(", ")}</div>
                    </div>
                    {it.qtyLabel && <span className="shrink-0 font-mono text-[10px] text-slate-400">{it.qtyLabel}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400">Cerrar</button>
          <button onClick={onFilter} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            {active ? "Quitar filtro" : "Ver sus estilos"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function StyleNumber({ o, size = "text-sm" }) {
  if (!o.tipo || !o.modelo || !o.correlativo) {
    return <span className={`font-mono font-bold tracking-wider text-slate-400 ${size}`}>{o.styleCode || "Sin número"}</span>;
  }
  return (
    <span className={`font-mono font-bold tracking-wider ${size}`}>
      <span className={segColor("tipo")}>{o.tipo}</span>
      <span className={segColor("modelo")}>{o.modelo}</span>
      <span className={segColor("correlativo")}>{o.correlativo}</span>
    </span>
  );
}

function Thumb({ o, className }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden bg-slate-50 text-slate-300 ${className}`}>
      {o.imageUrl ? <img src={o.imageUrl} alt="" className="h-full w-full object-cover" /> : <ImageOff size={16} />}
    </span>
  );
}

const PRE_STATUS = {
  pending: "Pre-orden pendiente de convertir",
  partially_converted: "Pre-orden convertida en parte — queda resto por convertir",
  converted: "Pre-orden convertida a PO",
  cancelled: "Pre-orden cancelada",
};
const PR_STATUS = { sent: "Enviada", in_progress: "En proceso", ordered: "Pedida al proveedor", received: "Recibida", cancelled: "Cancelada" };
const PO_STATUS = {
  pending: { label: "Pendiente", cls: "border-slate-200 bg-slate-50 text-slate-600" },
  assigned: { label: "Asignada", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  in_progress: { label: "En proceso", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  completed: { label: "Terminada", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
};

// The production orders converted from this style. Each chip opens that PO in
// the Órdenes de producción tab.
function WorkOrderChips({ o, max = 2, onOpenOrders }) {
  const wos = o.workOrders || [];
  if (!wos.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {wos.slice(0, max).map((w) => {
        const st = PO_STATUS[w.status] || PO_STATUS.pending;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onOpenOrders(o, w.no)}
            title={[w.no, st.label, w.color, w.quantity ? `${w.quantity.toLocaleString("es-MX")} pzs` : ""].filter(Boolean).join(" · ")}
            className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] hover:brightness-95 ${st.cls}`}
          >
            {/* SKM0031-MAL-DAMCHA06 → SKM0031: the rest repeats the style */}
            {String(w.no).split("-")[0]}
          </button>
        );
      })}
      {wos.length > max && (
        <button type="button" onClick={() => onOpenOrders(o)} className="text-[10px] text-slate-500 hover:text-slate-800">
          +{wos.length - max}
        </button>
      )}
      {(o.purchaseRequests || []).filter((p) => p.status !== "cancelled").map((p) => (
        <span key={p.id} title={`Solicitud de compra · ${PR_STATUS[p.status] || p.status}`}
          className="inline-flex items-center gap-0.5 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-teal-700">
          <ShoppingCart size={10} /> {p.no}
        </span>
      ))}
    </span>
  );
}

// ==========================================================================
//  Lifecycle: where a style is, and what it needs next
// ==========================================================================
// Steps: Estilo → Muestras → Pre-orden → Producción → Compras.
// Each is "done", "partial" (pre-order converted in part / some POs not yet
// sent to compras) or "todo". The first one that isn't done is "current".
const PAST_SAMPLE = ["sent_to_sample", "approved", "pre_order", "in_production"];

function lifecycle(o) {
  const wos = o.workOrders || [];
  const sentIds = new Set((o.purchaseRequests || []).filter((p) => p.status !== "cancelled").flatMap((p) => p.workOrderIds));
  const unsent = wos.filter((w) => !sentIds.has(w.id)).length;
  const preOpen = !!o.preOrderId && !["converted", "cancelled"].includes(o.preOrderStatus);
  const isDraft = o.status === "draft";
  const steps = [
    { key: "estilo", label: "Estilo", state: isDraft ? "todo" : "done" },
    { key: "muestras", label: "Muestras", state: PAST_SAMPLE.includes(o.status) || o.preOrderId || wos.length ? "done" : "todo" },
    { key: "pre", label: "Pre-orden", state: o.preOrderId || wos.length ? "done" : "todo" },
    { key: "po", label: "Producción", state: wos.length ? (o.preOrderStatus === "partially_converted" ? "partial" : "done") : "todo" },
    { key: "compras", label: "Compras", state: !wos.length ? "todo" : unsent === 0 ? "done" : unsent < wos.length ? "partial" : "todo" },
  ];
  const current = steps.findIndex((st) => st.state !== "done");

  // one-line summary of where it stands
  let label;
  if (isDraft) label = "Borrador";
  else if (o.status === "archived") label = "Archivado";
  else if (!wos.length && preOpen) label = "Pre-orden por convertir";
  else if (!wos.length && !o.preOrderId) label = PAST_SAMPLE.includes(o.status) ? "En muestras" : "Estilo completo";
  else if (wos.length && unsent) label = `${`${wos.length} PO`} · ${unsent} sin compras`;
  else if (wos.length) label = `${`${wos.length} PO`} · en compras`;
  else label = (STATUS_META[o.status] || STATUS_META.draft).label;

  return { steps, current, label, wos, unsent, preOpen, isDraft };
}

function ProgressTrack({ o }) {
  const { steps, current, label } = lifecycle(o);
  const tone = { done: "bg-emerald-500", partial: "bg-amber-400", todo: "bg-slate-200" };
  return (
    <div className="min-w-[10.5rem]">
      <div className="flex gap-1" role="img"
        aria-label={steps.map((st) => `${st.label}: ${st.state === "done" ? "hecho" : st.state === "partial" ? "en parte" : "pendiente"}`).join(", ")}>
        {steps.map((st, i) => (
          <span
            key={st.key}
            title={`${st.label} · ${st.state === "done" ? "hecho" : st.state === "partial" ? "en parte" : "pendiente"}`}
            className={`h-1.5 flex-1 rounded-full ${tone[st.state]} ${i === current ? "ring-2 ring-offset-1 ring-slate-300" : ""}`}
          />
        ))}
      </div>
      <div className="mt-1.5 whitespace-nowrap text-xs text-slate-700">{label}</div>
      <div className="text-[10px] text-slate-400">
        {current === -1 ? "Completo" : `Sigue: ${steps[current].label}`}
        {o.preOrderNo && <span className="ml-1 font-mono text-violet-500" title={PRE_STATUS[o.preOrderStatus] || ""}>{o.preOrderNo}</span>}
      </div>
    </div>
  );
}

// The single action a style needs now. Everything else lives in the ⋯ menu.
function nextAction(o, a) {
  const { wos, unsent, preOpen, isDraft } = lifecycle(o);
  if (o.status === "archived") return null;
  if (isDraft) return { label: "Continuar", icon: ChevronRight, tone: "slate", run: () => a.onEdit(o), trailing: true };
  if (o.preOrderStatus === "partially_converted" && preOpen) return { label: "Resto a PO", icon: ArrowRight, tone: "violet", run: () => a.onOpenPreOrder(o), trailing: true };
  if (wos.length && unsent) return { label: "Enviar a compras", icon: ShoppingCart, tone: "teal", run: () => a.onPurchase(o) };
  if (wos.length) return { label: "Ver órdenes", icon: Factory, tone: "sky", run: () => a.onOpenOrders(o) };
  if (preOpen) return { label: "Convertir a PO", icon: ArrowRight, tone: "violet", run: () => a.onOpenPreOrder(o), trailing: true };
  if (!PAST_SAMPLE.includes(o.status)) return { label: "Enviar a muestras", icon: Send, tone: "emerald", run: () => a.onSend(o) };
  return { label: "Crear pre-orden", icon: ClipboardList, tone: "violet", run: () => a.onConvert(o) };
}

// Every action that applies, for the ⋯ menu (the primary one included, so the
// menu is a complete, predictable list).
function menuItems(o, a) {
  const { wos, unsent, preOpen, isDraft } = lifecycle(o);
  const items = [{ label: isDraft ? "Continuar edición" : "Abrir / editar", icon: Pencil, run: () => a.onEdit(o) }];
  if (!isDraft) {
    items.push({ label: "Enviar a muestras", icon: Send, run: () => a.onSend(o) });
    items.push({ label: "Costeo del estilo", icon: Calculator, run: () => a.onCost(o) });
    if (preOpen) items.push({ label: o.preOrderStatus === "partially_converted" ? `Convertir el resto de ${o.preOrderNo || "la pre-orden"}` : `Convertir ${o.preOrderNo || "pre-orden"} a PO`, icon: ArrowRight, run: () => a.onOpenPreOrder(o) });
    else if (!o.preOrderId && !wos.length) items.push({ label: "Crear pre-orden", icon: ClipboardList, run: () => a.onConvert(o) });
    if (wos.length) {
      items.push({ label: unsent ? `Enviar BOM a compras (${unsent} PO)` : "Reenviar a compras", icon: ShoppingCart, run: () => a.onPurchase(o) });
      items.push({ label: `Ver órdenes (${wos.length})`, icon: Factory, run: () => a.onOpenOrders(o) });
    }
  }
  items.push({ divider: true });
  items.push({ label: "Usar como base para un estilo nuevo", icon: Copy, run: () => a.onCopy(o) });
  items.push({ divider: true });
  items.push({ label: "Eliminar estilo", icon: Trash2, danger: true, run: () => a.onDelete(o) });
  return items;
}

const TONE_BTN = {
  slate: "bg-slate-900 text-white hover:bg-slate-700",
  violet: "bg-violet-600 text-white hover:bg-violet-700",
  teal: "bg-teal-600 text-white hover:bg-teal-700",
  sky: "border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100",
  emerald: "bg-emerald-600 text-white hover:bg-emerald-700",
};

function PrimaryAction({ o, actions, block }) {
  const act = nextAction(o, actions);
  if (!act) return null;
  const Icon = act.icon;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); act.run(); }}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${TONE_BTN[act.tone]} ${block ? "w-full" : ""}`}
    >
      {!act.trailing && <Icon size={14} />} {act.label} {act.trailing && <Icon size={14} />}
    </button>
  );
}

// ⋯ menu. Fixed-positioned from the button's rect so the table's horizontal
// scroll container can't clip it; flips upward near the bottom of the screen.
function ActionMenu({ items }) {
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return;
      if (e.type === "mousedown" && (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target))) return;
      setPos(null);
    };
    const onScroll = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pos]);

  const toggle = (e) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btnRef.current.getBoundingClientRect();
    const estHeight = items.length * 36 + 16;
    const up = r.bottom + estHeight > window.innerHeight - 8;
    setPos({ right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title="Más acciones"
        className={`rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 ${pos ? "bg-slate-100 text-slate-800" : ""}`}
      >
        <MoreHorizontal size={18} />
      </button>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", ...pos }}
          className="z-50 w-72 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 border-t border-slate-100" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                onClick={() => { setPos(null); it.run(); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none focus:bg-slate-50 ${
                  it.danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <it.icon size={15} className={it.danger ? "" : "text-slate-400"} />
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </>
  );
}

const supplierNames = (o) => (o.suppliers || []).map((s) => s.name);

function SupplierSummary({ o }) {
  const sup = supplierNames(o);
  if (!sup.length) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-1" title={sup.join("\n")}>
      <span className="truncate">{sup[0]}</span>
      {sup.length > 1 && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">+{sup.length - 1}</span>}
    </span>
  );
}

function StyleCard({ o, ...actions }) {
  return (
    <div
      onClick={() => actions.onEdit(o)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex gap-3 p-3">
        <Thumb o={o} className="h-20 w-16 rounded-lg border border-slate-200" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <StyleNumber o={o} />
              <p className="truncate text-xs text-slate-600">{o.styleName || "—"}</p>
              <p className="truncate text-[11px] text-slate-400">
                {[o.customerName, o.styleNo].filter(Boolean).join(" · ") || "\u00a0"}
              </p>
            </div>
            <ActionMenu items={menuItems(o, actions)} />
          </div>
          <div className="mt-2"><ProgressTrack o={o} /></div>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1 text-[11px] text-slate-500">
          {(o.workOrders || []).length ? <WorkOrderChips o={o} max={3} onOpenOrders={actions.onOpenOrders} /> : <SupplierSummary o={o} />}
        </div>
        <PrimaryAction o={o} actions={actions} />
      </div>
    </div>
  );
}

function StylesTable({ rows, ...actions }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2.5 font-medium">Estilo</th>
              <th className="px-4 py-2.5 font-medium">Cliente</th>
              <th className="px-4 py-2.5 font-medium">Proveedores</th>
              <th className="px-4 py-2.5 font-medium">Avance</th>
              <th className="px-4 py-2.5 font-medium">Órdenes</th>
              <th className="px-4 py-2.5 text-right font-medium">Siguiente paso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((o) => (
              <tr key={o.id} onClick={() => actions.onEdit(o)} className="cursor-pointer align-middle hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex min-w-[15rem] items-center gap-3">
                    <Thumb o={o} className="h-12 w-12 rounded-lg border border-slate-200" />
                    <div className="min-w-0">
                      <button type="button" onClick={(e) => { e.stopPropagation(); actions.onEdit(o); }} className="text-left focus:outline-none focus-visible:underline">
                        <StyleNumber o={o} />
                      </button>
                      <div className="max-w-[16rem] truncate text-xs text-slate-600" title={o.styleName}>{o.styleName || "—"}</div>
                      {o.styleNo && <div className="font-mono text-[10px] text-slate-400">{o.styleNo}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{o.customerName || "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-[12rem]"><SupplierSummary o={o} /></td>
                <td className="px-4 py-3"><ProgressTrack o={o} /></td>
                <td className="px-4 py-3"><WorkOrderChips o={o} onOpenOrders={actions.onOpenOrders} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <PrimaryAction o={o} actions={actions} />
                    <ActionMenu items={menuItems(o, actions)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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