import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Layers,
  Plus,
  Trash2,
  Save,
  Search,
  X,
  Package,
  Shirt,
  AlertCircle,
  Check,
  RefreshCw,
  Copy,
  FileText,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

// ------------------------------------------------------------------
//  Reference data
// ------------------------------------------------------------------

// Material categories. `unit` is the sensible default unit for a new line of
// that category; the merchant can still change it per line.
const CATEGORIES = [
  { code: "tela", label: "Tela", unit: "m", tint: "bg-sky-100 text-sky-700 border-sky-200" },
  { code: "avio", label: "Avío", unit: "pza", tint: "bg-violet-100 text-violet-700 border-violet-200" },
  { code: "hilo", label: "Hilo", unit: "cono", tint: "bg-amber-100 text-amber-700 border-amber-200" },
  { code: "etiqueta", label: "Etiqueta", unit: "pza", tint: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { code: "empaque", label: "Empaque", unit: "pza", tint: "bg-rose-100 text-rose-700 border-rose-200" },
  { code: "otro", label: "Otro", unit: "pza", tint: "bg-slate-100 text-slate-600 border-slate-200" },
];
const CAT_BY_CODE = Object.fromEntries(CATEGORIES.map((c) => [c.code, c]));

const UNITS = ["m", "cm", "yd", "kg", "g", "pza", "par", "cono", "rollo", "juego", "ml", "l"];
const STATUSES = [
  { code: "draft", label: "Borrador" },
  { code: "active", label: "Activa" },
  { code: "archived", label: "Archivada" },
];
const CURRENCIES = ["MXN", "USD", "EUR"];

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem("token")}`,
  "Content-Type": "application/json",
});

const money = (n, cur = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: cur, maximumFractionDigits: 4 }).format(
    Number.isFinite(+n) ? +n : 0
  );
const num = (n, d = 3) => (Number.isFinite(+n) ? +n : 0).toLocaleString("es-MX", { maximumFractionDigits: d });

const emptyLine = (category = "tela") => ({
  key: Math.random().toString(36).slice(2),
  category,
  materialName: "",
  materialCode: "",
  supplier: "",
  color: "",
  unit: CAT_BY_CODE[category]?.unit || "pza",
  consumption: "",
  wastePct: "",
  unitCost: "",
  notes: "",
});

const lineNet = (l) => (Number(l.consumption) || 0) * (1 + (Number(l.wastePct) || 0) / 100);
const lineCost = (l) => lineNet(l) * (Number(l.unitCost) || 0);

// ------------------------------------------------------------------
//  Small building blocks
// ------------------------------------------------------------------

function SectionCard({ icon: Icon, title, subtitle, right, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800 truncate">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function CatChip({ code, active, onClick }) {
  const c = CAT_BY_CODE[code];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
        active ? "border-slate-900 bg-slate-900 text-white" : `${c.tint} hover:brightness-95`
      }`}
    >
      {c.label}
    </button>
  );
}

