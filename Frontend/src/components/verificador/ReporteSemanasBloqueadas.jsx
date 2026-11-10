import { useEffect, useMemo, useState } from "react";

// Mismo estilo que fetchJson de Verificadorpage.jsx: rutas relativas /api/...
// (el proxy de vite.config.js las manda al backend) y token Bearer de
// localStorage.
const getToken = () => localStorage.getItem("token");

async function apiGet(url) {
  const token = getToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("No tienes permiso o tu sesión expiró. Inicia sesión de nuevo.");
  }
  if (res.status === 404) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `La ruta ${url} no existe en el servidor (404). ¿Registraste verificador-report.js?`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${url} devolvió HTML en vez de JSON. Revisa el proxy de /api en vite.config.js.`);
  }
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `El servidor respondió ${res.status}`);
  }
  return data;
}

async function downloadFile(url, filename) {
  const token = getToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

// ---------------------------------------------------------------------------
const fmt = (n, d = 0) =>
  n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: d });
const pct = (n) => (n == null ? "—" : `${fmt(n, 1)}%`);

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const shortDate = (s) => {
  const [, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const weekLabel = (w) =>
  `Semana ${w.iso_week} · ${shortDate(w.week_start)} – ${shortDate(w.week_end)} ${w.week_end.slice(0, 4)}`;
const safeName = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "_");

function pctColor(v) {
  if (v == null) return "text-gray-500";
  if (v >= 100) return "text-green-700";
  if (v >= 85) return "text-amber-700";
  return "text-red-700";
}

const selectCls =
  "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600";

export default function ReporteSemanasBloqueadas() {
  const [weeks, setWeeks] = useState([]);
  const [loadingWeeks, setLoadingWeeks] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null); // objeto semana
  const [customer, setCustomer] = useState(""); // "" = todos
  const [style, setStyle] = useState(""); // "" = todos
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiGet("http://localhost:5000/api/verificador/locked-weeks");
        if (!alive) return;
        const list = data.weeks || [];
        setWeeks(list);
        if (list.length) setSelected(list[0]);
        if (list.some((w) => !/^\d{4}-\d{2}-\d{2}$/.test(w?.week_start || ""))) {
          console.warn("locked-weeks devolvió semanas sin week_start válido:", list);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoadingWeeks(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Solo se pide el reporte con una semana válida (YYYY-MM-DD).
  const validWeek = /^\d{4}-\d{2}-\d{2}$/.test(selected?.week_start || "");

  const query = useMemo(() => {
    if (!selected || !/^\d{4}-\d{2}-\d{2}$/.test(selected.week_start || "")) return "";
    const p = new URLSearchParams({ week: selected.week_start });
    if (customer) p.set("customer", customer);
    if (style) p.set("style", style);
    return p.toString();
  }, [selected, customer, style]);

  useEffect(() => {
    if (!query) return;
    let alive = true;
    setLoadingReport(true);
    setError("");
    apiGet(`http://localhost:5000/api/verificador/production-report?${query}&format=json`)
      .then((data) => alive && setReport(data))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoadingReport(false));
    return () => {
      alive = false;
    };
  }, [query]);

  // Al cambiar de semana, los filtros se limpian (otra semana = otros clientes/estilos).
  const pickWeek = (w) => {
    setSelected(w);
    setCustomer("");
    setStyle("");
    setReport(null);
  };

  // Estilos disponibles: si hay cliente elegido, solo los de ese cliente.
  const styleOptions = useMemo(() => {
    const all = report?.options?.styles || [];
    return customer ? all.filter((s) => s.customer_name === customer) : all;
  }, [report, customer]);

  const changeCustomer = (c) => {
    setCustomer(c);
    // Si el estilo elegido no es de ese cliente, se suelta.
    const st = (report?.options?.styles || []).find((s) => s.style === style);
    if (c && st && st.customer_name !== c) setStyle("");
  };

  const handleDownload = async () => {
    if (!validWeek || !query) return;
    setDownloading(true);
    setError("");
    try {
      const tag = `${selected.iso_year}-W${String(selected.iso_week).padStart(2, "0")}`;
      const name = `${safeName(customer || "All")}_Production_Report_${tag}${style ? `_${safeName(style)}` : ""}.xlsx`;
      await downloadFile(`http://localhost:5000/api/verificador/production-report?${query}&format=xlsx`, name);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  // ---------------------------------------------------------------- render --
  if (loadingWeeks) {
    return <p className="max-w-7xl mx-auto px-6 py-10 text-gray-600">Cargando semanas bloqueadas…</p>;
  }

  if (!weeks.length) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10">
        {error ? (
          <p className="text-red-700">{error}</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900">Aún no hay semanas bloqueadas</h2>
            <p className="mt-1 text-gray-600">
              El reporte se habilita cuando el CEO bloquea una semana en el Plan Board.
            </p>
          </div>
        )}
      </div>
    );
  }

  const t = report?.totals;
  const rows = report?.rows || [];
  const filtered = !!(customer || style);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
      {/* Lista de semanas */}
      <aside>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Semanas bloqueadas</h2>
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
          {weeks.map((w) => {
            const active = selected?.week_start === w.week_start;
            return (
              <li key={w.week_start}>
                <button
                  onClick={() => pickWeek(w)}
                  className={`w-full text-left px-4 py-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-600 ${
                    active ? "bg-gray-900 text-white" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <span aria-hidden>🔒</span>
                    Semana {w.iso_week}
                  </span>
                  <span className={`block text-sm ${active ? "text-gray-300" : "text-gray-500"}`}>
                    {shortDate(w.week_start)} – {shortDate(w.week_end)} {w.week_end.slice(0, 4)}
                  </span>
                  <span className={`block text-xs mt-1 ${active ? "text-green-300" : "text-gray-500"}`}>
                    {w.runs ? `${fmt(w.produced)} pzas en ${w.lines} líneas` : "Sin capturas"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Detalle */}
      <section className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{selected && weekLabel(selected)}</h2>
            <p className="text-sm text-gray-600">
              Producido = piezas de las operaciones de empaque/terminado.
            </p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading || loadingReport || !rows.length}
            className="px-4 py-2 rounded-md bg-gray-900 text-white font-medium cursor-pointer hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          >
            {downloading ? "Generando Excel…" : "Descargar reporte (Excel)"}
          </button>
        </div>

        {/* Filtros */}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end bg-white border border-gray-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700">
            Cliente
            <select value={customer} onChange={(e) => changeCustomer(e.target.value)} className={selectCls}>
              <option value="">Todos los clientes</option>
              {(report?.options?.customers || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Estilo
            <select value={style} onChange={(e) => setStyle(e.target.value)} className={selectCls}>
              <option value="">Todos los estilos</option>
              {styleOptions.map((s) => (
                <option key={s.style} value={s.style}>
                  {s.style}
                  {s.client_style ? ` · ${s.client_style}` : ""}
                  {!customer && s.customer_name ? ` (${s.customer_name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              setCustomer("");
              setStyle("");
            }}
            disabled={!filtered}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 cursor-pointer hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Quitar filtros
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-800">{error}</p>
        )}

        {loadingReport && !report && <p className="mt-6 text-gray-600">Cargando reporte…</p>}

        {report && t && (
          <div className={loadingReport ? "opacity-60 transition-opacity" : ""}>
            <dl className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-white p-4">
                <dt className="text-sm text-gray-600">Producido</dt>
                <dd className="text-2xl font-semibold text-gray-900">{fmt(t.produced)}</dd>
              </div>
              <div className="bg-white p-4">
                <dt className="text-sm text-gray-600">Meta</dt>
                <dd className="text-2xl font-semibold text-gray-900">{fmt(t.target)}</dd>
              </div>
              <div className="bg-white p-4">
                <dt className="text-sm text-gray-600">Cumplimiento</dt>
                <dd className={`text-2xl font-semibold ${pctColor(t.fulfillment_pct)}`}>
                  {pct(t.fulfillment_pct)}
                </dd>
              </div>
              <div className="bg-white p-4">
                <dt className="text-sm text-gray-600">Eficiencia</dt>
                <dd className="text-2xl font-semibold text-gray-900">{pct(t.efficiency_pct)}</dd>
              </div>
            </dl>

            {t.runs_without_order > 0 && (
              <p className="mt-4 rounded-md bg-orange-50 border border-orange-200 px-4 py-3 text-orange-900 text-sm">
                {t.runs_without_order} corrida(s) no tienen orden ligada. Salen en el reporte con el
                cliente y estilo de la última orden de ese estilo, y en el Excel van marcadas en rojo.
              </p>
            )}
            {t.runs_without_packing_op > 0 && (
              <p className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-amber-900 text-sm">
                {t.runs_without_packing_op} corrida(s) no tienen operación de empaque/terminado; su
                producido sale en 0 aunque la línea sí haya cosido. Revísalas en la pestaña de corrección.
              </p>
            )}

            {rows.length === 0 ? (
              <p className="mt-6 text-gray-600">
                {filtered ? "No hay producción con estos filtros en esta semana." : "No hay corridas capturadas en esta semana."}
              </p>
            ) : (
              <div className="mt-5 overflow-x-auto bg-white border border-gray-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 text-gray-700 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Fecha</th>
                      <th className="px-3 py-2 font-semibold">Línea</th>
                      <th className="px-3 py-2 font-semibold">Estilo</th>
                      <th className="px-3 py-2 font-semibold">Cliente</th>
                      <th className="px-3 py-2 font-semibold">Estilo cliente</th>
                      <th className="px-3 py-2 font-semibold">Orden</th>
                      <th className="px-3 py-2 font-semibold">Orden interna</th>
                      <th className="px-3 py-2 font-semibold text-right">Meta</th>
                      <th className="px-3 py-2 font-semibold text-right">Producido</th>
                      <th className="px-3 py-2 font-semibold text-right">Cumpl.</th>
                      <th className="px-3 py-2 font-semibold text-right">Efic.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r) => (
                      <tr key={r.run_id} className={r.has_packing_op ? "" : "bg-amber-50"}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.day} {shortDate(r.run_date)}
                        </td>
                        <td className="px-3 py-2">{r.line_no}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.style}</td>
                        <td className="px-3 py-2">{r.customer_name || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.client_style || "—"}</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${r.linked ? "" : "bg-orange-100 text-orange-900"}`}>
                          {r.work_order_no || "Sin orden"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.tech_pack_no || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.target)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.produced)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${pctColor(r.fulfillment_pct)}`}>
                          {pct(r.fulfillment_pct)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.efficiency_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}