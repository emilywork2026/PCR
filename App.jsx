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
  AreaChart, Area
} from 'recharts';
import { Upload, TrendingUp, DollarSign, CheckCircle, Activity, MapPin, Truck, Download, AlertCircle, ChevronRight } from 'lucide-react';

// --- Configuration Setup ---
const getSafeConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined') return JSON.parse(__firebase_config);
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_CONFIG) {
      return JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
    }
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
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Real-time Market History
  useEffect(() => {
    if (!user || firebaseConfig.apiKey === "preview") {
      setLoading(false);
      return;
    }
    const historyCol = collection(db, 'artifacts', appId, 'public', 'data', 'price_history');
    const unsubscribe = onSnapshot(historyCol, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistoricalData(data);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsubscribe();
  }, [user]);

  // 3. ZERO-DEPENDENCY CSV ENGINE
  // This replaces PapaParse to fix the "Papa is not defined" error
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
          fields.push(cur.trim().replace(/^"|"$/g, ''));
          cur = "";
        } else cur += c;
      }
      fields.push(cur.trim().replace(/^"|"$/g, ''));
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
          setErrorMsg("CSV Parse Warning: No price data detected. Verify column headers.");
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
      case 'premium': return avg * 1.05;
      default: return avg;
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-blue-500"></div>
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
              <h1 className="text-2xl font-black tracking-tight text-white uppercase italic">Market Intel v2</h1>
            </div>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.2em] uppercase flex items-center gap-2">
              <MapPin size={12} className="text-blue-500" /> {selectedLocation}
            </p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <input type="file" id="csv-input" className="hidden" onChange={handleFileUpload} accept=".csv" />
            <button 
              onClick={() => document.getElementById('csv-input').click()}
              className="w-full md:w-auto bg-white hover:bg-slate-200 text-black px-8 py-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all"
            >
              <Upload size={16} /> UPLOAD EXPEDIA CSV
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <aside className="space-y-6">
            <div className="bg-[#0b0e14] rounded-2xl p-6 border border-slate-800/50">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Location</h3>
              <select 
                className="w-full bg-black border border-slate-800 p-3 rounded-lg text-xs font-bold text-slate-300 outline-none"
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="All Locations">Global Market</option>
                {[...new Set(currentMarket.map(d => d.location))].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div className="bg-[#0b0e14] rounded-2xl p-6 border border-slate-800/50">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Pricing Control</h3>
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
                    <option value="premium">Premium Position</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-600 uppercase">$ Margin</span>
                  <input 
                    type="number" 
                    className="w-full bg-black border border-slate-800 p-3 rounded-lg text-xs font-bold text-white"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </aside>

          <div className="lg:col-span-3">
            <div className="bg-[#0b0e14] rounded-3xl border border-slate-800/50 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-slate-800/50 flex justify-between items-center bg-white/[0.01]">
                <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Live Rate Analysis</h2>
                <button 
                  className="text-[10px] font-black bg-blue-500/10 text-blue-400 px-4 py-1.5 rounded-full border border-blue-500/20"
                >
                  {activeCategories.length} Categories
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="text-[9px] uppercase font-black text-slate-600 border-b border-slate-800/50">
                    <tr>
                      <th className="p-6">Category</th>
                      <th className="p-6">Market Pulse</th>
                      <th className="p-6">Our Current</th>
                      <th className="p-6">Recommendation</th>
                      <th className="p-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/30">
                    {activeCategories.length === 0 && (
                      <tr>
                        <td colSpan="5" className="p-32 text-center">
                          <div className="flex flex-col items-center gap-4 opacity-30">
                            <Upload size={48} />
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

                      return (
                        <tr key={cat} className="hover:bg-white/[0.01] transition-all group">
                          <td className="p-6">
                            <span className="text-sm font-black text-white block group-hover:text-blue-500 transition-colors">{cat}</span>
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
                                className={`w-full bg-black border ${isHigh ? 'border-orange-500/40 ring-1 ring-orange-500/10' : 'border-slate-800'} rounded-lg py-2 pl-5 pr-2 text-white font-black text-xs outline-none focus:border-blue-500 transition-all`}
                                value={current || ''}
                                onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                              />
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="flex flex-col">
                              <span className="text-blue-400 text-xl font-black tracking-tight leading-none">${target.toFixed(0)}</span>
                              <span className="text-[9px] font-black text-slate-700 uppercase mt-1 tracking-tighter">Target Rate</span>
                            </div>
                          </td>
                          <td className="p-6 text-right">
                            {isHigh ? (
                              <button 
                                onClick={() => setMyRates({...myRates, [cat]: target})}
                                className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-[10px] font-black shadow-lg shadow-orange-500/10 transition-all active:scale-95"
                              >
                                ADJUST
                              </button>
                            ) : (
                              <div className="text-emerald-500/60 text-[10px] font-black flex items-center justify-end gap-1">
                                <CheckCircle size={14} /> READY
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
