# Wingo Intelligence — research-first implementation

A private research dashboard for collecting Wingo 30-second result history, analysing descriptive patterns, comparing simple walk-forward baselines, and recording paper predictions before target results are known.

## Implemented in this version

- MongoDB `Result` collection with a unique key on provider, game mode, and period ID.
- `ApiFetchLog` audit collection for polling status, latency, record counts, and raw response payloads.
- Collector worker that fetches once at startup and then polls at the configured interval.
- Data summaries: Big/Small counts and rates, Wilson 95% intervals, digit distribution (0–9), digit chi-square statistic and approximate p-value, transition probabilities, switch/repeat rate, streak lengths, and runs-test statistics.
- Time-window analysis in the configured timezone, including the proposed second-five-minute offsets (05–09, 15–19, 25–29, 35–39, 45–49, 55–59) and all observed five-minute clock buckets.
- Chronological walk-forward baseline comparisons: historical majority, repeat-last, reverse-last, and weighted-recent-20. Each prediction uses only earlier records.
- Paper-prediction ledger: users can record forecasts against an upcoming target period; a prediction is rejected if the result is already stored, helping avoid hindsight bias. Pending forecasts are resolved when their target result appears in `Result`.
- Dashboard with data counts, timestamp coverage, statistical analysis tables, baseline evaluation, API logs, and paper prediction scorecards.
- Data-integrity audit for duplicate period IDs, invalid digits, Big/Small mapping inconsistencies, missing observation timestamps, source timestamp field coverage, and cautious numeric-period gap heuristics.
- Time-window statistics now exclude records without a parseable source-provided timestamp. First-seen/collector timestamps are not substituted for settlement time in time-window analysis.
- `npm run research-test` runs deterministic synthetic checks for timestamp gating, round classification integrity, and baseline warm-up behavior.

## Critical limitations

1. This is a research and paper-testing tool, not an automated betting system. It does not place bets, tell users when to wager, or promise a win rate.
2. The history URL was found in user-supplied HTML. Its official status, authorization, reliability, schema, and historical pagination have not been independently verified. Confirm that access is permitted before using it.
3. The API may only return a limited recent history. A historical backfill requires a supported, authorized pagination/export mechanism.
4. A fetch/first-seen timestamp is not the actual result time. Time-window analysis excludes records without parseable source timestamps. Even a parseable field must be verified as settlement time rather than draw/open time before time-window claims are meaningful.
5. The `5–9 = BIG`, `0–4 = SMALL` mapping comes from the reference HTML and must be verified against the specific game rules.
6. Chi-square and runs-test p-values are exploratory approximations. They do not correct for testing many windows/features, establish causation, or prove future predictability. Review expected counts and independence assumptions before interpreting them.
7. The walk-forward models are intentionally simple baselines. Their historical accuracy is not calibrated probability and is not evidence of profitability. A separate untouched evaluation period and calibration are required before any model can be described as predictive.
8. Paper prediction target period IDs must be entered manually. Do not record a prediction after the target outcome has become available.
9. The API routes are not authenticated. Keep the app local/private; add authentication, authorization, rate limiting, request validation, and production secrets management before public deployment.
10. Full Next.js build and live API/Atlas integration were not verified in this environment because package installation could not reach the npm registry. The pure analysis module was compiled and exercised against a synthetic dataset.

## Requirements

- Node.js 20+
- MongoDB Atlas database/user
- Network access to an authorized history endpoint

## Setup

```bash
npm install
cp .env.example .env.local
```

Set `MONGODB_URI`, `MONGODB_DB`, `WINGO_HISTORY_URL`, `WINGO_GAME_MODE`, and `TIME_ZONE` in `.env.local`. Do not commit secrets.

Start the web app:

```bash
npm run dev
```

In a second terminal, start the persistent collector:

```bash
npm run collector
```

The worker performs an immediate fetch and then polls at `COLLECT_INTERVAL_MS` (default 30,000 ms). A serverless web deployment will not keep this worker alive automatically; use a persistent worker/host if continuous collection is required.

## MongoDB collections

### `Result`
One canonical record per `{ provider, gameMode, periodId }`. Stores the result number, Big/Small classification, original source record, source fields, source timestamp when found, first-seen/last-seen/last-fetched times.

### `ApiFetchLog`
One record per fetch attempt, including timing, HTTP status, records seen, inserts/updates, invalid records, error, and raw payload. Raw payload retention can increase database storage costs.

### `Prediction`
An immutable-at-creation paper forecast for a target period. It stores the creation time, source latest period, training sample size, model version, baseline directions, and later actual result/correctness. It is not a real-money betting ledger.

## API routes

- `POST /api/collect` — perform one fetch and store returned records.
- `GET /api/summary` — summary, recent rounds, and fetch logs.
- `GET /api/analysis` — detailed statistics, window tables, data-quality metrics, and walk-forward baseline results.
- `GET /api/predictions` — paper-prediction ledger, resolves pending entries when target results are available, and returns model scorecards.
- `POST /api/predictions` — body `{ "targetPeriodId": "..." }`; records directional baseline forecasts only if the target result is not already stored and at least 50 valid rounds exist.

## Next milestones

1. Configure Atlas and run a real collection; inspect schema and source timestamp fields.
2. Validate missing-period detection and supported historical pagination/backfill.
3. Add automated tests for source parsing, timezones, statistical functions, and API contracts.
4. Add a separate untouched evaluation period and calibration diagnostics (Brier score, reliability bins, confidence intervals).
5. Add multiple-testing correction and resampling/Monte Carlo checks for the pre-registered window hypothesis.
6. Add authentication, rate limiting, data retention policies, and deployment monitoring before any public deployment.
