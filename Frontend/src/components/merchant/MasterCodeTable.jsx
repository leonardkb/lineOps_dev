import { Camera, Copy, Trash2, Plus, Pencil } from "lucide-react";
import MasterCodeBadge from "./MasterCodeBadge";
import { tallaLabel } from "../../lib/masterCodeCatalog";

/*
  Table view of master codes.
  <MasterCodeTable records={list} onOpen={fn} onCopy={fn} onDuplicate={fn} onEdit={fn} onDelete={fn} />
*/
export default function MasterCodeTable({ records, onOpen, onCopy, onDuplicate, onEdit, onDelete }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-4 py-3">Foto</th>
            <th className="px-4 py-3">Código maestro</th>
            <th className="px-4 py-3">Descripción</th>
            <th className="px-4 py-3">Talla</th>
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3 text-right">SAM</th>
            <th className="px-4 py-3">Creado</th>
            <th className="px-4 py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.code}
              onClick={() => onOpen?.(r)}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
            >
              <td className="px-4 py-2">
                {r.photoUrl ? (
                  <img src={r.photoUrl} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" />
                ) : (
                  <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-300">
                    <Camera size={16} />
                  </div>
                )}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">
                <MasterCodeBadge code={r.code} size="sm" />
              </td>
              <td className="px-4 py-2 max-w-64">
                <span className="line-clamp-1 text-slate-600">{r.description}</span>
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                {r.talla} <span className="text-slate-400">({tallaLabel(r.talla)})</span>
              </td>
              <td className="px-4 py-2 font-mono text-slate-600">{r.cliente}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-700">{r.sam}</td>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-400">
                {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
              </td>
              <td className="px-4 py-2">
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onEdit?.(r)}
                    title="Editar código"
                    className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-900"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicate?.(r.code)}
                    title="Duplicar código"
                    className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopy?.(r.code)}
                    title="Copiar código"
                    className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete?.(r)}
                    title="Eliminar"
                    className="p-1.5 rounded hover:bg-rose-100 text-slate-400 hover:text-rose-600"
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
  );
}