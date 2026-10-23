export type Side = "BIG" | "SMALL";

export function classifyNumber(n: number): Side {
  // Configurable convention seen in the provided reference HTML; verify against the operator's rules.
  return n >= 5 ? "BIG" : "SMALL";
}

export function parsePeriod(row: Record<string, unknown>): string | null {
  const raw = row.issueNumber ?? row.period ?? row.issue;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return String(raw);
}

export function parseNumber(row: Record<string, unknown>): number | null {
  const n = Number(row.number);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}


/**
 * Extract explicit colour metadata without guessing colour from the result digit.
 * The original source record is stored separately, so unknown fields are preserved too.
 */
const COLOR_FIELD_NAMES = [
  "color", "colour", "colors", "colours",
  "resultColor", "result_color", "resultColour", "result_colour",
  "colorName", "color_name", "colourName", "colour_name",
  "lotteryColor", "lottery_color", "lotteryColour", "lottery_colour"
] as const;

export function extractColorMetadata(row: Record<string, unknown>): {
  sourceColorFields: Record<string, unknown>;
  normalizedColors: string[];
} {
  const sourceColorFields: Record<string, unknown> = {};
  const normalizedColors = new Set<string>();
  const colorPattern = /\b(red|green|violet|purple)\b/gi;

  for (const key of COLOR_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    sourceColorFields[key] = value;
    const text = typeof value === "string" ? value :
      Array.isArray(value) ? value.filter((part): part is string => typeof part === "string").join(" ") :
      typeof value === "number" ? String(value) : "";
    for (const match of text.matchAll(colorPattern)) {
      normalizedColors.add(match[1].toUpperCase());
    }
  }

  return { sourceColorFields, normalizedColors: [...normalizedColors] };
}
