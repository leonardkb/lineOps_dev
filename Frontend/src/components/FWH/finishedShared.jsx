// components/warehouse/finishedShared.jsx
// Almacén de Producto Terminado — shared helpers + UI kit.
// Same visual language as the Almacén de Tela (fabricShared): slate page,
// white rounded cards, indigo primary, soft pills, big page headers.
import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { Loader2, Search, X, AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { API_URL } from "../../lib/masterCodeCatalog";

// --- API -------------------------------------------------------------------
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

// Joins API_URL + path without doubling the base.
export function apiUrl(path) {
  const base = String(API_URL || "").replace(/\/+$/, "");
  const p = String(path || "");
  if (/^https?:\/\//i.test(p)) return p;
  if (base && p.startsWith(base)) return p;
  return base + (p.startsWith("/") ? p : `/${p}`);
}

export async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), { headers: authHeaders(), ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
export const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });

// Tell the shell (badges) that data changed.
export const notifyChange = () => window.dispatchEvent(new Event("fw:changed"));

// Global search in the top bar → Inventario.
let pendingSearch = "";
export const setPendingSearch = (q) => { pendingSearch = q; window.dispatchEvent(new CustomEvent("fw:search", { detail: q })); };
export const takePendingSearch = () => { const q = pendingSearch; pendingSearch = ""; return q; };

// --- Formatting ------------------------------------------------------------
export const cx = (...a) => a.filter(Boolean).join(" ");
export const num = (v, d = 0) =>
  (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export function timeAgo(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "hace segundos";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString();
}
export function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtDate(v) {
  if (!v) return "—";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString();
}

// Size code → printable label. Keep in sync with SIZE_LABELS in the backend.
export const SIZE_LABELS = {
  "130": "xxxs", "132": "xxs", "134": "xs", "136": "(S)", "138": "(M)",
  "140": "L", "142": "XL", "144": "XXL",
  "004": "I-XS", "006": "S", "008": "M", "010": "L",
};
export function sizeText(code, label) {
  const k = String(code ?? "").trim();
  const l = String(label ?? SIZE_LABELS[k] ?? "").trim();
  if (k && l && l !== k) return `${k} · ${l}`;
  return k || l || "—";
}

// Short beep (WebAudio). ok / dup / err.
export function beep(kind = "ok") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = beep._ctx || (beep._ctx = new Ctx());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine";
    o.frequency.value = kind === "ok" ? 880 : kind === "dup" ? 520 : 300;
    g.gain.value = 0.08;
    o.start();
    o.stop(ctx.currentTime + (kind === "ok" ? 0.09 : 0.18));
  } catch { /* blocked by the browser */ }
}

// --- UI kit ----------------------------------------------------------------
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }) {
  return <div className={cx("bg-white rounded-2xl ring-1 ring-slate-200/80 shadow-sm", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, icon: Icon, actions }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
      {Icon && <Icon className="w-4 h-4 text-slate-400" />}
      <div className="min-w-0">
        <div className="font-semibold text-slate-900">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BTN = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  dark: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300",
};
const BTN_SIZE = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-4 py-3 text-base" };

export function Button({ variant = "primary", size = "md", icon: Icon, loading, className, children, disabled, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed",
        BTN[variant] || BTN.primary, BTN_SIZE[size] || BTN_SIZE.md, className)}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4 shrink-0" /> : null}
      {children}
    </button>
  );
}

const PILL = {
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export function Pill({ tone = "slate", icon: Icon, className, children }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", PILL[tone] || PILL.slate, className)}>
      {Icon && <Icon className="w-3 h-3" />}{children}
    </span>
  );
}

