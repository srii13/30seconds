import type { Side } from "./types";

export type StoredRound = {
  periodId: string;
  resultNumber: number;
  outcome: Side;
  firstSeenAt: Date;
  settledAt?: Date;
};

const outcomeTime = (r: StoredRound) => (r.settledAt ?? r.firstSeenAt).getTime();
const rate = (wins: number, n: number) => n ? wins / n : null;

function sortRoundsForSequence(input: StoredRound[]) {
  const rounds = [...input];
  const allHaveSourceTimes = rounds.length > 0 && rounds.every(
    (r) => r.settledAt && Number.isFinite(r.settledAt.getTime()),
  );
  if (allHaveSourceTimes) {
    rounds.sort((a, b) => a.settledAt!.getTime() - b.settledAt!.getTime());
    return { rounds, chronologySource: "source_timestamp" as const };
  }
  const ids = rounds.map((r) => r.periodId);
  const numericFixedWidth = ids.length > 0 && ids.every(
    (id) => /^\d+$/.test(id) && id.length === ids[0].length,
  );
  if (numericFixedWidth) {
    rounds.sort((a, b) => {
      const aa = BigInt(a.periodId), bb = BigInt(b.periodId);
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });
    return { rounds, chronologySource: "numeric_period_id_inferred" as const };
  }
  rounds.sort((a, b) => outcomeTime(a) - outcomeTime(b));
  return { rounds, chronologySource: "first_seen_time_fallback_unverified" as const };
}

function timeParts(date: Date, timeZone = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute"), second: get("second") };
}

export function isTargetWindow(date: Date, timeZone = "Asia/Kolkata") {
  return timeParts(date, timeZone).minute % 10 >= 5;
}

export function getFiveMinuteWindow(date: Date, timeZone = "Asia/Kolkata") {
  const { hour, minute } = timeParts(date, timeZone);
  const start = Math.floor(minute / 5) * 5;
  const endMinute = start + 5;
  const endHour = hour + Math.floor(endMinute / 60);
  return `${String(hour).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}–${String(endHour % 24).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`;
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number, z = 1.96) {
  if (!n) return { low: null, high: null };
  const p = successes / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Chi-square statistic against a uniform ten-digit null. */
function digitChiSquare(counts: number[], n: number) {
  if (!n) return null;
  const expected = n / 10;
  return counts.reduce((sum, count) => sum + ((count - expected) ** 2 / expected), 0);
}

// Regularized upper incomplete gamma Q(a, x), Numerical Recipes-style approximation.
function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  const ITMAX = 200, EPS = 3e-14, FPMIN = 1e-300;
  const logGamma = (z: number): number => {
    const c = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
    let zz = z - 1, sum = 0.99999999999980993;
    for (let i = 0; i < c.length; i++) sum += c[i] / (zz + i + 1);
    const t = zz + c.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(sum);
  };
  const gln = logGamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let i = 1; i <= ITMAX; i++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return Math.max(0, Math.min(1, 1 - p));
  }
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / Math.max(FPMIN, b), h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const delta = d * c; h *= delta; if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - gln) * h));
}

function chiSquarePValue(statistic: number | null, degreesOfFreedom: number) {
  if (statistic === null || !Number.isFinite(statistic)) return null;
  return gammaQ(degreesOfFreedom / 2, statistic / 2);
}

function normalTwoSidedP(z: number | null) {
  if (z === null || !Number.isFinite(z)) return null;
  // Abramowitz-Stegun approximation to erfc(|z| / sqrt(2)).
  const x = Math.abs(z) / Math.sqrt(2), t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}

/** Approximate runs-test z score for a binary sequence. */
function runsTest(outcomes: Side[]) {
  const n1 = outcomes.filter(x => x === "BIG").length;
  const n2 = outcomes.length - n1;
  if (n1 < 2 || n2 < 2) return { runs: null, expectedRuns: null, zScore: null };
  let runs = 1;
  for (let i = 1; i < outcomes.length; i++) if (outcomes[i] !== outcomes[i - 1]) runs++;
  const n = n1 + n2;
  const expectedRuns = 1 + (2 * n1 * n2) / n;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  return { runs, expectedRuns, zScore: variance > 0 ? (runs - expectedRuns) / Math.sqrt(variance) : null };
}

