# MortgageRate.live

Live US mortgage rate comparison tool — rates fetched daily via Claude AI web search, persisted in Supabase, deployed on Cloudflare Pages. Built by TAPS Partners as a free financial literacy resource.

---

## Project structure

```
mortgage-rates/
├── index.html          ← Homepage: live rates, calculator, FAQ, AdSense
├── advisor.html        ← Rate Advisor quiz (goal → loan type → credit score → lenders)
├── about.html          ← About TAPS Partners
├── disclaimer.html     ← Full disclaimer (informational only, no commissions)
├── blog/
│   ├── index.html      ← Blog listing page
│   └── mortgage-rates-week-april-21-2026.html  ← First weekly post
├── css/styles.css
├── js/
│   ├── app.js          ← Main app (rates, calculator); placeholders replaced at build time
│   └── advisor.js      ← Rate Advisor quiz logic; placeholders replaced at build time
├── scripts/
│   └── fetch-rates.js  ← Node.js script run by GitHub Actions cron job
├── .github/
│   └── workflows/
│       └── fetch-rates.yml  ← Daily cron: fetches rates at 10 AM ET via Claude, writes to Supabase
├── supabase/schema.sql
├── favicon.svg
├── og-image.svg
├── robots.txt
├── sitemap.xml
├── _headers            ← Cloudflare Pages security + cache headers
├── _redirects          ← Cloudflare Pages redirect rules
├── build.sh            ← sed-based env injection for Cloudflare build
└── README.md
```

---

## How it works

1. A **GitHub Actions cron job** runs `scripts/fetch-rates.js` every day at 10 AM ET.
2. The script calls the Anthropic Claude API (with web search) to fetch current rates from 14 major lenders and writes them to Supabase.
3. When a user visits the site, `app.js` reads the latest snapshot from Supabase and renders immediately — no API call needed.
4. If the Supabase data was already fetched today (after 10 AM ET), it is served as-is. If not yet refreshed, the app falls back to the previous day's data with a warning banner.
5. The **Refresh button** forces a fresh Claude API fetch from the browser as a manual override.
6. If everything fails, the app shows hardcoded reference rates — never a broken UI.

### Rate refresh schedule

| Component | Role |
|---|---|
| GitHub Actions cron | Primary: fetches at 10:00 AM ET daily (14:00 UTC EDT / 15:00 UTC EST) |
| Browser fallback | Secondary: triggers a client-side fetch if cron job missed and Supabase is stale |
| Supabase cache | Serves all normal page loads — no API call on every visit |

---

## 1. Supabase setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Copy your **Project URL** and **anon public key** from **Settings → API**.

---

## 2. GitHub Actions secrets

The daily cron job requires 3 secrets in **GitHub repo → Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (from [console.anthropic.com](https://console.anthropic.com)) |
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Your Supabase anon public key |

To test the job manually: **Actions → Fetch Daily Mortgage Rates → Run workflow**.

---

## 3. Cloudflare Pages setup

### Connect repo
1. Push this repository to GitHub.
2. In [Cloudflare Pages](https://pages.cloudflare.com), click **Create application → Pages → Connect to Git**.
3. Select your repo.

### Build settings
| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `bash build.sh` |
| Build output directory | `/` (root) |

### Environment variables
Add these in **Settings → Environment Variables** (Production + Preview):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon public key |

> `ANTHROPIC_API_KEY` is **not** needed in Cloudflare — the GitHub Actions cron handles all Claude API calls server-side. The browser no longer sends API requests on normal page loads.

`build.sh` uses `sed` to replace `__SUPABASE_URL__` and `__SUPABASE_ANON_KEY__` placeholders in `app.js` and `advisor.js` at build time.

---

## 4. Google AdSense setup

### a. Apply for AdSense
1. Go to [google.com/adsense/start](https://www.google.com/adsense/start/).
2. Sign in and add your site (`mortgagerate.live`).
3. Google will review the site (usually 1–7 days).

### b. Replace the publisher ID
Once approved, replace the placeholder publisher ID in `index.html`, `advisor.html`, `blog/index.html`, and blog posts.

### c. Ad unit placements (index.html)
| Location | Format |
|---|---|
| Below Fed banner | Responsive leaderboard |
| Between rates grid and calculator | Responsive rectangle |
| Above footer | Responsive leaderboard |

---

## 5. SEO — what's in place

| Feature | Detail |
|---|---|
| Pages | `/`, `/advisor.html`, `/about.html`, `/disclaimer.html`, `/blog/` |
| H1 / H2 headings | Keyword-rich on all pages |
| Meta title + description | Under 160 chars, unique per page |
| Canonical URLs | Set on every page |
| Open Graph + Twitter Card | With `og-image.svg` (1200×630) |
| Favicon | `favicon.svg` (house icon) |
| JSON-LD: WebSite + WebPage | Site and page-level schema |
| JSON-LD: FAQPage | 10 Q&As targeting mortgage keywords |
| JSON-LD: BlogPosting | On each blog post |
| robots.txt | Allows all crawlers, points to sitemap |
| sitemap.xml | All 6 URLs with lastmod and changefreq |
| `<noscript>` rate table | Static fallback for Googlebot |
| Google Analytics 4 | GA4 tag on all pages |

### Submit to Google Search Console
1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Add property `mortgagerate.live`.
3. Verify via DNS TXT record (add in Cloudflare DNS).
4. Submit sitemap: `https://mortgagerate.live/sitemap.xml`.

---

## 6. Local development

Replace the placeholders directly in `js/app.js` and `js/advisor.js` for local testing (revert before committing):

```js
const CONFIG = {
  SUPABASE_URL:      'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
};
```

Serve locally with any static file server:

```sh
npx serve .
# or
python3 -m http.server 8080
```

---

## 7. Manual maintenance

- **FOMC date:** Update `NEXT_FOMC_DATE` at the top of `js/app.js` after each Fed meeting.
- **Sitemap lastmod:** Update dates in `sitemap.xml` when making content changes.
- **Fallback rates:** Update `FALLBACK_RATES` in `js/app.js` and `js/advisor.js` if hardcoded values become stale.
- **Blog posts:** Add new `.html` files under `blog/` and link them in `blog/index.html` and `sitemap.xml`.
