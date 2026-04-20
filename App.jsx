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
import { Upload, TrendingUp, DollarSign, CheckCircle, Activity, MapPin, Truck, Download } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(__firebase_config);
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
  
  // Filter States
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [fleetFilter, setFleetFilter] = useState([]);

  // 1. Auth Logic (RULE 3)
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

  // 2. Data Fetching (RULE 1 & 2)
  useEffect(() => {
    if (!user) return;
    const historyCol = collection(db, 'artifacts', appId, 'public', 'data', 'price_history');
    const unsubscribe = onSnapshot(historyCol, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistoricalData(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore error:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const cleanPrice = (str) => {
    if (!str) return 0;
    const cleaned = str.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  };

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    return lines.slice(1).map(line => {
      const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((header, i) => {
        row[header] = values[i];
      });
      return row;
    });
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const results = parseCSV(text);
      
      const parsed = results.map(row => {
        const title = row['title'] || row['is-visually-hidden'] || '';
        const vendorMatch = title.match(/from (.*?) at/);
        const vendor = vendorMatch ? vendorMatch[1] : 'Unknown Provider';
        
        const locMatch = (row['_container_link'] || "").match(/locn=(.*?)&/);
        const location = locMatch ? decodeURIComponent(locMatch[1]).replace(/\+/g, ' ') : "Market Generic";

        const priceRaw = row['uitk-text_10'] || row['uitk-text_8'] || row['uitk-text_7'];
        const price = cleanPrice(priceRaw);
        
        return {
          category: row['uitk-heading-5'] || 'Other',
          vendor: vendor,
          price: price,
          model: row['uitk-text'] || 'Similar Model',
          location: location
        };
      }).filter(i => i.price > 0);

      if (parsed.length > 0) {
        setCurrentMarket(parsed);
        saveToHistory(parsed);
        if (fleetFilter.length === 0) {
          setFleetFilter([...new Set(parsed.map(p => p.category))]);
        }
      }
    };
    reader.readAsText(file);
  };

  const saveToHistory = async (data) => {
    if (!user) return;
    const dateKey = new Date().toISOString().split('T')[0];
    const categories = [...new Set(data.map(d => d.category))];
    
    const dailySummary = {
      date: dateKey,
      timestamp: Date.now(),
      location: data[0]?.location || "Unknown",
      categories: categories.map(cat => {
        const catPrices = data.filter(d => d.category === cat).map(d => d.price);
        return {
          name: cat,
          avg: catPrices.reduce((a,b) => a + b, 0) / catPrices.length,
          min: Math.min(...catPrices)
        };
      })
    };

    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'price_history', dateKey), dailySummary);
    } catch (err) {
      console.error("Save error", err);
    }
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

  const availableLocations = useMemo(() => ['All Locations', ...new Set(currentMarket.map(d => d.location))], [currentMarket]);
  const allPossibleCategories = useMemo(() => [...new Set(currentMarket.map(d => d.category))], [currentMarket]);

  const trendChartData = useMemo(() => {
    const sorted = [...historicalData].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.map(day => {
      const entry = { date: day.date };
      day.categories?.forEach(cat => {
        if (fleetFilter.length === 0 || fleetFilter.includes(cat.name)) {
          entry[cat.name] = cat.avg;
        }
      });
      return entry;
    });
  }, [historicalData, fleetFilter]);

  const activeCategories = useMemo(() => [...new Set(filteredMarket.map(d => d.category))], [filteredMarket]);

  const toggleFleetItem = (cat) => {
    setFleetFilter(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const exportRateSheet = () => {
    if (activeCategories.length === 0) return;
    
    let csv = "Category,Location,Market Min,Market Avg,My Current Rate,Target Rate,Action Required\n";
    
    activeCategories.forEach(cat => {
      const group = filteredMarket.filter(d => d.category === cat);
      const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
      const min = Math.min(...group.map(d => d.price));
      const target = calculateTarget(min, avg);
      const current = myRates[cat] || 0;
      const action = current > target ? "LOWER RATE" : "COMPETITIVE";
      
      csv += `"${cat}","${selectedLocation}",${min.toFixed(2)},${avg.toFixed(2)},${current.toFixed(2)},${target.toFixed(2)},${action}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `Rate_Sheet_${selectedLocation}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center font-sans text-white">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto"></div>
        <p className="text-slate-400 font-medium">Syncing Fleet Intelligence...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-800 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-indigo-500 p-1.5 rounded-lg shadow-lg shadow-indigo-500/20">
                <Activity size={20} className="text-white" />
              </div>
              <h1 className="text-3xl font-black tracking-tight text-white">Rate Manager</h1>
            </div>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <MapPin size={14} className="text-indigo-400" /> 
              {selectedLocation} • {activeCategories.length} Active Fleet Categories
            </p>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <input type="file" id="upload" className="hidden" onChange={handleFileUpload} accept=".csv" />
            <button 
              onClick={() => document.getElementById('upload').click()}
              className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-500/20"
            >
              <Upload size={20} /> Update Market Data
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <aside className="space-y-6">
            <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl">
              <h3 className="font-bold text-sm uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                <MapPin size={16} /> Pickup Location
              </h3>
              <select 
                className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl outline-none focus:ring-2 ring-indigo-500/50 text-sm"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                {availableLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </div>

            <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl">
              <h3 className="font-bold text-sm uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                <Truck size={16} /> My Fleet Filter
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {allPossibleCategories.length === 0 && <p className="text-xs text-slate-600 italic">No categories detected yet.</p>}
                {allPossibleCategories.map(cat => (
                  <label key={cat} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors group">
                    <input 
                      type="checkbox" 
                      checked={fleetFilter.includes(cat)}
                      onChange={() => toggleFleetItem(cat)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className={`text-xs font-bold ${fleetFilter.includes(cat) ? 'text-slate-200' : 'text-slate-500'}`}>{cat}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-indigo-600/10 rounded-3xl p-6 border border-indigo-500/20">
              <h3 className="font-bold text-sm text-indigo-400 mb-4 flex items-center gap-2">
                <DollarSign size={16} /> Strategy
              </h3>
              <div className="space-y-4">
                <select 
                  className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl outline-none text-xs font-bold"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                >
                  <option value="undercut_min">Undercut Floor</option>
                  <option value="match_min">Match Floor</option>
                  <option value="undercut_avg">Undercut Avg</option>
                  <option value="premium">Premium (+5%)</option>
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-bold">$</span>
                  <input 
                    type="number" 
                    className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl text-xs"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                    placeholder="Offset CA$"
                  />
                </div>
              </div>
            </div>
          </aside>

          <div className="lg:col-span-3 space-y-8">
            <section className="bg-slate-900 rounded-[2rem] p-8 border border-slate-800 shadow-2xl">
              <h2 className="text-xl font-bold mb-8 flex items-center gap-3">
                <TrendingUp size={20} className="text-indigo-400" /> 30-Day Fleet Price Trends
              </h2>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" stroke="#475569" fontSize={10} />
                    <YAxis stroke="#475569" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '16px' }} />
                    {fleetFilter.slice(0, 5).map((cat, idx) => (
                      <Area 
                        key={cat} 
                        type="monotone" 
                        dataKey={cat} 
                        stroke={['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'][idx % 5]} 
                        fill="url(#colorPrice)"
                        strokeWidth={3}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="bg-slate-900 rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl font-bold">Rate Setup Workflow</h2>
                  <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Managing {activeCategories.length} Categories</p>
                </div>
                <button 
                  onClick={exportRateSheet}
                  disabled={activeCategories.length === 0}
                  className="bg-slate-800 hover:bg-slate-700 text-indigo-400 px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 border border-slate-700 disabled:opacity-50 shadow-lg shadow-indigo-500/5"
                >
                  <Download size={14} /> Export Rate Sheet
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-800/30 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                    <tr>
                      <th className="p-8">Fleet Category</th>
                      <th className="p-8">Expedia Context</th>
                      <th className="p-8">Your Rate</th>
                      <th className="p-8">Target</th>
                      <th className="p-8 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {activeCategories.map(cat => {
                      const group = filteredMarket.filter(d => d.category === cat);
                      const avg = group.reduce((a,b)=>a+b.price,0)/group.length;
                      const min = Math.min(...group.map(d => d.price));
                      const target = calculateTarget(min, avg);
                      const current = myRates[cat] || 0;
                      const isHigh = current > target;

                      return (
                        <tr key={cat} className="hover:bg-slate-800/20 transition-all">
                          <td className="p-8">
                            <span className="text-lg font-bold text-white block">{cat}</span>
                            <span className="text-xs text-slate-500">{group[0]?.model}</span>
                          </td>
                          <td className="p-8">
                            <div className="space-y-1">
                              <div className="flex items-center gap-3 text-xs">
                                <span className="w-8 text-slate-500">Min</span>
                                <span className="text-emerald-400 font-black">CA${min.toFixed(0)}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                <span className="w-8 text-slate-500">Avg</span>
                                <span className="text-slate-400 font-black">CA${avg.toFixed(0)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-8">
                            <div className="relative max-w-[120px]">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 font-bold">$</span>
                              <input 
                                type="number"
                                className={`w-full bg-slate-950 border ${isHigh ? 'border-orange-500 ring-2 ring-orange-500/10' : 'border-slate-700'} rounded-xl py-2 px-7 font-black text-white outline-none`}
                                value={current || ''}
                                onChange={(e) => setMyRates({...myRates, [cat]: parseFloat(e.target.value)})}
                              />
                            </div>
                          </td>
                          <td className="p-8">
                            <div className="flex flex-col">
                              <span className="text-indigo-400 text-xl font-black">CA${target.toFixed(0)}</span>
                              <span className="text-[10px] text-slate-500 uppercase font-black">Target</span>
                            </div>
                          </td>
                          <td className="p-8 text-right">
                            {isHigh ? (
                              <button 
                                onClick={() => setMyRates({...myRates, [cat]: target})}
                                className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-[10px] font-black transition-all shadow-lg shadow-orange-500/20"
                              >
                                MATCH
                              </button>
                            ) : (
                              <div className="text-emerald-500 flex items-center justify-end gap-1 font-black text-[10px]">
                                <CheckCircle size={14} /> OK
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
