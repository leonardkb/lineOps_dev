import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

// Fecha local YYYY-MM-DD. toISOString() usa UTC y en México cambia a "mañana"
// por la tarde, lo que mandaba las inspecciones nocturnas al día siguiente.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const NO_ORDER = 'none';

// 2026-10-06 -> 06/10/2026
const formatDay = (ymd) => ymd.split('-').reverse().join('/');

// Convierte la respuesta del servidor en órdenes con su lista de estilos.
// Solo estilos de producción (style_code, p. ej. DAMCHA03): primero las corridas
// del día; si aún no hay corrida ese día, la más reciente; si nunca ha corrido,
// el style_code de la orden. El estilo cliente (work_orders.estilo, p. ej.
// FN2809) no es un estilo de producción y no se muestra.
const toStyle = (r) => ({ style: r.style, run_id: r.run_id, target_pcs: r.target_pcs, operators_count: r.operators_count });
const buildOrders = (orders = [], unlinkedRuns = [], workDate) => {
  const list = orders.map((o) => {
    const runs = (o.runs || []).filter((r) => r.style);
    const dayRuns = runs.filter((r) => r.run_date === workDate);
    let styles;
    if (dayRuns.length > 0) {
      styles = dayRuns.map(toStyle);
    } else if (runs.length > 0) {
      const latest = runs.reduce((a, r) => (r.run_date > a.run_date ? r : a));
      styles = [toStyle(latest)];
    } else if (o.style_code) {
      styles = [{ style: o.style_code, run_id: null, target_pcs: null, operators_count: null }];
    } else {
      styles = [];
    }
    return {
      key: String(o.id),
      id: o.id,
      work_order_no: o.work_order_no,
      customer_name: o.customer_name,
      color: o.color,
      quantity: o.quantity,
      styles,
    };
  });
  if (unlinkedRuns.length > 0) {
    list.push({
      key: NO_ORDER,
      id: null,
      work_order_no: null,
      customer_name: null,
      styles: unlinkedRuns.map((r) => ({
        style: r.style, run_id: r.run_id, target_pcs: r.target_pcs, operators_count: r.operators_count,
      })),
    });
  }
  return list;
};

