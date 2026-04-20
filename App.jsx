import React, { useState, useEffect } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { Upload, Activity, Settings, FileText, ChevronRight } from 'lucide-react';

const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    return JSON.parse(__firebase_config);
  }
  return { apiKey: "preview", projectId: "preview" };
};

const firebaseConfig = getFirebaseConfig();
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

export default function App() {
  const [user, setUser] = useState(null);
  const [currentMarket, setCurrentMarket] = useState([]);
  const [strategy, setStrategy] = useState('undercut_min');
  const [offset, setOffset] = useState(2);
  const [rawText, setRawText] = useState('');
  const [editMode, setEditMode] = useState('upload'); 

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
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // Built-in parser to avoid "Papa is not defined"
  const parseCSVContent = (text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return;
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const parsed = lines.slice(1).map(line => {
      // Regex to handle commas inside quotes
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((h, i) => row[h] = values[i]);
      
      const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || row['price'] || "0";
      return {
        category: row['uitk-heading-5'] || row['category'] || 'Other',
        price: parseFloat(priceRaw.replace(/[^0-9.]/g, '')) || 0,
        model: row['uitk-text'] || 'Similar Model'
      };
    }).filter(i => i && i.price > 0);
    
    setCurrentMarket(parsed);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => parseCSVContent(event.target.result);
    reader.readAsText(file);
  };

  const handleTextSubmit = () => {
    parseCSVContent(rawText);
  };

  const calculateTarget = (min) => {
    return strategy === 'undercut_min' ? Math.max(1, min - offset) : min;
  };

  const activeCategories = [...new Set(currentMarket.map(d => d.category))];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col">
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-1.5 rounded-lg">
            <Activity size={20} />
          </div>
          <span className="font-black tracking-tighter text-xl text-white uppercase">EXPEDIA PRO</span>
        </div>
        <div className="text-xs font-bold text-indigo-400 px-3 py-1 bg-indigo-400/10 rounded-full border border-indigo-400/20">
          Production Ready
        </div>
      </nav>

      <main className="p-6 max-w-6xl mx-auto w-full">
        <div className="space-y-6">
          <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h1 className="text-3xl font-black text-white">Market Input</h1>
                <p className="text-slate-400 text-sm">Upload CSV or paste text data below.</p>
              </div>
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button onClick={() => setEditMode('upload')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${editMode === 'upload' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Upload</button>
                <button onClick={() => setEditMode('text')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${editMode === 'text' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Text</button>
              </div>
            </div>

            {editMode === 'upload' ? (
              <div className="border-2 border-dashed border-slate-800 rounded-3xl py-10 flex flex-col items-center">
                <input type="file" id="csv-up" className="hidden" onChange={handleFileUpload} accept=".csv" />
                <button onClick={() => document.getElementById('csv-up').click()} className="bg-indigo-600 px-8 py-4 rounded-2xl font-black text-sm text-white">SELECT CSV FILE</button>
                <p className="text-slate-600 text-[10px] font-bold mt-4 uppercase">Direct Scraper Exports Supported</p>
              </div>
            ) : (
              <div className="space-y-4">
                <textarea className="w-full h-40 bg-slate-950 border border-slate-800 rounded-3xl p-6 text-sm font-mono text-indigo-100 outline-none" placeholder="Paste CSV rows here..." value={rawText} onChange={(e) => setRawText(e.target.value)} />
                <button onClick={handleTextSubmit} className="w-full bg-slate-800 py-4 rounded-2xl font-black text-sm text-indigo-400 border border-slate-700">PROCESS TEXT</button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              {activeCategories.length === 0 ? (
                <div className="bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-[2.5rem] h-64 flex items-center justify-center text-slate-600 italic">No Market Data</div>
              ) : (
                activeCategories.map(cat => {
                  const group = currentMarket.filter(d => d.category === cat);
                  const min = Math.min(...group.map(d => d.price));
                  const target = calculateTarget(min);
                  return (
                    <div key={cat} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex justify-between items-center transition-all hover:border-indigo-500/50">
                      <div>
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{cat}</p>
                        <p className="text-xl font-bold text-white">{group[0].model}</p>
                      </div>
                      <div className="text-right bg-indigo-500/5 px-6 py-3 rounded-2xl border border-indigo-500/10">
                        <p className="text-[10px] text-indigo-400 font-black uppercase mb-1">Target Rate</p>
                        <p className="text-2xl font-black text-white">CA${target.toFixed(0)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-indigo-600 rounded-[2rem] p-8 text-white shadow-2xl sticky top-6">
                <h3 className="font-black text-xs uppercase tracking-widest mb-6">Settings</h3>
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase block mb-2 text-indigo-200">Logic</label>
                    <select value={strategy} onChange={e => setStrategy(e.target.value)} className="w-full bg-indigo-700 border-none rounded-xl p-4 text-sm font-bold text-white outline-none">
                      <option value="undercut_min">Undercut Floor</option>
                      <option value="match_min">Match Floor</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase block mb-2 text-indigo-200">Offset ($)</label>
                    <input type="number" value={offset} onChange={e => setOffset(Number(e.target.value))} className="w-full bg-indigo-700 border-none rounded-xl p-4 text-sm font-bold text-white outline-none" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
