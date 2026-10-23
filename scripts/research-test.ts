import { buildSummary, buildWalkForwardBacktest, type StoredRound } from "../lib/analysis";
import { auditRoundDocuments } from "../lib/data-quality";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Research self-test failed: ${message}`);
}

const base = new Date("2026-10-23T08:00:00.000Z");
const rounds: StoredRound[] = Array.from({ length: 60 }, (_, i) => ({
  periodId: String(20261023000000000 + i),
  resultNumber: i % 10,
  outcome: i % 10 >= 5 ? "BIG" : "SMALL",
  firstSeenAt: new Date(base.getTime() + i * 30_000),
  // Intentionally no settledAt: window analysis must not use firstSeenAt.
}));

const summary = buildSummary(rounds);
assert(summary.count === 60, "summary should retain valid rounds");
assert(summary.sourceTimestampCoverage.coverageRate === 0, "timestamp coverage should be zero when source times are absent");
assert(summary.targetWindow.count === 0, "target-window sample must exclude first-seen timestamps");
assert(summary.otherWindows.count === 0, "control-window sample must exclude first-seen timestamps");
assert(summary.fiveMinuteWindows.length === 0, "five-minute windows must be empty without source timestamps");

const backtest = buildWalkForwardBacktest(rounds, 50);
assert(backtest.evaluatedRounds === 10, "walk-forward test should begin after 50-round warm-up");
assert(backtest.models.every((m) => m.predictions === 10), "each baseline should score all test rounds");

const audit = auditRoundDocuments([
  { periodId: "100", resultNumber: 7, outcome: "SMALL", firstSeenAt: base, sourceTimestamp: null },
  { periodId: "100", resultNumber: 12, outcome: "BIG", firstSeenAt: base, sourceTimestamp: null },
  { periodId: "102", resultNumber: 3, outcome: "SMALL", firstSeenAt: base, sourceTimestamp: base, sourceTimestampField: "timestamp" },
]);
assert(audit.duplicatePeriodIdCount === 1, "audit should flag duplicate period IDs");
assert(audit.invalidNumberCount === 1, "audit should flag invalid digits");
assert(audit.inconsistentOutcomeCount === 1, "audit should flag mapping mismatch");
assert(audit.sourceTimestampCount === 1, "audit should count parseable source timestamps");
assert(audit.periodGapCheck.inferredMissingPeriodCount === 1, "audit should flag the heuristic numeric ID gap");

console.log("Research self-tests passed: timestamp gating, walk-forward warm-up, and data-integrity flags.");