// Searchable product picker fed by /api/master-codes.
function ProductPicker({ products, value, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return products.slice(0, 40);
    return products
      .filter((p) =>
        [p.code, p.estilo, p.cliente, p.description].filter(Boolean).join(" ").toLowerCase().includes(t)
      )
      .slice(0, 40);
  }, [q, products]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400"
      >
        <Package size={16} className="text-slate-400 shrink-0" />
        {value ? (
          <span className="min-w-0 flex-1">
            <span className="font-mono text-slate-800">{value.code}</span>
            <span className="text-slate-400"> · </span>
            <span className="text-slate-500">{value.estilo || value.description || ""}</span>
          </span>
        ) : (
          <span className="text-slate-400 flex-1">Selecciona un producto…</span>
        )}
        <Search size={15} className="text-slate-300 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código, estilo o cliente"
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">Sin coincidencias</div>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onPick(p); setOpen(false); setQ(""); }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs text-slate-800 truncate">{p.code}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {[p.estilo, p.cliente, p.description].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {Number.isFinite(+p.sam) && (
                  <span className="text-[11px] text-slate-400 shrink-0">{num(p.sam, 2)} min</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
//  Page
// ------------------------------------------------------------------

export default function BillOfMaterialsPage({ embedded = false, reloadToken = 0, onOnline }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [boms, setBoms] = useState([]);
  const [apiOnline, setApiOnline] = useState(true);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // The BOM currently being edited.
  const [bomId, setBomId] = useState(null); // null = unsaved / new
  const [product, setProduct] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [meta, setMeta] = useState({ name: "", version: "1", currency: "MXN", status: "draft", notes: "" });
  const [lines, setLines] = useState([emptyLine("tela")]);

  const showToast = (msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  // ---- initial load -------------------------------------------------------
  const loadAll = async () => {
    setLoading(true);
    try {
      const [pRes, cRes, fRes, bRes] = await Promise.all([
        fetch(`${API_URL}/api/master-codes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/bom`, { headers: authHeaders() }),
      ]);
      if (pRes.status === 401) { window.location.href = "/login"; return; }
      const pData = await pRes.json();
      const cData = await cRes.json();
      const fData = await fRes.json();
      const bData = await bRes.json();
      // /api/master-codes returns a bare array.
      setProducts(Array.isArray(pData) ? pData : pData.records || []);
      setCustomers(cData.customers || []);
      setFabrics(fData.fabrics || []);
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

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  // Deep-link: /bom?masterCodeId=123 opens a fresh list for that product, or
  // /bom?id=45 loads an existing list.
  useEffect(() => {
    if (!products.length && !boms.length) return;
    const idParam = searchParams.get("id");
    const mcParam = searchParams.get("masterCodeId");
    if (idParam) {
      openBom(Number(idParam));
      setSearchParams({}, { replace: true });
    } else if (mcParam) {
      const p = products.find((x) => String(x.id) === String(mcParam));
      if (p) startForProduct(p);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, boms]);

  // ---- editor helpers -----------------------------------------------------
  const resetEditor = () => {
    setBomId(null);
    setProduct(null);
    setCustomerId("");
    setMeta({ name: "", version: "1", currency: "MXN", status: "draft", notes: "" });
    setLines([emptyLine("tela")]);
  };

  const startForProduct = (p) => {
    resetEditor();
    applyProduct(p);
  };

  const applyProduct = (p) => {
    setProduct(p);
    // Pull in a matching customer by the 3-letter cliente code, if we have one.
    const match = customers.find(
      (c) => (c.code || "").toUpperCase() === (p?.cliente || "").toUpperCase()
    );
    if (match) setCustomerId(String(match.id));
    setMeta((m) => ({ ...m, name: m.name || `BOM ${p.estilo || p.code}` }));
  };

  const openBom = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/bom/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("No se pudo abrir la lista");
      const data = await res.json();
      const b = data.bom;
      setBomId(b.id);
      setProduct(
        b.masterCodeId ? products.find((p) => p.id === b.masterCodeId) || {
          id: b.masterCodeId, code: b.masterCode, estilo: b.estilo, description: b.styleDescription,
          cliente: "",
        } : null
      );
      setCustomerId(b.customerId ? String(b.customerId) : "");
      setMeta({
        name: b.name || "",
        version: b.version || "1",
        currency: b.currency || "MXN",
        status: b.status || "draft",
        notes: b.notes || "",
      });
      setLines(
        (data.lines || []).map((l) => ({
          key: Math.random().toString(36).slice(2),
          category: l.category,
          materialName: l.materialName || "",
          materialCode: l.materialCode || "",
          supplier: l.supplier || "",
          color: l.color || "",
          unit: l.unit || "pza",
          consumption: l.consumption ?? "",
          wastePct: l.wastePct ?? "",
          unitCost: l.unitCost ?? "",
          notes: l.notes || "",
        }))
      );
      if (!(data.lines || []).length) setLines([emptyLine("tela")]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showToast(err.message || "Error al abrir", "error");
    } finally {
      setLoading(false);
    }
  };

  const updateLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (category = "tela") => setLines((ls) => [...ls, emptyLine(category)]);
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const duplicateLine = (key) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      if (i < 0) return ls;
      const copy = { ...ls[i], key: Math.random().toString(36).slice(2) };
      return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
    });

  // ---- totals -------------------------------------------------------------
  const filledLines = useMemo(() => lines.filter((l) => l.materialName.trim()), [lines]);
  const totalCost = useMemo(() => filledLines.reduce((s, l) => s + lineCost(l), 0), [filledLines]);
  const costByCategory = useMemo(() => {
    const map = {};
    filledLines.forEach((l) => { map[l.category] = (map[l.category] || 0) + lineCost(l); });
    return map;
  }, [filledLines]);

  // ---- save ---------------------------------------------------------------
  const canSave = product && filledLines.length > 0 && !saving;

  const save = async () => {
    if (!product) return showToast("Selecciona un producto primero", "error");
    if (filledLines.length === 0) return showToast("Agrega al menos un material", "error");
    const cust = customers.find((c) => String(c.id) === String(customerId));
    const payload = {
      masterCodeId: product.id,
      styleCode: product.code || null,
      estilo: product.estilo || null,
      styleDescription: product.description || null,
      customerId: customerId ? Number(customerId) : null,
      customerName: cust ? cust.name : null,
      name: meta.name,
      version: meta.version,
      currency: meta.currency,
      status: meta.status,
      notes: meta.notes,
      lines: filledLines.map((l, i) => ({
        position: i,
        category: l.category,
        materialName: l.materialName,
        materialCode: l.materialCode,
        supplier: l.supplier,
        color: l.color,
        unit: l.unit,
        consumption: Number(l.consumption) || 0,
        wastePct: Number(l.wastePct) || 0,
        unitCost: Number(l.unitCost) || 0,
        notes: l.notes,
      })),
    };
    setSaving(true);
    try {
      const res = await fetch(bomId ? `${API_URL}/api/bom/${bomId}` : `${API_URL}/api/bom`, {
        method: bomId ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      setBomId(data.id);
      showToast(bomId ? "Lista actualizada" : "Lista guardada");
      const bRes = await fetch(`${API_URL}/api/bom`, { headers: authHeaders() });
      setBoms((await bRes.json()).boms || []);
    } catch (err) {
      showToast(err.message || "Error al guardar", "error");
    } finally {
      setSaving(false);
    }
  };

  const removeBom = async (id) => {
    if (!window.confirm("¿Eliminar esta lista de materiales?")) return;
    try {
      const res = await fetch(`${API_URL}/api/bom/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setBoms((bs) => bs.filter((b) => b.id !== id));
      if (id === bomId) resetEditor();
      showToast("Lista eliminada");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const fabricNames = useMemo(() => fabrics.map((f) => f.name), [fabrics]);

  // ------------------------------------------------------------------
  const body = (
    <>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ---------------- Saved lists ---------------- */}
        <aside className="space-y-3">
          <button
            onClick={resetEditor}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-white text-sm font-medium px-3 py-2.5 hover:bg-slate-800"
          >
            <Plus size={16} /> Nueva lista
          </button>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <FileText size={15} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">Listas guardadas</span>
              <span className="ml-auto text-[11px] text-slate-400">{boms.length}</span>
            </div>
            <div className="max-h-[70vh] overflow-auto divide-y divide-slate-50">
              {boms.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-slate-400">
                  Aún no hay listas. Elige un producto y agrega materiales para crear la primera.
                </div>
              )}
              {boms.map((b) => (
                <button
                  key={b.id}
                  onClick={() => openBom(b.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${
                    b.id === bomId ? "bg-slate-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-800 truncate">
                      {b.masterCode || b.styleCode || b.estilo || "—"}
                    </span>
                    <span
                      className={`ml-auto text-[10px] rounded-full px-1.5 py-0.5 ${
                        b.status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : b.status === "archived"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {STATUSES.find((s) => s.code === b.status)?.label || b.status}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="truncate">{b.customerName || b.name || "Sin cliente"}</span>
                    <span className="ml-auto shrink-0">{b.lineCount} mat.</span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-700">
                    {money(b.totalCost, b.currency)} / prenda
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ---------------- Editor ---------------- */}
        <section className="space-y-6 min-w-0">
          {/* Style / customer */}
          <SectionCard
            icon={Shirt}
            title={bomId ? "Editar lista de materiales" : "Nueva lista de materiales"}
            subtitle="Elige el producto (código maestro) al que pertenece esta lista"
            right={
              product && (
                <span className="text-[11px] text-slate-400">
                  {bomId ? `#${bomId}` : "sin guardar"}
                </span>
              )
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Producto</label>
                <ProductPicker products={products} value={product} onPick={applyProduct} />
              </div>

              {product && (
                <div className="md:col-span-2 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-slate-400">Estilo cliente</div>
                      <div className="font-medium text-slate-700">{product.estilo || "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Cliente (código)</div>
                      <div className="font-medium text-slate-700">{product.cliente || "—"}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-slate-400">Descripción</div>
                      <div className="font-medium text-slate-700 truncate">{product.description || "—"}</div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Cliente</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="">Sin cliente</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.code ? ` (${c.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre de la lista</label>
                <input
                  value={meta.name}
                  onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
                  placeholder="p. ej. BOM temporada invierno"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-3 md:col-span-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Versión</label>
                  <input
                    value={meta.version}
                    onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
                  <select
                    value={meta.currency}
                    onChange={(e) => setMeta((m) => ({ ...m, currency: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
                  <select
                    value={meta.status}
                    onChange={(e) => setMeta((m) => ({ ...m, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.code} value={s.code}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Material lines */}
          <SectionCard
            icon={Layers}
            title="Materiales"
            subtitle="Consumo por prenda, con merma y costo unitario"
            right={
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => addLine(c.code)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${c.tint} hover:brightness-95`}
                  >
                    <Plus size={11} className="inline -mt-0.5 mr-0.5" />
                    {c.label}
                  </button>
                ))}
              </div>
            }
          >
            {/* datalist reused by every material-name input */}
            <datalist id="bom-fabric-options">
              {fabricNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-1 font-medium">Categoría</th>
                    <th className="px-2 py-1 font-medium min-w-[180px]">Material</th>
                    <th className="px-2 py-1 font-medium">Código</th>
                    <th className="px-2 py-1 font-medium">Proveedor</th>
                    <th className="px-2 py-1 font-medium">Color</th>
                    <th className="px-2 py-1 font-medium">Unidad</th>
                    <th className="px-2 py-1 font-medium text-right">Consumo</th>
                    <th className="px-2 py-1 font-medium text-right">Merma %</th>
                    <th className="px-2 py-1 font-medium text-right">Costo unit.</th>
                    <th className="px-2 py-1 font-medium text-right">Costo línea</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="bg-slate-50/60 hover:bg-slate-50">
                      <td className="px-1 py-1 align-top">
                        <select
                          value={l.category}
                          onChange={(e) =>
                            updateLine(l.key, {
                              category: e.target.value,
                              unit: l.unit || CAT_BY_CODE[e.target.value]?.unit || "pza",
                            })
                          }
                          className="rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-xs outline-none focus:border-slate-400"
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input
                          list="bom-fabric-options"
                          value={l.materialName}
                          onChange={(e) => updateLine(l.key, { materialName: e.target.value })}
                          placeholder="Nombre del material"
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          value={l.materialCode}
                          onChange={(e) => updateLine(l.key, { materialCode: e.target.value })}
                          className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          value={l.supplier}
                          onChange={(e) => updateLine(l.key, { supplier: e.target.value })}
                          className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          value={l.color}
                          onChange={(e) => updateLine(l.key, { color: e.target.value })}
                          className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <select
                          value={l.unit}
                          onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                          className="rounded-md border border-slate-200 bg-white px-1.5 py-1.5 text-xs outline-none focus:border-slate-400"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={l.consumption}
                          onChange={(e) => updateLine(l.key, { consumption: e.target.value })}
                          className="w-20 text-right rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={l.wastePct}
                          onChange={(e) => updateLine(l.key, { wastePct: e.target.value })}
                          className="w-16 text-right rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={l.unitCost}
                          onChange={(e) => updateLine(l.key, { unitCost: e.target.value })}
                          className="w-24 text-right rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                      </td>
                      <td className="px-2 py-1 text-right text-xs font-medium text-slate-700 whitespace-nowrap">
                        {money(lineCost(l), meta.currency)}
                      </td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => duplicateLine(l.key)}
                            title="Duplicar"
                            className="p-1 text-slate-300 hover:text-slate-600"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={() => removeLine(l.key)}
                            title="Quitar"
                            className="p-1 text-slate-300 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={() => addLine("tela")}
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              <Plus size={15} /> Agregar material
            </button>
          </SectionCard>

          {/* Notes + totals */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
            <SectionCard icon={FileText} title="Notas" subtitle="Instrucciones o comentarios para producción">
              <textarea
                value={meta.notes}
                onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
                rows={5}
                placeholder="p. ej. tolerancias de corte, proveedor alterno, requisitos de calidad…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400 resize-y"
              />
            </SectionCard>

            <div className="bg-slate-900 text-white rounded-xl shadow-sm p-5 flex flex-col">
              <div className="text-xs text-slate-300">Costo de materiales por prenda</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight">
                {money(totalCost, meta.currency)}
              </div>
              <div className="mt-4 space-y-1.5">
                {CATEGORIES.filter((c) => costByCategory[c.code]).map((c) => (
                  <div key={c.code} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{c.label}</span>
                    <span className="font-medium">{money(costByCategory[c.code], meta.currency)}</span>
                  </div>
                ))}
                {filledLines.length === 0 && (
                  <div className="text-xs text-slate-400">Agrega materiales para ver el desglose.</div>
                )}
              </div>
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-slate-300">
                <span>{filledLines.length} material(es)</span>
                <span>Versión {meta.version}</span>
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-3 pb-10">
            <button
              onClick={save}
              disabled={!canSave}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
                canSave ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {bomId ? "Guardar cambios" : "Guardar lista"}
            </button>
            {bomId && (
              <button
                onClick={() => removeBom(bomId)}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 text-rose-600 px-4 py-2.5 text-sm font-medium hover:bg-rose-50"
              >
                <Trash2 size={16} /> Eliminar
              </button>
            )}
            {!product && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <AlertCircle size={14} /> Selecciona un producto para poder guardar
              </span>
            )}
          </div>
        </section>
      </main>

      {/* Toast */}
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
        title="Lista de materiales"
        onRefresh={loadAll}
        isRefreshing={loading}
        showStatus={!loading}
        isOnline={apiOnline}
      />
      {body}
    </div>
  );
}