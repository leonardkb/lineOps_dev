import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import MetaSummary from "../components/MetaSummary";
import NavBarline from "../components/NavBarline";
import PanelRequestsButton from "../components/lineleader/PanelRequestsButton";
import QRCode from "qrcode";
import html2canvas from "html2canvas";

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Base32 (RFC 4648, sin relleno). El contenido del QR se codifica así para que
// use SOLO letras A-Z y dígitos 2-7 — caracteres idénticos en cualquier
// distribución de teclado. De ese modo un lector configurado en otro idioma no
// puede convertir signos (" : { }) en basura al "teclear" el código.
const _B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += _B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += _B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Magnificación del QR en la etiqueta ZPL (dots por módulo en la ZD421). Más
// pequeño = QR más chico. 3 ≈ 0.55" @203dpi. Súbelo a 4 si tu lector falla.
const ZPL_QR_MAG = 3;

// Contenido del QR (para pantalla y ZPL). Formato POSICIONAL compacto separado
// por "|", luego Base32 con prefijo "FGW2". Compacto = la mitad de módulos que el
// JSON (QR mucho más chico, ideal para etiquetas ZD421). Base32 usa solo A-Z/2-7,
// a prueba de distribución de teclado. Orden FIJO (no reordenar sin cambiar el
// backend): tn, wo, talla, color, po, qty, date, runId, seq.
function ticketQrPayload(o) {
  const f = (v) => String(v ?? "").replace(/\|/g, " ").trim();
  const parts = [f(o.tn), f(o.wo), f(o.talla), f(o.color), f(o.po), f(o.qty), f(o.date), f(o.runId), f(o.seq)];
  return "FGW2" + base32Encode(parts.join("|"));
}

// ---- Ticket helpers -------------------------------------------------------
// Talla code -> human label. Seeded from the work-order size list; a `label`
// coming from the backend always wins over this map, and unknown codes just
// show the raw code. Extend this with your full size catalog as needed.
const SIZE_LABELS = {
  "130": "XXXS",
  "132": "XXS",
  "134": "XS",
  "136": "S",
  "138": "M",
  "140": "L",
  "142": "XL",
  "144": "XXL",
  "004": "I-XS",
  "008": "M",
  "010": "L",
};
// Returns the label for a talla, preferring an explicit backend label.
function labelForTalla(talla, explicit) {
  const code = String(talla == null ? "" : talla).trim();
  const lbl = (explicit && String(explicit).trim()) || SIZE_LABELS[code] || "";
  return lbl;
}
// "130 · XXXS" for display; falls back to just the code when no label is known.
function tallaWithLabel(talla, explicit) {
  const code = String(talla == null ? "" : talla).trim() || "—";
  const lbl = labelForTalla(talla, explicit);
  return lbl ? `${code} · ${lbl}` : code;
}

// Common garment size order so tickets list as XS, S, M, L, XL... instead of
// alphabetically. Unknown tallas (numeric or custom) fall back to string order.
const SIZE_ORDER = [
  "XS", "S", "SM", "M", "MD", "L", "LG", "XL", "XXL", "2XL", "XXXL", "3XL",
  "4XL", "5XL",
];
function sizeRank(t) {
  const i = SIZE_ORDER.indexOf(String(t || "").trim().toUpperCase());
  return i === -1 ? 999 : i;
}
function compareSizes(a, b) {
  const ra = sizeRank(a.talla);
  const rb = sizeRank(b.talla);
  if (ra !== rb) return ra - rb;
  const t = String(a.talla).localeCompare(String(b.talla), undefined, { numeric: true });
  if (t !== 0) return t;
  return String(a.color || "").localeCompare(String(b.color || ""));
}

function normalizeRole(role) {
  return String(role || "").toLowerCase().trim().replace(/[\s_-]/g, "");
}

// ─── Baja eficiencia: configuración del aviso de las 4:45 p.m. ────────────────
// A esta hora, si la eficiencia diaria (Diario Eficiencia) va por debajo del umbral, la página abre un
// modal para que el jefe de línea explique el motivo.
const EFF_REASON_THRESHOLD = 70; // %
const EFF_REASON_HOUR = 16;      // 16 h = 4 p.m.
const EFF_REASON_MINUTE = 45;    // :45  -> 4:45 p.m.
const EFF_REASON_SNOOZE_MS = 15 * 60 * 1000; // "Más tarde" = 15 min

// Motivos seleccionables. `code` debe coincidir con EFFICIENCY_REASON_CODES del
// backend (server1.js). El orden sigue el pedido del usuario.
const EFFICIENCY_REASONS = [
  { code: "materials_missing",   label: "Materiales faltantes" },
  { code: "trims_missing",       label: "Avíos faltantes (trims)" },
  { code: "absents",             label: "Ausencias" },
  { code: "inefficiencies",      label: "Ineficiencias" },
  { code: "machine_no_function", label: "Máquina sin funcionar" },
  { code: "change_style",        label: "Cambio de estilo" },
];

