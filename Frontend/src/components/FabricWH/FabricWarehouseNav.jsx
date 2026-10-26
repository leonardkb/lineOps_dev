// components/FabricWH/FabricWarehouseNav.jsx
// Side menu + top bar of the Almacén de Tela.
//
// Sidebar
//   • Desktop: expanded (labels) or collapsed (icons + tooltips). The choice is
//     remembered in localStorage. Toggle with the button or the «[» key.
//   • Tablet/phone: hidden; the ☰ button opens it as a drawer over the page.
//   • Badges show pending work (rolls without location, open inspection
//     requests, rolls over the aging limit).
//
// Top bar
//   • Breadcrumb, global roll search («/» to focus), quick «Recibir» button.
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Layers, LayoutDashboard, DownloadCloud, MapPin, ScanLine, Boxes,
  Microscope, Undo2, FileBarChart, LogOut, PanelLeftClose, PanelLeftOpen,
  Menu, X, Search, Loader2, ChevronRight,
} from "lucide-react";
import { api, cx, StatusBadge, locationText, useRollDrawer } from "./fabricShared";

export const FABRIC_NAV_GROUPS = [
  {
    label: "Operación",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Resumen del día" },
      { key: "recepcion", label: "Recepción", icon: ScanLine, hint: "Escanear rollos que llegan", badge: "arriving" },
      { key: "inventario", label: "Inventario", icon: Boxes, hint: "Rollos guardados" },
    ],
  },
  {
    label: "Abastecimiento",
    items: [
      { key: "solicitar", label: "Solicitar a Skytex", icon: DownloadCloud, hint: "Pedir rollos" },
      { key: "ubicaciones", label: "Ubicaciones", icon: MapPin, hint: "Contenedores y posiciones", badge: "noLocation", tone: "amber" },
    ],
  },
  {
    label: "Control",
    items: [
      { key: "inspeccion", label: "Inspección", icon: Microscope, hint: "Solicitudes del equipo", badge: "inspection", tone: "violet" },
      { key: "devoluciones", label: "Devoluciones", icon: Undo2, hint: "Regresar al proveedor", badge: "aged", tone: "red" },
      { key: "reportes", label: "Reportes", icon: FileBarChart, hint: "Entradas y salidas" },
    ],
  },
];
export const FABRIC_NAV_ITEMS = FABRIC_NAV_GROUPS.flatMap((g) => g.items);

const COLLAPSE_KEY = "fabricSidebarCollapsed";
const isTyping = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;

// Sidebar state shared by the page: collapsed (desktop) and open (mobile).
export function useSidebarState() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = useCallback(() => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* ignore */ }
    return !c;
  }), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "[" && !isTyping() && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (window.innerWidth >= 1024) toggleCollapsed(); else setMobileOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  return { collapsed, toggleCollapsed, mobileOpen, setMobileOpen };
}

export const SIDEBAR_W = { open: 264, closed: 76 };

