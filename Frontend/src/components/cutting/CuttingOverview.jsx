// components/cutting/CuttingOverview.jsx
//
// Primera pestaña ("Dashboard") de la pantalla de corte: una sola gráfica de
// barras con el eje agrupado por Día, Mes o Año.
//
//   Día      -> MARCADAS COMPLETADAS por día, según el día en que se completó
//               cada marcada (marker.completedAt, en hora de la planta), con el
//               detalle de qué orden de corte / work order las tenía.
//   Mes/Año  -> Asignado vs Cortado, agrupado por cut_date (fecha de la orden).
//
// Lee el mismo endpoint que el monitor del CEO (/api/cut-orders/analytics) y
// hace el agrupado en el cliente sobre `byDay`, así que no hace falta tocar el
// SQL: el backend ya devuelve una fila por cut_date dentro del rango pedido.
//
//   Día  -> un mes a la vez, una barra por día
//   Mes  -> un año a la vez, una barra por mes
//   Año  -> los últimos 6 años, una barra por año
//
// Las flechas mueven el periodo; "Hoy" regresa al periodo actual.
//
// NOTA de permisos: /api/cut-orders/analytics valida ALLOWED_ROLES en
// cut-order-analytics.js. Agrega ahí el rol de corte o esta pantalla recibirá
// 403 (ver el mensaje de error que muestra el componente).

import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (v) => {
  if (v == null || isNaN(v)) return '0';
  return Math.round(Number(v)).toLocaleString();
};
const pct = (v) => `${Math.round(Number(v) || 0)}%`;

const pad = (n) => String(n).padStart(2, '0');

const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Cuántos años muestra la vista "Año".
const YEAR_SPAN = 6;

const GRANS = [
  { id: 'day', label: 'Día' },
  { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' },
];

const cutNo = (id) => `CORTE-${String(id).padStart(4, '0')}`;
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// Rango que se le pide al API para el periodo actual.
function rangeFor(gran, { y, m }) {
  if (gran === 'day') {
    return {
      startDate: `${y}-${pad(m + 1)}-01`,
      endDate: `${y}-${pad(m + 1)}-${pad(daysInMonth(y, m))}`,
    };
  }
  if (gran === 'month') {
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }
  return { startDate: `${y - YEAR_SPAN + 1}-01-01`, endDate: `${y}-12-31` };
}

// Eje completo del periodo, para que los días/meses sin corte salgan en cero
// en vez de desaparecer de la gráfica.
function bucketsFor(gran, { y, m }) {
  if (gran === 'day') {
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => {
      const d = i + 1;
      return {
        key: `${y}-${pad(m + 1)}-${pad(d)}`,
        name: pad(d),
        full: `${d} de ${MES_LARGO[m]} ${y}`,
      };
    });
  }
  if (gran === 'month') {
    return MES_CORTO.map((name, i) => ({
      key: `${y}-${pad(i + 1)}`,
      name,
      full: `${MES_LARGO[i]} ${y}`,
    }));
  }
  return Array.from({ length: YEAR_SPAN }, (_, i) => {
    const yy = y - YEAR_SPAN + 1 + i;
    return { key: String(yy), name: String(yy), full: `Año ${yy}` };
  });
}

// A qué barra pertenece una fecha "YYYY-MM-DD" del API.
const bucketKey = (gran, ymd) =>
  gran === 'day' ? ymd : gran === 'month' ? ymd.slice(0, 7) : ymd.slice(0, 4);

// ---------------------------------------------------------------------------
// UI chica
// ---------------------------------------------------------------------------

