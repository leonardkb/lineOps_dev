// lib/exportMasterCodes.js
// CSV export for master-code records. Zero dependencies.

// Column order + human-readable headers. Add/remove/reorder here in one place.
const COLUMNS = [
  { key: "code", label: "Código" },
  { key: "type", label: "Tipo" },
  { key: "modelo", label: "Modelo" },
  { key: "correlativo", label: "Correlativo" },
  { key: "talla", label: "Talla" },
  { key: "cliente", label: "Cliente" },
  { key: "color", label: "Color" },
  { key: "estilo", label: "Estilo" },
  { key: "description", label: "Descripción" },
  { key: "sam", label: "SAM (min)" },
  { key: "createdAt", label: "Creado" },
];

// Handle the field-name inconsistencies that exist in the data (type/tipo, sam/sam_minutes).
function normalizeRow(r) {
  return {
    code: r.code ?? "",
    type: r.type ?? r.tipo ?? "",
    modelo: r.modelo ?? "",
    correlativo: r.correlativo ?? "",
    talla: r.talla ?? "",
    cliente: r.cliente ?? "",
    color: r.color ?? "",
    estilo: r.estilo ?? "",
    description: r.description ?? "",
    sam: r.sam ?? r.sam_minutes ?? "",
    createdAt: r.createdAt ?? "",
  };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value, delimiter) {
  const s = value == null ? "" : String(value);
  // Quote if it contains the delimiter, quotes, or newlines. Double internal quotes.
  if (s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Export records to a CSV file (no dependencies).
 * @param {Array<Object>} records
 * @param {Object} [opts]
 * @param {string} [opts.delimiter=","]  Use ";" if your Spanish Excel splits columns wrong.
 * @param {string} [opts.filename]
 */
export function exportMasterCodesToCsv(records, { delimiter = ",", filename } = {}) {
  const rows = (records || []).map(normalizeRow);
  const header = COLUMNS.map((c) => csvEscape(c.label, delimiter)).join(delimiter);
  const body = rows
    .map((row) => COLUMNS.map((c) => csvEscape(row[c.key], delimiter)).join(delimiter))
    .join("\r\n");
  // Leading BOM so Excel opens UTF-8 (accents/ñ) correctly.
  const csv = "\uFEFF" + header + "\r\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename || `codigos-maestros_${timestamp()}.csv`);
}