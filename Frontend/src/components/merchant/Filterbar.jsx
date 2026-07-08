import { Search, LayoutGrid, Table2 } from "lucide-react";
import { TIPOS, MODELOS, TALLAS } from "../../lib/masterCodeCatalog";

/*
  Controlled filter bar.
  filters = { q, tipo, modelo, talla }
  <FilterBar filters={filters} onChange={setFilters} view={view} onViewChange={setView} />
*/
export default function FilterBar({ filters, onChange, view, onViewChange }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });

  const selectCls =
    "rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700 " +
    "focus:outline-none focus:ring-2 focus:ring-slate-900";

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-48">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={filters.q}
          onChange={set("q")}
          placeholder="Buscar por código, descripción, cliente, estilo…"
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* Dropdowns */}
      <select value={filters.tipo} onChange={set("tipo")} className={selectCls}>
        <option value="">Tipo · todos</option>
        {TIPOS.map((t) => (
          <option key={t.code} value={t.code}>{t.code} · {t.label}</option>
        ))}
      </select>

      <select value={filters.modelo} onChange={set("modelo")} className={selectCls}>
        <option value="">Modelo · todos</option>
        {MODELOS.map((m) => (
          <option key={m.code} value={m.code}>{m.code} · {m.label}</option>
        ))}
      </select>

      <select value={filters.talla} onChange={set("talla")} className={selectCls}>
        <option value="">Talla · todas</option>
        {TALLAS.map((t) => (
          <option key={t.code} value={t.code}>{t.code} ({t.label})</option>
        ))}
      </select>

      {/* View toggle */}
      <div className="flex rounded-lg border border-slate-300 overflow-hidden">
        <button
          type="button"
          onClick={() => onViewChange("grid")}
          title="Vista de tarjetas"
          className={`p-2 ${view === "grid" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}
        >
          <LayoutGrid size={16} />
        </button>
        <button
          type="button"
          onClick={() => onViewChange("table")}
          title="Vista de tabla"
          className={`p-2 ${view === "table" ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}
        >
          <Table2 size={16} />
        </button>
      </div>
    </div>
  );
}