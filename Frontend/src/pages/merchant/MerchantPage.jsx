import { useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Tag,
  Layers,
  Ruler,
  Palette,
  Hash,
  Camera,
  Timer,
  FileText,
  Plus,
  Check,
  X,
  Trash2,
  Copy,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";
import MerchantNavbar from "../../components/merchant/MerchantNavbar";
// ------------------------------------------------------------------
//  Catalog data
// ------------------------------------------------------------------

const TYPES = [
  { code: "DAM", label: "Dama" },
  { code: "CAB", label: "Caballero" },
  { code: "NNA", label: "Niña" },
  { code: "NNO", label: "Niño" },
  { code: "ACC", label: "Accesorios" },
];

const MODELOS = [
  { code: "PAN", label: "Pantalón" },
  { code: "CHA", label: "Chaqueta" },
  { code: "SHO", label: "Short" },
  { code: "BKR", label: "Biker" },
  { code: "LEG", label: "Legging" },
  { code: "TSH", label: "T-Shirt" },
  { code: "POL", label: "Polo" },
  { code: "BOD", label: "Body" },
  { code: "BLS", label: "Blusa" },
  { code: "PTS", label: "Pants Set" },
];

const TALLAS = [
  { code: "130", label: "XXXS" },
  { code: "132", label: "XXS" },
  { code: "134", label: "XS" },
  { code: "136", label: "S" },
  { code: "138", label: "M" },
  { code: "140", label: "L" },
  { code: "142", label: "XL" },
  { code: "144", label: "XXL" },
  { code: "004", label: "I-XS" },
  { code: "006", label: "S" },
  { code: "008", label: "M" },
  { code: "010", label: "L" },
];

const SEGMENTS = [
  { key: "type", len: 3, label: "Tipo", color: "text-sky-600" },
  { key: "modelo", len: 3, label: "Modelo", color: "text-violet-600" },
  { key: "correlativo", len: 2, label: "Corr.", color: "text-amber-600" },
  { key: "talla", len: 3, label: "Talla", color: "text-emerald-600" },
  { key: "cliente", len: 3, label: "Cliente", color: "text-rose-600" },
  { key: "color", len: 3, label: "Color", color: "text-fuchsia-600" },
  { key: "estilo", len: 6, label: "Estilo cliente", color: "text-slate-700" },
];

const TOTAL_LEN = SEGMENTS.reduce((s, seg) => s + seg.len, 0); // 23

// ------------------------------------------------------------------
//  Small building blocks
// ------------------------------------------------------------------

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

function ChipGrid({ options, value, onChange, cols = "grid-cols-5" }) {
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
              ${active
                ? "border-slate-900 bg-slate-900 text-white shadow"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
          >
            <span className="block font-mono text-sm font-bold tracking-wider">{opt.code}</span>
            <span className={`block text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TextSegmentInput({ label, value, onChange, maxLength, placeholder, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest uppercase
                     focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
        />
        {children}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[11px] text-slate-400">{hint}</span>
        <span className={`text-[11px] font-mono ${value.length === maxLength ? "text-emerald-600" : "text-slate-400"}`}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}

function MasterCodePreview({ values }) {
  const filled = SEGMENTS.every((s) => (values[s.key] || "").length === s.len);
  const totalChars = SEGMENTS.reduce((n, s) => n + (values[s.key] || "").length, 0);

  return (
    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Código maestro
        </span>
        <span
          className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full
            ${filled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}
        >
          {filled ? <Check size={12} /> : <AlertCircle size={12} />}
          {totalChars}/{TOTAL_LEN} dígitos
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-x-1 gap-y-3">
        {SEGMENTS.map((seg) => {
          const v = values[seg.key] || "";
          const complete = v.length === seg.len;
          return (
            <div key={seg.key} className="flex items-end">
              {(seg.key === "color" || seg.key === "estilo") && (
                <span className="font-mono text-2xl font-bold text-slate-400 px-0.5 pb-5">-</span>
              )}
              <div className="flex flex-col items-center">
                <span
                  className={`font-mono text-2xl font-bold tracking-wider ${
                    complete ? seg.color : "text-slate-300"
                  }`}
                >
                  {v.padEnd(seg.len, "·")}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">
                  {seg.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
//  Multi‑size duplicate modal
// ------------------------------------------------------------------

function SizeDuplicatorModal({ isOpen, onClose, onConfirm, currentTalla }) {
  const [selectedSizes, setSelectedSizes] = useState([]);
  const [loading, setLoading] = useState(false);

  // Auto-select the current talla by default
  useEffect(() => {
    if (isOpen) {
      setSelectedSizes([currentTalla]);
    }
  }, [isOpen, currentTalla]);

  if (!isOpen) return null;

  const toggleSize = (code) => {
    setSelectedSizes((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]
    );
  };

  const handleConfirm = () => {
    if (selectedSizes.length === 0) return;
    onConfirm(selectedSizes);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-lg font-semibold text-slate-800">Duplicar para múltiples tallas</h2>
          <p className="text-sm text-slate-500">Selecciona las tallas que deseas crear</p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
            {TALLAS.map((t) => {
              const isChecked = selectedSizes.includes(t.code);
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => toggleSize(t.code)}
                  className={`rounded-lg border px-3 py-2 text-center transition-all
                    ${isChecked
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
                >
                  <span className="block font-mono text-sm font-bold">{t.code}</span>
                  <span className="block text-xs text-slate-400">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {selectedSizes.length} talla{selectedSizes.length !== 1 ? "s" : ""} seleccionada
              {selectedSizes.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => setSelectedSizes(TALLAS.map((t) => t.code))}
              className="text-xs text-slate-500 hover:underline"
            >
              Seleccionar todas
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedSizes.length === 0 || loading}
            className={`px-6 py-2 text-sm font-semibold rounded-lg shadow-sm
              ${selectedSizes.length === 0 || loading
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-700"}`}
          >
            {loading ? "Creando..." : `Crear ${selectedSizes.length} código${selectedSizes.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
//  Main component
// ------------------------------------------------------------------

export default function MerchantPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const copyCodeParam = searchParams.get("copy");

  const emptyForm = {
    type: "",
    modelo: "",
    correlativo: "",
    talla: "",
    cliente: "",
    color: "",
    estilo: "",
  };

  const [form, setForm] = useState(emptyForm);
  const [description, setDescription] = useState("");
  const [sam, setSam] = useState("");
  const [photo, setPhoto] = useState(null);
  const [records, setRecords] = useState([]);
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [isLoadingDuplicate, setIsLoadingDuplicate] = useState(false);
  const [showSizeModal, setShowSizeModal] = useState(false);
  const fileRef = useRef(null);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const masterCode = useMemo(
    () =>
      `${form.type}${form.modelo}${form.correlativo}${form.talla}${form.cliente}-${form.color}-${form.estilo}`,
    [form]
  );

  const codeComplete = SEGMENTS.every((s) => (form[s.key] || "").length === s.len);
  const detailsComplete = description.trim() && sam && Number(sam) > 0;
  const duplicate = records.some((r) => r.code === masterCode);

  // Load duplicate from URL parameter
  useEffect(() => {
    const loadCodeForDuplicate = async () => {
      if (copyCodeParam) {
        setIsLoadingDuplicate(true);
        try {
          const token = localStorage.getItem("token");
          const response = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(copyCodeParam)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            setForm({
              type: data.type || "",
              modelo: data.modelo || "",
              correlativo: data.correlativo || "",
              talla: data.talla || "",
              cliente: data.cliente || "",
              color: data.color || "",
              estilo: data.estilo || "",
            });
            setDescription(data.description || "");
            setSam(data.sam ? data.sam.toString() : "");
            showToast(`📋 Código cargado para duplicar: ${data.code}`);
            setSearchParams({});
          } else {
            showToast("❌ Error al cargar el código", true);
          }
        } catch (err) {
          console.error("Error loading code for duplicate:", err);
          showToast("❌ Error al cargar el código para duplicar", true);
        } finally {
          setIsLoadingDuplicate(false);
        }
      }
    };
    loadCodeForDuplicate();
  }, [copyCodeParam, setSearchParams]);

  // Auto-fetch correlativo (skip when duplicating)
  useEffect(() => {
    const autoFillCorrelativo = async () => {
      if (!isLoadingDuplicate && form.type && form.modelo && !form.correlativo) {
        setIsAutoFilling(true);
        try {
          const token = localStorage.getItem("token");
          const response = await fetch(
            `${API_URL}/api/master-codes/next-correlativo?type=${form.type}&modelo=${form.modelo}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setForm((f) => ({ ...f, correlativo: data.nextCorrelativo }));
            }
          }
        } catch (err) {
          console.debug("Could not auto-fill correlativo:", err.message);
        } finally {
          setIsAutoFilling(false);
        }
      }
    };
    autoFillCorrelativo();
  }, [form.type, form.modelo, isLoadingDuplicate]);

  // Load existing master codes on mount
  useEffect(() => {
    fetchMasterCodes();
  }, []);

  const fetchMasterCodes = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/api/master-codes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to fetch master codes");
      const data = await response.json();
      setRecords(
        data.map((r) => ({
          ...r,
          createdAt: new Date(r.createdAt).toLocaleString(),
        }))
      );
    } catch (err) {
      console.error("Error fetching master codes:", err);
    }
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhoto({ file, url: URL.createObjectURL(file), base64: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  // Save a single code (existing logic)
  const handleSave = async () => {
    if (!codeComplete || !detailsComplete || duplicate) return;
    await createSingleCode();
  };

  const createSingleCode = async (tallaOverride = null) => {
    const tallaToUse = tallaOverride || form.talla;
    const codeToCreate = `${form.type}${form.modelo}${form.correlativo}${tallaToUse}${form.cliente}-${form.color}-${form.estilo}`;

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/api/master-codes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: codeToCreate,
          type: form.type,
          modelo: form.modelo,
          correlativo: form.correlativo,
          talla: tallaToUse,
          cliente: form.cliente,
          color: form.color,
          estilo: form.estilo,
          description: description.trim(),
          sam: Number(sam),
          photoBase64: photo?.base64 || null,
          photoFilename: photo?.file?.name || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create master code");

      // Add to local list
      setRecords((r) => [
        {
          code: codeToCreate,
          type: form.type,
          modelo: form.modelo,
          correlativo: form.correlativo,
          talla: tallaToUse,
          cliente: form.cliente,
          color: form.color,
          estilo: form.estilo,
          description: description.trim(),
          sam: Number(sam),
          photoUrl: data.masterCode?.photoUrl || photo?.url || null,
          createdAt: new Date().toLocaleString(),
        },
        ...r,
      ]);
      return { success: true, code: codeToCreate };
    } catch (err) {
      console.error("Error saving master code:", err);
      showToast(`❌ Error: ${err.message}`, true);
      return { success: false, error: err.message };
    }
  };

  // Handle multi‑size duplicate
  const handleMultiSizeDuplicate = async (selectedSizes) => {
    if (selectedSizes.length === 0) return;
    setIsLoading(true);
    let created = 0;
    let failed = 0;

    for (const talla of selectedSizes) {
      const result = await createSingleCode(talla);
      if (result.success) {
        created++;
      } else {
        failed++;
      }
    }

    setShowSizeModal(false);
    setIsLoading(false);

    if (created > 0) {
      showToast(`✅ ${created} código${created > 1 ? "s" : ""} creado${created > 1 ? "s" : ""}`);
      // Reset form after batch creation (optional)
      setForm({
        type: form.type,
        modelo: form.modelo,
        correlativo: "",
        talla: "",
        cliente: "",
        color: "",
        estilo: "",
      });
      setDescription("");
      setSam("");
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    if (failed > 0) {
      showToast(`⚠️ ${failed} código${failed > 1 ? "s" : ""} falló`, true);
    }
  };

  const handleDelete = async (code) => {
    if (!window.confirm(`¿Eliminar el código ${code}?`)) return;
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(code)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete");
      }
      setRecords((r) => r.filter((record) => record.code !== code));
      showToast("✅ Código eliminado");
    } catch (err) {
      console.error("Error deleting master code:", err);
      showToast(`❌ Error: ${err.message}`, true);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
    showToast("📋 Copiado al portapapeles");
  };

  const refreshCorrelativo = async () => {
    if (!form.type || !form.modelo) {
      showToast("⚠️ Selecciona Tipo y Modelo primero", true);
      return;
    }
    setIsAutoFilling(true);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${API_URL}/api/master-codes/next-correlativo?type=${form.type}&modelo=${form.modelo}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setForm((f) => ({ ...f, correlativo: data.nextCorrelativo }));
          showToast("🔄 Correlativo actualizado");
        }
      } else {
        showToast("❌ Error al obtener correlativo", true);
      }
    } catch (err) {
      showToast("❌ Error al obtener correlativo", true);
    } finally {
      setIsAutoFilling(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
       <MerchantNavbar
        title="Merchant · Códigos maestros"
        onRefresh={fetchMasterCodes}
        isRefreshing={isLoading}
      />

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-6">
          <SectionCard icon={Layers} title="1 · Tipo y modelo" subtitle="Género de la prenda y modelo">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tipo</p>
            <ChipGrid options={TYPES} value={form.type} onChange={set("type")} cols="grid-cols-3 sm:grid-cols-5" />
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mt-5 mb-2">Modelo</p>
            <ChipGrid options={MODELOS} value={form.modelo} onChange={set("modelo")} cols="grid-cols-3 sm:grid-cols-5" />
          </SectionCard>

          <SectionCard icon={Ruler} title="2 · Correlativo y talla" subtitle="Consecutivo del modelo y talla equivalente">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TextSegmentInput
                label="Correlativo"
                value={form.correlativo}
                onChange={(v) => set("correlativo")(v.replace(/[^0-9]/g, ""))}
                maxLength={2}
                placeholder="01"
                hint={isAutoFilling ? "Cargando..." : "2 dígitos · auto-generado"}
              >
                {form.type && form.modelo && (
                  <button
                    type="button"
                    onClick={refreshCorrelativo}
                    disabled={isAutoFilling}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Auto-generar siguiente correlativo"
                  >
                    <RefreshCw size={14} className={isAutoFilling ? "animate-spin" : "hover:rotate-180 transition-transform duration-300"} />
                  </button>
                )}
              </TextSegmentInput>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Talla</label>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {TALLAS.map((t) => {
                    const active = form.talla === t.code;
                    return (
                      <button
                        key={t.code}
                        type="button"
                        onClick={() => set("talla")(t.code)}
                        className={`rounded-lg border px-1 py-1.5 text-center transition-all
                          ${active
                            ? "border-emerald-600 bg-emerald-600 text-white shadow"
                            : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400"}`}
                      >
                        <span className="block font-mono text-xs font-bold">{t.code}</span>
                        <span className={`block text-[10px] ${active ? "text-emerald-100" : "text-slate-400"}`}>
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={Palette} title="3 · Cliente, color y estilo" subtitle="Identificadores del cliente">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TextSegmentInput
                label="Cliente"
                value={form.cliente}
                onChange={set("cliente")}
                maxLength={3}
                placeholder="INV"
                hint="3 letras"
              />
              <TextSegmentInput
                label="Color"
                value={form.color}
                onChange={set("color")}
                maxLength={3}
                placeholder="NEG"
                hint="3 letras"
              />
              <TextSegmentInput
                label="Estilo cliente"
                value={form.estilo}
                onChange={set("estilo")}
                maxLength={6}
                placeholder="FN2808"
                hint="6 caracteres"
              />
            </div>
          </SectionCard>

          <SectionCard icon={FileText} title="4 · Detalles del código" subtitle="Descripción, foto y SAM">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Descripción
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Pantalón dama invierno, tela franela, color negro…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  Foto de la prenda
                </label>
                <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" id="photo-input" />
                <label
                  htmlFor="photo-input"
                  className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300
                             px-3 py-6 cursor-pointer text-slate-500 hover:border-slate-500 hover:text-slate-700 transition-colors"
                >
                  {photo ? (
                    <img src={photo.url} alt="Prenda" className="h-24 object-contain rounded" />
                  ) : (
                    <>
                      <Camera size={18} />
                      <span className="text-sm">Subir foto</span>
                    </>
                  )}
                </label>
                {photo && (
                  <button
                    type="button"
                    onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="mt-1 text-xs text-rose-600 hover:underline inline-flex items-center gap-1"
                  >
                    <X size={12} /> Quitar foto
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                  SAM (minutos)
                </label>
                <div className="relative">
                  <Timer size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={sam}
                    onChange={(e) => setSam(e.target.value)}
                    placeholder="12.50"
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 font-mono text-sm
                               focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Standard Allowed Minutes de la prenda</p>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-6 space-y-6">
            <MasterCodePreview values={form} />

            {duplicate && (
              <div className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <AlertCircle size={16} /> Este código maestro ya existe.
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!codeComplete || !detailsComplete || duplicate || isLoading}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all
                  ${codeComplete && detailsComplete && !duplicate && !isLoading
                    ? "bg-slate-900 text-white hover:bg-slate-700 shadow-lg"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
              >
                {isLoading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Crear código maestro
                  </>
                )}
              </button>

              {codeComplete && detailsComplete && !duplicate && !isLoading && (
                <button
                  type="button"
                  onClick={() => setShowSizeModal(true)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all
                             bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300"
                >
                  <Layers size={16} />
                  Duplicar para múltiples tallas
                </button>
              )}

              {!codeComplete && (
                <p className="text-xs text-slate-500 text-center">
                  Completa los {TOTAL_LEN} dígitos del código para continuar.
                </p>
              )}
              {codeComplete && !detailsComplete && (
                <p className="text-xs text-slate-500 text-center">
                  Agrega la descripción y el SAM para guardar.
                </p>
              )}
            </div>

            {/* Created codes list */}
            <SectionCard icon={Hash} title="Códigos creados" subtitle={`${records.length} en la base de datos`}>
              {records.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  No hay códigos guardados. Crea el primero con el formulario.
                </p>
              ) : (
                <ul className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {records.map((r) => (
                    <li key={r.code} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {r.photoUrl ? (
                            <img src={r.photoUrl} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" />
                          ) : (
                            <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center text-slate-400">
                              <Camera size={16} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-bold text-slate-800 truncate">{r.code}</p>
                            <p className="text-xs text-slate-500 truncate">{r.description}</p>
                            <p className="text-[11px] text-slate-400">
                              SAM {r.sam} min · {r.createdAt}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyCode(r.code)}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                            title="Copiar código"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(r.code)}
                            className="p-1.5 rounded hover:bg-rose-100 text-rose-500"
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      </main>

      {/* Multi‑size modal */}
      <SizeDuplicatorModal
        isOpen={showSizeModal}
        onClose={() => setShowSizeModal(false)}
        onConfirm={handleMultiSizeDuplicate}
        currentTalla={form.talla}
      />

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