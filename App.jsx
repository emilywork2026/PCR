import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, Car, Users, Gauge, DollarSign, 
  Activity, MapPin, Filter, Search, Download, RefreshCw,
  Zap, Calendar, ArrowRight
} from 'lucide-react';

// Sample Data derived from the user's provided Expedia CSV format
// In a production environment, this would be fetched from your automated weekly scraper
const RAW_DATA = [
  { supplier: 'Budget', type: 'Midsize SUV', model: 'Ford Escape', price: 85, originalPrice: 86, rating: 84, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
  { supplier: 'Avis', type: 'Standard Elite', model: 'Audi Q5', price: 221, originalPrice: 225, rating: 81, transmission: 'Automatic', mileage: '200km', location: 'YVR Terminal' },
  { supplier: 'Enterprise', type: 'Compact', model: 'Nissan Versa', price: 62, originalPrice: 65, rating: 89, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
  { supplier: 'Hertz', type: 'Full-size SUV', model: 'Chevrolet Tahoe', price: 145, originalPrice: 160, rating: 78, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
  { supplier: 'Budget', type: 'Economy', model: 'Kia Rio', price: 45, originalPrice: 50, rating: 84, transmission: 'Manual', mileage: 'Unlimited', location: 'Off-site' },
  { supplier: 'Avis', type: 'Luxury', model: 'BMW 5 Series', price: 280, originalPrice: 300, rating: 85, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
  { supplier: 'Enterprise', type: 'Midsize SUV', model: 'Toyota RAV4', price: 88, originalPrice: 88, rating: 91, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
  { supplier: 'Hertz', type: 'Compact', model: 'Ford Focus', price: 58, originalPrice: 70, rating: 75, transmission: 'Automatic', mileage: 'Unlimited', location: 'YVR Terminal' },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const App = () => {
  const [data, setData] = useState(RAW_DATA);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(new Date().toLocaleDateString());

  // PCR Rate Calculation Logic & Dynamic Pricing Suggestion
  const metrics = useMemo(() => {
    const prices = data.map(d => d.price);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
    
    // Logic: Set our rate to be 5% lower than market median to maintain high PCR score
    const recommendedRate = (median * 0.95).toFixed(2);

    const processed = data.map(item => ({
      ...item,
      pcrScore: ((median / item.price) * 100).toFixed(1),
      savings: (item.originalPrice - item.price).toFixed(2)
    }));

    const avgPrice = (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2);
    const topDeal = [...processed].sort((a, b) => b.pcrScore - a.pcrScore)[0];

    return { processed, avgPrice, median, topDeal, recommendedRate };
  }, [data]);

  const supplierData = useMemo(() => {
    const groups = metrics.processed.reduce((acc, curr) => {
      acc[curr.supplier] = acc[curr.supplier] || { name: curr.supplier, count: 0, avgPrice: 0, sum: 0 };
      acc[curr.supplier].count++;
      acc[curr.supplier].sum += curr.price;
      acc[curr.supplier].avgPrice = (acc[curr.supplier].sum / acc[curr.supplier].count).toFixed(2);
      return acc;
    }, {});
    return Object.values(groups);
  }, [metrics]);

  const refreshData = () => {
    setLoading(true);
    // Simulating a weekly data fetch from a CSV/API endpoint
    setTimeout(() => {
      setLoading(false);
      setLastSync(new Date().toLocaleDateString());
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <Activity className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">PCR <span className="text-indigo-600">Dynamic</span> Pricing</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
              <Calendar className="w-3.5 h-3.5" />
              <span>Last Expedia Sync: {lastSync}</span>
            </div>
            <button 
              onClick={refreshData}
              className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-sm font-semibold hidden sm:inline">Refresh Market Rates</span>
            </button>
            <div className="h-8 w-px bg-slate-200 mx-2" />
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
              <MapPin className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">YVR - Vancouver Intl</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Dynamic Pricing Alert */}
        <div className="mb-8 bg-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-yellow-400 fill-yellow-400" />
              <span className="text-xs font-bold uppercase tracking-widest opacity-80">Smart Suggestion Engine</span>
            </div>
            <h2 className="text-3xl font-black mb-1">Set Weekly Rate: <span className="text-yellow-300">${metrics.recommendedRate}</span></h2>
            <p className="text-indigo-100 max-w-md">Targeting a 5% discount against the market median of ${metrics.median} to maximize PCR bookings.</p>
          </div>
          <div className="flex gap-4 relative z-10">
            <button className="px-6 py-3 bg-white text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-colors shadow-sm flex items-center gap-2">
              Apply to Fleet <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {/* Decorative Background Elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full -mr-20 -mt-20 opacity-20 blur-3xl"></div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard 
            title="Market Median" 
            value={`$${metrics.median}`} 
            icon={<DollarSign className="text-blue-600" />} 
            trend="+2.4% vs yesterday"
            trendUp={true}
          />
          <StatCard 
            title="Avg Daily Rate" 
            value={`$${metrics.avgPrice}`} 
            icon={<TrendingUp className="text-emerald-600" />} 
            trend="-0.5% vs avg"
            trendUp={false}
          />
          <StatCard 
            title="Market Inventory" 
            value={data.length} 
            icon={<Car className="text-amber-600" />} 
            trend="Live Expedia Feed"
            trendUp={true}
          />
          <StatCard 
            title="PCR Leader" 
            value={metrics.topDeal?.supplier || "N/A"} 
            icon={<Gauge className="text-purple-600" />} 
            trend={`${metrics.topDeal?.pcrScore}% Deal Rating`}
            trendUp={true}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Pricing by Supplier</h3>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-indigo-500 rounded-sm"></span>
                <span className="text-[10px] font-bold text-slate-400">AVG CAD</span>
              </div>
            </div>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                    cursor={{fill: '#f8fafc'}}
                  />
                  <Bar dataKey="avgPrice" radius={[6, 6, 0, 0]} fill="#4f46e5" barSize={45} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-6 uppercase text-xs tracking-widest">Price Distribution Curve</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.processed}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="type" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip />
                  <Area type="monotone" dataKey="price" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorPrice)" />
                  <Area type="monotone" dataKey="originalPrice" stroke="#94a3b8" strokeDasharray="5 5" fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Live Feed Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-12">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-800">Competitor Weekly Intel</h3>
              <p className="text-sm text-slate-500">Live capture from Expedia YVR Feed</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search fleet..."
                  className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-64"
                />
              </div>
              <button className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100">
                <Filter className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Vehicle Category</th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4">Market Rate</th>
                  <th className="px-6 py-4">PCR Efficiency</th>
                  <th className="px-6 py-4">User Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metrics.processed.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors group cursor-pointer">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-700 font-bold text-xs border border-indigo-100">
                          {item.supplier[0]}
                        </div>
                        <span className="font-bold text-slate-700">{item.supplier}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{item.model}</div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{item.type} • {item.transmission}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${
                        item.location === 'YVR Terminal' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {item.location === 'YVR Terminal' ? 'In Terminal' : 'Shuttle'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-black text-slate-900">${item.price}</span>
                        {item.savings > 0 && <span className="text-[10px] font-bold text-indigo-500">-${item.savings} drop</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ${parseFloat(item.pcrScore) > 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                            style={{width: `${Math.min(item.pcrScore, 100)}%`}}
                          />
                        </div>
                        <span className={`text-xs font-black ${parseFloat(item.pcrScore) > 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {item.pcrScore}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-slate-600">{item.rating}%</span>
                        <div className="flex gap-0.5">
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className={`w-1 h-1 rounded-full ${item.rating > 80 ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
};

const StatCard = ({ title, value, icon, trend, trendUp }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-default group">
    <div className="flex justify-between items-start mb-4">
      <div className="p-2.5 bg-slate-50 rounded-xl group-hover:bg-indigo-50 transition-colors">
        {React.cloneElement(icon, { size: 20 })}
      </div>
      <div className={`flex items-center text-[10px] font-bold px-2 py-1 rounded-full ${
        trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
      }`}>
        {trend}
      </div>
    </div>
    <div className="text-2xl font-black text-slate-900 mb-1">{value}</div>
    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</div>
  </div>
);

export default App;
