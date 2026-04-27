// ─── CONFIG ────────────────────────────────────────────────────────────────
// Placeholders below are replaced at build time by build.sh (Cloudflare Pages).
// For local dev, replace the placeholder strings directly or use a local proxy.
const CONFIG = {
  SUPABASE_URL:      '__SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
};

// Next FOMC meeting — update this manually when the schedule changes
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
const NEXT_FOMC_DATE = 'June 17–18, 2026';

// Rates refresh once per day at 10:00 AM ET (14:00 UTC covers both EST and EDT).
// Any snapshot taken after today's 14:00 UTC window start is considered fresh.
// If it's before 14:00 UTC right now, the window start is yesterday at 14:00 UTC.
const DAILY_REFRESH_HOUR_UTC = 14;

// Loan used for Est. Monthly column: $400k purchase, 20% down
const REFERENCE_LOAN = 320000;

// Ordered list of lenders to display — determines tile order before sort
const DISPLAY_ORDER = [
  'chase', 'wells_fargo', 'bank_of_america', 'rocket_mortgage',
  'navy_federal', 'us_bank', 'penfed', 'better_mortgage',
];

const FALLBACK_RATES = [
  { source: 'fed',            label: 'Fed Funds Rate',  rate: 4.33, term_type: 'fed',  rate_type: 'reference', bank_url: 'https://www.federalreserve.gov/releases/h15/' },
  { source: 'freddie_mac',    label: '30-yr Fixed Avg', rate: 6.80, term_type: '30yr', rate_type: 'purchase',  bank_url: 'https://www.freddiemac.com/pmms' },
  { source: 'freddie_mac',    label: '15-yr Fixed Avg', rate: 6.10, term_type: '15yr', rate_type: 'purchase',  bank_url: 'https://www.freddiemac.com/pmms' },
  { source: 'chase',          label: '30-yr Fixed', rate: 6.99, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.chase.com/personal/mortgage/mortgage-rates' },
  { source: 'chase',          label: '15-yr Fixed', rate: 6.25, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.chase.com/personal/mortgage/mortgage-rates' },
  { source: 'wells_fargo',    label: '30-yr Fixed', rate: 7.12, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.wellsfargo.com/mortgage/rates/' },
  { source: 'wells_fargo',    label: '15-yr Fixed', rate: 6.45, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.wellsfargo.com/mortgage/rates/' },
  { source: 'bank_of_america',label: '30-yr Fixed', rate: 7.05, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.bankofamerica.com/mortgage/mortgage-rates/' },
  { source: 'bank_of_america',label: '15-yr Fixed', rate: 6.38, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.bankofamerica.com/mortgage/mortgage-rates/' },
  { source: 'rocket_mortgage',label: '30-yr Fixed', rate: 7.25, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.rocketmortgage.com/mortgage-rates' },
  { source: 'rocket_mortgage',label: '15-yr Fixed', rate: 6.55, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.rocketmortgage.com/mortgage-rates' },
  { source: 'navy_federal',   label: '30-yr Fixed', rate: 6.75, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/' },
  { source: 'navy_federal',   label: '15-yr Fixed', rate: 6.10, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/' },
  { source: 'us_bank',        label: '30-yr Fixed', rate: 7.08, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.usbank.com/home-loans/mortgage/mortgage-rates.html' },
  { source: 'us_bank',        label: '15-yr Fixed', rate: 6.40, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.usbank.com/home-loans/mortgage/mortgage-rates.html' },
  { source: 'penfed',         label: '30-yr Fixed', rate: 6.82, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://www.penfed.org/mortgage/mortgage-rates' },
  { source: 'penfed',         label: '15-yr Fixed', rate: 6.15, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://www.penfed.org/mortgage/mortgage-rates' },
  { source: 'better_mortgage',label: '30-yr Fixed', rate: 6.95, term_type: '30yr', rate_type: 'purchase', bank_url: 'https://better.com/mortgage-rates' },
  { source: 'better_mortgage',label: '15-yr Fixed', rate: 6.28, term_type: '15yr', rate_type: 'purchase', bank_url: 'https://better.com/mortgage-rates' },
];

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
let supabaseClient = null;

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.startsWith('__')) return;
  try {
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('Supabase init failed:', e.message);
  }
}

// ─── STATE ──────────────────────────────────────────────────────────────────
let state = {
  rateRows:      [],      // all latest snapshot rows
  fedRow:        null,
  bankRows:      [],      // all non-fed rows (all rate_types)
  currentTab:    'purchase', // 'purchase' | 'refinance' | 'home_equity'
  sortMode:      'lowest',
  calcRate:      null,
  calcRateSource: null,
  usingFallback: false,
  usingStale:    false,
};

// ─── DATA LAYER: read from Supabase ─────────────────────────────────────────
async function fetchFromSupabase() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('rate_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    // distinct on (source, rate_type, term_type) — keep most recent per combination
    const seen = new Set();
    const latest = [];
    for (const row of data) {
      const key = `${row.source}|${row.rate_type || 'purchase'}|${row.term_type || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        latest.push(row);
      }
    }
    return latest;
  } catch (e) {
    console.warn('Supabase read error:', e.message);
    return null;
  }
}


// ─── DATA LAYER: historical rates for chart ──────────────────────────────────
async function fetchHistoricalRates() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('rate_snapshots')
      .select('fetched_at, source, rate, term_type, rate_type')
      .in('source', ['freddie_mac', 'freddie_mac_15'])
      .not('rate', 'is', null)
      .order('fetched_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Historical fetch error:', e.message);
    return [];
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatSourceName(source) {
  const map = {
    fed:             'Federal Reserve',
    freddie_mac:     'Freddie Mac',
    freddie_mac_15:  'Freddie Mac',
    chase:           'Chase',
    wells_fargo:     'Wells Fargo',
    bank_of_america: 'Bank of America',
    citi:            'Citi',
    rocket_mortgage: 'Rocket Mortgage',
    loan_depot:      'loanDepot',
    navy_federal:    'Navy Federal',
    pnc_bank:        'PNC Bank',
    us_bank:         'U.S. Bank',
    penfed:          'PenFed Credit Union',
    truist:          'Truist',
    better_mortgage: 'Better Mortgage',
    usaa:            'USAA',
    td_bank:         'TD Bank',
  };
  return map[source] || source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatRate(rate) {
  if (rate == null) return '—';
  return Number(rate).toFixed(2) + '%';
}

function formatCurrency(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function getRateDayStart() {
  const now = new Date();
  const todayWindow = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    DAILY_REFRESH_HOUR_UTC, 0, 0
  ));
  // Before today's window has opened, the current valid window started yesterday
  if (now < todayWindow) {
    todayWindow.setUTCDate(todayWindow.getUTCDate() - 1);
  }
  return todayWindow;
}

function isStale(ts) {
  if (!ts) return true;
  return new Date(ts) < getRateDayStart();
}

// ─── RENDER: navbar timestamp ────────────────────────────────────────────────
function renderNavTimestamp(ts) {
  const el = document.getElementById('nav-timestamp');
  if (!el) return;
  el.textContent = ts ? 'Rates as of ' + formatTimestamp(ts) : '';
}

// ─── RENDER: loading skeletons ───────────────────────────────────────────────
function showSkeletonFed() {
  const el = document.getElementById('fed-banner');
  el.innerHTML = `
    <div class="skeleton-fed" style="flex:1">
      <div style="flex:1;display:flex;flex-direction:column;gap:10px">
        <div class="skeleton skel-line" style="width:60%"></div>
        <div class="skeleton skel-rate" style="width:120px;height:36px"></div>
        <div class="skeleton skel-line" style="width:40%"></div>
      </div>
    </div>`;
}

function showSkeletonGrid() {
  const tbody = document.getElementById('rates-tbody');
  if (!tbody) return;
  tbody.innerHTML = Array(8).fill(0).map(() => `
    <tr>
      <td><div class="skeleton skel-line" style="width:120px;height:14px"></div></td>
      <td><div class="skeleton skel-line" style="width:60px;height:14px"></div></td>
      <td><div class="skeleton skel-line" style="width:60px;height:14px"></div></td>
      <td class="hide-mobile"><div class="skeleton skel-line" style="width:80px;height:14px"></div></td>
      <td></td>
    </tr>`).join('');
}

// ─── RENDER: fed banner ──────────────────────────────────────────────────────
function renderFedBanner(fedRow, prevFedRow) {
  const el = document.getElementById('fed-banner');
  if (!fedRow) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:14px">Fed rate unavailable</div>';
    return;
  }

  let direction = 'stable';
  let dirLabel  = '→ Stable';
  if (prevFedRow && prevFedRow.rate != null && fedRow.rate != null) {
    if (Number(fedRow.rate) > Number(prevFedRow.rate))      { direction = 'up';   dirLabel = '↑ Increased'; }
    else if (Number(fedRow.rate) < Number(prevFedRow.rate)) { direction = 'down'; dirLabel = '↓ Decreased'; }
  }

  el.innerHTML = `
    <div class="fed-left">
      <div class="fed-label">
        US Federal Funds Rate
        <span class="source-badge">Source: Federal Reserve</span>
      </div>
      <div class="fed-rate">${formatRate(fedRow.rate)}</div>
      <div class="fed-meta">Last updated: ${formatTimestamp(fedRow.fetched_at)}</div>
    </div>
    <div class="fed-right">
      <div class="direction-badge direction-${direction}">${dirLabel}</div>
      <div class="fomc-note">Next FOMC: ${NEXT_FOMC_DATE}</div>
    </div>`;
}

// ─── RENDER: lender rate table ───────────────────────────────────────────────
function renderRateTable(rows) {
  const tbody = document.getElementById('rates-tbody');
  const thead = document.getElementById('rates-thead');
  if (!tbody) return;

  const tab = state.currentTab;
  // Rows for current tab; backwards-compat: no rate_type → treat as purchase
  const tabRows = rows.filter(r => (r.rate_type || 'purchase') === tab);

  // Pivot: source → { term_type → row }
  const bySource = {};
  for (const row of tabRows) {
    if (!bySource[row.source]) bySource[row.source] = {};
    bySource[row.source][row.term_type || '30yr'] = row;
  }

  if (tab === 'home_equity') {
    if (thead) thead.innerHTML = `<tr>
      <th class="col-lender">Lender</th>
      <th>HELOC Rate</th>
      <th class="hide-mobile">Rate Type</th>
      <th class="col-action"></th>
    </tr>`;

    tbody.innerHTML = DISPLAY_ORDER.map(source => {
      const row = bySource[source]?.['heloc'] || bySource[source]?.['home_equity'] || null;
      const bankUrl = row?.bank_url || FALLBACK_RATES.find(f => f.source === source)?.bank_url || '#';
      const rate = row?.rate;
      return `<tr class="rate-row">
        <td class="col-lender"><span class="lender-name">${formatSourceName(source)}</span></td>
        <td>${rate != null ? `<strong class="rate-strong">${formatRate(rate)}</strong>` : '<span class="no-rate">—</span>'}</td>
        <td class="hide-mobile muted-cell">${rate != null ? 'Variable (Prime-based)' : '—'}</td>
        <td class="col-action"><a href="${bankUrl}" target="_blank" rel="noopener" class="quote-btn">Learn More ↗</a></td>
      </tr>`;
    }).join('');
    return;
  }

  // Purchase or Refinance tab
  if (thead) thead.innerHTML = `<tr>
    <th class="col-lender">Lender</th>
    <th class="sortable-col">30-yr Fixed</th>
    <th>15-yr Fixed</th>
    <th class="hide-mobile">Est. Monthly*</th>
    <th class="col-action"></th>
  </tr>`;

  let sources = [...DISPLAY_ORDER];
  if (state.sortMode === 'lowest') {
    sources.sort((a, b) => {
      const ra = bySource[a]?.['30yr']?.rate ?? Infinity;
      const rb = bySource[b]?.['30yr']?.rate ?? Infinity;
      return ra - rb;
    });
  } else if (state.sortMode === 'highest') {
    sources.sort((a, b) => {
      const ra = bySource[a]?.['30yr']?.rate ?? -Infinity;
      const rb = bySource[b]?.['30yr']?.rate ?? -Infinity;
      return rb - ra;
    });
  } else {
    sources.sort((a, b) => formatSourceName(a).localeCompare(formatSourceName(b)));
  }

  tbody.innerHTML = sources.map(source => {
    const row30 = bySource[source]?.['30yr'];
    const row15 = bySource[source]?.['15yr'];
    const bankUrl = row30?.bank_url || row15?.bank_url || FALLBACK_RATES.find(f => f.source === source)?.bank_url || '#';
    const rate30 = row30?.rate;
    const rate15 = row15?.rate;
    const isApplied = state.calcRateSource === source && state.currentTab === tab;

    let estMonthly = '—';
    if (rate30 != null) estMonthly = formatCurrency(calcMonthlyPI(REFERENCE_LOAN, Number(rate30), 360)) + '/mo';

    return `<tr class="rate-row ${isApplied ? 'rate-row-applied' : ''}" data-source="${source}" data-rate="${rate30 ?? ''}" style="cursor:${rate30 ? 'pointer' : 'default'}">
      <td class="col-lender"><span class="lender-name">${formatSourceName(source)}</span></td>
      <td>${rate30 != null ? `<strong class="rate-strong">${formatRate(rate30)}</strong>` : '<span class="no-rate">—</span>'}</td>
      <td>${rate15 != null ? formatRate(rate15) : '<span class="no-rate">—</span>'}</td>
      <td class="hide-mobile muted-cell">${estMonthly}</td>
      <td class="col-action"><a href="${bankUrl}" target="_blank" rel="noopener" class="quote-btn" onclick="event.stopPropagation()">Get Quote ↗</a></td>
    </tr>`;
  }).join('');

  // Row click → prefill calculator
  tbody.querySelectorAll('.rate-row').forEach(row => {
    row.addEventListener('click', () => {
      const rate = row.dataset.rate;
      const source = row.dataset.source;
      if (!rate) return;
      state.calcRate = parseFloat(rate);
      state.calcRateSource = source;
      tbody.querySelectorAll('.rate-row').forEach(r => r.classList.remove('rate-row-applied'));
      row.classList.add('rate-row-applied');
      const rateInput = document.getElementById('calc-rate');
      if (rateInput) {
        rateInput.value = parseFloat(rate).toFixed(2);
        const hint = document.getElementById('rate-source-hint');
        if (hint) hint.textContent = 'From ' + formatSourceName(source);
        recalculate();
      }
      document.getElementById('calculator-section').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// ─── RENDER: historical rate trend chart ─────────────────────────────────────
function renderHistoricalChart(data) {
  const canvas = document.getElementById('rate-trend-chart');
  const buildingEl = document.getElementById('chart-building');
  if (!canvas) return;

  const seen30 = new Set(), seen15 = new Set();
  const series30 = [], series15 = [];

  for (const row of data) {
    const date = row.fetched_at.slice(0, 10);
    const is30 = row.source === 'freddie_mac' && (row.term_type === '30yr' || !row.term_type);
    const is15 = row.source === 'freddie_mac_15' || (row.source === 'freddie_mac' && row.term_type === '15yr');
    if (is30 && !seen30.has(date)) { seen30.add(date); series30.push({ x: date, y: Number(row.rate) }); }
    if (is15 && !seen15.has(date)) { seen15.add(date); series15.push({ x: date, y: Number(row.rate) }); }
  }

  if (series30.length < 2 && series15.length < 2) {
    if (buildingEl) buildingEl.style.display = 'flex';
    canvas.style.display = 'none';
    return;
  }
  if (buildingEl) buildingEl.style.display = 'none';

  const allDates = [...new Set([...series30, ...series15].map(p => p.x))].sort();
  if (window._rateTrendChart) window._rateTrendChart.destroy();
  window._rateTrendChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: allDates,
      datasets: [
        { label: '30-yr Fixed (National Avg)', data: series30, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.08)', tension: 0.3, fill: true, pointRadius: 3, pointHoverRadius: 5 },
        { label: '15-yr Fixed (National Avg)', data: series15, borderColor: '#0157FF', backgroundColor: 'transparent', tension: 0.3, fill: false, pointRadius: 3, pointHoverRadius: 5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 } } },
        tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%` } },
      },
      scales: {
        y: {
          ticks: { callback: v => v.toFixed(2) + '%', font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 }, maxTicksLimit: 10 } },
      },
    },
  });
}

// ─── RENDER: tabs + sort ─────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.rate-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rate-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      state.currentTab = btn.dataset.tab;
      renderRateTable(state.bankRows);
    });
  });
  const sortSel = document.getElementById('sort-select');
  if (sortSel) sortSel.addEventListener('change', () => { state.sortMode = sortSel.value; renderRateTable(state.bankRows); });
}

// ─── BANNER HELPERS ──────────────────────────────────────────────────────────
function showBanner(id) {
  document.getElementById(id)?.classList.add('visible');
}
function hideBanners() {
  document.querySelectorAll('.banner').forEach(b => b.classList.remove('visible'));
}

// ─── RENDER: entire UI from data rows ───────────────────────────────────────
async function renderAll(rows, prevFedRow) {
  if (!rows || rows.length === 0) return;

  const fedRow      = rows.find(r => r.source === 'fed') || null;
  const purchaseRows = rows.filter(r => r.source !== 'fed' && (r.rate_type === 'purchase' || !r.rate_type));
  const refinanceRows = purchaseRows
    .filter(r => r.rate != null)
    .map(r => ({ ...r, rate_type: 'refinance', rate: Math.round((Number(r.rate) + 0.15) * 1000) / 1000 }));

  state.fedRow  = fedRow;
  state.bankRows = [...purchaseRows, ...refinanceRows];

  renderFedBanner(fedRow, prevFedRow);
  renderRateTable(state.bankRows);
  renderNavTimestamp(rows[0]?.fetched_at || null);

  // Pre-fill calculator with Freddie Mac 30yr purchase rate if not already set
  if (!state.calcRate) {
    const fm = rows.find(r => r.source === 'freddie_mac' && (r.rate_type === 'purchase' || !r.rate_type) && r.term_type === '30yr' && r.rate != null)
            || rows.find(r => r.source === 'freddie_mac' && r.rate != null);
    if (fm) {
      state.calcRate = Number(fm.rate);
      state.calcRateSource = 'freddie_mac';
      const rateInput = document.getElementById('calc-rate');
      if (rateInput) {
        rateInput.value = state.calcRate.toFixed(2);
        const hint = document.getElementById('rate-source-hint');
        if (hint) hint.textContent = 'From Freddie Mac (National Avg)';
      }
    }
  }
  recalculate();
}

// ─── CALCULATOR: math functions ──────────────────────────────────────────────
function calcMonthlyPI(principal, annualRate, termMonths) {
  if (annualRate === 0) return principal / termMonths;
  const r = annualRate / 100 / 12;
  return principal * r * Math.pow(1 + r, termMonths) / (Math.pow(1 + r, termMonths) - 1);
}

// ─── CALCULATOR: donut chart (Canvas) ───────────────────────────────────────
function drawDonutChart(piAmount, taxAmount, insAmount) {
  const canvas = document.getElementById('amort-canvas');
  if (!canvas) return;

  const total = piAmount + taxAmount + insAmount;
  if (total <= 0) return;

  const dpr  = window.devicePixelRatio || 1;
  const SIZE = 180;
  canvas.width  = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width  = SIZE + 'px';
  canvas.style.height = SIZE + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2, cy = SIZE / 2;
  const outerR = SIZE * 0.44;
  const innerR = SIZE * 0.28;
  const gap    = 0.018; // radians gap between segments

  const segments = [
    { value: piAmount,  color: '#0157FF' },
    { value: taxAmount, color: '#10B981' },
    { value: insAmount, color: '#F59E0B' },
  ];

  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    const sweep = (seg.value / total) * 2 * Math.PI - gap;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle + gap / 2, startAngle + gap / 2 + sweep);
    ctx.arc(cx, cy, innerR, startAngle + gap / 2 + sweep, startAngle + gap / 2, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    startAngle += sweep + gap;
  });

  // Center fill
  ctx.beginPath();
  ctx.arc(cx, cy, innerR - 1, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Center: monthly total
  const totalStr = '$' + Math.round(total).toLocaleString('en-US');
  ctx.fillStyle = '#151515';
  ctx.font = `600 ${Math.round(SIZE * 0.095)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(totalStr, cx, cy - SIZE * 0.07);

  ctx.fillStyle = '#5A6472';
  ctx.font = `${Math.round(SIZE * 0.062)}px system-ui, sans-serif`;
  ctx.fillText('/month', cx, cy + SIZE * 0.08);
}

// ─── CALCULATOR: render results ──────────────────────────────────────────────
function recalculate() {
  const homePrice   = parseFloat(document.getElementById('calc-home-price')?.value?.replace(/,/g, '')) || 450000;
  const downDollar  = parseFloat(document.getElementById('calc-dp-dollar')?.value?.replace(/,/g, '')) || homePrice * 0.2;
  const annualRate  = parseFloat(document.getElementById('calc-rate')?.value) || 6.89;
  const taxRate     = parseFloat(document.getElementById('calc-tax')?.value) || 1.2;
  const insurance   = parseFloat(document.getElementById('calc-insurance')?.value?.replace(/,/g, '')) || 1500;

  const activeTermBtn = document.querySelector('.term-btn.active');
  const termYears     = activeTermBtn ? parseInt(activeTermBtn.dataset.years) : 30;
  const termMonths    = termYears * 12;

  const principal = homePrice - downDollar;
  const monthlyPI = calcMonthlyPI(principal, annualRate, termMonths);
  const monthlyTax = (homePrice * (taxRate / 100)) / 12;
  const monthlyIns = insurance / 12;
  const totalMonthly = monthlyPI + monthlyTax + monthlyIns;

  const totalPaid     = monthlyPI * termMonths;
  const totalInterest = totalPaid - principal;
  const effectiveAnnual = totalMonthly * 12;

  // Render monthly total
  const monthEl = document.getElementById('result-monthly');
  if (monthEl) monthEl.textContent = formatCurrency(totalMonthly);

  // Breakdown
  const fields = {
    'result-pi':        formatCurrency(monthlyPI),
    'result-tax':       formatCurrency(monthlyTax),
    'result-insurance': formatCurrency(monthlyIns),
    'result-total-loan':formatCurrency(principal),
    'result-total-int': formatCurrency(totalInterest),
    'result-eff-annual':formatCurrency(effectiveAnnual),
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Donut chart
  drawDonutChart(monthlyPI, monthlyTax, monthlyIns);
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function setupCalculatorListeners() {
  // Home price: sync down payment percentage display
  const homePriceInput  = document.getElementById('calc-home-price');
  const dpDollarInput   = document.getElementById('calc-dp-dollar');
  const dpPercentInput  = document.getElementById('calc-dp-percent');

  function syncDP(source) {
    const hp = parseFloat(homePriceInput.value.replace(/,/g, '')) || 0;
    if (source === 'dollar') {
      const dp = parseFloat(dpDollarInput.value.replace(/,/g, '')) || 0;
      dpPercentInput.value = hp > 0 ? ((dp / hp) * 100).toFixed(1) : '0.0';
    } else {
      const pct = parseFloat(dpPercentInput.value) || 0;
      dpDollarInput.value = Math.round(hp * pct / 100).toLocaleString('en-US');
    }
    recalculate();
  }

  homePriceInput?.addEventListener('input', () => {
    // reformat on blur only — on input just recalculate
    const pct = parseFloat(dpPercentInput.value) || 20;
    const hp  = parseFloat(homePriceInput.value.replace(/,/g, '')) || 0;
    dpDollarInput.value = Math.round(hp * pct / 100).toLocaleString('en-US');
    recalculate();
  });

  dpDollarInput?.addEventListener('input', () => syncDP('dollar'));
  dpPercentInput?.addEventListener('input', () => syncDP('percent'));

  // Term buttons
  document.querySelectorAll('.term-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.term-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      recalculate();
    });
  });

  // All other calc inputs
  ['calc-rate', 'calc-tax', 'calc-insurance'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', recalculate);
  });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
function setErrorBanner(msg) {
  const el = document.getElementById('banner-error');
  if (el) el.innerHTML = `✕ ${msg}`;
  showBanner('banner-error');
}

async function init() {
  try {
    initSupabase();
    setupTabs();
    setupCalculatorListeners();

    const headingDate = document.getElementById('heading-month-year');
    if (headingDate) headingDate.textContent = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    showSkeletonFed();
    showSkeletonGrid();
    hideBanners();

    let rows = null;
    let prevFedRow = null;

    rows = await fetchFromSupabase();
    state.rateRows = rows || [];

    if (rows && rows.length > 0) {
      if (supabaseClient) {
        try {
          const { data: prevFed } = await supabaseClient
            .from('rate_snapshots')
            .select('*')
            .eq('source', 'fed')
            .order('fetched_at', { ascending: false })
            .range(1, 1);
          if (prevFed && prevFed.length > 0) prevFedRow = prevFed[0];
        } catch (_) {}
      }

      const latestTs = rows[0]?.fetched_at;
      if (latestTs && isStale(latestTs)) showBanner('banner-warning');
      await renderAll(rows, prevFedRow);
    } else {
      // No data in DB yet — show fallback until first cron runs
      setErrorBanner('Rates updated daily at 10 AM ET — check back soon.');
      const fallback = FALLBACK_RATES.map(r => ({ ...r, fetched_at: null }));
      state.rateRows = fallback;
      await renderAll(fallback, null);
    }
  } catch (fatalErr) {
    console.error('[MR] Fatal init error:', fatalErr);
    setErrorBanner('App failed to start: ' + fatalErr.message);
    try {
      const fallback = FALLBACK_RATES.map(r => ({ ...r, fetched_at: null }));
      await renderAll(fallback, null);
    } catch (_) {}
  }

  // Historical chart — non-blocking, runs after main UI is ready
  fetchHistoricalRates().then(renderHistoricalChart).catch(() => {});
}

// Kick off after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
