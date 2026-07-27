import { Search, LayoutGrid, Table2 } from "lucide-react";
import { TIPOS, MODELOS, tipoLabel, modeloLabel } from "../../lib/masterCodeCatalog";

/*
  Controlled filter bar with interactive chip selectors.
  filters = { q, tipo, modelo, cliente }
  clientes = ["INV", "ZAR", ...]  (distinct client codes, passed from the dashboard)
  <FilterBar filters={filters} onChange={setFilters} view={view} onViewChange={setView} clientes={clientes} />
*/

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all
        ${active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, options, value, onToggle }) {
  if (!options.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Chip key={opt.code} active={value === opt.code} onClick={() => onToggle(opt.code)}>
            <span className="font-mono font-bold mr-1">{opt.code}</span>
            <span className="text-[11px] opacity-80">{opt.label}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}

export default function FilterBar({ filters, onChange, view, onViewChange, clientes = [] }) {
  const set = (key, value) => onChange({ ...filters, [key]: value });
  const toggle = (key) => (code) => set(key, filters[key] === code ? "" : code);

  const clienteOptions = clientes.map((c) => ({ code: c, label: "" }));

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
      {/* Search + view toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Buscar por código, descripción, cliente, estilo…"
            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden shrink-0">
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

      {/* Interactive chip filters */}
      <ChipRow label="Tipo" options={TIPOS} value={filters.tipo} onToggle={toggle("tipo")} />
      <ChipRow label="Modelo" options={MODELOS} value={filters.modelo} onToggle={toggle("modelo")} />
      <ChipRow label="Cliente" options={clienteOptions} value={filters.cliente} onToggle={toggle("cliente")} />
    </div>
  );
}