function transitionSummary(outcomes: Side[]) {
  const counts = { bigToBig: 0, bigToSmall: 0, smallToBig: 0, smallToSmall: 0 };
  for (let i = 1; i < outcomes.length; i++) {
    const previous = outcomes[i - 1], current = outcomes[i];
    if (previous === "BIG" && current === "BIG") counts.bigToBig++;
    else if (previous === "BIG" && current === "SMALL") counts.bigToSmall++;
    else if (previous === "SMALL" && current === "BIG") counts.smallToBig++;
    else counts.smallToSmall++;
  }
  const bigAfterBigN = counts.bigToBig + counts.bigToSmall;
  const bigAfterSmallN = counts.smallToBig + counts.smallToSmall;
  return {
    counts,
    bigAfterBig: rate(counts.bigToBig, bigAfterBigN),
    bigAfterSmall: rate(counts.smallToBig, bigAfterSmallN),
    transitions: Math.max(0, outcomes.length - 1),
    switchRate: outcomes.length > 1 ? (counts.bigToSmall + counts.smallToBig) / (outcomes.length - 1) : null,
    repeatRate: outcomes.length > 1 ? (counts.bigToBig + counts.smallToSmall) / (outcomes.length - 1) : null,
  };
}

function streakSummary(outcomes: Side[]) {
  let currentSide: Side | null = null, currentLength = 0, maxBig = 0, maxSmall = 0;
  const lengths: number[] = [];
  for (const outcome of outcomes) {
    if (outcome === currentSide) currentLength++;
    else {
      if (currentLength) lengths.push(currentLength);
      currentSide = outcome;
      currentLength = 1;
    }
    if (outcome === "BIG") maxBig = Math.max(maxBig, currentLength);
    else maxSmall = Math.max(maxSmall, currentLength);
  }
  if (currentLength) lengths.push(currentLength);
  const histogram: Record<string, number> = {};
  for (const len of lengths) histogram[String(len)] = (histogram[String(len)] ?? 0) + 1;
  return { maxBig, maxSmall, runCount: lengths.length, lengthHistogram: histogram };
}

