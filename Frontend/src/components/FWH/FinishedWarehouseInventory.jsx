// components/warehouse/FinishedWarehouseInventory.jsx
// Almacén de Producto Terminado — Inventario.
//
// Muestra el inventario de producto terminado (finished_inventory): lo que ha
// entrado, ya sea al confirmar una lista de pre-empaque o al hacer "check-in" de
// un ticket escaneado. Cada renglón es un SKU (cliente + orden + estilo + color +
// talla) con sus piezas y cajas acumuladas.
//
// Backend:
//   GET /api/finished-inventory?q=texto   → { inventory, totalPieces }
//
// Se conecta a la pestaña «Inventario» de FinishedWarehouseNav. Pase onNavigate
// (misma firma que la barra) para el botón «Escanear tickets».
//
//   <FinishedWarehouseInventory onNavigate={setTab} />
//
import { useState, useEffect, useCallback } from "react";
import {
  Boxes, Package, PackageCheck, Search, RefreshCw, Loader2,
  AlertCircle, ScanLine, X,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

async function api(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const num = (v) => Math.round(Number(v) || 0).toLocaleString();

// Size code -> etiqueta imprimible. En sincronía con SIZE_LABELS del backend.
const SIZE_LABELS = {
  "130": "xxxs", "132": "xxs", "134": "xs", "136": "(S)", "138": "(M)",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
const sizeText = (code) => {
  const k = String(code ?? "").trim();
  if (!k) return "—";
  const lbl = SIZE_LABELS[k];
  return lbl && lbl !== k ? `${k} · ${lbl}` : k;
};

export default function FinishedWarehouseInventory({ onNavigate = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");        // texto en el cuadro
  const [query, setQuery] = useState(""); // texto aplicado a la búsqueda

  const load = useCallback(async (search) => {
    setLoading(true);
    setError(null);
    try {
      const qs = search ? `?q=${encodeURIComponent(search)}` : "";
      const d = await api(`/api/finished-inventory${qs}`);
      setRows(d.inventory || []);
    } catch (e) {
      setError(e.message || "No se pudo cargar el inventario");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(query); }, [load, query]);

  const applySearch = () => setQuery(q.trim());
  const clearSearch = () => { setQ(""); setQuery(""); };

  // Totales desde los renglones cargados.
  const totalPieces = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalBoxes = rows.reduce((s, r) => s + (Number(r.box_count) || 0), 0);
  const skus = rows.length;

  return (
    <div className="max-w-6xl mx-auto p-5 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
          <Boxes className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">Inventario</h1>
          <p className="text-sm text-gray-500">Producto terminado en existencia, por SKU.</p>
        </div>
        {onNavigate && (
          <button
            onClick={() => onNavigate("escaneo")}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ScanLine className="w-4 h-4" /> Escanear tickets
          </button>
        )}
        <button
          onClick={() => load(query)}
          className={`${onNavigate ? "" : "ml-auto "}inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium text-gray-700 hover:bg-gray-50`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Actualizar
        </button>
      </header>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Tile icon={Package} label="Piezas en inventario" value={totalPieces} accent="emerald" />
        <Tile icon={Boxes} label="SKUs" value={skus} accent="indigo" />
        <Tile icon={PackageCheck} label="Cajas" value={totalBoxes} accent="gray" />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          placeholder="Buscar por cliente, estilo, PO o color…"
          className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {q && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
            title="Limpiar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Inventory table */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Boxes className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-800">Existencias</h2>
          <span className="text-xs text-gray-400">{rows.length} SKU(s)</span>
          {query && (
            <span className="text-xs rounded-full px-2 py-0.5 font-medium bg-indigo-50 text-indigo-700">
              «{query}»
            </span>
          )}
        </div>

        {error ? (
          <div className="p-4 text-sm text-amber-700 bg-amber-50 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {query
              ? "No hay existencias que coincidan con la búsqueda."
              : "El inventario está vacío. Haga check-in de un ticket escaneado o confirme una lista de pre-empaque para sumar piezas."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50/60">
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Orden (PO)</th>
                  <th className="px-3 py-2 font-medium">PO cliente (MO)</th>
                  <th className="px-3 py-2 font-medium">Estilo</th>
                  <th className="px-3 py-2 font-medium">Color</th>
                  <th className="px-3 py-2 font-medium">Talla</th>
                  <th className="px-3 py-2 font-medium text-right">Cajas</th>
                  <th className="px-3 py-2 font-medium text-right">Piezas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.customer_name || r.customer_code || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.po || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.mo || "—"}</td>
                    <td className="px-3 py-2">{r.style || "—"}</td>
                    <td className="px-3 py-2">{r.color_name || r.color_code || "—"}</td>
                    <td className="px-3 py-2">{sizeText(r.size_code)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">{num(r.box_count)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">{num(r.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50/60 text-sm">
                  <td className="px-3 py-2 font-medium text-gray-500" colSpan={6}>Total</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">{num(totalBoxes)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">{num(totalPieces)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ icon: Icon, label, value, accent = "gray" }) {
  const accents = {
    amber: "text-amber-600 bg-amber-50",
    emerald: "text-emerald-600 bg-emerald-50",
    indigo: "text-indigo-600 bg-indigo-50",
    gray: "text-gray-600 bg-gray-100",
  };
  return (
    <div className="bg-white rounded-xl border shadow-sm p-3">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${accents[accent] || accents.gray}`}>
          {Icon && <Icon className="w-4 h-4" />}
        </span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-gray-900">{num(value)}</div>
    </div>
  );
}