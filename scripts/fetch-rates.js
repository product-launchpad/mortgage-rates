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
Return ONLY a valid JSON array, no markdown, no explanation, no code fences.
Format:
[
  { "source": "fed",            "label": "Fed Funds Rate",   "rate": 4.33, "term_type": "fed",  "bank_url": "https://www.federalreserve.gov/releases/h15/", "raw_snippet": "..." },
  { "source": "freddie_mac",    "label": "30-yr Fixed Avg",  "rate": 6.30, "term_type": "30yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "freddie_mac_15", "label": "15-yr Fixed Avg",  "rate": 5.65, "term_type": "15yr", "bank_url": "https://www.freddiemac.com/pmms", "raw_snippet": "..." },
  { "source": "chase",          "label": "30-yr Fixed", "rate": 6.99, "term_type": "30yr", "bank_url": "https://www.chase.com/personal/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "wells_fargo",    "label": "30-yr Fixed", "rate": 7.12, "term_type": "30yr", "bank_url": "https://www.wellsfargo.com/mortgage/rates/", "raw_snippet": "..." },
  { "source": "bank_of_america","label": "30-yr Fixed", "rate": 7.05, "term_type": "30yr", "bank_url": "https://www.bankofamerica.com/mortgage/mortgage-rates/", "raw_snippet": "..." },
  { "source": "rocket_mortgage","label": "30-yr Fixed", "rate": 7.25, "term_type": "30yr", "bank_url": "https://www.rocketmortgage.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "loan_depot",     "label": "30-yr Fixed", "rate": 7.18, "term_type": "30yr", "bank_url": "https://www.loandepot.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "navy_federal",   "label": "30-yr Fixed", "rate": 6.75, "term_type": "30yr", "bank_url": "https://www.navyfederal.org/loans-cards/mortgage/mortgage-rates/", "raw_snippet": "..." },
  { "source": "pnc_bank",       "label": "30-yr Fixed", "rate": 7.10, "term_type": "30yr", "bank_url": "https://www.pnc.com/en/personal-banking/borrowing/mortgage.html", "raw_snippet": "..." },
  { "source": "us_bank",        "label": "30-yr Fixed", "rate": 7.08, "term_type": "30yr", "bank_url": "https://www.usbank.com/home-loans/mortgage/mortgage-rates.html", "raw_snippet": "..." },
  { "source": "penfed",         "label": "30-yr Fixed", "rate": 6.82, "term_type": "30yr", "bank_url": "https://www.penfed.org/mortgage/mortgage-rates", "raw_snippet": "..." },
  { "source": "citi",           "label": "30-yr Fixed", "rate": 7.02, "term_type": "30yr", "bank_url": "https://www.citi.com/mortgage/purchase-rates", "raw_snippet": "..." },
  { "source": "truist",         "label": "30-yr Fixed", "rate": 7.15, "term_type": "30yr", "bank_url": "https://www.truist.com/mortgage/current-mortgage-rates", "raw_snippet": "..." },
  { "source": "better_mortgage","label": "30-yr Fixed", "rate": 6.95, "term_type": "30yr", "bank_url": "https://better.com/mortgage-rates", "raw_snippet": "..." },
  { "source": "usaa",           "label": "30-yr Fixed", "rate": 6.80, "term_type": "30yr", "bank_url": "https://www.usaa.com/banking/home-mortgages/", "raw_snippet": "..." },
  { "source": "td_bank",        "label": "30-yr Fixed", "rate": 7.20, "term_type": "30yr", "bank_url": "https://www.td.com/us/en/personal-banking/mortgage", "raw_snippet": "..." }
]
Search today's date for each source. Use the provided bank_url as the starting point for each lender search. If a rate is not publicly available, use null and note it in raw_snippet.`;

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
      max_tokens: 4000,
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
