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

// Rates refresh once per day at 10:00 AM ET (14:00 UTC covers both EST and EDT).
// Any snapshot taken after today's 14:00 UTC window start is considered fresh.
// If it's before 14:00 UTC right now, the window start is yesterday at 14:00 UTC.
const DAILY_REFRESH_HOUR_UTC = 14;

// Ordered list of lenders to display — determines tile order before sort
const DISPLAY_ORDER = [
  'chase', 'wells_fargo', 'bank_of_america', 'rocket_mortgage',
  'loan_depot', 'navy_federal', 'pnc_bank', 'us_bank',
  'penfed', 'citi', 'truist', 'better_mortgage', 'usaa', 'td_bank',
];

const FALLBACK_RATES = [
  { source: 'fed',            label: 'Fed Funds Rate',   rate: 4.33, term_type: 'fed',  bank_url: 'https://www.federalreserve.gov/releases/h15/' },
  // freddie_mac kept for calculator pre-fill reference — not shown in grid
  { source: 'freddie_mac',    label: '30-yr Fixed Avg',  rate: 6.30, term_type: '30yr', bank_url: 'https://www.freddiemac.com/pmms' },
  { source: 'freddie_mac_15', label: '15-yr Fixed Avg',  rate: 5.65, term_type: '15yr', bank_url: 'https://www.freddiemac.com/pmms' },
  // displayed lenders — up to 9 tiles shown at once (sorted by rate)
  { source: 'chase',          label: '30-yr Fixed', rate: 6.99, term_type: '30yr', bank_url: 'https://www.chase.com/personal/mortgage/mortgage-rates' },
  { source: 'wells_fargo',    label: '30-yr Fixed', rate: 7.12, term_type: '30yr', bank_url: 'https://www.wellsfargo.com/mortgage/rates/' },
  { source: 'bank_of_america',label: '30-yr Fixed', rate: 7.05, term_type: '30yr', bank_url: 'https://www.bankofamerica.com/mortgage/mortgage-rates/' },
  { source: 'rocket_mortgage',label: '30-yr Fixed', rate: 7.25, term_type: '30yr', bank_url: 'https://www.rocketmortgage.com/mortgage-rates' },
  { source: 'loan_depot',     label: '30-yr Fixed', rate: 7.18, term_type: '30yr', bank_url: 'https://www.loandepot.com/mortgage-rates' },
  { source: 'navy_federal',   label: '30-yr Fixed', rate: 6.75, term_type: '30yr', bank_url: 'https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/' },
  { source: 'pnc_bank',       label: '30-yr Fixed', rate: 7.10, term_type: '30yr', bank_url: 'https://www.pnc.com/en/personal-banking/borrowing/mortgage.html' },
  { source: 'us_bank',        label: '30-yr Fixed', rate: 7.08, term_type: '30yr', bank_url: 'https://www.usbank.com/home-loans/mortgage/mortgage-rates.html' },
  { source: 'penfed',         label: '30-yr Fixed', rate: 6.82, term_type: '30yr', bank_url: 'https://www.penfed.org/mortgage/mortgage-rates' },
  { source: 'citi',           label: '30-yr Fixed', rate: 7.02, term_type: '30yr', bank_url: 'https://www.citi.com/mortgage/purchase-rates' },
  { source: 'truist',         label: '30-yr Fixed', rate: 7.15, term_type: '30yr', bank_url: 'https://www.truist.com/mortgage/current-mortgage-rates' },
  { source: 'better_mortgage',label: '30-yr Fixed', rate: 6.95, term_type: '30yr', bank_url: 'https://better.com/mortgage-rates' },
  { source: 'usaa',           label: '30-yr Fixed', rate: 6.80, term_type: '30yr', bank_url: 'https://www.usaa.com/banking/home-mortgages/' },
  { source: 'td_bank',        label: '30-yr Fixed', rate: 7.20, term_type: '30yr', bank_url: 'https://www.td.com/us/en/personal-banking/mortgage' },
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
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
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
  { "source": "freddie_mac", "label": "30-yr Fixed Avg", "rate": 6.30, "term_type": "30yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "freddie_mac_15", "label": "15-yr Fixed Avg", "rate": 5.65, "term_type": "15yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "chase", "label": "30-yr Fixed", "rate": 6.99, "term_type": "30yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "wells_fargo", "label": "30-yr Fixed", "rate": 7.12, "term_type": "30yr", "bank_url": "https://www.wellsfargo.com/mortgage/rates/", "raw_snippet": "..." },
  { "source": "bank_of_america", "label": "30-yr Fixed", "rate": 7.05, "term_type": "30yr", "bank_url": "https://www.bankofamerica.com/mortgage/mortgage-rates/", "raw_snippet": "..." },
  { "source": "rocket_mortgage", "label": "30-yr Fixed", "rate": 7.25, "term_type": "30yr", "bank_url": "https://www.rocketmortgage.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "loan_depot", "label": "30-yr Fixed", "rate": 7.18, "term_type": "30yr", "bank_url": "https://www.loandepot.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "navy_federal", "label": "30-yr Fixed", "rate": 6.75, "term_type": "30yr", "bank_url": "https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/", "raw_snippet": "..." },
  { "source": "pnc_bank", "label": "30-yr Fixed", "rate": 7.10, "term_type": "30yr", "bank_url": "https://www.pnc.com/en/personal-banking/borrowing/mortgage.html", "raw_snippet": "..." },
  { "source": "us_bank", "label": "30-yr Fixed", "rate": 7.08, "term_type": "30yr", "bank_url": "https://www.usbank.com/home-loans/mortgage/mortgage-rates.html", "raw_snippet": "..." },
  { "source": "penfed", "label": "30-yr Fixed", "rate": 6.82, "term_type": "30yr", "bank_url": "https://www.penfed.org/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "citi", "label": "30-yr Fixed", "rate": 7.02, "term_type": "30yr", "bank_url": "https://www.citi.com/mortgage/purchase-rates", "raw_snippet": "..." },
  { "source": "truist", "label": "30-yr Fixed", "rate": 7.15, "term_type": "30yr", "bank_url": "https://www.truist.com/mortgage/current-mortgage-rates", "raw_snippet": "..." },
  { "source": "better_mortgage", "label": "30-yr Fixed", "rate": 6.95, "term_type": "30yr", "bank_url": "https://better.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "usaa", "label": "30-yr Fixed", "rate": 6.80, "term_type": "30yr", "bank_url": "https://www.usaa.com/banking/home-mortgages/", "raw_snippet": "..." },
  { "source": "td_bank", "label": "30-yr Fixed", "rate": 7.20, "term_type": "30yr", "bank_url": "https://www.td.com/us/en/personal-banking/mortgage", "raw_snippet": "..." }
]
Search today's date for each source. Use the provided bank_url as the starting point for each lender search. If a rate is not publicly available, use null and note it in raw_snippet.`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

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
  if (!supabaseClient) return;
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

  const { error } = await supabaseClient.from('rate_snapshots').insert(insertRows);
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
  const grid = document.getElementById('rates-grid');
  grid.innerHTML = Array(9).fill(0).map(() => `
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

  // Cap to display list size
  filtered = filtered.slice(0, DISPLAY_ORDER.length);

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

  const fedRow = rows.find(r => r.source === 'fed') || null;

  // Build one tile per display source: live Supabase row if available,
  // otherwise a placeholder (rate: null) so lenders with no cached data
  // still appear as "—" tiles sorted to the end.
  const rateBySource = new Map(rows.map(r => [r.source, r]));
  const bankRows = [];
  for (const source of DISPLAY_ORDER) {
    if (rateBySource.has(source)) {
      bankRows.push(rateBySource.get(source));
    } else {
      const fb = FALLBACK_RATES.find(f => f.source === source);
      if (fb) bankRows.push({ source, rate: null, term_type: fb.term_type, bank_url: fb.bank_url, fetched_at: null, label: fb.label });
    }
  }

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
function setErrorBanner(msg) {
  const el = document.getElementById('banner-error');
  if (el) el.innerHTML = `✕ ${msg}`;
  showBanner('banner-error');
}

async function init() {
  try {
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
    console.log('[MR] querying Supabase...');
    rows = await fetchFromSupabase();
    console.log('[MR] Supabase:', rows ? rows.length + ' rows' : 'null/empty');
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
    }

    // 2. Check freshness
    const latestTs = rows && rows[0]?.fetched_at;
    const cacheHit = latestTs && !isStale(latestTs);
    console.log('[MR] cache hit:', cacheHit);

    if (cacheHit) {
      await renderAll(rows, prevFedRow);
    } else {
      // Stale or empty — fetch from Claude
      try {
        console.log('[MR] starting Claude API fetch...');
        const freshRows = await fetchFromClaude();
        console.log('[MR] Claude returned', freshRows.length, 'rows');
        await insertToSupabase(freshRows);
        const dbRows = await fetchFromSupabase();
        rows = dbRows || freshRows.map(r => ({ ...r, fetched_at: new Date().toISOString() }));
        state.rateRows = rows;
        await renderAll(rows, prevFedRow);
      } catch (e) {
        console.error('[MR] Claude fetch failed:', e);
        if (rows && rows.length > 0) {
          setErrorBanner('Live fetch failed — showing last known rates. (' + e.message + ')');
          state.usingStale = true;
          await renderAll(rows, prevFedRow);
        } else {
          setErrorBanner('Could not fetch live rates (' + e.message + '). Showing reference values — visit each lender for current quotes.');
          state.usingFallback = true;
          const fallback = FALLBACK_RATES.map(r => ({ ...r, fetched_at: null }));
          state.rateRows = fallback;
          await renderAll(fallback, null);
        }
      }
    }
  } catch (fatalErr) {
    console.error('[MR] Fatal init error:', fatalErr);
    setErrorBanner('App failed to start: ' + fatalErr.message);
    try {
      const fallback = FALLBACK_RATES.map(r => ({ ...r, fetched_at: null }));
      await renderAll(fallback, null);
    } catch (_) {}
  }
}

// Kick off after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
