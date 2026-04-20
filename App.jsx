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
  BarChart, Bar, Cell, Legend, PieChart, Pie
} from 'recharts';
import { 
  Upload, DollarSign, Settings, AlertCircle, Save, 
  RefreshCw, CheckCircle2, TrendingDown, Info
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
  const [marketData, setMarketData] = useState([]);
  const [myRates, setMyRates] = useState({});
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Auth initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth error:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Data Sync (Firestore)
  useEffect(() => {
    if (!user || firebaseConfig.apiKey === "preview") return;
    const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
    const unsub = onSnapshot(ratesDoc, (snap) => {
      if (snap.exists()) setMyRates(snap.data().rates || {});
    }, (err) => console.error("Firestore error:", err));
    return () => unsub();
  }, [user]);

  // Robust CSV Parser
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
      try {
        const raw = parseCSV(event.target.result);
        const processed = raw.map(row => ({
          category: row['uitk-heading-5'] || row['category'] || 'Other',
          price: parseFloat((row['uitk-text_10'] || row['uitk-text_8'] || '0').replace(/[^0-9.]/g, '')) || 0,
          vendor: (row['title'] || '').match(/from (.*?) at/)?.[1] || 'Competitor'
        })).filter(i => i.price > 0);
        setMarketData(processed);
      } catch (err) {
        setErrorMsg("Failed to parse CSV. Check format.");
      }
    };
    reader.readAsText(file);
  };

  const calculateTarget = (min, avg) => {
    const off = parseFloat(offset) || 0;
    switch(strategy) {
      case 'undercut_min': return Math.max(0, min - off);
      case 'match_min': return min;
      case 'undercut_avg': return Math.max(0, avg - off);
      case 'premium': return avg * 1.05;
      default: return avg;
    }
  };

  const categories = useMemo(() => [...new Set(marketData.map(d => d.category))], [marketData]);
  
  const chartData = useMemo(() => categories.map(cat => {
    const group = marketData.filter(d => d.category === cat);
    const avg = group.reduce((a, b) => a + b.price, 0) / group.length;
    const min = Math.min(...group.map(d => d.price));
    return { name: cat, Average: Math.round(avg), Recommended: Math.round(calculateTarget(min, avg)) };
  }), [categories, marketData, strategy, offset]);

  const stats = useMemo(() => {
    if (!marketData.length) return { avg: 0, min: 0 };
    const prices = marketData.map(d => d.price);
    return {
      avg: Math.round(prices.reduce((a,b) => a+b, 0) / prices.length),
      min: Math.min(...prices)
    };
  }, [marketData]);

  const handleSave = async () => {
    if (!user || firebaseConfig.apiKey === "preview") return;
    setSaving(true);
    try {
      const ratesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'current_rates');
      await setDoc(ratesDoc, { rates: myRates, updated: new Date().toISOString() }, { merge: true });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="h-screen bg-slate-900 flex items-center justify-center"><RefreshCw className="animate-spin text-indigo-500" /></div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans pb-20">
      <nav className="border-b border-slate-800 p-4 sticky top-0 bg-slate-900/80 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/20">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Rate Management Console</h1>
              <p className="text-xs text-slate-400">Competitive Price Positioning</p>
            </div>
          </div>
          <label className="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg font-medium transition-all text-sm flex items-center gap-2 cursor-pointer">
            <Upload size={16} /> Import Market Data
            <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
          </label>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 border-l-4 border-l-indigo-500">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Settings size={20} className="text-indigo-400" /> Price Strategy</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 uppercase font-bold mb-2">Positioning Logic</label>
                <select value={strategy} onChange={e => setStrategy(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm outline-none focus:border-indigo-500">
                  <option value="undercut_min">Undercut Market Minimum</option>
                  <option value="match_min">Match Market Minimum</option>
                  <option value="undercut_avg">Undercut Market Average</option>
                  <option value="premium">Premium (+5% Over Average)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 uppercase font-bold mb-2">Offset Amount (CA$)</label>
                <input type="number" value={offset} onChange={e => setOffset(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm outline-none focus:border-indigo-500" />
              </div>
              <button onClick={handleSave} className="w-full bg-slate-700 hover:bg-slate-600 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all">
                {saving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />} Sync Changes
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50">
              <p className="text-slate-400 text-xs font-bold uppercase mb-1">Avg Market Rate</p>
              <h3 className="text-3xl font-black">{stats.avg ? `CA $${stats.avg}` : '--'}</h3>
            </div>
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50">
              <p className="text-slate-400 text-xs font-bold uppercase mb-1">Market Floor</p>
              <h3 className="text-3xl font-black text-emerald-400">{stats.min ? `CA $${stats.min}` : '--'}</h3>
            </div>
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 border-t-4 border-t-yellow-500">
              <p className="text-slate-400 text-xs font-bold uppercase mb-1">Required Updates</p>
              <h3 className="text-3xl font-black text-yellow-400">{categories.filter(c => (myRates[c] || 0) > (calculateTarget(Math.min(...marketData.filter(d=>d.category===c).map(d=>d.price)), marketData.filter(d=>d.category===c).reduce((a,b)=>a+b.price,0)/marketData.filter(d=>d.category===c).length))).length}</h3>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 h-[350px]">
            <h2 className="text-sm font-bold uppercase text-slate-400 mb-6">Market vs Recommended</h2>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px'}} />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                <Bar dataKey="Average" fill="#334155" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Recommended" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 flex flex-col justify-center items-center">
             <TrendingDown size={48} className="text-slate-700 mb-4" />
             <p className="text-slate-500 text-sm font-bold uppercase tracking-widest text-center px-10">Pricing distribution insights and market volume comparison</p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold px-1">Rate Adjustment Workflow</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-800/20">
            <table className="w-full text-left">
              <thead className="bg-slate-800/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <tr>
                  <th className="p-4">Category</th>
                  <th className="p-4">Market Avg</th>
                  <th className="p-4">Market Min</th>
                  <th className="p-4">Current Rate</th>
                  <th className="p-4">Target Rate</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {categories.length > 0 ? categories.map(cat => {
                   const group = marketData.filter(d => d.category === cat);
                   const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
                   const min = Math.min(...group.map(d=>d.price));
                   const target = calculateTarget(min, avg);
                   const current = myRates[cat] || 0;
                   const needsUpdate = current > target;

                   return (
                     <tr key={cat} className="hover:bg-slate-800/30 transition-colors">
                       <td className="p-4 font-bold text-slate-200">{cat}</td>
                       <td className="p-4 text-slate-400 font-mono text-sm">${avg.toFixed(0)}</td>
                       <td className="p-4 text-emerald-400 font-mono font-bold text-sm">${min}</td>
                       <td className="p-4">
                         <input type="number" value={current || ''} onChange={e => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                           className={`w-24 bg-slate-900 border rounded px-3 py-1.5 text-sm font-bold outline-none ${needsUpdate ? 'border-yellow-500 text-yellow-500' : 'border-slate-700'}`} />
                       </td>
                       <td className="p-4 font-black text-indigo-400 text-lg">${target.toFixed(0)}</td>
                       <td className="p-4 text-right">
                         {needsUpdate ? (
                           <button onClick={() => setMyRates({...myRates, [cat]: Math.round(target)})} className="bg-yellow-500/10 text-yellow-500 px-3 py-1 rounded text-[10px] font-black uppercase border border-yellow-500/20 hover:bg-yellow-500 hover:text-slate-900 transition-all">Match Target</button>
                         ) : <span className="text-emerald-500 text-[10px] font-black uppercase flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Optimized</span>}
                       </td>
                     </tr>
                   );
                }) : (
                  <tr><td colSpan="6" className="p-20 text-center text-slate-600 font-bold uppercase tracking-widest text-xs italic">Upload CSV to initialize workspace</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
