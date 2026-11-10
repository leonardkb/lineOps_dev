// components/warehouse/FinishedWarehouseInventory.jsx
// Almacén de Producto Terminado — Inventario.
// Finished goods in stock (finished_inventory), one row per SKU
// (customer + order + style + color + size) with its pieces and boxes.
// Pieces come in from a confirmed pre-packing list or a ticket check-in.
//   GET /api/finished-inventory?q=texto → { inventory, totalPieces }
//
//   <FinishedWarehouseInventory onNavigate={setTab} />
import { useState, useEffect, useCallback, useMemo } from "react";
import { Boxes, Package, PackageCheck, RefreshCw, ScanLine, Users, ChevronRight } from "lucide-react";
import {
  api, num, sizeText, takePendingSearch, PageHeader, Card, CardHeader, Button, Pill, Stat,
  SearchInput, EmptyState, Loading, Banner, Th, Td,
  PageFrame,
} from "./finishedShared";
import FinishedOrderDrawer from "./FinishedOrderDrawer";

export default function FinishedWarehouseInventory({ onNavigate = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState(() => takePendingSearch());  // text in the box
  const [query, setQuery] = useState(q);                    // text applied to the search
  const [sel, setSel] = useState(null);                     // row whose order is open in the side panel

  const load = useCallback(async (search) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api(`/api/finished-inventory${search ? `?q=${encodeURIComponent(search)}` : ""}`);
      setRows(d.inventory || []);
    } catch (e) {
      setError(e.message || "No se pudo cargar el inventario");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(query); }, [load, query]);

  // Search from the top bar while this page is open.
  useEffect(() => {
    const h = (e) => { takePendingSearch(); setQ(e.detail || ""); setQuery(e.detail || ""); };
    window.addEventListener("fw:search", h);
    return () => window.removeEventListener("fw:search", h);
  }, []);

  const onChange = (v) => { setQ(v); if (!v) setQuery(""); };

  const totals = useMemo(() => ({
    pieces: rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    boxes: rows.reduce((s, r) => s + (Number(r.box_count) || 0), 0),
    customers: new Set(rows.map((r) => r.customer_name || r.customer_code)).size,
  }), [rows]);

  return (
    <PageFrame>
      <PageHeader
        title="Inventario"
        subtitle="Producto terminado en existencia, por SKU."
        actions={<>
          {onNavigate && <Button variant="secondary" icon={ScanLine} onClick={() => onNavigate("escaneo")}>Escanear tickets</Button>}
          <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => load(query)}>Actualizar</Button>
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Package} label="Piezas en inventario" value={totals.pieces} tone="emerald" />
        <Stat icon={Boxes} label="SKUs" value={rows.length} tone="indigo" />
        <Stat icon={PackageCheck} label="Cajas" value={totals.boxes} />
        <Stat icon={Users} label="Clientes" value={totals.customers} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          icon={Boxes}
          title="Existencias"
          subtitle={`${num(rows.length)} SKU(s) · clic en un renglón para ver el detalle de la orden`}
          actions={<>
            {query && <Pill tone="indigo">«{query}»</Pill>}
            <SearchInput value={q} onChange={onChange} onEnter={() => setQuery(q.trim())} placeholder="Cliente, estilo, PO o color… (Enter)" className="w-full sm:w-80" />
          </>}
        />

        {error ? (
          <div className="p-5"><Banner kind="err" onClose={() => setError(null)}>{error}</Banner></div>
        ) : loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={query ? "Sin resultados" : "El inventario está vacío"}
            text={query ? "No hay existencias que coincidan con la búsqueda." : "Haga check-in de un ticket escaneado o confirme una lista de pre-empaque para sumar piezas."}
            action={!query && onNavigate ? <Button icon={ScanLine} onClick={() => onNavigate("escaneo")}>Escanear tickets</Button> : null}
          />
        ) : (
          <>
            {/* Phone / PDA: cards */}
            <ul className="md:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <li key={r.id} onClick={() => setSel(r)} className="px-4 py-3 flex items-start gap-3 cursor-pointer active:bg-slate-100">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 truncate">{r.style || "—"} · {r.color_name || r.color_code || "—"}</div>
                    <div className="text-xs text-slate-500 truncate">{r.customer_name || r.customer_code || "—"} · PO {r.po || "—"} · {sizeText(r.size_code)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900 tabular-nums">{num(r.quantity)} pzas</div>
                    <div className="text-xs text-slate-400 tabular-nums">{num(r.box_count)} caja(s)</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 self-center" />
                </li>
              ))}
            </ul>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto max-h-[65vh]">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <Th>Cliente</Th><Th>Orden (PO)</Th><Th>PO cliente (MO)</Th><Th>Estilo</Th>
                    <Th>Color</Th><Th>Talla</Th><Th right>Cajas</Th><Th right>Piezas</Th><Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => setSel(r)} title="Ver detalle de la orden"
                        className={sel?.id === r.id ? "bg-indigo-50/60 cursor-pointer" : "hover:bg-slate-50 cursor-pointer"}>
                      <Td>{r.customer_name || r.customer_code || "—"}</Td>
                      <Td mono>{r.po || "—"}</Td>
                      <Td mono>{r.mo || "—"}</Td>
                      <Td>{r.style || "—"}</Td>
                      <Td>{r.color_name || r.color_code || "—"}</Td>
                      <Td>{sizeText(r.size_code)}</Td>
                      <Td right className="text-slate-500">{num(r.box_count)}</Td>
                      <Td right strong>{num(r.quantity)}</Td>
                      <Td className="w-8 pl-0"><ChevronRight className="w-4 h-4 text-slate-300" /></Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 sticky bottom-0">
                  <tr className="border-t border-slate-200">
                    <Td colSpan={6} className="font-medium text-slate-500">Total</Td>
                    <Td right strong>{num(totals.boxes)}</Td>
                    <Td right strong>{num(totals.pieces)}</Td>
                    <Td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>
      <FinishedOrderDrawer
        open={!!sel}
        workOrder={sel?.po}
        customerPo={sel?.mo}
        highlight={sel ? { size: sel.size_code, color: sel.color_name || sel.color_code } : null}
        onClose={() => setSel(null)}
      />
    </PageFrame>
  );
}