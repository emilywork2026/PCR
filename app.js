// ── Config ──────────────────────────────────────────────────────────────────
const BRANDS = [
  { name: 'Avis',       color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)'   },
  { name: 'Enterprise', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)'   },
  { name: 'Budget',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.3)'  },
  { name: 'Hertz',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)'  },
];
const PCR_COLOR = '#818cf8';
const MAX_WEEKS = 13;
const STORAGE_KEY = 'pcr_sat_v2';

// ── State ────────────────────────────────────────────────────────────────────
let history = [];
let myRates = {};   // { "2025-04-26": 45.00, ... }
let charts = {};

// ── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadStorage();
  buildExpediaLinks();
  buildBrandInputs();
  renderCaptureLive();
  renderHistory();
  setCaptureDateLabel();
});

// ── Storage ──────────────────────────────────────────────────────────────────
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      history  = parsed.history  || [];
      myRates  = parsed.myRates  || {};
    }
  } catch(e) { history = []; myRates = {}; }
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ history, myRates })); } catch(e) {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function nextSaturday() {
  const d = new Date();
  const diff = (6 - d.getDay() + 7) % 7 || 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + diff);
  sat.setHours(0,0,0,0);
  return sat;
}
function toDateKey(d) { return d.toISOString().slice(0,10); }
function fmtShort(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function fmtFull(d) {
  return d.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}
function avg(arr) {
  const f = arr.filter(v => v !== null && !isNaN(v));
  return f.length ? f.reduce((a,b) => a+b, 0) / f.length : null;
}
function showToast(msg = 'Saved!') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Tab nav ──────────────────────────────────────────────────────────────────
function showTab(name) {
  ['capture','analyze','strategy'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('hidden', t !== name);
    document.getElementById('btn-' + t).classList.toggle('active', t === name);
  });
  if (name === 'analyze')  renderAnalyze();
  if (name === 'strategy') renderStrategy();
}

// ── Capture tab ──────────────────────────────────────────────────────────────
function setCaptureDateLabel() {
  const sat = nextSaturday();
  document.getElementById('capture-date').textContent = fmtFull(sat);
}

