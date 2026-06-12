import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const QualityInspectorPage = () => {
  const navigate = useNavigate();
  const [selectedLine, setSelectedLine] = useState('');
  const [lines, setLines] = useState([]);
  const [availableRuns, setAvailableRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [defectTypes, setDefectTypes] = useState([]);
  const [inspectorName, setInspectorName] = useState('');
  const [shiftSlot, setShiftSlot] = useState('');
  const [selectedDefectType, setSelectedDefectType] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [operatorNo, setOperatorNo] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionDefects, setSessionDefects] = useState([]);
  const [runStats, setRunStats] = useState({});
  const [user, setUser] = useState(null);

  const defectTypeSelectRef = useRef(null);
  const API_URL = 'http://localhost:5000';

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
      setInspectorName(JSON.parse(savedUser).full_name || JSON.parse(savedUser).username);
    }
    fetchLines();
    fetchDefectTypes();
  }, []);

  useEffect(() => {
    if (selectedLine) {
      fetchRunsForLine();
    }
  }, [selectedLine]);

  // Clear session defects when switching styles
  useEffect(() => {
    if (selectedRun && sessionDefects.length > 0) {
      if (window.confirm(`You have ${sessionDefects.length} unsaved defects for the previous style.
         Do you want to clear them?`)) {
        setSessionDefects([]);
      }
    }
  }, [selectedRun]);

  const getToken = () => localStorage.getItem('token');

  const fetchLines = async () => {
    try {
      const token = getToken();
      const response = await axios.get(`${API_URL}/api/quality/lines`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.data.success) {
        setLines(response.data.lines);
        if (response.data.lines.length > 0) {
          setSelectedLine(response.data.lines[0].line_no);
        }
      }
    } catch (error) {
      console.error('Error fetching lines:', error);
    }
  };

  const fetchRunsForLine = async () => {
    try {
      const token = getToken();
      const response = await axios.get(`${API_URL}/api/quality/lines/${selectedLine}/runs`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success && response.data.runs.length > 0) {
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        // Filter runs for today only
        const todayRuns = response.data.runs.filter(run => run.run_date === today);

        // If no runs for today, show all runs (limit to recent)
        let runsToUse = todayRuns.length > 0 ? todayRuns : response.data.runs.slice(0, 10);

        // Remove duplicates by style name (keep only unique styles)
        const uniqueRuns = [];
        const seenStyles = new Set();

        for (const run of runsToUse) {
          if (!seenStyles.has(run.style)) {
            seenStyles.add(run.style);
            uniqueRuns.push(run);
          }
        }

        setAvailableRuns(uniqueRuns);

        // Auto-select first run only if no run is currently selected
        if (uniqueRuns.length > 0 && !selectedRun) {
          setSelectedRun(uniqueRuns[0]);
        } else if (uniqueRuns.length > 0 && selectedRun) {
          // Check if current selected run still exists in the new list
          const stillExists = uniqueRuns.some(run => run.id === selectedRun.id);
          if (!stillExists) {
            setSelectedRun(uniqueRuns[0]);
          }
        }
      } else {
        setAvailableRuns([]);
        setSelectedRun(null);
      }
    } catch (error) {
      console.error('Error fetching runs:', error);
      setAvailableRuns([]);
    }
  };

  const fetchDefectTypes = async () => {
    try {
      const token = getToken();
      const response = await axios.get(`${API_URL}/api/quality/defect-types`,
    {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.data.success) {
        setDefectTypes(response.data.defectTypes);
      }
    } catch (error) {
      console.error('Error fetching defect types:', error);
    }
  };

  const fetchRunStats = async () => {
    if (!selectedRun) return;

    try {
      const token = getToken();
      const response = await axios.get(
        `${API_URL}/api/quality/inspections/${selectedLine}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.data.success) {
        // Get today's date
        const today = new Date().toISOString().split('T')[0];

        // Filter inspections for this specific style and today
        const runInspections = response.data.inspections.filter(
          i => i.style === selectedRun.style && i.inspection_date === today
        );
        const total = runInspections.reduce((sum, i) => sum + (i.total_defects || 0), 0);
        setRunStats(prev => ({
          ...prev,
          [selectedRun.id]: { todayTotal: total }
        }));
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const getReasonsForType = () => {
    if (!selectedDefectType) return [];

    const selectedSortOrder = parseInt(selectedDefectType);
    const type = defectTypes.find(t => t.sort_order === selectedSortOrder);

    if (type && type.reasons && Array.isArray(type.reasons)) {
      return type.reasons;
    }
    return [];
  };

  const getDefectTypeName = () => {
    if (!selectedDefectType) return 'Please Select';
    const selectedSortOrder = parseInt(selectedDefectType);
    const type = defectTypes.find(t => t.sort_order === selectedSortOrder);
    return type ? `${type.defect_code} - ${type.defect_name}` : 'Please Select';
  };

  const getReasonCount = () => {
    return getReasonsForType().length;
  };

  const saveDefectsToServer = async (defects) => {
    if (!selectedRun) {
      alert('Please select a style');
      return null;
    }

    try {
      const token = getToken();

      const defectsWithIds = defects.map(d => {
        const defectType = defectTypes.find(t => t.sort_order === d.defectTypeId);

        return {
          defectTypeId: defectType ? defectType.id : null,
          defectReasonId: d.defectReasonId,
          quantity: d.quantity,
          operatorNo: d.operatorNo,
          notes: d.notes
        };
      });

      const validDefects = defectsWithIds.filter(d => d.defectTypeId !== null);

      if (validDefects.length === 0) {
        alert('No valid defects to save');
        return null;
      }

      const payload = {
        lineNo: selectedLine,
        style: selectedRun.style,
        runDate: selectedRun.run_date,
        inspectorName: inspectorName || user?.full_name || user?.username,
        inspectionDate: new Date().toISOString().split('T')[0],
        shiftSlot: shiftSlot || 'General',
        totalCheckedQuantity: 0,
        notes: `Style: ${selectedRun.style} - ${validDefects.length} defects`,
        defects: validDefects.map(d => ({
          defectTypeId: d.defectTypeId,
          defectReasonId: d.defectReasonId,
          quantity: d.quantity,
          operatorNo: d.operatorNo,
          operationName: null,
          notes: d.notes
        }))
      };

      const response = await axios.post(`${API_URL}/api/quality/inspection`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      return response.data;
    } catch (error) {
      console.error('Error saving defects:', error);
      throw error;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedLine) {
      alert('Please select a line');
      return;
    }

    if (!selectedRun) {
      alert('Please select a style');
      return;
    }

    if (!selectedDefectType) {
      alert('Please select a defect type');
      return;
    }

    setLoading(true);

    try {
      const newDefect = {
        id: Date.now(),
        defectTypeId: parseInt(selectedDefectType),
        defectReasonId: selectedReason ? parseInt(selectedReason) : null,
        quantity: parseInt(quantity) || 1,
        operatorNo: operatorNo ? parseInt(operatorNo) : null,
        notes: notes || null,
        timestamp: new Date().toISOString()
      };

      const updatedSession = [...sessionDefects, newDefect];
      setSessionDefects(updatedSession);

      // Update local stats
      setRunStats(prev => ({
        ...prev,
        [selectedRun.id]: {
          ...prev[selectedRun.id],
          sessionTotal: (prev[selectedRun.id]?.sessionTotal || 0) + newDefect.quantity
        }
      }));

      // Auto-save after every 20 defects
      if (updatedSession.length >= 20) {
        await saveDefectsToServer(updatedSession);
        setSessionDefects([]);
        showNotification(`✅ Saved ${updatedSession.length} defects for ${selectedRun.style}`);
        await fetchRunStats();
      }

      // Reset form
      setSelectedDefectType('');
      setSelectedReason('');
      setQuantity(1);
      setOperatorNo('');
      setNotes('');

      if (defectTypeSelectRef.current) {
        defectTypeSelectRef.current.focus();
      }

    } catch (error) {
      console.error('Error recording defect:', error);
      alert('Error recording defect: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const saveCurrentSession = async () => {
    if (sessionDefects.length === 0) {
      alert('No defects to save');
      return;
    }

    if (!selectedRun) {
      alert('No style selected');
      return;
    }

    setLoading(true);
    try {
      await saveDefectsToServer(sessionDefects);
      showNotification(`✅ Saved ${sessionDefects.length} defects for ${selectedRun.style}`);
      setSessionDefects([]);
      await fetchRunStats();
    } catch (error) {
      alert('Error saving defects: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (message) => {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  const handleLogout = () => {
    if (sessionDefects.length > 0) {
      if (window.confirm(`You have ${sessionDefects.length} unsaved defects. Save before logging out?`)) {
        saveCurrentSession().then(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          navigate('/');
        });
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/');
      }
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigate('/');
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* Header — compact single row */}
      <div className="bg-white shadow-sm border-b flex-shrink-0">
        <div className="px-4 py-2 flex justify-between items-center">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 whitespace-nowrap">Quality Inspection</h1>
            {user && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded whitespace-nowrap">
                {user.full_name || user.username}
              </span>
            )}
            {sessionDefects.length > 0 && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded animate-pulse whitespace-nowrap">
                📋 {sessionDefects.length} pending for {selectedRun?.style}
              </span>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex-shrink-0"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Top strip — Line selector + Available Styles as tappable chips */}
      <div className="bg-white border-b flex-shrink-0 px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Line selector */}
          <div className="flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide">Line</label>
            <select
              value={selectedLine}
              onChange={(e) => {
                setSelectedLine(e.target.value);
                setSessionDefects([]); // Clear session when changing line
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-base font-semibold bg-white"
            >
              <option value="">Select Line</option>
              {lines.map(line => (
                <option key={line.line_no} value={line.line_no}>
                  Line {line.line_no}
                </option>
              ))}
            </select>
          </div>

          <div className="w-px self-stretch bg-gray-200 flex-shrink-0" />

          {/* Styles strip */}
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Available Styles{availableRuns.length > 0 && ` (${availableRuns.length})`}
            </label>
            {availableRuns.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {availableRuns.map(run => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRun(run)}
                    className={`flex-shrink-0 px-4 py-1.5 rounded-lg border-2 text-left transition-colors ${
                      selectedRun?.id === run.id
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-semibold text-sm leading-tight">{run.style}</div>
                    <div className={`text-[11px] leading-tight ${selectedRun?.id === run.id ? 'text-blue-100' : 'text-gray-500'}`}>
                      Target {run.target_pcs} pcs
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-red-500 py-2">
                {selectedLine ? 'No styles found for this line' : 'Select a line to see styles'}
              </div>
            )}
          </div>

          {/* Selected style quick stats */}
          {selectedRun && (
            <div className="flex-shrink-0 flex items-center gap-4 pl-3 border-l border-gray-200 text-sm">
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">Target</div>
                <div className="font-bold">{selectedRun.target_pcs}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">Operators</div>
                <div className="font-bold">{selectedRun.operators_count}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">Defects Today</div>
                <div className="font-bold text-red-600">{runStats[selectedRun.id]?.todayTotal || 0}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Work area — fills remaining height, no page scroll */}
      <div className="flex-1 min-h-0 p-3 grid grid-cols-3 gap-3">

        {/* Entry Form */}
        <div className="col-span-2 bg-white rounded-lg shadow-sm p-4 flex flex-col min-h-0 overflow-y-auto">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 h-full">
            {/* Inspector, Shift, Operator — one row */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Inspector Name</label>
                <input
                  type="text"
                  value={inspectorName}
                  onChange={(e) => setInspectorName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
                <select
                  value={shiftSlot}
                  onChange={(e) => setShiftSlot(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">Select Shift</option>
                  <option value="Morning">Morning</option>
                  <option value="Afternoon">Afternoon</option>
                  <option value="Night">Night</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Operator No (Optional)</label>
                <input
                  type="number"
                  value={operatorNo}
                  onChange={(e) => setOperatorNo(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="Operator number"
                />
              </div>
            </div>

            {/* Defect Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bad Type *</label>
              <select
                ref={defectTypeSelectRef}
                value={selectedDefectType}
                onChange={(e) => {
                  setSelectedDefectType(e.target.value);
                  setSelectedReason('');
                }}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-base font-medium focus:border-blue-500 bg-white"
                required
              >
                <option value="">Please Select</option>
                {defectTypes.map(type => (
                  <option key={type.id} value={type.sort_order}>
                    {type.sort_order}. {type.defect_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Defect Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bad Reason</label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                disabled={!selectedDefectType}
              >
                <option value="">Please Select ({getReasonCount()})</option>
                {getReasonsForType().map(reason => (
                  <option key={reason.id} value={reason.id}>
                    {reason.reason_code} - {reason.reason_description}
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity and Notes */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-center text-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg"
                  placeholder="Quick note..."
                />
              </div>
            </div>

            {/* Buttons — pinned to bottom of the card */}
            <div className="mt-auto">
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={loading || !selectedRun || !selectedDefectType}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-lg font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving...' : 'Submit Defect'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDefectType('');
                    setSelectedReason('');
                    setQuantity(1);
                    setOperatorNo('');
                    setNotes('');
                    defectTypeSelectRef.current?.focus();
                  }}
                  className="px-8 bg-gray-300 hover:bg-gray-400 text-gray-700 py-3.5 rounded-lg font-semibold"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 text-center">
                ⌨️ Shortcuts: Ctrl+Enter = Submit | ESC = Clear Form
              </div>
            </div>
          </form>
        </div>

        {/* Right Panel — Current Session (scrolls internally) */}
        <div className="bg-white rounded-lg shadow-sm p-4 flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-2 flex-shrink-0">
            <h3 className="text-base font-bold">Current Session</h3>
            {selectedRun && (
              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                {selectedRun.style}
              </span>
            )}
          </div>

          <div className="text-center mb-2 flex-shrink-0">
            <div className="text-3xl font-bold text-orange-600">{sessionDefects.length}</div>
            <div className="text-sm text-gray-600">Defects in session</div>
          </div>

          <div className="space-y-2 flex-1 min-h-0 overflow-y-auto mb-2">
            {sessionDefects.slice(-10).reverse().map((defect) => (
              <div key={defect.id} className="border-l-4 border-blue-500 pl-3 py-2 text-sm bg-gray-50 rounded">
                <div className="font-medium">{defect.quantity}x {getDefectTypeName()}</div>
                <div className="text-gray-500 text-xs">
                  {defect.operatorNo && `Op ${defect.operatorNo} • `}
                  {defect.notes && defect.notes.substring(0, 30)}
                </div>
              </div>
            ))}
            {sessionDefects.length === 0 && (
              <div className="text-center text-gray-500 py-8 text-sm">
                No defects in current session.<br/>
                Select a defect type to start.
              </div>
            )}
          </div>

          {sessionDefects.length > 0 && selectedRun && (
            <button
              onClick={saveCurrentSession}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium flex-shrink-0"
            >
              💾 Save {sessionDefects.length} Defects for {selectedRun.style}
            </button>
          )}

          {selectedRun && (
            <div className="text-[11px] text-gray-500 text-center mt-2 flex-shrink-0">
              Stored with Line {selectedLine} • Style {selectedRun.style}
            </div>
          )}
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