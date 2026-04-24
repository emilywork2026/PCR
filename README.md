# Pacific Car Rentals — Rate Intelligence Dashboard

Competitive Expedia rate tracker for Avis, Enterprise, Budget, and Hertz. Manual Saturday capture, trend analysis, and PCR rate strategy engine.

## Features

- **Saturday capture** — 60-second weekly rate entry with direct Expedia links per brand
- **Analyze** — 13-week trend charts, brand averages, week-by-week breakdown
- **Rate strategy** — Configurable positioning logic (undercut avg/min, match min, premium) with rate adjustment workflow

## Deploy in 5 minutes

### 1. Push to GitHub

```bash
# Create repo at github.com/new — name it pcr-dashboard
git init
git add .
git commit -m "init: PCR rate intelligence dashboard"
git remote add origin https://github.com/YOUR_USERNAME/pcr-dashboard.git
git branch -M main
git push -u origin main
```

### 2. Deploy to Vercel

**Option A — Vercel dashboard (easiest)**
1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select your `pcr-dashboard` repo
4. Framework preset: **Other**
5. Click **Deploy** — done in ~30 seconds

**Option B — Vercel CLI**
```bash
npm install -g vercel
vercel login
vercel --prod
```

Your dashboard will be live at `https://pcr-dashboard.vercel.app` (or similar).

### Auto-deploy on push

Once connected, every `git push` to `main` automatically re-deploys. To update the dashboard:

```bash
git add .
git commit -m "update: added new Saturday rates"
git push
```

## Local development

Just open `index.html` in a browser — no build step needed.

```bash
# Or use a local server (avoids CORS quirks)
npx serve .
```

## Data storage

All rate data is stored in the browser's `localStorage` under the key `pcr_sat_v2`. Data persists across sessions on the same device/browser. To share data between team members, export/import via the clipboard or upgrade to a backend like Supabase.

## File structure

```
pcr-dashboard/
├── index.html   — UI layout and tab structure
├── app.js       — All logic: data, charts, strategy engine
├── vercel.json  — Vercel static deployment config
└── README.md
```
