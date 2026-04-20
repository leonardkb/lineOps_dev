import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import NavDashboard from '../components/NavDashboard';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function toYMD(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

// Helper function to calculate finished garments (from packing operations)
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

// Helper function to calculate daily efficiency (based on SAM)
const calculateDailyEfficiency = (runData) => {
  if (!runData) return 0;
  
  const sewed = calculateFinishedGarments(runData);
  const operatorsCount = runData.run?.operators_count || 0;
  const workingHours = runData.run?.working_hours || 0;
  const sam = runData.run?.sam_minutes || 0;
  
  if (operatorsCount === 0 || workingHours === 0 || sam === 0) return 0;
  
  const availableMinutes = operatorsCount * workingHours * 60;
  const totalSAMOutput = sewed * sam;
  const efficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
  
  return Math.round(efficiency * 100) / 100;
};

// Helper function to check if production has ended for the day
const isProductionEnded = (selectedDate) => {
  if (!selectedDate) return false;
  const now = new Date();
  const todayStr = selectedDate;
  
  const PRODUCTION_END = new Date(`${todayStr}T17:36:00`);
  return now >= PRODUCTION_END;
};

// Helper function to calculate real-time efficiency
const calculateRealtimeEfficiency = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  // If production has ended, return null to indicate we should show daily efficiency instead
  if (isProductionEnded(selectedDate)) {
    return null;
  }
  
  const now = new Date();
  const todayStr = selectedDate;
  
  // Production timeline: 8:00 AM start
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get the last slot end time
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  // Find the latest end time from slots
  const PRODUCTION_END = slots.length > 0 
    ? new Date(Math.max(...slots.map(s => s.end.getTime())))
    : new Date(`${todayStr}T17:36:00`);
  
  // If production hasn't started yet
  if (now < PRODUCTION_START) {
    return 0;
  }
  
  // If production has ended for the day
  if (now >= PRODUCTION_END) {
    return null;
  }
  
  // Calculate elapsed time in minutes
  const elapsedMilliseconds = now - PRODUCTION_START;
  const elapsedMinutes = elapsedMilliseconds / (1000 * 60);
  
  // Get actual working hours so far (in minutes)
  const actualWorkingMinutes = Math.min(
    elapsedMinutes,
    (PRODUCTION_END - PRODUCTION_START) / (1000 * 60)
  );
  
  // Calculate SAM produced so far (only from packing operations)
  const sewedSoFar = calculateFinishedGarments(runData);
  const samProducedSoFar = sewedSoFar * (runData.run?.sam_minutes || 0);
  
  // Calculate available minutes so far (operators * actual time elapsed)
  const operatorsCount = runData.run?.operators_count || 0;
  const availableMinutesSoFar = operatorsCount * actualWorkingMinutes;
  
  // Calculate real-time efficiency
  const realtimeEfficiency = availableMinutesSoFar > 0 
    ? (samProducedSoFar / availableMinutesSoFar) * 100 
    : 0;
  
  return Math.round(realtimeEfficiency * 100) / 100;
};