export default function FabricWarehouseNav({ active, onNavigate, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, badges = {} }) {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { user = {}; }
  const name = user.full_name || user.username || "Almacén";
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  // On mobile the drawer always shows labels.
  const compact = collapsed && !mobileOpen;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const h = (e) => { if (e.key === "Escape") onCloseMobile(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cx("fixed inset-0 z-40 bg-slate-900/50 lg:hidden transition-opacity", mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none")}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex flex-col text-slate-200 transition-[width,transform] duration-200 ease-out",
          "bg-[#14213D]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ width: compact ? SIDEBAR_W.closed : SIDEBAR_W.open }}
        aria-label="Menú del almacén de tela"
      >
        {/* Selvedge stitch along the edge */}
        <div className="pointer-events-none absolute right-1.5 inset-y-4 border-r border-dashed border-white/10" />

        {/* Brand */}
        <div className={cx("h-16 flex items-center gap-3 shrink-0", compact ? "justify-center px-0" : "px-5")}>
          <div className="w-9 h-9 rounded-xl bg-amber-300 text-[#14213D] flex items-center justify-center shrink-0 shadow-inner">
            <Layers className="w-5 h-5" />
          </div>
          {!compact && (
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white leading-tight">Almacén de Tela</div>
              <div className="text-xs text-slate-400">Skyrina · Skytex</div>
            </div>
          )}
          <button onClick={onCloseMobile} className="ml-auto lg:hidden text-slate-400 hover:text-white" aria-label="Cerrar menú">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 space-y-5 [scrollbar-width:thin]">
          {FABRIC_NAV_GROUPS.map((g) => (
            <div key={g.label}>
              {compact
                ? <div className="mx-auto my-2 w-6 border-t border-white/10" />
                : <div className="px-3 mb-1.5 text-[11px] font-medium text-slate-500">{g.label}</div>}
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const on = it.key === active;
                  const count = it.badge ? Number(badges[it.badge] || 0) : 0;
                  const toneCls = { amber: "bg-amber-300 text-[#14213D]", violet: "bg-violet-300 text-[#14213D]", red: "bg-red-400 text-white" }[it.tone] || "bg-white/15 text-white";
                  return (
                    <li key={it.key} className="relative group">
                      <button
                        onClick={() => { onNavigate(it.key); onCloseMobile(); }}
                        aria-current={on ? "page" : undefined}
                        className={cx(
                          "relative w-full flex items-center rounded-xl transition text-sm",
                          compact ? "justify-center h-11" : "gap-3 px-3 h-10",
                          on ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        )}
                      >
                        {on && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-amber-300" />}
                        <it.icon className={cx("w-[18px] h-[18px] shrink-0", on ? "text-amber-300" : "")} />
                        {!compact && <span className="truncate font-medium">{it.label}</span>}
                        {count > 0 && !compact && (
                          <span className={cx("ml-auto text-[11px] font-semibold rounded-full px-1.5 min-w-[1.25rem] text-center", toneCls)}>{count > 99 ? "99+" : count}</span>
                        )}
                        {count > 0 && compact && (
                          <span className={cx("absolute top-1.5 right-2.5 w-2 h-2 rounded-full ring-2 ring-[#14213D]", toneCls.split(" ")[0])} />
                        )}
                      </button>
                      {compact && (
                        <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 whitespace-nowrap rounded-lg bg-slate-900 text-white text-xs px-2.5 py-1.5 shadow-lg opacity-0 group-hover:opacity-100 transition">
                          {it.label}{count > 0 ? ` · ${count}` : ""}
                          <span className="block text-slate-400">{it.hint}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: collapse + user */}
        <div className="shrink-0 border-t border-white/10 p-3 space-y-2">
          <button
            onClick={onToggleCollapsed}
            className={cx("hidden lg:flex w-full items-center rounded-xl h-9 text-sm text-slate-400 hover:text-white hover:bg-white/5", compact ? "justify-center" : "gap-3 px-3")}
            title={compact ? "Expandir menú  [" : "Contraer menú  ["}
          >
            {compact ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
            {!compact && <span>Contraer menú</span>}
            {!compact && <kbd className="ml-auto text-[10px] rounded border border-white/15 px-1.5 py-0.5 text-slate-400">[</kbd>}
          </button>
          <div className={cx("flex items-center rounded-xl", compact ? "justify-center" : "gap-3 px-2 py-1.5")}>
            <div className="w-8 h-8 rounded-full bg-white/10 text-white text-xs font-semibold flex items-center justify-center shrink-0" title={name}>
              {initials || "AL"}
            </div>
            {!compact && (
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate">{name}</div>
                <div className="text-xs text-slate-500 truncate">{user.role || "almacén"}</div>
              </div>
            )}
            {!compact && (
              <button onClick={logout} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5" title="Cerrar sesión" aria-label="Cerrar sesión">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
          {compact && (
            <button onClick={logout} className="w-full flex justify-center h-9 items-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
export function FabricTopbar({ active, onOpenMobile, onNavigate, collapsed, onToggleCollapsed }) {
  const item = FABRIC_NAV_ITEMS.find((i) => i.key === active);
  return (
    <header className="sticky top-0 z-30 h-16 bg-white/85 backdrop-blur border-b border-slate-200">
      <div className="h-full px-4 sm:px-6 flex items-center gap-3">
        <button onClick={onOpenMobile} className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Abrir menú">
          <Menu className="w-5 h-5" />
        </button>
        <button
          onClick={onToggleCollapsed}
          className="hidden lg:inline-flex p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          title={`${collapsed ? "Expandir" : "Contraer"} menú  [`}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>

        <nav className="hidden sm:flex items-center gap-1.5 text-sm min-w-0" aria-label="Ruta">
          <button onClick={() => onNavigate("dashboard")} className="text-slate-500 hover:text-slate-800">Almacén de Tela</button>
          {item && item.key !== "dashboard" && (
            <>
              <ChevronRight className="w-4 h-4 text-slate-300" />
              <span className="font-medium text-slate-900 truncate">{item.label}</span>
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2 flex-1 sm:flex-none justify-end">
          <GlobalRollSearch />
          {active !== "recepcion" && (
            <button
              onClick={() => onNavigate("recepcion")}
              className="hidden md:inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 shadow-sm"
            >
              <ScanLine className="w-4 h-4" /> Recibir rollos
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// Find any roll by number, PO, lot, fabric… and open its detail.
function GlobalRollSearch() {
  const openRoll = useRollDrawer();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !isTyping()) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResults([]); setLoading(false); return undefined; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const d = await api(`/rolls?q=${encodeURIComponent(t)}&limit=8`);
        setResults(d.rolls || []);
        setIdx(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (r) => { openRoll(r); setOpen(false); setQ(""); inputRef.current?.blur(); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter" && results[idx]) { e.preventDefault(); pick(results[idx]); }
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  return (
    <div ref={boxRef} className="relative w-full sm:w-80">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Buscar rollo, PO, lote…"
        className="w-full pl-9 pr-9 py-2 rounded-lg bg-slate-100 text-sm placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label="Buscar rollo"
      />
      <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] rounded border border-slate-300 px-1.5 py-0.5 text-slate-400">/</kbd>

      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 mt-2 w-full sm:w-[26rem] bg-white rounded-xl shadow-xl ring-1 ring-slate-900/10 overflow-hidden z-50">
          {loading ? (
            <div className="p-4 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No hay rollos que coincidan con «{q.trim()}».</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1" role="listbox">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => pick(r)}
                    className={cx("w-full text-left px-4 py-2.5 flex items-start gap-3", i === idx ? "bg-indigo-50" : "")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm font-semibold text-slate-900">{r.roll_no}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {[r.fabric_name, r.color, r.po_number && `PO ${r.po_number}`, r.lot && `Lote ${r.lot}`].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <StatusBadge status={r.status} />
                      <div className="text-xs text-slate-500">{locationText(r)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}