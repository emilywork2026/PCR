import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Upload, DollarSign, Settings, Save, RefreshCw, CheckCircle2 } from 'lucide-react';

// --- Firebase Configuration & Initialization ---
const getFirebaseConfig = () => {
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
      return JSON.parse(__firebase_config);
    }
  } catch (e) {
    console.error("Failed to parse firebase config", e);
  }
  return { apiKey: "preview-key", projectId: "preview-project" };
};

const firebaseConfig = getFirebaseConfig();
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'expedia-price-monitor';

// Helper for exponential backoff retries
const withRetry = async (fn, maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = Math.pow(2, i) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export default function App() {
  const [user, setUser] = useState(null);
  const [marketData, setMarketData] = useState([]);
  const [myRates, setMyRates] = useState({});
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  // Authentication Logic with Error Handling
  useEffect(() => {
    const initAuth = async () => {
      try {
        await withRetry(async () => {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        });
      } catch (err) {
        console.error("Final Auth Error:", err);
        setAuthError(true);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
    });
    return () => unsubscribe();
  }, []);

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
      return headers.reduce((obj, h, i) => ({ ...obj, [h]: values[i] }), {});
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = parseCSV(event.target.result);
      const processed = raw.map(row => {
        const rawPriceStr = row['uitk-text_10'] || row['uitk-text_9'] || '0';
        const cleanedPrice = parseFloat(rawPriceStr.replace(/[^\d.]/g, '')) || 0;
        return {
          category: row['uitk-heading-5'] || 'Other Car',
          price: cleanedPrice
        };
      }).filter(i => i.price > 0);
      setMarketData(processed);
    };
    reader.readAsText(file);
  };

  const calculateTarget = (min, avg) => {
    const off = parseFloat(offset) || 0;
    if (strategy === 'undercut_min') return min - off;
    if (strategy === 'match_min') return min;
    return avg - off;
  };

  const categories = useMemo(() => [...new Set(marketData.map(d => d.category))], [marketData]);
  
  const chartData = useMemo(() => categories.map(cat => {
    const group = marketData.filter(d => d.category === cat);
    const avg = group.reduce((a, b) => a + b.price, 0) / group.length;
    const min = Math.min(...group.map(d => d.price));
    return { name: cat, Average: Math.round(avg), Recommended: Math.round(calculateTarget(min, avg)) };
  }), [categories, marketData, strategy, offset]);

  if (loading) return (
    <div className="h-screen bg-slate-900 flex flex-col items-center justify-center text-indigo-500 gap-4">
      <RefreshCw className="animate-spin w-10 h-10" />
      <p className="text-slate-400 font-medium animate-pulse">Initializing Environment...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-10">
      {authError && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 p-2 text-center text-xs text-amber-500 font-medium">
          Note: Running in offline/preview mode. Rate syncing is disabled.
        </div>
      )}
      <nav className="border-b border-slate-800 p-4 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/20"><DollarSign className="text-white" /></div>
            <h1 className="text-xl font-bold tracking-tight">Expedia Price Monitor</h1>
          </div>
          <label className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm flex items-center gap-2 cursor-pointer transition-all shadow-lg shadow-indigo-500/20">
            <Upload size={16} /> Load Data <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
          </label>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1 space-y-6">
          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 border-l-4 border-l-indigo-500 shadow-xl">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><Settings size={16}/> Price Logic</h2>
            <div className="space-y-4">
                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Targeting</label>
                    <select value={strategy} onChange={e => setStrategy(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm outline-none focus:border-indigo-500 text-slate-200">
                        <option value="undercut_min">Undercut Min</option>
                        <option value="match_min">Match Min</option>
                        <option value="undercut_avg">Undercut Avg</option>
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Offset Amount ($)</label>
                    <input type="number" value={offset} onChange={e => setOffset(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm outline-none focus:border-indigo-500 text-slate-200" placeholder="Offset $" />
                </div>
              <button disabled={authError} className={`w-full py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${authError ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/10'}`}>
                <Save size={14} /> Update Live Rates
              </button>
            </div>
          </div>
        </aside>

        <section className="lg:col-span-3 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Market Avg</p>
              <h3 className="text-3xl font-black">${marketData.length ? Math.round(marketData.reduce((a,b)=>a+b.price,0)/marketData.length) : '--'}</h3>
            </div>
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Lowest Found</p>
              <h3 className="text-3xl font-black text-emerald-400">${marketData.length ? Math.min(...marketData.map(d=>d.price)) : '--'}</h3>
            </div>
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 border-t-4 border-t-yellow-500 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-1">Analyzed Types</p>
              <h3 className="text-3xl font-black text-yellow-400">{categories.length}</h3>
            </div>
          </div>

          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 h-[350px] shadow-sm">
             <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#1e293b'}} contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} />
                <Legend />
                <Bar name="Market Average" dataKey="Average" fill="#334155" radius={[4, 4, 0, 0]} />
                <Bar name="Recommended Rate" dataKey="Recommended" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-800/20 shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-slate-800/80 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <tr><th className="p-4">Car Category</th><th className="p-4">Avg Rate</th><th className="p-4">Min Rate</th><th className="p-4">Target Rate</th><th className="p-4 text-right">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {categories.length > 0 ? categories.map(cat => {
                  const grp = marketData.filter(d=>d.category===cat);
                  const avg = grp.reduce((a,b)=>a+b.price,0)/grp.length;
                  const min = Math.min(...grp.map(d=>d.price));
                  const target = calculateTarget(min, avg);
                  return (
                    <tr key={cat} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-bold text-slate-200">{cat}</td>
                      <td className="p-4 text-slate-400 text-sm font-mono">${Math.round(avg)}</td>
                      <td className="p-4 text-emerald-400 text-sm font-mono font-bold">${min}</td>
                      <td className="p-4 text-indigo-400 font-black text-lg">${Math.round(target)}</td>
                      <td className="p-4 text-right"><CheckCircle2 className="inline text-emerald-500" size={16}/></td>
                    </tr>
                  )
                }) : (
                    <tr><td colSpan="5" className="p-10 text-center text-slate-600 font-bold uppercase tracking-widest text-xs italic">Upload market data to view pricing analysis</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