function Kpi({ label, value, sub, tone = 'gray' }) {
  const tones = {
    indigo: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    teal: 'bg-gradient-to-br from-teal-500 to-cyan-600 text-white',
    gray: 'bg-white text-gray-900 border border-gray-200',
  };
  const grad = tone !== 'gray';
  return (
    <div className={`rounded-xl shadow-sm px-3 py-2 flex flex-col justify-center ${tones[tone]}`}>
      <p className={`text-[10px] font-medium uppercase tracking-wide leading-none ${grad ? 'text-white/80' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className="text-xl xl:text-2xl font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className={`text-[10px] leading-none mt-0.5 ${grad ? 'text-white/80' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  );
}

// Tooltip de la vista Día: cuántas marcadas se completaron y de qué órdenes.
function CompletedTooltip({ active, payload }) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  const orders = p.orders || [];
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm px-3 py-2 text-xs max-w-[280px]">
      <p className="font-semibold text-gray-800">{p.full}</p>
      {p.marcadas > 0 ? (
        <>
          <p className="text-gray-600 mt-0.5">
            {plural(p.marcadas, 'marcada completada', 'marcadas completadas')} · {fmt(p.pieces)} pzs
          </p>
          <ul className="mt-1 space-y-0.5">
            {orders.slice(0, 5).map((o) => (
              <li key={o.cut_order_id} className="text-gray-500">
                <span className="font-mono text-gray-700">{cutNo(o.cut_order_id)}</span>
                {o.group_no && <span className="text-indigo-600"> · {o.group_no}</span>}
                {o.work_order_no ? ` · ${o.work_order_no}` : ''} · {o.marcadas}
              </li>
            ))}
            {orders.length > 5 && <li className="text-gray-400">+{orders.length - 5} órdenes más</li>}
          </ul>
        </>
      ) : (
        <p className="text-gray-400 mt-0.5">Sin marcadas completadas</p>
      )}
    </div>
  );
}

