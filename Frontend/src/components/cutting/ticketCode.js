// components/cutting/ticketCode.js
//
// Formato del código QR de los tickets de corte (uno por panel).
//
//   CORTE-0012|WO-1234|NAVY|138|Marcada 1|P3/5|k3j9x1a|12
//   └─ corte ─┘└─ WO ─┘└col┘└tal┘└marcada─┘└panel┘└id marc┘└pzs/panel┘
//
// El QR impreso es un ENLACE a la tarjeta del ticket:
//
//   https://<app>/corte/ticket?t=<código de arriba>
//
// Así, la cámara normal de cualquier celular abre una tarjeta pequeña con el
// ticket (TicketCard.jsx), y el escáner de la app (CutTicketScan.jsx) acepta
// tanto el enlace como el código solo.
//
// Tickets impresos antes de este cambio traen sólo "P3" (sin total), sin id de
// marcada y sin piezas; el escáner y la tarjeta completan esos datos desde la
// orden de corte.
//
// Lectores tipo teclado con una distribución distinta a la de la PC cambian
// símbolos ("|" → "}", "/" → "&", etc.). Por eso el parser toma como
// separador el carácter que venga justo después del número de corte, y en el
// panel acepta cualquier símbolo entre el número y el total.

// Ruta donde se monta <TicketCard />. Debe coincidir con el router de la app.
export const TICKET_CARD_PATH = "/corte/ticket";

const clean = (v) => String(v ?? "").replace(/[|\r\n]/g, "/").trim();

export const buildTicketCode = ({ cutId, workOrderNo, color, talla, marker, markerId, panelNo, panelCount, pieces }) =>
  [
    `CORTE-${String(cutId).padStart(4, "0")}`,
    clean(workOrderNo),
    clean(color),
    clean(talla),
    clean(marker),
    panelCount ? `P${panelNo || 1}/${panelCount}` : `P${panelNo || 1}`,
    clean(markerId),
    pieces != null && Number(pieces) > 0 ? String(Math.round(Number(pieces))) : "",
  ].join("|");

// Dirección PÚBLICA de la app: la que un celular puede abrir (IP de la PC en
// la red de la planta o el dominio real), p. ej. "http://192.168.1.50:3000".
// Se toma de REACT_APP_PUBLIC_APP_URL (o VITE_PUBLIC_APP_URL); si no hay, de la
// pestaña desde donde se imprime. NUNCA debe ser "localhost": en el celular
// "localhost" es el propio celular y sale "no se puede conectar al servidor".
const envUrl = (() => {
  try { if (typeof process !== "undefined" && process.env?.REACT_APP_PUBLIC_APP_URL) return process.env.REACT_APP_PUBLIC_APP_URL; } catch { /* sin process */ }
  try { if (import.meta?.env?.VITE_PUBLIC_APP_URL) return import.meta.env.VITE_PUBLIC_APP_URL; } catch { /* sin import.meta */ }
  return "";
})();

export const ticketBaseUrl = () =>
  (envUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");

// true si el QR quedaría apuntando a "localhost" (no abre en el celular).
export const ticketUrlIsLocal = () =>
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(ticketBaseUrl());

// Enlace que va dentro del QR.
export const buildTicketUrl = (fields, origin = ticketBaseUrl()) =>
  `${origin}${TICKET_CARD_PATH}?t=${encodeURIComponent(buildTicketCode(fields))}`;

// Acepta el código solo o el enlace completo (también escrito por un lector).
const extractCode = (input) => {
  let s = String(input ?? "").trim();
  try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch { /* ya venía decodificado */ }
  // "CORTE" + número (no la palabra "corte" de la ruta /corte/ticket).
  const m = s.match(/CORTE\W?\d+/i);
  return m ? s.slice(m.index).trim() : s;
};

// → { cutId, workOrderNo, color, talla, marker, markerId, panelNo, panelCount, pieces, raw }
// → null si el texto no parece un ticket de corte.
export const parseTicketCode = (input) => {
  const raw = extractCode(input);
  const head = raw.match(/^CORTE\W?(\d+)(\W)/i) || raw.match(/^CORTE\W?(\d+)$/i);
  if (!head) return null;
  const cutId = Number(head[1]);
  const sep = head[2];
  const empty = { workOrderNo: "", color: "", talla: "", marker: "", markerId: "", panelNo: null, panelCount: null, pieces: null };
  if (!sep) return { cutId, ...empty, raw };

  const parts = raw.split(sep);
  // El campo de panel es el último que se ve como "P<n>" o "P<n>?<total>".
  let pIdx = -1;
  for (let i = parts.length - 1; i >= 1; i--) {
    if (/^P\d+(\W\d+)?$/i.test(parts[i].trim())) { pIdx = i; break; }
  }
  const pm = pIdx >= 0 ? parts[pIdx].trim().match(/^P(\d+)(?:\W(\d+))?$/i) : null;
  const pcs = pIdx >= 0 ? Number((parts[pIdx + 2] || "").trim()) : NaN;
  return {
    cutId,
    workOrderNo: (parts[1] || "").trim(),
    color: (parts[2] || "").trim(),
    talla: (parts[3] || "").trim(),
    // Si el nombre de marcada traía el separador, se reúne todo hasta el panel.
    marker: pIdx > 4 ? parts.slice(4, pIdx).join(sep).trim() : (parts[4] || "").trim(),
    markerId: pIdx >= 0 ? (parts[pIdx + 1] || "").trim() : "",
    panelNo: pm ? Number(pm[1]) : null,
    panelCount: pm && pm[2] ? Number(pm[2]) : null,
    pieces: Number.isFinite(pcs) && pcs > 0 ? pcs : null,
    raw,
  };
};

// Clave única de un ticket físico (para detectar re-escaneos).
export const ticketKey = (t) =>
  [t.cutId, t.markerId || t.marker, t.talla, t.panelNo].map((v) => String(v ?? "").toUpperCase()).join("|");