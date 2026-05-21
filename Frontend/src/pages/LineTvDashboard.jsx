// LineTvDashboard.jsx
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Navlines from '../components/Navlines';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// Helper function to calculate finished garments (empaque) for a specific run
const calculateFinishedGarments = (runData) => {
  if (!runData) return 0;
  let total = 0;
  const packingKeywords = ['pack', 'emp', 'empaque', 'packing', 'finished', 'terminado'];
  
  for (const block of runData.operations || []) {
    for (const op of block.operations || []) {
      const opName = (op.operation_name || '').toLowerCase();
      if (packingKeywords.some(keyword => opName.includes(keyword))) {
        const sewedData = op.sewed_data || {};
        for (const qty of Object.values(sewedData)) {
          total += Number(qty) || 0;
        }
      }
    }
  }
  return total;
};

// Helper function to calculate real-time efficiency for a specific run
const calculateRealtimeEfficiency = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  if (now >= PRODUCTION_END) {
    const sewed = calculateFinishedGarments(runData);
    const totalSAMOutput = sewed * (runData.run?.sam_minutes || 0);
    const totalAvailableMinutes = (runData.operators?.length || 0) * 
                                  (runData.run?.working_hours || 0) * 60;
    
    return totalAvailableMinutes > 0 
      ? (totalSAMOutput / totalAvailableMinutes) * 100 
      : 0;
  }
  
  const elapsedMilliseconds = now - PRODUCTION_START;
  const elapsedMinutes = elapsedMilliseconds / (1000 * 60);
  
  const actualWorkingMinutes = Math.min(
    elapsedMinutes,
    (PRODUCTION_END - PRODUCTION_START) / (1000 * 60)
  );
  
  const sewedSoFar = calculateFinishedGarments(runData);
  const samProducedSoFar = sewedSoFar * (runData.run?.sam_minutes || 0);
  
  const operatorsCount = runData.operators?.length || 0;
  const availableMinutesSoFar = operatorsCount * actualWorkingMinutes;
  
  const realtimeEfficiency = availableMinutesSoFar > 0 
    ? (samProducedSoFar / availableMinutesSoFar) * 100 
    : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  const totalTarget = runData.run?.target_pcs || 0;
  
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  if (now >= PRODUCTION_END) {
    return totalTarget;
  }
  
  const elapsedMilliseconds = now - PRODUCTION_START;
  const totalProductionMilliseconds = PRODUCTION_END - PRODUCTION_START;
  
  if (totalProductionMilliseconds > 0) {
    const progressRatio = elapsedMilliseconds / totalProductionMilliseconds;
    const cumulative = totalTarget * progressRatio;
    return Math.min(Math.round(cumulative * 100) / 100, totalTarget);
  }
  
  return 0;
};

