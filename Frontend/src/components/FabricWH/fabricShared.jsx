// components/FabricWH/fabricShared.jsx
// Design system + helpers for the Almacén de Tela screens.
//
//   API         api(), post(), del()
//   Feedback    FabricUIProvider, useToast(), useConfirm()
//   Layout      PageHeader, Card, SegTabs, SearchInput, EmptyState, Skeleton
//   Controls    Button, LocationPicker, ScanBox (hardware scanner + camera)
//   Data        RollTable (sortable, sticky header), ActionBar (floating
//               selection bar), Modal, Drawer, RollDrawer (detail + timeline)
import {
  useState, useEffect, useCallback, useRef, useMemo, createContext, useContext,
} from "react";
import {
  Camera, CameraOff, X, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2,
  Search, ChevronUp, ChevronDown, ChevronsUpDown, MapPin, Package, Clock,
} from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
// All calls go to `${API_URL}/api/fabric-warehouse/...`. The path may be given
// as "/rolls", "/api/fabric-warehouse/rolls" or even a full URL
// ("http://localhost:5000/rolls"): it is always normalised, so a hardcoded host
// can't produce a broken URL. To point at another server change API_URL in
// lib/masterCodeCatalog (the same base every other module uses).
const API_PREFIX = "/api/fabric-warehouse";

function fabricUrl(path) {
  let p = String(path || "");
  p = p.replace(/^https?:\/\/[^/]+/i, "");          // drop any host
  if (p.startsWith(API_PREFIX)) p = p.slice(API_PREFIX.length);
  if (!p.startsWith("/")) p = `/${p}`;
  return `${String(API_URL || "").replace(/\/+$/, "")}${API_PREFIX}${p}`;
}

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

