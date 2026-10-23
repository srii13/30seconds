import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { classifyNumber, extractColorMetadata, parseNumber, parsePeriod } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const url = process.env.WINGO_HISTORY_URL;
  if (!url) return NextResponse.json({ error: "Missing WINGO_HISTORY_URL" }, { status: 500 });

  const fetchedAt = new Date();
  const started = Date.now();
  let response: Response | undefined;
  let payload: unknown;
  let error = "";

  try {
    response = await fetch(`${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    payload = await response.json();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown fetch error";
    try {
      const db = await getDb();
      await db.collection("ApiFetchLog").insertOne({
        fetchedAt, completedAt: new Date(), durationMs: Date.now() - started,
        sourceUrl: url, gameMode: process.env.WINGO_GAME_MODE || "WinGo_30S",
        httpStatus: response?.status ?? 0, recordsSeen: 0, inserted: 0, updated: 0,
        error, rawPayload: null
      });
    } catch { /* keep the original provider error visible */ }
    return NextResponse.json({ error, fetchedAt }, { status: 502 });
  }

  const list = (payload as { data?: { list?: unknown } } | null)?.data?.list;
  if (!Array.isArray(list)) {
    error = "Unexpected response schema: expected data.list array";
    const db = await getDb();
    await db.collection("ApiFetchLog").insertOne({
      fetchedAt, completedAt: new Date(), durationMs: Date.now() - started,
      sourceUrl: url, gameMode: process.env.WINGO_GAME_MODE || "WinGo_30S",
      httpStatus: response?.status ?? 200, recordsSeen: 0, inserted: 0, updated: 0,
      error, rawPayload: payload
    });
    return NextResponse.json({ error }, { status: 502 });
  }

  const db = await getDb();
  const results = db.collection("Result");
  const seenAt = new Date();
  let inserted = 0, updated = 0, invalid = 0;

  for (const item of list) {
    if (!item || typeof item !== "object") { invalid++; continue; }
    const row = item as Record<string, unknown>;
    const periodId = parsePeriod(row);
    const resultNumber = parseNumber(row);
    if (!periodId || resultNumber === null) { invalid++; continue; }

    // Preserve all source fields. A source timestamp is only accepted when explicitly present and parseable.
    const rawTimestamp = row.timestamp ?? row.settleTime ?? row.openTime ?? row.time;
    let sourceTimestamp: Date | null = null;
    if (rawTimestamp !== undefined && rawTimestamp !== null) {
      const candidate = typeof rawTimestamp === "number" && rawTimestamp < 1e12
        ? new Date(rawTimestamp * 1000) : new Date(rawTimestamp as any);
      if (!Number.isNaN(candidate.getTime())) sourceTimestamp = candidate;
    }

    const colorMetadata = extractColorMetadata(row);
    const filter = { provider: "ar-lottery01-reference", gameMode: process.env.WINGO_GAME_MODE || "WinGo_30S", periodId };
    const existing = await results.findOne(filter, { projection: { _id: 1, firstSeenAt: 1, resultNumber: 1 } });
    const doc = {
      ...filter,
      resultNumber,
      outcome: classifyNumber(resultNumber),
      ...colorMetadata,
      sourceTimestamp,
      sourceTimestampField: rawTimestamp === undefined ? null :
        (row.timestamp !== undefined ? "timestamp" : row.settleTime !== undefined ? "settleTime" : row.openTime !== undefined ? "openTime" : "time"),
      firstSeenAt: existing?.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
      lastFetchedAt: fetchedAt,
      sourceRecord: row,
      sourceFields: Object.keys(row),
      updatedAt: new Date()
    };
    await results.updateOne(filter, { $set: doc, $setOnInsert: { createdAt: seenAt } }, { upsert: true });
    if (!existing) inserted++; else updated++;
  }

  await db.collection("ApiFetchLog").insertOne({
    fetchedAt, completedAt: new Date(), durationMs: Date.now() - started,
    sourceUrl: url, gameMode: process.env.WINGO_GAME_MODE || "WinGo_30S",
    httpStatus: response.status, recordsSeen: list.length, inserted, updated, invalid,
    error: null, rawPayload: payload
  });

  return NextResponse.json({ ok: true, fetchedAt, recordsSeen: list.length, inserted, updated, invalid });
}
