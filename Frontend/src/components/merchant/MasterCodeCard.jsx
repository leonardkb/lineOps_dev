import { Camera, Timer, Copy, Trash2, Plus } from "lucide-react";
import MasterCodeBadge from "./MasterCodeBadge";
import { tipoLabel, modeloLabel, tallaLabel } from "../../lib/masterCodeCatalog";

/*
  Card view of one master code.
  <MasterCodeCard record={r} onOpen={fn} onCopy={fn} onDuplicate={fn} onDelete={fn} />
  record = { code, tipo, modelo, talla, cliente, color, estilo, description, sam, photoUrl, createdAt }
*/
export default function MasterCodeCard({ record, onOpen, onCopy, onDuplicate, onDelete }) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden
                 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
      onClick={() => onOpen?.(record)}
    >
      {/* Photo */}
      <div className="h-36 bg-slate-100 flex items-center justify-center overflow-hidden">
        {record.photoUrl ? (
          <img
            src={record.photoUrl}
            alt={record.description}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <Camera size={28} className="text-slate-300" />
        )}
      </div>

      <div className="p-4 space-y-2">
        <MasterCodeBadge code={record.code} size="sm" />
        <p className="text-sm text-slate-600 line-clamp-2 min-h-10">{record.description}</p>

        <div className="flex flex-wrap gap-1">
          <span className="text-[11px] bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5">
            {tipoLabel(record.tipo)}
          </span>
          <span className="text-[11px] bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2 py-0.5">
            {modeloLabel(record.modelo)}
          </span>
          <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
            {record.talla} · {tallaLabel(record.talla)}
          </span>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-600">
            <Timer size={13} /> SAM {record.sam} min
          </span>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onDuplicate?.(record.code)}
              title="Duplicar código"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={() => onCopy?.(record.code)}
              title="Copiar código"
              className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(record)}
              title="Eliminar"
              className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}