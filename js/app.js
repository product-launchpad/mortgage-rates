// ─── CONFIG ────────────────────────────────────────────────────────────────
// Placeholders below are replaced at build time by build.sh (Cloudflare Pages).
// For local dev, replace the placeholder strings directly or use a local proxy.
const CONFIG = {
  ANTHROPIC_API_KEY: '__ANTHROPIC_API_KEY__',
  SUPABASE_URL:      '__SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
};

// Next FOMC meeting — update this manually when the schedule changes
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
const NEXT_FOMC_DATE = 'June 17–18, 2026';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const FALLBACK_RATES = [
  { source: 'fed',            label: 'Fed Funds Rate',   rate: 4.33, term_type: 'fed',  bank_url: 'https://www.federalreserve.gov/releases/h15/' },
  { source: 'freddie_mac',    label: '30-yr Fixed Avg',  rate: 6.89, term_type: '30yr', bank_url: 'https://www.freddiemac.com/pmms' },
  { source: 'freddie_mac_15', label: '15-yr Fixed Avg',  rate: 6.17, term_type: '15yr', bank_url: 'https://www.freddiemac.com/pmms' },
  { source: 'chase',          label: '30-yr Fixed',      rate: 7.12, term_type: '30yr', bank_url: 'https://www.chase.com/personal/mortgage/mortgage-rates' },
  { source: 'wells_fargo',    label: '30-yr Fixed',      rate: 7.24, term_type: '30yr', bank_url: 'https://www.wellsfargo.com/mortgage/rates/' },
  { source: 'bank_of_america',label: '30-yr Fixed',      rate: 7.05, term_type: '30yr', bank_url: 'https://www.bankofamerica.com/mortgage/mortgage-rates/' },
  { source: 'citi',           label: '30-yr Fixed',      rate: 6.99, term_type: '30yr', bank_url: 'https://www.citimortgage.com/mortgage/mortgage-rates' },
  { source: 'rocket_mortgage',label: '30-yr Fixed',      rate: 7.31, term_type: '30yr', bank_url: 'https://www.rocketmortgage.com/mortgage-rates' },
  { source: 'us_bank',        label: '30-yr Fixed',      rate: 7.08, term_type: '30yr', bank_url: 'https://www.usbank.com/home-loans/mortgage/mortgage-rates.html' },
];

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
let supabase = null;

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.startsWith('__')) return;
  try {
    supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('Supabase init failed:', e.message);
  }
}

// ─── STATE ──────────────────────────────────────────────────────────────────
let state = {
  rateRows:     [],   // latest snapshot rows (all sources)
  fedRow:       null,
  bankRows:     [],
  filterTerm:   'all',
  sortMode:     'lowest',
  calcRate:     null,
  calcRateSource: null,
  usingFallback: false,
  usingStale:   false,
};

// ─── DATA LAYER: read from Supabase ─────────────────────────────────────────
async function fetchFromSupabase() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('rate_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    // distinct on source — keep most recent per source
    const seen = new Set();
    const latest = [];
    for (const row of data) {
      if (!seen.has(row.source)) {
        seen.add(row.source);
        latest.push(row);
      }
    }
    return latest;
  } catch (e) {
    console.warn('Supabase read error:', e.message);
    return null;
  }
}

