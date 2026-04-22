#!/bin/bash
# Cloudflare Pages build script
# Injects environment variables as literal strings into app.js at build time.
# WARNING: This bakes keys into the static JS file (visible in page source).
# For public/production use, proxy the Anthropic call through a Cloudflare Worker.

set -e

echo "Injecting environment variables into js/app.js..."

sed -i "s|__ANTHROPIC_API_KEY__|${ANTHROPIC_API_KEY}|g" js/app.js
sed -i "s|__SUPABASE_URL__|${SUPABASE_URL}|g" js/app.js
sed -i "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" js/app.js

echo "Build complete."
