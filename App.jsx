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
  BarChart, Bar, Cell
} from 'recharts';
import { 
  Upload, AlertCircle, Save, 
  RefreshCw, Settings, PlusCircle, TrendingDown, Info,
  ChevronRight, BarChart3, ListFilter
} from 'lucide-react';

// --- Firebase Initialization ---
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

  // Authentication & Real-time Data Sync
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
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
    const unsub = onSnapshot(ratesDoc, (snap) => {
      if (snap.exists()) setMyRates(snap.data().rates || {});
    }, (err) => console.error("Firestore error:", err));
    return () => unsub();
  }, [user]);

  // --- Native CSV Parser ---
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
          if (insideQuotes && line[i + 1] === '"') { currentField += '"'; i++; } 
          else { insideQuotes = !insideQuotes; }
        } else if (char === ',' && !insideQuotes) {
          result.push(currentField.trim());
          currentField = '';
        } else { currentField += char; }
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
          const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || row['price'] || "0";
          const category = row['uitk-heading-5'] || row['category'] || 'Other';
          const model = row['uitk-text'] || row['title'] || 'Similar Model';
          
          return {
            category,
            price: parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0,
            model,
            location: row['location'] || "Market Generic"
          };
        }).filter(item => item.price > 0);

        if (parsed.length > 0) {
          setCurrentMarket(parsed);
        } else {
          setErrorMsg("No valid pricing data found in CSV.");
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

  const stats = useMemo(() => {
    if (currentMarket.length === 0) return { avg: 0, min: 0, count: 0 };
    const prices = currentMarket.map(i => i.price);
    return {
      avg: Math.round(prices.reduce((a,b) => a+b, 0) / prices.length),
      min: Math.min(...prices),
      count: currentMarket.length
    };
  }, [currentMarket]);

  const categories = useMemo(() => {
    return Array.from(new Set(currentMarket.map(i => i.category)));
  }, [currentMarket]);

  const handleSave = async () => {
    if (!user || firebaseConfig.apiKey === "preview") {
      setErrorMsg("Saving is disabled in preview mode.");
      return;
    }
    setSaving(true);
    try {
      const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
      await setDoc(ratesDoc, { rates: myRates, updated: new Date().toISOString() }, { merge: true });
    } catch (err) {
      setErrorMsg("Failed to sync to cloud.");
    } finally {
      setTimeout(() => setSaving(false), 500);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-indigo-500"><RefreshCw className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 font-sans">
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-500/20">
            <BarChart3 className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tighter uppercase">Expedia Pro</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Market Intelligence Active</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 bg-white text-black hover:bg-slate-200 px-5 py-3 rounded-2xl text-xs font-black uppercase transition-all cursor-pointer shadow-lg shadow-white/5">
            <PlusCircle size={16} />
            Import Feed
            <input type="file" className="hidden" onChange={handleFileUpload} accept=".csv" />
          </label>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase flex items-center gap-2 border border-slate-700 transition-all"
          >
            {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Syncing...' : 'Sync Cloud'}
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-8 space-y-8">
        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center gap-3 text-rose-400 text-sm font-medium">
            <AlertCircle size={18} /> {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-slate-800/60">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Market Floor</p>
            <h4 className="text-4xl font-black text-white">CA${stats.min}</h4>
            <div className="mt-2 flex items-center gap-1 text-emerald-400 text-[10px] font-bold">
              <TrendingDown size={12} /> Competitive Baseline
            </div>
          </div>
          <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-slate-800/60">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Average Rate</p>
            <h4 className="text-4xl font-black text-white">CA${stats.avg}</h4>
            <p className="mt-2 text-slate-500 text-[10px] font-bold">Industry Mean</p>
          </div>
          <div className="md:col-span-2 bg-indigo-600 rounded-[2rem] p-6 text-white flex justify-between items-center relative overflow-hidden shadow-2xl shadow-indigo-600/20">
            <div className="relative z-10">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-4">Pricing Strategy</p>
              <div className="flex items-center gap-4">
                <select 
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="bg-indigo-700/50 border-none rounded-xl px-4 py-3 text-sm font-black text-white outline-none"
                >
                  <option value="undercut_min">Undercut Floor</option>
                  <option value="match_min">Match Floor</option>
                  <option value="undercut_avg">Undercut Avg</option>
                </select>
                <div className="flex items-center bg-indigo-700/50 rounded-xl px-4 py-3">
                  <span className="text-xs font-bold mr-2">Offset:</span>
                  <input 
                    type="number" 
                    value={offset} 
                    onChange={e => setOffset(Number(e.target.value))}
                    className="bg-transparent w-12 text-sm font-black outline-none"
                  />
                </div>
              </div>
            </div>
            <Settings className="absolute -right-4 -bottom-4 text-white/10" size={120} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between px-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
                <ListFilter size={16} className="text-indigo-500" />
                Category Breakdown
              </h3>
              <p className="text-[10px] font-bold text-slate-500">{categories.length} Categories Found</p>
            </div>

            {categories.map(cat => {
              const items = currentMarket.filter(i => i.category === cat);
              const min = Math.min(...items.map(i => i.price));
              const avg = items.reduce((a,b) => a+b.price, 0) / items.length;
              const target = calculateTarget(min, avg);
              const current = myRates[cat] || 0;

              return (
                <div key={cat} className="bg-slate-900/40 border border-slate-800/60 p-6 rounded-[2rem] hover:border-indigo-500/40 transition-all group">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{cat}</p>
                      <h4 className="text-xl font-bold text-white group-hover:text-indigo-300 transition-colors">{items[0].model}</h4>
                      <div className="flex gap-4 mt-2">
                         <span className="text-[10px] font-bold text-slate-500">Market Min: <span className="text-slate-300">${min}</span></span>
                         <span className="text-[10px] font-bold text-slate-500">Market Avg: <span className="text-slate-300">${avg.toFixed(0)}</span></span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Target</p>
                        <p className="text-2xl font-black text-emerald-400">CA${target.toFixed(0)}</p>
                      </div>
                      <ChevronRight className="text-slate-700" />
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                        <p className="text-[10px] font-black text-indigo-400 uppercase mb-2">Live Rate</p>
                        <div className="relative flex items-center">
                          <span className="absolute left-3 text-xs text-slate-600 font-bold">$</span>
                          <input 
                            type="number"
                            value={current || ''}
                            onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                            className="bg-slate-900 border border-slate-800 rounded-xl pl-6 pr-3 py-2 text-sm font-black text-white w-24 focus:border-indigo-500 outline-none transition-all"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <button 
                        onClick={() => setMyRates({...myRates, [cat]: target})}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-xl transition-all"
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {categories.length === 0 && (
              <div className="bg-slate-900/20 border-2 border-dashed border-slate-800/60 rounded-[3rem] py-32 text-center">
                <Upload className="mx-auto text-slate-700 mb-4" size={48} />
                <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Awaiting CSV Data Feed</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-slate-900/50 p-8 rounded-[2.5rem] border border-slate-800/60 shadow-2xl">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-8">Live Distribution</h3>
              <div className="h-[300px]">
                {categories.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categories.map(cat => ({
                      name: cat,
                      price: Math.min(...currentMarket.filter(i => i.category === cat).map(i => i.price))
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" hide />
                      <YAxis hide domain={[0, 'dataMax + 20']} />
                      <Tooltip 
                        contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px', fontSize: '10px', fontWeight: 'bold'}}
                        cursor={{fill: 'rgba(79, 70, 229, 0.1)'}}
                      />
                      <Bar dataKey="price" radius={[8, 8, 0, 0]}>
                        {categories.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#4f46e5' : '#818cf8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center italic text-xs text-slate-700">FEED INACTIVE</div>
                )}
              </div>
            </div>

            <div className="bg-slate-900/50 p-8 rounded-[2.5rem] border border-slate-800/60">
              <div className="flex items-center gap-3 mb-6">
                <Info size={18} className="text-indigo-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-white">System Guide</h3>
              </div>
              <ul className="space-y-4">
                <li className="flex gap-3 text-[11px] leading-relaxed">
                  <span className="text-indigo-500 font-black">01</span>
                  <span>Export your latest Expedia scraped data as a <b>CSV</b>.</span>
                </li>
                <li className="flex gap-3 text-[11px] leading-relaxed">
                  <span className="text-indigo-500 font-black">02</span>
                  <span>Upload using the <b>Import Feed</b> button above.</span>
                </li>
                <li className="flex gap-3 text-[11px] leading-relaxed">
                  <span className="text-indigo-500 font-black">03</span>
                  <span>Review <b>Target Rates</b> based on your selected undercut logic.</span>
                </li>
                <li className="flex gap-3 text-[11px] leading-relaxed">
                  <span className="text-indigo-500 font-black">04</span>
                  <span>Click <b>Sync Cloud</b> to push rates to your central database.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