const QualityInspectorPage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [workDate, setWorkDate] = useState(todayStr()); // solo se muestran las órdenes de este día
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderKey, setSelectedOrderKey] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('');

  const [defectTypes, setDefectTypes] = useState([]);
  const [shiftSlot, setShiftSlot] = useState('');
  const [selectedDefectType, setSelectedDefectType] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [operatorNo, setOperatorNo] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionDefects, setSessionDefects] = useState([]);
  const [savedInspections, setSavedInspections] = useState([]);
  const [selectMode, setSelectMode] = useState(false);          // modo selección en "Guardado Hoy"
  const [selectedSavedIds, setSelectedSavedIds] = useState([]); // ids de inspecciones marcadas
  const [deleting, setDeleting] = useState(false);

  const defectTypeSelectRef = useRef(null);
  const pendingLineRestore = useRef(null); // última orden/estilo del usuario

  const getToken = () => localStorage.getItem('token');
  const authHeaders = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });
  const lastKey = (u) => `quality:last:${u?.id ?? 'anon'}`;

  const selectedOrder = useMemo(
    () => orders.find((o) => o.key === selectedOrderKey) || null,
    [orders, selectedOrderKey]
  );
  const styleInfo = useMemo(
    () => selectedOrder?.styles.find((s) => s.style === selectedStyle) || null,
    [selectedOrder, selectedStyle]
  );
  const ready = Boolean(selectedLine && selectedOrder && styleInfo);
  const contextLabel = selectedOrder
    ? `${selectedOrder.work_order_no ? `OT ${selectedOrder.work_order_no}` : 'Sin orden'}${selectedStyle ? ` · ${selectedStyle}` : ''}`
    : '';

  // ── Sesión del usuario ───────────────────────────────────────────────
  useEffect(() => {
    if (!getToken()) { navigate('/'); return; }
    axios.get('http://localhost:5000/api/me', authHeaders())
      .then((res) => {
        const u = res.data.user;
        setUser(u);
        try {
          const last = JSON.parse(localStorage.getItem(lastKey(u)) || 'null');
          if (last) {
            pendingLineRestore.current = last;
            if (last.shiftSlot) setShiftSlot(last.shiftSlot);
          }
        } catch { /* ignorar */ }
        fetchLines();
        fetchDefectTypes();
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recordar la última línea / orden / estilo / turno de cada inspector
  useEffect(() => {
    if (!user || !selectedLine) return;
    localStorage.setItem(lastKey(user), JSON.stringify({
      line: selectedLine, orderKey: selectedOrderKey, style: selectedStyle, shiftSlot,
    }));
  }, [user, selectedLine, selectedOrderKey, selectedStyle, shiftSlot]);

  const fetchLines = async () => {
    try {
      const response = await axios.get(`http://localhost:5000/api/quality/lines`, authHeaders());
      if (response.data.success) {
        setLines(response.data.lines);
        const last = pendingLineRestore.current;
        if (last?.line && response.data.lines.some((l) => l.line_no === last.line)) {
          setSelectedLine(last.line);
        } else {
          pendingLineRestore.current = null;
        }
      }
    } catch (error) {
      console.error('Error fetching lines:', error);
    }
  };

  const fetchDefectTypes = async () => {
    try {
      const response = await axios.get(`http://localhost:5000/api/quality/defect-types`, authHeaders());
      if (response.data.success) setDefectTypes(response.data.defectTypes);
    } catch (error) {
      console.error('Error fetching defect types:', error);
    }
  };

  // Si la página queda abierta después de medianoche, pasar al nuevo día
  useEffect(() => {
    const t = setInterval(() => {
      const now = todayStr();
      setWorkDate((prev) => (prev === now ? prev : now));
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // ── Órdenes de la línea (solo las del día) ──────────────────────────
  useEffect(() => {
    if (!selectedLine) { setOrders([]); setSelectedOrderKey(''); setSelectedStyle(''); return; }
    let cancelled = false;
    setOrdersLoading(true);
    axios.get(`http://localhost:5000/api/quality/lines/${selectedLine}/orders?date=${workDate}`, authHeaders())
      .then((res) => {
        if (cancelled || !res.data.success) return;
        const list = buildOrders(res.data.orders, res.data.unlinkedRuns, workDate);
        setOrders(list);

        // Restaurar la última selección del usuario, o tomar la única orden disponible
        const last = pendingLineRestore.current;
        pendingLineRestore.current = null;
        let order = null;
        if (last && last.line === selectedLine) order = list.find((o) => o.key === last.orderKey) || null;
        if (!order && list.length === 1) order = list[0];
        setSelectedOrderKey(order ? order.key : '');
        if (order) {
          const keepStyle = last && order.styles.some((s) => s.style === last.style) ? last.style : null;
          setSelectedStyle(keepStyle || (order.styles.length === 1 ? order.styles[0].style : ''));
        } else {
          setSelectedStyle('');
        }
      })
      .catch((error) => {
        console.error('Error fetching orders:', error);
        if (!cancelled) setOrders([]);
      })
      .finally(() => { if (!cancelled) setOrdersLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine, workDate]);

  // ── Historial de hoy del inspector para esta orden + estilo ──────────
  const fetchSaved = useCallback(async () => {
    if (!selectedLine || !selectedOrder || !selectedStyle) { setSavedInspections([]); return; }
    try {
      const params = new URLSearchParams({
        date: todayStr(),
        style: selectedStyle,
        workOrderId: selectedOrder.id ?? NO_ORDER,
      });
      const response = await axios.get(`http://localhost:5000/api/quality/inspections/${selectedLine}?${params}`, authHeaders());
      if (response.data.success) {
        const sorted = [...response.data.inspections].sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        setSavedInspections(sorted);
      }
    } catch (error) {
      console.error('Error fetching saved inspections:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLine, selectedOrder?.key, selectedStyle]);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  // Al cambiar de línea / orden / estilo se sale del modo selección
  useEffect(() => {
    setSelectMode(false);
    setSelectedSavedIds([]);
  }, [selectedLine, selectedOrderKey, selectedStyle]);

  // Quitar de la selección los registros que ya no están en la lista
  useEffect(() => {
    setSelectedSavedIds((prev) => prev.filter((id) => savedInspections.some((i) => i.id === id)));
    if (savedInspections.length === 0) setSelectMode(false);
  }, [savedInspections]);

  // ── Eliminar guardados ──────────────────────────────────────────────
  const allSavedSelected = savedInspections.length > 0 && selectedSavedIds.length === savedInspections.length;
  const selectedSavedTotal = savedInspections
    .filter((i) => selectedSavedIds.includes(i.id))
    .reduce((sum, i) => sum + (Number(i.total_defects) || 0), 0);

  const toggleSaved = (id) => {
    setSelectedSavedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleAllSaved = () => {
    setSelectedSavedIds(allSavedSelected ? [] : savedInspections.map((i) => i.id));
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedSavedIds([]);
  };

  const deleteSelectedSaved = async () => {
    if (selectedSavedIds.length === 0) return;
    const n = selectedSavedIds.length;
    if (!window.confirm(
      `¿Eliminar ${n} registro${n === 1 ? '' : 's'} guardado${n === 1 ? '' : 's'} (${selectedSavedTotal} defectos)?\n\nEsta acción no se puede deshacer.`
    )) return;
    setDeleting(true);
    try {
      const response = await axios.post(
        `http://localhost:5000/api/quality/inspections/bulk-delete`,
        { ids: selectedSavedIds },
        authHeaders()
      );
      const deleted = response.data.deletedCount ?? 0;
      showNotification(`🗑️ ${deleted} registro${deleted === 1 ? '' : 's'} eliminado${deleted === 1 ? '' : 's'}`);
      if (response.data.skippedCount > 0) {
        alert(`${response.data.skippedCount} registro(s) no se pudieron eliminar (no existen o no son tuyos).`);
      }
      exitSelectMode();
      await fetchSaved();
    } catch (error) {
      console.error('Error deleting inspections:', error);
      alert('Error al eliminar: ' + (error.response?.data?.error || error.message));
    } finally {
      setDeleting(false);
    }
  };

  const savedTotal = savedInspections.reduce((sum, i) => sum + (Number(i.total_defects) || 0), 0);
  const sessionTotal = sessionDefects.reduce((sum, d) => sum + d.quantity, 0);

  // ── Defectos ─────────────────────────────────────────────────────────
  const findType = (sortOrder) => defectTypes.find((t) => t.sort_order === parseInt(sortOrder));

  const getReasonsForType = () => {
    const type = selectedDefectType ? findType(selectedDefectType) : null;
    return type && Array.isArray(type.reasons) ? type.reasons : [];
  };

  const saveDefectsToServer = async (defects) => {
    if (!ready) throw new Error('Seleccione línea, orden y estilo');

    const validDefects = defects
      .map((d) => ({ ...d, defectTypeId: findType(d.defectTypeId)?.id ?? null }))
      .filter((d) => d.defectTypeId !== null);
    if (validDefects.length === 0) throw new Error('No hay defectos válidos para guardar');

    const payload = {
      lineNo: selectedLine,
      style: selectedStyle,
      workOrderId: selectedOrder.id,
      inspectionDate: todayStr(),
      shiftSlot: shiftSlot || 'General',
      totalCheckedQuantity: 0,
      notes: `${contextLabel} - ${validDefects.length} defectos`,
      defects: validDefects.map((d) => ({
        defectTypeId: d.defectTypeId,
        defectReasonId: d.defectReasonId,
        quantity: d.quantity,
        operatorNo: d.operatorNo,
        operationName: null,
        notes: d.notes,
      })),
    };

    const response = await axios.post(`http://localhost:5000/api/quality/inspection`, payload, authHeaders());
    return response.data;
  };

  const saveCurrentSession = async ({ silent = false } = {}) => {
    if (sessionDefects.length === 0) {
      if (!silent) alert('No hay defectos para guardar');
      return true;
    }
    setLoading(true);
    try {
      await saveDefectsToServer(sessionDefects);
      showNotification(`✅ ${sessionDefects.length} defectos guardados para ${contextLabel}`);
      setSessionDefects([]);
      await fetchSaved();
      return true;
    } catch (error) {
      alert('Error al guardar los defectos: ' + (error.response?.data?.error || error.message));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Antes de cambiar de línea, orden o estilo, los defectos pendientes se guardan
  // con el contexto actual para que nunca queden registrados en otra orden.
  const switchContext = async (apply) => {
    if (sessionDefects.length > 0 && ready) {
      const ok = await saveCurrentSession({ silent: true });
      if (!ok) return;
    }
    apply();
  };

  const resetForm = () => {
    setSelectedDefectType('');
    setSelectedReason('');
    setQuantity(1);
    setOperatorNo('');
    setNotes('');
    defectTypeSelectRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedLine) { alert('Por favor seleccione una línea'); return; }
    if (!selectedOrder) { alert('Por favor seleccione una orden'); return; }
    if (!styleInfo) { alert('Por favor seleccione un estilo'); return; }
    if (!selectedDefectType) { alert('Por favor seleccione un tipo de defecto'); return; }

    const type = findType(selectedDefectType);
    const reason = getReasonsForType().find((r) => String(r.id) === String(selectedReason));
    const newDefect = {
      id: Date.now(),
      defectTypeId: parseInt(selectedDefectType),
      defectReasonId: selectedReason ? parseInt(selectedReason) : null,
      typeLabel: type ? `${type.defect_code} - ${type.defect_name}` : '',
      reasonLabel: reason ? reason.reason_description : '',
      quantity: parseInt(quantity) || 1,
      operatorNo: operatorNo ? parseInt(operatorNo) : null,
      notes: notes || null,
    };

    const updatedSession = [...sessionDefects, newDefect];
    setSessionDefects(updatedSession);
    resetForm();

    // Guardado automático cada 20 defectos
    if (updatedSession.length >= 20) {
      setLoading(true);
      try {
        await saveDefectsToServer(updatedSession);
        setSessionDefects([]);
        showNotification(`✅ ${updatedSession.length} defectos guardados para ${contextLabel}`);
        await fetchSaved();
      } catch (error) {
        alert('Error al guardar los defectos: ' + (error.response?.data?.error || error.message));
      } finally {
        setLoading(false);
      }
    }
  };

  // Atajos: Ctrl+Enter = registrar, Esc = borrar formulario
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmit(); }
      else if (e.key === 'Escape') resetForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showNotification = (message) => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  const doLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  const handleLogout = async () => {
    if (sessionDefects.length > 0 &&
        window.confirm(`Tienes ${sessionDefects.length} defectos sin guardar. ¿Guardar antes de cerrar sesión?`)) {
      const ok = await saveCurrentSession({ silent: true });
      if (!ok) return;
    }
    doLogout();
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Encabezado */}
      <div className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 whitespace-nowrap">Inspección de Calidad</h1>
            {user && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded whitespace-nowrap" title={user.username}>
                👤 {user.full_name || user.username}
              </span>
            )}
            {sessionDefects.length > 0 && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded animate-pulse whitespace-nowrap">
                📋 {sessionDefects.length} pendientes · {contextLabel}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex-shrink-0"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>

      {/* Selección: Línea → Orden → Estilo */}
      <div className="bg-white border-b flex-shrink-0 px-4 py-2 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide">1. Línea</label>
            <select
              value={selectedLine}
              onChange={(e) => {
                const v = e.target.value;
                switchContext(() => { setSelectedOrderKey(''); setSelectedStyle(''); setSelectedLine(v); });
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-base font-semibold bg-white"
            >
              <option value="">Seleccionar Línea</option>
              {lines.map((line) => (
                <option key={line.line_no} value={line.line_no}>Línea {line.line_no}</option>
              ))}
            </select>
          </div>

          <div className="w-px self-stretch bg-gray-200 flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              2. Órdenes del {formatDay(workDate)}{orders.length > 0 && ` (${orders.length})`}
            </label>
            {!selectedLine ? (
              <div className="text-sm text-gray-400 py-2">Seleccione una línea para ver sus órdenes</div>
            ) : ordersLoading ? (
              <div className="text-sm text-gray-400 py-2">Cargando órdenes…</div>
            ) : orders.length === 0 ? (
              <div className="text-sm text-red-500 py-2">No hay órdenes para esta línea hoy ({formatDay(workDate)})</div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {orders.map((o) => {
                  const active = o.key === selectedOrderKey;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => switchContext(() => {
                        setSelectedOrderKey(o.key);
                        setSelectedStyle(o.styles.length === 1 ? o.styles[0].style : '');
                      })}
                      className={`flex-shrink-0 px-4 py-1.5 rounded-lg border-2 text-left transition-colors ${
                        active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <div className="font-semibold text-sm leading-tight">
                        {o.work_order_no ? `OT ${o.work_order_no}` : 'Sin orden'}
                      </div>
                      <div className={`text-[11px] leading-tight truncate max-w-[180px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                        {o.customer_name || 'Corridas sin orden ligada'}
                        {o.styles.length > 0 && ` · ${o.styles.length === 1 ? o.styles[0].style : `${o.styles.length} estilos`}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {selectedOrder && (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">3. Estilo</span>
              {selectedOrder.styles.length === 0 ? (
                <span className="text-sm text-red-500">Esta orden no tiene estilos registrados</span>
              ) : (
                <div className="flex gap-2 overflow-x-auto">
                  {selectedOrder.styles.map((s) => {
                    const active = s.style === selectedStyle;
                    return (
                      <button
                        key={s.style}
                        type="button"
                        onClick={() => switchContext(() => setSelectedStyle(s.style))}
                        className={`flex-shrink-0 px-3 py-1 rounded-lg border-2 text-sm font-semibold transition-colors ${
                          active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        {s.style}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {styleInfo && (
              <div className="flex-shrink-0 flex items-center gap-4 pl-3 border-l border-gray-200 text-sm">
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Objetivo</div>
                  <div className="font-bold">{styleInfo.target_pcs ?? '—'}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Operadores</div>
                  <div className="font-bold">{styleInfo.operators_count ?? '—'}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Mis defectos hoy</div>
                  <div className="font-bold text-red-600">{savedTotal + sessionTotal}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Área de trabajo */}
      <div className="flex-1 min-h-0 p-3 grid grid-cols-3 gap-3">

        {/* Formulario de captura */}
        <div className="col-span-2 bg-white rounded-lg shadow-sm p-4 flex flex-col min-h-0 overflow-y-auto">
          {!ready && (
            <div className="mb-3 text-sm bg-blue-50 text-blue-800 border border-blue-100 rounded-lg px-3 py-2">
              {!selectedLine ? 'Paso 1: seleccione la línea.'
                : !selectedOrder ? 'Paso 2: seleccione la orden de trabajo.'
                : 'Paso 3: seleccione el estilo.'}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 h-full">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Inspector</label>
                <div className="w-full px-3 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 truncate">
                  {user ? (user.full_name || user.username) : '—'}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Turno</label>
                <select
                  value={shiftSlot}
                  onChange={(e) => setShiftSlot(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">Seleccionar Turno</option>
                  <option value="Morning">Mañana</option>
                  <option value="Afternoon">Tarde</option>
                  <option value="Night">Noche</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">No. de Operador (Opcional)</label>
                <input
                  type="number"
                  value={operatorNo}
                  onChange={(e) => setOperatorNo(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="Número de operador"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Defecto *</label>
              <select
                ref={defectTypeSelectRef}
                value={selectedDefectType}
                onChange={(e) => { setSelectedDefectType(e.target.value); setSelectedReason(''); }}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-base font-medium focus:border-blue-500 bg-white disabled:bg-gray-50"
                disabled={!ready}
                required
              >
                <option value="">Seleccione</option>
                {defectTypes.map((type) => (
                  <option key={type.id} value={type.sort_order}>
                    {type.sort_order}. {type.defect_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Razón del Defecto</label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                disabled={!selectedDefectType}
              >
                <option value="">Seleccione ({getReasonsForType().length})</option>
                {getReasonsForType().map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.reason_code} - {reason.reason_description}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-center text-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notas (Opcional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="Nota rápida..."
                />
              </div>
            </div>

            <div className="mt-auto">
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading || !ready || !selectedDefectType}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-lg font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Guardando...' : 'Registrar Defecto'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-8 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3.5 rounded-lg font-semibold"
                >
                  Borrar
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 text-center">
                ⌨️ Atajos: Ctrl+Enter = Registrar | ESC = Borrar Formulario
              </div>
            </div>
          </form>
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-3 min-h-0">

          {/* Sesión actual */}
          <div className="bg-white rounded-lg shadow-sm p-4 flex flex-col min-h-0 flex-1">
            <div className="flex justify-between items-center mb-2 flex-shrink-0">
              <h3 className="text-base font-bold">Sesión Actual</h3>
              {contextLabel && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded truncate max-w-[60%]">{contextLabel}</span>
              )}
            </div>

            <div className="text-center mb-2 flex-shrink-0">
              <div className="text-3xl font-bold text-orange-600">{sessionDefects.length}</div>
              <div className="text-sm text-gray-600">Defectos en la sesión</div>
            </div>

            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto mb-2">
              {sessionDefects.slice(-10).reverse().map((defect) => (
                <div key={defect.id} className="border-l-4 border-blue-500 pl-3 py-2 text-sm bg-gray-50 rounded">
                  <div className="font-medium">{defect.quantity}x {defect.typeLabel}</div>
                  <div className="text-gray-500 text-xs">
                    {defect.reasonLabel && `${defect.reasonLabel} • `}
                    {defect.operatorNo && `Op ${defect.operatorNo} • `}
                    {defect.notes && defect.notes.substring(0, 30)}
                  </div>
                </div>
              ))}
              {sessionDefects.length === 0 && (
                <div className="text-center text-gray-500 py-8 text-sm">
                  No hay defectos en la sesión actual.<br />
                  Seleccione un tipo de defecto para comenzar.
                </div>
              )}
            </div>

            {sessionDefects.length > 0 && ready && (
              <button
                onClick={() => saveCurrentSession()}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium flex-shrink-0 disabled:opacity-50"
              >
                💾 Guardar {sessionDefects.length} Defectos
              </button>
            )}
          </div>

          {/* Mis guardados de hoy */}
          <div className="bg-white rounded-lg shadow-sm p-4 flex flex-col min-h-0 flex-1">
            <div className="flex justify-between items-center mb-2 flex-shrink-0 gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">Guardado Hoy</h3>
                {savedInspections.length > 0 && !selectMode && (
                  <button
                    type="button"
                    onClick={() => setSelectMode(true)}
                    className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                  >
                    ☑️ Seleccionar
                  </button>
                )}
              </div>
              <span className="text-2xl font-bold text-green-600">{ready ? savedTotal : 0}</span>
            </div>

            {selectMode && (
              <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allSavedSelected}
                    onChange={toggleAllSaved}
                    disabled={deleting}
                    className="h-4 w-4 accent-red-600"
                  />
                  Todos ({selectedSavedIds.length}/{savedInspections.length})
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={exitSelectMode}
                    disabled={deleting}
                    className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedSaved}
                    disabled={deleting || selectedSavedIds.length === 0}
                    className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50"
                  >
                    🗑️ {deleting ? 'Eliminando...' : `Eliminar (${selectedSavedIds.length})`}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto mb-2">
              {savedInspections.map((insp) => {
                const checked = selectedSavedIds.includes(insp.id);
                return (
                  <div
                    key={insp.id}
                    onClick={selectMode && !deleting ? () => toggleSaved(insp.id) : undefined}
                    className={`border-l-4 pl-3 pr-2 py-2 text-sm rounded flex items-start gap-2 ${
                      checked ? 'border-red-500 bg-red-50' : 'border-green-500 bg-gray-50'
                    } ${selectMode ? 'cursor-pointer hover:bg-red-50' : ''}`}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        tabIndex={-1}
                        className="h-4 w-4 mt-0.5 accent-red-600 pointer-events-none flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{insp.total_defects} defectos</span>
                        <span className="text-xs text-gray-500">{formatTime(insp.created_at)}</span>
                      </div>
                      {insp.bad_type && (
                        <div className="text-xs text-gray-600 truncate" title={insp.bad_type}>{insp.bad_type}</div>
                      )}
                      <div className="text-[11px] text-gray-400">
                        {insp.inspector_name}{insp.shift_slot ? ` • ${insp.shift_slot}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
              {savedInspections.length === 0 && (
                <div className="text-center text-gray-500 py-6 text-sm">
                  Aún no has guardado defectos hoy<br />para esta orden y estilo.
                </div>
              )}
            </div>

            {ready && (
              <div className="text-[11px] text-gray-500 text-center flex-shrink-0">
                Línea {selectedLine} • {contextLabel}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default QualityInspectorPage;