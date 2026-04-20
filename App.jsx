import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot 
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, LineChart, Line
} from 'recharts';
import { 
  Upload, TrendingUp, DollarSign, CheckCircle, Activity, 
  MapPin, Truck, Download, AlertCircle, ChevronRight, Save, 
  BarChart3, RefreshCw
} from 'lucide-react';

// --- Configuration Setup ---
const getSafeConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined') return JSON.parse(__firebase_config);
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_CONFIG) {
      return JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
    }
    // Default fallback for preview environment
    return { apiKey: "preview", projectId: "preview" };
  } catch (e) {
    return { apiKey: "preview", projectId: "preview" };
  }
};

const firebaseConfig = getSafeConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'expedia-price-tracker';

export default function App() {
  const [user, setUser] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [currentMarket, setCurrentMarket] = useState([]);
  const [myRates, setMyRates] = useState({});
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [fleetFilter, setFleetFilter] = useState([]);

  // 1. Authentication Lifecycle
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth failed", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (firebaseConfig.apiKey === "preview") setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Real-time Market History & Saved Rates
  useEffect(() => {
    if (!user || firebaseConfig.apiKey === "preview") return;

    // Load History
    const historyCol = collection(db, 'artifacts', appId, 'public', 'data', 'price_history');
    const unsubHistory = onSnapshot(historyCol, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistoricalData(data);
      setLoading(false);
    }, (err) => {
      console.error("History fetch error:", err);
      setLoading(false);
    });

    // Load User's Saved Rates
    const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
    const unsubRates = onSnapshot(ratesDoc, (docSnap) => {
      if (docSnap.exists()) {
        setMyRates(docSnap.data().rates || {});
      }
    });

    return () => {
      unsubHistory();
      unsubRates();
    };
  }, [user]);

  // 3. ZERO-DEPENDENCY CSV ENGINE
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const splitLine = (line) => {
      const fields = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) {
          fields.push(cur.trim().replace(/^"|$/g, ''));
          cur = "";
        } else cur += c;
      }
      fields.push(cur.trim().replace(/^"|$/g, ''));
      return fields;
    };

    const headers = splitLine(lines[0]);
    return lines.slice(1).map(line => {
      const values = splitLine(line);
      return headers.reduce((obj, h, i) => {
        obj[h] = values[i] || "";
        return obj;
      }, {});
    });
  };

  const handleFileUpload = (e) => {
    setErrorMsg(null);
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const results = parseCSV(event.target.result);
        const parsed = results.map(row => {
          const title = row['title'] || row['is-visually-hidden'] || '';
          const vendor = title.match(/from (.*?) at/)?.[1] || 'Unknown';
          const link = row['_container_link'] || "";
          const location = link.match(/locn=(.*?)&/)?.[1] 
            ? decodeURIComponent(link.match(/locn=(.*?)&/)[1]).replace(/\+/g, ' ') 
            : "Market Generic";
          
          const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || row['price'];
          const price = parseFloat(priceRaw?.replace(/[^0-9.]/g, '')) || 0;

          return {
            category: row['uitk-heading-5'] || row['category'] || 'Other',
            vendor,
            price,
            model: row['uitk-text'] || 'Similar Model',
            location
          };
        }).filter(i => i.price > 0);

        if (parsed.length > 0) {
          setCurrentMarket(parsed);
          if (fleetFilter.length === 0) setFleetFilter([...new Set(parsed.map(p => p.category))]);
        } else {
          setErrorMsg("CSV Error: No valid pricing data found. Ensure headers match Expedia export.");
        }
      } catch (err) {
        setErrorMsg("Critical error reading file.");
      }
    };
    reader.readAsText(file);
  };

  const calculateTarget = (min, avg) => {
    switch(strategy) {
      case 'undercut_min': return Math.max(1, min - offset);
      case 'match_min': return min;
      case 'undercut_avg': return Math.max(1, avg - offset);
      case 'premium': return avg + offset;
      default: return avg;
    }
  };

  const saveRates = async () => {
    if (!user || firebaseConfig.apiKey === "preview") return;
    setSaving(true);
    try {
      const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
      await setDoc(ratesDoc, { 
        rates: myRates, 
        updatedAt: new Date().toISOString() 
      }, { merge: true });
      
      // Also log a history point if market data exists
      if (currentMarket.length > 0) {
        const historyId = new Date().toISOString().split('T')[0];
        const historyDoc = doc(db, 'artifacts', appId, 'public', 'data', 'price_history', historyId);
        const marketAvg = currentMarket.reduce((a,b)=>a+b.price,0)/currentMarket.length;
        await setDoc(historyDoc, {
          date: historyId,
          marketAvg,
          myAvg: Object.values(myRates).reduce((a,b)=>a+b,0) / (Object.values(myRates).length || 1)
        }, { merge: true });
      }
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const filteredMarket = useMemo(() => {
    return currentMarket.filter(item => {
      const locMatch = selectedLocation === 'All Locations' || item.location === selectedLocation;
      const catMatch = fleetFilter.length === 0 || fleetFilter.includes(item.category);
      return locMatch && catMatch;
    });
  }, [currentMarket, selectedLocation, fleetFilter]);

  const activeCategories = useMemo(() => [...new Set(filteredMarket.map(d => d.category))], [filteredMarket]);

  if (loading && firebaseConfig.apiKey !== "preview") {
    return (
      <div className="min-h-screen bg-[#020408] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="animate-spin text-blue-500" size={32} />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Syncing Cloud Data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020408] text-slate-200 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm font-bold animate-in slide-in-from-top">
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-800/50 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-500/20">
                <Activity size={24} className="text-white" />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white uppercase italic">PCR Rate V2</h1>
            </div>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.2em] uppercase flex items-center gap-2">
              <MapPin size={12} className="text-blue-500" /> {selectedLocation}
            </p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button 
              onClick={saveRates}
              disabled={saving}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-500/20"
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />} 
              SAVE TO CLOUD
            </button>
            <input type="file" id="csv-input" className="hidden" onChange={handleFileUpload} accept=".csv" />
            <button 
              onClick={() => document.getElementById('csv-input').click()}
              className="w-full md:w-auto bg-white hover:bg-slate-200 text-black px-6 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all"
            >
              <Upload size={16} /> UPLOAD DATA
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <aside className="space-y-6">
            <div className="bg-[#0b0e14] rounded-2xl p-6 border border-slate-800/50">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <MapPin size={12} /> Target Market
              </h3>
              <select 
                className="w-full bg-black border border-slate-800 p-3 rounded-lg text-xs font-bold text-slate-300 outline-none focus:border-blue-500"
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="All Locations">Global Market</option>
                {[...new Set(currentMarket.map(d => d.location))].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div className="bg-[#0b0e14] rounded-2xl p-6 border border-slate-800/50">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <BarChart3 size={12} /> Pricing Strategy
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-600 uppercase">Logic</span>
                  <select 
                    className="w-full bg-black border border-slate-800 p-3 rounded-lg text-[11px] font-black text-blue-400 outline-none"
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value)}
                  >
                    <option value="undercut_min">Undercut Floor</option>
                    <option value="match_min">Match Floor</option>
                    <option value="undercut_avg">Undercut Average</option>
                    <option value="premium">Premium Surcharge</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-600 uppercase">$ Margin</span>
                  <input 
                    type="number" 
                    className="w-full bg-black border border-slate-800 p-3 rounded-lg text-xs font-bold text-white focus:border-blue-500 outline-none"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            {historicalData.length > 0 && (
              <div className="bg-[#0b0e14] rounded-2xl p-4 border border-slate-800/50 h-48">
                <h3 className="text-[9px] font-black text-slate-600 uppercase mb-4 tracking-widest">Market Trend</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={historicalData}>
                    <defs>
                      <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="marketAvg" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTrend)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </aside>

          <div className="lg:col-span-3">
            <div className="bg-[#0b0e14] rounded-3xl border border-slate-800/50 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-slate-800/50 flex justify-between items-center bg-white/[0.01]">
                <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                  <TrendingUp size={14} className="text-blue-500" /> Rate Analysis Engine
                </h2>
                <div className="flex items-center gap-4">
                   <span className="text-[10px] font-black text-slate-600 uppercase italic">
                     {activeCategories.length} Categories Live
                   </span>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="text-[9px] uppercase font-black text-slate-600 border-b border-slate-800/50">
                    <tr>
                      <th className="p-6">Vehicle Category</th>
                      <th className="p-6">Expedia Insights</th>
                      <th className="p-6">Your Current</th>
                      <th className="p-6">Recommended</th>
                      <th className="p-6 text-right">Optimization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {activeCategories.length === 0 && (
                      <tr>
                        <td colSpan="5" className="p-32 text-center">
                          <div className="flex flex-col items-center gap-4 opacity-30">
                            <Upload size={48} className="text-blue-500" />
                            <p className="text-[10px] font-black uppercase tracking-widest">Awaiting CSV Upload</p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {activeCategories.map(cat => {
                      const group = filteredMarket.filter(d => d.category === cat);
                      const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
                      const min = Math.min(...group.map(d => d.price));
                      const target = calculateTarget(min, avg);
                      const current = myRates[cat] || 0;
                      const isHigh = current > target;
                      const isTooLow = current > 0 && current < target - 5;

                      return (
                        <tr key={cat} className="hover:bg-white/[0.01] transition-all group">
                          <td className="p-6">
                            <span className="text-sm font-black text-white block group-hover:text-blue-400 transition-colors uppercase tracking-tight">{cat}</span>
                            <span className="text-[10px] font-bold text-slate-600 uppercase italic leading-none">{group[0]?.model}</span>
                          </td>
                          <td className="p-6">
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] font-black text-emerald-500 leading-none">MIN ${min.toFixed(0)}</span>
                              <span className="text-[10px] font-bold text-slate-500 leading-none">AVG ${avg.toFixed(0)}</span>
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="relative w-24">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-700 font-bold text-xs">$</span>
                              <input 
                                type="number"
                                className={`w-full bg-black border ${isHigh ? 'border-orange-500/40 ring-1 ring-orange-500/10' : isTooLow ? 'border-blue-500/40' : 'border-slate-800'} rounded-lg py-2.5 pl-5 pr-2 text-white font-black text-xs outline-none focus:border-blue-500 transition-all`}
                                value={current || ''}
                                onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                              />
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="flex flex-col">
                              <span className="text-blue-400 text-xl font-black tracking-tighter leading-none">${target.toFixed(0)}</span>
                              <span className="text-[9px] font-black text-slate-700 uppercase mt-1">Target Rate</span>
                            </div>
                          </td>
                          <td className="p-6 text-right">
                            {isHigh ? (
                              <button 
                                onClick={() => setMyRates({...myRates, [cat]: target})}
                                className="bg-orange-600 hover:bg-orange-500 text-white px-5 py-2.5 rounded-lg text-[10px] font-black shadow-lg shadow-orange-500/10 transition-all active:scale-95 uppercase"
                              >
                                Match Market
                              </button>
                            ) : isTooLow ? (
                              <button 
                                onClick={() => setMyRates({...myRates, [cat]: target})}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-[10px] font-black shadow-lg shadow-blue-500/10 transition-all active:scale-95 uppercase"
                              >
                                Correct Up
                              </button>
                            ) : (
                              <div className="text-emerald-500/80 text-[10px] font-black flex items-center justify-end gap-1.5 uppercase">
                                <CheckCircle size={14} /> Optimized
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
