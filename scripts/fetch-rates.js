#!/usr/bin/env node
// Fetches today's mortgage rates via Claude AI and stores them in Supabase.
// Runs as a GitHub Actions scheduled job — zero npm dependencies required.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;

if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY');
  process.exit(1);
}

const today = new Date().toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
});

const PROMPT = `Search the web and find today's US mortgage rates as of ${today}.

For EACH lender, collect SEPARATE rates for:
1. PURCHASE loans — 30-yr fixed AND 15-yr fixed
2. REFINANCE loans — 30-yr fixed refi AND 15-yr fixed refi
3. HOME EQUITY — HELOC rate (if publicly listed; null if not)

Return ONLY a valid JSON array, no markdown, no explanation, no code fences.
Each element is one rate for one lender and one rate_type.
Required fields: source, rate_type ("purchase", "refinance", or "home_equity"), label, rate, term_type ("30yr", "15yr", or "heloc"), bank_url, raw_snippet.

Example (show all entries for every lender):
[
  { "source": "fed", "rate_type": "reference", "label": "Fed Funds Rate", "rate": 4.33, "term_type": "fed", "bank_url": "https://www.federalreserve.gov/releases/h15/", "raw_snippet": "..." },
  { "source": "freddie_mac", "rate_type": "purchase", "label": "30-yr Fixed Avg", "rate": 6.80, "term_type": "30yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "freddie_mac", "rate_type": "purchase", "label": "15-yr Fixed Avg", "rate": 6.10, "term_type": "15yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "chase", "rate_type": "purchase", "label": "30-yr Fixed", "rate": 6.99, "term_type": "30yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "chase", "rate_type": "purchase", "label": "15-yr Fixed", "rate": 6.25, "term_type": "15yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "chase", "rate_type": "refinance", "label": "30-yr Fixed Refi", "rate": 7.10, "term_type": "30yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "chase", "rate_type": "refinance", "label": "15-yr Fixed Refi", "rate": 6.40, "term_type": "15yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "chase", "rate_type": "home_equity", "label": "HELOC", "rate": 8.50, "term_type": "heloc", "bank_url": "https://www.chase.com/personal/mortgage/home-equity", "raw_snippet": "..." },
  ... (repeat all entries for every lender below)
]

Lenders (include all entries for each):
- chase: https://www.chase.com/personal/mortgage/mortgage-rates
- wells_fargo: https://www.wellsfargo.com/mortgage/rates/
- bank_of_america: https://www.bankofamerica.com/mortgage/mortgage-rates/
- rocket_mortgage: https://www.rocketmortgage.com/mortgage-rates
- loan_depot: https://www.loandepot.com/mortgage-rates
- navy_federal: https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/
- pnc_bank: https://www.pnc.com/en/personal-banking/borrowing/mortgage.html
- us_bank: https://www.usbank.com/home-loans/mortgage/mortgage-rates.html
- penfed: https://www.penfed.org/mortgage/mortgage-rates
- citi: https://www.citi.com/mortgage/purchase-rates
- truist: https://www.truist.com/mortgage/current-mortgage-rates
- better_mortgage: https://better.com/mortgage-rates
- usaa: https://www.usaa.com/banking/home-mortgages/
- td_bank: https://www.td.com/us/en/personal-banking/mortgage

If a rate is unavailable, set rate to null and explain in raw_snippet. Refinance rates are typically 0.10–0.25% above purchase rates if not separately listed.`;

async function fetchFromClaude() {
  console.log(`[fetch-rates] Calling Claude API for ${today}...`);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: PROMPT }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API ${response.status}: ${errText}`);
  }

  const data = await response.json();

  let jsonText = '';
  for (const block of (data.content || [])) {
    if (block.type === 'text' && block.text) jsonText = block.text;
  }
  if (!jsonText) throw new Error('No text content in Claude response');

  jsonText = jsonText.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = jsonText.indexOf('[');
  const end   = jsonText.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array in Claude response');

  const parsed = JSON.parse(jsonText.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Claude response is not a JSON array');

  console.log(`[fetch-rates] Claude returned ${parsed.length} rows`);
  return parsed;
}

async function insertToSupabase(rows) {
  const now = new Date().toISOString();
  const insertRows = rows.map(r => ({
    fetched_at:  now,
    source:      r.source,
    label:       r.label,
    rate:        r.rate != null ? Number(r.rate) : null,
    term_type:   r.term_type || null,
    rate_type:   r.rate_type || 'purchase',
    bank_url:    r.bank_url || null,
    raw_snippet: r.raw_snippet || null,
  }));

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rate_snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(insertRows),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase insert ${response.status}: ${errText}`);
  }

  console.log(`[fetch-rates] Inserted ${insertRows.length} rows into Supabase`);
}

async function main() {
  const rows = await fetchFromClaude();
  await insertToSupabase(rows);
  console.log('[fetch-rates] Done.');
}

main().catch(err => {
  console.error('[fetch-rates] Fatal error:', err.message);
  process.exit(1);
});
