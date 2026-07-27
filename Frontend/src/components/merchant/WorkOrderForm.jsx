import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Layers, Scissors, CalendarClock, Users, Palette, Hash,
  Plus, Trash2, Check, X, AlertCircle, RefreshCw, ClipboardList,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "./MerchantNavbar";
import MasterCodeBadge from "./MasterCodeBadge";

/* -----------------------------------------------------------------------
 *  Orden de Producción (PO) form.
 *  Flow: 1) elegir estilo (código maestro) → 2) tela → 3) fecha de entrega
 *        → 4) cliente → 5) colores + cantidad por color → estilo cliente.
 *  Posts to the existing POST /api/work-orders (extended to accept `colors`).
 * --------------------------------------------------------------------- */

function SectionCard({ icon: Icon, step, title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {step != null && <span className="text-slate-400 mr-1">{step} ·</span>}
            {title}
          </h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export default function WorkOrderForm() {
  // catalogs
  const [masterCodes, setMasterCodes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [fabrics, setFabrics] = useState([]);

  // selection / form state
  const [mcQuery, setMcQuery] = useState("");
  const [selectedMc, setSelectedMc] = useState(null);
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [commitmentDate, setCommitmentDate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [selectedFabrics, setSelectedFabrics] = useState([]);
  const [newFabric, setNewFabric] = useState("");
  const [estilo, setEstilo] = useState("");           // estilo cliente
  const [styleDescription, setStyleDescription] = useState("");
  const [sam, setSam] = useState("");
  const [colorRows, setColorRows] = useState([{ color: "", quantity: "" }]);
  const [warehouseStock, setWarehouseStock] = useState("");
  const [extraQuantity, setExtraQuantity] = useState("");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const mcBoxRef = useRef(null);
  const [mcOpen, setMcOpen] = useState(false);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  // ------- load catalogs + next WO number ------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [mcRes, custRes, fabRes, noRes] = await Promise.all([
          fetch(`${API_URL}/api/master-codes`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/work-orders/next-number`, { headers: authHeaders() }),
        ]);
        if (mcRes.ok) setMasterCodes(await mcRes.json());
        if (custRes.ok) setCustomers((await custRes.json()).customers || []);
        if (fabRes.ok) setFabrics((await fabRes.json()).fabrics || []);
        if (noRes.ok) setWorkOrderNo((await noRes.json()).nextWorkOrderNo || "");
      } catch (err) {
        console.error(err);
        showToast("⚠️ No se pudieron cargar los catálogos", true);
      }
    })();
  }, []);

  // close the style dropdown on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (mcBoxRef.current && !mcBoxRef.current.contains(e.target)) setMcOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // ------- 1) pick a master code (style) -------------------------------
  const filteredMc = useMemo(() => {
    const q = mcQuery.trim().toUpperCase();
    const list = q
      ? masterCodes.filter((m) =>
          `${m.code} ${m.estilo || ""} ${m.description || ""} ${m.cliente || ""}`
            .toUpperCase()
            .includes(q)
        )
      : masterCodes;
    return list.slice(0, 25);
  }, [mcQuery, masterCodes]);

  const selectMasterCode = (m) => {
    setSelectedMc(m);
    setMcQuery(m.code);
    setMcOpen(false);
    setEstilo(m.estilo || "");
    setStyleDescription(m.description || "");
    setSam(m.sam != null ? String(m.sam) : "");
    // seed the first color row from the master code's own color
    setColorRows((rows) =>
      rows.length === 1 && !rows[0].color && !rows[0].quantity
        ? [{ color: (m.color || "").toUpperCase(), quantity: "" }]
        : rows
    );
    // auto-match the customer via the 3-letter cliente code
    const match = customers.find(
      (c) => (c.code || "").toUpperCase() === (m.cliente || "").toUpperCase()
    );
    if (match) setCustomerId(String(match.id));
  };

  // ------- 2) tela -----------------------------------------------------
  const toggleFabric = (name) =>
    setSelectedFabrics((f) =>
      f.includes(name) ? f.filter((x) => x !== name) : [...f, name]
    );

  const addFabric = async () => {
    const name = newFabric.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok) {
        setFabrics((f) => [...f, data.fabric].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedFabrics((s) => [...s, data.fabric.name]);
        setNewFabric("");
      } else {
        showToast(`❌ ${data.error || "No se pudo agregar la tela"}`, true);
      }
    } catch {
      showToast("❌ Error al agregar tela", true);
    }
  };

  // ------- 5) colors ---------------------------------------------------
  const setRow = (i, key, val) =>
    setColorRows((rows) =>
      rows.map((r, idx) =>
        idx === i
          ? {
              ...r,
              [key]:
                key === "color"
                  ? val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)
                  : val.replace(/[^0-9.]/g, ""),
            }
          : r
      )
    );
  const addRow = () => setColorRows((r) => [...r, { color: "", quantity: "" }]);
  const removeRow = (i) =>
    setColorRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));

  const validColors = colorRows
    .map((r) => ({ color: r.color.trim(), quantity: parseFloat(r.quantity) }))
    .filter((r) => r.color && !isNaN(r.quantity) && r.quantity > 0);

  const orderedQty = validColors.reduce((s, r) => s + r.quantity, 0);
  const totalToProduce = Math.max(
    orderedQty - (parseFloat(warehouseStock) || 0) + (parseFloat(extraQuantity) || 0),
    0
  );

  const canSave =
    workOrderNo.trim() &&
    customerId &&
    styleDescription.trim() &&
    validColors.length > 0 &&
    !saving;

  // ------- submit ------------------------------------------------------
  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        workOrderNo: workOrderNo.trim(),
        totalQuantity: orderedQty,
        warehouseStock: parseFloat(warehouseStock) || 0,
        extraQuantity: parseFloat(extraQuantity) || 0,
        totalToProduce,
        commitmentDate: commitmentDate || null,
        customerId: Number(customerId),
        styleDescription: styleDescription.trim(),
        styleCode: selectedMc?.code || null,
        estilo: estilo.trim() || null,               // estilo cliente
        fabrics: selectedFabrics,
        fabricSupplier: selectedFabrics[0] || null,
        masterCodeId: selectedMc?.id || null,
        samMinutes: sam ? Number(sam) : null,
        colors: validColors,                          // per-color breakdown
      };
      const res = await fetch(`${API_URL}/api/work-orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear la orden");
      showToast(`✅ Orden ${data.workOrder.work_order_no} creada`);
      // reset for the next order, keep the customer/style context handy
      setColorRows([{ color: "", quantity: "" }]);
      setWarehouseStock("");
      setExtraQuantity("");
      const noRes = await fetch(`${API_URL}/api/work-orders/next-number`, { headers: authHeaders() });
      if (noRes.ok) setWorkOrderNo((await noRes.json()).nextWorkOrderNo || "");
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    } finally {
      setSaving(false);
    }
  };

  const fabricNames = fabrics.map((f) => f.name);

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar title="Orden de producción · Nueva" showRefresh={false} />

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ---------------- left column ---------------- */}
        <div className="lg:col-span-3 space-y-6">
          {/* 1 · Style / master code */}
          <SectionCard icon={Layers} step="1" title="Estilo" subtitle="Elige el código maestro">
            <div className="relative" ref={mcBoxRef}>
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={mcQuery}
                onChange={(e) => { setMcQuery(e.target.value); setMcOpen(true); }}
                onFocus={() => setMcOpen(true)}
                placeholder="Buscar por código, estilo o descripción…"
                className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm font-mono
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              />
              {mcOpen && filteredMc.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                  {filteredMc.map((m) => (
                    <li key={m.id || m.code}>
                      <button
                        type="button"
                        onClick={() => selectMasterCode(m)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <span className="font-mono text-sm font-bold text-slate-800">{m.code}</span>
                        <span className="block text-xs text-slate-500 truncate">
                          {m.description || "—"} · SAM {m.sam ?? "—"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedMc && (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
                {selectedMc.photoUrl ? (
                  <img src={selectedMc.photoUrl} alt="" className="w-12 h-12 rounded object-cover border border-slate-200" />
                ) : (
                  <div className="w-12 h-12 rounded bg-slate-200 flex items-center justify-center text-slate-400">
                    <Layers size={18} />
                  </div>
                )}
                <div className="min-w-0">
                  <MasterCodeBadge code={selectedMc.code} size="sm" />
                  <p className="text-xs text-slate-500 truncate mt-1">{selectedMc.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedMc(null); setMcQuery(""); }}
                  className="ml-auto p-1.5 rounded hover:bg-slate-200 text-slate-500"
                  title="Quitar"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Descripción del estilo
              </label>
              <input
                value={styleDescription}
                onChange={(e) => setStyleDescription(e.target.value)}
                placeholder="Pantalón dama invierno…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              />
            </div>
          </SectionCard>

          {/* 2 · Fabric */}
          <SectionCard icon={Scissors} step="2" title="Tela" subtitle="Una o varias telas del estilo">
            <div className="flex flex-wrap gap-2">
              {fabricNames.map((name) => {
                const active = selectedFabrics.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleFabric(name)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-all
                      ${active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
                  >
                    {name}
                  </button>
                );
              })}
              {fabricNames.length === 0 && (
                <p className="text-xs text-slate-400">Aún no hay telas registradas.</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newFabric}
                onChange={(e) => setNewFabric(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFabric())}
                placeholder="Agregar nueva tela…"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              />
              <button
                type="button"
                onClick={addFabric}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                <Plus size={14} /> Agregar
              </button>
            </div>
          </SectionCard>

          {/* 3 · Delivery date + 4 · Customer */}
          <SectionCard icon={CalendarClock} step="3 · 4" title="Entrega y cliente" subtitle="Fecha comprometida y cliente">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Fecha de entrega comprometida
                </label>
                <input
                  type="date"
                  value={commitmentDate}
                  onChange={(e) => setCommitmentDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  <span className="inline-flex items-center gap-1"><Users size={12} /> Cliente</span>
                </label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white
                             focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                >
                  <option value="">Selecciona un cliente…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.code ? ` (${c.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </SectionCard>

          {/* 5 · Colors + quantity */}
          <SectionCard icon={Palette} step="5" title="Colores y cantidad" subtitle="Cantidad por cada color">
            <div className="space-y-2">
              {colorRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.color}
                    onChange={(e) => setRow(i, "color", e.target.value)}
                    placeholder="COLOR (NEG)"
                    className="w-32 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-widest
                               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                  />
                  <input
                    value={row.quantity}
                    onChange={(e) => setRow(i, "quantity", e.target.value)}
                    inputMode="decimal"
                    placeholder="Cantidad"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm
                               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={colorRows.length === 1}
                    className="p-2 rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Quitar color"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              <Plus size={14} /> Agregar color
            </button>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                Estilo cliente
              </label>
              <input
                value={estilo}
                onChange={(e) => setEstilo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                placeholder="FN2808"
                className="w-full sm:w-48 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-widest
                           focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
              />
            </div>
          </SectionCard>
        </div>

        {/* ---------------- right column (summary) ---------------- */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-6 space-y-6">
            <SectionCard icon={ClipboardList} title="Resumen de la orden">
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                    N° de orden
                  </label>
                  <input
                    value={workOrderNo}
                    onChange={(e) => setWorkOrderNo(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm
                               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Stock almacén</label>
                    <input
                      value={warehouseStock}
                      onChange={(e) => setWarehouseStock(e.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Extra</label>
                    <input
                      value={extraQuantity}
                      onChange={(e) => setExtraQuantity(e.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  <Row label="Colores" value={`${validColors.length}`} />
                  <Row label="Cantidad pedida" value={orderedQty.toLocaleString()} />
                  <Row label="SAM" value={sam ? `${sam} min` : "—"} />
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-semibold text-slate-800">Total a producir</span>
                    <span className="font-mono text-lg font-bold text-slate-900">
                      {totalToProduce.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </SectionCard>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all
                ${canSave
                  ? "bg-slate-900 text-white hover:bg-slate-700 shadow-lg"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              {saving ? (<><RefreshCw size={16} className="animate-spin" /> Creando orden…</>)
                     : (<><Plus size={16} /> Crear orden de producción</>)}
            </button>
            {!canSave && !saving && (
              <p className="text-xs text-slate-500 text-center">
                Completa estilo, cliente y al menos un color con cantidad.
              </p>
            )}
          </div>
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
          ${toast.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"}`}>
          {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-800">{value}</span>
    </div>
  );
}