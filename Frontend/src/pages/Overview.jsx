// Overview.jsx - Skyrina Dashboard with vertical bar chart and product table (Fully Responsive)
// UPDATED: Shows full numbers instead of K/M suffixes

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';

import NavCeo from '../components/NavCeo';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

// Helper to format numbers with commas (NO K/M suffix - show full number)
const formatNumber = (value) => {
  if (value == null || isNaN(value)) return '0';
  const num = Number(value);
  // Show full number with commas for thousands
  return Math.round(num).toLocaleString();
};

// Helper to format percentage (NO ROUNDING - show 1 decimal place)
const formatPercent = (value) => {
  if (value == null || isNaN(value)) return '0%';
  // Show 1 decimal place for better precision without rounding the actual value
  return value.toFixed(1) + '%';
};

// Helper to format percentage change
const formatChange = (current, previous) => {
  if (!previous || previous === 0) return { value: '0%', isUp: true, raw: 0 };
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change).toFixed(0) + '%',
    isUp: change >= 0,
    raw: change
  };
};

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

// Helper function to calculate efficiency for a run (based on SAM)
const calculateRunEfficiency = (runData) => {
  if (!runData) return 0;
  
  const sewed = calculateFinishedGarments(runData);
  const operatorsCount = runData.run?.operators_count || 0;
  const workingHours = runData.run?.working_hours || 0;
  const sam = runData.run?.sam_minutes || 0;
  
  if (operatorsCount === 0 || workingHours === 0 || sam === 0) return 0;
  
  const availableMinutes = operatorsCount * workingHours * 60;
  const totalSAMOutput = sewed * sam;
  const efficiency = availableMinutes > 0 ? (totalSAMOutput / availableMinutes) * 100 : 0;
  
  return efficiency;  // NO ROUNDING - keep exact value
};

// Helper function to get bar color based on efficiency
const getBarColor = (efficiency) => {
  if (efficiency >= 90) return '#15803d';
  if (efficiency >= 80) return '#10b981';
  if (efficiency >= 70) return '#84cc16';
  if (efficiency >= 60) return '#f97316';
  return '#ef4444';
};

// Helper function to get efficiency text color class
const getEfficiencyColorClass = (efficiency) => {
  if (efficiency >= 90) return 'text-dark-green-600';
  if (efficiency >= 80) return 'text-green-600';
  if (efficiency >= 70) return 'text-lime-600';
  if (efficiency >= 60) return 'text-orange-600';
  return 'text-red-600';
};

