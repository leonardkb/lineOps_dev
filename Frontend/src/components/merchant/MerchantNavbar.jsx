import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Plus, RefreshCw, LogOut, Tag, ClipboardList, Bell, TrendingUp, ArrowRight } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

/* Campana de avisos: pre-órdenes que planeación mandó desde el tablero de
 * pronóstico y el merchant aún no ha visto (GET /api/pre-orders/inbox).
 * Se consulta al montar, cada minuto, al volver a la pestaña y cuando
 * PreOrdenesPanel marca avisos como vistos (evento INBOX_EVENT). */
const INBOX_EVENT = "preorders:inbox-changed";
const POLL_MS = 60000;
const inboxHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});
const ago = (ts) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

function PreOrderInbox() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const lastCount = useRef(null); // null = primera carga (no avisa con toast)
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    try {
      const r = await fetch(`${API_URL}/api/pre-orders/inbox`, { headers: inboxHeaders() });
      const d = await r.json();
      if (!d?.success) return;
      const n = d.unread || 0;
      // Llegó algo nuevo mientras la página estaba abierta → toast.
      if (lastCount.current != null && n > lastCount.current && d.items?.[0]) {
        const it = d.items[0];
        setToast(`${it.pre_order_no} llegó del pronóstico ${it.source_forecast_no}`);
        setTimeout(() => setToast(null), 5000);
      }
      lastCount.current = n;
      setUnread(n);
      setItems(d.items || []);
    } catch { /* sin red: se reintenta en el siguiente ciclo */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(INBOX_EVENT, onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(INBOX_EVENT, onFocus);
    };
  }, [load]);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const markAll = async () => {
    try {
      await fetch(`${API_URL}/api/pre-orders/inbox/seen`, { method: "POST", headers: inboxHeaders(), body: "{}" });
    } catch { /* ignore */ }
    lastCount.current = 0;
    setUnread(0);
    setItems([]);
  };

  // La tabla de pre-órdenes los marca como vistos al mostrarlos.
  const goList = () => { setOpen(false); navigate("/pre-ordenes"); };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={unread ? `${unread} pre-orden(es) nueva(s) del pronóstico` : "Avisos de pre-órdenes"}
        aria-label="Avisos de pre-órdenes"
        className="relative inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 w-9 h-9"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-400 text-slate-900 text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl bg-white text-slate-800 shadow-xl ring-1 ring-black/10 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold">Pre-órdenes del pronóstico</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                Marcar como vistas
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No hay avisos nuevos.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" onClick={goList} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold">{it.pre_order_no}</span>
                      <span className="text-[11px] text-slate-400">{ago(it.created_at)}</span>
                    </div>
                    <p className="text-[12px] text-slate-600 truncate">
                      {it.source_style_name || it.style_description || "—"} · {it.customer_name || "—"}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-teal-700">
                      <TrendingUp size={11} /> {it.source_forecast_no} · {Number(it.pieces || 0).toLocaleString()} pzas
                      {it.target_date ? ` · entrega ${it.target_date}` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={goList}
            className="w-full px-4 py-2.5 border-t border-slate-100 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5">
            Ver pre-órdenes <ArrowRight size={13} />
          </button>
        </div>
      )}

      {toast && (
        <button type="button" onClick={() => { setToast(null); goList(); }}
          className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-teal-700">
          <TrendingUp size={15} /> {toast}
        </button>
      )}
    </div>
  );
}

export default function MerchantNavbar({
  title,
  onRefresh,
  isRefreshing = false,
  showRefresh = true,
  showStatus = false,
  isOnline = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/");
  };

  const isActive = (path) => location.pathname === path;

  return (
    <header className="bg-slate-900 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Brand + Title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
            <Tag size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            <p className="text-xs text-slate-400 hidden sm:block">
              Gestiona los códigos maestros de producto
            </p>
          </div>
        </div>

        {/* Right: Navigation + Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status indicator (optional) */}
          {showStatus && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2.5 py-1 ${
                isOnline
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {isOnline ? "✅ Conectado" : "⚠️ Demo"}
            </span>
          )}

          {/* Navigation Links */}
          <Link
            to="/merchant-dashboard"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              isActive("/merchant-dashboard")
                ? "bg-white text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
          >
            <LayoutDashboard size={14} />
            Dashboard
          </Link>

          {/* Abre el wizard de pre-orden (estilo · cliente · piezas). El listado
              vive en la pestaña "Pre-órdenes" del dashboard. */}
          <Link
            to="/pre-orden-wizard"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              isActive("/pre-orden-wizard") || isActive("/pre-ordenes")
                ? "bg-white text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
          >
            <ClipboardList size={14} />
            Nueva Pre-orden
          </Link>

          <Link
            to="/nuevo-orden-wizard"
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              isActive("/nuevo-orden-wizard")
                ? "bg-white text-slate-900"
                : "bg-white/10 hover:bg-white/20 text-white"
            }`}
          >
            <Plus size={14} />
            Nuevo Codigo + PO
          </Link>

          {/* Avisos: pre-órdenes nuevas que llegan del pronóstico */}
          <PreOrderInbox />

          {/* Refresh Button */}
          {showRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
              Actualizar
            </button>
          )}

          {/* Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-2 text-xs font-semibold transition-colors"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </header>
  );
}