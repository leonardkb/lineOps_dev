import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers, Ruler, Palette, Users, FileText, CalendarClock, Scissors,
  Plus, Trash2, Check, X, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
  Camera, ClipboardList,
} from "lucide-react";
import { API_URL, TIPOS, MODELOS, TALLAS } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";

/* -----------------------------------------------------------------------
 *  Step-by-step wizard: creates the master codes (one per size × color)
 *  AND the production order (PO) in a single submit.
 *  PO number: SKM####-<cliente>-<tipo><modelo><correlativo>
 * --------------------------------------------------------------------- */

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const STEPS = [
  { n: 1, label: "Estilo", icon: Layers },
  { n: 2, label: "Tallas y colores", icon: Palette },
  { n: 3, label: "Cliente", icon: Users },
  { n: 4, label: "Detalles y logística", icon: FileText },
  { n: 5, label: "Revisar", icon: ClipboardList },
];

// Temporada codes. Stored value is code + 2-digit year, e.g. "SU26".
const SEASONS = [
  { code: "SP", label: "Spring" },
  { code: "SU", label: "Summer" },
  { code: "FA", label: "Fall" },
  { code: "WN", label: "Winter" },
  { code: "HO", label: "Holiday" },
];

function SectionCard({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChipGrid({ options, value, onChange, cols = "grid-cols-3 sm:grid-cols-5" }) {
  return (
    <div className={`grid ${cols} gap-2`}>
      {options.map((opt) => {
        const active = value === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            onClick={() => onChange(opt.code)}
            className={`rounded-lg border px-2 py-2 text-center transition-all
              ${active ? "border-slate-900 bg-slate-900 text-white shadow"
                       : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
          >
            <span className="block font-mono text-sm font-bold tracking-wider">{opt.code}</span>
            <span className={`block text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Drop blank entries and duplicates from a line's fabric list.
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

// One labelled input inside a color-row card (step 2).
function RowField({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

export default function NuevaOrdenWizard() {
  const [step, setStep] = useState(1);

  // catalogs
  const [customers, setCustomers] = useState([]);
  const [fabrics, setFabrics] = useState([]);
  const [skmSeq, setSkmSeq] = useState("");

  // step 1 — style
  const [tipo, setTipo] = useState("");
  const [modelo, setModelo] = useState("");
  const [correlativo, setCorrelativo] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);

  // step 2 — one line per color + estilo cliente + PO cliente, each with its
  // own delivery date, fabric, fabric code, yield and size quantities.
  const [sizes, setSizes] = useState([]); // array of talla codes
  // Each line may use SEVERAL fabrics, each with its own code:
  //   fabrics: [{ name, code }, ...]
  const [colorRows, setColorRows] = useState([
    { color: "", estilo: "", qty: {}, customerPo: "", deliveryDate: "", fabrics: [{ name: "", code: "", yield: "" }] },
  ]); // qty keyed by talla; yield is captured per tela

  // step 3 — customer
  const [customerId, setCustomerId] = useState("");
  const [clienteCode, setClienteCode] = useState("");

  // step 4 — details + logistics
  const [description, setDescription] = useState("");
  const [sam, setSam] = useState("");
  const [photo, setPhoto] = useState(null);
  const [seasonCode, setSeasonCode] = useState("");
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()).slice(-2));
  const [warehouseStock, setWarehouseStock] = useState("");
  const [extraQuantity, setExtraQuantity] = useState("");

  const [saving, setSaving] = useState(false);
  const [savingFabric, setSavingFabric] = useState(null); // name being added to the catalog
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  };

  // load catalogs + next SKM sequence
  useEffect(() => {
    (async () => {
      try {
        const [custRes, fabRes, seqRes] = await Promise.all([
          fetch(`${API_URL}/api/customers`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/fabrics`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/production-orders/next-number`, { headers: authHeaders() }),
        ]);
        if (custRes.ok) setCustomers((await custRes.json()).customers || []);
        if (fabRes.ok) setFabrics((await fabRes.json()).fabrics || []);
        if (seqRes.ok) setSkmSeq((await seqRes.json()).sequence || "");
      } catch {
        showToast("⚠️ No se pudieron cargar los catálogos", true);
      }
    })();
  }, []);

  // auto-fetch correlativo when tipo+modelo chosen
  useEffect(() => {
    (async () => {
      if (tipo && modelo && !correlativo) {
        setAutoFilling(true);
        try {
          const res = await fetch(
            `${API_URL}/api/master-codes/next-correlativo?type=${tipo}&modelo=${modelo}`,
            { headers: authHeaders() }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.success) setCorrelativo(data.nextCorrelativo);
          }
        } catch { /* keep manual entry */ }
        finally { setAutoFilling(false); }
      }
    })();
  }, [tipo, modelo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------- derived -----------------------------------------------------
  const styleBase = `${tipo}${modelo}${correlativo}`;

  const cells = useMemo(() => {
    const out = [];
    for (const row of colorRows) {
      const color = row.color.trim();
      const est = (row.estilo || "").trim();
      if (!color) continue;
      const meta = {
        estilo: est,
        customerPo: (row.customerPo || "").trim() || null,
      };
      for (const talla of sizes) {
        const q = parseFloat(row.qty[talla]);
        if (!isNaN(q) && q > 0) out.push({ talla, color, ...meta, quantity: q });
      }
    }
    return out;
  }, [colorRows, sizes]);

  // Per-color estilo checks (step 2)
  const activeColorRows = colorRows.filter((r) => r.color.trim());
  const colorList = activeColorRows.map((r) => r.color.trim());
  // Same color+estilo may repeat — each repeat becomes its own PO (see poPlan).
  const allEstiloValid =
    activeColorRows.length > 0 && activeColorRows.every((r) => (r.estilo || "").trim().length === 6);

  // Build the PO buckets:
  //   • every distinct (color+estilo) line goes into ONE PO
  //   • a REPEATED (color+estilo) line opens a second PO — a PO can't hold the
  //     same color+estilo twice (unique index on work_order_id, talla, color, estilo)
  //
  // PO cliente, entrega, tela, código de tela and rendimiento travel WITH the
  // line (work_order_lines), so a single PO may hold lines with different
  // fabrics or dates. The header keeps the first line's values as a summary.
  const poPlan = useMemo(() => {
    const seen = new Set();
    let mainIdx = -1;
    const buckets = [];
    for (const row of colorRows) {
      const color = row.color.trim();
      const est = (row.estilo || "").trim();
      if (!color || est.length !== 6) continue;

      const meta = {
        estilo: est,
        customerPo: (row.customerPo || "").trim() || null,
        commitmentDate: row.deliveryDate || null,
        fabrics: cleanFabrics(row.fabrics),
      };
      const rowCells = [];
      for (const talla of sizes) {
        const q = parseFloat(row.qty[talla]);
        if (!isNaN(q) && q > 0) rowCells.push({ talla, color, ...meta, quantity: q });
      }
      if (rowCells.length === 0) continue;

      const key = `${color}|${est}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (mainIdx === -1) { buckets.push({ cells: [], main: true }); mainIdx = buckets.length - 1; }
        buckets[mainIdx].cells.push(...rowCells);
      } else {
        buckets.push({ cells: rowCells, main: false });
      }
    }
    const firstOf = (cells, k) => cells.find((c) => c[k])?.[k] || null;
    // Distinct name+code pairs across the PO's lines.
    const mergeFabrics = (cells) => {
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
    };
    return buckets
      .filter((b) => b.cells.length > 0)
      .map((b) => {
        const fabricList = mergeFabrics(b.cells);
        return {
          cells: b.cells,
          main: b.main,
          // header summary = first line that has a value
          date: firstOf(b.cells, "commitmentDate"),
          fabricList,
          fabricName: fabricList[0]?.name || null,
          fabricCode: fabricList[0]?.code || null,
          yield: fabricList[0]?.yield ?? null,
          customerPos: [...new Set(b.cells.map((c) => c.customerPo).filter(Boolean))].join(", ") || null,
          fabrics: fabricList
            .map((f) => `${f.name}${f.code ? ` (${f.code})` : ""}${f.yield ? ` · rend ${f.yield}` : ""}`)
            .join(", ") || null,
          pieces: b.cells.reduce((s, c) => s + c.quantity, 0),
          colors: [...new Set(b.cells.map((c) => c.color))].join(", "),
          estilos: [...new Set(b.cells.map((c) => c.estilo))].join(", "),
        };
      });
  }, [colorRows, sizes]);

  const orderedQty = cells.reduce((s, c) => s + c.quantity, 0);
  const totalToProduce = Math.max(
    orderedQty - (parseFloat(warehouseStock) || 0) + (parseFloat(extraQuantity) || 0), 0
  );
  const season = seasonCode ? `${seasonCode}${seasonYear}` : "";

  // ------- step handlers ----------------------------------------------
  // Order selected sizes by their position in the TALLAS catalog (smallest →
  // largest), not by click order, so the grid columns and review read naturally.
  const sizeOrder = (code) => {
    const i = TALLAS.findIndex((t) => t.code === code);
    return i === -1 ? 999 : i;
  };
  const toggleSize = (code) =>
    setSizes((s) =>
      s.includes(code)
        ? s.filter((x) => x !== code)
        : [...s, code].sort((a, b) => sizeOrder(a) - sizeOrder(b))
    );

  const setColor = (i, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, color: val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) } : r));
  const setEstiloRow = (i, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, estilo: val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) } : r));
  const setQty = (i, talla, val) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, qty: { ...r.qty, [talla]: val.replace(/[^0-9.]/g, "") } } : r));
  // Generic per-line setter for the non-normalised fields (PO cliente, entrega,
  // tela, código de tela, rendimiento).
  const setRowField = (i, key, val) =>
    setColorRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const newRow = () => ({
    color: "", estilo: "", qty: {}, customerPo: "",
    deliveryDate: "", fabrics: [{ name: "", code: "", yield: "" }],
  });

  // Register a fabric name in the catalog (POST /api/fabrics) so it shows up in
  // the suggestions from now on. The per-line CODE stays on the work order —
  // the catalog only stores names.
  const saveFabricToCatalog = async (rawName, rawCode) => {
    const name = (rawName || "").trim();
    if (!name || savingFabric) return;
    setSavingFabric(name);
    try {
      const res = await fetch(`${API_URL}/api/fabrics`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name, code: (rawCode || "").trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar la tela");
      setFabrics((f) => [...f, data.fabric].sort((a, b) => a.name.localeCompare(b.name)));
      showToast(`✅ Tela "${name}" agregada al catálogo`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`, true);
    } finally {
      setSavingFabric(null);
    }
  };

  // ---- per-line fabric list -------------------------------------------
  const setFabricField = (i, j, key, val) =>
    setColorRows((rows) => rows.map((r, idx) => {
      if (idx !== i) return r;
      return {
        ...r,
        fabrics: r.fabrics.map((f, fi) => {
          if (fi !== j) return f;
          const next = { ...f, [key]: val };
          // Picking a catalogued fabric fills its code, unless one was typed.
          if (key === "name" && !(f.code || "").trim()) {
            const hit = fabrics.find((c) => (c.name || "").toLowerCase() === val.trim().toLowerCase());
            if (hit?.code) next.code = hit.code;
          }
          return next;
        }),
      };
    }));
  const addFabric = (i) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i ? { ...r, fabrics: [...r.fabrics, { name: "", code: "", yield: "" }] } : r));
  const removeFabric = (i, j) =>
    setColorRows((rows) => rows.map((r, idx) =>
      idx === i && r.fabrics.length > 1
        ? { ...r, fabrics: r.fabrics.filter((_, fi) => fi !== j) }
        : r));
  const addColor = () => setColorRows((r) => [...r, newRow()]);
  const removeColor = (i) =>
    setColorRows((r) => (r.length === 1 ? r : r.filter((_, idx) => idx !== i)));

  const onCustomer = (id) => {
    setCustomerId(id);
    const c = customers.find((x) => String(x.id) === String(id));
    if (c?.code) setClienteCode(c.code.toUpperCase());
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Keep the File for the presigned S3 upload at submit time; the base64 is
    // only used for the on-screen preview thumbnail (not sent in the JSON body).
    const reader = new FileReader();
    reader.onload = () => setPhoto({ file, url: URL.createObjectURL(file), base64: reader.result });
    reader.readAsDataURL(file);
  };

  // ------- validation per step ----------------------------------------
  const stepValid = (s) => {
    if (s === 1) return tipo && modelo && correlativo.length === 2;
    if (s === 2) return sizes.length > 0 && cells.length > 0 && allEstiloValid;
    if (s === 3) return customerId && clienteCode.length === 3;
    if (s === 4) return description.trim() && sam && Number(sam) > 0;
    return true;
  };
  const canCreate = [1, 2, 3, 4].every(stepValid) && !saving;

  // Human-readable list of what's still blocking creation (shown on review step).
  const missing = [
    !tipo && "Tipo (paso 1)",
    !modelo && "Modelo (paso 1)",
    correlativo.length !== 2 && "Correlativo de 2 dígitos (paso 1)",
    sizes.length === 0 && "Al menos una talla (paso 2)",
    cells.length === 0 && "Cantidad en al menos una celda color × talla (paso 2)",
    !allEstiloValid && "Estilo cliente (6 caracteres) por cada color (paso 2)",
    !customerId && "Cliente (paso 3)",
    clienteCode.length !== 3 && "Código de cliente de 3 letras (paso 3)",
    !description.trim() && "Descripción (paso 4)",
    !(sam && Number(sam) > 0) && "SAM mayor a 0 (paso 4)",
  ].filter(Boolean);

  const next = () => { if (stepValid(step)) setStep((s) => Math.min(5, s + 1)); };
  const back = () => setStep((s) => Math.max(1, s - 1));

  // ------- submit ------------------------------------------------------
  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      // Upload the photo straight to S3 first (presigned PUT), so only a small
      // key travels in the JSON body — this avoids Lambda's ~6MB request limit
      // (base64 in the body was hitting a 413). One image, shared by all POs.
      let photoKey = null;
      if (photo?.file) {
        const presRes = await fetch(`${API_URL}/api/master-codes/photo-upload-url`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            filename: photo.file.name,
            contentType: photo.file.type || "image/jpeg",
          }),
        });
        const pres = await presRes.json();
        if (!presRes.ok || !pres.uploadUrl) throw new Error(pres.error || "No se pudo preparar la subida de la foto");
        const putRes = await fetch(pres.uploadUrl, { method: "PUT", body: photo.file });
        if (!putRes.ok) throw new Error("No se pudo subir la foto a S3");
        photoKey = pres.photoKey;
      }

      // One atomic request. The backend creates one PO per bucket in poPlan
      // (distinct color+estilo rows share the first PO; each repeat is its own PO)
      // and auto-numbers them (SKM####).
      const payload = {
        tipo, modelo, correlativo,
        clienteCode, customerId: Number(customerId),
        description: description.trim(), sam: Number(sam),
        photoKey,
        orders: poPlan.map((p) => ({
          // Each cell carries its own customerPo, commitmentDate, fabricName,
          // fabricCode and yield -> work_order_lines. The order-level values
          // below are the header summary (and the fallback for blank lines).
          lines: p.cells,
          commitmentDate: p.date,
          fabrics: p.fabricList,
          fabricName: p.fabricName,
          fabricCode: p.fabricCode,
          yield: p.yield,
        })),
        season: season || null,
        // Stock/extras count once — the backend applies them to the first PO only.
        warehouseStock: parseFloat(warehouseStock) || 0,
        extraQuantity: parseFloat(extraQuantity) || 0,
      };
      const res = await fetch(`${API_URL}/api/production-orders`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron crear las órdenes");

      const nos = (data.workOrders || [data.workOrder]).filter(Boolean).map((w) => w.work_order_no);
      showToast(`✅ ${nos.length} orden(es) creada(s): ${nos.join(", ")}`);
      // reset
      setStep(1);
      setTipo(""); setModelo(""); setCorrelativo("");
      setSizes([]); setColorRows([newRow()]);
      setCustomerId(""); setClienteCode("");
      setDescription(""); setSam(""); setPhoto(null);
      setSeasonCode(""); setWarehouseStock(""); setExtraQuantity("");
      if (fileRef.current) fileRef.current.value = "";
      const seqRes = await fetch(`${API_URL}/api/production-orders/next-number`, { headers: authHeaders() });
      if (seqRes.ok) setSkmSeq((await seqRes.json()).sequence || "");
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    } finally {
      setSaving(false);
    }
  };

  const fabricNames = fabrics.map((f) => f.name);
  const sizeLabel = (code) => TALLAS.find((t) => t.code === code)?.label || "";

  return (
    <div className="min-h-screen bg-slate-100">
      <MerchantNavbar title="Nueva orden · Código maestro + PO" showRefresh={false} />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Stepper */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="flex items-center">
            {STEPS.map((s, idx) => {
              const done = s.n < step;
              const active = s.n === step;
              return (
                <div key={s.n} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => s.n < step && setStep(s.n)}
                    className={`flex items-center gap-2 ${s.n < step ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                      ${active ? "bg-slate-900 text-white"
                        : done ? "bg-emerald-500 text-white"
                        : "bg-slate-200 text-slate-500"}`}>
                      {done ? <Check size={14} /> : s.n}
                    </span>
                    <span className={`text-xs font-medium hidden sm:block ${active ? "text-slate-900" : "text-slate-500"}`}>
                      {s.label}
                    </span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${s.n < step ? "bg-emerald-400" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 1 — Style */}
        {step === 1 && (
          <SectionCard icon={Layers} title="1 · Estilo" subtitle="Tipo y modelo — el correlativo se genera solo">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tipo</p>
            <ChipGrid options={TIPOS} value={tipo} onChange={(v) => { setTipo(v); setCorrelativo(""); }} />
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mt-5 mb-2">Modelo</p>
            <ChipGrid options={MODELOS} value={modelo} onChange={(v) => { setModelo(v); setCorrelativo(""); }} />
            <div className="mt-5 flex items-end gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Correlativo</label>
                <input
                  value={correlativo}
                  onChange={(e) => setCorrelativo(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                  placeholder="01"
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest text-center
                             focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">{autoFilling ? "Cargando…" : "2 dígitos · auto"}</p>
              </div>
              {styleBase.length === 8 && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <span className="text-[11px] text-slate-500 uppercase tracking-wide">Estilo</span>
                  <p className="font-mono text-sm font-bold text-slate-800">{styleBase}</p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Step 2 — Sizes + colors grid */}
        {step === 2 && (
          <SectionCard icon={Palette} title="2 · Tallas, colores y cantidades" subtitle="Cada línea lleva su propio estilo cliente, PO, entrega, tela, rendimiento y cantidades por talla">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tallas</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
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

            {sizes.length === 0 ? (
              <p className="text-sm text-slate-400 mt-4">Selecciona al menos una talla para capturar cantidades.</p>
            ) : (
              <>
              <div className="mt-5 space-y-3">
                {colorRows.map((row, i) => {
                  const rowPieces = sizes.reduce((sum, t) => sum + (parseFloat(row.qty[t]) || 0), 0);
                  const estiloBad = row.color.trim() && (row.estilo || "").trim().length !== 6;
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Línea {i + 1}
                          <span className="ml-2 font-mono text-slate-400 normal-case">
                            {rowPieces.toLocaleString()} pzs
                          </span>
                        </span>
                        <button type="button" onClick={() => removeColor(i)} disabled={colorRows.length === 1}
                          className="p-1.5 rounded hover:bg-rose-100 text-rose-500 disabled:opacity-30">
                          <Trash2 size={15} />
                        </button>
                      </div>

                      {/* Identity + logistics for this line */}
                      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        <RowField label="Color">
                          <input value={row.color} onChange={(e) => setColor(i, e.target.value)} placeholder="NEG"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase tracking-widest
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                        <RowField label="Estilo cliente">
                          <input value={row.estilo || ""} onChange={(e) => setEstiloRow(i, e.target.value)} placeholder="FN2808"
                            className={`w-full rounded-lg border px-2 py-1.5 font-mono text-sm uppercase tracking-widest
                                       focus:outline-none focus:ring-2 focus:ring-slate-900
                                       ${estiloBad ? "border-rose-300 bg-rose-50" : "border-slate-300"}`} />
                        </RowField>
                        <RowField label="PO cliente" hint="PO del cliente para esta línea">
                          <input value={row.customerPo || ""} onChange={(e) => setRowField(i, "customerPo", e.target.value)}
                            placeholder="PO cliente"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                        <RowField label="Entrega">
                          <input type="date" value={row.deliveryDate || ""} onChange={(e) => setRowField(i, "deliveryDate", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </RowField>
                      </div>

                      {/* Telas: one or more per line, each with its own code and rendimiento */}
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
                                    list="fabric-names" placeholder="Nombre de la tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.code} onChange={(e) => setFabricField(i, j, "code", e.target.value.toUpperCase())}
                                    placeholder="Código"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm uppercase
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
                                  <input value={f.yield || ""} onChange={(e) => setFabricField(i, j, "yield", e.target.value.replace(/[^0-9.]/g, ""))}
                                    inputMode="decimal" placeholder="0.00" title="Rendimiento de esta tela"
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm text-right
                                               focus:outline-none focus:ring-2 focus:ring-slate-900" />
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

                      {/* Quantities per size for this line */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sizes.map((s) => (
                          <div key={s} className="w-16">
                            <span className="block text-center text-[10px] text-slate-400">
                              <span className="block font-mono text-[11px] font-bold text-slate-700">{s}</span>
                              {sizeLabel(s)}
                            </span>
                            <input value={row.qty[s] || ""} onChange={(e) => setQty(i, s, e.target.value)}
                              inputMode="numeric" placeholder="0"
                              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm text-center
                                         focus:outline-none focus:ring-2 focus:ring-slate-900" />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <datalist id="fabric-names">
                  {fabricNames.map((n) => <option key={n} value={n} />)}
                </datalist>
                <button type="button" onClick={addColor}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">
                  <Plus size={14} /> Agregar línea
                </button>
                <p className="text-xs text-slate-500 mt-3">
                  {cells.length} combinación(es) · {orderedQty.toLocaleString()} piezas · {poPlan.length} orden(es) de producción · {new Set(cells.map((c) => `${c.talla}|${c.color}|${c.estilo}`)).size} código(s) maestro(s)
                </p>
                {poPlan.length > 1 && (
                  <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    Se crearán {poPlan.length} órdenes (números automáticos): todas las líneas van en una sola orden, y cada color+estilo repetido abre una orden aparte.
                  </p>
                )}
              </div>
              </>
            )}
          </SectionCard>
        )}

        {/* Step 3 — Customer */}
        {step === 3 && (
          <SectionCard icon={Users} title="3 · Cliente" subtitle="Cliente de la orden (el estilo cliente se define por color en el paso 2)">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Cliente</label>
                <select value={customerId} onChange={(e) => onCustomer(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                  <option value="">Selecciona un cliente…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Código cliente</label>
                <input value={clienteCode} onChange={(e) => setClienteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
                  placeholder="INV"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-900" />
                <p className="text-[11px] text-slate-400 mt-1">3 letras · del cliente</p>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Step 4 — Details + logistics */}
        {step === 4 && (
          <div className="space-y-6">
            <SectionCard icon={FileText} title="4 · Detalles del estilo" subtitle="Descripción y SAM (requeridos para el código maestro)">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Descripción</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                    placeholder="Pantalón dama invierno, tela franela, color negro…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">SAM (minutos)</label>
                  <input type="number" min="0" step="0.01" value={sam} onChange={(e) => setSam(e.target.value)} placeholder="12.50"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Foto (opcional)</label>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" id="wiz-photo" />
                  <label htmlFor="wiz-photo"
                    className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 cursor-pointer text-slate-500 hover:border-slate-500">
                    {photo ? <img src={photo.url} alt="" className="h-16 object-contain rounded" /> : (<><Camera size={16} /><span className="text-sm">Subir foto</span></>)}
                  </label>
                </div>
              </div>
            </SectionCard>

            <SectionCard icon={CalendarClock} title="Logística" subtitle="Temporada, stock y extras (entrega y tela se capturan por línea en el paso 2)">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Temporada</label>
                  <div className="flex gap-2">
                    <select value={seasonCode} onChange={(e) => setSeasonCode(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                      <option value="">Temporada…</option>
                      {SEASONS.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.label}</option>)}
                    </select>
                    <input value={seasonYear}
                      onChange={(e) => setSeasonYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      inputMode="numeric" placeholder="26"
                      className="w-16 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{season ? `= ${season}` : "código + año (ej. SU26)"}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Stock almacén</label>
                    <input value={warehouseStock} onChange={(e) => setWarehouseStock(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase">Extras</label>
                    <input value={extraQuantity} onChange={(e) => setExtraQuantity(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {/* Step 5 — Review */}
        {step === 5 && (
          <SectionCard icon={ClipboardList} title="5 · Revisar y crear" subtitle={`Se creará${poPlan.length === 1 ? "" : "n"} ${poPlan.length} orden(es) de producción — una por color+estilo repetido`}>
            <div className="rounded-lg bg-slate-900 text-white px-4 py-3 mb-4">
              <span className="text-[11px] uppercase tracking-widest text-slate-400">
                {poPlan.length === 1 ? "N° de orden" : `${poPlan.length} órdenes de producción`}
              </span>
              <div className="mt-1 space-y-1.5">
                {poPlan.length === 0 ? (
                  <p className="font-mono text-lg font-bold">—</p>
                ) : (
                  poPlan.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <p className="font-mono text-sm font-bold">
                        PO {i + 1} <span className="text-slate-400 font-normal">· N° automático</span>
                      </p>
                      <span className="text-xs text-slate-300">
                        <b className="font-mono text-white">{p.colors}</b> · {p.estilos} · {p.pieces.toLocaleString()} pzs
                        {" · "}
                        <span className="text-slate-400">
                          entrega {p.date || "—"}
                          {" · PO "}{p.customerPos || "—"}
                          {" · tela "}{p.fabrics || "—"}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Info label="Estilo" value={styleBase} />
              <Info label="Cliente" value={customers.find((c) => String(c.id) === String(customerId))?.name || "—"} />
              <Info label="Estilos cliente" value={[...new Set(cells.map((c) => c.estilo))].join(", ") || "—"} />
              <Info label="Tallas" value={sizes.join(", ") || "—"} />
              <Info label="Colores" value={[...new Set(cells.map((c) => c.color))].join(", ") || "—"} />
              <Info label="Códigos maestros" value={String(new Set(cells.map((c) => `${c.talla}|${c.color}|${c.estilo}`)).size)} />
              <Info label="Cantidad pedida" value={orderedQty.toLocaleString()} />
              <Info label="SAM" value={sam ? `${sam} min` : "—"} />
              <Info label="Temporada" value={season || "—"} />
              <Info label="Total a producir" value={totalToProduce.toLocaleString()} />
            </div>

            {/* Color → estilo mapping (each color = its own estilo cliente) */}
            {colorList.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Estilo por color</p>
                <div className="flex flex-wrap gap-2">
                  {activeColorRows.map((r, i) => (
                    <span key={`${r.color}|${r.estilo}|${i}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <span className="font-mono text-sm font-bold text-slate-800">{r.color}</span>
                      <span className="text-slate-300">→</span>
                      <span className={`font-mono text-sm font-bold ${(r.estilo || "").length === 6 ? "text-slate-800" : "text-rose-500"}`}>
                        {r.estilo || "—"}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {missing.length > 0 && (
              <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-3">
                <p className="text-xs font-semibold text-rose-700 flex items-center gap-1 mb-1">
                  <AlertCircle size={14} /> Falta completar:
                </p>
                <ul className="text-xs text-rose-600 list-disc pl-5 space-y-0.5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
          </SectionCard>
        )}

        {/* Footer nav */}
        <div className="flex items-center justify-between">
          <button type="button" onClick={back} disabled={step === 1}
            className="inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
            <ChevronLeft size={16} /> Atrás
          </button>

          {step < 5 ? (
            <button type="button" onClick={next} disabled={!stepValid(step)}
              className={`inline-flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${stepValid(step) ? "bg-slate-900 text-white hover:bg-slate-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              Siguiente <ChevronRight size={16} />
            </button>
          ) : (
            <button type="button" onClick={handleCreate} disabled={!canCreate}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all
                ${canCreate ? "bg-slate-900 text-white hover:bg-slate-700 shadow-lg" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
              {saving ? (<><RefreshCw size={16} className="animate-spin" /> Creando…</>) : (<><Plus size={16} /> {poPlan.length > 1 ? `Crear ${poPlan.length} órdenes` : "Crear código maestro y PO"}</>)}
            </button>
          )}
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

function Info({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-mono text-sm font-bold text-slate-800 break-words">{value}</p>
    </div>
  );
}