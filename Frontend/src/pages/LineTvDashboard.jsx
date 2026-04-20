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
  }, [lineNo, date]);

  const fetchLineData = async (line, selectedDate, isRefresh = false) => {
    if (!line || !selectedDate) return;
    
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      // First, get all runs for this line on this date (including multiple styles)
      const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line}`, { headers });
      
      if (!runsRes.data.success) {
        setError('No se pudo obtener información de la línea');
        return;
      }

      // Filter runs for the selected date
      const runsOnDate = runsRes.data.runs.filter(r => toYMD(r.run_date) === selectedDate);
      
      if (runsOnDate.length === 0) {
        setError('No hay datos de producción para esta fecha');
        return;
      }

      // Determine if multiple styles exist
      const hasMultipleStyles = runsOnDate.length > 1;
      setIsMultiStyle(hasMultipleStyles);
      
      // Fetch detailed data for each run
      const allRunData = [];
      for (const run of runsOnDate) {
        const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
        if (detailRes.data.success) {
          allRunData.push(detailRes.data);
        }
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
      setError('Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    setDate(newDate);
    setCountdown(300);
  };

  const handleLineChange = (newLine) => {
    setLineNo(newLine);
    setRunDataList([]);
    setCountdown(300);
  };

  const formatNumber = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  };

  const formatDecimal = (value) => {
    if (value == null) return '0';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  };

  const getStatusColor = (variancePct) => {
    if (variancePct < -15) return { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-800', icon: '🔴', label: 'Crítico' };
    if (variancePct < -5) return { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800', icon: '🟠', label: 'Atrasado' };
    if (variancePct <= 5) return { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', badge: 'bg-green-100 text-green-800', icon: '🟢', label: 'En Ruta' };
    if (variancePct <= 15) return { bg: 'bg-yellow-50', border: 'border-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-800', icon: '🟡', label: 'Adelantado' };
    return { bg: 'bg-blue-50', border: 'border-blue-500', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800', icon: '🔵', label: 'Superando' };
  };

  const getEfficiencyColor = (eff) => {
    if (eff >= 80) return 'text-green-600';
    if (eff >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressBarColor = (eff) => {
    if (eff >= 80) return 'bg-green-600';
    if (eff >= 60) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  // Calculate card data for a specific run
  const getRunCardData = (runData) => {
    const rt = computeRealtimeTarget(runData, date);
    const finished = calculateFinishedGarments(runData);
    const operatorsCount = runData.operators?.length || 0;
    const sam = runData.run?.sam_minutes || 0;
    const rtEff = calculateRealtimeEfficiency(runData, date);
    const variance = finished - rt;
    const variancePct = rt > 0 ? (variance / rt) * 100 : 0;
    
    return {
      realtimeTarget: rt,
      finishedGarments: finished,
      realtimeEfficiency: rtEff,
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
        {/* Error message */}
        {error && (
          <div className="bg-red-100 border-2 border-red-400 text-red-700 px-4 py-2 rounded-lg mb-4 text-base">
            ⚠️ {error}
          </div>
        )}

        {/* Loading */}
        {loading && lineNo && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
            <p className="mt-3 text-lg text-gray-600">Cargando datos...</p>
          </div>
        )}

        {/* Multi-style header indicator */}
        {!loading && lineNo && runDataList.length > 1 && (
          <div className="mb-4 bg-blue-100 border-2 border-blue-400 text-blue-800 px-4 py-2 rounded-lg text-center">
            📊 Línea con múltiples estilos - Mostrando {runDataList.length} estilos
          </div>
        )}

        {/* Cards Grid - Responsive for multiple styles */}
        {!loading && lineNo && runDataList.length > 0 && (
          <div className={`grid gap-6 ${runDataList.length === 1 ? 'grid-cols-1 max-w-4xl mx-auto' : 'grid-cols-1 lg:grid-cols-2'}`}>
            {runDataList.map((runData, index) => {
              const cardData = getRunCardData(runData);
              const status = getStatusColor(cardData.variancePct);
              
              return (
                <div key={runData.run?.id || index} className={`border-4 ${status.border} rounded-xl overflow-hidden shadow-xl`}>
                  {/* Header */}
                  <div className={`${status.bg} px-5 py-3 flex justify-between items-center`}>
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="text-2xl font-bold text-gray-900">
                          Línea {lineNo}
                        </span>
                        {runDataList.length > 1 && (
                          <div className="text-sm text-gray-600 mt-0.5">
                            {cardData.styleCode} - {cardData.styleName.length > 30 ? cardData.styleName.substring(0, 30) + '...' : cardData.styleName}
                          </div>
                        )}
                      </div>
                      <span className="text-2xl">{status.icon}</span>
                    </div>
                    <div className={`${status.badge} px-4 py-1.5 rounded-full text-lg font-semibold shadow`}>
                      {status.label}
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 bg-white">
                    {/* Style info - only show when single style */}
                    {runDataList.length === 1 && (
                      <div className="mb-3 text-base text-gray-600 font-medium border-b pb-2 truncate">
                        {cardData.styleCode} - {cardData.styleName}
                      </div>
                    )}

                    {/* Operator Info - 2 columns */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-sm text-gray-600 mb-1">Operadores</div>
                        <div className="text-2xl font-bold text-gray-900">{cardData.operatorsCount}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-sm text-gray-600 mb-1">SAM</div>
                        <div className="text-2xl font-bold text-gray-900">{formatDecimal(cardData.sam)}</div>
                      </div>
                    </div>

                    {/* Real-time Efficiency Section */}
                    <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-lg text-gray-700 font-semibold">Eficiencia RT:</span>
                        <span className={`text-2xl font-bold ${getEfficiencyColor(cardData.realtimeEfficiency)}`}>
                          {formatDecimal(cardData.realtimeEfficiency)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className={`h-3 rounded-full transition-all duration-500 ${getProgressBarColor(cardData.realtimeEfficiency)}`}
                          style={{ width: `${Math.min(cardData.realtimeEfficiency, 100)}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Two column grid - Target and Produced */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-blue-50 rounded-lg p-4">
                        <div className="text-base text-blue-800 font-medium mb-1">Objetivo (ahora)</div>
                        <div className="text-3xl font-bold text-blue-900">{formatNumber(cardData.realtimeTarget)}</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4">
                        <div className="text-base text-green-800 font-medium mb-1">Cosido</div>
                        <div className="text-3xl font-bold text-green-900">{formatNumber(cardData.finishedGarments)}</div>
                      </div>
                    </div>

                    {/* Variance */}
                    <div className="flex justify-between items-center pt-3 border-t-2 border-gray-200">
                      <span className="text-lg text-gray-700 font-semibold">Variación</span>
                      <span className={`font-bold flex items-center gap-2 text-xl ${
                        cardData.variance > 0 ? 'text-green-600' : cardData.variance < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        <span className="text-2xl">{cardData.variance > 0 ? '↑' : cardData.variance < 0 ? '↓' : '→'}</span>
                        <span>{cardData.variance > 0 ? '+' : ''}{formatNumber(cardData.variance)}</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* No line selected */}
        {!lineNo && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <div className="text-5xl mb-4">📺</div>
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Selecciona una línea</h2>
            <p className="text-lg text-gray-500">para ver los datos en tiempo real</p>
          </div>
        )}
      </main>
    </div>
  );
}