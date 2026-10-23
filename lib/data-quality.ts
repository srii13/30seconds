import { classifyNumber } from "./types";

export type RawRoundForAudit = {
  periodId?: unknown;
  resultNumber?: unknown;
  outcome?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  sourceTimestamp?: unknown;
  sourceTimestampField?: unknown;
  sourceFields?: unknown;
};

function validDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

/**
 * Audits stored source rows without silently repairing or deleting them.
 * Numeric period-gap checks are heuristic, and are only calculated when IDs
 * are same-width numeric strings that fit within JavaScript's safe integer range.
 */
export function auditRoundDocuments(rows: RawRoundForAudit[]) {
  const periodIds = rows.map((row) => String(row.periodId ?? "")).filter(Boolean);
  const counts = new Map<string, number>();
  for (const id of periodIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const duplicateIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([periodId, count]) => ({ periodId, count }));

  const invalidPeriodIdCount = rows.filter((row) => !String(row.periodId ?? "").trim()).length;
  const invalidNumberCount = rows.filter((row) => {
    const n = Number(row.resultNumber);
    return !Number.isInteger(n) || n < 0 || n > 9;
  }).length;
  const inconsistentOutcomeCount = rows.filter((row) => {
    const n = Number(row.resultNumber);
    return Number.isInteger(n) && n >= 0 && n <= 9 && row.outcome !== classifyNumber(n);
  }).length;
  const missingFirstSeenCount = rows.filter((row) => !validDate(row.firstSeenAt)).length;
  const withSourceTimestamp = rows.filter((row) => validDate(row.sourceTimestamp)).length;
  const sourceTimestampFieldCounts: Record<string, number> = {};

  for (const row of rows) {
    if (!validDate(row.sourceTimestamp)) continue;
    const field = typeof row.sourceTimestampField === "string" && row.sourceTimestampField
      ? row.sourceTimestampField
      : "field_not_recorded";
    sourceTimestampFieldCounts[field] = (sourceTimestampFieldCounts[field] ?? 0) + 1;
  }

  const allNumericFixedWidth = periodIds.length > 1 && periodIds.every(
    (id) => /^\d+$/.test(id) && id.length === periodIds[0].length,
  );
  let inferredMissingPeriodCount: number | null = null;
  let gapCheckSkippedForPrecision = false;

  if (allNumericFixedWidth) {
    const uniqueIds = [...new Set(periodIds)];
    const numericIds = uniqueIds.map(Number);
    if (numericIds.every(Number.isSafeInteger)) {
      numericIds.sort((a, b) => a - b);
      let gaps = 0;
      for (let i = 1; i < numericIds.length; i++) {
        const delta = numericIds[i] - numericIds[i - 1];
        // Heuristic only: provider period IDs may not be consecutive integers.
        if (delta > 1) gaps += delta - 1;
      }
      inferredMissingPeriodCount = gaps;
    } else {
      gapCheckSkippedForPrecision = true;
    }
  }

  const invalidStoredRows = rows.filter((row) => {
    const id = String(row.periodId ?? "").trim();
    const n = Number(row.resultNumber);
    const validNumber = Number.isInteger(n) && n >= 0 && n <= 9;
    const badOutcome = validNumber && row.outcome !== classifyNumber(n);
    return !id || !validNumber || badOutcome || !validDate(row.firstSeenAt);
  }).length;

  const warnings: string[] = [];
  if (duplicateIds.length) warnings.push("Duplicate period IDs exist in the queried records.");
  if (invalidPeriodIdCount) warnings.push("Some stored records have a missing period ID.");
  if (invalidNumberCount) warnings.push("Some stored result numbers are outside the valid digit range 0–9.");
  if (inconsistentOutcomeCount) warnings.push("Some stored Big/Small labels disagree with the configured digit mapping.");
  if (withSourceTimestamp < rows.length) warnings.push("Some records lack a parseable provider-supplied timestamp; time-window analysis excludes them.");
  if (inferredMissingPeriodCount !== null && inferredMissingPeriodCount > 0) {
    warnings.push("Numeric period IDs suggest possible gaps; confirm the provider's ID semantics before treating these as missing rounds.");
  }
  if (!allNumericFixedWidth) {
    warnings.push("Missing-period inference was skipped because period IDs are not all same-width numeric strings.");
  } else if (gapCheckSkippedForPrecision) {
    warnings.push("Missing-period inference was skipped because period IDs exceed JavaScript's safe integer precision.");
  }

  return {
    queriedRows: rows.length,
    uniquePeriodIds: new Set(periodIds).size,
    duplicatePeriodIdCount: duplicateIds.length,
    duplicatePeriodIds: duplicateIds.slice(0, 20),
    invalidPeriodIdCount,
    invalidNumberCount,
    inconsistentOutcomeCount,
    missingFirstSeenCount,
    sourceTimestampCount: withSourceTimestamp,
    sourceTimestampCoverage: rows.length ? withSourceTimestamp / rows.length : null,
    sourceTimestampFieldCounts,
    periodGapCheck: {
      method: allNumericFixedWidth && !gapCheckSkippedForPrecision ? "numeric_id_heuristic" : "not_run",
      inferredMissingPeriodCount,
      warning: "This estimate is not proof of missing rounds until the provider confirms period IDs are sequential."
    },
    invalidStoredRows,
    warnings,
    status: warnings.length ? "REVIEW_WARNINGS" : "NO_BASIC_INTEGRITY_WARNINGS",
  };
}