// Helper function to calculate real-time target
const computeRealtimeTarget = (runData, selectedDate) => {
  if (!runData || !selectedDate) return 0;
  
  // If production has ended, return the full target
  if (isProductionEnded(selectedDate)) {
    return runData.run?.target_pcs || 0;
  }
  
  const now = new Date();
  const todayStr = selectedDate;
  
  // Production timeline: 8:00 AM start
  const PRODUCTION_START = new Date(`${todayStr}T08:00:00`);
  
  // Get the last slot end time
  const slots = (runData.slots || [])
    .map(slot => {
      const end = new Date(`${todayStr}T${slot.slot_end}`);
      return { ...slot, end };
    })
    .filter(s => s.end);
  
  // Find the latest end time from slots
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
    const realTimeTarget = totalTarget * progressRatio;
    return Math.min(Math.round(realTimeTarget * 100) / 100, totalTarget);
  }
  
  return 0;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [summary, setSummary] = useState(null);
  const [lineData, setLineData] = useState([]);
  const [lineRunData, setLineRunData] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productionEnded, setProductionEnded] = useState(false);

  // Real-time efficiency states
  const [globalRealtimeTarget, setGlobalRealtimeTarget] = useState(0);
  const [globalRealtimeEfficiency, setGlobalRealtimeEfficiency] = useState(0);
  const [globalDailyEfficiency, setGlobalDailyEfficiency] = useState(0);
  const [lineRealtimeTargets, setLineRealtimeTargets] = useState({});
  const [lineEfficiencies, setLineEfficiencies] = useState({});
  const [lineRealtimeEfficiencies, setLineRealtimeEfficiencies] = useState({});

  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [hoveredCard, setHoveredCard] = useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Check if production has ended
  useEffect(() => {
    const checkProductionEnded = () => {
      const ended = isProductionEnded(date);
      setProductionEnded(ended);
    };
    
    checkProductionEnded();
    const interval = setInterval(checkProductionEnded, 60000);
    return () => clearInterval(interval);
  }, [date]);

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
        const user = res.data.user;
        if (user.role !== 'supervisor') {
          if (user.role === 'line_leader') {
            navigate('/lineleader', { replace: true });
          } else {
            navigate('/planner', { replace: true });
          }
          return;
        }
        setUser(user);
        fetchDashboardData(date);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, []);

