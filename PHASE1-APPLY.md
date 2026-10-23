# Wingo Intelligence — Phase 1 Data Integrity Patch

This patch adds a data-integrity audit and makes time-window statistics conservative when timestamps are not verified.

## Apply to your existing project

1. Stop the dev server with `Ctrl+C`.
2. Extract this patch ZIP directly into your existing `E:\wingo-intelligence` folder, allowing files to be overwritten.
3. Keep your existing `.env.local` file. It is not included in this patch.
4. Run:

   ```powershell
   npm run research-test
   npm run typecheck
   npm run build
   ```

5. Restart with `npm run dev` and click **Collect latest API history**. The collector now records which source field supplied a timestamp.

## What changed

- Time-window statistics only use records whose timestamp came from the explicitly named `settleTime` source field. Generic `timestamp`, `openTime`, `time`, and first-observed times are not treated as confirmed settlement times.
- Sequence analysis uses source timestamps if every round has one; otherwise, fixed-width numeric period IDs are used as an explicitly labelled inferred ordering. If neither is available, first-seen time is labelled as an unverified fallback.
- New Data Integrity Audit panel flags duplicate IDs, invalid digits, Big/Small mapping mismatches, missing observation timestamps, source timestamp field coverage, and heuristic numeric-ID gaps.
- `npm run research-test` checks timestamp gating, walk-forward warm-up, and data-integrity flags using synthetic data. These tests do not verify the external provider API or MongoDB connection.

## Important interpretation note

A field named `settleTime` is only a candidate settlement timestamp until the data provider's schema/documentation confirms its meaning. If the provider does not supply a trustworthy settlement timestamp, time-window claims remain unavailable.
