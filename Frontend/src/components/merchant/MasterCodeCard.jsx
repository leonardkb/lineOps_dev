import { useState } from "react";
import { Camera, Timer, Copy, Trash2, Plus, ZoomIn, X, Pencil } from "lucide-react";
import MasterCodeBadge from "./MasterCodeBadge";
import { tipoLabel, modeloLabel, tallaLabel } from "../../lib/masterCodeCatalog";

/*
  Compact card: small photo on the LEFT, details on the RIGHT.
  Clicking the thumbnail opens a full-size viewer; clicking the rest opens detail.
  <MasterCodeCard record={r} onOpen={fn} onCopy={fn} onDuplicate={fn} onEdit={fn} onDelete={fn} />
*/
export default function MasterCodeCard({ record, onOpen, onCopy, onDuplicate, onEdit, onDelete }) {
  const [zoom, setZoom] = useState(false);

  return (
    <>
      <div
        className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-slate-300
                   transition-all cursor-pointer group flex overflow-hidden"
        onClick={() => onOpen?.(record)}
      >
        {/* Left: small thumbnail (click to view) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (record.photoUrl) setZoom(true); }}
          className="relative w-20 h-20 shrink-0 bg-slate-100 flex items-center justify-center overflow-hidden"
          title={record.photoUrl ? "Ver foto" : "Sin foto"}
        >
          {record.photoUrl ? (
            <>
              <img src={record.photoUrl} alt={record.description} className="w-full h-full object-cover" />
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </span>
            </>
          ) : (
            <Camera size={20} className="text-slate-300" />
          )}
        </button>

        {/* Right: details */}
        <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
          <MasterCodeBadge code={record.code} size="sm" />
          <p className="text-xs text-slate-600 line-clamp-1">{record.description}</p>

          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-1.5 py-0.5">
              {tipoLabel(record.tipo || record.type)}
            </span>
            <span className="text-[10px] bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-1.5 py-0.5">
              {modeloLabel(record.modelo)}
            </span>
            <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-1.5 py-0.5">
              {record.talla} · {tallaLabel(record.talla)}
            </span>
          </div>

          <div className="flex items-center justify-between mt-auto pt-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
              <Timer size={12} /> SAM {record.sam} min
            </span>
            <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => onEdit?.(record)} title="Editar código"
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-900">
                <Pencil size={14} />
              </button>
              <button type="button" onClick={() => onDuplicate?.(record.code)} title="Duplicar código"
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                <Plus size={14} />
              </button>
              <button type="button" onClick={() => onCopy?.(record.code)} title="Copiar código"
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                <Copy size={14} />
              </button>
              <button type="button" onClick={() => onDelete?.(record)} title="Eliminar"
                className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Full-size viewer */}
      {zoom && record.photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"
          onClick={() => setZoom(false)}
        >
          <button
            type="button"
            onClick={() => setZoom(false)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
          >
            <X size={20} />
          </button>
          <img
            src={record.photoUrl}
            alt={record.description}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}