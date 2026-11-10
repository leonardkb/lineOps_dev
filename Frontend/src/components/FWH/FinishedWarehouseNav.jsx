// components/warehouse/FinishedWarehouseNav.jsx
// Almacén de Producto Terminado — app shell (same look as the Almacén de Tela):
//   • dark sidebar with sections, counters and the user at the bottom
//   • top bar with breadcrumb, global search and the main action
//   • on phones/PDA the sidebar becomes a drawer (☰)
//
// Recommended: wrap the active page with it.
//   const [tab, setTab] = useState("dashboard");
//   <FinishedWarehouseNav active={tab} onNavigate={setTab}>
//     {tab === "dashboard"   && <FinishedWarehouseDashboard onNavigate={setTab} />}
//     {tab === "escaneo"     && <FinishedWarehouseScan onNavigate={setTab} />}
//     {tab === "pre-empaque" && <PrePacking />}
//     {tab === "inventario"  && <FinishedWarehouseInventory onNavigate={setTab} />}
//   </FinishedWarehouseNav>
//
// It also works the old way (nav first, page rendered after it as a sibling):
//   <FinishedWarehouseNav active={tab} onNavigate={setTab} />
//   {tab === "dashboard" && <FinishedWarehouseDashboard onNavigate={setTab} />}
// In that mode the top bar sits in the normal flow and the page is pushed
// right of the fixed sidebar with a padding on <body>.
import { useState, useEffect, useCallback, useRef, Children } from "react";
import {
  Warehouse, LayoutDashboard, ScanLine, ClipboardList, Boxes, LogOut,
  PanelLeftClose, PanelLeftOpen, Menu, X, ChevronRight, Search,
} from "lucide-react";
import { api, cx, ConfirmProvider, ShellCtx, setPendingSearch } from "./finishedShared";

export const WAREHOUSE_NAV_SECTIONS = [
  {
    label: "Operación",
    items: [
      { key: "dashboard",  label: "Dashboard",  icon: LayoutDashboard },
      { key: "escaneo",    label: "Escaneo",    icon: ScanLine, badge: "pendingTickets", tone: "amber" },
      
    ],
  },
  {
    label: "Empaque",
    items: [
      { key: "inventario", label: "Inventario", icon: Boxes },
      
    ],
  },
];
// Flat list (kept for code that imported it before).
export const WAREHOUSE_NAV_ITEMS = WAREHOUSE_NAV_SECTIONS.flatMap((s) => s.items);

const COLLAPSE_KEY = "fwSidebarCollapsed";