// ─── DATA LAYER: fetch via Claude API ───────────────────────────────────────
async function fetchFromClaude() {
  if (!CONFIG.ANTHROPIC_API_KEY || CONFIG.ANTHROPIC_API_KEY.startsWith('__')) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `Search the web and find today's US mortgage rates as of ${today}.
Return ONLY a valid JSON array, no markdown, no explanation, no code fences.
Format:
[
  { "source": "fed", "label": "Fed Funds Rate", "rate": 4.33, "term_type": "fed", "bank_url": "https://www.federalreserve.gov/releases/h15/", "raw_snippet": "..." },
  { "source": "freddie_mac", "label": "30-yr Fixed Avg", "rate": 6.89, "term_type": "30yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "freddie_mac_15", "label": "15-yr Fixed Avg", "rate": 6.17, "term_type": "15yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "chase", "label": "30-yr Fixed", "rate": 7.12, "term_type": "30yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "wells_fargo", "label": "30-yr Fixed", "rate": 7.24, "term_type": "30yr", "bank_url": "https://www.wellsfargo.com/mortgage/rates/", "raw_snippet": "..." },
  { "source": "bank_of_america", "label": "30-yr Fixed", "rate": 7.05, "term_type": "30yr", "bank_url": "https://www.bankofamerica.com/mortgage/mortgage-rates/", "raw_snippet": "..." },
  { "source": "citi", "label": "30-yr Fixed", "rate": 6.99, "term_type": "30yr", "bank_url": "https://www.citimortgage.com/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "rocket_mortgage", "label": "30-yr Fixed", "rate": 7.31, "term_type": "30yr", "bank_url": "https://www.rocketmortgage.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "us_bank", "label": "30-yr Fixed", "rate": 7.08, "term_type": "30yr", "bank_url": "https://www.usbank.com/home-loans/mortgage/mortgage-rates.html", "raw_snippet": "..." }
]
Search today's date for each source. If a bank's rate is not publicly findable, use null for rate and note it in raw_snippet.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Find the last text block in the response
  let jsonText = '';
  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        jsonText = block.text;
      }
    }
  }

  if (!jsonText) throw new Error('No text content in Claude response');

  // Strip markdown code fences if present
  jsonText = jsonText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract JSON array — find first [ and last ]
  const start = jsonText.indexOf('[');
  const end   = jsonText.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array found in Claude response');

  const parsed = JSON.parse(jsonText.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Claude response is not a JSON array');

  return parsed;
}

// ─── DATA LAYER: insert to Supabase ─────────────────────────────────────────
async function insertToSupabase(rows) {
  if (!supabase) return;
  const now = new Date().toISOString();
  const insertRows = rows.map(r => ({
    fetched_at:  now,
    source:      r.source,
    label:       r.label,
    rate:        r.rate != null ? Number(r.rate) : null,
    term_type:   r.term_type || null,
    bank_url:    r.bank_url || null,
    raw_snippet: r.raw_snippet || null,
  }));

  const { error } = await supabase.from('rate_snapshots').insert(insertRows);
  if (error) console.warn('Supabase insert error:', error.message);
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
    us_bank:         'U.S. Bank',
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

function isStale(ts) {
  if (!ts) return true;
  return (Date.now() - new Date(ts).getTime()) > CACHE_TTL_MS;
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
  const grid = document.getElementById('rates-grid');
  grid.innerHTML = Array(8).fill(0).map(() => `
    <div class="skeleton-card">
      <div style="display:flex;justify-content:space-between">
        <div class="skeleton skel-line" style="width:55%"></div>
        <div class="skeleton skel-line" style="width:20%"></div>
      </div>
      <div class="skeleton skel-rate"></div>
      <div class="skeleton skel-bar" style="width:100%"></div>
      <div class="skeleton skel-line" style="width:30%"></div>
    </div>`).join('');
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

// ─── RENDER: bank rate cards ─────────────────────────────────────────────────
function renderRateCards(rows) {
  const grid = document.getElementById('rates-grid');
  if (!rows || rows.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:14px;grid-column:1/-1">No rate data available.</p>';
    return;
  }

  const validRates = rows.filter(r => r.rate != null).map(r => Number(r.rate));
  const maxRate    = validRates.length ? Math.max(...validRates) : 1;

  // Apply filter + sort
  let filtered = rows;
  if (state.filterTerm !== 'all') {
    filtered = rows.filter(r => r.term_type === state.filterTerm);
  }

  if (state.sortMode === 'lowest') {
    filtered = [...filtered].sort((a, b) => {
      if (a.rate == null) return 1;
      if (b.rate == null) return -1;
      return Number(a.rate) - Number(b.rate);
    });
  } else if (state.sortMode === 'highest') {
    filtered = [...filtered].sort((a, b) => {
      if (a.rate == null) return 1;
      if (b.rate == null) return -1;
      return Number(b.rate) - Number(a.rate);
    });
  } else if (state.sortMode === 'az') {
    filtered = [...filtered].sort((a, b) =>
      formatSourceName(a.source).localeCompare(formatSourceName(b.source)));
  }

  grid.innerHTML = filtered.map(row => {
    const barPct  = row.rate != null ? Math.round((Number(row.rate) / maxRate) * 100) : 0;
    const isNatAvg = row.source === 'freddie_mac' || row.source === 'freddie_mac_15';
    const isApplied = state.calcRateSource === row.source;

    const termBadge = row.term_type === '30yr' ? '<span class="badge badge-30yr">30-yr</span>'
                    : row.term_type === '15yr'  ? '<span class="badge badge-15yr">15-yr</span>'
                    : row.term_type === 'arm'   ? '<span class="badge badge-arm">ARM</span>'
                    : '';
    const natBadge = isNatAvg ? '<span class="badge badge-natavg">National Avg</span>' : '';

    const rateDisplay = row.rate != null
      ? `<div class="rate-value">${formatRate(row.rate)}</div>`
      : `<div class="rate-value null-rate">— <a href="${row.bank_url || '#'}" target="_blank" rel="noopener" class="visit-link" onclick="event.stopPropagation()">Check site</a></div>`;

    return `
      <div class="rate-card ${isApplied ? 'applied' : ''}"
           data-source="${row.source}"
           data-rate="${row.rate != null ? row.rate : ''}"
           data-url="${row.bank_url || '#'}">
        <div class="card-header">
          <div class="source-name">${formatSourceName(row.source)}</div>
          <div class="tags">${natBadge}${termBadge}</div>
        </div>
        ${rateDisplay}
        <div class="rate-bar-bg">
          <div class="rate-bar-fill" style="width:${barPct}%"></div>
        </div>
        <div class="card-footer">
          <a href="${row.bank_url || '#'}" target="_blank" rel="noopener"
             class="visit-link" onclick="event.stopPropagation()">↗ Visit site</a>
          <span class="applied-label">← applied</span>
        </div>
      </div>`;
  }).join('');

  // Attach click handlers
  grid.querySelectorAll('.rate-card').forEach(card => {
    card.addEventListener('click', () => {
      const rate = card.dataset.rate;
      const source = card.dataset.source;
      if (!rate) return;

      state.calcRate = parseFloat(rate);
      state.calcRateSource = source;

      // Remove applied from all, add to clicked
      grid.querySelectorAll('.rate-card').forEach(c => c.classList.remove('applied'));
      card.classList.add('applied');

      // Pre-fill calculator
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

// ─── RENDER: filter + sort ───────────────────────────────────────────────────
function setupFilterSort() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterTerm = btn.dataset.filter;
      renderRateCards(state.bankRows);
    });
  });

  const sortSel = document.getElementById('sort-select');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      state.sortMode = sortSel.value;
      renderRateCards(state.bankRows);
    });
  }
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

  const fedRow  = rows.find(r => r.source === 'fed') || null;
  const bankRows = rows.filter(r => r.source !== 'fed');

  state.fedRow  = fedRow;
  state.bankRows = bankRows;

  renderFedBanner(fedRow, prevFedRow);
  renderRateCards(bankRows);

  const ts = rows[0]?.fetched_at || null;
  renderNavTimestamp(ts);

  // Pre-fill calculator with Freddie Mac 30yr avg if not already set
  if (!state.calcRate) {
    const fm = rows.find(r => r.source === 'freddie_mac' && r.rate != null);
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

function buildAmortSchedule(principal, annualRate, termMonths) {
  const r = annualRate / 100 / 12;
  let balance = principal;
  const schedule = [];
  for (let i = 0; i < termMonths; i++) {
    const interest  = balance * r;
    const payment   = calcMonthlyPI(principal, annualRate, termMonths);
    const prinPart  = payment - interest;
    balance        -= prinPart;
    schedule.push({ interest, principal: prinPart, balance: Math.max(balance, 0) });
  }
  return schedule;
}

// ─── CALCULATOR: amortization chart (Canvas) ────────────────────────────────
function drawAmortChart(schedule, termYears) {
  const canvas = document.getElementById('amort-canvas');
  if (!canvas) return;

  const intervals = [];
  const yearsPerBar = termYears <= 15 ? 1 : 5;
  const monthsPerBar = yearsPerBar * 12;

  for (let i = 0; i < schedule.length; i += monthsPerBar) {
    const slice = schedule.slice(i, i + monthsPerBar);
    const totalPrin = slice.reduce((s, m) => s + m.principal, 0);
    const totalInt  = slice.reduce((s, m) => s + m.interest, 0);
    intervals.push({ label: `Yr ${Math.floor(i / 12) + yearsPerBar}`, principal: totalPrin, interest: totalInt });
  }

  const dpr   = window.devicePixelRatio || 1;
  const W     = canvas.offsetWidth || 480;
  const H     = 180;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 52, padR = 12, padT = 12, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const maxVal = Math.max(...intervals.map(d => d.principal + d.interest));
  const barW   = chartW / intervals.length;
  const gap    = Math.max(2, barW * 0.12);

  ctx.clearRect(0, 0, W, H);

  // Y axis labels
  ctx.fillStyle = '#999';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const val = (maxVal / 4) * i;
    const y   = padT + chartH - (chartH * i / 4);
    ctx.fillText('$' + (val >= 1000 ? Math.round(val / 1000) + 'k' : Math.round(val)), padL - 5, y);
  }

  // Bars
  intervals.forEach((d, i) => {
    const x      = padL + i * barW + gap / 2;
    const bw     = barW - gap;
    const totalH = chartH * (d.principal + d.interest) / maxVal;
    const prinH  = chartH * d.principal / maxVal;
    const intH   = totalH - prinH;

    // interest (bottom)
    ctx.fillStyle = '#D1D5DB';
    ctx.fillRect(x, padT + chartH - totalH, bw, intH);

    // principal (top)
    ctx.fillStyle = '#378ADD';
    ctx.fillRect(x, padT + chartH - prinH, bw, prinH);

    // x label
    ctx.fillStyle = '#999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(d.label, x + bw / 2, padT + chartH + 4);
  });

  // Y axis line
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + chartH);
  ctx.stroke();
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

  // Chart
  const schedule = buildAmortSchedule(principal, annualRate, termMonths);
  drawAmortChart(schedule, termYears);
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

function setupRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.classList.add('spinning');
    btn.disabled = true;
    hideBanners();
    showSkeletonFed();
    showSkeletonGrid();
    try {
      const freshRows = await fetchFromClaude();
      await insertToSupabase(freshRows);
      // Re-fetch from Supabase to get IDs + timestamps
      let rows = await fetchFromSupabase();
      if (!rows) rows = freshRows.map(r => ({ ...r, fetched_at: new Date().toISOString() }));
      state.calcRate = null;
      state.calcRateSource = null;
      await renderAll(rows);
    } catch (e) {
      console.warn('Refresh failed:', e.message);
      showBanner('banner-warning');
      renderAll(state.rateRows);
    } finally {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  });
}

// ─── INIT ────────────────────────────────────────────────────────────────────
async function init() {
  initSupabase();
  setupFilterSort();
  setupCalculatorListeners();
  setupRefreshButton();

  showSkeletonFed();
  showSkeletonGrid();
  hideBanners();

  let rows = null;
  let prevFedRow = null;

  // 1. Try Supabase
  rows = await fetchFromSupabase();
  state.rateRows = rows || [];

  if (rows && rows.length > 0) {
    // Fetch previous fed row for direction badge
    if (supabase) {
      try {
        const { data: prevFed } = await supabase
          .from('rate_snapshots')
          .select('*')
          .eq('source', 'fed')
          .order('fetched_at', { ascending: false })
          .range(1, 1);   // second most recent
        if (prevFed && prevFed.length > 0) prevFedRow = prevFed[0];
      } catch (_) {}
    }
  }

  // 2. Check freshness
  const latestTs = rows && rows[0]?.fetched_at;
  const cacheHit = latestTs && !isStale(latestTs);

  if (cacheHit) {
    // Fresh cache — render immediately
    await renderAll(rows, prevFedRow);
  } else {
    // Stale or empty — fetch from Claude
    try {
      const freshRows = await fetchFromClaude();
      await insertToSupabase(freshRows);
      // Re-read from Supabase to get DB timestamps + IDs
      const dbRows = await fetchFromSupabase();
      rows = dbRows || freshRows.map(r => ({ ...r, fetched_at: new Date().toISOString() }));
      state.rateRows = rows;
      await renderAll(rows, prevFedRow);
    } catch (e) {
      console.warn('Claude fetch failed:', e.message);

      if (rows && rows.length > 0) {
        // Stale data available
        showBanner('banner-warning');
        state.usingStale = true;
        await renderAll(rows, prevFedRow);
      } else {
        // Nothing — use hardcoded fallback
        showBanner('banner-error');
        state.usingFallback = true;
        const fallback = FALLBACK_RATES.map(r => ({ ...r, fetched_at: null }));
        state.rateRows = fallback;
        await renderAll(fallback, null);
      }
    }
  }
}

// Kick off after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
