import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { Side } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function outcome(number: number): Side { return number >= 5 ? "BIG" : "SMALL"; }

function createBaselines(history: { periodId: string; resultNumber: number; outcome: Side }[]) {
  const big = history.filter(r => r.outcome === "BIG").length;
  const small = history.length - big;
  const last = history[history.length - 1];
  const recent = history.slice(-20);
  const weightedScore = recent.reduce((sum, row, index) => sum + (row.outcome === "BIG" ? 1 : -1) * (recent.length - index), 0);
  return [
    { model: "historical-majority", prediction: big >= small ? "BIG" : "SMALL", probability: null, note: "Direction only; probability not calibrated." },
    { model: "repeat-last", prediction: last.outcome, probability: null, note: "Naive baseline; no proven predictive edge." },
    { model: "reverse-last", prediction: last.outcome === "BIG" ? "SMALL" : "BIG", probability: null, note: "Naive baseline; no proven predictive edge." },
    { model: "weighted-recent-20", prediction: weightedScore >= 0 ? "BIG" : "SMALL", probability: null, note: "Exploratory heuristic; probability not calibrated." },
  ];
}

export async function GET() {
  try {
    const db = await getDb();
    const mode = process.env.WINGO_GAME_MODE || "WinGo_30S";
    const predictions = await db.collection("Prediction").find({ gameMode: mode }).sort({ createdAt: -1 }).limit(100).toArray();
    const targetIds = [...new Set(predictions.filter((p: any) => p.status === "PENDING").map((p: any) => p.targetPeriodId))];
    if (targetIds.length) {
      const settled = await db.collection("Result").find({ gameMode: mode, periodId: { $in: targetIds } }).toArray();
      for (const result of settled) {
        const actualOutcome = result.outcome as Side;
        const matching = predictions.filter((p: any) => p.targetPeriodId === String(result.periodId) && p.status === "PENDING");
        for (const prediction of matching) {
          const resolvedModels = prediction.models.map((m: any) => ({ ...m, actual: actualOutcome, correct: m.prediction === actualOutcome }));
          await db.collection("Prediction").updateOne({ _id: prediction._id, status: "PENDING" }, { $set: { status: "RESOLVED", actualOutcome, actualNumber: result.resultNumber, resolvedAt: new Date(), models: resolvedModels } });
          prediction.status = "RESOLVED"; prediction.actualOutcome = actualOutcome; prediction.actualNumber = result.resultNumber; prediction.resolvedAt = new Date(); prediction.models = resolvedModels;
        }
      }
    }
    const refreshed = await db.collection("Prediction").find({ gameMode: mode }).sort({ createdAt: -1 }).limit(100).toArray();
    const resolved = refreshed.filter((p: any) => p.status === "RESOLVED");
    const modelNames = ["historical-majority", "repeat-last", "reverse-last", "weighted-recent-20"];
    const modelScorecard = modelNames.map(model => {
      const evaluated = resolved.flatMap((p: any) => p.models.filter((m: any) => m.model === model && typeof m.correct === "boolean"));
      const correct = evaluated.filter((m: any) => m.correct).length;
      return { model, predictions: evaluated.length, correct, accuracy: evaluated.length ? correct / evaluated.length : null };
    });
    return NextResponse.json({ predictions: refreshed.map((p: any) => ({
      id: String(p._id), targetPeriodId: p.targetPeriodId, createdAt: p.createdAt, sourceLatestPeriodId: p.sourceLatestPeriodId,
      trainingCount: p.trainingCount, status: p.status, actualOutcome: p.actualOutcome, actualNumber: p.actualNumber,
      resolvedAt: p.resolvedAt, models: p.models,
    })), modelScorecard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prediction ledger unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetPeriodId = String(body?.targetPeriodId ?? "").trim();
    if (!targetPeriodId || targetPeriodId.length > 100) {
      return NextResponse.json({ error: "Provide the target period ID to track. Use the upcoming period, not a result already known." }, { status: 400 });
    }
    const db = await getDb();
    const mode = process.env.WINGO_GAME_MODE || "WinGo_30S";
    const existingResult = await db.collection("Result").findOne({ gameMode: mode, periodId: targetPeriodId });
    if (existingResult) return NextResponse.json({ error: "That period already has a stored result. To avoid hindsight bias, predictions can only be recorded before the target result is available." }, { status: 409 });
    const existingPrediction = await db.collection("Prediction").findOne({ gameMode: mode, targetPeriodId });
    if (existingPrediction) return NextResponse.json({ error: "A paper prediction already exists for that target period." }, { status: 409 });
    const raw = await db.collection("Result").find({ gameMode: mode }).limit(50000).toArray();
    const history = raw.map((r: any) => ({ periodId: String(r.periodId), resultNumber: Number(r.resultNumber), outcome: r.outcome as Side, settledAt: r.sourceTimestamp ? new Date(r.sourceTimestamp) : new Date(r.firstSeenAt) }))
      .filter((r: any) => Number.isInteger(r.resultNumber) && r.resultNumber >= 0 && r.resultNumber <= 9 && (r.outcome === "BIG" || r.outcome === "SMALL"))
      .sort((a: any, b: any) => a.settledAt.getTime() - b.settledAt.getTime());
    if (history.length < 50) return NextResponse.json({ error: `At least 50 valid historical rounds are required for a baseline paper prediction. Current sample: ${history.length}.` }, { status: 422 });
    const models = createBaselines(history);
    const record = {
      gameMode: mode, targetPeriodId, createdAt: new Date(), status: "PENDING",
      sourceLatestPeriodId: history[history.length - 1].periodId,
      trainingCount: history.length, models,
      methodVersion: "baseline-paper-ledger-v1",
      warning: "Research-only directional baselines. No calibrated probability or betting recommendation is produced."
    };
    await db.collection("Prediction").createIndex({ gameMode: 1, targetPeriodId: 1 }, { unique: true });
    const inserted = await db.collection("Prediction").insertOne(record);
    return NextResponse.json({ ok: true, id: String(inserted.insertedId), ...record }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) return NextResponse.json({ error: "A paper prediction already exists for that target period." }, { status: 409 });
    const message = error instanceof Error ? error.message : "Could not create paper prediction";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