function windowStats(rounds: StoredRound[], timeZone: string) {
  // Time-window research must use provider-supplied settlement timestamps only.
  // First-seen timestamps describe collection time, not when a round settled.
  const groups = new Map<string, StoredRound[]>();
  for (const round of rounds) {
    if (!round.settledAt || !Number.isFinite(round.settledAt.getTime())) continue;
    const label = getFiveMinuteWindow(round.settledAt, timeZone);
    const bucket = groups.get(label) ?? [];
    bucket.push(round);
    groups.set(label, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([window, rows]) => {
    const big = rows.filter(r => r.outcome === "BIG").length;
    const ci = wilsonInterval(big, rows.length);
    return { window, count: rows.length, big, small: rows.length - big, bigRate: rate(big, rows.length), smallRate: rate(rows.length - big, rows.length), bigRate95CI: ci };
  });
}

function targetWindowStats(rounds: StoredRound[], timeZone: string) {
  // Target offsets 05–09, 15–19, 25–29, 35–39, 45–49 and 55–59.
  // Exclude rounds without authoritative source timestamps rather than silently
  // substituting first-observed time and biasing the target-window comparison.
  const timestamped = rounds.filter(r => r.settledAt && Number.isFinite(r.settledAt.getTime()));
  const target = timestamped.filter(r => isTargetWindow(r.settledAt!, timeZone));
  const other = timestamped.filter(r => !isTargetWindow(r.settledAt!, timeZone));
  const summarize = (rows: StoredRound[]) => {
    const big = rows.filter(r => r.outcome === "BIG").length;
    return { count: rows.length, big, small: rows.length - big, bigRate: rate(big, rows.length), smallRate: rate(rows.length - big, rows.length), bigRate95CI: wilsonInterval(big, rows.length) };
  };
  return { target: summarize(target), other: summarize(other), definition: "minute offsets 5–9 in each ten-minute block; excludes records without a parseable source timestamp" };
}

export function buildSummary(input: StoredRound[], timeZone = "Asia/Kolkata") {
  const validInput = [...input].filter(r => Number.isFinite(outcomeTime(r)));
  const { rounds: sorted } = sortRoundsForSequence(validInput);
  const n = sorted.length;
  const big = sorted.filter(r => r.outcome === "BIG").length;
  const small = n - big;
  const digits = Array.from({ length: 10 }, (_, digit) => {
    const count = sorted.filter(r => r.resultNumber === digit).length;
    const ci = wilsonInterval(count, n);
    return { digit, count, rate: rate(count, n), rate95CI: ci };
  });
  const outcomes = sorted.map(r => r.outcome);
  const transitions = transitionSummary(outcomes);
  const runs = runsTest(outcomes);
  const streaks = streakSummary(outcomes);
  const recent = sorted.slice(-20);
  const recentBig = recent.filter(r => r.outcome === "BIG").length;
  const missingSourceTimestampCount = sorted.filter(r => !r.settledAt).length;
  const pBigSmoothed = (big + 1) / (n + 2);
  const pSmallSmoothed = 1 - pBigSmoothed;
  const targetWindows = targetWindowStats(sorted, timeZone);
  return {
    count: n,
    big, small,
    bigRate: rate(big, n), smallRate: rate(small, n),
    bigRate95CI: wilsonInterval(big, n), smallRate95CI: wilsonInterval(small, n),
    digitFrequencies: digits,
    digitChiSquareUniform: digitChiSquare(digits.map(d => d.count), n),
    digitChiSquareUniformPApprox: chiSquarePValue(digitChiSquare(digits.map(d => d.count), n), 9),
    transitions,
    runsTest: { ...runs, pValueApprox: normalTwoSidedP(runs.zScore) },
    streaks,
    recentCount: recent.length,
    recentBig,
    recentSmall: recent.length - recentBig,
    targetWindow: targetWindows.target,
    otherWindows: targetWindows.other,
    targetWindowDefinition: targetWindows.definition,
    fiveMinuteWindows: windowStats(sorted, timeZone),
    timeWindowDataSource: missingSourceTimestampCount === n
      ? "UNAVAILABLE_NO_SOURCE_SETTLEMENT_TIMESTAMPS"
      : "SOURCE_SETTLEMENT_TIMESTAMPS_ONLY",
    descriptivePBig: pBigSmoothed,
    descriptivePSmall: pSmallSmoothed,
    sourceTimestampCoverage: { withSourceTimestamp: n - missingSourceTimestampCount, withoutSourceTimestamp: missingSourceTimestampCount, coverageRate: n ? (n - missingSourceTimestampCount) / n : null },
    confidenceStatus: n >= 200 ? "DESCRIPTIVE_ONLY_NEEDS_OUT_OF_SAMPLE_VALIDATION" : "INSUFFICIENT_DATA",
    confidenceNote: n >= 200
      ? "Smoothed historical frequency is not a calibrated forecast. No betting recommendation is generated."
      : "Collect more verified rounds. No predictive confidence claim is available yet.",
  };
}

/**
 * Strict walk-forward baselines. For each test round, prediction uses only earlier rounds.
 * The initial warm-up segment is excluded; no parameters are optimized on the test set.
 */
export function buildWalkForwardBacktest(rounds: StoredRound[], minTrain = 50) {
  const { rounds: sorted, chronologySource } = sortRoundsForSequence(rounds);
  const models = ["majority", "repeat-last", "reverse-last", "weighted-recent"] as const;
  const stats: Record<string, { predictions: number; correct: number; winsByProbability: Record<string, { n: number; correct: number }> }> = {};
  for (const model of models) stats[model] = { predictions: 0, correct: 0, winsByProbability: {} };
  for (let i = Math.max(2, minTrain); i < sorted.length; i++) {
    const history = sorted.slice(0, i);
    const actual = sorted[i].outcome;
    const bigCount = history.filter(r => r.outcome === "BIG").length;
    const smallCount = history.length - bigCount;
    const weighted = history.slice(-20).reduce((sum, r, idx, arr) => sum + (r.outcome === "BIG" ? 1 : -1) * (arr.length - idx), 0);
    const predictions: Record<(typeof models)[number], Side> = {
      majority: bigCount >= smallCount ? "BIG" : "SMALL",
      "repeat-last": history[history.length - 1].outcome,
      "reverse-last": history[history.length - 1].outcome === "BIG" ? "SMALL" : "BIG",
      "weighted-recent": weighted >= 0 ? "BIG" : "SMALL",
    };
    for (const model of models) {
      const s = stats[model];
      const correct = predictions[model] === actual;
      s.predictions++;
      if (correct) s.correct++;
    }
  }
  return {
    minTrainingRounds: minTrain,
    chronologySource,
    evaluatedRounds: Math.max(0, sorted.length - Math.max(2, minTrain)),
    models: models.map(model => ({
      model,
      predictions: stats[model].predictions,
      correct: stats[model].correct,
      accuracy: rate(stats[model].correct, stats[model].predictions),
      accuracy95CI: wilsonInterval(stats[model].correct, stats[model].predictions),
      note: "Historical walk-forward baseline only; not a live forecast and not proof of future profitability."
    })),
    limitations: [
      chronologySource === "source_timestamp"
        ? "Sequence order uses source-provided timestamps; confirm the field is authoritative for result order."
        : chronologySource === "numeric_period_id_inferred"
          ? "Sequence order is inferred from fixed-width numeric period IDs; verify that the provider guarantees IDs are sequential before trusting this backtest."
          : "Sequence order falls back to first-seen time and is not reliable when multiple rounds were first observed in the same fetch.",
      "The supplied data may be incomplete or biased by the API's history limit.",
      "Models are simple baselines; no model should be promoted without separate untouched evaluation and calibration."
    ]
  };
}