export default function FinishedWarehouseNav({
  active = "dashboard",
  onNavigate = () => {},
  sections = WAREHOUSE_NAV_SECTIONS,
  children,
}) {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("user") || "{}"); } catch { user = {}; }
  const name = user.full_name || user.username || "Almacén";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AL";

  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } });
  const [drawer, setDrawer] = useState(false);
  const [badges, setBadges] = useState({});
  const [q, setQ] = useState("");
  const searchRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* */ } }, [collapsed]);

  const loadBadges = useCallback(async () => {
    try {
      const d = await api("/api/finished-warehouse/dashboard");
      setBadges({
        pendingTickets: d.dashboard?.tickets?.pending || 0,
        draftLists: d.dashboard?.lists?.draft || 0,
      });
    } catch { /* badges are optional */ }
  }, []);
  useEffect(() => { loadBadges(); }, [loadBadges, active]);
  useEffect(() => {
    window.addEventListener("fw:changed", loadBadges);
    return () => window.removeEventListener("fw:changed", loadBadges);
  }, [loadBadges]);

  // "/" → search, "[" → collapse menu.
  useEffect(() => {
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "[") setCollapsed((v) => !v);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const go = (key) => { setDrawer(false); onNavigate(key); };
  const search = () => {
    const t = q.trim();
    if (!t) return;
    setPendingSearch(t);
    onNavigate("inventario");
    setQ("");
    searchRef.current?.blur();
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  const current = sections.flatMap((s) => s.items).find((i) => i.key === active);

  const sidebar = (mini) => (
    <div className="h-full flex flex-col bg-[#131b3a] text-slate-300">
      {/* Brand */}
      <div className={cx("h-16 flex items-center gap-3 shrink-0", mini ? "justify-center px-2" : "px-5")}>
        <div className="w-9 h-9 rounded-xl bg-amber-400 text-[#131b3a] flex items-center justify-center shrink-0">
          <Warehouse className="w-5 h-5" />
        </div>
        {!mini && (
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white leading-tight">Almacén PT</div>
            <div className="text-xs text-slate-400">Producto terminado</div>
          </div>
        )}
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
        {sections.map((s) => (
          <div key={s.label}>
            {!mini && <div className="px-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{s.label}</div>}
            <ul className="space-y-1">
              {s.items.map((it) => {
                const on = it.key === active;
                const n = it.badge ? badges[it.badge] : 0;
                return (
                  <li key={it.key}>
                    <button
                      onClick={() => go(it.key)}
                      title={mini ? it.label : undefined}
                      aria-current={on ? "page" : undefined}
                      className={cx("relative w-full flex items-center gap-3 rounded-xl text-sm font-medium transition",
                        mini ? "justify-center h-10" : "px-3 py-2.5",
                        on ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white")}
                    >
                      {on && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-amber-400" />}
                      <it.icon className={cx("w-[18px] h-[18px] shrink-0", on && "text-amber-400")} />
                      {!mini && <span className="flex-1 text-left">{it.label}</span>}
                      {n > 0 && (
                        mini
                          ? <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" />
                          : <span className={cx("min-w-[22px] rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-center",
                              it.tone === "violet" ? "bg-violet-300 text-violet-900" : "bg-amber-400 text-amber-950")}>{n}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-3 space-y-1 shrink-0">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className={cx("hidden lg:flex w-full items-center gap-3 rounded-xl text-sm hover:bg-white/5 hover:text-white", mini ? "justify-center h-10" : "px-3 py-2.5")}
          title={mini ? "Expandir menú" : undefined}
        >
          {mini ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
          {!mini && <><span className="flex-1 text-left">Contraer menú</span><kbd className="text-[10px] rounded border border-white/20 px-1.5 py-0.5 text-slate-400">[</kbd></>}
        </button>
        <div className={cx("flex items-center gap-3", mini ? "justify-center py-1" : "px-2 py-2")}>
          <span className="w-9 h-9 rounded-full bg-white/10 text-white text-xs font-semibold flex items-center justify-center shrink-0">{initials}</span>
          {!mini && (
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{name}</div>
              {user.username && <div className="text-xs text-slate-500 truncate">{user.username}</div>}
            </div>
          )}
          {!mini && (
            <button onClick={logout} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" title="Cerrar sesión">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
        {mini && (
          <button onClick={logout} className="w-full flex justify-center h-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/5" title="Cerrar sesión">
            <LogOut className="w-4 h-4 my-auto" />
          </button>
        )}
      </div>
    </div>
  );

  const wrapped = Children.toArray(children).length > 0;
  const sideW = collapsed ? 76 : 256;

  const desktopSidebar = (
    <aside className="hidden lg:block fixed inset-y-0 left-0 z-30 transition-[width]" style={{ width: sideW }}>
      {sidebar(collapsed)}
    </aside>
  );

  const mobileDrawer = drawer && (
    <div className="lg:hidden fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
      <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
        <button onClick={() => setDrawer(false)} className="absolute top-4 right-3 z-10 p-1.5 rounded-lg text-slate-400 hover:text-white" aria-label="Cerrar menú">
          <X className="w-5 h-5" />
        </button>
        {sidebar(false)}
      </aside>
    </div>
  );

  const topBar = (
    <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6">
      <button onClick={() => setDrawer(true)} className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100" aria-label="Abrir menú">
        <Menu className="w-5 h-5" />
      </button>
      <button onClick={() => setCollapsed((v) => !v)} className="hidden lg:inline-flex p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100" title="Contraer / expandir menú">
        {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
      </button>
      <nav className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="hidden sm:inline text-slate-500">Almacén PT</span>
        <ChevronRight className="hidden sm:inline w-4 h-4 text-slate-300" />
        <span className="font-semibold text-slate-900 truncate">{current?.label || ""}</span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden md:block w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); if (e.key === "Escape") e.currentTarget.blur(); }}
            placeholder="Buscar estilo, PO, color…"
            className="w-full pl-9 pr-9 py-2 rounded-lg bg-slate-100 text-sm placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] rounded border border-slate-300 px-1.5 py-0.5 text-slate-400">/</kbd>
        </div>
        {active !== "escaneo" && (
          <button
            onClick={() => onNavigate("escaneo")}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <ScanLine className="w-4 h-4" /><span className="hidden sm:inline">Escanear tickets</span>
          </button>
        )}
      </div>
    </header>
  );

  // Old usage: the page is a sibling after the nav, so we can't wrap it.
  // Push everything right of the fixed sidebar via <body> and keep the bar in flow.
  if (!wrapped) {
    return (
      <ConfirmProvider>
        <style>{`body{background:#f8fafc}@media (min-width:1024px){body{padding-left:${sideW}px}}`}</style>
        {desktopSidebar}
        {mobileDrawer}
        {topBar}
      </ConfirmProvider>
    );
  }

  return (
    <ConfirmProvider>
      <ShellCtx.Provider value={true}>
        <div className="min-h-screen bg-slate-50">
          {desktopSidebar}
          {mobileDrawer}
          <style>{`@media (min-width:1024px){.fw-shell-main{padding-left:${sideW}px}}`}</style>
          <div className="fw-shell-main transition-[padding]">
            {topBar}
            <main className="px-4 sm:px-6 lg:px-8 py-6">
              <div className="max-w-7xl mx-auto">{children}</div>
            </main>
          </div>
        </div>
      </ShellCtx.Provider>
    </ConfirmProvider>
  );
}