useEffect(() => {
  const fetchLineDetails = async () => {
    if (!lineData.length || !date) return;
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    const newRunData = {};
    const newTargets = {};
    const newEfficiencies = {};
    const newRealtimeEfficiencies = {};
    
    // For global calculation - weighted average based on SAM
    let totalSAMOutputSum = 0;
    let totalAvailableMinutesSum = 0;
    let globalWeightedEff = 0;
    let globalTargets = 0;
    
    for (const line of lineData) {
      try {
        const runsRes = await axios.get(`${API_BASE}/api/line-runs/${line.lineNo}`, { headers });
        if (!runsRes.data.success) continue;
        
        const runsForDate = runsRes.data.runs.filter(r => toYMD(r.run_date) === date);

        if (runsForDate.length === 0) continue;
    
        // Store all runs for this line
        const lineRuns = [];
        let totalSewed = 0;
        let totalTarget = 0;
        
        // For line-level weighted calculation
        let lineWeightedEff = 0;
        let lineTargets = 0;
        
        for (const run of runsForDate) {
          const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
          if (!detailRes.data.success) continue;
          
          lineRuns.push({
            ...detailRes.data,
            runId: run.id,
            style: run.style
          });
          
          const finishedGarments = calculateFinishedGarments(detailRes.data);
          const dailyEff = calculateDailyEfficiency(detailRes.data);
          totalSewed += finishedGarments;
          totalTarget += Number(detailRes.data.run?.target_pcs || 0);
          
          // Calculate real-time efficiency and target for this run
          const rtEff = calculateRealtimeEfficiency(detailRes.data, date);
          const rtTarget = computeRealtimeTarget(detailRes.data, date);
          
          // Accumulate for weighted global daily efficiency
          const operatorsCount = detailRes.data.run?.operators_count || 0;
          const workingHours = detailRes.data.run?.working_hours || 0;
          const sam = detailRes.data.run?.sam_minutes || 0;
          totalSAMOutputSum += finishedGarments * sam;
          totalAvailableMinutesSum += operatorsCount * workingHours * 60;
          
          // Add to line weighted calculation
          if (rtTarget > 0 && rtEff !== null) {
            lineWeightedEff += rtEff * rtTarget;
            lineTargets += rtTarget;
          }
          
          // Add to global weighted calculation
          if (rtTarget > 0 && rtEff !== null) {
            globalWeightedEff += rtEff * rtTarget;
            globalTargets += rtTarget;
          }
        }
        
        newRunData[line.lineNo] = lineRuns;
        
        // Calculate real-time target based on first run's slots (assuming same schedule)
        if (lineRuns.length > 0) {
          const rt = computeRealtimeTarget(lineRuns[0], date);
          newTargets[line.lineNo] = rt;
          
          // Calculate line real-time efficiency using weighted average
          const lineEff = lineTargets > 0 ? lineWeightedEff / lineTargets : 0;
          newRealtimeEfficiencies[line.lineNo] = Math.round(lineEff * 100) / 100;
        } else {
          newTargets[line.lineNo] = 0;
          newRealtimeEfficiencies[line.lineNo] = 0;
        }
        
        // Calculate overall efficiency for the line using weighted average
        let lineTotalSAMOutput = 0;
        let lineTotalAvailableMinutes = 0;
        for (const run of lineRuns) {
          const sewed = calculateFinishedGarments(run);
          const operatorsCount = run.run?.operators_count || 0;
          const workingHours = run.run?.working_hours || 0;
          const sam = run.run?.sam_minutes || 0;
          lineTotalSAMOutput += sewed * sam;
          lineTotalAvailableMinutes += operatorsCount * workingHours * 60;
        }
        const efficiency = lineTotalAvailableMinutes > 0 ? (lineTotalSAMOutput / lineTotalAvailableMinutes) * 100 : 0;
        newEfficiencies[line.lineNo] = Math.round(efficiency * 100) / 100;
        
      } catch (err) {
        console.error(`Error fetching details for line ${line.lineNo}:`, err);
      }
    }
    
    setLineRunData(newRunData);
    setLineRealtimeTargets(newTargets);
    setLineEfficiencies(newEfficiencies);
    setLineRealtimeEfficiencies(newRealtimeEfficiencies);
    
    const targetSum = Object.values(newTargets).reduce((a, b) => a + b, 0);
    setGlobalRealtimeTarget(targetSum);
    
    // Calculate global real-time efficiency using weighted average
    const globalEff = globalTargets > 0 ? globalWeightedEff / globalTargets : 0;
    setGlobalRealtimeEfficiency(Math.round(globalEff * 100) / 100);
    
    // IMPORTANT: Daily efficiency should come from server's summary endpoint
    // Do NOT recalculate client-side - use the server calculation for consistency
    if (summary && summary.overallEfficiency !== undefined) {
      setGlobalDailyEfficiency(Math.round(summary.overallEfficiency * 100) / 100);
    }
  };
  
  fetchLineDetails();
  
  // Update every minute for real-time data
  const interval = setInterval(fetchLineDetails, 60000);
  return () => clearInterval(interval);
}, [lineData, date, summary]); // Add summary to dependencies

  const fetchDashboardData = async (selectedDate) => {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [summaryRes, lineRes, assignmentsRes] = await Promise.all([
        axios.get(`${API_BASE}/api/supervisor/summary?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/line-performance?date=${selectedDate}`, { headers }),
        axios.get(`${API_BASE}/api/supervisor/assignments?date=${selectedDate}`, { headers })
      ]);
      if (summaryRes.data.success) setSummary(summaryRes.data.summary);
      if (lineRes.data.success) setLineData(lineRes.data.lines);
      if (assignmentsRes.data.success) setAssignments(assignmentsRes.data.assignments);
      else setAssignments([]);
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los datos del panel. Por favor inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setDate(newDate);
    fetchDashboardData(newDate);
    setLineRunData({});
    setLineRealtimeTargets({});
    setLineEfficiencies({});
    setLineRealtimeEfficiencies({});
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

  const getLineStatus = (variancePct, target) => {
    if (target === 0) return { color: 'gray', icon: '⏸️', text: 'Sin Objetivo' };
    if (variancePct < -15) return { color: 'red', icon: '🔴', text: 'Crítico' };
    if (variancePct < -5) return { color: 'orange', icon: '🟠', text: 'Atrasado' };
    if (variancePct <= 5) return { color: 'green', icon: '🟢', text: 'En Ruta' };
    if (variancePct <= 15) return { color: 'yellow', icon: '🟡', text: 'Adelantado' };
    return { color: 'blue', icon: '🔵', text: 'Superando' };
  };

  const getStatusDot = (value, type) => {
    if (value === undefined || value === null) return 'bg-gray-400';
    if (type === 'efficiency' || type === 'realtimeEfficiency') {
      if (value < 60) return 'bg-red-500';
      if (value < 80) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    if (type === 'cumplimiento') {
      if (value < 70) return 'bg-red-500';
      if (value < 90) return 'bg-yellow-500';
      return 'bg-green-500';
    }
    return 'bg-gray-400';
  };

  const getEfficiencyColor = (efficiency) => {
    if (efficiency >= 80) return "text-green-600 bg-green-50";
    if (efficiency >= 60) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  const getEfficiencyDotColor = (eff) => {
    if (eff < 60) return 'bg-red-500';
    if (eff < 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Cargando panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      <NavDashboard />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header Section */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 mb-8 border border-white/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
                Panel de Supervisor
              </h1>
              <p className="text-gray-600 mt-1 ml-1">
                Bienvenido de nuevo,{" "}
                <span className="font-semibold text-gray-900">{user.full_name || user.username}</span>
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <div className="flex items-center bg-gray-50 rounded-xl p-1 border border-gray-200">
                <input
                  type="date"
                  id="date"
                  value={date}
                  onChange={handleDateChange}
                  className="w-full sm:w-auto rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-sm focus:ring-2 focus:ring-gray-900/20"
                />
              </div>

              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  navigate('/');
                }}
                className="bg-white border-2 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 px-5 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 
          text-red-700 px-6 py-4 rounded-xl mb-8 animate-slideDown flex items-center gap-3 shadow-md">
            <div>
              <p className="font-semibold">Error al cargar datos</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {!loading && summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-5 mb-8">
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">META</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalTarget)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Meta RT</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(globalRealtimeTarget)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas esperadas ahora</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${summary.totalTarget > 0 ? (globalRealtimeTarget / summary.totalTarget) * 100 : 0}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.totalTarget > 0 ? ((globalRealtimeTarget / summary.totalTarget) * 100).toFixed(1) : 0}% del total
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Total Cosido</p>
                  <p className="text-3xl font-bold text-gray-900">{formatNumber(summary.totalSewed)}</p>
                  <p className="text-xs text-gray-500 mt-2">piezas</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(globalRealtimeEfficiency, 'realtimeEfficiency')}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Eficiencia RT</p>
                  </div>
                  <p className={`text-3xl font-bold ${getEfficiencyColor(globalRealtimeEfficiency)}`}>
                    {formatDecimal(globalRealtimeEfficiency)}%
                  </p>
                  <p className="text-xs text-gray-500 mt-2">Basado en tiempo actual</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-3">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        globalRealtimeEfficiency >= 80 ? 'bg-green-600' :
                        globalRealtimeEfficiency >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                      }`}
                      style={{ width: `${Math.min(globalRealtimeEfficiency, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(globalDailyEfficiency, 'efficiency')}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider"> Diario Eficiencia</p>
                  </div>
                  <p className={`text-3xl font-bold ${getEfficiencyColor(globalDailyEfficiency)}`}>
                    {formatDecimal(globalDailyEfficiency)}%
                  </p>
                  <p className="text-xs text-gray-500 mt-2">basado en día completo</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-3 h-3 rounded-full ${getStatusDot(summary.targetAchievement, 'cumplimiento')}`}></span>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Cumplimiento</p>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{summary.targetAchievement?.toFixed(1)}%</p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div
                      className="bg-gray-900 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(summary.targetAchievement || 0, 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Line Performance Chart */}
        {!loading && lineData.length > 0 ? (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[600px] sm:min-w-0 px-4 sm:px-0">
              <ResponsiveContainer width="100%" height={isMobile ? 350 : 450}>
                <ComposedChart
                  data={(() => {
                    // First, ensure we have unique line numbers
                    const uniqueLines = [...new Set(lineData.map(item => item.lineNo))];
                    
                    // Sort line numbers numerically
                    const sortedLineNos = uniqueLines.sort((a, b) => {
                      const numA = parseInt(a) || 0;
                      const numB = parseInt(b) || 0;
                      return numA - numB;
                    });
                    
                    // Map to chart data with proper aggregation
                    return sortedLineNos.map(lineNo => {
                      // Get all runs for this line
                      const runs = lineRunData[lineNo] || [];
                      
                      // Aggregate totals across all styles/runs for this line
                      const aggregatedData = runs.reduce((acc, run) => {
                        const sewed = calculateFinishedGarments(run);
                        const realtimeTarget = computeRealtimeTarget(run, date);
                        const realtimeEff = calculateRealtimeEfficiency(run, date);
                        const operatorsCount = run.run?.operators_count || 0;
                        const workingHours = run.run?.working_hours || 0;
                        const sam = run.run?.sam_minutes || 0;
                        const totalSAMOutput = sewed * sam;
                        const availableMinutes = operatorsCount * workingHours * 60;
                        
                        return {
                          totalSewed: acc.totalSewed + sewed,
                          realtimeTarget: acc.realtimeTarget + realtimeTarget,
                          realtimeEfficiency: acc.realtimeEfficiency + (realtimeEff !== null ? realtimeEff : 0),
                          totalSAMOutput: acc.totalSAMOutput + totalSAMOutput,
                          availableMinutes: acc.availableMinutes + availableMinutes,
                          operatorCount: acc.operatorCount + operatorsCount,
                          runCount: acc.runCount + 1,
                          // Store individual style data for tooltip
                          styles: [...acc.styles, {
                            name: run.style,
                            sewed,
                            realtimeTarget,
                            realtimeEfficiency: realtimeEff,
                            efficiency: availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0,
                            sam,
                            operators: operatorsCount
                          }]
                        };
                      }, {
                        totalSewed: 0,
                        realtimeTarget: 0,
                        realtimeEfficiency: 0,
                        totalSAMOutput: 0,
                        availableMinutes: 0,
                        operatorCount: 0,
                        runCount: 0,
                        styles: []
                      });

                      // Calculate weighted average efficiency for the line
                      const efficiency = aggregatedData.availableMinutes > 0 
                        ? (aggregatedData.totalSAMOutput / aggregatedData.availableMinutes) * 100 
                        : 0;
                      
                      // Average real-time efficiency across runs (only count non-null values)
                      const validRealtimeEffs = aggregatedData.styles
                        .filter(s => s.realtimeEfficiency !== null)
                        .map(s => s.realtimeEfficiency);
                      const avgRealtimeEfficiency = validRealtimeEffs.length > 0 
                        ? validRealtimeEffs.reduce((a, b) => a + b, 0) / validRealtimeEffs.length
                        : productionEnded ? efficiency : 0;

                      return {
                        lineNo: lineNo,
                        totalSewed: aggregatedData.totalSewed,
                        realtimeTarget: aggregatedData.realtimeTarget,
                        efficiency: Math.round(efficiency * 100) / 100,
                        realtimeEfficiency: Math.round(avgRealtimeEfficiency * 100) / 100,
                        styleCount: runs.length,
                        styles: aggregatedData.styles.sort((a, b) => a.name.localeCompare(b.name))
                      };
                    });
                  })()}
                  margin={{ top: 20, right: 30, left: 20, bottom: isMobile ? 70 : 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="lineNo"
                    type="category"
                    angle={isMobile ? -45 : 0}
                    textAnchor={isMobile ? 'end' : 'middle'}
                    height={isMobile ? 70 : 30}
                    interval={0}
                    tick={{ fontSize: isMobile ? 12 : 14, fill: '#4b5563' }}
                    label={{ value: 'Número de Línea', position: 'bottom', offset: 50, fill: '#6b7280' }}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={formatNumber}
                    stroke="#8884d8"
                    tick={{ fontSize: isMobile ? 12 : 14, fill: '#4b5563' }}
                    label={{ value: 'Cantidad', angle: -90, position: 'insideLeft', fill: '#6b7280' }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(value) => `${value}%`}
                    stroke="#10b981"
                    tick={{ fontSize: isMobile ? 12 : 14, fill: '#4b5563' }}
                    label={{ value: 'Eficiencia %', angle: 90, position: 'insideRight', fill: '#6b7280' }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        
                        return (
                          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-xl border border-gray-200 p-4 min-w-[320px]">
                            <div className="border-b border-gray-200 pb-2 mb-3">
                              <p className="font-bold text-gray-900 text-lg">
                                Línea {data.lineNo}
                              </p>
                              <p className="text-sm text-gray-500">
                                {data.styleCount} {data.styleCount === 1 ? 'estilo' : 'estilos'}
                              </p>
                            </div>
                            
                            {/* Show each style's details */}
                            {data.styles.map((style, idx) => (
                              <div key={idx} className="mb-4 last:mb-0">
                                <p className="font-semibold text-gray-800 text-base mb-2">
                                  {style.name}
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="bg-purple-50 p-3 rounded-lg">
                                    <span className="text-purple-600 text-xs block font-medium">Objetivo (ahora)</span>
                                    <span className="text-xl font-bold text-purple-700">
                                      {formatNumber(style.realtimeTarget)}
                                    </span>
                                  </div>
                                  <div className="bg-green-50 p-3 rounded-lg">
                                    <span className="text-green-600 text-xs block font-medium">Producido</span>
                                    <span className="text-xl font-bold text-green-700">
                                      {formatNumber(style.sewed)}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs text-gray-600">Diario Eficiencia:</span>
                                    <span className={`text-sm font-bold ${
                                      style.efficiency >= 80 ? 'text-green-600' :
                                      style.efficiency >= 60 ? 'text-yellow-600' :
                                      'text-red-600'
                                    }`}>
                                      {style.efficiency.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs text-gray-600">Eficiencia RT:</span>
                                    <span className={`text-sm font-bold ${
                                      style.realtimeEfficiency !== null && style.realtimeEfficiency >= 80 ? 'text-green-600' :
                                      style.realtimeEfficiency !== null && style.realtimeEfficiency >= 60 ? 'text-yellow-600' :
                                      style.realtimeEfficiency !== null ? 'text-red-600' :
                                      'text-gray-500'
                                    }`}>
                                      {style.realtimeEfficiency !== null ? `${style.realtimeEfficiency.toFixed(1)}%` : 'FIN'}
                                    </span>
                                  </div>
                                </div>
                                {idx < data.styles.length - 1 && (
                                  <div className="border-b border-gray-200 my-3"></div>
                                )}
                              </div>
                            ))}
                            
                            {/* Show totals */}
                            <div className="mt-4 pt-3 border-t-2 border-gray-200">
                              <p className="text-sm font-medium text-gray-700 mb-3">Totales de línea:</p>
                              <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="bg-gray-50 p-2 rounded-lg">
                                  <span className="text-xs text-gray-500 block">Objetivo RT</span>
                                  <span className="text-lg font-bold text-gray-900">{formatNumber(data.realtimeTarget)}</span>
                                </div>
                                <div className="bg-gray-50 p-2 rounded-lg">
                                  <span className="text-xs text-gray-500 block">Producido</span>
                                  <span className="text-lg font-bold text-gray-900">{formatNumber(data.totalSewed)}</span>
                                </div>
                                <div className="bg-gray-50 p-2 rounded-lg">
                                  <span className="text-xs text-gray-500 block">Eficiencia RT</span>
                                  <span className={`text-lg font-bold ${
                                    data.realtimeEfficiency >= 80 ? 'text-green-600' :
                                    data.realtimeEfficiency >= 60 ? 'text-yellow-600' :
                                    'text-red-600'
                                  }`}>
                                    {productionEnded ? `${data.efficiency.toFixed(1)}%` : `${data.realtimeEfficiency}%`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: isMobile ? 12 : 14, paddingTop: '20px' }}
                    iconType="circle"
                  />

                  <Bar
                    yAxisId="left"
                    dataKey="totalSewed"
                    fill="#10b981"
                    name="Producido"
                    barSize={isMobile ? 20 : 35}
                    radius={[4, 4, 0, 0]}
                  />

                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="realtimeTarget"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: isMobile ? 4 : 6, fill: "#8b5cf6", strokeWidth: 2, stroke: "white" }}
                    activeDot={{ r: 8, fill: "#8b5cf6", stroke: "white", strokeWidth: 2 }}
                    name="Objetivo (ahora)"
                  />

                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="realtimeEfficiency"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: isMobile ? 3 : 4, fill: "#f59e0b", strokeWidth: 2, stroke: "white" }}
                    activeDot={{ r: 6, fill: "#f59e0b", stroke: "white", strokeWidth: 2 }}
                    name={productionEnded ? "Eficiencia %" : "Eficiencia RT %"}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="text-center py-16 bg-gray-50 rounded-xl">
              <p className="text-gray-500 text-lg font-medium">
                No se encontraron datos de producción para esta fecha
              </p>
              <p className="text-gray-400 text-sm mt-2">
                Intenta seleccionar otra fecha
              </p>
            </div>
          )
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded-lg w-1/4 mb-6"></div>
              <div className="h-96 bg-gray-100 rounded-xl"></div>
            </div>
          </div>
        )}

        {/* Line Cards - Now showing multiple styles per line with after 5:36 PM logic */}
        {!loading && Object.keys(lineRunData).length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  Detalles de Estilos por Línea
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Haz clic en cualquier estilo para ver información detallada de producción
                </p>
              </div>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  En Ruta
                </span>
                <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                  Atrasado
                </span>
                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  Crítico
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {Object.entries(lineRunData).map(([lineNo, runs]) => (
                runs.map((run, idx) => {
                  const realtimeTarget = computeRealtimeTarget(run, date);
                  const sewed = calculateFinishedGarments(run);
                  const realtimeEff = calculateRealtimeEfficiency(run, date);
                  const dailyEff = calculateDailyEfficiency(run);
                  
                  // After 5:36 PM, show daily efficiency instead of real-time
                  const displayEfficiency = productionEnded ? dailyEff : (realtimeEff !== null ? realtimeEff : dailyEff);
                  const efficiencyLabel = productionEnded ? 'Efficiency' : 'Eff RT';
                  
                  const variance = sewed - realtimeTarget;
                  const variancePct = realtimeTarget > 0 ? (variance / realtimeTarget) * 100 : 0;
                  const status = getLineStatus(variancePct, realtimeTarget);
                  const achievementPct = realtimeTarget > 0 ? (sewed / realtimeTarget) * 100 : 0;
                  
                  // Calculate efficiency for this specific run
                  const operatorsCount = run.run?.operators_count || 0;
                  const workingHours = run.run?.working_hours || 0;
                  const sam = run.run?.sam_minutes || 0;
                  const availableMinutes = operatorsCount * workingHours * 60;
                  const totalSAMOutput = sewed * sam;
                  const efficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;

                  const statusColors = {
                    red: 'border-red-500 bg-red-50',
                    orange: 'border-orange-500 bg-orange-50',
                    green: 'border-green-500 bg-green-50',
                    yellow: 'border-yellow-500 bg-yellow-50',
                    blue: 'border-blue-500 bg-blue-50',
                    gray: 'border-gray-500 bg-gray-50'
                  };

                  return (
                    <div
                      key={`${lineNo}-${run.runId}-${idx}`}
                      onClick={() => navigate(`/admin-dashboard?line=${lineNo}&date=${date}&runId=${run.runId}`)}
                      onMouseEnter={() => setHoveredCard(`${lineNo}-${run.runId}`)}
                      onMouseLeave={() => setHoveredCard(null)}
                      className={`group bg-white rounded-2xl shadow-lg 
                        hover:shadow-2xl transition-all duration-300
                        transform hover:-translate-y-2
                        cursor-pointer overflow-hidden border-2 ${
                        hoveredCard === `${lineNo}-${run.runId}` ? statusColors[status.color] : 'border-transparent'
                      }`}
                    >
                      <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-lg font-bold">Línea {lineNo}</span>
                            <span className="text-xs bg-white/20 text-white px-2 py-1 rounded-full">
                              {run.style}
                            </span>
                          </div>
                          <div className="bg-white/20 px-3 py-1 rounded-full">
                            <span className="text-xs font-semibold text-white">{status.text}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-5">
                        {/* Efficiency Section - Changes after 5:36 PM */}
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-3 h-3 rounded-full ${getEfficiencyDotColor(displayEfficiency)}`}></span>
                              <span className="text-sm font-medium text-gray-700">{efficiencyLabel}</span>
                            </div>
                            <span className={`text-lg font-bold ${getEfficiencyColor(displayEfficiency)}`}>
                              {displayEfficiency.toFixed(1)}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${
                                displayEfficiency >= 80 ? 'bg-green-600' :
                                displayEfficiency >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                              }`}
                              style={{ width: `${Math.min(displayEfficiency, 100)}%` }}
                            ></div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500 mb-1">Objetivo (ahora)</p>
                            <p className="text-lg font-bold text-gray-900">{formatNumber(realtimeTarget)}</p>
                          </div>
                          <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-xs text-gray-500 mb-1">Cosido</p>
                            <p className="text-lg font-bold text-gray-900">{formatNumber(sewed)}</p>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                          <span className="text-sm text-gray-600">Variación</span>
                          <span
                            className={`font-mono font-bold flex items-center gap-1 ${
                              variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-600'
                            }`}
                          >
                            <span className="text-lg">{variance > 0 ? '↑' : variance < 0 ? '↓' : '→'}</span>
                            {variance > 0 ? '+' : ''}{formatNumber(variance)}
                            <span className="text-xs ml-1">
                              ({variancePct > 0 ? '+' : ''}{variancePct.toFixed(1)}%)
                            </span>
                          </span>
                        </div>

                        <div className="mt-4 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <span className="text-xs font-medium text-gray-900 bg-gray-100 px-4 py-2 rounded-full">
                            Haz clic para ver detalles →
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ))}
            </div>
          </div>
        )}

        {/* Assignments Table */}
        {!loading && assignments.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Contribuciones de ayuda</h2>
            <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left">Línea</th>
                      <th className="px-4 py-3 text-left">Operador lento</th>
                      <th className="px-4 py-3 text-left">Ayudado por</th>
                      <th className="px-4 py-3 text-left">Piezas ayudadas (total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-3 font-medium">Línea {a.line_no}</td>
                        <td className="px-4 py-3">
                          Op. {a.source_operator_no}{" "}
                          {a.source_operator_name ? `(${a.source_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-3">
                          Op. {a.target_operator_no}{" "}
                          {a.target_operator_name ? `(${a.target_operator_name})` : ""}
                        </td>
                        <td className="px-4 py-3">{Math.round(a.total_helped_pieces)} pcs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-6 bg-white/80 backdrop-blur-sm border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-gray-500">
            Sistema de Monitoreo de Producción • Panel de Supervisor • {new Date().toLocaleDateString('es-MX')}
          </p>
        </div>
      </footer>
    </div>
  );
}