// ITControlPanel.jsx — Panel de TI (mismo estilo que FabricDashboard / NavDashboard).
//   • Resumen: indicadores del periodo, «Pendientes», quién está en línea, actividad por día
//   • Actividad por rol, Usuarios (reporte por persona + editar), Bitácora (filtros + CSV)
//   • Nuevo usuario: usuario, nombre, rol, línea y contraseña
//
// Uso (misma forma que las demás pantallas):
//   <ITControlPanel user={user} onLogout={handleLogout} />
// Opcional: apiBase="http://10.1.10.42:5000" si no usa el proxy /api de Vite,
//           getToken={() => localStorage.getItem("token")} si guarda el token con otro nombre.
//
// Registro de pantallas (opcional): trackPageView("Plan board") al abrir cada pantalla.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw, UserPlus, Users, ShieldAlert, LogIn, Pencil, Ban, UserCheck, Wifi, CheckCircle2,
  ChevronRight, Download, Search, X, KeyRound, UserX, LayoutDashboard, BarChart3, ScrollText,
  AlertTriangle, Clock, Inbox, Lock,
} from "lucide-react";
import NavIT from "./NavIT";

const TZ = "America/Mexico_City";

export async function trackPageView(page, { apiBase = "", token = localStorage.getItem("token") } = {}) {
  try {
    await fetch(`${apiBase}/api/activity/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "page_view", page }),
    });
  } catch (_) { /* nunca bloquear la pantalla por un registro */ }
}

// ---------------------------------------------------------------------------
// textos y formato
// ---------------------------------------------------------------------------
const ROLE_ES = {
  admin: "Administrador", master: "Máster (CEO)", factory_director: "Director de planta", ceo: "CEO",
  soporte_it: "Soporte TI", engineer: "Ingeniería", supervisor: "Supervisor", planner: "Planeación",
  line_leader: "Líder de línea", verificador: "Verificador", quality_head: "Jefe de calidad",
  quality_inspector: "Inspector de calidad", inspector: "Inspector", corte: "Corte",
  fabric_warehouse: "Almacén de tela", finished_warehouse: "Almacén de terminado",
  merchant: "Merchant", supermarcado: "Supermercado", skyrina: "Skyrina",
};
const ACTION_ES = {
  login: "Inició sesión", login_failed: "Intento fallido", logout: "Cerró sesión",
  create: "Creó", update: "Actualizó", delete: "Eliminó", view: "Consultó", page_view: "Abrió pantalla",
  user_created: "Creó usuario", user_updated: "Editó usuario", password_reset: "Restableció contraseña",
  user_activated: "Activó usuario", user_deactivated: "Desactivó usuario", role_changed: "Cambió rol",
  logs_purged: "Borró bitácora antigua", user_unlocked: "Desbloqueó usuario",
};
const FIELD_ES = { full_name: "nombre", role: "rol", line_number: "línea", is_active: "activo" };
const actionLabel = (a) => ACTION_ES[a] || a;

const cx = (...c) => c.filter(Boolean).join(" ");
const num = (n) => Number(n || 0).toLocaleString("es-MX");
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const shiftDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-MX", { timeZone: "UTC", weekday: "short", day: "numeric" });
const daysSince = (v) => (v ? (Date.now() - new Date(v).getTime()) / 86400000 : Infinity);
const ago = (v) => {
  if (!v) return "Nunca";
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return "Ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.floor(s / 86400)} d`;
  return fmtDateTime(v);
};
function greeting() {
  const h = Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

function describeLog(l) {
  const d = l.details || {};
  if (d.target_username) {
    if (l.action === "user_created") return `${d.target_username} como ${ROLE_ES[d.role] || d.role}${d.line_number ? `, línea ${d.line_number}` : ""}`;
    const parts = Object.entries(d.changes || {}).map(([k, v]) =>
      k === "password" ? "contraseña" : k === "lock" ? "desbloqueada" : `${FIELD_ES[k] || k}: ${v.from ?? "—"} → ${v.to ?? "—"}`);
    return `${d.target_username}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
  }
  if (l.action === "page_view") return d.page || "";
  if (l.action === "login_failed") {
    if (d.reason === "account_locked") return "Cuenta bloqueada: acceso rechazado";
    if (d.reason === "locked_now") return `Contraseña incorrecta · cuenta bloqueada (${d.attempts} intentos)`;
    if (d.reason === "invalid_password") return `Contraseña incorrecta (intento ${d.attempts})`;
    return l.user_id ? "Contraseña incorrecta" : "Usuario no existe";
  }
  return l.path || "";
}

// ---------------------------------------------------------------------------
// piezas de UI (mismo lenguaje visual que fabricShared)
// ---------------------------------------------------------------------------
const Card = ({ className, children }) => (
  <div className={cx("bg-white rounded-2xl ring-1 ring-slate-200", className)}>{children}</div>
);
const CardHeader = ({ title, subtitle, actions }) => (
  <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
    {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
  </div>
);
const BTN = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700",
  secondary: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
  ghost: "text-indigo-600 hover:bg-indigo-50",
  danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
};
function Button({ variant = "primary", size = "md", icon: Icon, loading, className, children, ...rest }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        BTN[variant], className,
      )}
    >
      {Icon && <Icon className={cx("w-4 h-4", loading && "animate-spin")} />}
      {children}
    </button>
  );
}
const inputCls = "rounded-lg border-0 ring-1 ring-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const Banner = ({ children }) => (
  <div className="rounded-xl bg-red-50 ring-1 ring-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{children}</span>
  </div>
);
const EmptyState = ({ icon: Icon = Inbox, title, text }) => (
  <div className="px-5 py-10 text-center">
    <Icon className="w-8 h-8 text-slate-300 mx-auto" />
    <div className="mt-2 text-sm font-medium text-slate-700">{title}</div>
    {text && <div className="text-xs text-slate-500 mt-1">{text}</div>}
  </div>
);
const RoleTag = ({ role, labels }) => (
  <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-medium whitespace-nowrap">
    {labels[role] || role || "—"}
  </span>
);
const OnlineDot = ({ on }) => (
  <span className={cx("inline-block w-2 h-2 rounded-full shrink-0", on ? "bg-emerald-500" : "bg-slate-300")} />
);
const TONE = {
  sky: "bg-sky-100 text-sky-700", indigo: "bg-indigo-100 text-indigo-700", emerald: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700", amber: "bg-amber-100 text-amber-700", slate: "bg-slate-100 text-slate-700",
  violet: "bg-violet-100 text-violet-700",
};

function DayBars({ days }) {
  if (!days?.some((d) => d.changes || d.logins)) {
    return <div className="py-8 text-sm text-slate-400 text-center">Sin inicios de sesión ni cambios en este periodo.</div>;
  }
  const max = Math.max(1, ...days.map((d) => d.changes + d.logins));
  const step = days.length > 16 ? Math.ceil(days.length / 10) : 1;
  return (
    <div>
      <div className="h-40 flex items-end gap-1" role="img" aria-label="Inicios de sesión y cambios por día">
        {days.map((d, i) => (
          <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col items-center gap-1" title={`${d.day}: ${d.logins} inicios, ${d.changes} cambios`}>
            <div className="flex-1 w-full max-w-[36px] flex flex-col-reverse gap-px">
              <div className="w-full rounded-sm bg-indigo-200" style={{ height: `${(d.logins / max) * 100}%` }} />
              <div className="w-full rounded-sm bg-indigo-600" style={{ height: `${(d.changes / max) * 100}%` }} />
            </div>
            <span className="text-[11px] text-slate-500 whitespace-nowrap capitalize">{i % step === 0 ? fmtDay(d.day) : "\u00A0"}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-slate-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-indigo-600 mr-1" />Cambios</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-indigo-200 mr-1" />Inicios de sesión</span>
      </div>
    </div>
  );
}

function BarList({ rows, labelKey, valueKey, empty = "Sin cambios en este periodo." }) {
  if (!rows?.length) return <div className="py-6 text-sm text-slate-400 text-center">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r[labelKey]} className="grid grid-cols-[minmax(90px,150px)_1fr_3rem] items-center gap-3 text-sm">
          <span className="text-slate-700 truncate" title={r[labelKey]}>{r[labelKey]}</span>
          <span className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(r[valueKey] / max) * 100}%` }} />
          </span>
          <span className="text-right text-slate-800 font-medium tabular-nums">{num(r[valueKey])}</span>
        </li>
      ))}
    </ul>
  );
}

