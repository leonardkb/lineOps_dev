import { Camera, Pencil } from "lucide-react";

/*
  Table of production orders (POs).
  <WorkOrderTable orders={orders} onEdit={fn} />
  order = { work_order_no, customer_name, style_code, estilo, style_description,
            color, quantity, total_to_produce, commitment_date, status,
            master_code_photo_url, created_at }
*/

const STATUS = {
  pending:     { label: "Pendiente",  cls: "bg-slate-100 text-slate-600 border-slate-200" },
  assigned:    { label: "Asignada",   cls: "bg-sky-50 text-sky-700 border-sky-200" },
  in_progress: { label: "En proceso", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  completed:   { label: "Completada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled:   { label: "Cancelada",  cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={`inline-block text-[11px] font-medium rounded-full border px-2 py-0.5 ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function WorkOrderTable({ orders, onEdit }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-4 py-3">Foto</th>
            <th className="px-4 py-3">N° orden</th>
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Estilo</th>
            <th className="px-4 py-3">Colores</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3">Entrega</th>
            <th className="px-4 py-3">Estado</th>
            {onEdit && <th className="px-4 py-3 text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id || o.work_order_no} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="px-4 py-2">
                {o.master_code_photo_url ? (
                  <img src={o.master_code_photo_url} alt="" className="w-10 h-10 rounded object-cover border border-slate-200" />
                ) : (
                  <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-300">
                    <Camera size={16} />
                  </div>
                )}
              </td>
              <td className="px-4 py-2 whitespace-nowrap font-mono font-bold text-slate-800">{o.work_order_no}</td>
              <td className="px-4 py-2 whitespace-nowrap text-slate-600">{o.customer_name}</td>
              <td className="px-4 py-2 whitespace-nowrap">
                <span className="font-mono text-slate-700">{o.style_code || "—"}</span>
                {o.estilo && <span className="text-slate-400 ml-1">· {o.estilo}</span>}
              </td>
              <td className="px-4 py-2 font-mono text-slate-600">{o.color || "—"}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-700">
                {Number(o.total_to_produce ?? o.quantity ?? 0).toLocaleString()}
              </td>
              <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">
                {o.commitment_date ? new Date(o.commitment_date).toLocaleDateString() : "—"}
              </td>
              <td className="px-4 py-2 whitespace-nowrap"><StatusBadge status={o.status} /></td>
              {onEdit && (
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onEdit(o)}
                      title="Editar orden"
                      className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-900"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}