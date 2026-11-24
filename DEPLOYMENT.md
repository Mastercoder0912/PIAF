# Deploying Running Pacer

The app is a static Vite build (`npm run build` → `dist/`) plus one small serverless function
(`api/weather.ts`) that looks up the weather. It is set up for **Vercel**; `vercel.json` already has the
build command, output folder and function settings. No code changes are needed to deploy.

**The one secret:** your WeatherAPI.com key. It lives only in Vercel's server-side environment variables, under the
name `WEATHERAPI_KEY`. Do **not** name it `VITE_…` (those names are copied into the web page for every visitor).
The app works without it: the weather card just says weather isn't available.

## First deploy: option A, from your computer (fastest, no GitHub needed)

You need Node 22, a free Vercel account (vercel.com), and your WeatherAPI.com key.

```bash
cd running-pacer
npm install
npx vercel login                       # opens a browser to sign in
npx vercel                             # answer the prompts: link/create a project, accept the detected Vite settings
npx vercel env add WEATHERAPI_KEY      # paste the key when asked; choose Production (and Preview if you like)
npx vercel --prod                      # builds and publishes; prints the https:// address
```

The environment variable only applies to deployments made **after** it was added, so always run
`npx vercel --prod` after `env add`.

## First deploy: option B, from GitHub

1. Put the project in a GitHub repository (the included `.gitignore` already keeps `node_modules`, `dist` and `.env*` out).
2. In Vercel: **Add New → Project →** pick the repository. Vercel detects Vite and reads `vercel.json`; leave the settings as they are.
3. Before pressing Deploy, open **Environment Variables**, add `WEATHERAPI_KEY` = your key (Production, Preview and Development), then **Deploy**.

## Check that it works (2 minutes)

1. Open the address Vercel prints, for example `https://running-pacer.vercel.app`.
2. Open `https://<your-address>/api/weather?q=lubbock` in a browser tab. You should see JSON beginning `{"place":"Lubbock, Texas", …}`.
   - `{"error":"unavailable"}` means the function ran but could not get weather: the key is missing, mistyped or out of quota.
     In Vercel, open the project → **Logs** and look for a line starting `weather:` (it never contains the key). Fix the variable, then redeploy.
   - A Vercel "404" page instead of JSON means the function was not deployed: check that the `api/` folder is in the project.
3. On your phone, open the address, calculate a race and open **Pacer Mode**. The browser asks to use your location; allow it and the weather appears. Also try refusing once (or use a private tab) to see the "City or ZIP code" fallback, then type a city and press **Get weather**.
4. Share the address with coaches. They need nothing installed.

## Redeploying after a change

- **Option A:** run `npx vercel --prod` again from the project folder.
- **Option B:** push to the repository's main branch. Vercel redeploys automatically; other branches get their own preview address.

Before any deploy, run `npm test`, `npm run typecheck` and `npm run build` (the build runs the type check too).

## Changing or rotating the key

Vercel project → **Settings → Environment Variables** → edit `WEATHERAPI_KEY` → redeploy (a variable change does not
touch a deployment that is already live). If the key was ever pasted into a chat, an email or a screenshot, create a new
one in your WeatherAPI.com account and replace it.

## Adding to the home screen (for coaches)

- **iPhone (Safari):** Share button → **Add to Home Screen** → Add.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** (or **Install app**).

It opens full-screen like an app. It is still the website: updates appear on the next open, and nothing is installed from a store.
(There is no offline mode yet, so it needs a connection to load.)

## Running the weather function on your own computer

`npm run dev` serves the app only; `/api/weather` isn't available there, so the card shows "Weather isn't available right now".
To try the real function locally: copy `.env.example` to `.env.local`, put your key in it, and run `npx vercel dev`.

## Notes

- Weather readings are cached for 10 minutes (on Vercel's network and in the coach's browser) to stay within the WeatherAPI.com quota.
- Coordinates from the location lookup are rounded to about 1 km before they are sent, and are not stored.
- Netlify is not configured. The function is one file (`api/weather.ts`) and could be adapted, but only Vercel has been prepared.
- WeatherAPI.com attribution (a "Powered by WeatherAPI.com" link) is shown in the weather card. Keep it.
