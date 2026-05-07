# Spotify Daily Song Quiz

Listen to a 3-second clip of a random song and guess it from 5 options. New quiz every day!

## Setup

1. **Get Spotify credentials** — create an app at https://developer.spotify.com/dashboard
2. **Create `.env`** in the project root:
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Run locally:**
   ```bash
   npx netlify dev
   ```

## Deploy to Netlify

1. Push this repo to GitHub
2. Connect the repo in [Netlify Dashboard](https://app.netlify.com)
3. Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` as environment variables in Netlify's site settings
4. Deploy — done!

## How It Works

- **No user login required** — uses Spotify's Client Credentials flow (app-level token)
- A Netlify serverless function (`/.netlify/functions/quiz`) fetches 5 random tracks daily using seeded randomization
- Only tracks with 30-second preview URLs are selected
- The frontend plays 3 seconds of the preview and shows 5 MCQ options
- Same quiz for everyone on the same day (deterministic daily seed)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npx netlify dev` | Full local dev with serverless functions |

## Tech Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Backend:** Netlify Functions (serverless)
- **API:** Spotify Web API (Client Credentials)
- **Tests:** Vitest