function Drawer({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="absolute right-0 top-0 h-full w-full max-w-xl bg-slate-50 shadow-2xl overflow-y-auto">
        {children}
      </aside>
    </div>
  );
}
const DrawerHeader = ({ title, subtitle, onClose }) => (
  <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-lg font-semibold text-slate-900 truncate">{title}</h2>
      {subtitle && <div className="text-sm text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">{subtitle}</div>}
    </div>
    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X className="w-5 h-5" /></button>
  </div>
);

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------
function Overview({ data, users, labels, goLogs, goUsers }) {
  const k = data.kpis;
  const neverUsed = users.filter((u) => u.is_active && !u.last_login_at);
  const idle = users.filter((u) => u.is_active && u.last_login_at && daysSince(u.last_seen_at || u.last_login_at) > 30);

  const stats = [
    { label: "Personas activas", value: k.active_users, hint: "Usaron el sistema en el periodo", icon: Users, tone: "sky", onClick: () => goUsers({}) },
    { label: "Inicios de sesión", value: k.logins, hint: "Accesos correctos", icon: LogIn, tone: "indigo", onClick: () => goLogs({ action: "login" }) },
    { label: "Cambios guardados", value: k.changes, hint: "Altas, ediciones y bajas", icon: Pencil, tone: "emerald", onClick: () => goLogs({ action: "change" }) },
    { label: "Intentos fallidos", value: k.failed_logins, hint: "Contraseña o usuario incorrecto", icon: ShieldAlert, tone: "red", onClick: () => goLogs({ action: "login_failed" }) },
    { label: "Rechazadas", value: k.errors, hint: "Solicitudes con error o sin permiso", icon: Ban, tone: "amber", onClick: () => goLogs({ action: "error" }) },
    { label: "Cuentas activas", value: k.users_active, hint: `de ${num(k.users_total)} cuentas`, icon: UserCheck, tone: "slate", onClick: () => goUsers({ status: "active" }) },
  ];

  const lockedUsers = users.filter((u) => u.is_active && u.locked);
  const todos = [
    lockedUsers.length > 0 && { icon: Lock, tone: "red", text: `${lockedUsers.length} cuenta(s) bloqueadas por contraseña incorrecta`, action: "Desbloquear", onClick: () => goUsers({ status: "locked" }) },
    k.failed_logins > 0 && { icon: ShieldAlert, tone: "red", text: `${num(k.failed_logins)} intento(s) de inicio de sesión fallidos`, action: "Revisar", onClick: () => goLogs({ action: "login_failed" }) },
    k.errors > 0 && { icon: Ban, tone: "amber", text: `${num(k.errors)} solicitud(es) rechazadas por error o falta de permiso`, action: "Ver detalle", onClick: () => goLogs({ action: "error" }) },
    neverUsed.length > 0 && { icon: UserX, tone: "violet", text: `${neverUsed.length} cuenta(s) activas que nunca han iniciado sesión`, action: "Ver cuentas", onClick: () => goUsers({ status: "never" }) },
    idle.length > 0 && { icon: Clock, tone: "amber", text: `${idle.length} cuenta(s) activas sin uso en más de 30 días`, action: "Revisar si se desactivan", onClick: () => goUsers({ status: "idle" }) },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <button key={s.label} onClick={s.onClick}
            className="text-left bg-white rounded-2xl ring-1 ring-slate-200 p-4 transition hover:shadow-sm hover:ring-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <div className="flex items-center gap-2">
              <span className={cx("w-8 h-8 rounded-lg flex items-center justify-center", TONE[s.tone])}><s.icon className="w-4 h-4" /></span>
              <span className="text-sm font-medium text-slate-700 leading-tight">{s.label}</span>
            </div>
            <div className={cx("mt-3 text-3xl font-semibold tabular-nums", s.tone === "red" && s.value ? "text-red-600" : "text-slate-900")}>{num(s.value)}</div>
            <div className="text-xs text-slate-500">{s.hint}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 xl:grid-cols-12 gap-6 items-start">
        <Card className="xl:col-span-4 overflow-hidden">
          <CardHeader title="Pendientes" subtitle={todos.length ? `${todos.length} por atender` : "Lo que necesita atención ahora"} />
          {todos.length === 0 ? (
            <div className="px-5 py-6 flex items-center gap-2 text-sm text-slate-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> Todo en orden.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todos.map((t) => (
                <li key={t.text}>
                  <button onClick={t.onClick}
                    className={cx("w-full px-4 py-2.5 flex items-center gap-2.5 text-left transition hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50",
                      t.tone === "red" && "bg-red-50/50 hover:bg-red-50")}>
                    <span className={cx("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", TONE[t.tone])}><t.icon className="w-3.5 h-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-slate-700">{t.text}</span>
                      <span className={cx("text-xs font-medium", t.tone === "red" ? "text-red-600" : "text-indigo-600")}>{t.action}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader title="Actividad por día" subtitle="Inicios de sesión y cambios guardados" />
          <div className="p-5"><DayBars days={data.byDay} /></div>
        </Card>

        <Card className="xl:col-span-3 overflow-hidden">
          <CardHeader title="En línea ahora" subtitle={`${num(k.online_now)} persona(s) en los últimos 15 min`} />
          {data.online.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-400 text-center">Nadie conectado en este momento.</div>
          ) : (
            <ul className="max-h-[300px] overflow-y-auto divide-y divide-slate-100">
              {data.online.map((u) => (
                <li key={u.id} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <OnlineDot on />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 truncate">{u.full_name || u.username}</span>
                    <span className="block text-xs text-slate-500 truncate">{labels[u.role] || u.role}{u.line_number ? ` · Línea ${u.line_number}` : ""}</span>
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">{ago(u.last_seen_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card>
          <CardHeader title="Módulos con más cambios" actions={<Button size="sm" variant="ghost" onClick={() => goLogs({ action: "change" })}>Ver bitácora</Button>} />
          <div className="p-5"><BarList rows={data.byModule} labelKey="module" valueKey="changes" /></div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Intentos fallidos recientes" actions={<Button size="sm" variant="ghost" onClick={() => goLogs({ action: "login_failed" })}>Ver todos</Button>} />
          {data.failedLogins.length === 0 ? (
            <div className="px-5 py-6 flex items-center gap-2 text-sm text-slate-500"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Sin intentos fallidos en este periodo.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.failedLogins.map((f, i) => (
                <li key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0"><ShieldAlert className="w-3.5 h-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 truncate">{f.username || "—"}</span>
                    <span className={cx("block text-xs", f.unknown_user ? "text-red-600 font-medium" : "text-slate-500")}>
                      {f.unknown_user ? "Usuario no existe" : "Contraseña incorrecta"} · {f.ip || "IP desconocida"}
                    </span>
                  </span>
                  <span className="text-xs text-slate-400 shrink-0 tabular-nums">{fmtDateTime(f.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actividad por rol
// ---------------------------------------------------------------------------
function RolesReport({ data, labels, onPickRole }) {
  const max = Math.max(1, ...data.roles.map((r) => r.changes));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Actividad por rol" subtitle="Haga clic en un rol para ver su bitácora" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["Rol", "Cuentas", "En línea", "Activos en periodo", "Inicios", "Cambios", "Fallidos", "Rechazadas", "Más usado", "Última actividad"].map((h, i) => (
                <th key={h} className={cx("px-4 py-2.5 font-medium whitespace-nowrap", i > 0 && i < 8 && i !== 5 ? "text-right" : "text-left", i === 5 && "min-w-[160px]")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.roles.map((r) => (
              <tr key={r.role} onClick={() => onPickRole(r.role)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-3"><RoleTag role={r.role} labels={labels} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{r.users_active}<span className="text-slate-400"> / {r.users_total}</span></td>
                <td className="px-4 py-3 text-right tabular-nums">{r.online_now || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.active_in_period}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(r.logins)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${(r.changes / max) * 100}%` }} /></span>
                    <span className="w-10 text-right font-medium tabular-nums">{num(r.changes)}</span>
                  </div>
                </td>
                <td className={cx("px-4 py-3 text-right tabular-nums", r.failed_logins && "text-red-600 font-semibold")}>{num(r.failed_logins)}</td>
                <td className={cx("px-4 py-3 text-right tabular-nums", r.errors && "text-amber-700 font-semibold")}>{num(r.errors)}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{r.top_modules.map((m) => m.module).join(", ") || "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{ago(r.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.roles.length && <EmptyState title="Sin datos" text="Aún no hay usuarios ni actividad." />}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------
const STATUS_OPTS = [
  ["active", "Cuentas activas"], ["online", "En línea ahora"], ["never", "Nunca han iniciado sesión"],
  ["idle", "Sin uso en 30+ días"], ["locked", "Bloqueadas"], ["inactive", "Desactivadas"], ["", "Todas las cuentas"],
];

function UsersTab({ users, roles, labels, filter, setFilter, onOpen, onNew }) {
  const { q = "", role = "", status = "active" } = filter;
  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value });
  const shown = users.filter((u) => {
    if (role && u.role !== role) return false;
    if (status === "active" && !u.is_active) return false;
    if (status === "inactive" && u.is_active) return false;
    if (status === "online" && !u.online) return false;
    if (status === "locked" && !u.locked) return false;
    if (status === "never" && !(u.is_active && !u.last_login_at)) return false;
    if (status === "idle" && !(u.is_active && u.last_login_at && daysSince(u.last_seen_at || u.last_login_at) > 30)) return false;
    const t = q.trim().toLowerCase();
    return !t || `${u.username} ${u.full_name || ""}`.toLowerCase().includes(t);
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Usuarios" subtitle={`${num(shown.length)} de ${num(users.length)} cuentas · haga clic para ver su reporte`}
        actions={<Button size="sm" icon={UserPlus} onClick={onNew}>Nuevo usuario</Button>} />
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={cx(inputCls, "w-full pl-9")} placeholder="Nombre o usuario…" value={q} onChange={set("q")} />
        </div>
        <select className={inputCls} value={role} onChange={set("role")} aria-label="Rol">
          <option value="">Todos los roles</option>
          {roles.map((r) => <option key={r.value} value={r.value}>{labels[r.value] || r.label}</option>)}
        </select>
        <select className={inputCls} value={status} onChange={set("status")} aria-label="Estado">
          {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Nombre</th>
              <th className="px-4 py-2.5 text-left font-medium">Usuario</th>
              <th className="px-4 py-2.5 text-left font-medium">Rol</th>
              <th className="px-4 py-2.5 text-right font-medium">Línea</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Último acceso</th>
              <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Última actividad</th>
              <th className="px-4 py-2.5 text-right font-medium">Inicios</th>
              <th className="px-4 py-2.5 text-right font-medium">Cambios</th>
              <th className="px-4 py-2.5 text-right font-medium">Fallidos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((u) => (
              <tr key={u.id} onClick={() => onOpen(u.id)} className={cx("cursor-pointer hover:bg-slate-50", !u.is_active && "text-slate-400")}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <OnlineDot on={u.online} />
                    <span className={cx("font-medium", u.is_active ? "text-slate-900" : "text-slate-400 line-through")}>{u.full_name || u.username}</span>
                    {u.locked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 px-2 py-0.5 text-[11px] font-medium">
                        <Lock className="w-3 h-3" /> Bloqueada
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-2.5"><RoleTag role={u.role} labels={labels} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{u.line_number || "—"}</td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap">{fmtDateTime(u.last_login_at)}</td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap">{ago(u.last_seen_at)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(u.logins)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{num(u.changes)}</td>
                <td className={cx("px-4 py-2.5 text-right tabular-nums", u.failed_logins && "text-red-600 font-semibold")}>{num(u.failed_logins)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <EmptyState icon={Users} title="Ningún usuario coincide" text="Cambie los filtros o la búsqueda." />}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------
const ACTION_FILTERS = [
  ["", "Todas las acciones"], ["change", "Solo cambios"], ["error", "Rechazadas"], ["login", "Inicios de sesión"],
  ["login_failed", "Intentos fallidos"], ["logout", "Cierres de sesión"], ["page_view", "Pantallas abiertas"],
  ["user_created", "Usuarios creados"], ["password_reset", "Contraseñas restablecidas"], ["role_changed", "Cambios de rol"],
  ["user_deactivated", "Desactivaciones"], ["user_unlocked", "Desbloqueos"],
];

function LogsTab({ api, range, roles, labels, users, filter, setFilter, toast }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const limit = 50;

  const qs = useMemo(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    Object.entries(filter).forEach(([k, v]) => v && p.set(k, v));
    return p.toString();
  }, [range, filter]);

  useEffect(() => setPage(0), [qs]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const p = new URLSearchParams(qs);
    p.set("limit", limit); p.set("offset", page * limit);
    api(`http://localhost:5000/api/it/logs?${p}`)
      .then((d) => { if (live) { setData(d); setErr(""); } })
      .catch((e) => live && setErr(e.message))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [api, qs, page]);

  const exportCsv = async () => {
    try {
      const res = await api(`http://localhost:5000/api/it/logs.csv?${qs}`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `bitacora_${range.from}_${range.to}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("CSV descargado");
    } catch (e) { setErr(e.message); }
  };

  const set = (k) => (e) => setFilter({ ...filter, [k]: e.target.value });
  const total = data?.total || 0;
  const logs = data?.logs || [];

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Bitácora de actividad" subtitle={`${num(total)} registro(s) en el periodo`}
        actions={<Button size="sm" variant="secondary" icon={Download} onClick={exportCsv} disabled={!total}>Exportar CSV</Button>} />
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={cx(inputCls, "w-full pl-9")} placeholder="Usuario, ruta o IP…" value={filter.q || ""} onChange={set("q")} />
        </div>
        <select className={inputCls} value={filter.role || ""} onChange={set("role")} aria-label="Rol">
          <option value="">Todos los roles</option>
          {roles.map((r) => <option key={r.value} value={r.value}>{labels[r.value] || r.label}</option>)}
        </select>
        <select className={cx(inputCls, "max-w-[200px]")} value={filter.user_id || ""} onChange={set("user_id")} aria-label="Usuario">
          <option value="">Todos los usuarios</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
        </select>
        <select className={inputCls} value={filter.action || ""} onChange={set("action")} aria-label="Acción">
          {ACTION_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className={inputCls} value={filter.module || ""} onChange={set("module")} aria-label="Módulo">
          <option value="">Todos los módulos</option>
          {(data?.modules || []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {Object.values(filter).some(Boolean) && <Button size="sm" variant="ghost" icon={X} onClick={() => setFilter({})}>Quitar filtros</Button>}
      </div>
      {err && <div className="p-4"><Banner>{err}</Banner></div>}
      <div className={cx("overflow-x-auto transition-opacity", busy && "opacity-60")}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["Fecha", "Usuario", "Rol", "Acción", "Módulo", "Detalle", "Resultado", "IP"].map((h) => (
                <th key={h} className={cx("px-4 py-2.5 font-medium whitespace-nowrap", h === "Resultado" ? "text-right" : "text-left")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => {
              const bad = l.status_code >= 400;
              return (
                <tr key={l.id} className={cx(l.action === "login_failed" && "bg-red-50/50")}>
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap tabular-nums">{fmtDateTime(l.created_at)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{l.username || "—"}</td>
                  <td className="px-4 py-2.5">{l.role ? <RoleTag role={l.role} labels={labels} /> : "—"}</td>
                  <td className={cx("px-4 py-2.5 whitespace-nowrap", bad ? "text-red-600 font-medium" : "text-slate-700")}>{actionLabel(l.action)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{l.module || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[340px] break-words" title={l.details ? JSON.stringify(l.details) : ""}>{describeLog(l)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={cx("inline-flex px-2 py-0.5 rounded-md text-xs font-medium tabular-nums", bad ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                      {l.status_code ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{l.ip || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !logs.length && <EmptyState icon={ScrollText} title="Sin registros" text="Nada coincide con los filtros. Pruebe con un periodo más amplio." />}
      </div>
      <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-slate-500 tabular-nums">
          {total ? `${num(page * limit + 1)}–${num(Math.min(total, (page + 1) * limit))} de ${num(total)}` : ""}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Más recientes</Button>
          <Button size="sm" variant="secondary" disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>Anteriores</Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Formulario de usuario (crear y editar)
// ---------------------------------------------------------------------------
function UserForm({ roles, labels, initial, isNew, isSelf, onSubmit, busy, error }) {
  const [f, setF] = useState({
    username: initial?.username || "", full_name: initial?.full_name || "", role: initial?.role || "",
    line_number: initial?.line_number || "", password: "", confirm: "",
  });
  const [local, setLocal] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const errs = { ...local, ...(error?.field ? { [error.field]: error.message } : {}) };
  const assignable = roles.filter((r) => r.assignable || r.value === initial?.role);

  const submit = (e) => {
    e.preventDefault();
    const v = {};
    if (isNew && !/^[A-Za-z0-9._-]{3,50}$/.test(f.username)) v.username = "Use de 3 a 50 letras, números, puntos, guiones o guion bajo.";
    if (!f.role) v.role = "Elija un rol.";
    if (f.role === "line_leader" && !f.line_number) v.line_number = "Un líder de línea necesita línea.";
    if (isNew || f.password) {
      if (f.password.length < 8) v.password = "Mínimo 8 caracteres.";
      else if (f.password !== f.confirm) v.confirm = "Las contraseñas no coinciden.";
    }
    setLocal(v);
    if (Object.keys(v).length) return;
    const body = { full_name: f.full_name.trim(), role: f.role, line_number: f.line_number || null };
    if (isNew) body.username = f.username.trim();
    if (f.password) body.password = f.password;
    onSubmit(body);
  };

  // Llamada como función (no como componente) para que los inputs no pierdan el foco.
  const field = (name, label, hint, control) => (
    <div className="space-y-1">
      <label htmlFor={`it-${name}`} className="block text-sm font-medium text-slate-700">{label}</label>
      {control}
      {errs[name] ? <p className="text-xs text-red-600">{errs[name]}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
  const ring = (name) => (errs[name] ? "ring-red-400" : "");

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && !error.field && <Banner>{error.message}</Banner>}
      {isNew && field("username", "Usuario", "Lo que escribe para iniciar sesión.",
        <input id="it-username" autoComplete="off" className={cx(inputCls, "w-full", ring("username"))} value={f.username} onChange={set("username")} />)}
      {field("full_name", "Nombre completo", null,
        <input id="it-full_name" className={cx(inputCls, "w-full")} value={f.full_name} onChange={set("full_name")} />)}
      <div className="grid sm:grid-cols-2 gap-4 items-start">
        {field("role", "Rol", isSelf ? "No puede cambiar su propio rol." : null,
          <select id="it-role" className={cx(inputCls, "w-full", ring("role"))} value={f.role} onChange={set("role")} disabled={isSelf}>
            <option value="">Elija un rol</option>
            {assignable.map((r) => <option key={r.value} value={r.value}>{labels[r.value] || r.label}</option>)}
          </select>)}
        {field("line_number", "Línea", f.role === "line_leader" ? "Obligatoria para líder de línea." : "Opcional.",
          <select id="it-line_number" className={cx(inputCls, "w-full", ring("line_number"))} value={f.line_number} onChange={set("line_number")}>
            <option value="">Sin línea</option>
            {Array.from({ length: 26 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Línea {n}</option>)}
          </select>)}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 items-start">
        {field("password", isNew ? "Contraseña" : "Nueva contraseña", isNew ? "Mínimo 8 caracteres." : "Déjela vacía para no cambiarla.",
          <input id="it-password" type="password" autoComplete="new-password" className={cx(inputCls, "w-full", ring("password"))} value={f.password} onChange={set("password")} />)}
        {field("confirm", "Repetir contraseña", null,
          <input id="it-confirm" type="password" autoComplete="new-password" className={cx(inputCls, "w-full", ring("confirm"))} value={f.confirm} onChange={set("confirm")} />)}
      </div>
      <Button type="submit" loading={busy} icon={isNew ? UserPlus : CheckCircle2}>
        {busy ? "Guardando…" : isNew ? "Crear usuario" : "Guardar cambios"}
      </Button>
    </form>
  );
}

function NewUserDrawer({ api, roles, labels, onClose, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (body) => {
    setBusy(true); setError(null);
    try { const d = await api("http://localhost:5000/api/it/users", { method: "POST", body: JSON.stringify(body) }); onCreated(d.user); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer onClose={onClose}>
      <DrawerHeader title="Nuevo usuario" subtitle="La cuenta puede iniciar sesión de inmediato." onClose={onClose} />
      <div className="p-5"><Card className="p-5"><UserForm roles={roles} labels={labels} isNew onSubmit={submit} busy={busy} error={error} /></Card></div>
    </Drawer>
  );
}

function UserDrawer({ api, userId, range, roles, labels, me, onClose, onSaved, onShowLog }) {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(() => {
    api(`http://localhost:5000/api/it/users/${userId}/report?from=${range.from}&to=${range.to}`)
      .then((d) => { setRep(d); setErr(""); })
      .catch((e) => setErr(e.message));
  }, [api, userId, range]);
  useEffect(() => { load(); }, [load]);

  const save = async (body, msg = "Cambios guardados") => {
    setBusy(true); setSaveErr(null);
    try {
      await api(`http://localhost:5000/api/it/users/${userId}`, { method: "PUT", body: JSON.stringify(body) });
      setFormKey((k) => k + 1); load(); onSaved(msg);
    } catch (e) { setSaveErr(e); } finally { setBusy(false); }
  };

  const u = rep?.user;
  const isSelf = me && String(me.id) === String(userId);
  const roleInfo = u && roles.find((r) => r.value === u.role);
  const locked = roleInfo?.protected && !roleInfo?.assignable;

  return (
    <Drawer onClose={onClose}>
      <DrawerHeader
        title={u ? u.full_name || u.username : "Cargando…"}
        subtitle={u && (<>
          <span className="font-mono text-xs">{u.username}</span>
          <RoleTag role={u.role} labels={labels} />
          {u.line_number ? <span>Línea {u.line_number}</span> : null}
        </>)}
        onClose={onClose} />
      <div className="p-5 space-y-5">
        {err && <Banner>{err}</Banner>}
        {u && u.locked && (
          <div className="rounded-2xl bg-red-50 ring-1 ring-red-200 p-4 flex flex-wrap items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0"><Lock className="w-4 h-4" /></span>
            <div className="flex-1 min-w-[200px] text-sm">
              <div className="font-semibold text-red-800">Usuario bloqueado</div>
              <div className="text-red-700">
                {u.failed_login_attempts} contraseñas incorrectas seguidas · bloqueado {fmtDateTime(u.locked_at)}.
                No puede iniciar sesión hasta que se desbloquee.
              </div>
            </div>
            <Button variant="danger" icon={KeyRound} disabled={busy}
              onClick={() => save({ unlock: true }, `Usuario ${u.username} desbloqueado`)}>
              Desbloquear
            </Button>
          </div>
        )}
        {u && (<>
          <Card className="p-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">Estado</dt>
              <dd className="flex items-center gap-2">
                <OnlineDot on={u.online} />
                {!u.is_active ? <span className="text-red-600 font-medium">Desactivada</span>
                  : u.locked ? <span className="text-red-600 font-medium flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Bloqueada</span>
                  : u.online ? "En línea ahora" : "Activa"}
              </dd>
              {!u.locked && u.failed_login_attempts > 0 && (<>
                <dt className="text-slate-500">Intentos fallidos</dt>
                <dd className="text-amber-700">{u.failed_login_attempts} de {u.max_failed_logins} seguidos</dd>
              </>)}
              <dt className="text-slate-500">Último acceso</dt>
              <dd>{fmtDateTime(u.last_login_at)}{u.last_login_ip && <span className="text-slate-400"> desde {u.last_login_ip}</span>}</dd>
              <dt className="text-slate-500">Última actividad</dt><dd>{ago(u.last_seen_at)}</dd>
              <dt className="text-slate-500">Cuenta creada</dt><dd>{fmtDateTime(u.created_at)}</dd>
            </dl>
          </Card>

          <Card>
            <CardHeader title={range.from === range.to ? "Actividad de hoy" : "Actividad en el periodo"} />
            <div className="p-5 space-y-6">
              <DayBars days={rep.byDay} />
              <div>
                <h3 className="text-xs font-semibold text-slate-500 mb-3">Módulos donde hizo cambios</h3>
                <BarList rows={rep.byModule} labelKey="module" valueKey="changes" />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Últimas acciones" actions={<Button size="sm" variant="ghost" icon={ScrollText} onClick={() => onShowLog(u.id)}>Ver en bitácora</Button>} />
            {rep.recent.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-400 text-center">Sin actividad en este periodo.</div>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
                {rep.recent.slice(0, 30).map((l) => {
                  const bad = l.status_code >= 400;
                  return (
                    <li key={l.id} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                      <span className="text-xs text-slate-400 tabular-nums w-28 shrink-0 pt-0.5">{fmtDateTime(l.created_at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block", bad ? "text-red-600 font-medium" : "text-slate-800")}>
                          {bad && l.action !== "login_failed" ? `Rechazado: ${actionLabel(l.action).toLowerCase()}` : actionLabel(l.action)}
                          {l.module && l.module !== "auth" ? <span className="text-slate-400"> · {l.module}</span> : null}
                        </span>
                        <span className="block text-xs text-slate-500 break-words">{describeLog(l)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Cuenta" subtitle="Nombre, rol, línea y contraseña" />
            <div className="p-5">
              {locked ? (
                <div className="text-sm text-slate-500 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Solo una cuenta máster puede editar este usuario.</div>
              ) : (<>
                <UserForm key={formKey} roles={roles} labels={labels} initial={u} isSelf={isSelf} onSubmit={(b) => save(b)} busy={busy} error={saveErr} />
                {!isSelf && (
                  <div className="mt-5 pt-5 border-t border-dashed border-slate-200">
                    {u.is_active ? (
                      <Button variant="danger" icon={UserX} disabled={busy}
                        onClick={() => window.confirm(`¿Desactivar a ${u.username}? Su sesión se cerrará de inmediato.`) && save({ is_active: false }, "Usuario desactivado")}>
                        Desactivar usuario
                      </Button>
                    ) : (
                      <Button variant="secondary" icon={UserCheck} disabled={busy} onClick={() => save({ is_active: true }, "Usuario activado")}>Activar usuario</Button>
                    )}
                  </div>
                )}
              </>)}
            </div>
          </Card>
        </>)}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "roles", label: "Por rol", icon: BarChart3 },
  { id: "users", label: "Usuarios", icon: Users },
  { id: "logs", label: "Bitácora", icon: ScrollText },
];
const PRESETS = [["1", "Hoy"], ["7", "7 días"], ["30", "30 días"]];

export default function ITControlPanel({
  user: userProp = null,
  onLogout,
  apiBase = "",
  getToken = () => localStorage.getItem("token"),
}) {
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  const user = useMemo(() => {
    if (userProp) return userProp;
    try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
  }, [userProp]);

  const api = useCallback(async (path, opts = {}) => {
    const { raw, ...init } = opts;
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current()}`, ...(init.headers || {}) },
    });
    if (raw) {
      if (!res.ok) throw new Error(`No se pudo descargar (${res.status}).`);
      return res;
    }
    if (!(res.headers.get("content-type") || "").includes("application/json")) {
      throw new Error(`El servidor respondió ${path} con una página en lugar de datos (estado ${res.status}). ` +
        `Revise que /api llegue al backend y que esté reiniciado con it-control-panel.js.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const e = new Error(res.status === 403 && !data.field ? "Su cuenta no tiene acceso al Panel de TI." : data.error || `Error en la solicitud (${res.status}).`);
      e.field = data.field;
      throw e;
    }
    return data;
  }, [apiBase]);

  const [tab, setTab] = useState("overview");
  const [preset, setPreset] = useState("7");
  const [range, setRange] = useState(() => ({ from: shiftDays(todayStr(), -6), to: todayStr() }));
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [rolesRep, setRolesRep] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [err, setErr] = useState("");
  const [logFilter, setLogFilter] = useState({});
  const [userFilter, setUserFilter] = useState({ status: "active" });
  const [openUser, setOpenUser] = useState(null);
  const [newUser, setNewUser] = useState(false);
  const [msg, setMsg] = useState("");

  const labels = useMemo(() => {
    const m = { ...ROLE_ES };
    (roles || []).forEach((r) => { if (!m[r.value]) m[r.value] = r.label; });
    return m;
  }, [roles]);
  const toast = useCallback((m) => { setMsg(m); setTimeout(() => setMsg(""), 2600); }, []);

  const pickPreset = (p) => {
    setPreset(p);
    const t = todayStr();
    setRange({ from: p === "1" ? t : shiftDays(t, -(Number(p) - 1)), to: t });
  };

  useEffect(() => {
    api("http://localhost:5000/api/it/roles").then((d) => setRoles(Array.isArray(d.roles) ? d.roles : [])).catch((e) => setErr(e.message));
  }, [api]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const q = `from=${range.from}&to=${range.to}`;
    const jobs = [api(`http://localhost:5000/api/it/users?${q}`).then((d) => live && setUsers(Array.isArray(d.users) ? d.users : []))];
    if (tab === "overview") jobs.push(api(`http://localhost:5000/api/it/overview?${q}`).then((d) => live && setOverview(d)));
    if (tab === "roles") jobs.push(api(`http://localhost:5000/api/it/report/roles?${q}`).then((d) => live && setRolesRep(d)));
    Promise.all(jobs).then(() => live && setErr("")).catch((e) => live && setErr(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [api, tab, range, tick]);

  // Alertas de la barra: intentos fallidos de hoy (cada 2 min, como NavDashboard).
  useEffect(() => {
    const load = () => {
      const t = todayStr();
      api(`http://localhost:5000/api/it/logs?from=${t}&to=${t}&action=login_failed&limit=50`)
        .then((d) => setAlerts(Array.isArray(d.logs) ? d.logs : []))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [api, tick]);

  // «En línea ahora» se refresca cada minuto mientras el resumen está abierto.
  useEffect(() => {
    if (tab !== "overview") return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, [tab]);

  const goLogs = (f) => { setLogFilter(f); setOpenUser(null); setTab("logs"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goUsers = (f) => { setUserFilter({ status: "active", ...f }); setTab("users"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const seeTodayFailed = () => { pickPreset("1"); goLogs({ action: "login_failed" }); };

  const firstName = String(user?.full_name || user?.username || "").split(" ")[0];
  const dateRaw = new Date().toLocaleDateString("es-MX", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const dateLabel = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);
  const myRole = user?.actual_role || user?.role;

  return (
    <div className="min-h-screen bg-slate-50">
      <NavIT
        user={user}
        roleLabel={labels[myRole] || myRole}
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        alerts={alerts}
        onSeeAlerts={seeTodayFailed}
        onLogout={onLogout}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Encabezado, como PageHeader de FabricDashboard */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
            <p className="text-sm text-slate-500">{dateLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg ring-1 ring-slate-300 bg-white p-0.5" role="group" aria-label="Periodo">
              {PRESETS.map(([v, l]) => (
                <button key={v} onClick={() => pickPreset(v)} aria-pressed={preset === v}
                  className={cx("px-3 py-1.5 text-sm rounded-md transition-colors", preset === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                  {l}
                </button>
              ))}
            </div>
            <input type="date" aria-label="Desde" className={cx(inputCls, "py-1.5")} value={range.from} max={range.to}
              onChange={(e) => { if (e.target.value) { setPreset(""); setRange({ ...range, from: e.target.value }); } }} />
            <input type="date" aria-label="Hasta" className={cx(inputCls, "py-1.5")} value={range.to} min={range.from}
              onChange={(e) => { if (e.target.value) { setPreset(""); setRange({ ...range, to: e.target.value }); } }} />
            <Button variant="secondary" icon={RefreshCw} loading={loading} onClick={() => setTick((t) => t + 1)}>Actualizar</Button>
            <Button icon={UserPlus} onClick={() => setNewUser(true)}>Nuevo usuario</Button>
          </div>
        </div>

        {err && <Banner>{err}</Banner>}

        {tab === "overview" && (overview
          ? <Overview data={overview} users={users} labels={labels} goLogs={goLogs} goUsers={goUsers} />
          : <Card><EmptyState icon={Wifi} title="Cargando…" /></Card>)}
        {tab === "roles" && (rolesRep
          ? <RolesReport data={rolesRep} labels={labels} onPickRole={(role) => goLogs({ role })} />
          : <Card><EmptyState icon={BarChart3} title="Cargando…" /></Card>)}
        {tab === "users" && (
          <UsersTab users={users} roles={roles} labels={labels} filter={userFilter} setFilter={setUserFilter}
            onOpen={setOpenUser} onNew={() => setNewUser(true)} />
        )}
        {tab === "logs" && (
          <LogsTab api={api} range={range} roles={roles} labels={labels} users={users}
            filter={logFilter} setFilter={setLogFilter} toast={toast} />
        )}
      </main>

      {openUser && (
        <UserDrawer api={api} userId={openUser} range={range} roles={roles} labels={labels} me={user}
          onClose={() => setOpenUser(null)}
          onSaved={(m) => { toast(m); setTick((t) => t + 1); }}
          onShowLog={(id) => goLogs({ user_id: String(id) })} />
      )}
      {newUser && (
        <NewUserDrawer api={api} roles={roles} labels={labels} onClose={() => setNewUser(false)}
          onCreated={(u) => { setNewUser(false); toast(`Usuario ${u.username} creado`); setTick((t) => t + 1); setOpenUser(u.id); }} />
      )}
      {msg && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {msg}
        </div>
      )}
    </div>
  );
}