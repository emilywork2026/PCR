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
  BarChart, Bar
} from 'recharts';
import { 
  Upload, DollarSign, CheckCircle, MapPin, AlertCircle, Save, 
  RefreshCw, Settings, PlusCircle
} from 'lucide-react';

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
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [fleetFilter, setFleetFilter] = useState('All Categories');

  // Hardcoded locations for selection
  const locations = ["All Locations", "YVR", "Vancouver Downtown", "Abbotsford"];

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

    const historyCol = collection(db, 'artifacts', appId, 'public', 'data', 'price_history');
    const unsubHistory = onSnapshot(historyCol, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistoricalData(data);
      setLoading(false);
    }, (err) => {
      console.error("History fetch error:", err);
      setLoading(false);
    });

    const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
    const unsubRates = onSnapshot(ratesDoc, (docSnap) => {
      if (docSnap.exists()) {
        setMyRates(docSnap.data().rates || {});
      }
    }, (err) => {
      console.error("Rates fetch error:", err);
    });

    return () => {
      unsubHistory();
      unsubRates();
    };
  }, [user]);

  // Robust Native CSV Parser (Replaces need for PapaParse)
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const splitLine = (line) => {
      const fields = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i+1] === '"') { // Handle escaped quotes ""
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
          fields.push(cur.trim());
          cur = "";
        } else {
            cur += c;
        }
      }
      fields.push(cur.trim());
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
          
          let location = "Market Generic";
          const rawLoc = link.match(/locn=(.*?)&/)?.[1];
          if (rawLoc) {
            const decoded = decodeURIComponent(rawLoc).replace(/\+/g, ' ');
            if (decoded.toLowerCase().includes('yvr') || decoded.toLowerCase().includes('airport')) location = "YVR";
            else if (decoded.toLowerCase().includes('downtown')) location = "Vancouver Downtown";
            else if (decoded.toLowerCase().includes('abbotsford')) location = "Abbotsford";
            else location = decoded;
          }

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
        } else {
          setErrorMsg("CSV Error: No valid pricing data found.");
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

  const filteredMarket = useMemo(() => {
    return currentMarket.filter(item => {
      if (selectedLocation === 'All Locations') return true;
      return item.location === selectedLocation;
    });
  }, [currentMarket, selectedLocation]);

  const activeCategories = useMemo(() => [...new Set(filteredMarket.map(d => d.category))], [filteredMarket]);

  const stats = useMemo(() => {
    if (activeCategories.length === 0) return { avg: '-', min: '-', updates: 0 };
    const allPrices = filteredMarket.map(m => m.price);
    const avg = allPrices.reduce((a,b)=>a+b,0) / allPrices.length;
    const min = Math.min(...allPrices);
    
    let updatesNeeded = 0;
    activeCategories.forEach(cat => {
      const group = filteredMarket.filter(d => d.category === cat);
      const groupMin = Math.min(...group.map(d => d.price));
      const groupAvg = group.reduce((a,b)=>a+b.price,0)/group.length;
      const target = calculateTarget(groupMin, groupAvg);
      const current = myRates[cat] || 0;
      if (Math.abs(current - target) > 0.5) updatesNeeded++;
    });

    return { avg: avg.toFixed(0), min: min.toFixed(0), updates: updatesNeeded };
  }, [filteredMarket, activeCategories, myRates, strategy, offset]);

  const competitorVolumeData = useMemo(() => {
    const counts = {};
    filteredMarket.forEach(item => {
      counts[item.vendor] = (counts[item.vendor] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredMarket]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
        const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
        await setDoc(ratesDoc, { 
            rates: myRates,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        console.error("Save error:", err);
        setErrorMsg("Failed to save rates to cloud.");
    } finally {
        setTimeout(() => setSaving(false), 800);
    }
  };

  if (loading && firebaseConfig.apiKey !== "preview") {
    return (
      <div className="min-h-screen bg-[#0f121d] flex items-center justify-center">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f121d] text-slate-300 font-sans">
      {/* Navbar */}
      <nav className="bg-[#161b2b] border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <DollarSign size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Rate Management Console</h1>
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Competitive Price Positioning</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input type="file" id="csv-input" className="hidden" onChange={handleFileUpload} accept=".csv" />
          <button 
            onClick={() => document.getElementById('csv-input').click()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition-all"
          >
            <PlusCircle size={14} /> Import Market Data
          </button>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto p-6 space-y-6">
        
        {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-center gap-3 text-red-500 text-sm">
                <AlertCircle size={18} />
                {errorMsg}
            </div>
        )}

        {/* Top Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-[#1c2237] rounded-2xl p-6 border border-slate-800/50 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Settings size={14} className="text-indigo-400" />
              <h3 className="text-sm font-bold text-white">Console Parameters</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Branch Selection</label>
                <div className="relative">
                  <MapPin size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <select 
                    className="w-full bg-[#161b2b] border border-slate-700 pl-8 pr-2.5 py-2.5 rounded-lg text-xs font-medium text-slate-300 outline-none focus:border-indigo-500"
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                  >
                    {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Positioning Logic</label>
                <select 
                  className="w-full bg-[#161b2b] border border-slate-700 p-2.5 rounded-lg text-xs font-medium text-slate-300 outline-none focus:border-indigo-500"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                >
                  <option value="undercut_min">Undercut Market Minimum</option>
                  <option value="match_min">Match Market Floor</option>
                  <option value="undercut_avg">Target Average</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Offset Amount (CA$)</label>
                <input 
                  type="number" 
                  className="w-full bg-[#161b2b] border border-slate-700 p-2.5 rounded-lg text-xs font-bold text-white focus:border-indigo-500 outline-none"
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          <div className="bg-[#1c2237] rounded-2xl p-6 border border-slate-800/50 shadow-sm relative overflow-hidden">
             <h3 className="text-xs font-bold text-slate-500 mb-4">Avg Market Rate</h3>
             <div className="text-3xl font-bold text-white">
               {stats.avg !== '-' ? `CA$${stats.avg}` : '-'}
             </div>
             <div className="absolute bottom-0 left-0 w-full h-1 bg-blue-500/20"></div>
          </div>

          <div className="bg-[#1c2237] rounded-2xl p-6 border border-slate-800/50 shadow-sm relative overflow-hidden">
             <h3 className="text-xs font-bold text-slate-500 mb-4">Market Floor</h3>
             <div className="text-3xl font-bold text-white">
               {stats.min !== '-' ? `CA$${stats.min}` : '-'}
             </div>
             <div className="absolute bottom-4 right-4">
                <div className="w-4 h-1 bg-emerald-500 rounded-full"></div>
             </div>
          </div>

          <div className="bg-[#1c2237] rounded-2xl p-6 border border-yellow-500/30 shadow-sm relative border-t-4 border-t-yellow-500">
             <h3 className="text-xs font-bold text-slate-500 mb-4">Required Updates</h3>
             <div className="text-5xl font-bold text-yellow-500">
               {stats.updates}
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#1c2237] rounded-2xl p-6 border border-slate-800/50 min-h-[300px]">
             <h3 className="text-sm font-bold text-white mb-6">Category Comparison & Recommended Rates</h3>
             {activeCategories.length > 0 ? (
               <ResponsiveContainer width="100%" height={240}>
                 <BarChart data={activeCategories.map(cat => {
                   const g = filteredMarket.filter(i => i.category === cat);
                   return { 
                     name: cat.split(' ')[0], 
                     min: Math.min(...g.map(p => p.price)),
                     target: calculateTarget(Math.min(...g.map(p => p.price)), g.reduce((a,b)=>a+b.price,0)/g.length)
                   };
                 })}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2d3748" />
                   <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                   <YAxis fontSize={10} axisLine={false} tickLine={false} />
                   <Tooltip 
                     contentStyle={{ backgroundColor: '#161b2b', border: '1px solid #2d3748', borderRadius: '8px', fontSize: '12px' }} 
                     itemStyle={{ color: '#fff' }}
                   />
                   <Bar dataKey="min" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                   <Bar dataKey="target" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                 </BarChart>
               </ResponsiveContainer>
             ) : (
               <div className="h-[240px] flex items-center justify-center italic text-slate-600 text-sm">No data available for {selectedLocation}</div>
             )}
          </div>

          <div className="bg-[#1c2237] rounded-2xl p-6 border border-slate-800/50 min-h-[300px]">
             <h3 className="text-sm font-bold text-white mb-6">Competitor Volume</h3>
             {competitorVolumeData.length > 0 ? (
               <ResponsiveContainer width="100%" height={240}>
                 <BarChart data={competitorVolumeData} layout="vertical">
                   <XAxis type="number" hide />
                   <YAxis dataKey="name" type="category" fontSize={10} width={80} axisLine={false} tickLine={false} />
                   <Tooltip 
                     contentStyle={{ backgroundColor: '#161b2b', border: '1px solid #2d3748', borderRadius: '8px' }}
                   />
                   <Bar dataKey="value" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={12} />
                 </BarChart>
               </ResponsiveContainer>
             ) : (
               <div className="h-[240px] flex items-center justify-center italic text-slate-600 text-sm">Awaiting market parsing...</div>
             )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-white">Rate Adjustment Workflow</h2>
              <p className="text-xs text-slate-500">Currently viewing: <span className="text-indigo-400 font-bold">{selectedLocation}</span></p>
            </div>
            <select 
               className="bg-[#1c2237] border border-slate-700 text-xs p-2 rounded-lg outline-none font-medium text-white"
               value={fleetFilter}
               onChange={(e) => setFleetFilter(e.target.value)}
            >
              <option>All Categories</option>
              {activeCategories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div className="bg-[#1c2237] rounded-2xl border border-slate-800/50 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-[#161b2b] text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Vehicle Category</th>
                  <th className="px-6 py-4">Market Insights</th>
                  <th className="px-6 py-4">Your Position</th>
                  <th className="px-6 py-4">Target Rate</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeCategories.filter(c => fleetFilter === 'All Categories' || c === fleetFilter).map(cat => {
                  const group = filteredMarket.filter(d => d.category === cat);
                  const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
                  const min = Math.min(...group.map(d => d.price));
                  const target = calculateTarget(min, avg);
                  const current = myRates[cat] || 0;
                  const drift = current - target;

                  return (
                    <tr key={cat} className="hover:bg-white/[0.02] transition-all">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-white">{cat}</div>
                        <div className="text-[10px] text-slate-500">{group[0]?.model}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-300">Min: CA$${min}</span>
                          <span className="text-[10px] text-slate-500">Avg: CA$${avg.toFixed(0)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                           <input 
                             type="number"
                             className="w-20 bg-[#0f121d] border border-slate-700 rounded p-1.5 text-xs text-white outline-none focus:border-indigo-500"
                             value={current || ''}
                             onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                           />
                           {drift !== 0 && current > 0 && (
                             <span className={`text-[10px] font-bold ${drift > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                               {drift > 0 ? `+$${drift.toFixed(0)}` : `-$${Math.abs(drift).toFixed(0)}`}
                             </span>
                           )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-lg font-black text-indigo-400">CA${target.toFixed(0)}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setMyRates({...myRates, [cat]: target})}
                          className="text-[10px] font-black uppercase text-indigo-400 hover:text-white transition-colors"
                        >
                          Match Target
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {activeCategories.length === 0 && (
              <div className="py-20 text-center text-slate-600 italic text-sm">
                No active data for {selectedLocation}. Upload CSV to sync.
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-4">
           <button 
            onClick={handleSave}
            disabled={saving || !user}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold text-sm shadow-xl shadow-indigo-500/20 flex items-center gap-2 transition-all"
           >
             {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
             Confirm All Adjustments
           </button>
        </div>
      </main>
    </div>
  );
}
