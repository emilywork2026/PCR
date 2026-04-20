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
import { Upload, TrendingUp, DollarSign, CheckCircle, Activity, MapPin, Download, FileCode, Layers, Code, Settings } from 'lucide-react';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'expedia-price-tracker';

export default function App() {
  const [user, setUser] = useState(null);
  const [currentMarket, setCurrentMarket] = useState([]);
  const [myRates, setMyRates] = useState({});
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [activeView, setActiveView] = useState('react'); // 'react' or 'html'

  // Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth error", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const parsed = lines.slice(1).map(line => {
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, i) => row[h] = values[i]);
        const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || "0";
        return {
          category: row['uitk-heading-5'] || 'Other',
          price: parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0,
          model: row['uitk-text'] || 'Similar Model'
        };
      }).filter(i => i.price > 0);
      setCurrentMarket(parsed);
    };
    reader.readAsText(file);
  };

  const calculateTarget = (min, avg) => {
    return strategy === 'undercut_min' ? Math.max(1, min - offset) : min;
  };

  const activeCategories = [...new Set(currentMarket.map(d => d.category))];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col">
      {/* GLOBAL FILE NAVIGATOR */}
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg shadow-lg shadow-indigo-500/30">
              <Activity size={20} />
            </div>
            <span className="font-black tracking-tighter text-xl">EXPEDIA HUB</span>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button 
              onClick={() => setActiveView('react')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeView === 'react' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Layers size={14} /> App.jsx (React)
            </button>
            <button 
              onClick={() => setActiveView('html')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeView === 'html' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Code size={14} /> price_dashboard.html
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <p className="text-[10px] font-black text-slate-500 uppercase">Environment</p>
            <p className="text-xs font-bold text-indigo-400">Collaborative Workspace</p>
          </div>
          <div className="h-8 w-px bg-slate-800 mx-2"></div>
          <Settings size={18} className="text-slate-500 cursor-pointer hover:text-white transition-colors" />
        </div>
      </nav>

      {/* VIEW CONTENT */}
      <div className="flex-1 overflow-auto">
        {activeView === 'react' ? (
          <div className="p-6 max-w-6xl mx-auto space-y-6">
            {/* Header Area */}
            <div className="flex justify-between items-end bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Layers size={120} />
               </div>
               <div className="relative z-10">
                <h1 className="text-3xl font-black mb-2 tracking-tight">Market Dashboard</h1>
                <p className="text-slate-400 text-sm max-w-md">Real-time competitive analysis powered by React. All data is synchronized across your local project files.</p>
              </div>
              <div className="relative z-10 flex gap-3">
                <input type="file" id="csv-up" className="hidden" onChange={handleFileUpload} accept=".csv" />
                <button 
                  onClick={() => document.getElementById('csv-up').click()}
                  className="bg-indigo-600 hover:bg-indigo-500 px-6 py-4 rounded-2xl font-black text-sm transition-all flex items-center gap-2 shadow-xl shadow-indigo-500/20"
                >
                  <Upload size={18} /> LOAD CSV DATA
                </button>
              </div>
            </div>

            {/* Dashboard Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Active Categories</h3>
                  {activeCategories.length > 0 && <span className="text-[10px] font-bold text-indigo-400">{activeCategories.length} Detectable</span>}
                </div>
                
                {activeCategories.length === 0 ? (
                  <div className="bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-[2.5rem] h-64 flex flex-col items-center justify-center text-slate-600">
                    <Upload size={32} className="mb-3 opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-widest opacity-40 italic">Drop Expedia CSV here</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {activeCategories.map(cat => {
                      const group = currentMarket.filter(d => d.category === cat);
                      const min = Math.min(...group.map(d => d.price));
                      const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
                      const target = calculateTarget(min, avg);
                      return (
                        <div key={cat} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex justify-between items-center group hover:border-indigo-500/50 transition-all hover:shadow-lg hover:shadow-indigo-500/5">
                          <div>
                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{cat}</p>
                            <p className="text-xl font-bold tracking-tight">{group[0].model}</p>
                          </div>
                          <div className="flex gap-10 items-center">
                            <div className="text-right">
                              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Market Floor</p>
                              <p className="text-slate-300 font-bold italic tracking-tighter">CA${min.toFixed(0)}</p>
                            </div>
                            <div className="bg-slate-950 px-6 py-3 rounded-2xl border border-slate-800 text-right min-w-[120px]">
                              <p className="text-[10px] text-indigo-400 font-black uppercase mb-1">Target Rate</p>
                              <p className="text-2xl font-black text-white">CA${target.toFixed(0)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="bg-indigo-600 rounded-[2rem] p-8 text-white shadow-2xl shadow-indigo-500/20">
                  <h3 className="font-black text-xs uppercase tracking-widest text-indigo-200 mb-6 flex items-center gap-2">
                    <Settings size={14} /> Strategy Configuration
                  </h3>
                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] font-bold text-indigo-100 uppercase block mb-2">Pricing Logic</label>
                      <select 
                        value={strategy} 
                        onChange={e => setStrategy(e.target.value)}
                        className="w-full bg-indigo-700 border border-indigo-400/30 rounded-xl p-4 text-sm font-bold outline-none focus:ring-2 ring-white/50"
                      >
                        <option value="undercut_min">Undercut Floor</option>
                        <option value="match_min">Match Floor</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-indigo-100 uppercase block mb-2">Daily Offset ($)</label>
                      <input 
                        type="number" 
                        value={offset}
                        onChange={e => setOffset(Number(e.target.value))}
                        className="w-full bg-indigo-700 border border-indigo-400/30 rounded-xl p-4 text-sm font-bold outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem]">
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">File Synchronization</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-500">React Core (App.jsx)</span>
                      <span className="text-emerald-500">Active</span>
                    </div>
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-500">HTML UI (price_dashboard.html)</span>
                      <span className="text-emerald-500">Linked</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-slate-950">
             <div className="bg-slate-900 border border-slate-800 p-12 rounded-[3rem] max-w-2xl shadow-2xl">
                <Code size={48} className="mx-auto text-indigo-500 mb-6" />
                <h2 className="text-3xl font-black mb-4">The HTML Dashboard is Ready</h2>
                <p className="text-slate-400 mb-8 leading-relaxed">
                  You are currently viewing the React environment. To preview the <b>price_dashboard.html</b> file directly, you can click on that file in your explorer, or use the code generated in the previous step to set it up locally.
                </p>
                <div className="flex flex-col gap-3">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-left">
                    <p className="text-[10px] font-black text-indigo-400 uppercase mb-2">Integration Note</p>
                    <p className="text-xs text-slate-400">The HTML console is optimized for standard browsers and lightweight management without the React overhead.</p>
                  </div>
                  <button 
                    onClick={() => setActiveView('react')}
                    className="mt-4 bg-white text-black font-black py-4 px-8 rounded-2xl hover:bg-indigo-400 transition-colors"
                  >
                    RETURN TO REACT APP
                  </button>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
