
import { getDb } from "../lib/mongodb";
import {
  classifyNumber,
  extractColorMetadata,
  parseNumber,
  parsePeriod,
} from "../lib/types";

const CONFIGURED_HISTORY_URL = process.env.WINGO_HISTORY_URL;
const MODE = process.env.WINGO_GAME_MODE || "WinGo_30S";
const INTERVAL = Math.max(
  5000,
  Number(process.env.COLLECT_INTERVAL_MS || 30000)
);
const REQUEST_TIMEOUT_MS = 15000;

type RawRecord = Record<string, unknown>;

function getSourceTimestamp(row: RawRecord): {
  timestamp: Date | null;
  field: string | null;
} {
  const candidates = [
    "timestamp",
    "settleTime",
    "openTime",
    "time",
  ] as const;

  for (const field of candidates) {
    const value = row[field];

    if (value === undefined || value === null || value === "") {
      continue;
    }

    let date: Date;

    if (typeof value === "number") {
      date = new Date(value < 1e12 ? value * 1000 : value);
    } else if (typeof value === "string") {
      const numeric = /^\d+$/.test(value) ? Number(value) : NaN;

      date = Number.isFinite(numeric)
        ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
        : new Date(value);
    } else {
      continue;
    }

    if (!Number.isNaN(date.getTime())) {
      return { timestamp: date, field };
    }
  }

  return { timestamp: null, field: null };
}

async function collect(): Promise<void> {
  const fetchedAt = new Date();
  const started = Date.now();

  let status = 0;
  let recordsSeen = 0;
  let inserted = 0;
  let updated = 0;
  let invalid = 0;
  let rawPayload: unknown = null;
  let error: string | null = null;

  try {
    const historyUrl = CONFIGURED_HISTORY_URL;

    if (!historyUrl) {
      throw new Error("Missing WINGO_HISTORY_URL environment variable.");
    }

    const separator = historyUrl.includes("?") ? "&" : "?";
    const requestUrl = `${historyUrl}${separator}ts=${Date.now()}`;

    const response = await fetch(requestUrl, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        "User-Agent": "WingoIntelligence/1.0",
      },
    });

    status = response.status;

    const responseText = await response.text();
    const contentType = response.headers.get("content-type");
    const server = response.headers.get("server");

    if (!response.ok) {
      // Keep a bounded response body for diagnosing HTTP errors.
      rawPayload = {
        body: responseText.slice(0, 5000),
        contentType,
        server,
      };

      throw new Error(
        `HTTP ${status}; content-type=${contentType ?? "unknown"}; ` +
          `server=${server ?? "unknown"}; ` +
          `body=${responseText.slice(0, 500)}`
      );
    }

    try {
      rawPayload = JSON.parse(responseText);
    } catch {
      rawPayload = { body: responseText.slice(0, 5000), contentType };
      throw new Error(
        `Source returned invalid JSON; content-type=${contentType ?? "unknown"}`
      );
    }

    const payload = rawPayload as {
      data?: { list?: unknown };
    };

    const list = payload?.data?.list;

    if (!Array.isArray(list)) {
      throw new Error(
        "Expected data.list array. The response was archived in ApiFetchLog."
      );
    }

    recordsSeen = list.length;

    const db = await getDb();
    const collection = db.collection("Result");
    const seenAt = new Date();

    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
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

      const { timestamp: sourceTimestamp, field: sourceTimestampField } =
        getSourceTimestamp(row);

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

            // Original source metadata is retained separately.
            sourceTimestamp,
            sourceTimestampField,
            sourceRecord: row,
            sourceFields: Object.keys(row),

            firstSeenAt: old?.firstSeenAt ?? seenAt,
            lastSeenAt: seenAt,
            lastFetchedAt: fetchedAt,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: seenAt,
          },
        },
        { upsert: true }
      );

      if (old) {
        updated++;
      } else {
        inserted++;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown collector error";

    console.error(
      `[${fetchedAt.toISOString()}] collection failed: ${error}`
    );
  }

  try {
    const db = await getDb();

    await db.collection("ApiFetchLog").insertOne({
      fetchedAt,
      completedAt: new Date(),
      durationMs: Date.now() - started,
      sourceUrl: CONFIGURED_HISTORY_URL ?? null,
      gameMode: MODE,
      httpStatus: status,
      recordsSeen,
      inserted,
      updated,
      invalid,
      error,
      rawPayload,
    });
  } catch (e) {
    console.error(
      "Failed to write ApiFetchLog:",
      e instanceof Error ? e.message : e
    );
  }

  console.log(
    JSON.stringify({
      fetchedAt: fetchedAt.toISOString(),
      status,
      recordsSeen,
      inserted,
      updated,
      invalid,
      error,
    })
  );
}

async function main(): Promise<void> {
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

  // Wait until each collection attempt finishes before scheduling the next.
  const runLoop = async (): Promise<void> => {
    await collect();
    setTimeout(() => {
      void runLoop();
    }, INTERVAL);
  };

  await runLoop();
}

main().catch((err: unknown) => {
  console.error(
    "Collector startup failed:",
    err instanceof Error ? err.message : err
  );
  process.exit(1);
});
