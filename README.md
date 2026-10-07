# Worship Sets

Plan worship sets, share them with your team, and play the chord charts like a music stand.

- **Library**: add, edit and delete songs with their chart PDFs. "Import PDFs" uploads many charts at once and guesses
  title and key from the file name (`Way Maker - E.pdf`, `Goodness of God (Ab).pdf`).
- **Sets**: name, date, time, location, heart for the set, scripture, prayer points, team (who's on what) and
  the song order, with a per-set key and notes for each song. Duplicate a set to reuse it.
- **Private sets**: a set is only visible (and editable) to the leader who created it and the leaders they add
  under "Leaders for this set". The song library and the Leaders list are shared by all leaders.
- **Sharing**: every set has a private link (`/s/…`). Team members need no account and only see that set.
- **Charts viewer**: all pages of all charts in one swipeable strip (a 3-page and a 2-page chart swipe as 5 pages).
  Tap the left/right edge to turn pages, tap the middle for controls (song list, fit width/page, night mode,
  full screen). Bluetooth page-turner pedals work (arrow / page keys). The screen stays awake while it's open.
- **Offline**: the app installs to the home screen (PWA). Sets and charts a person has opened stay available offline.

## Stack

React + Vite + TypeScript, pdf.js for rendering, Supabase (Postgres, auth, storage) for data, hosted on Vercel.
The database schema lives in `supabase/migrations/`.

## Run locally

```sh
npm install
npm run dev
```

The Supabase URL and publishable key are in `src/lib/supabase.ts` (safe to be public; row level security protects
the data). Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` if needed.

## Deploy on Vercel

1. In Vercel: **Add New → Project → Import** `henroverhoef/worshipscheduler`. Framework preset: Vite (settings
   come from `vercel.json`). Deploy.
2. In Supabase (project **worship-sets**) → **Authentication → URL Configuration**: set **Site URL** to your Vercel
   URL (e.g. `https://worshipscheduler.vercel.app`) and add it under **Redirect URLs**. This makes the
   confirmation / sign-in emails link back to the app.

## Leaders

Only emails on the Leaders list can edit. To add a co-leader, add their email under **Leaders**, then they choose
**Create account** on the sign-in page with that same email and confirm it.
