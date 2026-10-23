# Wingo collector pagination and raw-data capture

This collector change:

- Requests page 1 immediately, then backfills pages 2 through `WINGO_MAX_BACKFILL_PAGES` once at startup.
- Polls page 1 every `COLLECT_INTERVAL_MS` after startup for new rounds.
- Stores the complete JSON payload for each successful page in `ApiFetchLog.rawPayload`.
- Stores the original source row, source field names, raw colour field(s), normalized colours, page metadata, and source `serviceTime` on each result.
- Stores a bounded error response body and HTTP metadata when a request fails, without attempting to parse an error page as JSON.
- Does not log query parameters in `sourceUrl` to reduce accidental exposure of URL tokens.

## Environment variables

- `WINGO_HISTORY_URL`: existing history endpoint URL.
- `WINGO_GAME_MODE`: optional; defaults to `WinGo_30S`.
- `COLLECT_INTERVAL_MS`: optional; defaults to `30000`.
- `WINGO_PAGE_SIZE`: optional; defaults to `10`.
- `WINGO_MAX_BACKFILL_PAGES`: optional; defaults to `50`.
- `WINGO_PAGE_DELAY_MS`: optional; defaults to `800` milliseconds between historical page requests.

The endpoint must support `pageNo` and `pageSize` query parameters. The collector may still receive HTTP 403 from a provider's access-control layer; this code does not bypass access restrictions. Resolve server-side access with the provider if hosted requests remain forbidden.

## Deploy

1. Replace `scripts/collector.ts` with the supplied file.
2. Commit and push the change to the GitHub repository.
3. Let Render redeploy the Background Worker.
4. Check logs for `status: 200`, nonzero `recordsSeen`, and `History backfill finished`.
5. Check MongoDB `Result` and `ApiFetchLog` collections.

If you need to limit the backfill, set `WINGO_MAX_BACKFILL_PAGES` to a lower value. Do not poll all historical pages every 30 seconds; only page 1 is polled continuously.
