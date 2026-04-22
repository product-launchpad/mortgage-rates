// ─── CONFIG (placeholders replaced at build time by build.sh) ────────────────
const CONFIG = {
  SUPABASE_URL:      '__SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
};

// Fallback rates in case Supabase is unavailable
const FALLBACK_RATES = [
  { source: 'navy_federal',   rate: 6.75, term_type: '30yr', bank_url: 'https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/' },
  { source: 'penfed',         rate: 6.82, term_type: '30yr', bank_url: 'https://www.penfed.org/mortgage/mortgage-rates' },
  { source: 'better_mortgage',rate: 6.95, term_type: '30yr', bank_url: 'https://better.com/mortgage-rates' },
  { source: 'usaa',           rate: 6.80, term_type: '30yr', bank_url: 'https://www.usaa.com/banking/home-mortgages/' },
  { source: 'chase',          rate: 6.99, term_type: '30yr', bank_url: 'https://www.chase.com/personal/mortgage/mortgage-rates' },
  { source: 'citi',           rate: 7.02, term_type: '30yr', bank_url: 'https://www.citi.com/mortgage/purchase-rates' },
  { source: 'bank_of_america',rate: 7.05, term_type: '30yr', bank_url: 'https://www.bankofamerica.com/mortgage/mortgage-rates/' },
  { source: 'us_bank',        rate: 7.08, term_type: '30yr', bank_url: 'https://www.usbank.com/home-loans/mortgage/mortgage-rates.html' },
  { source: 'pnc_bank',       rate: 7.10, term_type: '30yr', bank_url: 'https://www.pnc.com/en/personal-banking/borrowing/mortgage.html' },
  { source: 'wells_fargo',    rate: 7.12, term_type: '30yr', bank_url: 'https://www.wellsfargo.com/mortgage/rates/' },
  { source: 'truist',         rate: 7.15, term_type: '30yr', bank_url: 'https://www.truist.com/mortgage/current-mortgage-rates' },
  { source: 'loan_depot',     rate: 7.18, term_type: '30yr', bank_url: 'https://www.loandepot.com/mortgage-rates' },
  { source: 'td_bank',        rate: 7.20, term_type: '30yr', bank_url: 'https://www.td.com/us/en/personal-banking/mortgage' },
  { source: 'rocket_mortgage',rate: 7.25, term_type: '30yr', bank_url: 'https://www.rocketmortgage.com/mortgage-rates' },
];

// Per-lender metadata: matching notes, credit floor, top-pick contexts
const LENDER_META = {
  chase: {
    name: 'Chase',
    note: 'Relationship discounts for existing Chase banking customers. Strong conventional programs.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  wells_fargo: {
    name: 'Wells Fargo',
    note: 'Wide loan product range. Good for conventional purchases and rate-term refinances.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  bank_of_america: {
    name: 'Bank of America',
    note: 'Preferred Rewards members earn up to 0.25% rate discount. Solid first-time buyer programs.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  rocket_mortgage: {
    name: 'Rocket Mortgage',
    note: 'Fully digital process. Excellent for first-time buyers, refinance, and borrowers with fair credit.',
    minCredit: 580,
    topFor: ['purchase', 'refinance', 'first_time'],
    offersArm: true,
  },
  loan_depot: {
    name: 'loanDepot',
    note: 'No origination fees on many loan products. Competitive online lender for purchase and refi.',
    minCredit: 580,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  penfed: {
    name: 'PenFed Credit Union',
    note: 'Top-rated credit union open to everyone. Known for consistently low rates and VA loan expertise.',
    minCredit: 620,
    topFor: ['purchase', 'refinance', 'military'],
    offersArm: true,
  },
  citi: {
    name: 'Citi',
    note: 'Relationship pricing available for Citi banking customers. Competitive on conventional and jumbo loans.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  truist: {
    name: 'Truist',
    note: 'One of the largest US banks (SunTrust + BB&T). Strong in Southeast and Mid-Atlantic markets.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  better_mortgage: {
    name: 'Better Mortgage',
    note: 'No commission, fully digital lender. Competitive rates and fast pre-approval — strong for refinance.',
    minCredit: 620,
    topFor: ['purchase', 'refinance', 'first_time'],
    offersArm: true,
  },
  usaa: {
    name: 'USAA',
    note: 'Exclusively for military, veterans & eligible family. Highly rated service and competitive VA loan rates.',
    minCredit: 620,
    topFor: ['purchase', 'refinance', 'military'],
    offersArm: true,
  },
  td_bank: {
    name: 'TD Bank',
    note: 'Strong in Northeast and Mid-Atlantic. Competitive conventional programs with local branch support.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  navy_federal: {
    name: 'Navy Federal',
    note: 'Exclusive to military, veterans & families. Consistently lowest rates among all lenders surveyed.',
    minCredit: 580,
    topFor: ['purchase', 'refinance', 'military'],
    offersArm: true,
  },
  pnc_bank: {
    name: 'PNC Bank',
    note: 'Competitive conventional rates, especially in Midwest and East Coast markets.',
    minCredit: 620,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
  us_bank: {
    name: 'U.S. Bank',
    note: 'Strong loan programs for borrowers with solid credit history. Nationwide reach.',
    minCredit: 640,
    topFor: ['purchase', 'refinance'],
    offersArm: true,
  },
};

const CREDIT_TIERS = {
  '780plus':  { min: 780, label: '780+',      tier: 'excellent', pips: 5 },
  '740-779':  { min: 740, label: '740–779',   tier: 'very_good', pips: 4 },
  '700-739':  { min: 700, label: '700–739',   tier: 'good',      pips: 3 },
  '660-699':  { min: 660, label: '660–699',   tier: 'fair',      pips: 2 },
  'below660': { min: 0,   label: 'Below 660', tier: 'limited',   pips: 1 },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  step:        1,
  goal:        null,
  loanType:    null,
  creditScore: null,
  rates:       [],
};

let supabaseClient = null;

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
function initSupabase() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.startsWith('__')) return;
  try {
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('[Advisor] Supabase init failed:', e.message);
  }
}