export async function api(path, opts = {}) {
  const res = await fetch(fabricUrl(path), { headers: authHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    if (/token|Authentication/i.test(data.error || "")) {
      localStorage.removeItem("token");
      window.location.href = "/";
    }
  }
  if (!res.ok || data.success === false) {
    const msg = data.error || (res.status === 404
      ? "El servidor no tiene el módulo de almacén de tela (404). Verifique que fabric-warehouse.js esté registrado en server1.js."
      : `Error ${res.status}`);
    const err = new Error(msg);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}
export const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
export const del = (path) => api(path, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------
export const FABRIC_FIELDS = [
  { key: "po_number", label: "Purchase order number", short: "PO" },
  { key: "supplier", label: "Supplier" },
  { key: "supplier_code", label: "Supplier Code" },
  { key: "roll_no", label: "Rollo de tela", short: "Rollo" },
  { key: "yards", label: "Yardas", type: "number" },
  { key: "meters", label: "Metros", type: "number" },
  { key: "color", label: "Color" },
  { key: "lot", label: "Lote" },
  { key: "width", label: "Width" },
  { key: "width_unit", label: "Width Unit" },
  { key: "weight", label: "Weight" },
  { key: "weight_unit", label: "Weight Unit" },
  { key: "weight_gsm", label: "Gramaje (g/m²)" },
  { key: "composition", label: "Composition" },
  { key: "month_buy", label: "Month Buy" },
  { key: "fabric_item_number", label: "Fabric item number" },
  { key: "fabric_name", label: "Fabric name" },
  { key: "fabric_type", label: "Tipo de tela" },
  { key: "customer", label: "Cliente" },
  { key: "arrival_date", label: "Fecha de entrega" },
  { key: "size", label: "Size" },
  { key: "item_sku_code", label: "Item SKU code" },
  { key: "purchase_term", label: "Término de compra" },
  { key: "import_ref", label: "Importación" },
  { key: "remarks", label: "Remarks" },
];

export const STATUS = {
  requested: { label: "En Skytex", cls: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500" },
  assigned: { label: "Esperando llegada", cls: "bg-sky-50 text-sky-700 ring-sky-600/20", dot: "bg-sky-500" },
  in_stock: { label: "En inventario", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  at_inspection: { label: "En inspección", cls: "bg-violet-50 text-violet-700 ring-violet-600/20", dot: "bg-violet-500" },
  returned: { label: "Devuelto", cls: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
  cancelled: { label: "Cancelado", cls: "bg-slate-50 text-slate-400 ring-slate-400/20", dot: "bg-slate-300" },
};

export const MOVE_LABEL = {
  requested: "Solicitado a Skytex",
  location_set: "Contenedor asignado",
  received: "Recibido en almacén",
  relocated: "Cambio de contenedor",
  box_moved: "El contenedor cambió de lugar",
  inspection_out: "Enviado a inspección",
  inspection_back: "Regresó de inspección",
  supplier_return: "Devuelto a proveedor",
  cancelled: "Solicitud cancelada",
  receive_undone: "Recepción deshecha",
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const num = (v, digits = 0) =>
  v == null || v === "" || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("es-MX", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtDateTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
};
export const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
};
export const timeAgo = (ts) => {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

// Where a roll is: «F01 · A01» = container F01, parked on spot A01 of division A.
// «F01 (sin lugar)» = the container was moved and its new spot is not scanned yet.
export const locationText = (r) =>
  r?.status === "requested" && !r?.box_code ? "En Skytex"
  : r?.box_code
    ? r.location_code ? `${r.box_code} · ${r.location_code}` : `${r.box_code} (sin lugar)`
    : r?.location_code ? `${r.location_code} (sin contenedor)` : "—";

// Sort key that keeps F2 before F10.
export const boxSortKey = (r) => `${r?.box_code || "~"}-${r?.location_code || ""}`;

export const todayStr = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const cx = (...a) => a.filter(Boolean).join(" ");

// Tell the layout that data changed (refreshes the sidebar badges).
export const notifyChange = () => window.dispatchEvent(new Event("fabric:changed"));

// Scanner feedback tones.
export function beep(kind = "ok") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep._ctx || (beep._ctx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = kind === "ok" ? 880 : kind === "dup" ? 520 : 260;
    g.gain.value = 0.08;
    o.start();
    o.stop(ctx.currentTime + (kind === "ok" ? 0.09 : 0.2));
  } catch { /* blocked */ }
}

export function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch { /* not supported */ } }

export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// Toasts + confirm dialog (provided once by the layout)
// ---------------------------------------------------------------------------
const UICtx = createContext({
  toast: (t) => console.log("[toast]", t),
  confirm: async (o) => window.confirm(typeof o === "string" ? o : o?.title || "¿Continuar?"),
  openRoll: () => {},
});

export const useToast = () => useContext(UICtx).toast;
export const useConfirm = () => useContext(UICtx).confirm;
export const useRollDrawer = () => useContext(UICtx).openRoll;

const TOAST_STYLE = {
  ok: { icon: CheckCircle2, cls: "text-emerald-600" },
  err: { icon: AlertCircle, cls: "text-red-600" },
  warn: { icon: AlertTriangle, cls: "text-amber-600" },
  info: { icon: Info, cls: "text-indigo-600" },
};

export function FabricUIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [roll, setRoll] = useState(null);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((t) => {
    const id = ++idRef.current;
    const item = typeof t === "string" ? { kind: "info", text: t } : t;
    setToasts((prev) => [...prev.slice(-3), { id, kind: "info", ...item }]);
    setTimeout(() => dismiss(id), item.kind === "err" ? 7000 : 4500);
  }, [dismiss]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    const o = typeof opts === "string" ? { title: opts } : opts;
    setDialog({ ...o, resolve });
  }), []);
  const closeDialog = (v) => { dialog?.resolve(v); setDialog(null); };

  const value = useMemo(() => ({ toast, confirm, openRoll: setRoll }), [toast, confirm]);

  return (
    <UICtx.Provider value={value}>
      {children}

      {/* Toast stack */}
      <div className="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto flex flex-col gap-2 sm:w-96 pointer-events-none" aria-live="polite">
        {toasts.map((t) => {
          const S = TOAST_STYLE[t.kind] || TOAST_STYLE.info;
          return (
            <div key={t.id} className="pointer-events-auto bg-white rounded-xl shadow-lg ring-1 ring-slate-900/10 p-3 flex gap-3 items-start fab-toast-in">
              <S.icon className={cx("w-5 h-5 shrink-0 mt-0.5", S.cls)} />
              <div className="flex-1 text-sm text-slate-700">
                {t.title && <div className="font-semibold text-slate-900">{t.title}</div>}
                <div>{t.text}</div>
                {t.action && (
                  <button onClick={() => { t.action.onClick(); dismiss(t.id); }} className="mt-1 text-sm font-semibold text-indigo-600 hover:text-indigo-800">
                    {t.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar aviso"><X className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>

      {/* Confirm dialog */}
      <Modal
        open={!!dialog}
        onClose={() => closeDialog(false)}
        title={dialog?.title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => closeDialog(false)}>{dialog?.cancelLabel || "Cancelar"}</Button>
            <Button variant={dialog?.danger ? "danger" : "primary"} onClick={() => closeDialog(true)} autoFocus>
              {dialog?.confirmLabel || "Confirmar"}
            </Button>
          </>
        }
      >
        {dialog?.text && <div className="text-sm text-slate-600">{dialog.text}</div>}
      </Modal>

      <RollDrawer roll={roll} onClose={() => setRoll(null)} />

      <style>{`
        @keyframes fabToastIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .fab-toast-in { animation: fabToastIn .18s ease-out }
        @keyframes fabPop { 0% { transform: scale(.97); opacity: .4 } 100% { transform: none; opacity: 1 } }
        .fab-pop { animation: fabPop .22s ease-out }
        @media (prefers-reduced-motion: reduce) { .fab-toast-in, .fab-pop { animation: none } }
        .fab-tnum { font-variant-numeric: tabular-nums }
        .fab-fade { animation: fabFade .18s ease-out }
        @keyframes fabFade { from { opacity: 0 } to { opacity: 1 } }
        .no-scrollbar { scrollbar-width: none } .no-scrollbar::-webkit-scrollbar { display: none }
        .fab-t9 { font-size: 9px; line-height: 12px } .fab-t10 { font-size: 10px; line-height: 13px } .fab-t11 { font-size: 11px; line-height: 14px }
        .fab-r3 { border-radius: 3px }
        /* Custom-value Tailwind classes used by these screens, defined here too so
           they work even when the project's Tailwind build does not generate them. */
        .text-\\[11px\\]{font-size:11px} .text-\\[10px\\]{font-size:10px} .text-\\[9px\\]{font-size:9px} .max-h-\\[40vh\\]{max-height:40vh} .max-h-\\[45vh\\]{max-height:45vh} .max-h-\\[55vh\\]{max-height:55vh} .max-h-\\[70vh\\]{max-height:70vh} .max-h-\\[90vh\\]{max-height:90vh} .z-\\[60\\]{z-index:60} .z-\\[70\\]{z-index:70} .min-w-\\[160px\\]{min-width:160px} .min-w-\\[180px\\]{min-width:180px} .min-w-\\[200px\\]{min-width:200px} .min-w-\\[220px\\]{min-width:220px} .min-w-\\[240px\\]{min-width:240px} .min-w-\\[1\\.25rem\\]{min-width:1.25rem} .max-w-\\[260px\\]{max-width:260px} .aspect-\\[4\\/3\\]{aspect-ratio:4/3} .w-\\[calc\\(100\\%-2rem\\)\\]{width:calc(100% - 2rem)} .w-\\[18px\\]{width:18px} .h-\\[18px\\]{height:18px} .shadow-\\[0_1px_2px_rgba\\(15\\,23\\,42\\,0\\.04\\)\\]{box-shadow:0 1px 2px rgba(15,23,42,0.04)} .gap-\\[3px\\]{gap:3px} .backdrop-blur-\\[2px\\]{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)} .-left-\\[7px\\]{left:-7px} @media (min-width:640px){.sm\\:w-\\[460px\\]{width:460px}} @media (min-width:1280px){.xl\\:max-h-\\[calc\\(100vh-6rem\\)\\]{max-height:calc(100vh - 6rem)}}
      `}</style>
    </UICtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Basic building blocks
// ---------------------------------------------------------------------------
const BTN = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
  dark: "bg-slate-900 text-white hover:bg-slate-800 shadow-sm",
  onDark: "text-slate-200 hover:bg-white/10 hover:text-white",
  onDarkDanger: "text-red-300 hover:bg-white/10 hover:text-red-200",
};
export function Button({ variant = "primary", size = "md", icon: Icon, loading = false, className = "", children, ...rest }) {
  const sz = size === "sm" ? "px-2.5 py-1.5 text-xs gap-1.5" : size === "lg" ? "px-5 py-3 text-base gap-2" : "px-3.5 py-2 text-sm gap-2";
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition whitespace-nowrap",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        BTN[variant], sz, className
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} /> : null}
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="flex flex-wrap items-end gap-3 justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </div>
  );
}

export function Card({ className = "", children, ...rest }) {
  return <section {...rest} className={cx("bg-white rounded-2xl ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>{children}</section>;
}
export function CardHeader({ title, subtitle, actions, className = "" }) {
  return (
    <div className={cx("px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status || "—", cls: "bg-slate-100 text-slate-500 ring-slate-400/20", dot: "bg-slate-400" };
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-inset", s.cls)}>
      <span className={cx("w-1.5 h-1.5 rounded-full", s.dot)} />{s.label}
    </span>
  );
}

export function Pill({ tone = "slate", children }) {
  const t = {
    slate: "bg-slate-100 text-slate-600", red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700", indigo: "bg-indigo-50 text-indigo-700",
  }[tone];
  return <span className={cx("text-xs rounded-md px-1.5 py-0.5 font-medium whitespace-nowrap", t)}>{children}</span>;
}

// Kept for older screens; new screens use StatCard.
export function Tile({ icon: Icon, label, value, sub, accent = "slate" }) {
  return <StatCard icon={Icon} label={label} value={value} sub={sub} tone={accent === "gray" ? "slate" : accent} />;
}

export function StatCard({ icon: Icon, label, value, sub, tone = "slate", onClick }) {
  const tones = {
    slate: "text-slate-600 bg-slate-100", amber: "text-amber-700 bg-amber-100", emerald: "text-emerald-700 bg-emerald-100",
    indigo: "text-indigo-700 bg-indigo-100", sky: "text-sky-700 bg-sky-100", violet: "text-violet-700 bg-violet-100", red: "text-red-700 bg-red-100",
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "text-left bg-white rounded-2xl ring-1 ring-slate-200 p-4 flex items-start gap-3",
        onClick && "hover:ring-indigo-300 hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      )}
    >
      {Icon && <span className={cx("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", tones[tone] || tones.slate)}><Icon className="w-[18px] h-[18px]" /></span>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="text-2xl font-semibold text-slate-900 fab-tnum leading-tight mt-0.5">{typeof value === "number" ? num(value) : value ?? "—"}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </Tag>
  );
}

export function SegTabs({ tabs, value, onChange, size = "md" }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-slate-100 gap-1 overflow-x-auto max-w-full" role="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cx(
              "inline-flex items-center gap-2 rounded-lg font-medium whitespace-nowrap transition",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {t.icon && <t.icon className="w-4 h-4" />}
            {t.label}
            {t.count != null && (
              <span className={cx("text-xs rounded-full px-1.5 min-w-[1.25rem] text-center fab-tnum", on ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600")}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Buscar…", className = "", inputRef }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 rounded-lg bg-white ring-1 ring-inset ring-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {value && (
        <button onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Limpiar búsqueda">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export const inputCls = "px-3 py-2 rounded-lg bg-white ring-1 ring-inset ring-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500";

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function EmptyState({ icon: Icon = Package, title, text, action }) {
  return (
    <div className="py-14 px-6 text-center">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
        <Icon className="w-6 h-6" />
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-800">{title}</div>
      {text && <div className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 6 }) {
  return (
    <div className="p-4 space-y-3 animate-pulse" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((__, j) => (
            <div key={j} className="h-3.5 rounded bg-slate-100 flex-1" style={{ maxWidth: j === 0 ? 90 : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value = 0, max = 100, tone = "indigo", className = "h-1.5" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const t = { indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", violet: "bg-violet-500", sky: "bg-sky-500" }[tone];
  return (
    <div className={cx("w-full rounded-full bg-slate-100 overflow-hidden", className)}>
      <div className={cx("h-full rounded-full transition-all", t)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Banner({ kind = "info", children, onClose }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    err: "bg-red-50 text-red-700 ring-red-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    info: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  }[kind];
  const S = TOAST_STYLE[kind] || TOAST_STYLE.info;
  return (
    <div className={cx("px-4 py-3 rounded-xl ring-1 ring-inset text-sm flex items-start gap-3", cls)}>
      <S.icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Cerrar"><X className="w-4 h-4" /></button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  useEscape(open, onClose);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx("relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col fab-pop", w)}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[460px] bg-white shadow-2xl flex flex-col fab-pop">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900 truncate">{title}</div>
            {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex gap-2">{footer}</div>}
      </aside>
    </div>
  );
}

// Roll detail: every Skytex field + its movement timeline. Opened from any
// table row (useRollDrawer) or the global search.
export function RollDrawer({ roll, onClose }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!roll?.id) return;
    setHistory(null);
    api(`/rolls/${roll.id}/history`).then((d) => setHistory(d.history || [])).catch(() => setHistory([]));
  }, [roll?.id]);

  const close = useCallback(() => onClose(), [onClose]);
  if (!roll) return null;
  const main = ["fabric_name", "color", "lot", "po_number", "supplier", "customer"];
  return (
    <Drawer open onClose={close} title={<span className="font-mono">{roll.roll_no}</span>} subtitle={roll.fabric_name || roll.supplier || "Rollo"}>
      <div className="p-5 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={roll.status} />
          {roll.inspection_result === "rejected" && <Pill tone="red">Rechazado en inspección</Pill>}
          {roll.inspection_result === "approved" && <Pill tone="emerald">Aprobado en inspección</Pill>}
          {roll.days_in_stock != null && <Pill tone={roll.days_in_stock >= 30 ? "red" : "slate"}>{roll.days_in_stock} días en almacén</Pill>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 col-span-3 sm:col-span-1">
            <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Ubicación</div>
            <div className="text-lg font-semibold text-slate-900">{locationText(roll)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Yardas</div>
            <div className="text-lg font-semibold text-slate-900 fab-tnum">{num(roll.yards, 2)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Metros</div>
            <div className="text-lg font-semibold text-slate-900 fab-tnum">{num(roll.meters, 2)}</div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">Datos de Skytex</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            {[...main.map((k) => FABRIC_FIELDS.find((f) => f.key === k)), ...FABRIC_FIELDS.filter((f) => !main.includes(f.key) && !["roll_no", "yards", "meters"].includes(f.key))].map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="text-xs text-slate-400">{f.label}</dt>
                <dd className="text-slate-800 break-words">{roll[f.key] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">Historial</div>
          {history == null ? (
            <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-slate-400">Sin movimientos.</div>
          ) : (
            <ol className="relative border-l-2 border-dashed border-slate-200 ml-1.5 space-y-4">
              {history.map((m) => (
                <li key={m.id} className="ml-4">
                  <span className="absolute -left-[7px] mt-1 w-3 h-3 rounded-full bg-white ring-2 ring-indigo-400" />
                  <div className="text-sm font-medium text-slate-800">{MOVE_LABEL[m.type] || m.type}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDateTime(m.created_at)}
                    {m.user_name && <> · {m.user_name}</>}
                  </div>
                  {(m.from_location || m.to_location || m.reference || m.reason) && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {m.from_location && <>De {m.from_location} </>}
                      {m.to_location && <>→ {m.to_location} </>}
                      {m.reference && <>· Ref. {m.reference} </>}
                      {m.reason && <>· {m.reason === "approved" ? "aprobado" : m.reason === "rejected" ? "rechazado" : m.reason}</>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// Floating selection bar: appears at the bottom while rows are selected.
export function ActionBar({ count, summary, onClear, children }) {
  if (!count) return null;
  return (
    <div className="fixed z-40 bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-4xl fab-pop">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="bg-white text-slate-900 rounded-lg px-2 py-0.5 text-sm font-semibold fab-tnum">{count}</span>
          <span className="text-sm text-slate-300">seleccionados{summary ? <> · {summary}</> : null}</span>
        </div>
        <button onClick={onClear} className="text-xs text-slate-400 hover:text-white underline underline-offset-2">Quitar selección</button>
        <div className="ml-auto flex flex-wrap items-center gap-2 [&_select]:text-slate-900">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scanner input
// ---------------------------------------------------------------------------
// pda: on Android PDAs (Zebra, Honeywell…) the hardware scanner types into the
// box, so the on-screen keyboard is kept closed (inputMode="none"). The ⌨
// button opens it when someone needs to type a code by hand.
// Input for PDA scanners in keyboard mode (the scanner "types" the code).
// Made to never miss a scan:
//   • it is never disabled (a disabled input loses focus and the next scan is
//     typed nowhere); scans that arrive while the previous one is still being
//     processed are queued
//   • it takes the focus back after every scan and when the window regains it
//   • if the focus is somewhere else (a button), a fast burst of keys is
//     captured anyway
//   • the scan ends with Enter, Tab, or — for scanners without a suffix — a
//     short pause after a fast burst of 3+ characters (typing by hand is slower
//     and never triggers it)
//   • scanners in "fill / direct input" mode put the whole code in the field
//     at once (no key presses): 3+ characters arriving in one go also count
//     as a complete scan
const SCAN_GAP_MS = 45;     // max time between characters of a scanner burst
const SCAN_IDLE_MS = 160;   // pause that ends a burst without Enter/Tab

export function ScanBox({ onScan, busy = false, placeholder = "Escanee el QR del rollo…", autoFocus = true, size = "md", pda = false }) {
  const [value, setValue] = useState("");
  const [keyboard, setKeyboard] = useState(!pda);
  const ref = useRef(null);
  const valueRef = useRef("");
  const busyRef = useRef(busy);       // parent says it is still working
  const runningRef = useRef(false);   // a scan is being processed here
  const queue = useRef([]);
  const burst = useRef({ last: 0, fast: 0, timer: 0 });
  const [focused, setFocused] = useState(false);
  busyRef.current = busy;

  const setVal = useCallback((v) => { valueRef.current = v; setValue(v); }, []);
  const focus = useCallback(() => {
    const el = ref.current;
    const active = document.activeElement;
    // Don't steal focus from other inputs the user is typing in.
    if (el && active !== el && !(active && /INPUT|TEXTAREA|SELECT/.test(active.tagName))) el.focus();
  }, []);

  // Queued scans run one by one, each only after the screen has updated with
  // the previous result (e.g. the container scan after the spot scan).
  const drainRef = useRef(() => {});
  const run = useCallback(async (t) => {
    runningRef.current = true;
    try { await onScan(t); } finally {
      runningRef.current = false;
      setTimeout(() => drainRef.current(), 40);
    }
  }, [onScan]);
  drainRef.current = () => {
    if (runningRef.current || busyRef.current) return;
    const next = queue.current.shift();
    if (next) run(next);
  };

  const submit = useCallback((text) => {
    clearTimeout(burst.current.timer);
    burst.current.fast = 0;
    const t = String(text ?? "").trim();
    setVal("");
    if (!t) return;
    if (runningRef.current || busyRef.current || queue.current.length) { queue.current.push(t); return; }
    run(t);
  }, [run, setVal]);

  // Back to the input when work finishes, and when the window gets the focus.
  useEffect(() => {
    if (!autoFocus) return undefined;
    ref.current?.focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [autoFocus, focus]);
  useEffect(() => {
    if (busy) return;
    if (autoFocus) setTimeout(focus, 0);
    setTimeout(() => drainRef.current(), 40);
  }, [busy, autoFocus, focus]);

  // Scanner bursts typed while the focus is on a button / the page.
  useEffect(() => {
    if (!autoFocus) return undefined;
    const onKey = (e) => {
      const el = ref.current;
      const a = document.activeElement;
      if (!el || a === el || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) || a?.isContentEditable) return;
      if (document.querySelector("[role=dialog], [aria-modal=true]")) return; // a dialog is open
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) {
        e.preventDefault();
        el.focus();
        track();
        setVal(valueRef.current + e.key);
      } else if ((e.key === "Enter" || e.key === "Tab") && valueRef.current) {
        e.preventDefault();
        el.focus();
        submit(valueRef.current);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [autoFocus, submit, setVal]); // eslint-disable-line react-hooks/exhaustive-deps

  // The whole code arrived in one go (scanner fill mode): send it after a
  // moment, unless an Enter/Tab arrives first.
  function inserted() {
    const b = burst.current;
    clearTimeout(b.timer);
    b.fast = 0;
    b.timer = setTimeout(() => { if (valueRef.current) submit(valueRef.current); }, 120);
  }

  // Timing of the characters: a fast burst followed by a pause = one scan.
  function track() {
    const now = Date.now();
    const b = burst.current;
    b.fast = now - b.last <= SCAN_GAP_MS ? b.fast + 1 : 0;
    b.last = now;
    clearTimeout(b.timer);
    if (b.fast >= 2) b.timer = setTimeout(() => { if (valueRef.current) submit(valueRef.current); }, SCAN_IDLE_MS);
  }

  const lg = size === "lg";
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <div className={cx(
        "flex-1 flex items-center gap-3 rounded-xl bg-white ring-2 transition",
        focused ? "ring-indigo-500" : "ring-amber-300",
        lg ? "px-4 py-3" : "px-3 py-2"
      )} style={{ minWidth: 240 }} onClick={() => ref.current?.focus()}>
        <span className="relative flex w-2.5 h-2.5" title={focused ? "Listo para escanear" : "Toque aquí para escanear"}>
          {focused && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />}
          <span className={cx("relative inline-flex rounded-full w-2.5 h-2.5", focused ? "bg-emerald-500" : "bg-amber-400")} />
        </span>
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v.length - valueRef.current.length >= 3) inserted(); else track();
            setVal(v);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || (e.key === "Tab" && valueRef.current)) { e.preventDefault(); submit(valueRef.current); }
          }}
          inputMode={keyboard ? "text" : "none"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={focused ? placeholder : "Toque aquí para activar el escáner"}
          className={cx("flex-1 min-w-0 bg-transparent font-mono focus:outline-none placeholder:font-sans placeholder:text-slate-400", lg ? "text-lg" : "text-sm")}
          aria-label="Código escaneado"
        />
        {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        {pda && (
          <button
            type="button"
            onClick={() => { setKeyboard((k) => !k); setTimeout(() => ref.current?.focus(), 0); }}
            className={cx("text-xs rounded-md px-2 py-1 ring-1", keyboard ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "text-slate-400 ring-slate-200")}
            aria-label={keyboard ? "Ocultar teclado" : "Escribir con teclado"}
            title={keyboard ? "Ocultar teclado" : "Escribir con teclado"}
          >⌨</button>
        )}
      </div>
      <Button size={lg ? "lg" : "md"} onClick={() => submit(valueRef.current)} disabled={!value.trim()}>Registrar</Button>
      <CameraScanner onScan={submit} large={lg} />
    </div>
  );
}

function CameraScanner({ onScan, large }) {
  const [supported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef({ text: "", at: 0 });

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }, []);
  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setErr(null);
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      streamRef.current = stream;
      setOn(true);
      for (let i = 0; i < 20 && !videoRef.current; i++) await new Promise((r) => setTimeout(r, 25));
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!streamRef.current) return;
        try {
          const codes = await detector.detect(video);
          const text = String(codes?.[0]?.rawValue || "").trim();
          const now = Date.now();
          if (text && (text !== lastRef.current.text || now - lastRef.current.at > 2500)) {
            lastRef.current = { text, at: now };
            onScan(text);
          }
        } catch { /* no code in frame */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setErr(e.message || "No se pudo abrir la cámara");
      stop();
    }
  }, [onScan, stop]);

  if (!supported) return null;
  return (
    <>
      <Button variant={on ? "danger" : "secondary"} size={large ? "lg" : "md"} icon={on ? CameraOff : Camera} onClick={() => (on ? stop() : start())}>
        {on ? "Cerrar cámara" : "Cámara"}
      </Button>
      {on && (
        <div className="w-full mt-2">
          <div className="relative w-full max-w-sm mx-auto rounded-2xl overflow-hidden bg-black">
            <video ref={videoRef} playsInline muted className="w-full h-auto block" />
            <div className="pointer-events-none absolute inset-8 border-2 border-white/80 rounded-xl" />
          </div>
        </div>
      )}
      {err && <p className="text-xs text-red-600 w-full">{err}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Location picker
// ---------------------------------------------------------------------------
// `containers` is the /containers response: divisions (A–E) with their spots;
// each spot carries the container parked on it (box_id, box_code). The value
// and onChange are the CONTAINER id (box_id).
export function LocationPicker({ containers, value, onChange, showFree = true, allowEmpty = false, emptyLabel = "Elegir contenedor…", className = "" }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={cx(inputCls, "pr-8", className)}
      aria-label="Contenedor"
    >
      <option value="" disabled={!allowEmpty}>{emptyLabel}</option>
      {containers.map((c) => {
        const spots = (c.locations || [])
          .filter((l) => l.box_code)
          .sort((a, b) => a.box_code.localeCompare(b.box_code, "es", { numeric: true }));
        if (!spots.length) return null;
        return (
          <optgroup key={c.id} label={`División ${c.code}${c.name ? ` — ${c.name}` : ""}`}>
            {spots.map((l) => {
              const used = Number(l.reserved || 0) + Number(l.stored || 0);
              const free = l.capacity != null ? Math.max(0, l.capacity - used) : null;
              return (
                <option key={l.id} value={l.box_id} disabled={free === 0}>
                  {l.box_code} · {l.code}
                  {showFree ? (free != null ? ` — ${free} libre(s)` : ` — ${used} rollo(s)`) : ""}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Roll table: sortable, sticky header, checkbox selection, row click opens
// the roll drawer (or a custom onRowClick).
// ---------------------------------------------------------------------------
export function RollTable({
  rows, columns, selected, onToggle, onToggleAll, empty, rowClass,
  onRowClick, maxHeight = "65vh", loading = false, defaultSort = null, canSelect,
}) {
  const openRoll = useRollDrawer();
  const [sort, setSort] = useState(defaultSort); // { key, dir }
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.sortValue || ((r) => r[sort.key]);
    const out = [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const na = Number(va), nb = Number(vb);
      const cmp = !Number.isNaN(na) && !Number.isNaN(nb) && va !== "" && vb !== ""
        ? na - nb
        : String(va).localeCompare(String(vb), "es", { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sort, columns]);

  const selectable = canSelect ? sorted.filter(canSelect) : sorted;
  const allOn = selectable.length > 0 && selectable.every((r) => selected?.has(r.id));
  const someOn = !allOn && selectable.some((r) => selected?.has(r.id));
  const click = onRowClick || openRoll;

  const toggleSort = (c) => {
    if (c.sortable === false || !c.label) return;
    setSort((s) => (!s || s.key !== c.key ? { key: c.key, dir: "asc" } : s.dir === "asc" ? { key: c.key, dir: "desc" } : null));
  };

  if (loading) return <SkeletonRows cols={Math.min(columns.length, 7)} />;
  if (!rows.length) return typeof empty === "string" || !empty ? <EmptyState title={empty || "Sin rollos"} /> : empty;

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            {selected && (
              <th className="pl-4 pr-2 py-2.5 w-8">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = someOn; }}
                  onChange={() => onToggleAll(!allOn, selectable.map((r) => r.id))}
                  aria-label="Seleccionar todos"
                />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = active ? (sort.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
              return (
                <th key={c.key} className={cx("px-3 py-2.5 font-medium", c.align === "right" && "text-right")}>
                  {c.label && c.sortable !== false ? (
                    <button onClick={() => toggleSort(c)} className={cx("inline-flex items-center gap-1 hover:text-slate-800", active && "text-slate-900")}>
                      {c.label}<Icon className={cx("w-3 h-3", !active && "opacity-30")} />
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r) => {
            const sel = selected?.has(r.id);
            const can = !canSelect || canSelect(r);
            return (
              <tr
                key={r.id}
                onClick={click ? () => click(r) : undefined}
                className={cx("group cursor-pointer", sel ? "bg-indigo-50/70" : "hover:bg-slate-50", rowClass && rowClass(r))}
              >
                {selected && (
                  <td className="pl-4 pr-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
                      checked={!!sel}
                      disabled={!can}
                      onChange={() => onToggle(r.id)}
                      aria-label={`Seleccionar ${r.roll_no}`}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-3 py-2.5 text-slate-700", c.align === "right" && "text-right fab-tnum", c.mono && "font-mono text-slate-900", c.className)}>
                    {c.render ? c.render(r) : r[c.key] ?? <span className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function useSelection() {
  const [sel, setSel] = useState(() => new Set());
  const toggle = useCallback((id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const setAll = useCallback((ids, on) => setSel((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; }), []);
  const clear = useCallback(() => setSel(new Set()), []);
  return { sel, toggle, setAll, clear };
}

// Days-in-stock cell with an aging warning.
export function DaysCell({ days, limit = 30 }) {
  if (days == null) return <span className="text-slate-300">—</span>;
  const over = days >= limit;
  return (
    <span className={cx("inline-flex items-center gap-1 fab-tnum", over ? "text-red-600 font-semibold" : days >= limit * 0.7 ? "text-amber-600" : "text-slate-600")}>
      {over && <Clock className="w-3.5 h-3.5" />}{days}
    </span>
  );
}
// ---------------------------------------------------------------------------
// Scanning flow shared by Recepción and Ubicaciones:
//   1. Lugar      scan the spot label (A01)
//   2. Contenedor scan the container that is physically there (F33). If the
//                 system has F33 somewhere else (or not at all) it asks to
//                 register that F33 is now on A01; the container that was
//                 registered on A01 stays «sin lugar» until it is scanned
//                 where it really is.
//   3. Rollos     each roll scanned goes into F33 (received or reserved,
//                 depending on the endpoint).
// Scanning another spot label at any time starts again at step 2.
// ---------------------------------------------------------------------------
const FLOW_EMPTY = { spot: null, box: null };

// locked: rolls are waiting to be saved in the current container → the spot and
// container can't change until they are saved or the list is emptied.
export function useScanFlow({ endpoint, storageKey, extra = {}, onRoll, onRollError, locked = 0 }) {
  const [flow, setFlow] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || FLOW_EMPTY; } catch { return FLOW_EMPTY; }
  });
  const [prompt, setPrompt] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const ref = useRef({});
  ref.current = { flow, extra, onRoll, onRollError, prompt, locked };

  useEffect(() => {
    try { flow.spot ? sessionStorage.setItem(storageKey, JSON.stringify(flow)) : sessionStorage.removeItem(storageKey); } catch { /* */ }
  }, [flow, storageKey]);

  const step = !flow.spot ? 1 : !flow.box ? 2 : 3;
  const say = useCallback((kind, text) => setNote({ kind, text, n: ++seq.current }), []);

  const lockedSay = useCallback(() => {
    beep("err"); vibrate([200, 100, 200]);
    say("err", `Hay ${ref.current.locked} rollo(s) escaneados sin guardar. Guárdelos o vacíe la lista antes de cambiar de lugar o contenedor.`);
  }, [say]);
  const reset = useCallback(() => {
    if (ref.current.locked) return lockedSay();
    setFlow(FLOW_EMPTY); setPrompt(null); setNote(null);
  }, [lockedSay]);
  const rescanBox = useCallback(() => {
    if (ref.current.locked) return lockedSay();
    setFlow((f) => ({ ...f, box: null })); setPrompt(null); setNote(null);
  }, [lockedSay]);
  const setBox = useCallback((box) => setFlow((f) => (f.box && box && String(f.box.id) === String(box.id) ? { ...f, box: { ...f.box, ...box } } : f)), []);
  // Manual choice (label can't be read): container + the spot it is on.
  const choose = useCallback((spot, box) => {
    setFlow({ spot, box }); setPrompt(null);
    say("ok", `Contenedor ${box.code} en ${spot.code}. Ahora escanee los rollos.`);
  }, [say]);

  // Register that container p.code is on the current spot (moving it here if
  // it was registered somewhere else), then go on to the rolls.
  const placeRef = useRef(null);
  placeRef.current = async (p) => {
    const f = ref.current.flow;
    if (!p || !f.spot) return;
    setBusy(true);
    try {
      const d = await post("/boxes/place", { pairs: [{ locationId: f.spot.id, boxCode: p.code }], displace: true });
      const same = (b) => b && String(b.code || "").toUpperCase() === p.code.toUpperCase();
      let box = (d.boxes || []).find(same);
      if (!box) {
        // The reply did not include the container: ask the server what this code is now.
        const r = await post(endpoint, { raw: p.code, expect: "box" });
        if (r.kind === "box" && same(r.box)) box = r.box;
      }
      if (!box?.id || String(box.location_id) !== String(f.spot.id)) {
        throw new Error(
          `El servidor no registró ${p.code} en ${f.spot.code}. Verifique que fabric-warehouse.js en el servidor sea la versión nueva ` +
          "(con la tabla fabric_boxes) y que el servidor se haya reiniciado."
        );
      }
      setFlow({ spot: { ...f.spot, box_id: box.id, box_code: box.code }, box });
      setPrompt(null);
      beep("ok"); vibrate(60);
      say("ok", `${p.from ? `${p.code} ahora está en ${f.spot.code}` : `${p.code} colocado en ${f.spot.code}`}.${p.displaced ? ` ${p.displaced} quedó sin lugar hasta que lo escanee donde está.` : ""} Escanee los rollos.`);
      notifyChange();
    } catch (e) {
      setPrompt(null); // otherwise the prompt hides the error
      beep("err"); vibrate([200, 100, 200]);
      say("err", e.message);
    } finally { setBusy(false); }
  };

  const scan = useCallback(async (raw) => {
    const { flow: f, extra: x, onRoll: ok, onRollError: bad } = ref.current;
    const st = !f.spot ? 1 : !f.box ? 2 : 3;
    setBusy(true);
    try {
      const d = await post(endpoint, { ...x, raw, boxId: st === 3 ? f.box.id : undefined, expect: st === 2 ? "box" : undefined });

      if ((d.kind === "location" || d.kind === "box" || d.kind === "unknown_box") && ref.current.locked) {
        // Same container scanned again is harmless; anything else would mix lists.
        if (d.kind === "box" && f.box && String(d.box.id) === String(f.box.id)) return;
        lockedSay();
        return;
      }

      if (d.kind === "location") {
        const L = d.location;
        beep("ok"); vibrate(60);
        setFlow({ spot: L, box: null }); setPrompt(null);
        say("ok", `Lugar ${L.code}. Ahora escanee el contenedor que está aquí${L.box_code ? ` (registrado: ${L.box_code})` : ""}.`);
        return;
      }

      if (d.kind === "invalid_box") {
        beep("err"); vibrate([200, 100, 200]);
        say("err", d.error || `${d.code} no es uno de los contenedores registrados.`);
        return;
      }

      if (d.kind === "box" || d.kind === "unknown_box") {
        const B = d.kind === "box" ? d.box : { code: d.code };
        if (!f.spot) {
          beep("err"); vibrate([200, 100, 200]);
          say("err", `Escanee primero el lugar donde está ${B.code} (por ejemplo A01).`);
          return;
        }
        if (B.id && String(B.location_id) === String(f.spot.id)) {
          beep("ok"); vibrate(60);
          setFlow({ spot: f.spot, box: B }); setPrompt(null);
          say("ok", `Contenedor ${B.code} en ${f.spot.code}. Ahora escanee los rollos.`);
          return;
        }
        const p = {
          code: B.code,
          isNew: !B.id,
          from: B.location_code || null,
          rolls: Number(B.stored || 0) + Number(B.reserved || 0),
          displaced: f.spot.box_code && f.spot.box_code.toUpperCase() !== B.code.toUpperCase() ? f.spot.box_code : null,
        };
        // A free, empty container on an empty spot: nothing moves, just place it.
        if (B.id && !p.from && !p.displaced && !p.rolls) {
          await placeRef.current(p);
          return;
        }
        beep("dup"); vibrate([80, 60, 80]);
        setPrompt(p);
        setNote(null);
        return;
      }

      setPrompt(null);
      ok?.(d, raw);
    } catch (e) {
      if (st < 3) {
        beep("err"); vibrate([200, 100, 200]);
        say("err", e.data?.code === "no_box"
          ? st === 1 ? "Ese código no es un lugar. Escanee primero la etiqueta del lugar (A01)." : "Ese código no es un contenedor. Escanee la etiqueta del contenedor (F01)."
          : e.message);
        return;
      }
      bad?.(e, raw);
    } finally { setBusy(false); }
  }, [endpoint, say, lockedSay]);

  // «Sí, está aquí»: register that the scanned container is on the current spot.
  const confirmPrompt = useCallback(() => placeRef.current(ref.current.prompt), []);

  const cancelPrompt = useCallback(() => {
    const { flow: f, prompt: p } = ref.current;
    setPrompt(null);
    say("warn", `No se cambió nada. Escanee el contenedor que está en ${f.spot?.code || "el lugar"}${p?.displaced ? ` (${p.displaced})` : ""}.`);
  }, [say]);

  return { flow, step, prompt, note, busy, scan, confirmPrompt, cancelPrompt, reset, rescanBox, setBox, choose, say };
}

// Turns a spot of the /containers response into the { spot, box } pair used by choose().
export function pickFromContainers(containers, boxId) {
  for (const d of containers || []) {
    const l = (d.locations || []).find((x) => String(x.box_id) === String(boxId));
    if (l) {
      return {
        spot: { id: l.id, code: l.code, container_code: d.code, division_code: d.code, box_id: l.box_id, box_code: l.box_code },
        box: { id: l.box_id, code: l.box_code, location_id: l.id, location_code: l.code, division_code: d.code, container_code: d.code,
          capacity: l.capacity, stored: l.stored, reserved: l.reserved, yards: l.yards },
      };
    }
  }
  return null;
}

const FLOW_STEPS = [
  { n: 1, label: "Lugar" },
  { n: 2, label: "Contenedor" },
  { n: 3, label: "Rollos" },
];

// The card with the three steps, the active container, the move prompt and the
// scan input. `rollsLabel` = what step 3 does («guardar», «reservar»).
export function ScanFlowCard({ f, containers = [], rollsVerb = "guardar", children }) {
  const [pickOpen, setPickOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const { flow, step, prompt, note, busy } = f;
  const B = flow.box;
  const stored = Number(B?.stored || 0), reserved = Number(B?.reserved || 0), used = stored + reserved;
  const cap = B?.capacity != null ? Number(B.capacity) : null;
  const full = cap != null && used >= cap;
  const nearlyFull = cap != null && used >= cap * 0.9;
  const values = { 1: flow.spot?.code, 2: B?.code, 3: null };
  const placeholder = step === 1 ? "Escanee el QR del lugar (A01)…"
    : step === 2 ? `Escanee el QR del contenedor que está en ${flow.spot.code} (F01)…`
    : `Escanee un rollo para ${rollsVerb} en ${B.code}…`;

  return (
    <Card className={cx("p-4 sm:p-5 space-y-4", step < 3 && "ring-2 ring-indigo-300")}>
      {/* Steps */}
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {FLOW_STEPS.map((s, i) => {
          const done = step > s.n, current = step === s.n;
          const clickable = (s.n === 1 && flow.spot) || (s.n === 2 && B);
          return (
            <li key={s.n} className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              {i > 0 && <span className={cx("h-px w-3 sm:w-6", done || current ? "bg-indigo-300" : "bg-slate-200")} />}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => (s.n === 1 ? f.reset() : f.rescanBox())}
                title={clickable ? (s.n === 1 ? "Escanear otro lugar" : "Escanear otro contenedor") : undefined}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-sm transition min-w-0",
                  current ? "bg-indigo-600 text-white" : done ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:ring-emerald-400" : "bg-slate-100 text-slate-500"
                )}
              >
                <span className={cx("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                  current ? "bg-white/20" : done ? "bg-emerald-600 text-white" : "bg-white text-slate-400")}>
                  {done ? <CheckCircle2 className="w-4 h-4" /> : s.n}
                </span>
                <span className="truncate">{done && values[s.n] ? <b className="font-mono">{values[s.n]}</b> : s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Where we are */}
      {step === 1 && (
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0"><MapPin className="w-7 h-7" /></div>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-900 leading-tight">Escanee el QR del lugar</div>
            <div className="text-sm text-slate-500">La etiqueta del lugar en el patio, por ejemplo <b>A01</b>.</div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">Lugar · División {flow.spot.container_code || flow.spot.division_code}</div>
            <div className="text-4xl font-bold tracking-tight text-slate-900 leading-none mt-1">{flow.spot.code}</div>
            <div className="text-sm text-slate-600 mt-2">
              Ahora escanee el contenedor que está aquí.
              <span className="text-slate-400"> {flow.spot.box_code ? `Registrado: ${flow.spot.box_code}` : "No hay contenedor registrado en este lugar."}</span>
            </div>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-1"><Package className="w-3.5 h-3.5" /> Contenedor</div>
            <div className="text-5xl font-bold tracking-tight text-slate-900 leading-none mt-1">{B.code}</div>
            <div className="text-xs text-slate-500 mt-1">en {flow.spot.code} · División {flow.spot.container_code || flow.spot.division_code || B.division_code}</div>
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="flex items-baseline justify-between">
              <span className={cx("text-2xl font-semibold fab-tnum", full ? "text-red-600" : nearlyFull ? "text-amber-600" : "text-slate-900")}>
                {used}{cap != null && <span className="text-base text-slate-400"> / {cap}</span>}
              </span>
              <span className="text-xs text-slate-500">{stored} guardados · {reserved} reservados</span>
            </div>
            {cap != null && <ProgressBar value={used} max={cap} tone={full ? "red" : nearlyFull ? "amber" : "emerald"} className="h-2.5 mt-1.5" />}
            <div className="text-xs mt-1 text-slate-500">
              {full ? <span className="text-red-600 font-medium">Contenedor lleno — escanee otro lugar y contenedor</span>
                : cap != null ? `Caben ${cap - used} más${nearlyFull ? " — casi lleno" : ""}` : "Sin límite de rollos"}
            </div>
          </div>
          <button onClick={f.reset} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Terminar con este contenedor" title="Terminar con este contenedor">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* The scanned container is not registered on this spot */}
      {prompt && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-300 p-4 fab-pop" role="alert">
          <div className="flex items-start gap-2 text-amber-900">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-base">
                {prompt.isNew ? `${prompt.code} no está registrado` : prompt.from ? `${prompt.code} estaba registrado en ${prompt.from}` : `${prompt.code} no tenía lugar registrado${prompt.rolls ? ` y tiene ${prompt.rolls} rollo(s)` : ""}`}
              </div>
              <div className="mt-0.5">
                ¿{prompt.isNew ? "Registrarlo" : "Registrar que ahora está"} en <b>{flow.spot.code}</b>?
                {!prompt.isNew && prompt.rolls > 0 && <> Sus {prompt.rolls} rollo(s) se mueven con él.</>}
                {prompt.displaced && <> <b>{prompt.displaced}</b>, que estaba registrado aquí, quedará sin lugar hasta que lo escanee donde está.</>}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={f.confirmPrompt}>Sí, {prompt.code} está en {flow.spot.code}</Button>
            <Button size="sm" variant="secondary" onClick={f.cancelPrompt}>No, volver a escanear</Button>
          </div>
        </div>
      )}

      {note && !prompt && (
        <div key={note.n} role="status" aria-live="polite"
          className={cx("rounded-lg px-3 py-2 text-sm fab-pop",
            note.kind === "ok" && "bg-emerald-50 text-emerald-800",
            note.kind === "warn" && "bg-amber-50 text-amber-800",
            note.kind === "err" && "bg-red-600 text-white font-medium")}>
          {note.text}
        </div>
      )}

      <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
        {step === 3 ? <>Paso 3 · Escanee los rollos (hasta {MAX_BATCH}) y después guárdelos juntos</> : step === 2 ? <>Paso 2 · Escanee el contenedor</> : <>Paso 1 · Escanee el lugar</>}
      </div>
      <ScanBox onScan={f.scan} busy={busy} size="lg" pda placeholder={placeholder} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {children}
        <button onClick={() => setPickOpen((v) => !v)} className="text-indigo-600 hover:text-indigo-800">¿La etiqueta no se lee? Elegir contenedor</button>
        <button onClick={() => setTestOpen(true)} className="text-slate-500 hover:text-slate-800">Probar escáner</button>
        {pickOpen && (
          <LocationPicker
            containers={containers}
            value={B?.id}
            onChange={(id) => { const p = pickFromContainers(containers, id); if (p) { f.choose(p.spot, p.box); setPickOpen(false); } }}
          />
        )}
      </div>
      <ScanTester open={testOpen} onClose={() => setTestOpen(false)} expect={f.step === 2 ? "box" : undefined} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Scan 1–40 rolls into a list, check it, then save them all together.
// The list survives a page refresh (sessionStorage) and belongs to the
// container it was scanned for.
// ---------------------------------------------------------------------------
export const MAX_BATCH = 40;

export function useRollBatch(storageKey) {
  const [batch, setBatch] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || { boxId: null, items: [] }; } catch { return { boxId: null, items: [] }; }
  });
  useEffect(() => {
    try { batch.items.length ? sessionStorage.setItem(storageKey, JSON.stringify(batch)) : sessionStorage.removeItem(storageKey); } catch { /* */ }
  }, [batch, storageKey]);
  const add = useCallback((boxId, item) => setBatch((b) => ({ boxId, items: [item, ...b.items] })), []);
  const remove = useCallback((raw) => setBatch((b) => ({ ...b, items: b.items.filter((x) => x.raw !== raw) })), []);
  const clear = useCallback(() => setBatch({ boxId: null, items: [] }), []);
  const markErrors = useCallback((results = []) => {
    const byRaw = new Map(results.map((r) => [r.raw, r]));
    setBatch((b) => ({ ...b, items: b.items.map((x) => ({ ...x, error: byRaw.get(x.raw)?.error || null })) }));
  }, []);
  return { boxId: batch.boxId, items: batch.items, add, remove, clear, markErrors };
}

// Decides whether a checked roll can join the list. Returns an error text or null.
// takesSpace: false when the roll is already counted in this container (reserved there).
export function batchProblem({ items, roll, box, takesSpace = true }) {
  if (items.length >= MAX_BATCH) return `La lista ya tiene ${MAX_BATCH} rollos. Guárdelos antes de escanear más.`;
  if (items.some((x) => (roll.id && String(x.roll?.id) === String(roll.id)) || x.roll?.roll_no === roll.roll_no)) {
    return `${roll.roll_no} ya está en la lista.`;
  }
  if (box?.capacity != null) {
    const used = Number(box.stored || 0) + Number(box.reserved || 0);
    const adding = items.filter((x) => x.takesSpace !== false).length + (takesSpace ? 1 : 0);
    if (used + adding > Number(box.capacity)) return `${box.code} solo tiene espacio para ${Math.max(0, box.capacity - used)} rollo(s) más.`;
  }
  return null;
}

export function BatchCard({ items, boxCode, verb = "Guardar", busy, onSave, onRemove, onClear, openRoll }) {
  const yards = items.reduce((s, x) => s + (Number(x.roll?.yards) || 0), 0);
  const errors = items.filter((x) => x.error).length;
  return (
    <Card className={cx("overflow-hidden", items.length > 0 && "ring-2 ring-indigo-300")}>
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">Escaneados para {verb.toLowerCase()} en {boxCode}</div>
          <div className="text-xs text-slate-500 fab-tnum">
            {items.length} de {MAX_BATCH} · {num(yards, 1)} yd{errors ? <span className="text-red-600 font-medium"> · {errors} con problema</span> : ""}
          </div>
        </div>
        <div className="w-24"><ProgressBar value={items.length} max={MAX_BATCH} tone={items.length >= MAX_BATCH ? "amber" : "indigo"} className="h-2" /></div>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-400 text-center">Escanee de 1 a {MAX_BATCH} rollos; aparecerán aquí y se guardan juntos.</div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
          {items.map((x, i) => (
            <li key={x.raw} className={cx("px-4 sm:px-5 py-2.5 flex items-center gap-3", x.error && "bg-red-50")}>
              <span className="w-6 text-xs text-slate-400 fab-tnum text-right">{items.length - i}</span>
              <button onClick={() => openRoll?.(x.roll)} className="min-w-0 flex-1 text-left">
                <div className="font-mono text-sm font-semibold text-slate-900 truncate">{x.roll?.roll_no || x.raw}</div>
                <div className={cx("text-xs truncate", x.error ? "text-red-600 font-medium" : "text-slate-500")}>
                  {x.error || [x.roll?.fabric_name, x.roll?.color, x.roll?.po_number && `PO ${x.roll.po_number}`].filter(Boolean).join(" · ") || "Datos de Skytex pendientes"}
                </div>
              </button>
              {x.note && !x.error && <Pill tone="amber">{x.note}</Pill>}
              <span className="text-sm text-slate-600 fab-tnum w-14 text-right">{num(x.roll?.yards, 1)}</span>
              <button onClick={() => onRemove(x.raw)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={`Quitar ${x.roll?.roll_no || x.raw} de la lista`}>
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-t border-slate-100 flex flex-wrap items-center gap-2 bg-slate-50/60">
          <Button size="lg" icon={CheckCircle2} loading={busy} onClick={onSave} className="flex-1 sm:flex-none">
            {verb} {items.length} rollo(s) en {boxCode}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClear}>Vaciar lista</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// «Probar escáner»: shows exactly what the PDA sends (characters, the key that
// ends the scan, speed) and what the system understands it is. Saves nothing.
// ---------------------------------------------------------------------------
const SHOW_CTRL = { "\t": "⇥", "\r": "␍", "\n": "␤", "\u001d": "␝", "\u001e": "␞", "\u0004": "␄" };
const showRaw = (s) => Array.from(s).map((ch) => SHOW_CTRL[ch] || (ch.charCodeAt(0) < 32 ? `[${ch.charCodeAt(0)}]` : ch)).join("");

export function ScanTester({ open, onClose, expect }) {
  const [shown, setShown] = useState("");
  const [result, setResult] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef(null);
  const timer = useRef(0);
  const chunks = useRef([]);     // { text, t, via: "tecla" | "de una vez" }

  useEffect(() => {
    if (!open) return undefined;
    chunks.current = []; setShown(""); setResult(null); setElapsed(0);
    setTimeout(() => ref.current?.focus(), 50);
    const t0 = Date.now();
    const h = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(h);
  }, [open]);

  const finish = async (endKey) => {
    clearTimeout(timer.current);
    const cs = chunks.current;
    if (!cs.length) return;
    chunks.current = [];
    const raw = cs.map((c) => c.text).join("");
    const keys = cs.filter((c) => c.via === "tecla");
    const gaps = keys.slice(1).map((k, i) => k.t - keys[i].t);
    const avg = gaps.length ? Math.round(gaps.reduce((x, y) => x + y, 0) / gaps.length) : null;
    const how = cs.some((c) => c.via === "de una vez") ? "insert" : "keys";
    setShown("");
    setWaiting(true);
    let srv = null;
    try { srv = await post("/scan-test", { raw, expect }); } catch (e) { srv = { error: e.message }; }
    setWaiting(false);
    setResult({ raw, endKey, avg, n: raw.length, how, srv });
  };
  const later = () => { clearTimeout(timer.current); timer.current = setTimeout(() => finish(null), 400); };

  // Key by key (keyboard mode)
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); return finish(e.key); }
    if (e.key.length !== 1) return;    // Android IME sends "Unidentified": handled in onChange
    e.preventDefault();
    chunks.current.push({ text: e.key, t: Date.now(), via: "tecla" });
    setShown(chunks.current.map((c) => c.text).join(""));
    later();
  };
  // Inserted text (fill / direct-input mode, or keys delivered through the on-screen keyboard)
  const onChange = (e) => {
    const v = e.target.value;
    const before = chunks.current.map((c) => c.text).join("");
    if (v.length > before.length && v.startsWith(before)) {
      const add = v.slice(before.length);
      chunks.current.push({ text: add, t: Date.now(), via: add.length > 1 ? "de una vez" : "tecla" });
    } else if (v !== before) {
      chunks.current = [{ text: v, t: Date.now(), via: "de una vez" }];
    }
    setShown(v);
    later();
  };

  const srv = result?.srv;
  const meaning = !srv ? null
    : srv.error ? { tone: "err", text: srv.error }
    : srv.kind === "location" ? { tone: "ok", text: `Lugar ${srv.location.code}${srv.location.box_code ? ` (contenedor registrado: ${srv.location.box_code})` : " (sin contenedor registrado)"}` }
    : srv.kind === "box" ? { tone: "ok", text: `Contenedor ${srv.box.code}${srv.box.location_code ? ` en ${srv.box.location_code}` : " (sin lugar registrado)"}` }
    : srv.kind === "invalid_box" ? { tone: "err", text: srv.invalid }
    : srv.kind === "roll" ? { tone: srv.roll.found ? "ok" : "warn", text: `Rollo ${srv.roll.roll_no}${srv.roll.found ? ` (${srv.roll.status})` : " — no está en ninguna solicitud a Skytex"}` }
    : { tone: "err", text: `No se reconoce «${srv.cleaned}» como lugar, contenedor ni rollo.` };

  return (
    <Modal open={open} onClose={onClose} title="Probar escáner" size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">Escanee aquí una etiqueta (lugar, contenedor o rollo). Se muestra exactamente lo que envía la PDA. No se guarda nada.</div>
        <input
          ref={ref}
          onKeyDown={onKeyDown}
          value={shown}
          onChange={onChange}
          inputMode="none"
          className={cx(inputCls, "w-full font-mono text-lg")}
          placeholder="Esperando el escaneo…"
          aria-label="Prueba de escaneo"
        />

        {!result && !shown && elapsed >= 6 && (
          <Banner kind="warn">
            <div className="font-semibold">No llega nada de la PDA.</div>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              <li>En la app de ajustes del escáner, el modo de salida debe ser <b>teclado</b> o <b>rellenar / introducir en el campo</b> (Keyboard, Keystroke, Fill, Direct input, 键盘输出 / 直接填充), no «Broadcast / Intent / API / 广播».</li>
              <li>Si los rollos sí se leen pero el QR no: el lector puede ser <b>solo 1D (láser)</b> o tener el <b>QR desactivado</b>. Active «QR Code» en la configuración del escáner (Symbologies / Códigos).</li>
              <li>Toque esta caja antes de escanear para que tenga el foco.</li>
            </ul>
          </Banner>
        )}

        {waiting && <div className="text-sm text-slate-500">Revisando…</div>}

        {result && (
          <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100 text-sm">
            <div className="px-4 py-2.5 flex gap-3"><span className="w-36 text-slate-500 flex-shrink-0">Lo que llegó</span><span className="font-mono break-all text-slate-900">{showRaw(result.raw) || "(vacío)"}</span></div>
            <div className="px-4 py-2.5 flex gap-3"><span className="w-36 text-slate-500 flex-shrink-0">Caracteres</span><span>{result.n}</span></div>
            <div className="px-4 py-2.5 flex gap-3">
              <span className="w-36 text-slate-500 flex-shrink-0">Cómo llega</span>
              <span>{result.how === "insert" ? "Todo de una vez (modo «rellenar») ✓" : "Tecla por tecla (modo teclado) ✓"}</span>
            </div>
            <div className="px-4 py-2.5 flex gap-3">
              <span className="w-36 text-slate-500 flex-shrink-0">Termina con</span>
              <span>{result.endKey === "Enter" ? "Enter ✓" : result.endKey === "Tab" ? "Tab ✓ (también funciona)" : "Nada — funciona igual, la pantalla lo detecta por la pausa"}</span>
            </div>
            <div className="px-4 py-2.5 flex gap-3">
              <span className="w-36 text-slate-500 flex-shrink-0">Velocidad</span>
              <span>{result.how === "insert" ? "Instantáneo" : result.avg == null ? "—" : `${result.avg} ms entre caracteres ${result.avg <= 45 ? "(escáner)" : "(parece escrito a mano)"}`}</span>
            </div>
            {srv?.cleaned && srv.cleaned !== result.raw && (
              <div className="px-4 py-2.5 flex gap-3"><span className="w-36 text-slate-500 flex-shrink-0">Limpio</span><span className="font-mono">{srv.cleaned}</span></div>
            )}
            <div className={cx("px-4 py-3 flex gap-3 font-medium",
              meaning?.tone === "ok" ? "bg-emerald-50 text-emerald-800" : meaning?.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>
              <span className="w-36 flex-shrink-0 font-normal opacity-80">El sistema entiende</span>
              <span>{meaning?.text}</span>
            </div>
          </div>
        )}
        {result && <div className="text-xs text-slate-500">Escanee otra etiqueta para probarla.</div>}
      </div>
    </Modal>
  );
}