
import { getDb } from "../lib/mongodb";
import {
  classifyNumber,
  extractColorMetadata,
  parseNumber,
  parsePeriod,
} from "../lib/types";

const HISTORY_URL = process.env.WINGO_HISTORY_URL;
const MODE = process.env.WINGO_GAME_MODE || "WinGo_30S";
const INTERVAL = Math.max(
  5000,
  Number(process.env.COLLECT_INTERVAL_MS || 30000)
);
const PAGE_SIZE = Math.max(
  1,
  Number(process.env.WINGO_PAGE_SIZE || 10)
);
const MAX_BACKFILL_PAGES = Math.max(
  1,
  Number(process.env.WINGO_MAX_BACKFILL_PAGES || 50)
);
const PAGE_DELAY_MS = Math.max(
  0,
  Number(process.env.WINGO_PAGE_DELAY_MS || 800)
);
const REQUEST_TIMEOUT_MS = 15000;

type RawRecord = Record<string, unknown>;

interface HistoryResponse {
  data?: {
    list?: unknown;
    pageNo?: number;
    totalPage?: number;
    totalCount?: number;
  };
  code?: number;
  msg?: string;
  msgCode?: number;
  serviceTime?: number;
  [key: string]: unknown;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildPageUrl(pageNo: number): string {
  if (!HISTORY_URL) {
    throw new Error("Missing WINGO_HISTORY_URL in environment.");
  }

  const url = new URL(HISTORY_URL);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("ts", String(Date.now()));

  return url.toString();
}

function sourceTimestamp(row: RawRecord): {
  timestamp: Date | null;
  field: string | null;
} {
  for (const field of [
    "timestamp",
    "settleTime",
    "openTime",
    "time",
  ]) {
    const value = row[field];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    let date: Date;

    if (typeof value === "number" || /^\d+$/.test(String(value))) {
      const number = Number(value);
      date = new Date(number < 1e12 ? number * 1000 : number);
    } else {
      date = new Date(String(value));
    }

    if (!Number.isNaN(date.getTime())) {
      return { timestamp: date, field };
    }
  }

  return { timestamp: null, field: null };
}

async function fetchPage(
  pageNo: number
): Promise<{ payload: HistoryResponse; status: number }> {
  const url = buildPageUrl(pageNo);

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
    },
  });

  const status = response.status;
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${status}; content-type=${
        response.headers.get("content-type") ?? "unknown"
      }; server=${
        response.headers.get("server") ?? "unknown"
      }; body=${text.slice(0, 300)}`
    );
  }

  let payload: HistoryResponse;

  try {
    payload = JSON.parse(text) as HistoryResponse;
  } catch {
    throw new Error("The history endpoint returned invalid JSON.");
  }

  if (!Array.isArray(payload?.data?.list)) {
    throw new Error("Expected data.list array in API response.");
  }

  return { payload, status };
}

async function saveFetchLog(log: Record<string, unknown>) {
  try {
    const db = await getDb();
    await db.collection("ApiFetchLog").insertOne(log);
  } catch (error) {
    console.error(
      "Failed to save API fetch log:",
      error instanceof Error ? error.message : error
    );
  }
}

async function saveRecords(
  rows: unknown[],
  fetchedAt: Date
): Promise<{ inserted: number; updated: number; invalid: number }> {
  const db = await getDb();
  const collection = db.collection("Result");
  const seenAt = new Date();

  let inserted = 0;
  let updated = 0;
  let invalid = 0;

  for (const item of rows) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    ) {
      invalid++;
      continue;
    }

    const row = item as RawRecord;
    const periodId = parsePeriod(row);
    const resultNumber = parseNumber(row);

    if (
      !periodId ||
      resultNumber === null ||
      !Number.isInteger(resultNumber) ||
      resultNumber < 0 ||
      resultNumber > 9
    ) {
      invalid++;
      continue;
    }

    const timestamp = sourceTimestamp(row);
    const colorMetadata = extractColorMetadata(row);

    const filter = {
      provider: "ar-lottery01-reference",
      gameMode: MODE,
      periodId,
    };

    const old = await collection.findOne(filter, {
      projection: { _id: 1, firstSeenAt: 1 },
    });

    await collection.updateOne(
      filter,
      {
        $set: {
          ...filter,
          resultNumber,
          outcome: classifyNumber(resultNumber),
          ...colorMetadata,
          sourceTimestamp: timestamp.timestamp,
          sourceTimestampField: timestamp.field,
          sourceRecord: row,
          sourceFields: Object.keys(row),
          firstSeenAt: old?.firstSeenAt ?? seenAt,
          lastSeenAt: seenAt,
          lastFetchedAt: fetchedAt,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: seenAt },
      },
      { upsert: true }
    );

    if (old) updated++;
    else inserted++;
  }

  return { inserted, updated, invalid };
}

async function collectPage(pageNo: number): Promise<{
  totalPages: number;
  recordsSeen: number;
}> {
  const fetchedAt = new Date();
  const started = Date.now();

  let status = 0;
  let rawPayload: unknown = null;
  let recordsSeen = 0;
  let inserted = 0;
  let updated = 0;
  let invalid = 0;
  let error: string | null = null;
  let totalPages = 1;

  try {
    const result = await fetchPage(pageNo);
    status = result.status;
    rawPayload = result.payload;

    const data = result.payload.data!;
    const rows = data.list as unknown[];

    recordsSeen = rows.length;
    totalPages =
      typeof data.totalPage === "number" && data.totalPage > 0
        ? data.totalPage
        : 1;

    const saved = await saveRecords(rows, fetchedAt);
    inserted = saved.inserted;
    updated = saved.updated;
    invalid = saved.invalid;
  } catch (cause) {
    error =
      cause instanceof Error ? cause.message : "Unknown collection error";

    console.error(
      `[${fetchedAt.toISOString()}] page=${pageNo} collection failed: ${error}`
    );
  }

  await saveFetchLog({
    fetchedAt,
    completedAt: new Date(),
    durationMs: Date.now() - started,
    sourceUrl: HISTORY_URL ?? null,
    gameMode: MODE,
    pageNo,
    httpStatus: status,
    recordsSeen,
    inserted,
    updated,
    invalid,
    error,
    rawPayload,
  });

  console.log(
    JSON.stringify({
      fetchedAt: fetchedAt.toISOString(),
      pageNo,
      status,
      recordsSeen,
      inserted,
      updated,
      invalid,
      error,
    })
  );

  if (error) {
    throw new Error(error);
  }

  return { totalPages, recordsSeen };
}

async function backfillHistory(): Promise<void> {
  console.log("Starting historical backfill...");

  const first = await collectPage(1);
  const pagesToFetch = Math.min(
    first.totalPages,
    MAX_BACKFILL_PAGES
  );

  let totalRecordsSeen = first.recordsSeen;

  for (let pageNo = 2; pageNo <= pagesToFetch; pageNo++) {
    await sleep(PAGE_DELAY_MS);

    try {
      const result = await collectPage(pageNo);
      totalRecordsSeen += result.recordsSeen;
    } catch (error) {
      console.error(
        `Backfill stopped at page ${pageNo}:`,
        error instanceof Error ? error.message : error
      );
      return;
    }
  }

  console.log(
    `Historical backfill finished. Pages=${pagesToFetch}, recordsSeen=${totalRecordsSeen}`
  );
}

async function main(): Promise<void> {
  if (!HISTORY_URL) {
    throw new Error("Set WINGO_HISTORY_URL in Render environment variables.");
  }

  if (!Number.isFinite(INTERVAL)) {
    throw new Error("COLLECT_INTERVAL_MS must be a valid number.");
  }

  const db = await getDb();

  await db.collection("Result").createIndex(
    { provider: 1, gameMode: 1, periodId: 1 },
    { unique: true }
  );

  await db.collection("Result").createIndex({
    gameMode: 1,
    sourceTimestamp: -1,
    firstSeenAt: -1,
  });

  await db.collection("ApiFetchLog").createIndex({
    gameMode: 1,
    fetchedAt: -1,
  });

  console.log(
    `Wingo collector starting. Mode=${MODE}, interval=${INTERVAL}ms`
  );

  try {
    await backfillHistory();
  } catch (error) {
    console.error(
      "Initial backfill failed:",
      error instanceof Error ? error.message : error
    );
  }

  // Keep polling page 1, without overlapping collection attempts.
  while (true) {
    try {
      await collectPage(1);
    } catch {
      // The detailed error has already been logged.
    }

    await sleep(INTERVAL);
  }
}

main().catch((error: unknown) => {
  console.error(
    "Collector startup failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