// Segmented tabs, like the fabric warehouse header tabs.
export function SegTabs({ value, onChange, tabs }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200">
      {tabs.map(({ key, label, icon: Icon, count }) => {
        const on = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cx("inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap",
              on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {label}
            {count != null && (
              <span className={cx("rounded-full px-1.5 text-[11px] tabular-nums", on ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600")}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const STAT = {
  indigo: "text-indigo-600 bg-indigo-50",
  emerald: "text-emerald-600 bg-emerald-50",
  amber: "text-amber-600 bg-amber-50",
  violet: "text-violet-600 bg-violet-50",
  red: "text-red-600 bg-red-50",
  slate: "text-slate-600 bg-slate-100",
};
export function Stat({ icon: Icon, label, value, hint, tone = "slate", onClick, alert = false, display }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx("h-full flex flex-col text-left bg-white rounded-2xl ring-1 shadow-sm p-4",
        alert ? "ring-red-200 bg-red-50/40" : "ring-slate-200/80",
        onClick && "hover:ring-indigo-300 transition")}
    >
      <div className="flex items-center gap-2.5 min-h-[2rem]">
        <span className={cx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", STAT[tone] || STAT.slate)}>
          {Icon && <Icon className="w-4 h-4" />}
        </span>
        <span className="text-xs font-medium text-slate-500 leading-tight">{label}</span>
      </div>
      <div className={cx("mt-auto pt-3 text-2xl font-semibold tabular-nums", alert ? "text-red-700" : "text-slate-900")}>
        {display ?? (value == null ? "—" : num(value))}
      </div>
      <div className="text-xs text-slate-400 mt-0.5 min-h-[1rem]">{hint || ""}</div>
    </Tag>
  );
}

export function SearchInput({ value, onChange, onEnter, placeholder = "Buscar…", className }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        placeholder={placeholder}
        className="w-full pl-9 pr-8 py-2 rounded-lg bg-white ring-1 ring-inset ring-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {value && (
        <button onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500" aria-label="Limpiar">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="px-6 py-14 text-center">
      {Icon && (
        <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center">
          <Icon className="w-6 h-6 text-slate-400" />
        </div>
      )}
      <div className="mt-3 font-semibold text-slate-800">{title}</div>
      {text && <div className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ text = "Cargando…" }) {
  return (
    <div className="px-6 py-14 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {text}
    </div>
  );
}

const BANNER = {
  err: ["bg-red-50 text-red-700 ring-red-200", AlertCircle],
  warn: ["bg-amber-50 text-amber-800 ring-amber-200", AlertTriangle],
  ok: ["bg-emerald-50 text-emerald-800 ring-emerald-200", CheckCircle2],
  info: ["bg-indigo-50 text-indigo-800 ring-indigo-200", Info],
};
export function Banner({ kind = "info", onClose, children }) {
  const [cls, Icon] = BANNER[kind] || BANNER.info;
  return (
    <div className={cx("rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset flex items-start gap-2", cls)}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>}
    </div>
  );
}

export function Modal({ open, onClose, title, icon: Icon, tone = "indigo", children, footer, size = "md" }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-0 sm:p-4" onClick={(e) => { e.stopPropagation(); onClose?.(); }}>
      <div className={cx("w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden", size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md")} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          {Icon && (
            <span className={cx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", STAT[tone] || STAT.indigo)}>
              <Icon className="w-5 h-5" />
            </span>
          )}
          <h3 className="text-base font-semibold text-slate-900 pt-2">{title}</h3>
        </div>
        <div className="px-5 pb-2">{children}</div>
        {footer && <div className="px-5 py-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// Pages rendered inside the shell skip their own outer padding.
export const ShellCtx = createContext(false);
export function PageFrame({ children, ...rest }) {
  const inShell = useContext(ShellCtx);
  return (
    <div className={inShell ? "space-y-6" : "px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto space-y-6"} {...rest}>
      {children}
    </div>
  );
}

// Promise-based confirm dialog: const confirm = useConfirm(); if (await confirm({...})) …
// The provider also registers itself globally, so pages rendered next to the
// nav (not inside it) still get the styled dialog.
const ConfirmCtx = createContext(null);
let globalConfirm = null;
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => { resolver.current = resolve; setState(opts || {}); }), []);
  const done = (v) => { resolver.current?.(v); resolver.current = null; setState(null); };
  useEffect(() => {
    globalConfirm = confirm;
    return () => { if (globalConfirm === confirm) globalConfirm = null; };
  }, [confirm]);
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => done(false)}
        title={state?.title || "¿Continuar?"}
        icon={state?.danger ? AlertTriangle : Info}
        tone={state?.danger ? "amber" : "indigo"}
        size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => done(false)}>{state?.cancelLabel || "Cancelar"}</Button>
          <Button variant={state?.danger ? "danger" : "primary"} onClick={() => done(true)} autoFocus>{state?.confirmLabel || "Aceptar"}</Button>
        </>}
      >
        {state?.text && <p className="text-sm text-slate-600">{state.text}</p>}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
// Falls back to window.confirm when used outside the shell.
export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  return ctx || ((o = {}) => (globalConfirm
    ? globalConfirm(o)
    : Promise.resolve(window.confirm([o.title, o.text].filter(Boolean).join("\n\n")))));
}

// Table helpers.
export const Th = ({ children, right, className }) => (
  <th className={cx("px-4 py-2.5 text-xs font-medium text-slate-500 whitespace-nowrap", right ? "text-right" : "text-left", className)}>{children}</th>
);
export const Td = ({ children, right, mono, strong, className, ...rest }) => (
  <td className={cx("px-4 py-2.5 whitespace-nowrap", right && "text-right tabular-nums", mono && "font-mono",
    strong ? "font-semibold text-slate-900" : "text-slate-700", className)} {...rest}>{children}</td>
);