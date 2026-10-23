import { getDb } from "../lib/mongodb";
import { classifyNumber, extractColorMetadata, parseNumber, parsePeriod } from "../lib/types";

const CONFIGURED_HISTORY_URL = process.env.WINGO_HISTORY_URL;
const MODE = process.env.WINGO_GAME_MODE || "WinGo_30S";
const INTERVAL = Number(process.env.COLLECT_INTERVAL_MS || 30000);


async function collect() {
  const fetchedAt = new Date();
  const started = Date.now();
  let status = 0, recordsSeen = 0, inserted = 0, updated = 0, invalid = 0;
  let rawPayload: unknown = null;
  let error: string | null = null;

  try {
    // Keep the environment value local so TypeScript can narrow it safely.
    const historyUrl = CONFIGURED_HISTORY_URL;
    if (!historyUrl) throw new Error("Missing WINGO_HISTORY_URL in environment.");
    const response = await fetch(`${historyUrl}${historyUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`, {
      method: "GET", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" }
    });
    status = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rawPayload = await response.json();
    const list = (rawPayload as { data?: { list?: unknown } })?.data?.list;
    if (!Array.isArray(list)) throw new Error("Expected data.list array");
    recordsSeen = list.length;

    const db = await getDb();
    const collection = db.collection("Result");
    const seenAt = new Date();

    for (const item of list) {
      if (!item || typeof item !== "object") { invalid++; continue; }
      const row = item as Record<string, unknown>;
      const periodId = parsePeriod(row), resultNumber = parseNumber(row);
      if (!periodId || resultNumber === null) { invalid++; continue; }
      const rawTs = row.timestamp ?? row.settleTime ?? row.openTime ?? row.time;
      let sourceTimestamp: Date | null = null;
      const sourceTimestampField = row.timestamp !== undefined ? "timestamp"
        : row.settleTime !== undefined ? "settleTime"
        : row.openTime !== undefined ? "openTime"
        : row.time !== undefined ? "time" : null;
      if (rawTs !== undefined && rawTs !== null) {
        const d = typeof rawTs === "number" && rawTs < 1e12
          ? new Date(rawTs * 1000) : new Date(rawTs as any);
        if (!Number.isNaN(d.getTime())) sourceTimestamp = d;
      }
      const colorMetadata = extractColorMetadata(row);
      const filter = { provider: "ar-lottery01-reference", gameMode: MODE, periodId };
      const old = await collection.findOne(filter, { projection: { _id: 1, firstSeenAt: 1 } });
      await collection.updateOne(filter, {
        $set: {
          ...filter, resultNumber, outcome: classifyNumber(resultNumber),
          ...colorMetadata,
          sourceTimestamp,
          sourceTimestampField,
          sourceRecord: row, sourceFields: Object.keys(row),
          firstSeenAt: old?.firstSeenAt ?? seenAt, lastSeenAt: seenAt,
          lastFetchedAt: fetchedAt, updatedAt: new Date()
        },
        $setOnInsert: { createdAt: seenAt }
      }, { upsert: true });
      if (old) updated++; else inserted++;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown collector error";
    console.error(`[${fetchedAt.toISOString()}] collection failed:`, error);
  }

  try {
    const db = await getDb();
    await db.collection("ApiFetchLog").insertOne({
      fetchedAt, completedAt: new Date(), durationMs: Date.now() - started,
      sourceUrl: CONFIGURED_HISTORY_URL ?? null, gameMode: MODE, httpStatus: status, recordsSeen,
      inserted, updated, invalid, error, rawPayload
    });
  } catch (e) {
    console.error("Failed to write ApiFetchLog:", e);
  }
  console.log(JSON.stringify({ fetchedAt: fetchedAt.toISOString(), status, recordsSeen, inserted, updated, invalid, error }));
}

async function main() {
  const db = await getDb();
  await db.collection("Result").createIndex({ provider: 1, gameMode: 1, periodId: 1 }, { unique: true });
  await db.collection("Result").createIndex({ gameMode: 1, sourceTimestamp: -1, firstSeenAt: -1 });
  await db.collection("ApiFetchLog").createIndex({ gameMode: 1, fetchedAt: -1 });
  console.log(`Wingo collector starting. Mode=${MODE}, interval=${INTERVAL}ms`);
  await collect();
  setInterval(() => { void collect(); }, INTERVAL);
}

main().catch(err => { console.error(err); process.exit(1); });
