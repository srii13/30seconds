# Wingo raw-data + colour capture patch

## What is stored

- `ApiFetchLog.rawPayload`: the complete JSON response for every fetch attempt where a response body was received.
- `Result.sourceRecord`: the full original source object for each valid round; unknown fields are preserved.
- `Result.sourceFields`: names of all fields returned for that round.
- `Result.sourceColorFields`: any explicit colour-related fields found in the source record (e.g. `color`, `colour`, `resultColor`, `color_name`).
- `Result.normalizedColors`: recognizable explicit colour labels (`RED`, `GREEN`, `VIOLET`, `PURPLE`) extracted from those fields. This does not infer colour from the result digit.
- Existing result number, Big/Small classification, source timestamp and observation timestamps remain stored.

Raw API payload logging can grow MongoDB usage. Keep Atlas storage limits in mind and export/backup data before applying retention rules. Never store API secrets, cookies, or credentials in logs.

## Deploy dashboard to Vercel

1. Push the project to a Git repository and import it into Vercel.
2. Add the same environment variables from `.env.local` in Vercel Project Settings → Environment Variables: `MONGODB_URI`, `MONGODB_DB`, `WINGO_HISTORY_URL`, `WINGO_GAME_MODE`, and `TIME_ZONE` as used by the app.
3. Deploy the dashboard. Vercel's `npm run build` does not start the persistent `scripts/collector.ts` loop.

## Run the collector continuously

Use a separate persistent worker (for example, a Render Background Worker) pointed at the same repository:

- Build command: `npm install`
- Start command: `npm run collector:prod`
- Set `MONGODB_URI`, `MONGODB_DB`, `WINGO_HISTORY_URL`, `WINGO_GAME_MODE`, and `COLLECT_INTERVAL_MS=30000` in the worker's environment.
- Do not copy `.env.local` or credentials into Git. Use the hosting provider's environment variable settings.

Vercel Hobby Cron Jobs run at most once per day, and Vercel Functions have a maximum execution duration; neither is suitable for an endless 30-second polling loop. Use Vercel for the dashboard and a persistent worker for continuous collection. If you collect locally instead, keep the computer awake and the collector process running.

## Before deploying

- Verify you are authorized to access the configured endpoint.
- Protect the app and collection endpoints before making them public; the current research app's API routes are not authenticated.
- Colour labels are only normalized if explicitly present in source fields. If the API omits colour, `normalizedColors` stays empty and the raw number/record is still preserved.
