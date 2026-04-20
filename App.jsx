import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
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
  Upload, DollarSign, MapPin, AlertCircle, Save, 
  RefreshCw, Settings, PlusCircle, TrendingDown, Info
} from 'lucide-react';

// --- Firebase Configuration ---
const getSafeConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) return JSON.parse(__firebase_config);
    return { apiKey: "preview", projectId: "preview" };
  } catch (e) {
    return { apiKey: "preview", projectId: "preview" };
  }
};

const firebaseConfig = getSafeConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'expedia-price-manager';

export default function App() {
  const [user, setUser] = useState(null);
  const [currentMarket, setCurrentMarket] = useState([]);
  const [myRates, setMyRates] = useState({});
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState('All Locations');

  const locations = ["All Locations", "YVR", "Vancouver Downtown", "Abbotsford"];

  // 1. Auth & Data Sync
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth initialization failed:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || firebaseConfig.apiKey === "preview") return;

    const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
    const unsubRates = onSnapshot(ratesDoc, (docSnap) => {
      if (docSnap.exists()) {
        setMyRates(docSnap.data().rates || {});
      }
    }, (err) => {
      console.error("Firestore sync error:", err);
    });

    return () => unsubRates();
  }, [user]);

  // --- Native CSV Parser (No External Dependencies) ---
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const splitLine = (line) => {
      const result = [];
      let currentField = '';
      let insideQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') {
            currentField += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          result.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }
      result.push(currentField.trim());
      return result;
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
          // Heuristics for Expedia scraped CSVs
          const title = row['title'] || row['is-visually-hidden'] || '';
          const vendor = title.match(/from (.*?) at/)?.[1] || 'Unknown';
          const link = row['_container_link'] || "";
          
          let location = "Market Generic";
          const rawLoc = link.match(/locn=(.*?)&/)?.[1];
          if (rawLoc) {
            const decoded = decodeURIComponent(rawLoc).replace(/\+/g, ' ');
            if (decoded.toLowerCase().includes('yvr')) location = "YVR";
            else if (decoded.toLowerCase().includes('downtown')) location = "Vancouver Downtown";
            else if (decoded.toLowerCase().includes('abbotsford')) location = "Abbotsford";
            else location = decoded;
          }

          // Common Expedia price selectors in scraped data
          const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || row['price'] || "0";
          const price = parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0;

          return {
            category: row['uitk-heading-5'] || row['category'] || 'Other',
            vendor,
            price,
            model: row['uitk-text'] || 'Similar Model',
            location
          };
        }).filter(item => item.price > 0);

        if (parsed.length > 0) {
          setCurrentMarket(parsed);
        } else {
          setErrorMsg("No valid pricing data found. Ensure headers like 'uitk-text_10' or 'price' exist.");
        }
      } catch (err) {
        setErrorMsg("Failed to parse CSV file.");
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
    if (selectedLocation === 'All Locations') return currentMarket;
    return currentMarket.filter(item => item.location === selectedLocation);
  }, [currentMarket, selectedLocation]);

  const categories = useMemo(() => {
    const set = new Set(filteredMarket.map(i => i.category));
    return Array.from(set);
  }, [filteredMarket]);

  const dashboardStats = useMemo(() => {
    if (filteredMarket.length === 0) return { avg: 0, min: 0, count: 0 };
    const prices = filteredMarket.map(i => i.price);
    return {
      avg: Math.round(prices.reduce((a,b) => a+b, 0) / prices.length),
      min: Math.min(...prices),
      count: filteredMarket.length
    };
  }, [filteredMarket]);

  const handleSave = async () => {
    if (!user || firebaseConfig.apiKey === "preview") {
      setErrorMsg("Cloud storage is disabled in preview mode.");
      return;
    }
    setSaving(true);
    try {
      const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
      await setDoc(ratesDoc, { 
        rates: myRates,
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      setErrorMsg("Failed to save changes.");
    } finally {
      setTimeout(() => setSaving(false), 800);
    }
  };

  if (loading) return <div className="min-h-screen bg-[#0a0c14] flex items-center justify-center text-indigo-500"><RefreshCw className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#0a0c14] text-slate-300 font-sans selection:bg-indigo-500/30">
      <header className="border-b border-slate-800 bg-[#0f121d]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <DollarSign className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white uppercase tracking-tight">Expedia Intelligence</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Active Market Feed</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/10">
            <PlusCircle size={16} />
            Import CSV
            <input type="file" className="hidden" onChange={handleFileUpload} accept=".csv" />
          </label>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-700 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Sync Rates'}
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 space-y-6">
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          <div className="bg-[#121625] p-6 rounded-2xl border border-slate-800/60 shadow-xl">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Settings size={14} className="text-indigo-400" />
              Settings
            </h3>
            <div className="space-y-5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-2 uppercase">Market Location</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  <select 
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="w-full bg-[#0a0c14] border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-xs font-bold text-white outline-none focus:border-indigo-500 transition-all appearance-none"
                  >
                    {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-2 uppercase">Algorithm</label>
                <select 
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="w-full bg-[#0a0c14] border border-slate-700 rounded-xl p-3 text-xs font-bold text-white outline-none focus:border-indigo-500 transition-all"
                >
                  <option value="undercut_min">Undercut Floor</option>
                  <option value="match_min">Match Floor</option>
                  <option value="undercut_avg">Undercut Average</option>
                  <option value="premium">Premium Position</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-2 uppercase">Offset (CA$)</label>
                <input 
                  type="number"
                  value={offset}
                  onChange={(e) => setOffset(Number(e.target.value))}
                  className="w-full bg-[#0a0c14] border border-slate-700 rounded-xl p-3 text-xs font-bold text-white focus:border-indigo-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="bg-[#121625] p-6 rounded-2xl border border-slate-800/60 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Floor</p>
                   <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-400"><TrendingDown size={16} /></div>
                </div>
                <div>
                   <h4 className="text-4xl font-black text-white">CA${dashboardStats.min}</h4>
                   <p className="text-[10px] text-slate-500 mt-1">Lowest competitor found</p>
                </div>
             </div>
             <div className="bg-[#121625] p-6 rounded-2xl border border-slate-800/60 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Average Rate</p>
                   <div className="bg-indigo-500/10 p-2 rounded-lg text-indigo-400"><Info size={16} /></div>
                </div>
                <div>
                   <h4 className="text-4xl font-black text-white">CA${dashboardStats.avg}</h4>
                   <p className="text-[10px] text-slate-500 mt-1">Mean industry positioning</p>
                </div>
             </div>
             <div className="bg-[#121625] p-6 rounded-2xl border border-slate-800/60 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                   <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Data Points</p>
                   <div className="bg-indigo-500/10 p-2 rounded-lg text-indigo-400"><Upload size={16} /></div>
                </div>
                <div>
                   <h4 className="text-4xl font-black text-white">{dashboardStats.count}</h4>
                   <p className="text-[10px] text-slate-500 mt-1">Scraped entries processed</p>
                </div>
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#121625] rounded-2xl border border-slate-800/60 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-[#161b2b]">
              <h3 className="text-xs font-black uppercase tracking-widest text-white">Price Action Table</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#121625] text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4">Market Stats</th>
                    <th className="px-6 py-4">Your Rate</th>
                    <th className="px-6 py-4">Target</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {categories.map(cat => {
                    const group = filteredMarket.filter(i => i.category === cat);
                    const min = Math.min(...group.map(i => i.price));
                    const avg = group.reduce((a,b) => a+b.price, 0) / group.length;
                    const target = calculateTarget(min, avg);
                    const current = myRates[cat] || 0;
                    const diff = current - target;

                    return (
                      <tr key={cat} className="group hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm font-bold text-white">{cat}</div>
                          <div className="text-[10px] text-slate-500 uppercase font-medium">{group[0]?.model}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-slate-400">Min: <span className="text-white">CA${min}</span></span>
                            <span className="text-[10px] text-slate-500">Avg: CA${avg.toFixed(0)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">$</span>
                              <input 
                                type="number"
                                value={current || ''}
                                onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                                className="w-20 bg-[#0a0c14] border border-slate-700 rounded-lg pl-5 pr-2 py-2 text-xs font-bold text-indigo-300 focus:border-indigo-500 outline-none"
                              />
                            </div>
                            {current > 0 && diff !== 0 && (
                              <span className={`text-[10px] font-bold ${diff > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {diff > 0 ? `+$${diff.toFixed(0)}` : `-$${Math.abs(diff).toFixed(0)}`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-base font-black text-indigo-400">CA${target.toFixed(0)}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => setMyRates({...myRates, [cat]: target})}
                            className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all"
                          >
                            Set
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {categories.length === 0 && (
                <div className="py-20 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="text-slate-600" size={32} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-400">No Data Detected</p>
                    <p className="text-xs text-slate-600 uppercase tracking-widest font-black">Upload CSV to begin</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-[#121625] p-6 rounded-2xl border border-slate-800/60">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-6">Price Distribution</h3>
              <div className="h-[200px]">
                {categories.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categories.map(cat => {
                      const g = filteredMarket.filter(i => i.category === cat);
                      return { name: cat.substring(0, 8), price: Math.min(...g.map(i => i.price)) };
                    })}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} tick={{fill: '#475569'}} />
                      <YAxis hide />
                      <Tooltip 
                        contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px'}}
                        itemStyle={{color: '#818cf8'}}
                      />
                      <Bar dataKey="price" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center italic text-[10px] text-slate-600">AWAITING FEED...</div>
                )}
              </div>
            </div>

            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-600/10 relative overflow-hidden">
               <div className="relative z-10">
                 <h4 className="text-sm font-black uppercase tracking-widest opacity-80 mb-2">Fleet Strategy</h4>
                 <p className="text-lg leading-snug font-medium">
                   {categories.length > 0 ? 
                    `Market analysis complete. Suggesting ${strategy.replace('_', ' ')} logic across ${categories.length} categories.` : 
                    "Ready to process Expedia market exports."}
                 </p>
               </div>
               <DollarSign className="absolute -bottom-6 -right-6 text-white/10" size={120} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