async function fetchRates() {
  if (!supabaseClient) return FALLBACK_RATES;
  try {
    const { data, error } = await supabaseClient
      .from('rate_snapshots')
      .select('*')
      .order('fetched_at', { ascending: false });

    if (error || !data || data.length === 0) return FALLBACK_RATES;

    const seen = new Set();
    const latest = [];
    for (const row of data) {
      if (!seen.has(row.source)) { seen.add(row.source); latest.push(row); }
    }
    const lenderRows = latest.filter(r => LENDER_META[r.source] != null && r.rate != null);
    return lenderRows.length >= 3 ? lenderRows : FALLBACK_RATES;
  } catch (e) {
    console.warn('[Advisor] Supabase read error:', e.message);
    return FALLBACK_RATES;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatRate(rate) {
  return rate != null ? Number(rate).toFixed(2) + '%' : '—';
}

function updateProgress() {
  document.querySelectorAll('.progress-step').forEach(el => {
    const n = parseInt(el.dataset.step);
    el.classList.toggle('active', n === state.step);
    el.classList.toggle('done',   n < state.step);
    el.textContent = n < state.step ? '✓' : String(n);
  });
  document.querySelectorAll('.progress-line').forEach((el, i) => {
    el.classList.toggle('done', i + 1 < state.step);
  });
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function goToStep(n) {
  state.step = typeof n === 'number' ? n : 99;
  document.querySelectorAll('.quiz-step, #results-step').forEach(el => el.classList.remove('active'));
  const target = n === 'results'
    ? document.getElementById('results-step')
    : document.getElementById(`step-${n}`);
  if (target) target.classList.add('active');
  if (typeof n === 'number') updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Auto-advance with brief visual feedback delay
function autoAdvance(nextStep) {
  setTimeout(() => goToStep(nextStep), 380);
}

// ─── STEP 1: GOAL ─────────────────────────────────────────────────────────────
function setupStep1() {
  document.querySelectorAll('#step-1 .option-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#step-1 .option-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.goal = card.dataset.value;
      autoAdvance(2);
    });
  });
}

// ─── STEP 2: LOAN TYPE ────────────────────────────────────────────────────────
function setupStep2() {
  document.querySelectorAll('#step-2 .option-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#step-2 .option-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.loanType = card.dataset.value;
      autoAdvance(3);
    });
  });
  document.getElementById('back-2')?.addEventListener('click', () => goToStep(1));
}

// ─── STEP 3: CREDIT SCORE ─────────────────────────────────────────────────────
function setupStep3() {
  const showBtn = document.getElementById('show-results-btn');

  document.querySelectorAll('#step-3 .credit-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#step-3 .credit-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.creditScore = opt.dataset.value;
      if (showBtn) showBtn.disabled = false;
    });
  });

  document.getElementById('back-3')?.addEventListener('click', () => goToStep(2));

  showBtn?.addEventListener('click', async () => {
    showBtn.disabled = true;
    showBtn.textContent = 'Finding your matches…';
    state.rates = await fetchRates();
    renderResults();
    goToStep('results');
    showBtn.disabled = false;
    showBtn.textContent = 'Find My Matches →';
  });
}

// ─── RESULTS: MATCHING LOGIC ──────────────────────────────────────────────────
function isTopPick(source, goal, creditScore) {
  const meta = LENDER_META[source];
  if (!meta) return false;
  const creditMin = CREDIT_TIERS[creditScore]?.min ?? 0;
  if (meta.minCredit > creditMin + 60) return false; // credit too far below threshold
  return meta.topFor.includes(goal);
}