// Helper to convert YYYY-MM-DD to local Date object
const getLocalDateFromYMD = (dateString) => {
  if (!dateString) return new Date();
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// KPI Card Component
const KPICard = ({ title, value, change, isUp, subtitle, loading, efficiencyColor }) => (
  <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100 hover:shadow-xl transition-all duration-300">
    <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wider mb-1 sm:mb-2">{title}</p>
    {loading ? (
      <div className="animate-pulse">
        <div className="h-6 sm:h-8 bg-gray-200 rounded w-20 sm:w-24 mb-1 sm:mb-2"></div>
        <div className="h-2 sm:h-3 bg-gray-100 rounded w-12 sm:w-16"></div>
      </div>
    ) : (
      <>
        <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
          <span className={`text-2xl sm:text-4xl font-bold ${efficiencyColor || 'text-gray-900'}`}>
            {title.includes('Efficiency') ? formatPercent(value) : formatNumber(value)}
          </span>
          {change && (
            <span className={`text-xs sm:text-sm font-semibold flex items-center gap-1 ${isUp ? 'text-green-600' : 'text-red-500'}`}>
              {isUp ? '↑' : '↓'} {change}
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-gray-400 mt-1 sm:mt-2">{subtitle}</p>}
      </>
    )}
  </div>
);

// Custom Tooltip for Composed Chart
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const getTooltipEfficiencyColor = (eff) => {
      if (eff >= 90) return 'text-dark-green-600';
      if (eff >= 80) return 'text-green-600';
      if (eff >= 70) return 'text-lime-600';
      if (eff >= 60) return 'text-orange-600';
      return 'text-red-600';
    };
    return (
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2 sm:p-4">
        <p className="font-bold text-gray-900 mb-1 sm:mb-2 text-sm sm:text-base">Line {data.lineNo}</p>
        <div className="space-y-0.5 sm:space-y-1">
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="w-2 h-2 sm:w-3 sm:h-3 bg-blue-500 rounded"></span>
            <span className="text-xs sm:text-sm text-gray-600">Quantity:</span>
            <span className="text-xs sm:text-sm font-semibold text-gray-900">{formatNumber(data.quantity)}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="w-2 h-2 sm:w-3 sm:h-3 bg-purple-500 rounded"></span>
            <span className="text-xs sm:text-sm text-gray-600">Target:</span>
            <span className="text-xs sm:text-sm font-semibold text-gray-900">{formatNumber(data.target)}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="w-2 h-2 sm:w-3 sm:h-3 rounded" style={{ backgroundColor: getBarColor(data.efficiency) }}></span>
            <span className="text-xs sm:text-sm text-gray-600">Efficiency:</span>
            <span className={`text-xs sm:text-sm font-semibold ${getTooltipEfficiencyColor(data.efficiency)}`}>
              {formatPercent(data.efficiency)}
            </span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 text-center">
          <p className="text-xs text-blue-600">Click to view line details</p>
        </div>
      </div>
    );
  }
  return null;
};

// Line Performance Table Row Component
const LineTableRow = ({ line, rank }) => {
  const getComplianceColor = (compliance) => {
    if (compliance >= 90) return 'text-dark-green-600 bg-dark-green-50';
    if (compliance >= 80) return 'text-green-600 bg-green-50';
    if (compliance >= 70) return 'text-lime-600 bg-lime-50';
    if (compliance >= 60) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const getProgressBarColor = (compliance) => {
    if (compliance >= 90) return 'bg-dark-green-500';
    if (compliance >= 80) return 'bg-green-500';
    if (compliance >= 70) return 'bg-lime-500';
    if (compliance >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-2 sm:px-4 py-2 sm:py-3">
        <span className="text-xs sm:text-sm text-gray-500 font-medium">{rank}</span>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3">
        <span className="text-xs sm:text-sm font-semibold text-gray-800" title={line.lineNo}>
          {line.lineNo}
        </span>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3">
        <span className="text-xs sm:text-sm font-medium text-gray-700">{line.style || 'N/A'}</span>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">
        <span className="text-xs sm:text-sm font-medium text-gray-700">{formatNumber(line.target)}</span>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">
        <span className="text-xs sm:text-sm font-medium text-gray-700">{formatNumber(line.produced)}</span>
      </td>
      <td className="px-2 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center gap-1 sm:gap-2">
          <div className="flex-1 h-1.5 sm:h-2 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className={`h-full ${getProgressBarColor(line.compliance)} transition-all duration-500 rounded-full`}
              style={{ width: `${Math.min(line.compliance, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full ${getComplianceColor(line.compliance)} min-w-[50px] sm:min-w-[60px] text-center`}>
            {formatPercent(line.compliance)}
          </span>
        </div>
      </td>
    </tr>
  );
};

// Mobile Line Card Component
const MobileLineCard = ({ line, rank }) => {
  const getComplianceColor = (compliance) => {
    if (compliance >= 90) return 'text-dark-green-600';
    if (compliance >= 80) return 'text-green-600';
    if (compliance >= 70) return 'text-lime-600';
    if (compliance >= 60) return 'text-orange-600';
    return 'text-red-600';
  };

  const getProgressBarColor = (compliance) => {
    if (compliance >= 90) return 'bg-dark-green-500';
    if (compliance >= 80) return 'bg-green-500';
    if (compliance >= 70) return 'bg-lime-500';
    if (compliance >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-gray-50 rounded-lg p-3 mb-2">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">#{rank}</span>
          <span className="text-sm font-semibold text-gray-800">Line {line.lineNo}</span>
        </div>
        <span className={`text-sm font-bold ${getComplianceColor(line.compliance)}`}>
          {formatPercent(line.compliance)}
        </span>
      </div>
      <div className="text-xs text-gray-600 mb-2">Style: {line.style || 'N/A'}</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-gray-500">Target:</span>
          <span className="ml-1 font-medium">{formatNumber(line.target)}</span>
        </div>
        <div>
          <span className="text-gray-500">Produced:</span>
          <span className="ml-1 font-medium">{formatNumber(line.produced)}</span>
        </div>
      </div>
      <div className="mt-2">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full ${getProgressBarColor(line.compliance)} transition-all duration-500 rounded-full`}
            style={{ width: `${Math.min(line.compliance, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default function Overview() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRangeType, setDateRangeType] = useState('day');
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [selectedWeek, setSelectedWeek] = useState(getWeekString(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  });
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  
  // Custom date range states
  const [customStartDate, setCustomStartDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  
  // FILTER STATES
  const [selectedStyle, setSelectedStyle] = useState('all');
  const [selectedLine, setSelectedLine] = useState('all');
  const [availableStyles, setAvailableStyles] = useState([]);
  const [availableLines, setAvailableLines] = useState([]);
  
  // State for selected line details
  const [selectedLineDetails, setSelectedLineDetails] = useState(null);
  const [lineDetailsData, setLineDetailsData] = useState(null);
  const [showLineDetails, setShowLineDetails] = useState(false);
  
  const [stats, setStats] = useState({
    currentPeriod: 0,
    previousPeriod: 0,
    stylePerformance: [],
    linePerformance: [],
    totalTarget: 0,
    totalEfficiency: 0,
    activeLines: 0,
    lineChartData: []
  });

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper to get week string (YYYY-Www)
  function getWeekString(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  // Get date range based on selection
  const getDateRange = () => {
    let startDate, endDate, prevStartDate, prevEndDate;
    
    switch (dateRangeType) {
      case 'day':
        startDate = getLocalDateFromYMD(selectedDate);
        endDate = getLocalDateFromYMD(selectedDate);
        prevStartDate = getLocalDateFromYMD(selectedDate);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(prevStartDate);
        break;
        
      case 'week': {
        const [year, week] = selectedWeek.split('-W');
        startDate = getDateFromWeek(parseInt(year), parseInt(week));
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(startDate.getDate() - 7);
        prevEndDate = new Date(prevStartDate);
        prevEndDate.setDate(prevStartDate.getDate() + 6);
        break;
      }
        
      case 'month': {
        const [year, month] = selectedMonth.split('-');
        startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        endDate = new Date(parseInt(year), parseInt(month), 0);
        
        prevStartDate = new Date(parseInt(year), parseInt(month) - 2, 1);
        prevEndDate = new Date(parseInt(year), parseInt(month) - 1, 0);
        break;
      }
        
      case 'year':
        startDate = new Date(parseInt(selectedYear), 0, 1);
        endDate = new Date(parseInt(selectedYear), 11, 31);
        
        prevStartDate = new Date(parseInt(selectedYear) - 1, 0, 1);
        prevEndDate = new Date(parseInt(selectedYear) - 1, 11, 31);
        break;
        
      case 'custom':
        startDate = getLocalDateFromYMD(customStartDate);
        endDate = getLocalDateFromYMD(customEndDate);
        // For custom range, calculate previous period of same length
        const dayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(startDate.getDate() - dayCount);
        prevEndDate = new Date(endDate);
        prevEndDate.setDate(endDate.getDate() - dayCount);
        break;
        
      default:
        startDate = getLocalDateFromYMD(selectedDate);
        endDate = getLocalDateFromYMD(selectedDate);
        prevStartDate = getLocalDateFromYMD(selectedDate);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(prevStartDate);
    }
    
    return { startDate, endDate, prevStartDate, prevEndDate };
  };

  // Get date from ISO week
  function getDateFromWeek(year, week) {
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - jan4Day + 1);
    const targetMonday = new Date(firstMonday);
    targetMonday.setDate(firstMonday.getDate() + (week - 1) * 7);
    return targetMonday;
  }

  // Generate week options
  const weekOptions = useMemo(() => {
    const options = [];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i * 7);
      const weekStr = getWeekString(d);
      const weekStart = getDateFromWeek(parseInt(weekStr.split('-W')[0]), parseInt(weekStr.split('-W')[1]));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      options.push({
        value: weekStr,
        label: `${weekStr} (${weekStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })})`
      });
    }
    return options;
  }, []);

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
        if (user.role !== 'skyrina' && user.role !== 'engineer' && user.role !== 'supervisor' 
          && user.role !== 'master'
        ) {
          navigate('/', { replace: true });
          return;
        }
        setUser(user);
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/', { replace: true });
      });
  }, [navigate]);

  // Fetch data when date range or filters change
  useEffect(() => {
    if (user) {
      fetchAllData();
      setSelectedLineDetails(null);
      setShowLineDetails(false);
    }
  }, [user, dateRangeType, selectedDate, selectedWeek, selectedMonth, selectedYear, customStartDate, customEndDate, selectedStyle, selectedLine]);

  // Function to handle line click from chart
  const handleLineClick = async (data) => {
    if (!data || !data.lineNo) return;
    
    setSelectedLineDetails(data.lineNo);
    setShowLineDetails(true);
    setLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const { startDate, endDate } = getDateRange();
      
      const lineDetails = await fetchLineDetails(data.lineNo, startDate, endDate, headers);
      setLineDetailsData(lineDetails);
    } catch (err) {
      console.error('Error fetching line details:', err);
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch detailed line data
const fetchLineDetails = async (lineNo, startDate, endDate, headers) => {
  try {
    let totalSewed = 0;
    let totalTarget = 0;
    let totalSAMOutput = 0;
    let totalAvailableMinutes = 0;
    const runsData = [];
    const uniqueRuns = new Set();
    
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      try {
        const runsRes = await axios.get(`${API_BASE}/api/line-runs/${lineNo}`, { headers });
        if (runsRes.data.success) {
          const runsForDate = runsRes.data.runs.filter(r => {
            const runDate = new Date(r.run_date).toISOString().split('T')[0];
            return runDate === dateStr;
          });
          
          for (const run of runsForDate) {
            if (uniqueRuns.has(run.id)) continue;
            uniqueRuns.add(run.id);
            
            const detailRes = await axios.get(`${API_BASE}/api/get-run-data/${run.id}`, { headers });
            if (detailRes.data.success) {
              const sewed = calculateFinishedGarments(detailRes.data);
              const target = detailRes.data.run?.target_pcs || 0;
              const operatorsCount = detailRes.data.run?.operators_count || 0;
              const workingHours = detailRes.data.run?.working_hours || 0;
              const sam = detailRes.data.run?.sam_minutes || 0;
              const efficiency = calculateRunEfficiency(detailRes.data);
              
              totalSewed += sewed;
              totalTarget += target;
              totalSAMOutput += sewed * sam;
              totalAvailableMinutes += operatorsCount * workingHours * 60;
              
              runsData.push({
                id: run.id,
                date: dateStr,
                style: run.style,
                sewed,
                target,
                efficiency,  // Already exact value
                sam,
                operators: operatorsCount,
                workingHours
              });
            }
          }
        }
      } catch (err) {
        console.error(`Error fetching data for line ${lineNo} on ${dateStr}:`, err);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const overallEfficiency = totalAvailableMinutes > 0 
      ? (totalSAMOutput / totalAvailableMinutes) * 100 
      : 0;
    
    return {
      lineNo,
      totalSewed,
      totalTarget,
      overallEfficiency,  // NO ROUNDING - keep exact value
      runs: runsData.sort((a, b) => a.date.localeCompare(b.date))
    };
  } catch (err) {
    console.error('Error fetching line details:', err);
    return null;
  }
};

  const fetchAllData = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    
    try {
      const { startDate, endDate, prevStartDate, prevEndDate } = getDateRange();
      
      const [currentData, previousData, lineChartData, styleData, lineData, stylesList, linesList] = await Promise.all([
        fetchPeriodSummary(startDate, endDate, headers, selectedStyle, selectedLine),
        fetchPeriodSummary(prevStartDate, prevEndDate, headers, selectedStyle, selectedLine),
        fetchLineChartData(startDate, endDate, headers, selectedStyle, selectedLine),
        fetchStylePerformance(startDate, endDate, headers, selectedStyle, selectedLine),
        fetchLinePerformance(startDate, endDate, headers, selectedStyle, selectedLine),
        fetchAvailableStyles(startDate, endDate, headers),
        fetchAvailableLines(startDate, endDate, headers)
      ]);
      
      setAvailableStyles(stylesList);
      setAvailableLines(linesList);
      
      setStats({
        currentPeriod: currentData.totalSewed,
        previousPeriod: previousData.totalSewed,
        stylePerformance: styleData,
        linePerformance: lineData,
        totalTarget: currentData.totalTarget,
        totalEfficiency: currentData.avgEfficiency,
        activeLines: currentData.linesUsed,
        lineChartData: lineChartData
      });
    } catch (err) {
      console.error('Error fetching skyrina data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPeriodSummary = async (startDate, endDate, headers, styleFilter, lineFilter) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      let url = `${API_BASE}/api/skyrina/period-summary?startDate=${startStr}&endDate=${endStr}`;
      if (styleFilter !== 'all') url += `&style=${encodeURIComponent(styleFilter)}`;
      if (lineFilter !== 'all') url += `&lineNo=${lineFilter}`;
      
      const res = await axios.get(url, { headers });
      
      if (res.data.success) {
        return {
          totalSewed: res.data.summary.totalSewed || 0,
          totalTarget: res.data.summary.totalTarget || 0,
          avgEfficiency: res.data.summary.avgEfficiency || 0,
          linesUsed: res.data.summary.linesUsed || 0,
          totalRuns: res.data.summary.totalRuns || 0
        };
      }
    } catch (e) {
      console.error('Error fetching period summary:', e);
    }
    return { totalSewed: 0, totalTarget: 0, avgEfficiency: 0, linesUsed: 0, totalRuns: 0 };
  };

  const fetchLineChartData = async (startDate, endDate, headers, styleFilter, lineFilter) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      let url = `${API_BASE}/api/skyrina/line-efficiency?startDate=${startStr}&endDate=${endStr}`;
      if (styleFilter !== 'all') url += `&style=${encodeURIComponent(styleFilter)}`;
      if (lineFilter !== 'all') url += `&lineNo=${lineFilter}`;
      
      const res = await axios.get(url, { headers });
      
      if (res.data.success && res.data.lines) {
        return res.data.lines;
      }
      return [];
    } catch (err) {
      console.error('Error fetching line chart data:', err);
      return [];
    }
  };
  
  const fetchStylePerformance = async (startDate, endDate, headers, styleFilter, lineFilter) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      let url = `${API_BASE}/api/skyrina/style-performance?startDate=${startStr}&endDate=${endStr}`;
      if (styleFilter !== 'all') url += `&style=${encodeURIComponent(styleFilter)}`;
      if (lineFilter !== 'all') url += `&lineNo=${lineFilter}`;
      
      const res = await axios.get(url, { headers });
      
      if (res.data.success && res.data.styles) {
        return res.data.styles;
      }
      return [];
    } catch (err) {
      console.error('Error fetching style performance:', err);
      return [];
    }
  };

  const fetchLinePerformance = async (startDate, endDate, headers, styleFilter, lineFilter) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      let url = `${API_BASE}/api/skyrina/line-performance-detail?startDate=${startStr}&endDate=${endStr}`;
      if (styleFilter !== 'all') url += `&style=${encodeURIComponent(styleFilter)}`;
      if (lineFilter !== 'all') url += `&lineNo=${lineFilter}`;
      
      const res = await axios.get(url, { headers });
      
      if (res.data.success && res.data.lines) {
        return res.data.lines;
      }
      return [];
    } catch (err) {
      console.error('Error fetching line performance:', err);
      return [];
    }
  };

  const fetchAvailableStyles = async (startDate, endDate, headers) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      const res = await axios.get(
        `${API_BASE}/api/skyrina/available-styles?startDate=${startStr}&endDate=${endStr}`,
        { headers }
      );
      
      if (res.data.success && res.data.styles) {
        return ['all', ...res.data.styles];
      }
      return ['all'];
    } catch (err) {
      console.error('Error fetching available styles:', err);
      return ['all'];
    }
  };

  const fetchAvailableLines = async (startDate, endDate, headers) => {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      const res = await axios.get(
        `${API_BASE}/api/skyrina/available-lines?startDate=${startStr}&endDate=${endStr}`,
        { headers }
      );
      
      if (res.data.success && res.data.lines) {
        return ['all', ...res.data.lines];
      }
      return ['all'];
    } catch (err) {
      console.error('Error fetching available lines:', err);
      return ['all'];
    }
  };

  const maxStyleValue = stats.stylePerformance.length > 0 
    ? Math.max(...stats.stylePerformance.map(s => s.produced)) 
    : 1;

  const periodChange = formatChange(stats.currentPeriod, stats.previousPeriod);

  const getPeriodTitle = () => {
    switch (dateRangeType) {
      case 'day': {
        const localDate = getLocalDateFromYMD(selectedDate);
        return localDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      case 'week':
        return `Week ${selectedWeek}`;
      case 'month': {
        const [year, month] = selectedMonth.split('-');
        const localDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        return localDate.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long' 
        });
      }
      case 'year':
        return `Year ${selectedYear}`;
      case 'custom': {
        const start = getLocalDateFromYMD(customStartDate);
        const end = getLocalDateFromYMD(customEndDate);
        return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
      default:
        return '';
    }
  };

  const clearLineFilter = () => {
    setSelectedLineDetails(null);
    setShowLineDetails(false);
    setLineDetailsData(null);
  };

  if (!user) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="text-center px-4">
          <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-gray-200 border-t-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">Loading Skyrina...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      <NavCeo/>
      
      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        {/* Header */}
        <div className="mb-4 sm:mb-6 md:mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2 sm:gap-3">
                <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Skyrina
                </span>
                <span className="text-xs sm:text-sm font-normal text-gray-500 bg-gray-100 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full">
                  Executive Panel
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1">
                Welcome, <span className="font-semibold">{user.full_name || user.username}</span>
              </p>
            </div>
            
            {/* Mobile Filter Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="sm:hidden flex items-center gap-2 px-4 py-2 bg-white rounded-xl shadow-sm border border-gray-200"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span className="text-sm text-gray-600">Filters</span>
            </button>
            
            {/* Filter Controls - Desktop */}
            <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto mt-3 sm:mt-0`}>
              <select
                value={dateRangeType}
                onChange={(e) => setDateRangeType(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="custom">Custom Range</option>
              </select>
              
              {dateRangeType === 'day' && (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              
              {dateRangeType === 'week' && (
                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] sm:min-w-[280px]"
                >
                  {weekOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              
              {dateRangeType === 'month' && (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              
              {dateRangeType === 'year' && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {[2024, 2025, 2026].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              )}
              
              {dateRangeType === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Start Date</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">End Date</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="bg-white border border-gray-200 rounded-xl px-3 sm:px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
              
              <button
                onClick={() => {
                  localStorage.removeItem('token');
                  localStorage.removeItem('user');
                  navigate('/');
                }}
                className="text-gray-500 hover:text-gray-700 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* FILTERS: Style and Line */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 mb-4 sm:mb-6">
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-gray-500 font-medium">Style</span>
            <select
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
            >
              {availableStyles.map(style => (
                <option key={style} value={style}>
                  {style === 'all' ? 'All Styles' : style}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-gray-500 font-medium">Line</span>
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
            >
              {availableLines.map(line => (
                <option key={line} value={line}>
                  {line === 'all' ? 'All Lines' : `Line ${line}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Period Title */}
        <div className="mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="w-1 h-4 sm:h-6 bg-blue-600 rounded-full"></span>
            Production - {getPeriodTitle()}
          </h2>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 mb-6 sm:mb-8">
          <KPICard 
            title="Total Target"
            value={stats.totalTarget}
            subtitle="target pieces"
            loading={loading}
          />
          <KPICard 
            title="Total Produced"
            value={stats.currentPeriod}
            change={periodChange.value}
            isUp={periodChange.isUp}
            subtitle={`vs previous period (${formatNumber(stats.previousPeriod)})`}
            loading={loading}
          />
          <KPICard 
            title="Daily Efficiency"
            value={stats.totalEfficiency}
            subtitle="based on SAM"
            loading={loading}
            efficiencyColor={getEfficiencyColorClass(stats.totalEfficiency)}
          />
          <KPICard 
            title="Active Lines"
            value={stats.activeLines}
            subtitle="lines with production"
            loading={loading}
          />
        </div>

        {/* Line Performance Chart */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-6 sm:mb-8 border border-gray-100">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 sm:mb-4">
            <h3 className="text-base sm:text-lg font-bold text-gray-900">Line Performance</h3>
            {showLineDetails && selectedLineDetails && (
              <button
                onClick={clearLineFilter}
                className="mt-2 sm:mt-0 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                View all lines
              </button>
            )}
          </div>
          
          {loading ? (
            <div className="h-64 sm:h-80 bg-gray-100 rounded-xl animate-pulse"></div>
          ) : stats.lineChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={isMobile ? 350 : 400}>
                <ComposedChart
                  data={showLineDetails && selectedLineDetails 
                    ? stats.lineChartData.filter(line => String(line.lineNo) === String(selectedLineDetails))
                    : stats.lineChartData
                  }
                  margin={{ top: 20, right: 30, left: 20, bottom: isMobile ? 70 : 40 }}
                  onClick={(data) => {
                    if (data && data.activePayload && data.activePayload.length) {
                      const clickedData = data.activePayload[0].payload;
                      handleLineClick(clickedData);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="lineNo" 
                    type="category"
                    angle={isMobile ? -45 : 0}
                    textAnchor={isMobile ? 'end' : 'middle'}
                    height={isMobile ? 70 : 30}
                    interval={0}
                    tick={{ fill: '#6b7280', fontSize: isMobile ? 10 : 12, cursor: 'pointer' }}
                    axisLine={{ stroke: '#d1d5db' }}
                    tickLine={false}
                    label={{ value: 'Line Number', position: 'bottom', offset: isMobile ? 50 : 30, fill: '#6b7280' }}
                  />
                  <YAxis 
                    yAxisId="left"
                    tickFormatter={formatNumber}
                    tick={{ fill: '#6b7280', fontSize: isMobile ? 10 : 12 }}
                    axisLine={{ stroke: '#d1d5db' }}
                    tickLine={false}
                    width={40}
                    label={{ value: 'Quantity', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(value) => `${value}%`}
                    tick={{ fill: '#6b7280', fontSize: isMobile ? 10 : 12 }}
                    axisLine={{ stroke: '#d1d5db' }}
                    tickLine={false}
                    domain={[0, 100]}
                    width={35}
                    label={{ value: 'Efficiency %', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                    wrapperStyle={{ fontSize: isMobile ? 10 : 12, paddingTop: '20px' }}
                    iconType="circle"
                  />
                  
                  <Bar 
                    yAxisId="left"
                    dataKey="quantity" 
                    name="Quantity Produced"
                    barSize={isMobile ? 20 : 35}
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(data) => {
                      if (data && data.payload) {
                        handleLineClick(data.payload);
                      }
                    }}
                  >
                    {stats.lineChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getBarColor(entry.efficiency)} cursor="pointer" />
                    ))}
                  </Bar>
                  
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="target"
                    stroke="#8b5cf6"
                    strokeWidth={3}
                    dot={{ r: isMobile ? 4 : 6, fill: "#8b5cf6", strokeWidth: 2, stroke: "white", cursor: 'pointer' }}
                    activeDot={{ r: 8, fill: "#8b5cf6", stroke: "white", strokeWidth: 2, cursor: 'pointer', onClick: (data) => handleLineClick(data.payload) }}
                    name="Target"
                    cursor="pointer"
                  />
                  
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="efficiency"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: isMobile ? 3 : 4, fill: "#f59e0b", strokeWidth: 2, stroke: "white", cursor: 'pointer' }}
                    activeDot={{ r: 6, fill: "#f59e0b", stroke: "white", strokeWidth: 2, cursor: 'pointer', onClick: (data) => handleLineClick(data.payload) }}
                    name="Efficiency %"
                    cursor="pointer"
                  />
                </ComposedChart>
              </ResponsiveContainer>
              
              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mt-3 sm:mt-4">
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm" style={{ backgroundColor: '#15803d' }}></span>
                  <span className="text-xs text-gray-600">≥90%</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm" style={{ backgroundColor: '#10b981' }}></span>
                  <span className="text-xs text-gray-600">80-89%</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm" style={{ backgroundColor: '#84cc16' }}></span>
                  <span className="text-xs text-gray-600">70-79%</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm" style={{ backgroundColor: '#f97316' }}></span>
                  <span className="text-xs text-gray-600">60-69%</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm" style={{ backgroundColor: '#ef4444' }}></span>
                  <span className="text-xs text-gray-600">&lt;60%</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="w-2 h-2 sm:w-3 sm:h-3 rounded-sm bg-purple-500"></span>
                  <span className="text-xs text-gray-600">Target</span>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 sm:py-16 text-gray-400">
              <p>No line production data available</p>
            </div>
          )}
        </div>

        {/* Line Details Section */}
        {showLineDetails && lineDetailsData && (
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-6 sm:mb-8 border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                Line {lineDetailsData.lineNo} Details
              </h3>
              <button
                onClick={clearLineFilter}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ✕ Close
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-xs text-blue-600 font-medium">Total Produced</p>
                <p className="text-2xl font-bold text-blue-700">{formatNumber(lineDetailsData.totalSewed)}</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <p className="text-xs text-purple-600 font-medium">Total Target</p>
                <p className="text-2xl font-bold text-purple-700">{formatNumber(lineDetailsData.totalTarget)}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-xs text-green-600 font-medium">Overall Efficiency</p>
                <p className={`text-2xl font-bold ${getEfficiencyColorClass(lineDetailsData.overallEfficiency)}`}>
                  {formatPercent(lineDetailsData.overallEfficiency)}
                </p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <h4 className="font-semibold text-gray-700 mb-3">Daily Production</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Style</th>
                    <th className="px-4 py-2 text-right">Target</th>
                    <th className="px-4 py-2 text-right">Produced</th>
                    <th className="px-4 py-2 text-right">Efficiency</th>
                    <th className="px-4 py-2 text-center">Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {lineDetailsData.runs.map((run, idx) => {
                    const compliance = run.target > 0 ? (run.sewed / run.target) * 100 : 0;
                    const getComplianceBarColor = (comp) => {
                      if (comp >= 90) return 'bg-dark-green-500';
                      if (comp >= 80) return 'bg-green-500';
                      if (comp >= 70) return 'bg-lime-500';
                      if (comp >= 60) return 'bg-orange-500';
                      return 'bg-red-500';
                    };
                    return (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{run.date}</td>
                        <td className="px-4 py-2 font-medium">{run.style}</td>
                        <td className="px-4 py-2 text-right">{formatNumber(run.target)}</td>
                        <td className="px-4 py-2 text-right">{formatNumber(run.sewed)}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={getEfficiencyColorClass(run.efficiency)}>
                            {formatPercent(run.efficiency)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${getComplianceBarColor(compliance)} rounded-full`}
                                style={{ width: `${Math.min(compliance, 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium w-12 ${getEfficiencyColorClass(compliance)}`}>
                              {formatPercent(compliance)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Two Column Layout - Style Performance (Left) and Line Performance Detail (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 mb-6 sm:mb-8">
          {/* Left Side: Style Performance Bar Chart */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4 sm:mb-6">Style Performance (Top 15)</h3>
            
            {loading ? (
              <div className="space-y-2 sm:space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="flex items-center gap-2 sm:gap-3 animate-pulse">
                    <div className="w-5 sm:w-6 h-3 sm:h-4 bg-gray-200 rounded"></div>
                    <div className="w-24 sm:w-32 h-3 sm:h-4 bg-gray-200 rounded"></div>
                    <div className="flex-1 h-6 sm:h-8 bg-gray-100 rounded-lg"></div>
                  </div>
                ))}
              </div>
            ) : stats.stylePerformance.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 sm:pr-2">
                {stats.stylePerformance.slice(0, 15).map((style, index) => {
                  const percentage = maxStyleValue > 0 ? (style.produced / maxStyleValue) * 100 : 0;
                  return (
                    <div key={style.style} className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                      <span className="text-xs sm:text-sm text-gray-500 w-5 sm:w-6">{index + 1}.</span>
                      <span className="text-xs sm:text-sm font-medium text-gray-700 w-28 sm:w-36 md:w-40 truncate" title={style.style}>
                        {style.style.length > 15 ? style.style.substring(0, 15) + '...' : style.style}
                      </span>
                      <div className="flex-1 h-6 sm:h-8 bg-gray-100 rounded-lg overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg transition-all duration-500 flex items-center justify-end px-1 sm:px-2"
                          style={{ width: `${percentage}%` }}
                        >
                          <span className="text-white text-xs sm:text-sm font-semibold">
                            {formatNumber(style.produced)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 sm:py-12 text-gray-400">
                <p>No style production data available</p>
              </div>
            )}
            
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
              <span>Showing top {Math.min(stats.stylePerformance.length, 15)} styles</span>
              <span>Values in units produced</span>
            </div>
          </div>

          {/* Right Side: Line Performance Detail Table */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-4 sm:mb-6">Line Performance Detail</h3>
            
            {loading ? (
              <div className="space-y-2 sm:space-y-3 animate-pulse">
                <div className="h-8 sm:h-10 bg-gray-200 rounded-lg mb-3 sm:mb-4"></div>
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-10 sm:h-12 bg-gray-100 rounded-lg"></div>
                ))}
              </div>
            ) : stats.linePerformance.length > 0 ? (
              <>
                <div className="hidden md:block overflow-x-auto max-h-[450px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b-2 border-gray-200">
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-10">#</th>
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Line</th>
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Style</th>
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Target</th>
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Prod.</th>
                        <th className="px-2 sm:px-4 py-2 sm:py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[100px]">Compl.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.linePerformance.map((line, index) => (
                        <LineTableRow 
                          key={`${line.lineNo}-${line.style}`} 
                          line={line} 
                          rank={index + 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="md:hidden max-h-[450px] overflow-y-auto">
                  {stats.linePerformance.map((line, index) => (
                    <MobileLineCard 
                      key={`${line.lineNo}-${line.style}`} 
                      line={line} 
                      rank={index + 1}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 sm:py-12 text-gray-400">
                <p>No line performance data available</p>
              </div>
            )}
            
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
              <span>Total line entries: {stats.linePerformance.length}</span>
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#15803d' }}></span>
                  <span className="hidden sm:inline">≥90%</span>
                  <span className="sm:hidden">≥90</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }}></span>
                  <span className="hidden sm:inline">80-89%</span>
                  <span className="sm:hidden">80-89</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#84cc16' }}></span>
                  <span className="hidden sm:inline">70-79%</span>
                  <span className="sm:hidden">70-79</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f97316' }}></span>
                  <span className="hidden sm:inline">60-69%</span>
                  <span className="sm:hidden">60-69</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }}></span>
                  <span className="hidden sm:inline">&lt;60%</span>
                  <span className="sm:hidden">&lt;60</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto py-4 sm:py-6 bg-white/80 backdrop-blur-sm border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center">
          <p className="text-xs sm:text-sm text-gray-500">
            Skyrina • Executive Panel • {new Date().toLocaleDateString('en-US')}
          </p>
        </div>
      </footer>
    </div>
  );
}