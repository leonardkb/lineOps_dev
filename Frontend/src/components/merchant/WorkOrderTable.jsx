import { Fragment, useState } from "react";
import { Camera, Pencil, ChevronRight, ChevronDown } from "lucide-react";
import { TALLAS } from "../../lib/masterCodeCatalog";

/*
  Table of production orders (POs) with an expandable detail panel.

  <WorkOrderTable orders={orders} onEdit={fn} />

  GET /api/work-orders returns, per order:
    • the work_orders header — work_order_no, customer_po, customer_name, color,
      style_code, style_description, season, sam_minutes, warehouse_stock,
      extra_quantity, quantity, total_to_produce, commitment_date, fabric_name,
      fabric_code, yield_per_piece, fabrics[], status, assigned_quantity
    • `lines` — the work_order_lines rows: { talla, color, estilo, customerPo,
      commitmentDate, fabrics: [{name, code}], fabricName, fabricCode, yield,
      quantity }. A line may use several fabrics; fabricName/fabricCode are the
      first pair, kept for older callers.

  The summary row shows the header. Expanding it shows the rest of the header
  (style, season, SAM, stock, totals) plus every line grouped by color+estilo,
  each with its own PO cliente, entrega, tela, código, rendimiento and sizes.
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

// Format a DATE ("YYYY-MM-DD" or ISO) WITHOUT any timezone shift.
function fmtDate(v) {
  if (!v) return "—";
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString();
}

// Numbers that may arrive as strings from pg NUMERIC columns.
function fmtNum(v, opts) {
  const n = Number(v);
  return v == null || v === "" || isNaN(n) ? "—" : n.toLocaleString(undefined, opts);
}

// A line's fabrics as [{name, code}] — falls back to the single legacy pair.
function fabricList(src) {
  if (Array.isArray(src?.fabrics) && src.fabrics.length) return src.fabrics;
  const name = src?.fabricName || src?.fabric_name;
  return name ? [{ name, code: src?.fabricCode || src?.fabric_code || null }] : [];
}

// "Jersey (JER301), Rib (RIB200)"
const fabricSummary = (list) =>
  list.map((f) => (f.code ? `${f.name} (${f.code})` : f.name)).join(", ");

const sizeRank = (code) => {
  const i = TALLAS.findIndex((t) => t.code === code);
  return i === -1 ? 999 : i;
};

// One labelled value in the expanded header strip.
function Meta({ label, value, mono }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`block truncate text-xs text-slate-700 ${mono ? "font-mono" : ""}`} title={typeof value === "string" ? value : undefined}>
        {value == null || value === "" ? "—" : value}
      </span>
    </div>
  );
}

// Group a PO's lines by color+estilo (reconstructs the step-2 rows). PO cliente,
// entrega, tela, código and rendimiento are constant within a group — they were
// captured once per color+estilo row — so the first line's value represents it.
function groupLines(lines) {
  const map = new Map();
  for (const l of lines || []) {
    const key = `${l.color}|${l.estilo}`;
    if (!map.has(key)) {
      map.set(key, {
        color: l.color,
        estilo: l.estilo,
        customerPo: l.customerPo,
        commitmentDate: l.commitmentDate,
        fabrics: fabricList(l),
        yield: l.yield,
        sizes: [],
        total: 0,
      });
    }
    const g = map.get(key);
    g.sizes.push({ talla: l.talla, quantity: Number(l.quantity) || 0 });
    g.total += Number(l.quantity) || 0;
  }
  const groups = [...map.values()];
  groups.forEach((g) => g.sizes.sort((a, b) => sizeRank(a.talla) - sizeRank(b.talla)));
  return groups;
}

export default function WorkOrderTable({ orders, onEdit }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const baseCols = 10; // chevron, foto, n°, po cliente, cliente, colores, tela, total, entrega, estado
  const colSpan = onEdit ? baseCols + 1 : baseCols;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-2 py-3 w-8"></th>
            <th className="px-4 py-3">Foto</th>
            <th className="px-4 py-3">N° orden</th>
            <th className="px-4 py-3">PO cliente</th>
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Colores</th>
            <th className="px-4 py-3">Tela</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3">Entrega</th>
            <th className="px-4 py-3">Estado</th>
            {onEdit && <th className="px-4 py-3 text-right">Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const id = o.id || o.work_order_no;
            const groups = groupLines(o.lines);
            const expandable = groups.length > 0;
            const isOpen = open.has(id);
            // Header copy: every distinct name+code pair used by this PO.
            const headerFabrics = Array.isArray(o.fabric_details) && o.fabric_details.length
              ? o.fabric_details
              : (Array.isArray(o.fabrics) && o.fabrics.length
                  ? o.fabrics.map((n) => ({ name: n, code: null }))
                  : fabricList({ fabricName: o.fabric_name || o.fabric_supplier, fabricCode: o.fabric_code }));

            return (
              <Fragment key={id}>
                {/* Summary row — work_orders header */}
                <tr
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${expandable ? "cursor-pointer" : ""}`}
                  onClick={() => expandable && toggle(id)}
                >
                  <td className="px-2 py-2 text-slate-400">
                    {expandable && (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                  </td>
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
                  <td className="px-4 py-2 whitespace-nowrap font-mono text-slate-600">{o.customer_po || "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600">{o.customer_name}</td>
                  <td className="px-4 py-2 font-mono text-slate-600">{o.color || "—"}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {headerFabrics.length === 0 ? "—" : (
                      <span className="block max-w-56 truncate" title={fabricSummary(headerFabrics)}>
                        {headerFabrics[0].name}
                        {headerFabrics[0].code && (
                          <span className="ml-1 font-mono text-xs text-slate-400">{headerFabrics[0].code}</span>
                        )}
                        {headerFabrics.length > 1 && (
                          <span className="ml-1 text-xs text-slate-400">+{headerFabrics.length - 1}</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">
                    {Number(o.total_to_produce ?? o.quantity ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-slate-500">{fmtDate(o.commitment_date)}</td>
                  <td className="px-4 py-2 whitespace-nowrap"><StatusBadge status={o.status} /></td>
                  {onEdit && (
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
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

                {/* Expanded detail */}
                {isOpen && expandable && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={colSpan} className="px-4 pb-4 pt-1">
                      {/* Rest of the work_orders header */}
                      <div className="mb-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <Meta label="Estilo" value={o.style_code} mono />
                        <Meta label="Descripción" value={o.style_description} />
                        <Meta label="Temporada" value={o.season} mono />
                        <Meta label="SAM" value={fmtNum(o.sam_minutes)} mono />
                        <Meta label="Rendimiento" value={fmtNum(o.yield_per_piece)} mono />
                        <Meta label="Telas" value={fabricSummary(headerFabrics)} />
                        <Meta label="Pedido" value={fmtNum(o.quantity)} mono />
                        <Meta label="Bodega" value={fmtNum(o.warehouse_stock)} mono />
                        <Meta label="Extra" value={fmtNum(o.extra_quantity)} mono />
                        <Meta label="A producir" value={fmtNum(o.total_to_produce)} mono />
                        <Meta label="Asignado" value={fmtNum(o.assigned_quantity)} mono />
                        <Meta label="Línea" value={o.line_no} mono />
                      </div>

                      {/* work_order_lines, grouped by color + estilo */}
                      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                              <th className="px-3 py-2">Color</th>
                              <th className="px-3 py-2">Estilo cliente</th>
                              <th className="px-3 py-2">PO cliente</th>
                              <th className="px-3 py-2">Entrega</th>
                              <th className="px-3 py-2">Telas · código</th>
                              <th className="px-3 py-2 text-right">Rend.</th>
                              <th className="px-3 py-2">Tallas · cantidad</th>
                              <th className="px-3 py-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groups.map((g, gi) => (
                              <tr key={`${g.color}|${g.estilo}|${gi}`} className="border-b border-slate-50 last:border-0">
                                <td className="px-3 py-2 font-mono font-bold text-slate-800 whitespace-nowrap">{g.color}</td>
                                <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{g.estilo || "—"}</td>
                                <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">{g.customerPo || "—"}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(g.commitmentDate)}</td>
                                <td className="px-3 py-2">
                                  {g.fabrics.length === 0 ? "—" : (
                                    <div className="flex flex-wrap gap-1">
                                      {g.fabrics.map((f, fi) => (
                                        <span key={`${f.name}|${f.code}|${fi}`}
                                          className="inline-flex items-center gap-1 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-slate-700">
                                          {f.name}
                                          {f.code && <span className="font-mono text-slate-400">{f.code}</span>}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-slate-600 whitespace-nowrap">{fmtNum(g.yield)}</td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {g.sizes.map((s) => (
                                      <span key={s.talla} className="inline-flex items-center gap-0.5 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-slate-700">
                                        {s.talla}<span className="text-slate-400">×</span>{s.quantity.toLocaleString()}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">{g.total.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}