export default function LineTvDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(searchParams.get('date') || new Date().toISOString().split('T')[0]);
  const [lineNo, setLineNo] = useState(searchParams.get('line') || '');
  const [runDataList, setRunDataList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMultiStyle, setIsMultiStyle] = useState(false);
  
  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(300);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/', { replace: true });
      return;
    }

    axios.get(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        setUser(res.data.user);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, []);

  // Auto-refresh logic
  useEffect(() => {
    let timer;
    if (autoRefresh && lineNo && date) {
      timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            refreshData();
            return 300;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [autoRefresh, lineNo, date]);

  const refreshData = async () => {
    if (lineNo && date) {
      console.log('Auto-refreshing data...');
      await fetchLineData(lineNo, date, true);
      setLastRefreshed(new Date());
    }
  };

  const handleManualRefresh = () => {
    setCountdown(300);
    refreshData();
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      setCountdown(300);
    }
  };

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  useEffect(() => {
    if (lineNo && date) {
      fetchLineData(lineNo, date);
    }
  }, [lineNo, date, refreshKey]);

  const fetchLineData = async (line, selectedDate, isRefresh = false) => {
    if (!line || !selectedDate) return;
    
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line}`, { headers });
      
      if (!runsRes.data.success) {
        setError('No se pudo obtener información de la línea');
        setLoading(false);
        return;
      }

      const runsOnDate = runsRes.data.runs.filter(run => {
        const runDateStr = toYMD(run.run_date);
        return runDateStr === selectedDate;
      });
      
      console.log(`Found ${runsOnDate.length} runs for line ${line} on ${selectedDate}`);
      
      if (runsOnDate.length === 0) {
        setError('No hay datos de producción para esta fecha');
        setLoading(false);
        return;
      }

      const hasMultipleStyles = runsOnDate.length > 1;
      setIsMultiStyle(hasMultipleStyles);
      
      const allRunData = [];
      for (const run of runsOnDate) {
        try {
          const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
          if (detailRes.data.success) {
            allRunData.push(detailRes.data);
          } else {
            console.warn(`No data for run ${run.id}`);
          }
        } catch (err) {
          console.error(`Error fetching run ${run.id}:`, err.message);
        }
      }
      
      if (allRunData.length === 0) {
        setError('No se pudieron cargar los datos detallados');
        setLoading(false);
        return;
      }
      
      setRunDataList(allRunData);
      
      if (hasMultipleStyles) {
        console.log(`Found ${allRunData.length} styles for line ${line} on ${selectedDate}`);
      }

      if (isRefresh) {
        console.log('Data refreshed successfully');
      }

    } catch (err) {
      console.error('Error fetching line data:', err);
      setError('Error al cargar los datos: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    setDate(newDate);
    setCountdown(300);
    setRefreshKey(prev => prev + 1);
  };

  const handleLineChange = (newLine) => {
    setLineNo(newLine);
    setRunDataList([]);
    setCountdown(300);
    setRefreshKey(prev => prev + 1);
  };

  const formatNumber = (value) => {
    if (value == null || isNaN(value)) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  const formatDecimal = (value) => {
    if (value == null || isNaN(value)) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  };

  // Updated efficiency color function with new color scheme
  const getEfficiencyColor = (eff) => {
    if (isNaN(eff)) return 'text-gray-600';
    if (eff < 60) return 'text-red-600';
    if (eff >= 60 && eff < 70) return 'text-orange-500';
    if (eff >= 70 && eff < 80) return 'text-yellow-600';
    if (eff >= 80 && eff < 90) return 'text-green-600';
    if (eff >= 90) return 'text-green-800';
    return 'text-gray-600';
  };

  // Updated progress bar color function with new color scheme
  const getProgressBarColor = (eff) => {
    if (isNaN(eff)) return 'bg-gray-600';
    if (eff < 60) return 'bg-red-600';
    if (eff >= 60 && eff < 70) return 'bg-orange-500';
    if (eff >= 70 && eff < 80) return 'bg-yellow-500';
    if (eff >= 80 && eff < 90) return 'bg-green-600';
    if (eff >= 90) return 'bg-green-800';
    return 'bg-gray-600';
  };

  // Updated card background color based on efficiency
  const getCardBgColor = (eff) => {
    if (isNaN(eff)) return 'bg-white';
    if (eff < 60) return 'bg-red-50';
    if (eff >= 60 && eff < 70) return 'bg-orange-50';
    if (eff >= 70 && eff < 80) return 'bg-yellow-50';
    if (eff >= 80 && eff < 90) return 'bg-green-50';
    if (eff >= 90) return 'bg-green-100';
    return 'bg-white';
  };

  // Updated status color based on variance - keeping original but adjusting colors
  const getStatusColor = (variancePct) => {
    if (isNaN(variancePct)) return { bg: 'bg-gray-50', border: 'border-gray-500', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-800', icon: '⚪', label: 'Sin datos' };
    if (variancePct < -15) return { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-800', icon: '🔴', label: 'Crítico' };
    if (variancePct < -5) return { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', icon: '🟠', label: 'Atrasado' };
    if (variancePct <= 5) return { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', badge: 'bg-green-100 text-green-800', icon: '🟢', label: 'En Ruta' };
    if (variancePct <= 15) return { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800', icon: '🟡', label: 'Adelantado' };
    return { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', icon: '🔵', label: 'Superando' };
  };

  const getRunCardData = (runData) => {
    const rt = computeRealtimeTarget(runData, date);
    const finished = calculateFinishedGarments(runData);
    const operatorsCount = runData.operators?.length || 0;
    const sam = runData.run?.sam_minutes || 0;
    let rtEff = calculateRealtimeEfficiency(runData, date);
    // Cap efficiency at 100 for display purposes
    const displayEfficiency = Math.min(rtEff, 100);
    const variance = finished - rt;
    const variancePct = rt > 0 ? (variance / rt) * 100 : 0;
    
    return {
      realtimeTarget: rt,
      finishedGarments: finished,
      realtimeEfficiency: rtEff,
      displayEfficiency: displayEfficiency,
      operatorsCount,
      sam,
      styleName: runData.run?.style || 'N/A',
      styleCode: runData.run?.style_code || 'N/A',
      variance,
      variancePct
    };
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navlines 
        user={user}
        selectedLine={lineNo}
        selectedDate={date}
        onLineChange={handleLineChange}
        onDateChange={handleDateChange}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
        onManualRefresh={handleManualRefresh}
        loading={loading}
        lastRefreshed={lastRefreshed}
        countdown={countdown}
        formatCountdown={formatCountdown}
        formatTime={formatTime}
      />

      <main className="flex-1 max-w-7xl mx-auto px-4 py-4 w-full">
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-6 py-4 rounded-lg mb-4 text-xl font-semibold">
            ⚠️ {error}
          </div>
        )}

        {loading && lineNo && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
            <p className="mt-3 text-lg text-gray-600">Cargando datos...</p>
          </div>
        )}

        {!loading && lineNo && runDataList.length > 1 && (
          <div className="mb-4 bg-blue-100 border-2 border-blue-400 text-blue-800 px-4 py-2 rounded-lg text-center text-lg font-semibold">
            📊 Línea con múltiples estilos - Mostrando {runDataList.length} estilos
          </div>
        )}

        {!loading && lineNo && runDataList.length > 0 && (
          <div className={`grid gap-6 ${runDataList.length === 1 ? 'grid-cols-1 max-w-5xl mx-auto' : 'grid-cols-1 lg:grid-cols-2'}`}>
            {runDataList.map((runData, index) => {
              const cardData = getRunCardData(runData);
              const status = getStatusColor(cardData.variancePct);
              const cardBg = getCardBgColor(cardData.displayEfficiency);
              
              return (
                <div key={runData.run?.id || index} className={`border-4 ${status.border} rounded-xl overflow-hidden shadow-2xl ${cardBg}`}>
                  {/* Header - Larger and more prominent */}
                  <div className={`${status.bg} px-6 py-4 flex justify-between items-center`}>
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-3xl font-black text-gray-900">
                          Línea {lineNo}
                        </span>
                        {runDataList.length > 1 && (
                          <div className="text-base text-gray-600 mt-1 font-medium">
                            {cardData.styleCode} - {cardData.styleName.length > 35 ? cardData.styleName.substring(0, 35) + '...' : cardData.styleName}
                          </div>
                        )}
                      </div>
                      <span className="text-3xl">{status.icon}</span>
                    </div>
                    <div className={`${status.badge} px-5 py-2 rounded-full text-xl font-bold shadow-md`}>
                      {status.label}
                    </div>
                  </div>

                  {/* Card Content - Larger everything */}
                  <div className="p-6">
                    {/* Style info - only show when single style */}
                    {runDataList.length === 1 && (
                      <div className="mb-4 text-lg text-gray-700 font-semibold border-b-2 pb-2 truncate">
                        📦 {cardData.styleCode} - {cardData.styleName}
                      </div>
                    )}

                    {/* Operator Info - 2 columns with larger numbers */}
                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div className="bg-gray-100 rounded-xl p-4 text-center">
                        <div className="text-base text-gray-600 mb-2 font-semibold uppercase tracking-wide">👥 Operadores</div>
                        <div className="text-4xl font-black text-gray-900">{cardData.operatorsCount}</div>
                      </div>
                      <div className="bg-gray-100 rounded-xl p-4 text-center">
                        <div className="text-base text-gray-600 mb-2 font-semibold uppercase tracking-wide">⏱️ SAM</div>
                        <div className="text-4xl font-black text-gray-900">{formatDecimal(cardData.sam)}</div>
                      </div>
                    </div>

                    {/* Real-time Efficiency Section - More prominent with new colors */}
                    <div className="mb-5 rounded-xl p-5" style={{ backgroundColor: 'rgba(255,255,255,0.7)' }}>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xl text-gray-800 font-bold uppercase tracking-wide">⚡ Eficiencia RT:</span>
                        <span className={`text-3xl font-black ${getEfficiencyColor(cardData.displayEfficiency)}`}>
                          {formatDecimal(cardData.displayEfficiency)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-300 rounded-full h-4">
                        <div
                          className={`h-4 rounded-full transition-all duration-500 ${getProgressBarColor(cardData.displayEfficiency)}`}
                          style={{ width: `${cardData.displayEfficiency}%` }}
                        ></div>
                      </div>
                      {/* Efficiency label */}
                      <div className="mt-2 text-right">
                        <span className={`text-sm font-semibold ${getEfficiencyColor(cardData.displayEfficiency)}`}>
                          {cardData.displayEfficiency < 60 && '⚠️ Por debajo de meta'}
                          {cardData.displayEfficiency >= 60 && cardData.displayEfficiency < 70 && '⚠️ Necesita mejorar'}
                          {cardData.displayEfficiency >= 70 && cardData.displayEfficiency < 80 && '📈 Buen desempeño'}
                          {cardData.displayEfficiency >= 80 && cardData.displayEfficiency < 90 && '🌟 Excelente'}
                          {cardData.displayEfficiency >= 90 && '🏆 Outstanding!'}
                        </span>
                      </div>
                    </div>

                    {/* Two column grid - Target and Produced with larger numbers */}
                    <div className="grid grid-cols-2 gap-5 mb-5">
                      <div className="bg-blue-100 rounded-xl p-5 text-center">
                        <div className="text-lg text-blue-900 font-bold mb-2 uppercase tracking-wide">🎯 Objetivo (ahora)</div>
                        <div className="text-5xl font-black text-blue-900">{formatNumber(cardData.realtimeTarget)}</div>
                      </div>
                      <div className="bg-green-100 rounded-xl p-5 text-center">
                        <div className="text-lg text-green-900 font-bold mb-2 uppercase tracking-wide">✅ Cosido</div>
                        <div className="text-5xl font-black text-green-900">{formatNumber(cardData.finishedGarments)}</div>
                      </div>
                    </div>

                    {/* Variance - More visible */}
                    <div className="flex justify-between items-center pt-4 border-t-2 border-gray-300">
                      <span className="text-xl text-gray-800 font-bold uppercase tracking-wide">📊 Variación</span>
                      <span className={`font-black flex items-center gap-3 text-2xl ${
                        cardData.variance > 0 ? 'text-green-600' : cardData.variance < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        <span className="text-3xl">{cardData.variance > 0 ? '↑' : cardData.variance < 0 ? '↓' : '→'}</span>
                        <span>{cardData.variance > 0 ? '+' : ''}{formatNumber(cardData.variance)}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && lineNo && runDataList.length === 0 && !error && (
          <div className="bg-yellow-50 border-2 border-yellow-400 text-yellow-800 px-6 py-8 rounded-lg text-center">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-2xl font-bold mb-3">No hay datos disponibles</h3>
            <p className="text-lg">No se encontraron datos de producción para la línea {lineNo} en la fecha {date}</p>
          </div>
        )}

        {!lineNo && (
          <div className="bg-white rounded-xl shadow-2xl p-16 text-center">
            <div className="text-7xl mb-6">📺</div>
            <h2 className="text-4xl font-black text-gray-800 mb-3">Selecciona una línea</h2>
            <p className="text-xl text-gray-500">para ver los datos en tiempo real</p>
          </div>
        )}
      </main>
    </div>
  );
}