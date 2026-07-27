import { X, Camera, Timer, Copy, Plus, Pencil } from "lucide-react";
import MasterCodeBadge from "./MasterCodeBadge";
import {
  SEGMENTS,
  parseMasterCode,
  tipoLabel,
  modeloLabel,
  tallaLabel,
} from "../../lib/masterCodeCatalog";

/*
  Detail modal for one master code.
  <MasterCodeDetailModal record={selected} onClose={fn} onCopy={fn} onEdit={fn} />
  Render only when record is set: {selected && <MasterCodeDetailModal ... />}
*/
export default function MasterCodeDetailModal({ record, onClose, onCopy, onEdit }) {
  if (!record) return null;
  const parts = parseMasterCode(record.code);

  const segmentValueLabel = (key) => {
    if (key === "tipo") return tipoLabel(parts.tipo);
    if (key === "modelo") return modeloLabel(parts.modelo);
    if (key === "talla") return tallaLabel(parts.talla);
    return null;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
              Código maestro
            </p>
            <MasterCodeBadge code={record.code} size="lg" showLabels />
          </div>
          <div className="flex gap-1 shrink-0">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(record)}
                title="Editar código"
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <Pencil size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                // Navigate to merchant page with copy parameter
                window.location.href = `/merchant?copy=${encodeURIComponent(record.code)}`;
              }}
              title="Duplicar código"
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              onClick={() => onCopy?.(record.code)}
              title="Copiar código"
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <Copy size={18} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Photo */}
          <div className="rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center min-h-56 overflow-hidden">
            {record.photoUrl ? (
              <img
                src={record.photoUrl}
                alt={record.description}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-300 py-10">
                <Camera size={32} />
                <span className="text-xs">Sin foto</span>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                Descripción
              </p>
              <p className="text-sm text-slate-700">{record.description}</p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white px-3 py-2">
              <Timer size={16} />
              <span className="font-mono text-sm font-bold">SAM {record.sam} min</span>
            </div>

            {record.createdAt && (
              <p className="text-xs text-slate-400">
                Creado: {new Date(record.createdAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Segment breakdown */}
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Desglose del código
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SEGMENTS.map((seg) => (
                <div key={seg.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
                  <p className={`font-mono text-sm font-bold ${seg.color}`}>{parts[seg.key]}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{seg.label}</p>
                  {segmentValueLabel(seg.key) && (
                    <p className="text-[11px] text-slate-500">{segmentValueLabel(seg.key)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}