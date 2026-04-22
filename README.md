# MortgageRate.live

Single-page mortgage rate tracker — live rates via Claude AI web search, persisted in Supabase, deployed on Cloudflare Pages. Optimized for Google SEO and AdSense monetization.

---

## Project structure

```
mortgage-rates/
├── index.html        ← SPA with SEO meta, JSON-LD, FAQ, AdSense slots
├── css/styles.css
├── js/app.js         ← placeholders replaced at build time
├── supabase/schema.sql
├── robots.txt
├── sitemap.xml
├── _headers          ← Cloudflare Pages security + cache headers
├── _redirects        ← Cloudflare Pages SPA rule
├── build.sh          ← sed-based env injection
└── README.md
```

---

## 1. Supabase setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the contents of `supabase/schema.sql`.
3. Copy your **Project URL** and **anon public key** from **Settings → API**.

> **Security note:** The schema enables anon INSERT so the browser can write fresh rates.
> For a public site, tighten this by routing inserts through a Cloudflare Worker using
> the service role key instead.

---

## 2. Anthropic API key

Generate a key at [console.anthropic.com](https://console.anthropic.com).

> **Security note:** `build.sh` bakes the key into the static JS file, making it visible
> in the page source. This is fine for personal/low-traffic use. For a public site,
> proxy the `/v1/messages` call through a Cloudflare Worker so the key stays server-side.

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
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_ANON_KEY` | your Supabase anon public key |

Cloudflare injects these into the build environment. `build.sh` uses `sed` to replace
the placeholder strings in `js/app.js` before the files are deployed.

---

## 4. Google AdSense setup

### a. Apply for AdSense
1. Go to [google.com/adsense/start](https://www.google.com/adsense/start/).
2. Sign in and add your site (`mortgagerate.live`).
3. Google will review the site (usually 1–7 days).

### b. Replace the publisher ID
Once approved, replace the placeholder in two places:

**`index.html` — AdSense script tag (in `<head>`):**
```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-YOUR_PUB_ID" crossorigin="anonymous"></script>
```

**`index.html` — each `<ins>` ad unit:**
```html
data-ad-client="ca-pub-YOUR_PUB_ID"
data-ad-slot="YOUR_SLOT_ID"
```

Get the slot IDs from your AdSense dashboard under **Ads → By ad unit**.

### c. Ad unit placements
| Location | Slot constant | Format |
|---|---|---|
| Below Fed banner | `1111111111` | Responsive leaderboard |
| Between rates grid and calculator | `2222222222` | Responsive rectangle |
| Above footer | `3333333333` | Responsive leaderboard |

### d. Verification (site ownership)
When AdSense asks to verify ownership, add this meta tag inside `<head>` in `index.html`:
```html
<meta name="google-adsense-account" content="ca-pub-YOUR_PUB_ID" />
```

---

## 5. Google SEO — what's already in place

| Feature | Implementation |
|---|---|
| H1 heading | "Today's US Mortgage Rates" visible above fed banner |
| H2 sections | Federal Reserve, Today's Mortgage Rates, Mortgage Calculator, FAQ |
| Meta title + description | Keyword-rich, under 160 chars |
| Canonical URL | `https://mortgagerate.live/` |
| Open Graph tags | For social sharing previews |
| Twitter Card | `summary_large_image` |
| JSON-LD: WebSite | Site-level schema with SearchAction |
| JSON-LD: WebPage | Page-level schema |
| JSON-LD: FAQPage | 5 Q&As targeting mortgage keywords — eligible for Google rich results |
| robots.txt | Allows all crawlers, points to sitemap |
| sitemap.xml | Single URL, daily changefreq |
| Semantic HTML | `<main>`, `<nav>`, `<section>`, `<footer>`, `aria-*` labels |
| Cache headers | HTML: no-cache. CSS/JS: 1-year immutable. |
| Preconnect hints | `cdn.jsdelivr.net`, `api.anthropic.com` |

### Submit to Google Search Console
1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Add property `mortgagerate.live`.
3. Verify via DNS TXT record (add in Cloudflare DNS).
4. Submit sitemap: `https://mortgagerate.live/sitemap.xml`.

### OG image
Create a `1200×630px` PNG at `og-image.png` in the root directory.
Suggested design: rate numbers on white background with the brand name.

---

## 6. Local development

Replace the placeholders directly in `js/app.js` for local testing (revert before committing):

```js
const CONFIG = {
  ANTHROPIC_API_KEY: 'sk-ant-...',
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

## 7. Manual updates

- **FOMC date:** Update `NEXT_FOMC_DATE` at the top of `js/app.js` after each Fed meeting.
- **Sitemap lastmod:** Update the date in `sitemap.xml` when making content changes.
- **Fallback rates:** Update `FALLBACK_RATES` in `js/app.js` if hardcoded values become stale.

---

## How it works

1. On load, the app queries Supabase for the latest rate snapshot per source.
2. If data is under 6 hours old, it renders immediately from the cache.
3. If stale (or empty), it calls the Anthropic API with the `web_search` tool to fetch live rates.
4. Fresh results are written to Supabase, then rendered.
5. The Refresh button forces a new fetch regardless of cache age.
6. If the API call fails, the app falls back to stale Supabase data (yellow banner) or hardcoded values (red banner) — never a broken UI.