function getInsight(goal, loanType, creditScore) {
  const tier      = CREDIT_TIERS[creditScore]?.tier;
  const scoreLabel= CREDIT_TIERS[creditScore]?.label;
  const goalLabel = goal === 'purchase' ? 'purchasing' : 'refinancing';
  const isArm     = loanType && loanType.includes('arm');
  const armNote   = isArm ? ' ARM rates reset after the initial fixed period — they suit buyers planning to move or refinance within the fixed window.' : '';

  const map = {
    excellent: `With excellent credit (${scoreLabel}), you qualify for the best available rates from every lender. Getting quotes from at least 3 lenders can save $20,000+ over a 30-year loan — the spread between best and worst is often 0.40–0.50%.${armNote}`,
    very_good: `Your strong credit (${scoreLabel}) puts you in a great position for ${goalLabel}. Most lenders will offer competitive rates. Compare at least 3 quotes before deciding.${armNote}`,
    good:      `Your credit score (${scoreLabel}) qualifies you for most conventional programs. Lenders like Rocket Mortgage and loanDepot are well-regarded for this range. Shopping multiple offers is especially valuable here.${armNote}`,
    fair:      `At ${scoreLabel}, you may qualify for FHA loans (as little as 3.5% down, 580+ score required) alongside some conventional options. An FHA loan could unlock a lower rate than a conventional one in your range.${armNote}`,
    limited:   `With a score below 660, FHA loans (580+ score) or VA loans (veterans only) are your most realistic path. Conventional lenders typically require 620+. Improving your score by even 20–40 points before applying could meaningfully reduce your rate.`,
  };
  return map[tier] || map.good;
}

function renderResults() {
  const { goal, loanType, creditScore, rates } = state;
  const isArm    = loanType && loanType.includes('arm');
  const creditInfo = CREDIT_TIERS[creditScore];

  // Summary tags
  const summaryEl = document.getElementById('results-summary');
  if (summaryEl) {
    const goalLabel  = goal === 'purchase' ? 'Purchase' : 'Refinance';
    const typeLabels = {
      '30yr': '30-yr Fixed', '15yr': '15-yr Fixed',
      '5-1-arm': '5/1 ARM', '7-1-arm': '7/1 ARM', '10-1-arm': '10/1 ARM',
      'unsure': 'All Types',
    };
    summaryEl.innerHTML =
      `<span>Based on:</span>
       <span class="summary-tag">${goalLabel}</span>
       <span class="summary-tag">${typeLabels[loanType] || loanType}</span>
       <span class="summary-tag">${creditInfo?.label || creditScore}</span>`;
  }

  // Insight text
  const insightEl = document.getElementById('results-insight');
  if (insightEl) insightEl.textContent = getInsight(goal, loanType, creditScore);

  // ARM notice
  const armEl = document.getElementById('arm-notice');
  if (armEl) armEl.style.display = isArm ? 'block' : 'none';

  // Filter by term
  let filtered = [...rates];
  if (loanType === '30yr') filtered = rates.filter(r => r.term_type === '30yr' || !r.term_type);
  else if (loanType === '15yr') filtered = rates.filter(r => r.term_type === '15yr');
  // ARM / unsure: keep all lenders

  // Sort: top picks first, then by rate
  filtered.sort((a, b) => {
    const aTop = isTopPick(a.source, goal, creditScore) ? 0 : 1;
    const bTop = isTopPick(b.source, goal, creditScore) ? 0 : 1;
    if (aTop !== bTop) return aTop - bTop;
    return (a.rate ?? 999) - (b.rate ?? 999);
  });

  // Mark first 3 as top picks (cap at actual top-pick count)
  const topPickSources = new Set(
    filtered.filter(r => isTopPick(r.source, goal, creditScore)).slice(0, 3).map(r => r.source)
  );

  const grid = document.getElementById('results-grid');
  if (!grid) return;

  grid.innerHTML = filtered.map(row => {
    const meta = LENDER_META[row.source] || {};
    const top  = topPickSources.has(row.source);
    const armNote = isArm && !meta.offersArm
      ? '<div style="font-size:11px;color:var(--amber-text);margin-top:4px">ARM availability: check site</div>'
      : '';
    return `
      <div class="result-card ${top ? 'top-pick' : ''}">
        ${top ? '<div class="top-pick-badge">⭐ Top Pick</div>' : ''}
        <div class="result-card-name">${meta.name || row.source}</div>
        <div class="result-card-rate">
          ${formatRate(row.rate)}
          <span class="rate-label">${isArm ? '(30-yr ref)' : ''}</span>
        </div>
        <div class="result-card-note">${meta.note || ''}${armNote}</div>
        <a class="btn-get-quote" href="${row.bank_url || '#'}" target="_blank" rel="noopener">
          Get Quote ↗
        </a>
      </div>`;
  }).join('');

  document.getElementById('back-results')?.addEventListener('click', () => goToStep(3));
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  initSupabase();
  setupStep1();
  setupStep2();
  setupStep3();
  goToStep(1);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
