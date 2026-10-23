import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { buildSummary, buildWalkForwardBacktest, type StoredRound } from "@/lib/analysis";
import { auditRoundDocuments } from "@/lib/data-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const mode = process.env.WINGO_GAME_MODE || "WinGo_30S";
    const timeZone = process.env.TIME_ZONE || "Asia/Kolkata";
    const raw = await db.collection("Result")
      .find({ gameMode: mode }, { projection: { periodId: 1, resultNumber: 1, outcome: 1, firstSeenAt: 1, lastSeenAt: 1, sourceTimestamp: 1, sourceTimestampField: 1, sourceFields: 1 } })
      .limit(50000).toArray();
    const rounds: StoredRound[] = raw.map((r: any) => ({
      periodId: String(r.periodId),
      resultNumber: Number(r.resultNumber),
      outcome: r.outcome,
      firstSeenAt: new Date(r.firstSeenAt),
      // Only the explicitly named settleTime field is eligible for settlement-time
      // analysis. Other source fields (timestamp/openTime/time) are not assumed equivalent.
      settledAt: r.sourceTimestamp && r.sourceTimestampField === "settleTime" ? new Date(r.sourceTimestamp) : undefined,
    })).filter(r => Number.isInteger(r.resultNumber) && r.resultNumber >= 0 && r.resultNumber <= 9 && (r.outcome === "BIG" || r.outcome === "SMALL") && !Number.isNaN(r.firstSeenAt.getTime()));
    // Analysis uses chronological order; period IDs are not assumed to be safely incrementable.
    rounds.sort((a, b) => (a.settledAt ?? a.firstSeenAt).getTime() - (b.settledAt ?? b.firstSeenAt).getTime());
    return NextResponse.json({
      summary: buildSummary(rounds, timeZone),
      backtest: buildWalkForwardBacktest(rounds),
      dataQuality: {
        requestedGameMode: mode,
        roundsLoaded: rounds.length,
        uniquePeriodsInQuery: new Set(rounds.map(r => r.periodId)).size,
        timeZone,
        sourceTimestampCoverage: rounds.length ? rounds.filter(r => r.settledAt).length / rounds.length : null,
        warning: "No result is considered predictable merely because it appears in a pattern. Walk-forward baselines are exploratory and do not establish a profitable edge.",
        audit: auditRoundDocuments(raw as Array<Record<string, unknown>>)
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