function buildExpediaLinks() {
  const sat = nextSaturday();
  const d1 = toDateKey(sat);
  const d2next = new Date(sat); d2next.setDate(sat.getDate()+1);
  const d2 = toDateKey(d2next);
  const el = document.getElementById('expedia-links');
  BRANDS.forEach(b => {
    const a = document.createElement('a');
    a.href = `https://www.expedia.com/carsearch?locn=YVR&date1=${d1}&date2=${d2}&filterCarCompany=${b.name.toUpperCase()}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:500;border:1px solid ${b.border};background:${b.bg};color:${b.color};text-decoration:none;transition:opacity .12s`;
    a.onmouseenter = () => a.style.opacity = '0.75';
    a.onmouseleave = () => a.style.opacity = '1';
    a.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>${b.name} on Expedia`;
    el.appendChild(a);
  });
}

function buildBrandInputs() {
  const el = document.getElementById('brand-inputs');
  BRANDS.forEach(b => {
    const div = document.createElement('div');
    div.style.cssText = `background:${b.bg};border:1px solid ${b.border};border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px`;
    div.innerHTML = `
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500;color:${b.color};margin-bottom:6px">${b.name}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:13px;color:#64748b">CA$</span>
          <input type="number" min="0" step="0.01" placeholder="0.00"
            id="inp_${b.name}"
            oninput="renderCaptureLive()"
            style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;color:white;font-family:'DM Mono',monospace;font-size:15px;width:100px;outline:none">
        </div>
      </div>`;
    el.appendChild(div);
  });
}

function getInputVals() {
  return BRANDS.map(b => {
    const v = parseFloat(document.getElementById('inp_' + b.name)?.value);
    return { name: b.name, val: isNaN(v) ? null : v };
  });
}

function renderCaptureLive() {
  const vals = getInputVals();
  const prices = vals.map(v => v.val).filter(v => v !== null);
  const el = document.getElementById('live-stats');
  const rec = document.getElementById('rec-content');

  if (prices.length < 2) { el.innerHTML = ''; rec.innerHTML = '<span style="color:#475569">Enter at least 2 rates above to see recommendation.</span>'; return; }

  const mktAvg = avg(prices);
  const mktMin = Math.min(...prices);
  const mktMax = Math.max(...prices);
  const sug = calcTarget(mktMin, mktAvg);

  el.innerHTML = [
    { label: 'Market avg',  val: `CA$${mktAvg.toFixed(2)}`, color: '#e2e8f0' },
    { label: 'Lowest',      val: `CA$${mktMin.toFixed(2)}`, color: '#34d399' },
    { label: 'Highest',     val: `CA$${mktMax.toFixed(2)}`, color: '#f87171' },
    { label: 'Suggest PCR', val: `CA$${sug.toFixed(2)}`,    color: PCR_COLOR  },
  ].map(s => `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px">
      <div style="font-size:11px;color:#64748b;margin-bottom:4px">${s.label}</div>
      <div style="font-size:20px;font-weight:500;color:${s.color};font-family:'DM Mono',monospace">${s.val}</div>
    </div>`).join('');

  const cheapBrand = vals.find(v => v.val === mktMin);
  const spread = (mktMax - mktMin).toFixed(2);
  rec.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div style="font-size:32px;font-weight:600;color:${PCR_COLOR};font-family:'DM Mono',monospace">CA$${sug.toFixed(2)}</div>
      <div style="font-size:12px;color:#64748b;line-height:1.5">recommended<br>before-tax daily rate</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#94a3b8">
      <div>Positions PCR competitively below the market average of <strong style="color:#e2e8f0">CA$${mktAvg.toFixed(2)}</strong>.</div>
      ${cheapBrand ? `<div><strong style="color:#e2e8f0">${cheapBrand.name}</strong> is cheapest at CA$${cheapBrand.val.toFixed(2)} — stay above them to signal quality, not desperation.</div>` : ''}
      ${parseFloat(spread) > 4 ? `<div>Market spread is CA$${spread} — consider nudging up on peak Saturdays closer to CA$${(mktAvg * 1.02).toFixed(2)}.</div>` : ''}
    </div>`;
}

function saveEntry() {
  const vals = getInputVals();
  const sat = nextSaturday();
  const dateKey = toDateKey(sat);
  const rates = {};
  vals.forEach(v => { if (v.val !== null) rates[v.name] = v.val; });
  if (!Object.keys(rates).length) { showToast('Enter at least one rate first'); return; }

  const idx = history.findIndex(h => h.date === dateKey);
  const entry = { date: dateKey, rates };
  if (idx >= 0) history[idx] = entry; else history.unshift(entry);
  history = history.slice(0, MAX_WEEKS);
  persist();
  renderHistory();
  showToast('Saturday rates saved!');
}

function renderHistory() {
  const el = document.getElementById('history-table');
  if (!history.length) {
    el.innerHTML = '<p style="color:#475569;font-size:13px;padding:8px 0">No entries yet — save your first Saturday above.</p>';
    return;
  }
  let html = `<table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:#475569;font-size:11px;text-transform:uppercase;letter-spacing:.05em">
      <th style="padding:6px 12px 6px 0;text-align:left">Saturday</th>
      ${BRANDS.map(b => `<th style="padding:6px 8px;text-align:left;color:${b.color}">${b.name}</th>`).join('')}
      <th style="padding:6px 8px;text-align:left;color:${PCR_COLOR}">PCR rec</th>
    </tr></thead><tbody>`;

  history.forEach(e => {
    const prices = Object.values(e.rates).filter(v => v !== null);
    const mkt = avg(prices);
    const lo = prices.length ? Math.min(...prices) : null;
    const hi = prices.length ? Math.max(...prices) : null;
    const sug = mkt ? calcTarget(lo, mkt) : null;
    html += `<tr style="border-top:1px solid rgba(255,255,255,0.05)">
      <td style="padding:8px 12px 8px 0;color:#94a3b8;font-family:'DM Mono',monospace">${fmtShort(e.date)}</td>
      ${BRANDS.map(b => {
        const v = e.rates[b.name];
        if (v == null) return `<td style="padding:8px;color:#334155">—</td>`;
        let bg = '', color = '#e2e8f0';
        if (v === lo && lo !== hi) { bg = 'background:rgba(34,197,94,0.1);'; color = '#34d399'; }
        if (v === hi && lo !== hi) { bg = 'background:rgba(248,113,113,0.1);'; color = '#f87171'; }
        return `<td style="padding:8px"><span style="${bg}color:${color};font-family:'DM Mono',monospace;padding:2px 6px;border-radius:4px">CA$${v.toFixed(2)}</span></td>`;
      }).join('')}
      <td style="padding:8px;color:${PCR_COLOR};font-family:'DM Mono',monospace;font-weight:500">${sug ? `CA$${sug.toFixed(2)}` : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ── Strategy logic ────────────────────────────────────────────────────────────
function calcTarget(mktMin, mktAvg) {
  const strategy = document.getElementById('strategySelect')?.value || 'undercut_avg';
  const offset = parseFloat(document.getElementById('strategyOffset')?.value) || 2;
  switch (strategy) {
    case 'undercut_min': return Math.max(1, mktMin - offset);
    case 'match_min':    return mktMin;
    case 'undercut_avg': return Math.max(1, mktAvg - offset);
    case 'premium':      return mktAvg * 1.05;
    default:             return Math.max(1, mktAvg - offset);
  }
}

// ── Analyze tab ───────────────────────────────────────────────────────────────
function renderAnalyze() {
  if (!history.length) {
    document.getElementById('analyze-stats').innerHTML = '<div style="grid-column:span 4;color:#475569;font-size:13px">No data yet — capture some Saturdays first.</div>';
    document.getElementById('breakdown-table').innerHTML = '';
    return;
  }

  const allPrices = history.flatMap(e => Object.values(e.rates).filter(v => v !== null));
  const mktAvg = avg(allPrices);
  const mktMin = allPrices.length ? Math.min(...allPrices) : null;
  const mktMax = allPrices.length ? Math.max(...allPrices) : null;

  const brandAvgs = {};
  BRANDS.forEach(b => {
    const vals = history.map(e => e.rates[b.name]).filter(v => v != null);
    brandAvgs[b.name] = avg(vals);
  });
  const cheapest = BRANDS.reduce((a, b) => (brandAvgs[a.name] || 999) < (brandAvgs[b.name] || 999) ? a : b);

  document.getElementById('analyze-stats').innerHTML = [
    { label: '13-wk market avg', val: mktAvg ? `CA$${mktAvg.toFixed(2)}` : '—', color: '#e2e8f0' },
    { label: 'Market floor',     val: mktMin ? `CA$${mktMin.toFixed(2)}` : '—', color: '#34d399' },
    { label: 'Market ceiling',   val: mktMax ? `CA$${mktMax.toFixed(2)}` : '—', color: '#f87171' },
    { label: 'Cheapest brand',   val: cheapest.name, color: cheapest.color },
  ].map(s => `
    <div class="stat-card">
      <div style="font-size:11px;color:#64748b;margin-bottom:6px">${s.label}</div>
      <div style="font-size:22px;font-weight:500;color:${s.color};font-family:'DM Mono',monospace">${s.val}</div>
    </div>`).join('');

  // Trend chart
  const sorted = [...history].sort((a,b) => a.date.localeCompare(b.date));
  const labels = sorted.map(e => fmtShort(e.date));
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels,
      datasets: BRANDS.map(b => ({
        label: b.name,
        data: sorted.map(e => e.rates[b.name] ?? null),
        borderColor: b.color,
        backgroundColor: b.bg,
        borderWidth: 2,
        pointRadius: 4,
        spanGaps: true,
        tension: 0.35,
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#64748b', boxWidth: 12 } } },
      scales: {
        y: { ticks: { color: '#64748b', callback: v => 'CA$' + v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#64748b' }, grid: { display: false } }
      }
    }
  });

  // Brand avg chart
  if (charts.brandAvg) charts.brandAvg.destroy();
  charts.brandAvg = new Chart(document.getElementById('avgChart'), {
    type: 'bar',
    data: {
      labels: BRANDS.map(b => b.name),
      datasets: [{ label: '13-wk avg', data: BRANDS.map(b => brandAvgs[b.name]), backgroundColor: BRANDS.map(b => b.color), borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: '#64748b', callback: v => 'CA$' + v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#64748b' }, grid: { display: false } }
      }
    }
  });

  // Breakdown table
  let html = `<table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:#475569;font-size:11px;text-transform:uppercase">
      <th style="padding:6px 12px 6px 0;text-align:left">Saturday</th>
      ${BRANDS.map(b => `<th style="padding:6px 8px;color:${b.color}">${b.name}</th>`).join('')}
      <th style="padding:6px 8px;text-align:left">Cheapest</th>
      <th style="padding:6px 8px;text-align:left">Priciest</th>
    </tr></thead><tbody>`;
  sorted.forEach(e => {
    const prices = BRANDS.map(b => e.rates[b.name] ?? null);
    const defined = prices.filter(v => v !== null);
    const lo = defined.length ? Math.min(...defined) : null;
    const hi = defined.length ? Math.max(...defined) : null;
    const loBrand = lo !== null ? BRANDS[prices.indexOf(lo)] : null;
    const hiBrand = hi !== null ? BRANDS[prices.lastIndexOf(hi)] : null;
    html += `<tr style="border-top:1px solid rgba(255,255,255,0.05)">
      <td style="padding:8px 12px 8px 0;color:#94a3b8;font-family:'DM Mono',monospace">${fmtShort(e.date)}</td>
      ${prices.map((v, i) => {
        if (v === null) return `<td style="padding:8px;color:#334155">—</td>`;
        let bg = '', col = '#e2e8f0';
        if (v === lo && lo !== hi) { bg = 'rgba(34,197,94,0.1)'; col = '#34d399'; }
        if (v === hi && lo !== hi) { bg = 'rgba(248,113,113,0.1)'; col = '#f87171'; }
        return `<td style="padding:8px"><span style="background:${bg};color:${col};font-family:'DM Mono',monospace;padding:2px 6px;border-radius:4px">CA$${v.toFixed(2)}</span></td>`;
      }).join('')}
      <td style="padding:8px">${loBrand ? `<span style="color:${loBrand.color};font-size:12px;font-weight:500">${loBrand.name}</span>` : '—'}</td>
      <td style="padding:8px">${hiBrand ? `<span style="color:${hiBrand.color};font-size:12px;font-weight:500">${hiBrand.name}</span>` : '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('breakdown-table').innerHTML = html;
}

// ── Strategy tab ──────────────────────────────────────────────────────────────
function renderStrategy() {
  if (!history.length) {
    document.getElementById('strategy-stats').innerHTML = '<div style="grid-column:span 3;color:#475569;font-size:13px">No data yet.</div>';
    document.getElementById('strategy-table').innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:#475569;font-style:italic">No data — capture some Saturdays first.</td></tr>';
    return;
  }

  const sorted = [...history].sort((a,b) => a.date.localeCompare(b.date));
  const allPrices = sorted.flatMap(e => Object.values(e.rates).filter(v => v !== null));
  const overallAvg = avg(allPrices);
  const overallMin = allPrices.length ? Math.min(...allPrices) : null;
  const weekTargets = sorted.map(e => {
    const prices = Object.values(e.rates).filter(v => v !== null);
    const mkt = avg(prices);
    const lo = prices.length ? Math.min(...prices) : null;
    return { date: e.date, mkt, lo, target: mkt ? calcTarget(lo, mkt) : null };
  });
  const avgTarget = avg(weekTargets.map(w => w.target).filter(v => v !== null));
  let updateAlerts = 0;

  document.getElementById('strategy-stats').innerHTML = [
    { label: 'Overall market avg', val: overallAvg ? `CA$${overallAvg.toFixed(2)}` : '—', color: '#e2e8f0' },
    { label: 'Overall market min', val: overallMin ? `CA$${overallMin.toFixed(2)}` : '—', color: '#34d399' },
    { label: 'Avg recommended PCR', val: avgTarget ? `CA$${avgTarget.toFixed(2)}` : '—', color: PCR_COLOR },
  ].map(s => `
    <div class="stat-card">
      <div style="font-size:11px;color:#64748b;margin-bottom:6px">${s.label}</div>
      <div style="font-size:22px;font-weight:500;color:${s.color};font-family:'DM Mono',monospace">${s.val}</div>
    </div>`).join('');

  // Strategy chart
  if (charts.strategy) charts.strategy.destroy();
  charts.strategy = new Chart(document.getElementById('strategyChart'), {
    type: 'bar',
    data: {
      labels: weekTargets.map(w => fmtShort(w.date)),
      datasets: [
        { label: 'Market avg', data: weekTargets.map(w => w.mkt), backgroundColor: 'rgba(148,163,184,0.3)', borderRadius: 4 },
        { label: 'PCR target', data: weekTargets.map(w => w.target), backgroundColor: 'rgba(129,140,248,0.7)', borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#64748b', boxWidth: 12 } } },
      scales: {
        y: { ticks: { color: '#64748b', callback: v => 'CA$' + v }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#64748b' }, grid: { display: false } }
      }
    }
  });

  // Rate adjustment table
  let rows = '';
  sorted.forEach(e => {
    const prices = Object.values(e.rates).filter(v => v !== null);
    const mkt = avg(prices);
    const lo = prices.length ? Math.min(...prices) : null;
    if (!mkt) return;
    const target = calcTarget(lo, mkt);
    const current = myRates[e.date] || 0;
    const outOfPos = current > 0 && current > target;
    if (outOfPos) updateAlerts++;
    rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
      <td style="padding:12px 20px;color:#94a3b8;font-family:'DM Mono',monospace">${fmtShort(e.date)}</td>
      <td style="padding:12px 20px;color:#94a3b8;font-family:'DM Mono',monospace">CA$${mkt.toFixed(2)}</td>
      <td style="padding:12px 20px;color:#34d399;font-family:'DM Mono',monospace">CA$${lo.toFixed(2)}</td>
      <td style="padding:12px 20px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="color:#64748b;font-size:12px">CA$</span>
          <input type="number" value="${current || ''}" placeholder="Set rate" step="0.01"
            onchange="setMyRate('${e.date}', this.value)"
            style="width:90px;background:#0f172a;border:1px solid ${outOfPos ? '#eab308' : '#1e293b'};border-radius:6px;padding:5px 8px;color:white;font-family:'DM Mono',monospace;font-size:13px;outline:none">
        </div>
      </td>
      <td style="padding:12px 20px;color:${PCR_COLOR};font-family:'DM Mono',monospace;font-weight:500">CA$${target.toFixed(2)}</td>
      <td style="padding:12px 20px;text-align:right">
        ${outOfPos
          ? `<button onclick="setMyRate('${e.date}', ${target.toFixed(2)})" style="background:rgba(234,179,8,0.1);color:#eab308;border:1px solid rgba(234,179,8,0.3);padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Match target</button>`
          : `<span style="color:#22c55e;font-size:12px;font-weight:600">✓ Optimized</span>`}
      </td>
    </tr>`;
  });

  document.getElementById('strategy-table').innerHTML = rows || '<tr><td colspan="6" style="padding:40px;text-align:center;color:#475569">No data.</td></tr>';
  const badge = document.getElementById('alert-badge');
  badge.textContent = updateAlerts > 0 ? `${updateAlerts} rate${updateAlerts > 1 ? 's' : ''} need updating` : 'All rates optimized';
  badge.style.cssText = updateAlerts > 0
    ? 'font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;background:rgba(234,179,8,0.1);color:#eab308;border:1px solid rgba(234,179,8,0.3)'
    : 'font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.3)';
}

function setMyRate(dateKey, val) {
  myRates[dateKey] = parseFloat(val) || 0;
  persist();
  renderStrategy();
}