// Lista del día seleccionado: una fila por orden de corte con sus marcadas.
function DayDetail({ day }) {
  if (!day) return null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-800">{day.full}</h3>
        <span className="text-[11px] text-gray-500">
          {plural(day.marcadas, 'marcada', 'marcadas')}
          {day.trazos > 0 && day.trazos < day.marcadas ? ` (${plural(day.trazos, 'trazo', 'trazos')} en mesa)` : ''}
          {' · '}{plural(day.orders.length, 'orden', 'órdenes')} · {fmt(day.pieces)} pzs
        </span>
      </div>
      {day.orders.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-gray-400">No se completó ninguna marcada este día.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Orden de corte</th>
                <th className="px-3 py-1.5 font-medium">Work order</th>
                <th className="px-3 py-1.5 font-medium">Marcadas completadas</th>
                <th className="px-3 py-1.5 font-medium text-right">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {day.orders.map((o) => (
                <tr key={o.cut_order_id} className="border-t border-gray-50 align-top">
                  <td className="px-3 py-1.5 font-mono font-medium text-gray-900 whitespace-nowrap">
                    {cutNo(o.cut_order_id)}
                    {o.group_no && (
                      <span
                        className="block w-fit mt-0.5 text-[10px] font-sans font-medium rounded-full px-1.5 py-0.5 bg-indigo-100 text-indigo-700"
                        title="Se cortó junto con otras órdenes del mismo grupo"
                      >
                        {o.group_no}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">
                    {o.work_order_no || '—'}
                    <span className="block text-[10px] text-gray-400">
                      {[o.customer_po && `PO ${o.customer_po}`, o.customer_name].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-700">
                    <span className="font-semibold text-gray-900">{o.marcadas}</span>
                    <span className="text-gray-500"> · {o.markers.join(', ')}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{fmt(o.pieces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function CuttingOverview() {
  const now = new Date();

  const [gran, setGran] = useState('day');
  const [anchor, setAnchor] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Día elegido en la vista Día (clic en la barra). null = el último con datos.
  const [selDay, setSelDay] = useState(null);

  const { startDate, endDate } = useMemo(() => rangeFor(gran, anchor), [gran, anchor]);

  // Al cambiar de granularidad regresamos al periodo actual: cambiar de "Mes"
  // a "Día" en un año viejo dejaría al usuario en un mes sin datos.
  const setGranularity = (id) => {
    setGran(id);
    setAnchor({ y: now.getFullYear(), m: now.getMonth() });
  };

  const shift = (dir) => {
    setAnchor((a) => {
      if (gran === 'day') {
        const total = a.y * 12 + a.m + dir;
        return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
      }
      if (gran === 'month') return { ...a, y: a.y + dir };
      return { ...a, y: a.y + dir * YEAR_SPAN };
    });
  };

  const atPresent =
    gran === 'day'
      ? anchor.y === now.getFullYear() && anchor.m === now.getMonth()
      : anchor.y >= now.getFullYear();

  const periodLabel =
    gran === 'day'
      ? `${MES_LARGO[anchor.m]} ${anchor.y}`
      : gran === 'month'
        ? String(anchor.y)
        : `${anchor.y - YEAR_SPAN + 1} – ${anchor.y}`;

  const fetchData = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // slim=1 le pide al backend que omita el arreglo `detail`; si aún no está
      // implementado el parámetro se ignora sin romper nada.
      const params = new URLSearchParams({ startDate, endDate, slim: '1' });
      const res = await axios.get(`http://localhost:5000/api/cut-orders/analytics?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Un 200 que no trae JSON significa que la petición nunca llegó al
      // endpoint: casi siempre la ruta no está registrada en server.js, quedó
      // después del catch-all que sirve index.html, o falta el proxy /api del
      // dev server. Lo separamos para no mostrar un error genérico.
      if (typeof res.data !== 'object' || res.data === null) {
        console.error('[CuttingOverview] respuesta no-JSON de http://localhost:5000/api/cut-orders/analytics:', res.data);
        setError('http://localhost:5000/api/cut-orders/analytics no está devolviendo JSON. Registra registerCutOrderAnalytics(app, …) en server.js antes del catch-all que sirve index.html (o revisa el proxy /api del dev server).');
        return;
      }
      if (res.data.success) setData(res.data);
      else setError(res.data.error || 'No se pudo cargar la información de corte.');
    } catch (err) {
      const st = err.response?.status;
      console.error('[CuttingOverview] falló /api/cut-orders/analytics:', st, err.response?.data || err.message);
      setError(
        st === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
        : st === 403 ? 'Tu usuario no tiene permiso para ver estas gráficas. Agrega tu rol a ALLOWED_ROLES en cut-order-analytics.js.'
        : st === 404 ? 'La ruta /api/cut-orders/analytics no existe (404). Falta registrarla en server.js.'
        : err.response?.data?.error || err.message
      );
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // byDay -> barras del periodo. Asignado = piezas planeadas, Cortado = piezas
  // ya cortadas (el backend usa amount_cut / size_progress).
  const chartData = useMemo(() => {
    const buckets = bucketsFor(gran, anchor);
    const totals = new Map();
    for (const d of data?.byDay || []) {
      if (!d.day) continue;
      const k = bucketKey(gran, d.day);
      const cur = totals.get(k) || { asignado: 0, cortado: 0 };
      cur.asignado += Number(d.quantity) || 0;
      cur.cortado += Number(d.cut) || 0;
      totals.set(k, cur);
    }
    return buckets.map((b) => ({
      ...b,
      asignado: totals.get(b.key)?.asignado || 0,
      cortado: totals.get(b.key)?.cortado || 0,
    }));
  }, [data, gran, anchor]);

  // Vista Día: marcadas completadas por día (byCompletedDay del backend).
  const completedData = useMemo(() => {
    if (gran !== 'day') return [];
    const byKey = new Map((data?.byCompletedDay || []).map((d) => [d.day, d]));
    return bucketsFor('day', anchor).map((b) => {
      const d = byKey.get(b.key);
      return { ...b, marcadas: d?.marcadas || 0, trazos: d?.trazos || 0, pieces: d?.pieces || 0, orders: d?.orders || [] };
    });
  }, [data, gran, anchor]);

  // Al cambiar de mes se olvida el día elegido.
  useEffect(() => { setSelDay(null); }, [gran, anchor]);

  const selectedDay = useMemo(() => {
    if (gran !== 'day') return null;
    if (selDay) return completedData.find((d) => d.key === selDay) || null;
    return [...completedData].reverse().find((d) => d.marcadas > 0) || null;
  }, [completedData, selDay, gran]);

  const hasData = gran === 'day'
    ? completedData.some((d) => d.marcadas > 0)
    : chartData.some((d) => d.asignado > 0 || d.cortado > 0);

  const s = data?.summary || {};
  const asignado = Number(s.total_quantity) || 0;
  const cortado = Number(s.total_cut) || 0;
  const avance = asignado > 0 ? Math.min(Math.round((cortado / asignado) * 100), 100) : 0;

  return (
    <div className="space-y-3">

      {/* Controles: granularidad + navegación del periodo */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {GRANS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                gran === g.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-0.5">
            <button
              onClick={() => shift(-1)}
              aria-label="Periodo anterior"
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-2 text-sm font-medium text-gray-800 min-w-[110px] text-center whitespace-nowrap">
              {periodLabel}
            </span>
            <button
              onClick={() => shift(1)}
              disabled={atPresent}
              aria-label="Periodo siguiente"
              className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {!atPresent && (
            <button
              onClick={() => setAnchor({ y: now.getFullYear(), m: now.getMonth() })}
              className="px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition"
            >
              Hoy
            </button>
          )}

          <button
            onClick={fetchData}
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-gray-700 transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Totales del periodo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gran === 'day' ? (
          <>
            <Kpi label="Marcadas completadas" value={fmt(s.completed_marcadas_in_range)}
              sub={`en ${plural(s.completed_marcadas_orders || 0, 'orden', 'órdenes')}${
                s.completed_trazos_in_range && s.completed_trazos_in_range < (s.completed_marcadas_in_range || 0)
                  ? ` · ${plural(s.completed_trazos_in_range, 'trazo', 'trazos')} en mesa` : ''}`} tone="indigo" />
            <Kpi label="Piezas completadas" value={fmt(s.completed_pieces_in_range)} sub="en esas marcadas" tone="teal" />
            <Kpi label="Asignado" value={fmt(asignado)} sub={`${fmt(s.total_orders)} órdenes creadas en el mes`} />
            <Kpi label="Por cortar" value={fmt(s.total_remaining)} sub={`${fmt(s.in_progress_orders)} en proceso`} />
          </>
        ) : (
          <>
            <Kpi label="Asignado" value={fmt(asignado)} sub={`${fmt(s.total_orders)} órdenes`} tone="indigo" />
            <Kpi label="Cortado" value={fmt(cortado)} sub={pct(avance)} tone="teal" />
            <Kpi label="Por cortar" value={fmt(s.total_remaining)} sub={`${fmt(s.in_progress_orders)} en proceso`} />
            <Kpi label="Terminadas" value={fmt(s.completed_orders)}
              sub={`${fmt(s.total_marcadas)} marcadas${s.groups_count ? ` · ${plural(s.groups_count, 'grupo', 'grupos')}` : ''}`} />
          </>
        )}
      </div>

      {/* Gráfica */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className="text-sm font-bold text-gray-800">
            {gran === 'day' ? 'Marcadas completadas' : 'Asignado vs Cortado'}
          </h3>
          <span className="text-[11px] text-gray-400">
            {gran === 'day'
              ? 'por día en que se completaron · clic en un día para ver el detalle'
              : `${gran === 'month' ? 'por mes' : 'por año'} · piezas`}
          </span>
        </div>

        <div className="relative h-[46vh] min-h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            {gran === 'day' ? (
              <BarChart
                data={completedData}
                margin={{ top: 6, right: 6, left: -14, bottom: 0 }}
                onClick={(st) => {
                  const k = st?.activePayload?.[0]?.payload?.key;
                  if (k) setSelDay(k);
                }}
                className="cursor-pointer"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} height={26} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <Tooltip content={<CompletedTooltip />} cursor={{ fill: '#f3f4f6' }} />
                <Bar name="Marcadas completadas" dataKey="marcadas" radius={[4, 4, 0, 0]}>
                  {completedData.map((d) => (
                    <Cell key={d.key} fill={d.key === selectedDay?.key ? '#4338ca' : '#818cf8'} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
            <BarChart data={chartData} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: gran === 'day' ? 9 : 11 }}
                interval={gran === 'day' ? 'preserveStartEnd' : 0}
                height={26}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
              <Tooltip
                formatter={(v, n) => [fmt(v), n]}
                labelFormatter={(l, p) => p?.[0]?.payload?.full || l}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
              <Bar name="Asignado" dataKey="asignado" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar name="Cortado" dataKey="cortado" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
            )}
          </ResponsiveContainer>

          {(loading && !data) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-gray-400">
              Cargando…
            </div>
          )}
          {(!loading && !error && !hasData) && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
              {gran === 'day'
                ? `No se completaron marcadas en ${periodLabel}`
                : `No hay cortes registrados en ${periodLabel}`}
            </div>
          )}
        </div>
      </div>

      {gran === 'day' && <DayDetail day={selectedDay} />}
    </div>
  );
}