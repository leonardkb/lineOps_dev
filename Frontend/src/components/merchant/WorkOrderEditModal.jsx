import { useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Check, AlertCircle, Save, Plus, Trash2, Copy } from "lucide-react";
import { API_URL, TALLAS } from "../../lib/masterCodeCatalog";

/*
  Edit an existing production order (PO) — header AND the size/color breakdown.

  <WorkOrderEditModal
     order={order}          // a row from GET /api/work-orders (must include `lines`)
     apiOnline={bool}
     onClose={fn}
     onSaved={(updatedOrder, originalOrder) => {}}
  />

  Saves through PUT /api/production-orders/:id, which rewrites work_order_lines
  in a transaction and recomputes everything the breakdown owns: quantity, color
  summary, estilo, master_code_id, total_to_produce and the header copies of
  customer PO, delivery date, fabrics and yield.

  Those header columns are therefore NOT editable here — they show as a
  read-only preview of what will be written. Edit the line, the header follows.

  STYLING NOTE: never concatenate two width utilities onto one element
  (`cellCls + " w-32"` where cellCls already has `w-full`). Tailwind resolves the
  conflict by stylesheet order, not class order, so `w-full` wins and the layout
  collapses. Widths below are applied once, explicitly.
*/

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STATUSES = [
  { value: "pending", label: "Pendiente" },
  { value: "assigned", label: "Asignada" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

// --- input styling ---------------------------------------------------------
// `control` carries NO width; every use adds exactly one width class.
const control =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900";
const controlSm =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900";
const fieldCls = `w-full ${control}`;
const numFieldCls = `w-full ${control} font-mono`;
const cellCls = `w-full ${controlSm}`;
const cellMonoCls = `w-full ${controlSm} font-mono uppercase`;

function Section({ title, hint, children, right }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 border-b border-slate-100 pb-1.5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">{title}</h3>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function RowField({ label, children, invalid }) {
  return (
    <label className="block min-w-0">
      <span className={`block text-[10px] font-semibold uppercase tracking-wide mb-1 ${invalid ? "text-rose-500" : "text-slate-500"}`}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Preview({ label, value }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className="block truncate text-xs font-mono text-slate-700" title={value || undefined}>
        {value || "—"}
      </span>
    </div>
  );
}

// --- fabric helpers --------------------------------------------------------
function cleanFabrics(list) {
  const out = [];
  const seen = new Set();
  for (const f of list || []) {
    const name = (f.name || "").trim();
    if (!name) continue;
    const code = (f.code || "").trim() || null;
    const yieldVal = (f.yield ?? "").toString().trim();
    const key = `${name}|${code || ""}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, code, yield: yieldVal === "" ? null : yieldVal });
  }
  return out;
}

function mergeFabrics(cells) {
  const out = [];
  const seen = new Set();
  for (const c of cells) {
    for (const f of c.fabrics || []) {
      const key = `${f.name}|${f.code || ""}`.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

const fabricSummary = (list) =>
  (list || [])
    .map((f) => `${f.name}${f.code ? ` (${f.code})` : ""}${f.yield ? ` · rend ${f.yield}` : ""}`)
    .join(", ");

const fabricsFromLine = (l) =>
  Array.isArray(l?.fabrics) && l.fabrics.length
    ? l.fabrics.map((f) => ({ name: f.name || "", code: f.code || "", yield: f.yield == null ? "" : String(f.yield) }))
    : (l?.fabricName
        ? [{ name: l.fabricName, code: l.fabricCode || "", yield: l.yield == null ? "" : String(l.yield) }]
        : [{ name: "", code: "", yield: "" }]);

// --- misc ------------------------------------------------------------------
const dateOnly = (v) => (v ? String(v).slice(0, 10) : "");
const num = (v) => (v === "" || v == null ? "" : String(v));
const sizeRank = (code) => {
  const i = TALLAS.findIndex((t) => t.code === code);
  return i === -1 ? 999 : i;
};
const sizeLabel = (code) => TALLAS.find((t) => t.code === code)?.label || "";

const emptyRow = () => ({
  color: "", estilo: "", customerPo: "",
  deliveryDate: "", fabrics: [{ name: "", code: "", yield: "" }], qty: {},
});

// Rebuild the step-2 rows from work_order_lines: one row per color+estilo.
function rowsFromOrder(order) {
  const map = new Map();
  for (const l of order?.lines || []) {
    const key = `${l.color}|${l.estilo}`;
    if (!map.has(key)) {
      map.set(key, {
        color: l.color || "",
        estilo: l.estilo || "",
        customerPo: l.customerPo || "",
        deliveryDate: dateOnly(l.commitmentDate),
        fabrics: fabricsFromLine(l),
        qty: {},
      });
    }
    map.get(key).qty[l.talla] = num(l.quantity);
  }
  const rows = [...map.values()];
  if (rows.length > 0) return rows;

  // Order created before the breakdown existed — seed one row from the header.
  return [{
    ...emptyRow(),
    color: (order?.color || "").split(",")[0]?.trim() || "",
    estilo: order?.estilo || "",
    customerPo: order?.customer_po || "",
    deliveryDate: dateOnly(order?.commitment_date),
    fabrics: Array.isArray(order?.fabric_details) && order.fabric_details.length
      ? order.fabric_details.map((f) => ({ name: f.name || "", code: f.code || "", yield: f.yield == null ? "" : String(f.yield) }))
      : [{
          name: order?.fabric_name || order?.fabric_supplier || "",
          code: order?.fabric_code || "",
          yield: order?.yield_per_piece == null ? "" : String(order.yield_per_piece),
        }],
  }];
}

function sizesFromOrder(order) {
  const s = [...new Set((order?.lines || []).map((l) => l.talla).filter(Boolean))];
  return s.sort((a, b) => sizeRank(a) - sizeRank(b));
}

export default function WorkOrderEditModal({ order, apiOnline = true, onClose, onSaved }) {
  const [customers, setCustomers] = useState([]);
  const [fabricCatalog, setFabricCatalog] = useState([]);
  const [customerId, setCustomerId] = useState(order?.customer_id ? String(order.customer_id) : "");

  const [styleDescription, setStyleDescription] = useState(order?.style_description || "");
  const [status, setStatus] = useState(order?.status || "pending");
  const [warehouseStock, setWarehouseStock] = useState(num(order?.warehouse_stock));
  const [extraQuantity, setExtraQuantity] = useState(num(order?.extra_quantity));
  const [totalToProduce, setTotalToProduce] = useState(num(order?.total_to_produce));

  const [sizes, setSizes] = useState(() => sizesFromOrder(order));
  const [rows, setRows] = useState(() => rowsFromOrder(order));

  const [saving, setSaving] = useState(false);
  const [savingFabric, setSavingFabric] = useState(null); // tela name being added to the catalog
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [custRes, fabRes] = await Promise.all([
          fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() }),
        ]);
        if (custRes.ok) setCustomers((await custRes.json()).customers || []);
        if (fabRes.ok) setFabricCatalog((await fabRes.json()).fabrics || []);
      } catch {
        /* dropdowns just stay with the current values */
      }
    })();
  }, []);

  // ------- row helpers --------------------------------------------------
  const setRowField = (i, key, val) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const setQty = (i, talla, val) =>
    setRows((rs) => rs.map((r, idx) =>
      idx === i ? { ...r, qty: { ...r.qty, [talla]: val.replace(/[^0-9.]/g, "") } } : r));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i) => setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  const duplicateRow = (i) =>
    setRows((rs) => {
      const src = rs[i];
      const copy = {
        ...src,
        color: "",
        fabrics: src.fabrics.map((f) => ({ ...f })),
        qty: {},               // same logistics, fresh color and quantities
      };
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });

  const setFabricField = (i, j, key, val) =>
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      return {
        ...r,
        fabrics: r.fabrics.map((f, fi) => {
          if (fi !== j) return f;
          const next = { ...f, [key]: val };
          // Picking a catalogued tela fills its code, unless one was typed.
          if (key === "name" && !(f.code || "").trim()) {
            const hit = fabricCatalog.find((c) => (c.name || "").toLowerCase() === val.trim().toLowerCase());
            if (hit?.code) next.code = hit.code;
          }
          return next;
        }),
      };
    }));

  // Register a tela + its code in the shared catalog so it can be reused on
  // future orders — same behaviour as the new-order wizard's step 2.
  const saveFabricToCatalog = async (rawName, rawCode) => {
    const name = (rawName || "").trim();
    if (!name || savingFabric) return;
    setSavingFabric(name);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name, code: (rawCode || "").trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la tela");
      setFabricCatalog((f) =>
        [...f.filter((x) => (x.name || "").toLowerCase() !== data.fabric.name.toLowerCase()), data.fabric]
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      setError(e.message || "No se pudo guardar la tela");
    } finally {
      setSavingFabric(null);
    }
  };
  const addFabric = (i) =>
    setRows((rs) => rs.map((r, idx) =>
      idx === i ? { ...r, fabrics: [...r.fabrics, { name: "", code: "", yield: "" }] } : r));
  const removeFabric = (i, j) =>
    setRows((rs) => rs.map((r, idx) =>
      idx === i && r.fabrics.length > 1 ? { ...r, fabrics: r.fabrics.filter((_, fi) => fi !== j) } : r));

  const toggleSize = (code) =>
    setSizes((s) => (s.includes(code)
      ? s.filter((x) => x !== code)
      : [...s, code].sort((a, b) => sizeRank(a) - sizeRank(b))));

  // ------- derived ------------------------------------------------------
  // One cell per talla × row: exactly the work_order_lines that will be written.
  const cells = useMemo(() => {
    const out = [];
    for (const row of rows) {
      const color = row.color.trim().toUpperCase();
      const estilo = (row.estilo || "").trim().toUpperCase();
      if (!color) continue;
      const fabrics = cleanFabrics(row.fabrics);
      for (const talla of sizes) {
        const q = parseFloat(row.qty[talla]);
        if (isNaN(q) || q <= 0) continue;
        out.push({
          talla, color, estilo,
          customerPo: (row.customerPo || "").trim() || null,
          commitmentDate: row.deliveryDate || null,
          fabrics, // each tela carries its own { name, code, yield }
          quantity: q,
        });
      }
    }
    return out;
  }, [rows, sizes]);

  const orderedQty = cells.reduce((s, c) => s + c.quantity, 0);
  const suggestedTotal = useMemo(() => {
    const w = parseFloat(warehouseStock) || 0;
    const x = parseFloat(extraQuantity) || 0;
    return Math.max(orderedQty - w + x, 0);
  }, [orderedQty, warehouseStock, extraQuantity]);

  // What the server will store on the work_orders header (first line wins).
  const firstOf = (k) => cells.find((c) => c[k] != null && c[k] !== "")?.[k] ?? null;
  const preview = {
    colors: [...new Set(cells.map((c) => c.color))].join(", "),
    customerPo: [...new Set(cells.map((c) => c.customerPo).filter(Boolean))].join(", "),
    date: firstOf("commitmentDate"),
    fabricList: mergeFabrics(cells),
    yield: mergeFabrics(cells).find((f) => f.yield != null && f.yield !== "")?.yield ?? null,
  };

  const activeRows = rows.filter((r) => r.color.trim());
  const comboCount = useMemo(() => {
    const m = new Map();
    for (const r of activeRows) {
      const k = `${r.color.trim().toUpperCase()}|${(r.estilo || "").trim().toUpperCase()}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [activeRows]);
  const isDuplicate = (row) => {
    if (!row.color.trim()) return false;
    const k = `${row.color.trim().toUpperCase()}|${(row.estilo || "").trim().toUpperCase()}`;
    return (comboCount.get(k) || 0) > 1;
  };
  const duplicateCombo = [...comboCount.entries()].find(([, n]) => n > 1)?.[0]?.replace("|", " · ") || null;

  const problems = [
    !styleDescription.trim() && "Falta la descripción",
    sizes.length === 0 && "Selecciona al menos una talla",
    cells.length === 0 && "Captura al menos una cantidad",
    activeRows.some((r) => (r.estilo || "").trim().length !== 6) && "Estilo cliente de 6 caracteres en cada línea",
    duplicateCombo && `Color+estilo repetido (${duplicateCombo}) — necesita su propia orden`,
  ].filter(Boolean);
  const valid = problems.length === 0;

  const selectedCustomer = customers.find((c) => String(c.id) === String(customerId));

  // ------- save ---------------------------------------------------------
  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const total = totalToProduce === "" ? suggestedTotal : parseFloat(totalToProduce) || 0;
      const merged = {
        ...order,
        customer_id: customerId ? Number(customerId) : order?.customer_id,
        customer_name: selectedCustomer ? selectedCustomer.name : order?.customer_name,
        style_description: styleDescription,
        status,
        quantity: orderedQty,
        warehouse_stock: warehouseStock === "" ? order?.warehouse_stock : parseFloat(warehouseStock) || 0,
        extra_quantity: extraQuantity === "" ? order?.extra_quantity : parseFloat(extraQuantity) || 0,
        total_to_produce: total,
        color: preview.colors || null,
        estilo: cells[0]?.estilo || order?.estilo || null,
        customer_po: preview.customerPo || null,
        commitment_date: preview.date,
        fabric_details: preview.fabricList,
        fabrics: [...new Set(preview.fabricList.map((f) => f.name))],
        fabric_name: preview.fabricList[0]?.name || null,
        fabric_supplier: preview.fabricList[0]?.name || null,
        fabric_code: preview.fabricList[0]?.code || null,
        yield_per_piece: preview.yield,
        lines: cells.map((c) => ({ ...c })),
      };

      if (!apiOnline) {
        onSaved?.(merged, order);
        return;
      }

      const body = { styleDescription, status, totalToProduce: total, lines: cells };
      if (customerId) body.customerId = Number(customerId);
      if (warehouseStock !== "") body.warehouseStock = parseFloat(warehouseStock) || 0;
      if (extraQuantity !== "") body.extraQuantity = parseFloat(extraQuantity) || 0;

      const res = await fetch(`${API_URL}/api/production-orders/${encodeURIComponent(order.id)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });

      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 404) {
        throw new Error(
          "El servidor no tiene PUT /api/production-orders/:id — actualiza work-orders.js para poder guardar el desglose por color y talla."
        );
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la orden");

      onSaved?.({ ...merged, ...(data.workOrder || {}) }, order);
    } catch (e) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!order) return null;

  const fabricNames = fabricCatalog.map((f) => f.name);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 rounded-t-2xl shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-slate-400 mb-1">Editar orden de producción</p>
            <p className="font-mono text-sm font-bold text-slate-800 truncate">
              {order.work_order_no}
              {order.style_code && <span className="ml-2 font-normal text-slate-400">{order.style_code}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-7 overflow-y-auto">
          {/* ---------------- general ---------------- */}
          <Section title="Datos generales">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Cliente">
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldCls}>
                  {!selectedCustomer && <option value="">{order.customer_name || "Selecciona cliente…"}</option>}
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estado">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldCls}>
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Descripción del estilo">
              <textarea
                value={styleDescription}
                onChange={(e) => setStyleDescription(e.target.value)}
                rows={2}
                className={`${fieldCls} resize-none`}
              />
            </Field>
          </Section>

          {/* ---------------- sizes ---------------- */}
          <Section title="Tallas" hint="Al quitar una talla se eliminan sus cantidades al guardar.">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {TALLAS.map((t) => {
                const active = sizes.includes(t.code);
                return (
                  <button key={t.code} type="button" onClick={() => toggleSize(t.code)}
                    className={`rounded-lg border px-1 py-1.5 text-center transition-all
                      ${active ? "border-emerald-600 bg-emerald-600 text-white shadow"
                               : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400"}`}>
                    <span className="block font-mono text-xs font-bold">{t.code}</span>
                    <span className={`block text-[10px] ${active ? "text-emerald-100" : "text-slate-400"}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ---------------- breakdown ---------------- */}
          <Section
            title="Desglose por color y talla"
            hint="Cada línea es un color + estilo cliente con sus telas, entrega y cantidades."
            right={
              <span className="text-[11px] font-mono text-slate-500 shrink-0">
                {activeRows.length} línea(s) · {orderedQty.toLocaleString()} pzs
              </span>
            }
          >
            {sizes.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                Selecciona al menos una talla para capturar cantidades.
              </p>
            ) : (
              <div className="space-y-3">
                {rows.map((row, i) => {
                  const rowPieces = sizes.reduce((sum, t) => sum + (parseFloat(row.qty[t]) || 0), 0);
                  const estiloBad = row.color.trim() && (row.estilo || "").trim().length !== 6;
                  const dup = isDuplicate(row);
                  return (
                    <div key={i}
                      className={`rounded-xl border bg-slate-50/60 p-3 ${dup ? "border-rose-300" : "border-slate-200"}`}>
                      {/* card header */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Línea {i + 1}</span>
                          {row.color.trim() && (
                            <span className="font-mono text-[11px] rounded bg-white border border-slate-200 px-1.5 py-0.5 text-slate-700 truncate">
                              {row.color.trim().toUpperCase()}{row.estilo ? ` · ${row.estilo.toUpperCase()}` : ""}
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-slate-400">{rowPieces.toLocaleString()} pzs</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button type="button" onClick={() => duplicateRow(i)} title="Duplicar línea (mismas telas y entrega)"
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                            <Copy size={14} />
                          </button>
                          <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1} title="Eliminar línea"
                            className="p-1.5 rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {dup && (
                        <p className="mb-2 text-[11px] text-rose-600 flex items-center gap-1">
                          <AlertCircle size={12} /> Este color+estilo está repetido: una orden no puede contenerlo dos veces.
                        </p>
                      )}

                      {/* identity + logistics */}
                      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        <RowField label="Color" invalid={!row.color.trim()}>
                          <input value={row.color}
                            onChange={(e) => setRowField(i, "color", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
                            placeholder="NEG" className={`${cellMonoCls} tracking-widest`} />
                        </RowField>
                        <RowField label="Estilo cliente" invalid={estiloBad}>
                          <input value={row.estilo || ""}
                            onChange={(e) => setRowField(i, "estilo", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                            placeholder="FN2808"
                            className={`w-full ${controlSm} font-mono uppercase tracking-widest ${estiloBad ? "border-rose-300 bg-rose-50" : ""}`} />
                        </RowField>
                        <RowField label="PO cliente">
                          <input value={row.customerPo || ""} onChange={(e) => setRowField(i, "customerPo", e.target.value)}
                            placeholder="PO cliente" className={cellCls} />
                        </RowField>
                        <RowField label="Entrega">
                          <input type="date" value={row.deliveryDate || ""} onChange={(e) => setRowField(i, "deliveryDate", e.target.value)}
                            className={cellCls} />
                        </RowField>
                      </div>

                      {/* fabrics: name + code + rendimiento, each tela its own row */}
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
                        <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 px-0.5 pb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tela</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Código</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Rend.</span>
                          <span />
                        </div>
                        <div className="space-y-1.5">
                          {row.fabrics.map((f, j) => {
                            const typed = (f.name || "").trim();
                            const isNew = typed && !fabricNames.some((n) => n.toLowerCase() === typed.toLowerCase());
                            return (
                              <div key={j} className="space-y-1">
                                <div className="grid grid-cols-[minmax(0,1fr)_8rem_6rem_2rem] gap-2 items-center">
                                  <input value={f.name} onChange={(e) => setFabricField(i, j, "name", e.target.value)}
                                    list="edit-fabric-names" placeholder="Nombre de la tela" className={cellCls} />
                                  <input value={f.code} onChange={(e) => setFabricField(i, j, "code", e.target.value.toUpperCase())}
                                    placeholder="Código" className={cellMonoCls} />
                                  <input value={f.yield || ""} onChange={(e) => setFabricField(i, j, "yield", e.target.value.replace(/[^0-9.]/g, ""))}
                                    inputMode="decimal" placeholder="0.00" title="Rendimiento de esta tela"
                                    className={`${cellCls} font-mono text-right`} />
                                  <button type="button" onClick={() => removeFabric(i, j)} disabled={row.fabrics.length === 1}
                                    title="Quitar tela"
                                    className="h-8 w-8 flex items-center justify-center rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                {isNew && (
                                  <button type="button" disabled={savingFabric === typed}
                                    onClick={() => saveFabricToCatalog(typed, f.code)}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50">
                                    <Plus size={11} />
                                    {savingFabric === typed ? "Guardando…" : `Guardar "${typed}" en el catálogo`}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <button type="button" onClick={() => addFabric(i)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
                          <Plus size={12} /> Agregar tela
                        </button>
                      </div>

                      {/* quantities */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sizes.map((s) => (
                          <div key={s} className="w-16">
                            <span className="block text-center text-[10px] text-slate-400">
                              <span className="block font-mono text-[11px] font-bold text-slate-700">{s}</span>
                              {sizeLabel(s)}
                            </span>
                            <input value={row.qty[s] || ""} onChange={(e) => setQty(i, s, e.target.value)}
                              inputMode="numeric" placeholder="0"
                              className={`mt-0.5 w-full ${controlSm} font-mono text-center`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <datalist id="edit-fabric-names">
                  {fabricNames.map((n) => <option key={n} value={n} />)}
                </datalist>

                <button type="button" onClick={addRow}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-2
                             text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
                  <Plus size={14} /> Agregar línea
                </button>
              </div>
            )}
          </Section>

          {/* ---------------- totals ---------------- */}
          <Section title="Cantidades">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Cantidad pedida" hint="Suma del desglose">
                <input value={orderedQty} readOnly tabIndex={-1}
                  className={`w-full ${control} font-mono bg-slate-50 text-slate-500 cursor-default`} />
              </Field>
              <Field label="Stock almacén">
                <input value={warehouseStock} onChange={(e) => setWarehouseStock(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal" className={numFieldCls} />
              </Field>
              <Field label="Extras">
                <input value={extraQuantity} onChange={(e) => setExtraQuantity(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal" className={numFieldCls} />
              </Field>
              <Field label="Total a producir">
                <input value={totalToProduce} onChange={(e) => setTotalToProduce(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal" className={numFieldCls} />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <span className="text-xs text-slate-500">
                Sugerido: pedida − stock + extras = <b className="font-mono text-slate-700">{suggestedTotal.toLocaleString()}</b>
              </span>
              <button type="button" onClick={() => setTotalToProduce(String(suggestedTotal))}
                className="text-xs font-semibold text-slate-900 hover:underline">
                Usar sugerido
              </button>
            </div>
          </Section>

          {/* ---------------- header preview ---------------- */}
          <Section title="Encabezado de la orden" hint="Se calcula desde las líneas (la primera con valor). Para cambiarlo, edita la línea.">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <Preview label="Colores" value={preview.colors} />
              <Preview label="PO cliente" value={preview.customerPo} />
              <Preview label="Entrega" value={preview.date} />
              <Preview label="Telas" value={fabricSummary(preview.fabricList)} />
              <Preview label="Rendimiento" value={preview.yield == null ? "" : String(preview.yield)} />
            </div>
          </Section>

          {problems.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              <p className="font-semibold mb-1 flex items-center gap-1"><AlertCircle size={13} /> Falta por corregir</p>
              <ul className="list-disc list-inside space-y-0.5">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 rounded-b-2xl flex items-center justify-between shrink-0">
          <span className={`inline-flex items-center gap-1 text-xs ${valid ? "text-emerald-600" : "text-slate-400"}`}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            {valid ? `${cells.length} línea(s) · ${orderedQty.toLocaleString()} pzs` : "Revisa los pendientes"}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={!valid || saving}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all
                ${valid && !saving ? "bg-slate-900 text-white hover:bg-slate-700 shadow" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              {saving ? <><RefreshCw size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> Guardar cambios</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}