// Devuelve YYYY-MM-DD a partir de una fecha del backend (que puede llegar como
// ISO con hora) o de hoy si no hay valor.
function toYmd(dateLike) {
  const s = String(dateLike || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ¿La hora local ya alcanzó (o pasó) las 4:45 p.m.?
function isAfterEffReasonTime(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  return h > EFF_REASON_HOUR || (h === EFF_REASON_HOUR && m >= EFF_REASON_MINUTE);
}

/**
 * Modal de motivo de baja eficiencia diaria (< 70%).
 * Muestra línea, jefe de línea y fecha, y pide seleccionar uno o varios motivos.
 */
function EfficiencyReasonModal({
  visible,
  lineNo,
  jefeLinea,
  date,
  efficiency,
  selected,
  onToggle,
  note,
  onNoteChange,
  actionPlan,
  onActionPlanChange,
  onSave,
  onLater,
  saving,
  errorMsg,
}) {
  if (!visible) return null;

  // "Ineficiencias" exige escribir qué se hará mañana para mejorar.
  const inefficienciesSelected = selected.includes("inefficiencies");
  const canSave =
    selected.length > 0 &&
    (!inefficienciesSelected || String(actionPlan || "").trim().length > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 rounded-t-2xl border-b bg-red-50 p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100">
            <span className="text-xl">⚠️</span>
          </div>
          <div>
            <div className="text-base font-semibold text-red-800">
              Eficiencia por debajo del {EFF_REASON_THRESHOLD}%
            </div>
            <div className="mt-1 text-sm text-red-700">
              Eficiencia diaria:{" "}
              <span className="font-bold">
                {Number(efficiency ?? 0).toFixed(1)}%
              </span>
              . Por favor indica el motivo.
            </div>
          </div>
        </div>

        <div className="p-5">
          {/* Línea · Jefe de línea · Fecha */}
          <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl border bg-gray-50 p-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Línea</div>
              <div className="font-semibold text-gray-900">{lineNo || "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Jefe de línea</div>
              <div className="font-semibold text-gray-900">{jefeLinea || "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Fecha</div>
              <div className="font-semibold text-gray-900">{date || "—"}</div>
            </div>
          </div>

          <div className="mb-2 text-sm font-medium text-gray-700">
            Motivo(s) (puedes elegir varios):
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EFFICIENCY_REASONS.map((r, idx) => {
              const checked = selected.includes(r.code);
              return (
                <label
                  key={r.code}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${
                    checked
                      ? "border-red-400 bg-red-50 text-red-900"
                      : "border-gray-200 hover:bg-gray-50 text-gray-800"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-red-600"
                    checked={checked}
                    onChange={() => onToggle(r.code)}
                  />
                  <span>
                    <span className="mr-1 font-semibold text-gray-400">{idx + 1}.</span>
                    {r.label}
                  </span>
                </label>
              );
            })}
          </div>

          {inefficienciesSelected ? (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <label className="mb-1 block text-sm font-semibold text-amber-900">
                ¿Qué harás mañana para mejorar la eficiencia? (obligatorio)
              </label>
              <textarea
                value={actionPlan}
                onChange={(e) => onActionPlanChange(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Ej.: balancear la operación de pegado de cuello, revisar la máquina 12 antes de iniciar…"
                className="w-full rounded-xl border border-amber-300 bg-white p-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Comentario (opcional)
            </label>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={2}
              placeholder="Detalles adicionales…"
              className="w-full rounded-xl border border-gray-300 p-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          </div>

          {errorMsg ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {errorMsg}
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              onClick={onLater}
              disabled={saving}
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Más tarde
            </button>
            <button
              onClick={onSave}
              disabled={!canSave || saving}
              className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar motivo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Alarm Notification Component (without pause button)
 */
function AlarmNotification({ visible, onDismiss, onSnooze, lastSavedTime }) {
  if (!visible) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-lg max-w-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <span className="text-lg">⏰</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-red-800">¡Hora de actualizar datos!</div>
              <div className="mt-1 text-xs text-red-600">
                Por favor actualiza tu producción por hora.
                {lastSavedTime && (
                  <span className="block mt-1">
                    Último guardado: {new Date(lastSavedTime).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onDismiss} className="text-red-400 hover:text-red-600">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Alarm Status Indicator
 */
function AlarmStatusIndicator({ isActive, isPaused, nextAlarmTime }) {
  const getStatusColor = () => {
    if (isPaused) return "bg-gray-500";
    if (isActive) return "bg-green-500 animate-pulse";
    return "bg-yellow-500";
  };

  const getStatusText = () => {
    if (isPaused) return "Alarma en pausa";
    if (isActive) return "Alarma activa";
    return "En espera";
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
      <span className="text-xs text-gray-600">{getStatusText()}</span>
      {nextAlarmTime && !isPaused && (
        <span className="text-xs text-gray-500">
          Próxima: {nextAlarmTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

/**
 * Hourly Plan UI
 */
function HourlyPlanCard({
  slots,
  slotTargetsMap,
  sewedBySlot,
  onChangeSewed,
  operationName = "",
  lockedSlots = {},
}) {
  const totalSewed = useMemo(() => {
    let sum = 0;
    for (const s of slots) sum += safeNum(sewedBySlot?.[s.slot_label]);
    return sum;
  }, [slots, sewedBySlot]);

  const cumSewed = useMemo(() => {
    let running = 0;
    const out = {};
    for (const s of slots) {
      running += safeNum(sewedBySlot?.[s.slot_label]);
      out[s.slot_label] = running;
    }
    return out;
  }, [slots, sewedBySlot]);

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">Plan por hora</div>
          <div className="mt-1 text-xs text-gray-600">
            {operationName && (
              <span className="font-medium text-gray-900">Operación: {operationName}</span>
            )}
            <br />
            Objetivo por bloque = (Objetivo / Horas de trabajo) × Horas del bloque.
            <br />
            El objetivo acumulado se detiene en el último meta.
          </div>
        </div>
      </div>

      <div className="mt-4 border-t pt-4 overflow-x-auto">
        <table className="min-w-[620px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 border-y border-gray-200 border-r border-gray-200 rounded-tl-xl after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Fila
              </th>
              {slots.map((s, i) => (
                <th
                  key={s.slot_label}
                  className={`
                    bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700 
                    border-y border-gray-200 border-r border-gray-200 whitespace-nowrap
                    ${i === slots.length - 1 ? "border-r-0 rounded-tr-xl" : ""}
                  `}
                >
                  {s.slot_label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <HourlyRow
              label="Objetivo del bloque"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.slot_target).toFixed(2)
              }
            />

            <HourlyRow
              label="Objetivo acumulado"
              slots={slots}
              renderCell={(slot) =>
                safeNum(slotTargetsMap?.[slot.slot_label]?.cumulative_target).toFixed(2)
              }
            />

            <tr>
              <td className="sticky left-0 z-10 px-3 py-3 text-sm
               font-semibold text-gray-900 border-b border-gray-200
                border-r border-gray-200 bg-white after:absolute 
                after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200">
                Cosido (entrada)
              </td>
              {slots.map((slot, idx) => {
                const label = slot.slot_label;
                const v = sewedBySlot?.[label] ?? "";
                const isLocked = lockedSlots[label];
                
                return (
                  <td
                    key={label}
                    className={`
                      px-3 py-3 border-b border-gray-200 border-r border-gray-200 bg-white
                      ${idx === slots.length - 1 ? "border-r-0" : ""}
                    `}
                  >
                    <div className="relative">
                      <input
                        value={v}
                        onChange={(e) => onChangeSewed(label, e.target.value)}
                        placeholder="0"
                        inputMode="numeric"
                        disabled={isLocked}
                        className={`
                          w-28 rounded-xl border px-3 py-2 text-sm outline-none
                          ${isLocked 
                            ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed' 
                            : 'bg-white border-gray-200 focus:ring-2 focus:ring-gray-900/10'
                          }
                        `}
                      />
                      {isLocked && (
                        <span className="absolute -top-2 -right-2 text-xs bg-gray-800 text-white px-1.5 py-0.5 rounded-full">
                          🔒
                        </span>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>

            <HourlyRow
              label="Cosido acumulado"
              slots={slots}
              renderCell={(slot) => String(safeNum(cumSewed?.[slot.slot_label] ?? 0))}
              strong
              last
            />
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        Tip: Esta tabla se desliza horizontalmente en móvil. Es responsiva.
      </div>
    </div>
  );
}

function HourlyRow({ label, slots, renderCell, strong = false, last = false }) {
  return (
    <tr>
      <td
        className={`
          sticky left-0 z-10 px-3 py-3 text-sm font-semibold text-gray-900 bg-white 
          border-b border-gray-200 border-r border-gray-200
          after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-gray-200
          ${last ? "rounded-bl-xl" : ""}
        `}
      >
        {label}
      </td>
      {slots.map((slot, idx) => (
        <td
          key={slot.slot_label}
          className={`
            px-3 py-3 text-sm bg-white border-b border-gray-200 border-r border-gray-200 whitespace-nowrap
            ${strong ? "font-semibold text-gray-900" : "text-gray-800"}
            ${last && idx === slots.length - 1 ? "rounded-br-xl" : ""}
            ${idx === slots.length - 1 ? "border-r-0" : ""}
          `}
        >
          {renderCell(slot)}
        </td>
      ))}
    </tr>
  );
}

// Helper function to calculate real-time efficiency
const calculateRealtimeEfficiency = (finishedGarments, operatorsCount, workingHours, sam, elapsedMinutes) => {
  if (!operatorsCount || !workingHours || !sam || !elapsedMinutes) return 0;
  
  const samProduced = finishedGarments * sam;
  const availableMinutes = operatorsCount * elapsedMinutes;
  const realtimeEfficiency = availableMinutes > 0 ? (samProduced / availableMinutes) * 100 : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

// Shows "23 nov 2026" instead of the raw ISO string. Uses UTC so the day doesn't shift.
function formatHeaderDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ---- Hourly entry helpers ----
// Reads the start (and optional end) time from a slot label such as "07:00-08:00", "07–08" or "7:30".
// Returns minutes since midnight, or null when the label has no time in it.
function parseSlotRange(label) {
  const matches = [...String(label || "").matchAll(/(\d{1,2})(?::(\d{2}))?/g)];
  if (!matches.length) return null;
  const toMin = (m) => Number(m[1]) * 60 + Number(m[2] || 0);
  const start = toMin(matches[0]);
  if (start >= 24 * 60) return null;
  let end = matches[1] ? toMin(matches[1]) : start + 60;
  if (end <= start) end += 24 * 60; // block that crosses midnight
  return { start, end };
}

// Label of the block that contains the current time, or null.
function findSlotByTime(slots, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const s of slots || []) {
    const r = parseSlotRange(s.slot_label);
    if (r && mins >= r.start && mins < r.end) return s.slot_label;
  }
  return null;
}

// Block to open by default: the current hour, else the first block not fully saved, else the last one.
function pickDefaultSlotLabel(slots, isSlotFilled) {
  if (!slots?.length) return null;
  const byTime = findSlotByTime(slots);
  if (byTime) return byTime;
  const firstOpen = slots.find((s) => !isSlotFilled(s.slot_label));
  return (firstOpen || slots[slots.length - 1]).slot_label;
}

export default function LineLeaderPage() {
  const navigate = useNavigate();

  const [tab, setTab] = useState("summary");
  const [summaryView, setSummaryView] = useState("details"); // "details" | "meta"
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  // Ticket printing: `ticketBuilder` holds the per-size split configuration the
  // user edits; `tickets` holds the generated printable tickets (one per bundle).
  const [ticketBuilder, setTicketBuilder] = useState(null);
  const [tickets, setTickets] = useState(null);
  // Confirming = persisting the printed tickets to the DB so the assigned
  // quantity per size gets decreased next time this work order is opened.
  const [ticketsConfirmed, setTicketsConfirmed] = useState(false);
  const [ticketConfirmMsg, setTicketConfirmMsg] = useState("");
  // Borrador: tickets generados pero AÚN NO guardados. Guarda la lista plana
  // (lo que se envía al backend) y las filas del builder (para "Editar").
  const [ticketDraft, setTicketDraft] = useState(null);
  const [ticketSaving, setTicketSaving] = useState(false);

  // Multi-style state
  const [styles, setStyles] = useState([]);
  const [selectedStyleIndex, setSelectedStyleIndex] = useState(0);
  const [sewedInputs, setSewedInputs] = useState({}); // { styleIndex: { opId: { slotLabel: value } } }
  const [lockedSlots, setLockedSlots] = useState({}); // { styleIndex: { opId-slotLabel: true } }

  // Alarm System State
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmPaused, setAlarmPaused] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [nextAlarmTime, setNextAlarmTime] = useState(null);
  const [alarmInterval, setAlarmInterval] = useState(20);
  const [snoozeUntil, setSnoozeUntil] = useState(null);
  const alarmSoundRef = useRef(null);
  const alarmTimerRef = useRef(null);

  // Baja eficiencia (aviso 4:45 p.m.)
  const [effReasonOpen, setEffReasonOpen] = useState(false);
  const [effReasonSelected, setEffReasonSelected] = useState([]);
  const [effReasonNote, setEffReasonNote] = useState("");
  const [effReasonActionPlan, setEffReasonActionPlan] = useState(""); // plan para mañana (Ineficiencias)
  const [effReasonSaving, setEffReasonSaving] = useState(false);
  const [effReasonError, setEffReasonError] = useState("");
  const [effReasonSaved, setEffReasonSaved] = useState(false); // ya respondido hoy
  const [effReasonSnoozeUntil, setEffReasonSnoozeUntil] = useState(0);

  // State for line balancing assignments
  const [assignments, setAssignments] = useState([]);

  // State for time-based view
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);

  // Summary Banner States
  const [realTimeTarget, setRealTimeTarget] = useState(0);
  const [realTimeProgress, setRealTimeProgress] = useState(0);
  const [overallEfficiency, setOverallEfficiency] = useState(0);
  const [targetAchievement, setTargetAchievement] = useState(0);
  const [realTimeEfficiency, setRealTimeEfficiency] = useState(0);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }, []);

  const getToken = () => localStorage.getItem("token");

  // Get current style data
  const currentStyle = useMemo(() => {
    if (!styles.length || selectedStyleIndex >= styles.length) return null;
    return styles[selectedStyleIndex];
  }, [styles, selectedStyleIndex]);

  // Get current style's slots
  const slots = useMemo(() => currentStyle?.slots || [], [currentStyle]);

  // Get current style's slot targets map
  const slotTargetsMap = useMemo(() => {
    const map = {};
    if (currentStyle?.slotTargets) {
      for (const row of currentStyle.slotTargets) {
        map[row.slot_label] = {
          slot_target: safeNum(row.slot_target),
          cumulative_target: safeNum(row.cumulative_target),
        };
      }
    }
    return map;
  }, [currentStyle]);

  // Get current style's operators list
  const operatorsList = useMemo(() => currentStyle?.operators || [], [currentStyle]);

  // Get current style's target
  const target = useMemo(() => Number(currentStyle?.run?.target_pcs || 0), [currentStyle]);

  // Get current style's header info
  const header = useMemo(() => {
    if (!currentStyle?.run) return {
      line: "",
      date: "",
      style: "",
      workOrderNo: "",
      operators: "0",
      sam: "0",
      workingHours: "0",
      efficiency: 0.7,
    };
    
    const run = currentStyle.run;
    const style = String(run.style ?? "");
    const color = String(run.color ?? "");
    return {
      line: String(run.line_no ?? ""),
      date: String(run.run_date ?? ""),
      style,
      color,
      // Style stays the plain estilo; color is a separate field. This is only a
      // display label so a same-style/different-color run is still readable.
      styleLabel: color ? `${style} (${color})` : style,
      workOrderNo: String(run.work_order_no ?? ""),
      operators: String(run.operators_count ?? ""),
      sam: String(run.sam_minutes ?? ""),
      workingHours: String(run.working_hours ?? ""),
      efficiency: Number(run.efficiency ?? 0.7),
    };
  }, [currentStyle]);

  // Helper: get operation to operator mapping for current style
  const operationToOperatorMap = useMemo(() => {
    const map = new Map();
    if (currentStyle?.operations) {
      currentStyle.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          block.operations?.forEach(op => map.set(op.id, operatorId));
        }
      });
    }
    return map;
  }, [currentStyle]);

  // Helper: get operator to operation ids mapping for current style
  const operatorToOperationIds = useMemo(() => {
    const map = new Map();
    if (currentStyle?.operations) {
      currentStyle.operations.forEach(block => {
        const operatorId = block.operator?.id;
        if (operatorId) {
          const opIds = block.operations?.map(op => op.id) || [];
          map.set(operatorId, opIds);
        }
      });
    }
    return map;
  }, [currentStyle]);

  // ========== ALARM SYSTEM ==========
  useEffect(() => {
    alarmSoundRef.current = new Audio(
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
    );
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5);

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      audioContext.close();
    };
  }, []);

  useEffect(() => {
    const setupAlarm = () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
      if (alarmPaused || snoozeUntil > Date.now()) return;

      const intervalMs = alarmInterval * 60 * 1000;
      const nextTime = new Date(Date.now() + intervalMs);
      setNextAlarmTime(nextTime);

      alarmTimerRef.current = setTimeout(() => {
        if (!alarmPaused && snoozeUntil < Date.now()) {
          setAlarmVisible(true);
          try {
            alarmSoundRef.current.play();
          } catch (e) {
            console.log("Alarm sound failed:", e);
          }
        }
        setupAlarm();
      }, intervalMs);
    };

    setupAlarm();

    return () => {
      if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    };
  }, [alarmInterval, alarmPaused, snoozeUntil]);

  useEffect(() => {
    const snoozeCheck = setInterval(() => {
      if (snoozeUntil && Date.now() > snoozeUntil) setSnoozeUntil(null);
    }, 60000);
    return () => clearInterval(snoozeCheck);
  }, [snoozeUntil]);

  const handleDismissAlarm = () => {
    setAlarmVisible(false);
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    const intervalMs = alarmInterval * 60 * 1000;
    alarmTimerRef.current = setTimeout(() => {
      setAlarmVisible(true);
    }, intervalMs);
  };

  const handleSnoozeAlarm = () => {
    setAlarmVisible(false);
    setSnoozeUntil(Date.now() + 10 * 60 * 1000);
  };

  const handleTogglePauseAlarm = () => {
    setAlarmPaused(!alarmPaused);
    if (!alarmPaused) setAlarmVisible(false);
  };

  const updateLastSavedTime = () => {
    setLastSavedTime(new Date());
    localStorage.setItem("lineLeader_lastSaved", new Date().toISOString());
  };

  useEffect(() => {
    const saved = localStorage.getItem("lineLeader_lastSaved");
    if (saved) setLastSavedTime(new Date(saved));
  }, []);

  // ========== BAJA EFICIENCIA (aviso 4:45 p.m.) ==========
  const currentRunId = currentStyle?.run?.id || null;
  const effReasonDate = useMemo(() => toYmd(header.date), [header.date]);
  const effJefeLinea = useMemo(
    () => user?.full_name || user?.username || "",
    [user]
  );
  const effLineNo = header.line || user?.line_number || "";
  const effReasonKey = useMemo(
    () => `effReason_${effLineNo}_${effReasonDate}_${currentRunId ?? ""}`,
    [effLineNo, effReasonDate, currentRunId]
  );

  // Al cambiar de corrida: reinicia el modal y consulta si ya hay un motivo
  // guardado (así no se vuelve a preguntar).
  useEffect(() => {
    setEffReasonOpen(false);
    setEffReasonSelected([]);
    setEffReasonNote("");
    setEffReasonActionPlan("");
    setEffReasonError("");
    setEffReasonSnoozeUntil(0);

    if (!currentRunId) {
      setEffReasonSaved(false);
      return;
    }
    if (localStorage.getItem(effReasonKey) === "done") {
      setEffReasonSaved(true);
      return;
    }

    let cancelled = false;
    const token = getToken();
    (async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/lineleader/efficiency-reason/${currentRunId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setEffReasonSaved(false);
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (json?.reason) {
          setEffReasonSaved(true);
          setEffReasonSelected(
            Array.isArray(json.reason.reasons) ? json.reason.reasons : []
          );
          setEffReasonNote(json.reason.note || "");
          setEffReasonActionPlan(json.reason.action_plan || "");
          localStorage.setItem(effReasonKey, "done");
        } else {
          setEffReasonSaved(false);
        }
      } catch {
        if (!cancelled) setEffReasonSaved(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentRunId, effReasonKey]);

  // Revisa cada 30 s: a partir de las 4:45 p.m., si la eficiencia diaria va por debajo
  // del umbral y aún no se respondió, abre el modal.
  useEffect(() => {
    if (!currentRunId) return;
    const check = () => {
      if (effReasonSaved || effReasonOpen) return;
      if (Date.now() < effReasonSnoozeUntil) return;
      if (loading) return;
      if (!isAfterEffReasonTime()) return;
      if (!(elapsedMinutes > 0)) return; // los datos aún no están listos
      if (overallEfficiency < EFF_REASON_THRESHOLD) {
        setEffReasonOpen(true);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [
    currentRunId,
    effReasonSaved,
    effReasonOpen,
    effReasonSnoozeUntil,
    loading,
    elapsedMinutes,
    overallEfficiency,
  ]);

  const toggleEffReason = (code) => {
    setEffReasonError("");
    setEffReasonSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleEffReasonLater = () => {
    setEffReasonOpen(false);
    setEffReasonSnoozeUntil(Date.now() + EFF_REASON_SNOOZE_MS);
  };

  async function handleSaveEffReason() {
    if (!currentRunId) return;
    if (effReasonSelected.length === 0) {
      setEffReasonError("Selecciona al menos un motivo.");
      return;
    }
    if (effReasonSelected.includes("inefficiencies") && !effReasonActionPlan.trim()) {
      setEffReasonError("Escribe qué harás mañana para mejorar (Ineficiencias).");
      return;
    }
    const token = getToken();
    if (!token) {
      setEffReasonError("Tu sesión expiró. Inicia sesión de nuevo.");
      return;
    }

    setEffReasonSaving(true);
    setEffReasonError("");
    try {
      const json = await fetchJson(
        `http://localhost:5000/api/lineleader/efficiency-reason/${currentRunId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            reasons: effReasonSelected,
            note: effReasonNote.trim() || null,
            action_plan: effReasonSelected.includes("inefficiencies")
              ? effReasonActionPlan.trim()
              : null,
            efficiency: Math.round(overallEfficiency * 100) / 100,
          }),
        }
      );
      if (!json.success) {
        setEffReasonError(json.error || "No se pudo guardar el motivo.");
        return;
      }
      setEffReasonSaved(true);
      setEffReasonOpen(false);
      localStorage.setItem(effReasonKey, "done");
      setSaveMsg("Motivo de baja eficiencia guardado.");
    } catch (e) {
      setEffReasonError(e.message || "No se pudo guardar el motivo.");
    } finally {
      setEffReasonSaving(false);
    }
  }

  // ========== FETCH DATA ==========
  useEffect(() => {
    const token = getToken();
    if (!token || !user) return navigate("/", { replace: true });

    if (normalizeRole(user.role) !== "lineleader") {
      return navigate("/", { replace: true });
    }

    const lineNo = user.line_number;
    if (!lineNo) {
      setErrMsg("No hay una línea asignada a este usuario. Por favor contacte al administrador.");
      setLoading(false);
      return;
    }

    fetchLatestStyleGroup(lineNo);
  }, [user]);

  async function fetchLatestStyleGroup(lineNo) {
    setLoading(true);
    setErrMsg("");
    setSaveMsg("");

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      setLoading(false);
      return;
    }

    try {
      // First, try to get runs grouped by style_group_id
      const json = await fetchJson(
        `http://localhost:5000/api/multi-style/latest-group?line=${encodeURIComponent(lineNo)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (json.success && json.styles && json.styles.length > 0) {
        // Load complete data for each style
        const stylesData = [];
        for (const style of json.styles) {
          const runDataJson = await fetchJson(
            `http://localhost:5000/api/get-run-data/${style.run.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          
          if (runDataJson.success) {
            stylesData.push({
              run: runDataJson.run,
              slots: runDataJson.slots,
              operators: runDataJson.operators,
              operations: runDataJson.operations,
              slotTargets: runDataJson.slotTargets,
              sizes: runDataJson.sizes || [],
            });
          }
        }

        if (stylesData.length > 0) {
          setStyles(stylesData);
          initializeStylesData(stylesData);
          
          // Fetch assignments for the first style
          if (stylesData[0].run.id) {
            await fetchAssignments(stylesData[0].run.id);
          }
          
          setLoading(false);
          return;
        }
      }

      // Fallback: try single style runs
      await fetchSingleStyleRuns(lineNo);
    } catch (e) {
      console.error("Error fetching style group:", e);
      await fetchSingleStyleRuns(lineNo);
    }
  }

  async function fetchSingleStyleRuns(lineNo) {
    const token = getToken();
    try {
      const json = await fetchJson(
        `http://localhost:5000/api/lineleader/latest-run?line=${encodeURIComponent(lineNo)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (!json.success) {
        setErrMsg(json.error || "No se encontraron corridas para esta línea");
        setLoading(false);
        return;
      }
      
      const runDataJson = await fetchJson(
        `http://localhost:5000/api/get-run-data/${json.run.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      if (runDataJson.success) {
        const stylesData = [{
          run: runDataJson.run,
          slots: runDataJson.slots,
          operators: runDataJson.operators,
          operations: runDataJson.operations,
          slotTargets: runDataJson.slotTargets,
          sizes: runDataJson.sizes || [],
        }];
        setStyles(stylesData);
        initializeStylesData(stylesData);
        
        if (runDataJson.run.id) {
          await fetchAssignments(runDataJson.run.id);
        }
      }
    } catch (e) {
      setErrMsg(e.message || "Error de red");
    } finally {
      setLoading(false);
    }
  }

  function initializeStylesData(stylesData) {
    const initialInputs = {};
    const initialLocks = {};
    
    for (let i = 0; i < stylesData.length; i++) {
      const style = stylesData[i];
      initialInputs[i] = {};
      initialLocks[i] = {};
      
      for (const block of style.operations || []) {
        for (const op of block.operations || []) {
          initialInputs[i][op.id] = {};
          const sewed = op.sewed_data || {};
          
          for (const slot of style.slots || []) {
            const value = sewed[slot.slot_label] ?? "";
            initialInputs[i][op.id][slot.slot_label] = value;
            
            if (value && Number(value) > 0) {
              initialLocks[i][`${op.id}-${slot.slot_label}`] = true;
            }
          }
        }
      }
    }
    
    setSewedInputs(initialInputs);
    setLockedSlots(initialLocks);
    
    if (stylesData.length > 0 && stylesData[0].slots?.length > 0) {
      setSelectedTimeSlot(stylesData[0].slots[0].slot_label);
    }
  }

  async function fetchAssignments(runId) {
    const token = getToken();
    if (!token) return;

    try {
      const json = await fetchJson(`http://localhost:5000/api/lineleader/assignments/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (json.success) setAssignments(json.assignments);
    } catch (e) {
      console.error("Error fetching assignments:", e);
    }
  }

  // ========== CAPACITY CALCULATIONS ==========
  const getOperatorTotalCapacity = (operatorId) => {
    const operatorBlock = currentStyle?.operations?.find(b => b.operator?.id === operatorId);
    if (!operatorBlock?.operations?.length) return 0;
    
    let totalSecondsSum = 0;
    operatorBlock.operations.forEach(operation => {
      const t1 = Number(operation.t1_sec);
      const t2 = Number(operation.t2_sec);
      const t3 = Number(operation.t3_sec);
      const t4 = Number(operation.t4_sec);
      const t5 = Number(operation.t5_sec);
      
      if (t1 > 0) totalSecondsSum += t1;
      if (t2 > 0) totalSecondsSum += t2;
      if (t3 > 0) totalSecondsSum += t3;
      if (t4 > 0) totalSecondsSum += t4;
      if (t5 > 0) totalSecondsSum += t5;
    });
    
    if (totalSecondsSum <= 0) return 0;
    const averageSecondsPerPiece = totalSecondsSum / 5;
    return 3600 / averageSecondsPerPiece;
  };

  // ========== HANDLE SEWED CHANGES ==========
  const handleSewedChange = useCallback((styleIndex, opId, slotLabel, value) => {
    const lockKey = `${opId}-${slotLabel}`;
    if (lockedSlots[styleIndex]?.[lockKey]) {
      setSaveMsg("⚠️ Este valor ya está guardado y no puede modificarse");
      setTimeout(() => setSaveMsg(""), 3000);
      return;
    }

    setSewedInputs(prev => {
      const operatorId = operationToOperatorMap.get(opId);
      if (!operatorId) {
        return {
          ...prev,
          [styleIndex]: {
            ...prev[styleIndex],
            [opId]: {
              ...(prev[styleIndex]?.[opId] || {}),
              [slotLabel]: value,
            },
          },
        };
      }

      const affectedOpIds = operatorToOperationIds.get(operatorId) || [];
      const newState = { ...prev };
      
      if (!newState[styleIndex]) newState[styleIndex] = {};
      
      affectedOpIds.forEach(id => {
        newState[styleIndex][id] = {
          ...(newState[styleIndex][id] || {}),
          [slotLabel]: value,
        };
      });
      
      return newState;
    });
  }, [operationToOperatorMap, operatorToOperationIds, lockedSlots]);

  const handleTimeSlotChange = (styleIndex, operatorId, slotLabel, value) => {
    if (styleIndex === undefined || !operatorId || !slotLabel) return;
    
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return;
    
    const primaryOpId = opIds[0];
    handleSewedChange(styleIndex, primaryOpId, slotLabel, value);
  };

  const getOperatorValueForSlot = (styleIndex, operatorId, slotLabel) => {
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return '';
    
    const primaryOpId = opIds[0];
    const value = sewedInputs[styleIndex]?.[primaryOpId]?.[slotLabel];
    
    if (!value && opIds.length > 1) {
      for (const opId of opIds) {
        const val = sewedInputs[styleIndex]?.[opId]?.[slotLabel];
        if (val) return val;
      }
    }
    
    return value || '';
  };

  const isSlotLocked = (styleIndex, operatorId, slotLabel) => {
    const opIds = operatorToOperationIds.get(operatorId) || [];
    if (opIds.length === 0) return false;
    const primaryOpId = opIds[0];
    return lockedSlots[styleIndex]?.[`${primaryOpId}-${slotLabel}`] || false;
  };

  // ---- Fast hourly entry ----
  // Height of the app's own top bar ("Líder de Línea"), so the hour strip pins just below it
  // instead of sliding underneath it. Measured from the page, so it follows any header size.
  const [stickyTop, setStickyTop] = useState(0);
  useEffect(() => {
    let headerEl = null;
    let ro = null;
    const findHeader = () => {
      // Whatever sits at the very top of the screen; walk up to the element that is fixed/sticky.
      let node = document.elementFromPoint(Math.round(window.innerWidth / 2), 2);
      while (node && node !== document.body && node !== document.documentElement) {
        const pos = window.getComputedStyle(node).position;
        if (pos === "fixed" || pos === "sticky") return node;
        node = node.parentElement;
      }
      return null;
    };
    const measure = () => {
      if (!headerEl || !document.body.contains(headerEl)) {
        headerEl = findHeader();
        if (headerEl && typeof ResizeObserver !== "undefined") {
          ro?.disconnect();
          ro = new ResizeObserver(measure);
          ro.observe(headerEl);
        }
      }
      const r = headerEl?.getBoundingClientRect();
      // Only trust it if it really is a top bar (starts at the top and isn't huge).
      setStickyTop(r && r.top <= 1 && r.height > 0 && r.height < 200 ? Math.round(r.bottom) : 0);
    };
    measure();
    const t = setTimeout(measure, 400); // after fonts/layout settle
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);

  const entryInputRefs = useRef({}); // { operatorId: <input> }
  const slotChipRefs = useRef({}); // { slotLabel: <button> }
  const autoPickKeyRef = useRef("");

  const isSlotFullySaved = (styleIndex, slotLabel) =>
    operatorsList.length > 0 &&
    operatorsList.every((op) => isSlotLocked(styleIndex, op.id, slotLabel));

  // Block running right now (refreshes whenever elapsedMinutes ticks).
  const nowSlotLabel = useMemo(() => findSlotByTime(slots), [slots, elapsedMinutes]);

  // Open the current hour each time the operations tab is entered or the style changes.
  useEffect(() => {
    if (tab === "summary") {
      autoPickKeyRef.current = "";
      return;
    }
    if (!slots.length || !operatorsList.length) return;
    const key = `${selectedStyleIndex}|${tab}`;
    if (autoPickKeyRef.current === key) return;
    autoPickKeyRef.current = key;
    const pick = pickDefaultSlotLabel(slots, (label) => isSlotFullySaved(selectedStyleIndex, label));
    if (pick) {
      setSelectedTimeSlot(pick);
      setOpGroup(firstOpenGroup(pick));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedStyleIndex, slots, operatorsList, lockedSlots]);

  // Keep the selected hour chip visible in the strip.
  useEffect(() => {
    const el = slotChipRefs.current[selectedTimeSlot];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [selectedTimeSlot, tab]);

  // Enter / "Siguiente" on the keypad jumps to the next operator that is not locked.
  // ---- Operator group tabs (1–6, 7–12, ...) ----
  const OP_GROUP_SIZE = 6;
  const [opGroup, setOpGroup] = useState(0);
  const advanceAfterSaveRef = useRef(false);
  const opGroupCount = Math.max(1, Math.ceil(operatorsList.length / OP_GROUP_SIZE));
  const groupOfOperator = (operatorId) =>
    Math.max(0, Math.floor(operatorsList.findIndex((o) => o.id === operatorId) / OP_GROUP_SIZE));
  // First group in this hour that still has an operator to save (or the first group).
  const firstOpenGroup = (slotLabel) => {
    const i = operatorsList.findIndex((o) => !isSlotLocked(selectedStyleIndex, o.id, slotLabel));
    return i < 0 ? 0 : Math.floor(i / OP_GROUP_SIZE);
  };
  const selectSlot = (slotLabel) => {
    setSelectedTimeSlot(slotLabel);
    setOpGroup(firstOpenGroup(slotLabel));
  };

  // Keep the group valid if the style (and its operator count) changes.
  useEffect(() => {
    if (opGroup > opGroupCount - 1) setOpGroup(opGroupCount - 1);
  }, [opGroup, opGroupCount]);

  // After Guardar: if the whole group is now saved, move on to the next group with work left.
  useEffect(() => {
    if (!advanceAfterSaveRef.current || saving) return;
    advanceAfterSaveRef.current = false;
    const groupOps = operatorsList.slice(opGroup * OP_GROUP_SIZE, (opGroup + 1) * OP_GROUP_SIZE);
    if (groupOps.length && groupOps.every((o) => isSlotLocked(selectedStyleIndex, o.id, selectedTimeSlot))) {
      setOpGroup(firstOpenGroup(selectedTimeSlot));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedSlots, saving]);

  // Enter / "Siguiente" on the keypad jumps to the next operator that is not locked,
  // switching to the next group tab when the current one is finished.
  const focusNextEntry = (operatorId) => {
    const order = operatorsList
      .filter((o) => !isSlotLocked(selectedStyleIndex, o.id, selectedTimeSlot))
      .map((o) => o.id);
    const next = order[order.indexOf(operatorId) + 1];
    if (next == null) {
      entryInputRefs.current[operatorId]?.blur(); // last one: close the keypad
      return;
    }
    if (!entryInputRefs.current[next]) {
      // Render the next group right now, so focus stays inside the same tap
      // (otherwise phones close the keypad).
      flushSync(() => setOpGroup(groupOfOperator(next)));
    }
    const el = entryInputRefs.current[next];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.select?.();
    }
  };

  const getOperatorTotalCumulative = (styleIndex, operatorId) => {
    let cumulative = 0;
    const slotsList = slots;
    if (!slotsList.length) return cumulative;
    
    for (const slot of slotsList) {
      const slotValue = getOperatorValueForSlot(styleIndex, operatorId, slot.slot_label);
      cumulative += Number(slotValue) || 0;
    }
    return cumulative;
  };

  const getOperationTotal = useCallback((styleIndex, opId) => {
    if (!opId) return 0;
    let sum = 0;
    const data = sewedInputs[styleIndex]?.[opId] || {};
    for (const slotLabel of Object.keys(data)) sum += safeNum(data[slotLabel]);
    return sum;
  }, [sewedInputs]);

  // ========== FINISHED GARMENTS TOTAL ==========
  const finishedGarmentsTotal = useMemo(() => {
    let total = 0;
    const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];
    
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      for (const block of style.operations || []) {
        for (const op of block.operations || []) {
          const opName = (op.operation_name || '').toLowerCase();
          if (packingKeywords.some(keyword => opName.includes(keyword))) {
            const sewedData = sewedInputs[i]?.[op.id] || {};
            for (const qty of Object.values(sewedData)) {
              total += safeNum(qty);
            }
          }
        }
      }
    }
    return total;
  }, [styles, sewedInputs]);

  // Un fetch que NO revisa res.ok convierte un 404 en "guardado con exito":
  // res.json() sobre una respuesta de error devuelve un objeto sin `success`,
  // y el flujo sigue como si todo hubiera salido bien. Este helper obliga a
  // que cualquier respuesta que no sea 2xx truene con un mensaje util.
  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);

    if (res.status === 401 || res.status === 403) {
      throw new Error("Tu sesion expiro. Inicia sesion de nuevo.");
    }
    if (res.status === 404) {
      throw new Error(`La ruta ${url} no existe en el servidor (404).`);
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || `El servidor respondio ${res.status}`);
    }

    // El dev server de Vite responde index.html (200) a cualquier ruta que no
    // reconoce. Si eso pasa con /api/... es que la peticion nunca llego al
    // backend: falta el proxy en vite.config.js o la ruta no existe en el
    // servidor. Sin esta revision el error real se disfraza de "Unexpected
    // token '<'", que no dice nada sobre la causa.
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `${url} devolvio HTML en vez de JSON. La peticion no llego al backend: ` +
        `revisa el proxy de /api en vite.config.js o que la ruta exista en el servidor.`
      );
    }

    return res.json();
  }

  // ========== SAVE FUNCTION ==========
  async function handleSave() {
    if (!currentStyle || !currentStyle.run?.id) return;

    const token = getToken();
    if (!token) {
      setErrMsg("No estás autenticado. Por favor inicia sesión de nuevo.");
      return;
    }

    setSaving(true);
    setSaveMsg("");
    setErrMsg("");

    try {
      const runId = currentStyle.run.id;
      const entries = [];
      
      for (const block of currentStyle.operations || []) {
        const operatorNo = block.operator?.operator_no;
        for (const op of block.operations || []) {
          const opId = op.id;
          const opName = op.operation_name;
          
          for (const s of slots) {
            const slotLabel = s.slot_label;
            const raw = sewedInputs[selectedStyleIndex]?.[opId]?.[slotLabel];
            const qty = raw === "" ? 0 : safeNum(raw);
            
            entries.push({ operatorNo, operationName: opName, slotLabel, sewedQty: qty });
          }
        }
      }

      const json = await fetchJson(`http://localhost:5000/api/lineleader/update-sewed/${runId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entries }),
      });

      if (!json.success) {
        setErrMsg(json.error || "No se pudieron guardar los datos cosidos.");
        return;
      }

      // Lock saved values
      const newLockedState = { ...lockedSlots };
      for (const block of currentStyle.operations || []) {
        for (const op of block.operations || []) {
          const opId = op.id;
          for (const s of slots) {
            const slotLabel = s.slot_label;
            const value = sewedInputs[selectedStyleIndex]?.[opId]?.[slotLabel];
            const lockKey = `${opId}-${slotLabel}`;
            if (value && Number(value) > 0) {
              if (!newLockedState[selectedStyleIndex]) newLockedState[selectedStyleIndex] = {};
              newLockedState[selectedStyleIndex][lockKey] = true;
            }
          }
        }
      }
      setLockedSlots(newLockedState);

      updateLastSavedTime();
      setAlarmVisible(false);
      setSaveMsg(`✅ Actualizaciones por hora guardadas para ${currentStyle.run.style}`);

      openTicketBuilder();

      // Refresh data
      await fetchLatestStyleGroup(user.line_number);
    } catch (e) {
      setErrMsg(e.message || "Error de red al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ========== EXPORT ONE TICKET AS JPEG ==========
  // `t` is a generated ticket object; `elId` is the DOM id of its rendered card.
  async function downloadTicketImage(t, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 3, backgroundColor: "#ffffff" });
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `ticket_${t.workOrderNo}_${t.talla}_${t.seq}.jpg`;
    link.click();
  }

  async function shareTicketImage(t, elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 3, backgroundColor: "#ffffff" });
    canvas.toBlob(async (blob) => {
      const file = new File([blob], `ticket_${t.workOrderNo}_${t.talla}_${t.seq}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Ticket de producción" });
        } catch (e) {
          console.log("Compartir cancelado:", e);
        }
      } else {
        downloadTicketImage(t, elId);
      }
    }, "image/jpeg", 0.95);
  }

  function downloadTicketZPL(t) {
    const tallaTxt = t.label ? `${t.talla} ${t.label}` : t.talla;
    // Mismo QR Base32 que el ticket en pantalla (a prueba de distribución de teclado).
    const qrData = ticketQrPayload({
      tn: t.ticketNo, wo: t.workOrderNo, talla: t.talla, color: t.color,
      po: t.customerPo, qty: t.qty, runId: t.runId, seq: t.seq, date: t.date,
    });

    const zpl = `
^XA
^PW812
^LL609
^CI28
^MD25

^FO30,20^A0N,40,40^FD${t.workOrderNo}^FS
^FO30,64^A0N,24,24^FD${t.ticketNo || ""}^FS
^FO30,96^GB760,3,3^FS

^FO30,112^A0N,30,30^FDEstilo: ${t.style}^FS
^FO30,150^A0N,30,30^FDLinea: ${t.line}^FS
^FO30,188^A0N,30,30^FDFecha: ${t.date}^FS
^FO30,226^A0N,30,30^FDTalla: ${tallaTxt}^FS
^FO30,264^A0N,30,30^FDColor: ${t.color || "-"}^FS
^FO30,302^A0N,30,30^FDPO Cliente: ${t.customerPo || "-"}^FS

^FO30,352^A0N,26,26^FDCANTIDAD^FS
^FO30,386^A0N,60,60^FD${t.qty}^FS
^FO30,454^A0N,22,22^FDpiezas^FS

^FO540,112^BQN,2,${ZPL_QR_MAG}
^FDMA,${qrData}^FS
^FO540,346^A0N,20,20^FDTicket ${t.seq}/${t.total} · Corrida #${t.runId}^FS

^XZ
`.trim();

    const blob = new Blob([zpl], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ticket_${t.workOrderNo}_${t.talla}_${t.seq}.zpl`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ========== TICKET BUILDER ==========
  // Flujo simple: el usuario marca la talla, escribe la cantidad que envía al
  // almacén de terminado y guarda. Eso persiste el envío (descuenta lo
  // asignado) y abre directamente la sección de tickets generados.
  function openTicketBuilder() {
    if (!currentStyle?.run) return;
    const sizes = Array.isArray(currentStyle.sizes) ? currentStyle.sizes : [];

    let rows;
    if (sizes.length) {
      rows = [...sizes].sort(compareSizes).map((s) => {
        const q = Math.max(0, Math.round(safeNum(s.quantity)));
        // Total asignado por el merchant para esa talla (original, no el restante).
        const assigned = Math.max(0, Math.round(safeNum(s.assignedQuantity ?? s.quantity)));
        return {
          talla: s.talla || "—",
          label: labelForTalla(s.talla, s.label),
          color: s.color || "",
          customerPo: s.customerPo || s.customer_po || "",
          assigned,          // total del merchant (para el encabezado)
          merchantQty: q,    // restante (tope de lo que se puede enviar ahora)
          open: false,       // la talla se marca primero
          sendQty: 0,        // cantidad a enviar al almacén de terminado
        };
      });
    } else {
      // Sin desglose por talla: una fila editable con lo producido por la línea.
      const q = Math.max(0, Math.round(safeNum(finishedGarmentsTotal)));
      rows = [{ talla: "—", label: "", color: "", customerPo: "", assigned: q, merchantQty: q, open: true, sendQty: 0 }];
    }

    setTickets(null);
    setTicketDraft(null);
    setTicketsConfirmed(false);
    setTicketConfirmMsg("");
    setTicketBuilder({ rows, saving: false, error: "" });
  }

  // --- builder mutators (immutable updates) ---
  const updateBuilderRow = (i, patch) =>
    setTicketBuilder((b) => {
      if (!b) return b;
      const rows = b.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
      return { ...b, rows, error: "" };
    });

  // Marcar / desmarcar una talla. Al desmarcarla se limpia su cantidad.
  const toggleSizeOpen = (i) =>
    setTicketBuilder((b) => {
      if (!b) return b;
      const rows = b.rows.map((r, idx) => {
        if (idx !== i) return r;
        const open = !r.open;
        return open ? { ...r, open } : { ...r, open, sendQty: 0 };
      });
      return { ...b, rows, error: "" };
    });

  const setSendQty = (i, value) =>
    updateBuilderRow(i, { sendQty: Math.max(0, Math.floor(safeNum(value))) });

  // Footer: todas las tallas vuelven a desmarcadas y en 0.
  const clearAll = () =>
    setTicketBuilder((b) => {
      if (!b) return b;
      const rows = b.rows.map((r) => ({ ...r, open: false, sendQty: 0 }));
      return { ...b, rows, error: "" };
    });

  // Construye los tickets imprimibles (con QR) a partir de una lista plana
  // { talla, label, color, customerPo, qty }.
  async function buildTickets(flat) {
    const base = {
      workOrderNo: header.workOrderNo || "—",
      style: header.style || "—",
      line: header.line || "—",
      date: header.date ? header.date.split("T")[0] : "",
      runId: currentStyle.run.id,
    };

    // Sello de lote: distingue tickets de dos envíos de la misma corrida, así
    // el número de ticket es único. El almacén deduplica por él.
    const batch = Date.now().toString(36).toUpperCase().slice(-4);

    const built = [];
    for (let i = 0; i < flat.length; i++) {
      const { talla, label, color, customerPo, qty } = flat[i];
      const seq = i + 1;
      // Número de ticket: T-<corrida>-<lote>-<consecutivo>. Va impreso y dentro del QR.
      const ticketNo = `T-${base.runId}-${batch}-${seq}`;
      const qrPayload = ticketQrPayload({
        tn: ticketNo, wo: base.workOrderNo, talla, color, po: customerPo,
        qty, runId: base.runId, seq, date: base.date,
      });
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 300 });
      } catch (e) {
        console.error("Error generando QR:", e);
      }
      built.push({ ...base, ticketNo, talla, label, color, customerPo, qty, seq, total: flat.length, qrDataUrl });
    }
    return built;
  }

  // PASO 1 — Generar ticket: arma los tickets (con QR) para revisarlos.
  // Todavía NO se guarda nada; el guardado se hace en la pantalla de tickets.
  async function generateTickets() {
    const rows = ticketBuilder?.rows || [];
    const flat = rows
      .filter((r) => r.open && safeNum(r.sendQty) > 0)
      .map((r) => ({
        talla: r.talla,
        label: r.label || "",
        color: r.color || "",
        customerPo: r.customerPo || "",
        qty: Math.floor(safeNum(r.sendQty)),
      }));
    if (!flat.length) return;
    if (!currentStyle?.run?.id) return;

    setTicketBuilder((b) => (b ? { ...b, saving: true, error: "" } : b));
    try {
      const built = await buildTickets(flat);
      setTicketDraft({ flat, rows });
      setTicketsConfirmed(false);
      setTicketConfirmMsg("");
      setTicketBuilder(null);
      setTickets(built);
    } catch (e) {
      setTicketBuilder((b) => (b ? { ...b, saving: false, error: e.message || "No se pudo generar el ticket." } : b));
    }
  }

  // Volver al builder con la misma selección para corregir antes de guardar.
  function editTicketDraft() {
    if (!ticketDraft) return;
    setTickets(null);
    setTicketConfirmMsg("");
    setTicketBuilder({ rows: ticketDraft.rows, saving: false, error: "" });
  }

  // Cerrar la pantalla de tickets. Si no se guardó, se pide confirmación.
  function closeTickets() {
    if (ticketSaving) return;
    if (!ticketsConfirmed && ticketDraft) {
      const ok = window.confirm("Estos tickets no se han guardado. ¿Cerrar sin guardar?");
      if (!ok) return;
    }
    setTickets(null);
    setTicketDraft(null);
  }

  // PASO 2 — Guardar: persiste el envío al almacén de terminado (descuenta
  // lo asignado). Se llama desde la pantalla de tickets generados.
  async function saveTickets() {
    const flat = ticketDraft?.flat || [];
    if (!flat.length || ticketsConfirmed || ticketSaving) return;
    if (!currentStyle?.run?.id) return;

    const token = getToken();
    if (!token) {
      setTicketConfirmMsg("No estás autenticado. Inicia sesión de nuevo.");
      return;
    }

    // Payload para el backend (agrupado por talla+color+PO; aquí ya es 1:1).
    const payload = flat
      .filter((f) => String(f.talla ?? "").trim() && f.talla !== "—")
      .map((f) => ({
        talla: String(f.talla).trim(),
        color: String(f.color ?? "").trim(),
        customerPo: String(f.customerPo ?? "").trim(),
        qty: f.qty,
        count: 1,
      }));

    setTicketSaving(true);
    setTicketConfirmMsg("");
    try {
      let json = { success: true, remaining: [] };
      if (payload.length) {
        json = await fetchJson(
          `http://localhost:5000/api/lineleader/confirm-tickets/${currentStyle.run.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ tickets: payload }),
          }
        );
      }

      if (!json.success) {
        // Excede lo asignado u otro error de validación.
        setTicketConfirmMsg(json.error || "No se pudo guardar. Intenta de nuevo.");
        return;
      }

      // El backend devuelve el restante real por talla (asignado − enviado).
      const remainByKey = new Map();
      const printedByKey = new Map();
      for (const r of (json.remaining || [])) {
        const key = `${String(r.talla ?? "").trim()}||${String(r.color ?? "").trim()}||${String(r.customerPo ?? "").trim()}`;
        remainByKey.set(key, Number(r.remaining) || 0);
        printedByKey.set(key, Number(r.printed) || 0);
      }

      // Descuenta en memoria para que al reabrir se vea el restante nuevo.
      setStyles((prev) => {
        if (!prev || !prev.length) return prev;
        const idx = selectedStyleIndex;
        const style = prev[idx];
        if (!style || !Array.isArray(style.sizes)) return prev;
        const decBy = new Map();
        for (const p of payload) {
          const key = `${p.talla}||${p.color}||${p.customerPo}`;
          decBy.set(key, (decBy.get(key) || 0) + p.qty);
        }
        const sizes = style.sizes.map((s) => {
          const key = `${s.talla}||${s.color || ""}||${s.customerPo || ""}`;
          const dec = decBy.get(key) || 0;
          if (!dec && !remainByKey.has(key)) return s;
          const assigned = Number(s.assignedQuantity ?? s.quantity) || 0;
          const remaining = remainByKey.has(key)
            ? remainByKey.get(key)
            : Math.max(0, (Number(s.quantity) || 0) - dec);
          const printed = printedByKey.has(key)
            ? printedByKey.get(key)
            : (Number(s.printedQuantity) || 0) + dec;
          return { ...s, assignedQuantity: assigned, printedQuantity: printed, quantity: remaining };
        });
        const next = [...prev];
        next[idx] = { ...style, sizes };
        return next;
      });

      const savedQty = json.savedQty ?? flat.reduce((a, f) => a + f.qty, 0);
      const totalRemaining = (json.remaining || []).reduce((a, r) => a + (Number(r.remaining) || 0), 0);

      setTicketsConfirmed(true);
      setTicketConfirmMsg(
        `✅ Guardado. Se enviaron ${savedQty} pzs al almacén de terminado. Faltan ${totalRemaining} pzs por producir.`
      );
    } catch (e) {
      setTicketConfirmMsg(e.message || "Error de red al guardar.");
    } finally {
      setTicketSaving(false);
    }
  }

  // Print every generated ticket, one per page, via a dedicated print window so
  // the app's global `no-print` styles don't interfere.
  function printAllTickets() {
    if (!tickets || !tickets.length) return;
    const esc = (s) =>
      String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
      );
    const cards = tickets
      .map(
        (t) => `
      <div class="ticket">
        <div class="head">
          <div class="label">TICKET DE PRODUCCIÓN</div>
          <div class="wo">${esc(t.workOrderNo)}</div>
          ${t.ticketNo ? `<div class="tn">${esc(t.ticketNo)}</div>` : ""}
        </div>
        <div class="body">
          <div class="row"><span>Estilo</span><b>${esc(t.style)}</b></div>
          <div class="row"><span>Línea</span><b>${esc(t.line)}</b></div>
          <div class="row"><span>Fecha</span><b>${esc(t.date)}</b></div>
          <div class="row"><span>Talla</span><b>${esc(t.label ? `${t.talla} · ${t.label}` : t.talla)}</b></div>
          <div class="row"><span>Color</span><b>${esc(t.color || "—")}</b></div>
          <div class="row"><span>PO Cliente</span><b>${esc(t.customerPo || "—")}</b></div>
          <div class="qtybox">
            <div class="qlabel">CANTIDAD</div>
            <div class="qty">${esc(t.qty)}</div>
            <div class="pieces">piezas</div>
          </div>
          <div class="qrwrap">
            ${t.qrDataUrl ? `<img src="${t.qrDataUrl}" width="150" height="150" />` : ""}
            <div class="seq">Ticket ${t.seq}/${t.total} · Corrida #${esc(t.runId)}</div>
          </div>
        </div>
      </div>`
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tickets</title>
      <style>
        *{box-sizing:border-box;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif}
        body{margin:0;padding:0;color:#1a1a18}
        .ticket{width:320px;margin:0 auto;border:1px solid #d8d8d2;border-radius:10px;overflow:hidden;page-break-after:always}
        .ticket:last-child{page-break-after:auto}
        .head{background:#1a1a18;color:#fff;padding:14px 16px;text-align:center}
        .label{font-size:11px;letter-spacing:2px;color:#c9c9c2}
        .wo{font-size:22px;font-weight:600;margin-top:4px}
        .tn{font-size:12px;margin-top:2px;color:#e6e6df;font-family:monospace}
        .body{padding:14px 16px}
        .row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #eee}
        .row span{color:#6b6b64}
        .row b{font-weight:600}
        .qtybox{margin:14px 0;background:#f4f4ef;border-radius:8px;padding:12px;text-align:center}
        .qlabel{font-size:11px;letter-spacing:1px;color:#6b6b64}
        .qty{font-size:40px;font-weight:600;line-height:1.1;margin-top:2px}
        .pieces{font-size:12px;color:#6b6b64}
        .qrwrap{display:flex;flex-direction:column;align-items:center;padding-top:4px}
        .qrwrap img{border:1px solid #e2e2dc;border-radius:8px;padding:8px}
        .seq{font-size:11px;color:#9a9a92;margin-top:8px}
        @media print{.ticket{border:none}}
      </style></head><body>${cards}
      <script>window.onload=function(){window.focus();window.print();}<\/script>
      </body></html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ========== REAL-TIME CALCULATIONS ==========
  useEffect(() => {
    if (!currentStyle || !slots.length || !slotTargetsMap || !target) return;

    const calculateRealtime = () => {
      const now = new Date();
      const dateStr = header.date ? header.date.split('T')[0] : new Date().toISOString().split('T')[0];
      
      const PRODUCTION_START = new Date(`${dateStr}T08:00:00`);
      
      const slotsWithTime = slots
        .map(slot => {
          if (!slot.slot_start || !slot.slot_end) return null;
          const start = new Date(`${dateStr}T${slot.slot_start}`);
          const end = new Date(`${dateStr}T${slot.slot_end}`);
          return { ...slot, start, end };
        })
        .filter(s => s !== null);
      
      const PRODUCTION_END = slotsWithTime.length > 0 
        ? new Date(Math.max(...slotsWithTime.map(s => s.end.getTime())))
        : new Date(`${dateStr}T17:36:00`);

      const elapsedMs = now - PRODUCTION_START;
      const elapsedMins = Math.max(0, elapsedMs / (1000 * 60));
      setElapsedMinutes(elapsedMins);

      if (now < PRODUCTION_START) {
        setRealTimeTarget(0);
        setRealTimeProgress(0);
        return;
      }
      
      if (now >= PRODUCTION_END) {
        setRealTimeTarget(target);
        setRealTimeProgress(100);
        return;
      }
      
      const elapsedMilliseconds = now - PRODUCTION_START;
      const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
      
      if (totalProductionMilliseconds > 0) {
        const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
        const cumulative = target * progressRatio;
        setRealTimeTarget(Math.min(Math.round(cumulative * 100) / 100, target));
        setRealTimeProgress(target > 0 ? (cumulative / target) * 100 : 0);
      }
    };

    calculateRealtime();
    const interval = setInterval(calculateRealtime, 60000);
    return () => clearInterval(interval);
  }, [currentStyle, slots, slotTargetsMap, target, header.date]);

  useEffect(() => {
    if (!currentStyle || target === 0 || finishedGarmentsTotal === undefined) return;

    const operatorsCount = Number(header.operators) || 0;
    const workingHours = Number(header.workingHours) || 0;
    const sam = Number(header.sam) || 0;

    const availableMinutes = operatorsCount * workingHours * 60;
    const totalSAMOutput = finishedGarmentsTotal * sam;
    const eff = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
    setOverallEfficiency(Math.round(eff * 100) / 100);

    const ach = target > 0 ? (finishedGarmentsTotal / target) * 100 : 0;
    setTargetAchievement(Math.round(ach * 100) / 100);

    const rtEff = calculateRealtimeEfficiency(
      finishedGarmentsTotal,
      operatorsCount,
      workingHours,
      sam,
      elapsedMinutes
    );
    setRealTimeEfficiency(rtEff);
  }, [currentStyle, target, finishedGarmentsTotal, header.operators, header.workingHours, header.sam, elapsedMinutes]);

  const getStatusDot = (value, type) => {
    if (value === undefined || value === null) return 'bg-gray-400';
    if (type === 'efficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'cumplimiento') {
      if (value < 70) return 'bg-red-500';
      if (value < 90) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'realtimeEfficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    return 'bg-gray-400';
  };

  const slotsForSummary = useMemo(() => {
    if (!currentStyle?.slots) return [];
    return currentStyle.slots.map((s) => ({
      id: s.slot_label,
      label: s.slot_label,
      hours: Number(s.planned_hours || 0),
      startTime: s.slot_start,
      endTime: s.slot_end,
    }));
  }, [currentStyle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBarline />
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">Cargando…</div>
        </div>
      </div>
    );
  }

  if (errMsg) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBarline />
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="rounded-2xl border bg-white p-5 shadow-sm text-red-600">{errMsg}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBarline />

      <AlarmNotification
        visible={alarmVisible}
        onDismiss={handleDismissAlarm}
        onSnooze={handleSnoozeAlarm}
        lastSavedTime={lastSavedTime}
      />

      <EfficiencyReasonModal
        visible={effReasonOpen}
        lineNo={effLineNo}
        jefeLinea={effJefeLinea}
        date={effReasonDate}
        efficiency={overallEfficiency}
        selected={effReasonSelected}
        onToggle={toggleEffReason}
        note={effReasonNote}
        onNoteChange={setEffReasonNote}
        actionPlan={effReasonActionPlan}
        onActionPlanChange={(v) => {
          setEffReasonError("");
          setEffReasonActionPlan(v);
        }}
        onSave={handleSaveEffReason}
        onLater={handleEffReasonLater}
        saving={effReasonSaving}
        errorMsg={effReasonError}
      />

      <div className="mx-auto max-w-6xl p-3 sm:p-6">
        <div className="rounded-2xl border bg-white shadow-sm p-3">
          {/* Row 1: line + date, alarm status on the right */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-base font-semibold text-gray-900">
              Línea {user?.line_number}
              {header.date ? (
                <span className="font-normal text-gray-500"> · {formatHeaderDate(header.date)}</span>
              ) : null}
            </div>
            <div className="shrink-0 origin-right scale-90">
              <AlarmStatusIndicator
                isActive={!alarmPaused && !snoozeUntil}
                isPaused={alarmPaused}
                nextAlarmTime={nextAlarmTime}
              />
            </div>
          </div>

          {/* Row 2: style + work order(s).
              One WO stays on the same line as the style (shortened if needed);
              two or more WOs wrap onto the next line. */}
          {(() => {
            const workOrders = String(header.workOrderNo || "")
              .split(/[,;|]/)
              .map((w) => w.trim())
              .filter(Boolean);
            const several = workOrders.length > 1;
            return (
              <div className={`mt-1.5 flex items-center gap-1.5 ${several ? "flex-wrap" : "flex-nowrap"}`}>
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                  {header.styleLabel || "Corrida"}
                </span>
                {workOrders.map((wo) => (
                  <span
                    key={wo}
                    title={`WO: ${wo}`}
                    className={`min-w-0 truncate rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 ${
                      several ? "max-w-full" : ""
                    }`}
                  >
                    WO: {wo}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Row 3: run data in one line */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
            <span><b className="font-semibold text-gray-900">{header.operators}</b> operadores</span>
            <span><b className="font-semibold text-gray-900">{header.workingHours}</b> h</span>
            <span>SAM <b className="font-semibold text-gray-900">{header.sam}</b></span>
            <span>Efic. <b className="font-semibold text-gray-900">{Math.round(safeNum(header.efficiency) * 100)}%</b></span>
            <span>Cosido <b className="font-semibold text-gray-900">{finishedGarmentsTotal}</b></span>
          </div>

          {/* Row 4: page tabs, equal width */}
          <div className="mt-2.5 flex gap-1.5">
            <button
              onClick={() => setTab("summary")}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${
                tab === "summary" ? "bg-gray-900 text-white" : "border bg-white text-gray-900"
              }`}
            >
              Resumen
            </button>
            <button
              onClick={() => setTab("operations")}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${
                tab === "operations" ? "bg-gray-900 text-white" : "border bg-white text-gray-900"
              }`}
            >
              Operaciones
            </button>
            {/* Pedir paneles al supermercado y confirmar lo que llega.
                The wrapper sizes the component's own button to match the other two tabs. */}
            <div className="flex-1 [&_button]:!w-full [&_button]:!rounded-lg [&_button]:!px-2 [&_button]:!py-1.5 [&_button]:!text-xs">
              <PanelRequestsButton getToken={getToken} />
            </div>
          </div>

          {lastSavedTime && tab === "summary" && (
            <div className="mt-1.5 text-right text-[11px] text-gray-500">
              Guardado {new Date(lastSavedTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          )}

          {/* Style Selection Tabs */}
          {styles.length > 1 && (
            <div className="mt-3">
              <div className="flex gap-2 border-b">
                {styles.map((style, idx) => (
                  <button
                    key={style.run.id}
                    onClick={() => {
                      setSelectedStyleIndex(idx);
                      if (style.slots?.length > 0) {
                        setSelectedTimeSlot(style.slots[0].slot_label);
                      }
                      if (style.run.id) {
                        fetchAssignments(style.run.id);
                      }
                    }}
                    className={`px-4 py-2 text-sm font-medium transition-all ${
                      selectedStyleIndex === idx
                        ? "border-b-2 border-gray-900 text-gray-900"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {style.run.color || style.run.style}
                    <span className="ml-1 text-xs text-gray-400">
                      ({Math.round(style.run.target_pcs || 0)} pcs)
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {saveMsg ? (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {saveMsg}
          </div>
        ) : null}

        <div className="mt-3">
          {tab === "summary" ? (
            <>
              {/* Sub-tabs: Detalle de trabajo / Resumen de meta */}
              <div
                role="tablist"
                aria-label="Vista del resumen"
                className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1"
              >
                {[
                  { key: "details", label: "Detalle de trabajo" },
                  { key: "meta", label: "Resumen de meta" },
                ].map((t) => {
                  const active = summaryView === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSummaryView(t.key)}
                      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                        active ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {summaryView === "details" ? (
                currentStyle && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                    {/* Meta */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-xs font-medium text-gray-500">Meta</p>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">
                        {Math.round(target).toLocaleString()}
                      </p>
                      <p className="text-[11px] text-gray-500">piezas</p>
                    </div>

                    {/* Meta en tiempo real */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-xs font-medium text-gray-500">Meta en tiempo real</p>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">
                        {realTimeTarget.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
                      </p>
                      <div className="mt-1.5 h-1 w-full rounded-full bg-gray-200">
                        <div
                          className="h-1 rounded-full bg-blue-600 transition-all duration-500"
                          style={{ width: `${Math.min(realTimeProgress, 100)}%` }}
                        ></div>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">{realTimeProgress.toFixed(1)}% de la meta</p>
                    </div>

                    {/* Total cosido */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-xs font-medium text-gray-500">Total cosido</p>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">
                        {Math.round(finishedGarmentsTotal).toLocaleString()}
                      </p>
                      <p className="text-[11px] text-gray-500">piezas terminadas</p>
                    </div>

                    {/* Eficiencia en tiempo real */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDot(realTimeEfficiency, 'realtimeEfficiency')}`}></span>
                        <p className="text-xs font-medium text-gray-500">Efic. tiempo real</p>
                      </div>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">{realTimeEfficiency.toFixed(1)}%</p>
                      <p className="text-[11px] text-gray-500">hasta ahora</p>
                    </div>

                    {/* Eficiencia diaria */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDot(overallEfficiency, 'efficiency')}`}></span>
                        <p className="text-xs font-medium text-gray-500">Efic. diaria</p>
                      </div>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">{overallEfficiency.toFixed(1)}%</p>
                      <p className="text-[11px] text-gray-500">basada en SAM</p>
                    </div>

                    {/* Cumplimiento */}
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDot(targetAchievement, 'cumplimiento')}`}></span>
                        <p className="text-xs font-medium text-gray-500">Cumplimiento</p>
                      </div>
                      <p className="mt-0.5 text-2xl font-bold leading-tight text-gray-900">{targetAchievement.toFixed(1)}%</p>
                      <div className="mt-1.5 h-1 w-full rounded-full bg-gray-200">
                        <div
                          className="h-1 rounded-full bg-gray-900 transition-all duration-500"
                          style={{ width: `${Math.min(targetAchievement, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <MetaSummary header={header} target={target} slots={slotsForSummary} />
              )}
              
              {assignments.length > 0 && (
                <div className="mt-6 rounded-3xl border bg-white shadow-sm p-6">
                  <h2 className="text-lg font-semibold mb-4">Asignaciones de ayuda</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-4 py-2 text-left">Operador lento</th>
                          <th className="px-4 py-2 text-left">Operación</th>
                          <th className="px-4 py-2 text-left">Ayudado por</th>
                          <th className="px-4 py-2 text-left">Cantidad por hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignments.map((a) => (
                          <tr key={a.id} className="border-t">
                            <td className="px-4 py-2">
                              Op. {a.source_operator_no}{" "}
                              {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.operation_name}</td>
                            <td className="px-4 py-2">
                              Op. {a.target_operator_no}{" "}
                              {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                            </td>
                            <td className="px-4 py-2">{a.assigned_quantity_per_hour} pcs/h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Time-based Operations Section
            currentStyle && (
              <div className="space-y-4">
                {/* Hour strip: one swipeable row, pinned while scrolling */}
                <div
                  className="sticky z-20 rounded-xl border bg-white p-1.5 shadow-sm"
                  style={{ top: stickyTop + 6 }}
                >
                  <div
                    className="flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    role="tablist"
                    aria-label="Bloques horarios"
                  >
                    {slots.map((slot) => {
                      const label = slot.slot_label;
                      const isSelected = selectedTimeSlot === label;
                      const isDone = isSlotFullySaved(selectedStyleIndex, label);
                      const isNow = nowSlotLabel === label;
                      const slotTarget = slotTargetsMap[label]?.slot_target || 0;
                      return (
                        <button
                          key={label}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          ref={(el) => {
                            if (el) slotChipRefs.current[label] = el;
                            else delete slotChipRefs.current[label];
                          }}
                          onClick={() => selectSlot(label)}
                          className={`min-w-[64px] shrink-0 rounded-xl border-2 px-3 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                            isSelected
                              ? "border-gray-900 bg-gray-900 text-white"
                              : isNow
                              ? "border-blue-300 bg-blue-50 text-gray-900"
                              : "border-gray-200 bg-white text-gray-900 hover:border-gray-300"
                          }`}
                        >
                          <div className="text-lg font-bold leading-tight whitespace-nowrap">{label}</div>
                          <div className={`mt-0.5 text-xs font-medium leading-tight ${isSelected ? "text-gray-300" : isDone ? "text-green-700" : isNow ? "text-blue-700" : "text-gray-500"}`}>
                            {isDone ? "✓ listo" : isNow ? "ahora" : `Meta ${Math.round(slotTarget)}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Selected hour: one compact row per operator */}
                {selectedTimeSlot && (() => {
                  const filledCount = operatorsList.filter((op) => {
                    const v = getOperatorValueForSlot(selectedStyleIndex, op.id, selectedTimeSlot);
                    return isSlotLocked(selectedStyleIndex, op.id, selectedTimeSlot) || (v !== "" && v != null);
                  }).length;
                  const openOps = operatorsList.filter((o) => !isSlotLocked(selectedStyleIndex, o.id, selectedTimeSlot));
                  const lastOpenId = openOps.length ? openOps[openOps.length - 1].id : null;
                  return (
                  <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                    <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Bloque {selectedTimeSlot} · Meta {Math.round(slotTargetsMap[selectedTimeSlot]?.slot_target || 0)}
                        </h3>
                        <p className="mt-0.5 text-xs text-gray-500">
                          Estilo {header.styleLabel} · 🔒 lo guardado no se puede cambiar
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {filledCount} de {operatorsList.length}
                      </span>
                    </div>

                    {/* Group tabs: 1–6, 7–12, 13–18, ... */}
                    {opGroupCount > 1 && (
                      <div
                        role="tablist"
                        aria-label="Grupos de operadores"
                        className="grid gap-1.5 px-2 pt-2"
                        style={{ gridTemplateColumns: `repeat(${opGroupCount}, minmax(0, 1fr))` }}
                      >
                        {Array.from({ length: opGroupCount }, (_, g) => {
                          const groupOps = operatorsList.slice(g * OP_GROUP_SIZE, (g + 1) * OP_GROUP_SIZE);
                          const filled = groupOps.filter((o) => {
                            const v = getOperatorValueForSlot(selectedStyleIndex, o.id, selectedTimeSlot);
                            return isSlotLocked(selectedStyleIndex, o.id, selectedTimeSlot) || (v !== "" && v != null);
                          }).length;
                          const allSaved = groupOps.every((o) => isSlotLocked(selectedStyleIndex, o.id, selectedTimeSlot));
                          const active = g === opGroup;
                          return (
                            <button
                              key={g}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              onClick={() => setOpGroup(g)}
                              className={`rounded-xl border-2 px-1 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
                                active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900"
                              }`}
                            >
                              <div className="text-base font-bold leading-tight">
                                {groupOps[0]?.operator_no}–{groupOps[groupOps.length - 1]?.operator_no}
                              </div>
                              <div
                                className={`mt-0.5 text-xs font-medium leading-tight ${
                                  active ? "text-gray-300" : allSaved ? "text-green-700" : "text-gray-500"
                                }`}
                              >
                                {allSaved ? "✓ listo" : `${filled} de ${groupOps.length}`}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Two operators per row on phones (3–4 on wider screens); only the current group */}
                    <ul className="grid grid-cols-2 gap-2 p-2 pb-3 sm:grid-cols-3 lg:grid-cols-4">
                      {operatorsList.slice(opGroup * OP_GROUP_SIZE, (opGroup + 1) * OP_GROUP_SIZE).map((op) => {
                        const operatorId = op.id;
                        const currentValue = getOperatorValueForSlot(selectedStyleIndex, operatorId, selectedTimeSlot);
                        const isLocked = isSlotLocked(selectedStyleIndex, operatorId, selectedTimeSlot);
                        const totalCapacity = getOperatorTotalCapacity(operatorId);
                        const cumulativeTotal = getOperatorTotalCumulative(selectedStyleIndex, operatorId);

                        return (
                          <li
                            key={op.id}
                            className={`min-w-0 rounded-xl border p-2 ${isLocked ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-white"}`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
                                {op.operator_no}
                              </div>
                              <div className="min-w-0 truncate text-sm font-semibold text-gray-900">
                                {op.operator_name || "Sin nombre"}
                              </div>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-gray-500">
                              Cap {totalCapacity.toFixed(1)}/h · Acum {cumulativeTotal}
                            </div>
                            {isLocked ? (
                              <div
                                className="mt-1.5 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-gray-200 text-xl font-bold text-gray-600"
                                title="Guardado"
                              >
                                <span className="text-sm" aria-hidden="true">🔒</span>
                                {currentValue === "" || currentValue == null ? 0 : currentValue}
                              </div>
                            ) : (
                              <input
                                ref={(el) => {
                                  if (el) entryInputRefs.current[operatorId] = el;
                                  else delete entryInputRefs.current[operatorId];
                                }}
                                type="number"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                enterKeyHint={operatorId === lastOpenId ? "done" : "next"}
                                aria-label={`Piezas operador ${op.operator_no}`}
                                value={currentValue}
                                onChange={(e) =>
                                  handleTimeSlotChange(selectedStyleIndex, operatorId, selectedTimeSlot, e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    focusNextEntry(operatorId);
                                  }
                                }}
                                onFocus={(e) => e.target.select()}
                                onWheel={(e) => e.currentTarget.blur()}
                                placeholder="0"
                                min="0"
                                className="mt-1.5 h-12 w-full scroll-mb-24 scroll-mt-44 rounded-xl border-2 border-gray-300 text-center text-xl font-bold outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="px-4 pb-4">
                      {/* Collapsible operations details */}
                      <details className="mt-3">
                        <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
                          Ver todas las operaciones de este operador
                        </summary>
                        <div className="mt-4 space-y-4 border-t pt-4">
                          {operatorsList.map((op) => {
                            const block = currentStyle?.operations?.find(b => b.operator?.id === op.id);
                            const operatorTotalCapacity = getOperatorTotalCapacity(op.id);
                            const operatorCumulativeTotal = getOperatorTotalCumulative(selectedStyleIndex, op.id);
                            
                            return (
                              <div key={op.id} className="bg-gray-50 rounded-xl p-4">
                                <div className="flex justify-between items-center mb-2">
                                  <div className="font-semibold text-gray-900">
                                    Operador {op.operator_no} - {op.operator_name}
                                  </div>
                                  <div className="text-sm bg-gray-200 px-3 py-1 rounded-full">
                                    Capacidad total: {operatorTotalCapacity.toFixed(3)} pcs/h
                                  </div>
                                </div>
                                <div className="flex justify-between items-center mb-3">
                                  <div className="text-sm text-gray-500">Total acumulado:</div>
                                  <div className="text-sm font-semibold bg-gray-200 px-3 py-1 rounded-full">
                                    {operatorCumulativeTotal} pcs
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  {block?.operations?.map((operation) => {
                                    const opTotal = getOperationTotal(selectedStyleIndex, operation.id);
                                    let opCapacity = 0;
                                    const t1 = Number(operation.t1_sec);
                                    const t2 = Number(operation.t2_sec);
                                    const t3 = Number(operation.t3_sec);
                                    const t4 = Number(operation.t4_sec);
                                    const t5 = Number(operation.t5_sec);
                                    
                                    const times = [t1, t2, t3, t4, t5].filter(t => t > 0);
                                    if (times.length > 0) {
                                      const avgSeconds = times.reduce((a, b) => a + b, 0) / times.length;
                                      opCapacity = 3600 / avgSeconds;
                                    }
                                    
                                    return (
                                      <div key={operation.id} className="flex justify-between items-center text-sm">
                                        <span className="text-gray-600">{operation.operation_name}</span>
                                        <div className="flex items-center gap-4">
                                          <span className="text-xs text-gray-500">
                                            Cap: {opCapacity.toFixed(3)} pcs/h
                                          </span>
                                          <span className="font-medium text-gray-900">{opTotal} pcs</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </div>
                  </div>
                  );
                })()}

                {/* Save bar: one slim row pinned to the bottom */}
                <div className="sticky bottom-0 z-20 -mx-3 flex items-center gap-2 border-t bg-white px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:bottom-2 sm:mx-0 sm:rounded-2xl sm:border sm:pb-2">
                  <div className="min-w-0 flex-1 truncate text-xs leading-tight text-gray-500">
                    {alarmVisible ? (
                      <button
                        type="button"
                        onClick={handleDismissAlarm}
                        className="rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200"
                      >
                        ⏰ Cerrar alarma
                      </button>
                    ) : lastSavedTime ? (
                      <>Guardado {new Date(lastSavedTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>
                    ) : (
                      "Sin guardar"
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={openTicketBuilder}
                    disabled={!currentStyle}
                    aria-label="Imprimir ticket"
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-gray-300 bg-white px-4 py-2.5 text-base font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span aria-hidden="true">🖨️</span> Ticket
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      advanceAfterSaveRef.current = true;
                      handleSave();
                    }}
                    disabled={saving || !currentStyle}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-base font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Guardando…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">💾</span> Guardar
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ============ TICKET BUILDER (cantidad por talla) ============ */}
      {ticketBuilder && (() => {
        const rows = ticketBuilder.rows;
        const saving = !!ticketBuilder.saving;
        const rowStats = rows.map((r) => {
          const qty = r.open ? safeNum(r.sendQty) : 0;
          return { qty, over: qty > r.merchantQty, after: r.merchantQty - qty };
        });
        const readyRows = rows.filter((r, i) => r.open && rowStats[i].qty > 0).length;
        const totalToSend = rowStats.reduce((a, s) => a + s.qty, 0);
        const anyOver = rowStats.some((s) => s.over);
        const canSave = readyRows > 0 && !anyOver && !saving;

        return (
          <div
            onClick={() => { if (!saving) setTicketBuilder(null); }}
            className="no-print"
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 16, zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto",
                background: "#fff", borderRadius: 14, boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
                fontFamily: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif", color: "#1a1a18",
              }}
            >
              <div style={{ background: "#1a1a18", color: "#fff", padding: "16px 20px" }}>
                <div style={{ fontSize: 12, letterSpacing: 2, color: "#c9c9c2" }}>ENVÍO A ALMACÉN DE TERMINADO</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                  {header.workOrderNo || "—"} · {header.style || "—"}
                </div>
                <div style={{ fontSize: 12, color: "#c9c9c2", marginTop: 2 }}>
                  1) Selecciona la talla · 2) escribe la cantidad que envías · 3) genera el ticket. Lo guardas en la siguiente pantalla. No puedes exceder el restante por talla.
                </div>
              </div>

              <div style={{ padding: "12px 16px 4px" }}>
                {rows.map((r, i) => {
                  const st = rowStats[i];
                  return (
                    <div
                      key={`${r.talla}-${r.color}-${i}`}
                      style={{
                        border: r.open ? "1px solid #1a1a18" : "1px solid #e6e6e0", borderRadius: 10,
                        padding: 12, marginBottom: 12,
                        background: st.over ? "#fff5f5" : "#fafaf7",
                      }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: r.merchantQty > 0 ? "pointer" : "default", flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          checked={r.open}
                          disabled={r.merchantQty <= 0 || saving}
                          onChange={() => toggleSizeOpen(i)}
                          style={{ width: 18, height: 18, cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 18, fontWeight: 700 }}>
                          Talla {r.talla}
                          {r.label ? <span style={{ color: "#6b6b64", fontWeight: 600 }}> · {r.label}</span> : null}
                        </span>
                        {r.color ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a18", background: "#eceae2", borderRadius: 6, padding: "1px 8px" }}>
                            {r.color}
                          </span>
                        ) : null}
                        {r.customerPo ? (
                          <span style={{ fontSize: 12, color: "#6b6b64" }}>PO: <b>{r.customerPo}</b></span>
                        ) : null}
                        <span style={{ fontSize: 13, color: "#6b6b64" }}>
                          Asignado: <b>{r.assigned}</b> pzs · Restante: <b style={{ color: r.merchantQty > 0 ? "#b45309" : "#16a34a" }}>{r.merchantQty}</b> pzs
                        </span>
                      </label>

                      {r.open && (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, color: "#1a1a18", fontWeight: 600 }}>Cantidad a enviar</span>
                            <NumberField
                              min={0}
                              value={r.sendQty}
                              autoFocus
                              disabled={saving}
                              onChangeNumber={(n) => setSendQty(i, n)}
                              style={{
                                width: 110, padding: "8px 10px", fontSize: 18, fontWeight: 700, textAlign: "right",
                                border: st.over ? "1px solid #c0392b" : "1px solid #1a1a18", borderRadius: 8, background: "#fff",
                              }}
                            />
                            <span style={{ fontSize: 13, color: "#6b6b64" }}>pzs</span>
                            <button
                              onClick={() => setSendQty(i, r.merchantQty)}
                              disabled={saving}
                              style={{ background: "transparent", border: "none", color: "#1a1a18", fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                            >
                              Todo el restante ({r.merchantQty})
                            </button>
                          </div>
                          <div style={{ marginTop: 8, fontSize: 12, color: st.over ? "#c0392b" : "#4b7a3a", fontWeight: 600 }}>
                            {st.over
                              ? `Excede por ${st.qty - r.merchantQty} pzs — máximo ${r.merchantQty}`
                              : `Quedarán ${st.after} pzs por enviar de esta talla`}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {ticketBuilder.error && (
                <div style={{ margin: "0 16px 8px", fontSize: 12, fontWeight: 600, color: "#c0392b", background: "#fff5f5", border: "1px solid #f0c9c4", borderRadius: 8, padding: "8px 10px" }}>
                  {ticketBuilder.error}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 8px", flexWrap: "wrap" }}>
                <button
                  onClick={clearAll}
                  disabled={saving}
                  style={{ background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  Limpiar selección
                </button>
                <span style={{ fontSize: 12, color: "#6b6b64", marginLeft: "auto" }}>
                  {readyRows} talla{readyRows === 1 ? "" : "s"} · {totalToSend} pzs a enviar
                </span>
              </div>

              <div style={{ display: "flex", gap: 10, padding: "8px 16px 16px", position: "sticky", bottom: 0, background: "#fff" }}>
                <button
                  onClick={() => setTicketBuilder(null)}
                  disabled={saving}
                  style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={generateTickets}
                  disabled={!canSave}
                  style={{
                    flex: 2, background: canSave ? "#1a1a18" : "#c9c9c2", color: "#fff",
                    border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700,
                    cursor: canSave ? "pointer" : "not-allowed",
                  }}
                >
                  {saving ? "Generando…" : `🎫 Generar ticket${readyRows === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ============ GENERATED TICKETS (preview + print) ============ */}
      {tickets && tickets.length > 0 && (
        <div
          onClick={closeTickets}
          className="no-print"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 380, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
          >
            {/* Aviso: pendiente de guardar / guardado / error */}
            {!ticketsConfirmed && !ticketConfirmMsg && (
              <div
                style={{
                  marginBottom: 10, fontSize: 12, fontWeight: 600, color: "#8a5a00",
                  background: "#fff8e6", border: "1px solid #f1dca8", borderRadius: 8, padding: "8px 10px",
                }}
              >
                Revisa los tickets y guárdalos para registrar el envío. Puedes compartirlos o descargarlos (JPG / ZPL) antes de guardar.
              </div>
            )}
            {ticketConfirmMsg && (
              <div
                style={{
                  marginBottom: 10, fontSize: 12, fontWeight: 600,
                  color: ticketsConfirmed ? "#2f5d24" : "#c0392b",
                  background: ticketsConfirmed ? "#eef5ea" : "#fff5f5",
                  border: `1px solid ${ticketsConfirmed ? "#cfe3c6" : "#f0c9c4"}`,
                  borderRadius: 8, padding: "8px 10px",
                }}
              >
                {ticketConfirmMsg}
              </div>
            )}

            {!ticketsConfirmed ? (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={saveTickets}
                  disabled={ticketSaving}
                  style={{
                    flex: 2, background: ticketSaving ? "#c9c9c2" : "#1f6f43", color: "#fff", border: "none",
                    borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700,
                    cursor: ticketSaving ? "not-allowed" : "pointer",
                  }}
                >
                  {ticketSaving ? "Guardando…" : `💾 Guardar (${tickets.reduce((a, t) => a + (Number(t.qty) || 0), 0)} pzs)`}
                </button>
                <button
                  onClick={editTicketDraft}
                  disabled={ticketSaving}
                  title="Volver a cambiar tallas o cantidades"
                  style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  ✏️ Editar
                </button>
                <button
                  onClick={closeTickets}
                  disabled={ticketSaving}
                  style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  onClick={printAllTickets}
                  style={{ flex: 2, background: "#1a1a18", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
                >
                  🖨️ Imprimir todo ({tickets.length})
                </button>
                <button
                  onClick={() => { setTickets(null); openTicketBuilder(); }}
                  title="Registrar otro envío al almacén"
                  style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  + Nuevo envío
                </button>
                <button
                  onClick={closeTickets}
                  style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                >
                  Cerrar
                </button>
              </div>
            )}

            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingBottom: 8 }}>
              {tickets.map((t, i) => {
                const elId = `print-ticket-${i}`;
                return (
                  <div key={i}>
                    <div
                      id={elId}
                      style={{
                        background: "#fff", border: "1px solid #d8d8d2", borderRadius: 10, overflow: "hidden",
                        fontFamily: "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif", color: "#1a1a18",
                      }}
                    >
                      <div style={{ background: "#1a1a18", color: "#fff", padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#c9c9c2" }}>TICKET DE PRODUCCIÓN</div>
                        <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{t.workOrderNo}</div>
                        {t.ticketNo && (
                          <div style={{ fontSize: 12, color: "#e6e6df", marginTop: 2, fontFamily: "monospace" }}>{t.ticketNo}</div>
                        )}
                      </div>

                      <div style={{ padding: "14px 16px" }}>
                        {[
                          ["Estilo", t.style],
                          ["Línea", t.line],
                          ["Fecha", t.date],
                          ["Talla", t.label ? `${t.talla} · ${t.label}` : t.talla],
                          ["Color", t.color || "—"],
                          ["PO Cliente", t.customerPo || "—"],
                        ].map(([k, v], idx, arr) => (
                          <div
                            key={k}
                            style={{
                              display: "flex", justifyContent: "space-between", padding: "7px 0",
                              fontSize: 13, borderBottom: idx < arr.length - 1 ? "1px solid #eee" : "none",
                            }}
                          >
                            <span style={{ color: "#6b6b64" }}>{k}</span>
                            <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
                          </div>
                        ))}

                        <div style={{ margin: "14px 0", background: "#f4f4ef", borderRadius: 8, padding: 12, textAlign: "center" }}>
                          <div style={{ fontSize: 11, letterSpacing: 1, color: "#6b6b64" }}>CANTIDAD</div>
                          <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>{t.qty}</div>
                          <div style={{ fontSize: 12, color: "#6b6b64" }}>piezas</div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 4 }}>
                          <div style={{ border: "1px solid #e2e2dc", borderRadius: 8, padding: 8 }}>
                            {t.qrDataUrl && <img src={t.qrDataUrl} width={150} height={150} alt="QR" />}
                          </div>
                          <div style={{ fontSize: 11, color: "#9a9a92", marginTop: 8 }}>
                            Ticket {t.seq}/{t.total} · Corrida #{t.runId}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => shareTicketImage(t, elId)}
                        style={{ flex: 2, background: "#1a1a18", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        📤 Compartir
                      </button>
                      <button
                        onClick={() => downloadTicketImage(t, elId)}
                        style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        🖼️ JPG
                      </button>
                      <button
                        onClick={() => downloadTicketZPL(t)}
                        style={{ flex: 1, background: "#fff", color: "#1a1a18", border: "1px solid #d8d8d2", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        🏷️ ZPL
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// Campo numérico editable que SÍ se puede borrar. Los inputs controlados atados a
// un número no permiten dejar el campo vacío (al borrar el "0"/"1" vuelve solo),
// lo que causa cosas como "070". Este componente mantiene el texto mientras se
// edita (permitiendo vacío), entrega SIEMPRE un número al modelo, y al salir
// normaliza al mínimo. Al enfocar selecciona todo, así escribir reemplaza.
function NumberField({ value, onChangeNumber, min = 0, style, ...props }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value == null ? "" : String(value));
  }, [value]);

  const commit = (raw) => {
    const digits = String(raw).replace(/[^\d]/g, "");
    if (digits === "") return min;
    return Math.max(min, parseInt(digits, 10));
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      style={style}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        setText(digits);                 // permite quedar vacío mientras se escribe
        onChangeNumber(commit(digits));  // el modelo siempre recibe un número
      }}
      onBlur={(e) => {
        focused.current = false;
        const n = commit(e.target.value);
        setText(String(n));              // al salir, muestra el número normalizado
        onChangeNumber(n);
      }}
    />
  );
}