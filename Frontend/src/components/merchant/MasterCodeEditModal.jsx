import { useMemo, useRef, useState } from "react";
import { X, Camera, Timer, RefreshCw, Check, AlertCircle, Save, Trash2 } from "lucide-react";
import { API_URL, TIPOS, MODELOS, TALLAS, parseMasterCode } from "../../lib/masterCodeCatalog";

/*
  Edit an existing master code (fix a mistake).
  <MasterCodeEditModal
     record={record}
     apiOnline={bool}
     onClose={fn}
     onSaved={(updatedRecord, originalRecord) => {}}
  />

  When apiOnline is false the change is applied locally only (demo mode),
  mirroring how the dashboard handles delete while the API is unreachable.
*/

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Segment lengths, in code order. type modelo correlativo talla cliente color estilo
const LEN = { type: 3, modelo: 3, correlativo: 2, talla: 3, cliente: 3, color: 3, estilo: 6 };

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

function SegInput({ label, value, onChange, maxLength, placeholder, digitsOnly = false }) {
  const clean = (raw) => {
    let v = raw.toUpperCase().replace(digitsOnly ? /[^0-9]/g : /[^A-Z0-9]/g, "");
    return v.slice(0, maxLength);
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">{label}</label>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(clean(e.target.value))}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tracking-widest uppercase
                   focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
      />
      <span className={`text-[11px] font-mono ${value.length === maxLength ? "text-emerald-600" : "text-slate-400"}`}>
        {value.length}/{maxLength}
      </span>
    </div>
  );
}

