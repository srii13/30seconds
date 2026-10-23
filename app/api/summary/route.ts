import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { buildSummary, type StoredRound } from "@/lib/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const mode = process.env.WINGO_GAME_MODE || "WinGo_30S";
    const roundsRaw = await db.collection("Result")
      .find({ gameMode: mode }, { projection: { periodId: 1, resultNumber: 1, outcome: 1, firstSeenAt: 1, sourceTimestamp: 1, sourceTimestampField: 1, lastSeenAt: 1 } })
      .sort({ sourceTimestamp: -1, firstSeenAt: -1 })
      .limit(20000).toArray();

    const rounds: StoredRound[] = roundsRaw.map((r: any) => ({
      periodId: String(r.periodId),
      resultNumber: Number(r.resultNumber),
      outcome: r.outcome,
      firstSeenAt: new Date(r.firstSeenAt),
      // Do not treat generic timestamp/openTime fields as confirmed settlement times.
      settledAt: r.sourceTimestamp && r.sourceTimestampField === "settleTime" ? new Date(r.sourceTimestamp) : undefined
    })).filter(r => Number.isInteger(r.resultNumber) && r.resultNumber >= 0 && r.resultNumber <= 9 && (r.outcome === "BIG" || r.outcome === "SMALL"));

    const summary = buildSummary(rounds);
    const recent = await db.collection("Result").find({ gameMode: mode })
      .sort({ sourceTimestamp: -1, firstSeenAt: -1 }).limit(50).toArray();
    const fetches = await db.collection("ApiFetchLog").find({ gameMode: mode })
      .sort({ fetchedAt: -1 }).limit(10).toArray();

    return NextResponse.json({
      summary,
      recent: recent.map((r: any) => ({
        periodId: String(r.periodId), resultNumber: r.resultNumber, outcome: r.outcome,
        firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, sourceTimestamp: r.sourceTimestamp
      })),
      fetches: fetches.map((f: any) => ({
        fetchedAt: f.fetchedAt, httpStatus: f.httpStatus, recordsSeen: f.recordsSeen, error: f.error
      })),
      config: { gameMode: mode, timeZone: process.env.TIME_ZONE || "Asia/Kolkata" }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