export default function MasterCodeEditModal({ record, apiOnline = true, onClose, onSaved }) {
  const parts = useMemo(() => parseMasterCode(record?.code || ""), [record]);

  const seed = (k) => record?.[k] ?? parts?.[k === "type" ? "tipo" : k] ?? "";

  const [type, setType] = useState(record?.type || record?.tipo || parts.tipo || "");
  const [modelo, setModelo] = useState(seed("modelo"));
  const [correlativo, setCorrelativo] = useState(seed("correlativo"));
  const [talla, setTalla] = useState(seed("talla"));
  const [cliente, setCliente] = useState(seed("cliente"));
  const [color, setColor] = useState(seed("color"));
  const [estilo, setEstilo] = useState(seed("estilo"));
  const [description, setDescription] = useState(record?.description || "");
  const [sam, setSam] = useState(record?.sam != null ? String(record.sam) : "");

  // photo: keep | replace | remove
  const [newPhoto, setNewPhoto] = useState(null); // { file, url }
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const code = `${type}${modelo}${correlativo}${talla}${cliente}-${color}-${estilo}`;

  const valid =
    type.length === LEN.type &&
    modelo.length === LEN.modelo &&
    correlativo.length === LEN.correlativo &&
    talla.length === LEN.talla &&
    cliente.length === LEN.cliente &&
    color.length === LEN.color &&
    estilo.length === LEN.estilo &&
    description.trim().length > 0 &&
    Number(sam) > 0;

  const codeChanged = code !== record?.code;

  const currentPhotoUrl = newPhoto?.url || (removePhoto ? null : record?.photoUrl || null);

  const pickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewPhoto({ file, url: URL.createObjectURL(file) });
    setRemovePhoto(false);
  };

  const clearPhoto = () => {
    setNewPhoto(null);
    setRemovePhoto(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const uploadPhotoIfNeeded = async () => {
    if (!newPhoto?.file) return null;
    const presRes = await fetch(`${API_URL}/api/master-codes/photo-upload-url`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ filename: newPhoto.file.name, contentType: newPhoto.file.type || "image/jpeg" }),
    });
    const pres = await presRes.json();
    if (!presRes.ok || !pres.uploadUrl) throw new Error(pres.error || "No se pudo preparar la subida de la foto");
    const putRes = await fetch(pres.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": newPhoto.file.type || "application/octet-stream" },
      body: newPhoto.file,
    });
    if (!putRes.ok) throw new Error("No se pudo subir la foto a S3");
    return pres.photoKey;
  };

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const base = {
        code,
        type, modelo, correlativo, talla, cliente, color, estilo,
        description: description.trim(),
        sam: Number(sam),
      };

      if (!apiOnline) {
        // Demo mode: local-only update so the UI stays previewable.
        const updated = { ...record, ...base, photoUrl: currentPhotoUrl };
        onSaved?.(updated, record);
        return;
      }

      const photoKey = await uploadPhotoIfNeeded();
      const body = { ...base };
      if (photoKey) body.photoKey = photoKey;
      else if (removePhoto) body.removePhoto = true;

      const id = record.id ?? record._id ?? record.code;
      const res = await fetch(`${API_URL}/api/master-codes/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { window.location.href = "/login"; return; }
        throw new Error(data.error || "No se pudo guardar el código");
      }

      const mc = data.masterCode || {};
      const updated = {
        ...record,
        ...base,
        ...mc,
        code: mc.code || code,
        sam: mc.sam != null ? mc.sam : Number(sam),
        photoUrl: mc.photoUrl != null ? mc.photoUrl : currentPhotoUrl,
      };
      onSaved?.(updated, record);
    } catch (e) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!record) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">Editar código maestro</p>
            <p className="font-mono text-sm font-bold text-slate-800 break-all">{code}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {codeChanged && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>
                Estás cambiando el código en sí ({record.code} → {code}). Las órdenes de producción ya creadas
                que referencian este código <b>no</b> se reescriben automáticamente.
              </span>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tipo</p>
            <ChipGrid options={TIPOS} value={type} onChange={setType} />
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Modelo</p>
            <ChipGrid options={MODELOS} value={modelo} onChange={setModelo} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SegInput label="Correlativo" value={correlativo} onChange={setCorrelativo} maxLength={2} placeholder="01" digitsOnly />
            <SegInput label="Cliente" value={cliente} onChange={setCliente} maxLength={3} placeholder="INV" />
            <SegInput label="Color" value={color} onChange={setColor} maxLength={3} placeholder="NEG" />
            <SegInput label="Estilo" value={estilo} onChange={setEstilo} maxLength={6} placeholder="FN2808" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Talla</label>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {TALLAS.map((t) => {
                const active = talla === t.code;
                return (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => setTalla(t.code)}
                    className={`rounded-lg border px-1 py-1.5 text-center transition-all
                      ${active ? "border-emerald-600 bg-emerald-600 text-white shadow"
                               : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400"}`}
                  >
                    <span className="block font-mono text-xs font-bold">{t.code}</span>
                    <span className={`block text-[10px] ${active ? "text-emerald-100" : "text-slate-400"}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none
                         focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">SAM (minutos)</label>
              <div className="relative">
                <Timer size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number" min="0" step="0.01" value={sam}
                  onChange={(e) => setSam(e.target.value)}
                  placeholder="12.50"
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 font-mono text-sm
                             focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">Foto</label>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" id="edit-photo" />
              <label
                htmlFor="edit-photo"
                className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-3 py-3 cursor-pointer text-slate-500 hover:border-slate-500 min-h-[52px]"
              >
                {currentPhotoUrl ? (
                  <img src={currentPhotoUrl} alt="" className="h-16 object-contain rounded" />
                ) : (
                  <><Camera size={16} /><span className="text-sm">Subir foto</span></>
                )}
              </label>
              {currentPhotoUrl && (
                <button type="button" onClick={clearPhoto} className="mt-1 text-xs text-rose-600 hover:underline inline-flex items-center gap-1">
                  <Trash2 size={12} /> Quitar foto
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle size={16} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white rounded-b-2xl flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 text-xs ${valid ? "text-emerald-600" : "text-slate-400"}`}>
            {valid ? <Check size={14} /> : <AlertCircle size={14} />}
            {valid ? "Listo para guardar" : "Completa todos los campos"}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancelar
            </button>
            <button
              type="button" onClick={handleSave} disabled={!valid || saving}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all
                ${valid && !saving ? "bg-slate-900 text-white hover:bg-slate-700 shadow" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              {saving ? <><RefreshCw size={16} className="animate-spin" /> Guardando…</> : <><Save size={16} /> Guardar cambios</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}