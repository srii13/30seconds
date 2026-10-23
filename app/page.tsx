"use client";

import { useCallback, useEffect, useState } from "react";

type Round = {
  periodId: string; resultNumber: number; outcome: "BIG"|"SMALL";
  firstSeenAt: string; lastSeenAt: string; settledAt?: string;
};
type Summary = {
  count:number; big:number; small:number; bigRate:number|null; smallRate:number|null;
  recentCount:number; recentBig:number; recentSmall:number;
  targetWindow:{count:number;bigRate:number|null;smallRate:number|null};
  otherWindows:{count:number;bigRate:number|null;smallRate:number|null};
  transitions:Record<string,number>; confidenceStatus:string; confidenceNote:string;
  descriptivePBig:number; descriptivePSmall:number;
};
type Data = { summary:Summary; recent:Round[]; fetches:{fetchedAt:string;httpStatus:number;recordsSeen:number;error?:string}[]; config:{gameMode:string;timeZone:string} };
type PaperPrediction = {id:string;targetPeriodId:string;createdAt:string;sourceLatestPeriodId:string;trainingCount:number;status:string;actualOutcome?:string;actualNumber?:number;models:{model:string;prediction:string;probability:number|null;note:string;actual?:string;correct?:boolean}[]};
type PredictionData = {predictions:PaperPrediction[];modelScorecard:{model:string;predictions:number;correct:number;accuracy:number|null}[]};
type AnalysisData = {
  summary: {
    count:number; big:number; small:number; bigRate:number|null; smallRate:number|null;
    bigRate95CI:{low:number|null;high:number|null}; smallRate95CI:{low:number|null;high:number|null};
    digitFrequencies:{digit:number;count:number;rate:number|null;rate95CI:{low:number|null;high:number|null}}[];
    digitChiSquareUniform:number|null;digitChiSquareUniformPApprox:number|null;
    transitions:{counts:Record<string,number>;bigAfterBig:number|null;bigAfterSmall:number|null;switchRate:number|null;repeatRate:number|null};
    runsTest:{runs:number|null;expectedRuns:number|null;zScore:number|null;pValueApprox:number|null};
    streaks:{maxBig:number;maxSmall:number;runCount:number;lengthHistogram:Record<string,number>};
    targetWindow:{count:number;big:number;small:number;bigRate:number|null;smallRate:number|null;bigRate95CI:{low:number|null;high:number|null}};
    otherWindows:{count:number;big:number;small:number;bigRate:number|null;smallRate:number|null;bigRate95CI:{low:number|null;high:number|null}};
    fiveMinuteWindows:{window:string;count:number;big:number;small:number;bigRate:number|null;smallRate:number|null;bigRate95CI:{low:number|null;high:number|null}}[];
    sourceTimestampCoverage:{withSourceTimestamp:number;withoutSourceTimestamp:number;coverageRate:number|null};
    confidenceStatus:string;confidenceNote:string;
  };
  backtest:{minTrainingRounds:number;chronologySource?:string;evaluatedRounds:number;models:{model:string;predictions:number;correct:number;accuracy:number|null;accuracy95CI:{low:number|null;high:number|null};note:string}[];limitations:string[]};
  dataQuality:{requestedGameMode:string;roundsLoaded:number;uniquePeriodsInQuery:number;timeZone:string;sourceTimestampCoverage:number|null;warning:string;audit?:{
    queriedRows:number;uniquePeriodIds:number;duplicatePeriodIdCount:number;invalidPeriodIdCount:number;invalidNumberCount:number;inconsistentOutcomeCount:number;missingFirstSeenCount:number;sourceTimestampCount:number;sourceTimestampCoverage:number|null;sourceTimestampFieldCounts:Record<string,number>;invalidStoredRows:number;status:string;warnings:string[];periodGapCheck:{method:string;inferredMissingPeriodCount:number|null;warning:string};
  }};
};

const pct=(v:number|null)=>v===null?"—":`${(v*100).toFixed(1)}%`;
const dt=(v?:string)=>v?new Date(v).toLocaleString():"—";

export default function Home(){
  const [data,setData]=useState<Data|null>(null);
  const [analysis,setAnalysis]=useState<AnalysisData|null>(null);
  const [predictionData,setPredictionData]=useState<PredictionData|null>(null);
  const [targetPeriodId,setTargetPeriodId]=useState("");
  const [predictionBusy,setPredictionBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  const refresh=useCallback(async()=>{
    try{
      const [r,a,p]=await Promise.all([
        fetch("/api/summary",{cache:"no-store"}),
        fetch("/api/analysis",{cache:"no-store"}),
        fetch("/api/predictions",{cache:"no-store"})
      ]);
      const [j,aj,pj]=await Promise.all([r.json(),a.json(),p.json()]);
      if(!r.ok) throw new Error(j.error||"Summary unavailable");
      setData(j);
      if(a.ok) setAnalysis(aj); else setMessage(aj.error||"Extended analysis unavailable");
      if(p.ok) setPredictionData(pj);
      if(r.ok && a.ok) setMessage("");
    }catch(e){setMessage(e instanceof Error?e.message:"Could not load summary");}
    finally{setLoading(false);}
  },[]);

  async function collectNow(){
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/collect",{method:"POST"});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||"Collection failed");
      setMessage(`Collection complete: ${j.recordsSeen} records seen, ${j.inserted} new rounds, ${j.updated} refreshed.`);
      await refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"Collection failed");}
    finally{setBusy(false);}
  }

  useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),10000);return()=>clearInterval(id)},[refresh]);

  async function createPaperPrediction(){
    const target=targetPeriodId.trim();
    if(!target){setMessage("Enter the upcoming target period ID first.");return;}
    setPredictionBusy(true);setMessage("");
    try{
      const r=await fetch("/api/predictions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({targetPeriodId:target})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||"Could not record paper prediction");
      setMessage(`Paper prediction recorded for target period ${target}. The directional baselines are now frozen for later scoring.`);
      setTargetPeriodId("");
      await refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"Could not record paper prediction");}
    finally{setPredictionBusy(false);}
  }

  const s=data?.summary;
  const potentialGapCount = analysis?.dataQuality.audit?.periodGapCheck.inferredMissingPeriodCount;
  return <main>
    <header>
      <div>
        <div className="eyebrow">Research workspace · v1</div>
        <h1>Wingo Intelligence</h1>
        <p className="sub">A historical data collector and statistical research dashboard for Wingo 30-second rounds. Predictions remain experimental until validated on unseen results.</p>
      </div>
      <div className="status">{loading?"CONNECTING":data?"DASHBOARD READY":"CHECK CONFIGURATION"}</div>
    </header>

    <div className="notice"><b>Research integrity:</b> No guaranteed wins. A frequency estimate is not the same as a validated forecast. The time-window hypothesis is being measured, not assumed to be true. Use simulated analysis only.</div>

    <div className="toolbar">
      <button onClick={collectNow} disabled={busy}>{busy?"Collecting…":"Collect latest API history"}</button>
      <button onClick={refresh} disabled={loading} style={{background:"#202b42",color:"#eef3ff"}}>Refresh dashboard</button>
      <span className="small">Configured game: {data?.config.gameMode||"WinGo_30S"} · Time zone: {data?.config.timeZone||"Asia/Kolkata"}</span>
    </div>
    {message&&<div className="notice">{message}</div>}

    <div className="grid">
      <div className="card"><div className="metric-label">Unique rounds stored</div><div className="metric">{s?.count??"—"}</div><div className="small">MongoDB Result collection</div></div>
      <div className="card"><div className="metric-label">Big frequency</div><div className="metric gold">{pct(s?.bigRate??null)}</div><div className="small">{s?.big??0} recorded rounds classified Big</div></div>
      <div className="card"><div className="metric-label">Small frequency</div><div className="metric">{pct(s?.smallRate??null)}</div><div className="small">{s?.small??0} recorded rounds classified Small</div></div>
      <div className="card"><div className="metric-label">Last 20 outcomes</div><div className="metric">{s?`${s.recentBig} / ${s.recentSmall}`:"—"}</div><div className="small">Big / Small in latest available sample</div></div>
    </div>

    <div className="two">
      <section className="card">
        <h2>Time-window hypothesis</h2>
        <p className="small">Tests the second five minutes of each ten-minute block (minute offsets 5–9), using eligible source timestamps in Asia/Kolkata. Records without a parseable source timestamp are excluded. Results are descriptive until out-of-sample testing is complete.</p>
        <div className="grid" style={{gridTemplateColumns:"1fr 1fr",marginBottom:0}}>
          <div><div className="metric-label">Target window sample</div><div className="metric">{s?.targetWindow.count??0}</div><div className="small">Big rate: {pct(s?.targetWindow.bigRate??null)}</div></div>
          <div><div className="metric-label">Other windows sample</div><div className="metric">{s?.otherWindows.count??0}</div><div className="small">Big rate: {pct(s?.otherWindows.bigRate??null)}</div></div>
        </div>
        <div className="notice">Timestamp caveat: if the API provides no authoritative round timestamp, first-seen time is only an observation time—not necessarily the actual result time. The collector records both separately.</div>
      </section>
      <section className="card">
        <h2>Confidence meter</h2>
        <div className="metric gold">{s?`${(Math.max(s.descriptivePBig,s.descriptivePSmall)*100).toFixed(1)}%`:"—"}</div>
        <div className="small">Smoothed historical majority estimate only</div>
        <div className="bar"><span style={{width:`${s?Math.max(s.descriptivePBig,s.descriptivePSmall)*100:0}%`}}/></div>
        <div className="pill">{s?.confidenceStatus??"WAITING FOR DATA"}</div>
        <p className="small" style={{marginTop:10}}>{s?.confidenceNote??"Connect MongoDB and collect verified results first."}</p>
        <p className="small" style={{marginTop:8}}>This is deliberately not labelled “chance of winning”. A calibrated predictive confidence meter requires walk-forward test results and probability calibration.</p>
      </section>
    </div>

    <section className="card section">
      <h2>Statistical research engine</h2>
      <p className="small">These are descriptive tests and simple walk-forward baselines, not a promise of predictive power. Confidence intervals describe historical proportions; they are not next-round guarantees.</p>
      <div className="grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))"}}>
        <div><div className="metric-label">Big 95% interval</div><div className="metric" style={{fontSize:20}}>{analysis?`${pct(analysis.summary.bigRate95CI.low)}–${pct(analysis.summary.bigRate95CI.high)}`:"—"}</div><div className="small">Wilson interval</div></div>
        <div><div className="metric-label">Runs test Z</div><div className="metric">{analysis?.summary.runsTest.zScore?.toFixed(2)??"—"}</div><div className="small">Exploratory; not a p-value</div></div>
        <div><div className="metric-label">Switch rate</div><div className="metric">{pct(analysis?.summary.transitions.switchRate??null)}</div><div className="small">Adjacent side changes</div></div>
        <div><div className="metric-label">Longest streak</div><div className="metric">{analysis?Math.max(analysis.summary.streaks.maxBig,analysis.summary.streaks.maxSmall):"—"}</div><div className="small">Max consecutive same side</div></div>
      </div>
      <div className="two">
        <div>
          <h2>Digit distribution (0–9)</h2>
          <div className="table-wrap"><table><thead><tr><th>Digit</th><th>Count</th><th>Observed rate</th><th>95% interval</th></tr></thead><tbody>
            {(analysis?.summary.digitFrequencies||[]).map(d=><tr key={d.digit}><td>{d.digit}</td><td>{d.count}</td><td>{pct(d.rate)}</td><td>{pct(d.rate95CI.low)}–{pct(d.rate95CI.high)}</td></tr>)}
            {!analysis&&<tr><td colSpan={4}>Waiting for analysis…</td></tr>}
          </tbody></table></div>
          <p className="small">Uniform digit chi-square: {analysis?.summary.digitChiSquareUniform?.toFixed(2)??"—"} · approximate p-value: {analysis?.summary.digitChiSquareUniformPApprox?.toFixed(4)??"—"}. Exploratory only; expected counts, independence and multiple testing must be considered.</p>
        </div>
        <div>
          <h2>Sequence dependence</h2>
          <div className="table-wrap"><table><tbody>
            <tr><th>Metric</th><th>Observed</th></tr>
            <tr><td>BIG after BIG</td><td>{pct(analysis?.summary.transitions.bigAfterBig??null)}</td></tr>
            <tr><td>BIG after SMALL</td><td>{pct(analysis?.summary.transitions.bigAfterSmall??null)}</td></tr>
            <tr><td>Repeat rate</td><td>{pct(analysis?.summary.transitions.repeatRate??null)}</td></tr>
            <tr><td>Switch rate</td><td>{pct(analysis?.summary.transitions.switchRate??null)}</td></tr>
            <tr><td>Observed runs</td><td>{analysis?.summary.runsTest.runs??"—"}</td></tr>
            <tr><td>Expected runs under random ordering</td><td>{analysis?.summary.runsTest.expectedRuns?.toFixed(1)??"—"}</td></tr>
            <tr><td>Runs-test Z score</td><td>{analysis?.summary.runsTest.zScore?.toFixed(2)??"—"}</td></tr>
            <tr><td>Runs-test approximate p-value</td><td>{analysis?.summary.runsTest.pValueApprox?.toFixed(4)??"—"}</td></tr>
          </tbody></table></div>
          <p className="small">Conditional frequencies can be noisy. Do not interpret them as reliable next-round probabilities without out-of-sample replication.</p>
        </div>
      </div>
    </section>

    <section className="card section">
      <h2>Five-minute windows</h2>
      <p className="small">The original hypothesis targets minute offsets 05–09, 15–19, 25–29, 35–39, 45–49 and 55–59. This table groups all five-minute clock windows. Time analysis is unreliable when source timestamps are absent.</p>
      <div className="table-wrap"><table><thead><tr><th>Window (IST)</th><th>Sample</th><th>Big</th><th>Small</th><th>Big rate</th><th>Big 95% interval</th></tr></thead><tbody>
        {(analysis?.summary.fiveMinuteWindows||[]).map(w=><tr key={w.window}><td>{w.window}</td><td>{w.count}</td><td>{w.big}</td><td>{w.small}</td><td>{pct(w.bigRate)}</td><td>{pct(w.bigRate95CI.low)}–{pct(w.bigRate95CI.high)}</td></tr>)}
        {!analysis&&<tr><td colSpan={6}>Waiting for analysis…</td></tr>}
      </tbody></table></div>
      <div className="notice">Target window sample: {analysis?.summary.targetWindow.count??0} rounds · Big rate {pct(analysis?.summary.targetWindow.bigRate??null)} · other windows sample: {analysis?.summary.otherWindows.count??0} rounds · Big rate {pct(analysis?.summary.otherWindows.bigRate??null)}. Timestamp coverage: {pct(analysis?.summary.sourceTimestampCoverage.coverageRate??null)}.</div>
    </section>

    <section className="card section">
      <h2>Walk-forward baseline evaluation</h2>
      <p className="small">Each historical prediction uses only earlier results. The first 50 rounds are used as warm-up. These are baseline comparisons, not tuned predictions or betting recommendations.</p>
      <div className="table-wrap"><table><thead><tr><th>Model</th><th>Test rounds</th><th>Correct</th><th>Accuracy</th><th>95% interval</th></tr></thead><tbody>
        {(analysis?.backtest.models||[]).map(m=><tr key={m.model}><td>{m.model}</td><td>{m.predictions}</td><td>{m.correct}</td><td>{pct(m.accuracy)}</td><td>{pct(m.accuracy95CI.low)}–{pct(m.accuracy95CI.high)}</td></tr>)}
        {!analysis&&<tr><td colSpan={5}>Waiting for backtest…</td></tr>}
      </tbody></table></div>
      <div className="small">Evaluated rounds: {analysis?.backtest.evaluatedRounds??0}. Sequence order: {analysis?.backtest.chronologySource ?? "—"}. Data quality: {analysis?.dataQuality.roundsLoaded??0} rounds loaded, {analysis?.dataQuality.uniquePeriodsInQuery??0} unique period IDs. {analysis?.dataQuality.warning??""}</div>
    </section>

    <section className="card section">
      <h2>Data integrity audit</h2>
      <p className="small">These checks flag structural problems before statistical interpretation. Numeric period-gap estimates are heuristic until the provider confirms period IDs are sequential.</p>
      <div className="grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))"}}>
        <div><div className="metric-label">Duplicate IDs</div><div className="metric">{analysis?.dataQuality.audit?.duplicatePeriodIdCount ?? "—"}</div></div>
        <div><div className="metric-label">Invalid digits</div><div className="metric">{analysis?.dataQuality.audit?.invalidNumberCount ?? "—"}</div></div>
        <div><div className="metric-label">Outcome mismatches</div><div className="metric">{analysis?.dataQuality.audit?.inconsistentOutcomeCount ?? "—"}</div></div>
        <div><div className="metric-label">Source timestamps</div><div className="metric">{analysis?.dataQuality.audit?.sourceTimestampCount ?? "—"}/{analysis?.dataQuality.audit?.queriedRows ?? "—"}</div></div>
      </div>
      <div className="notice">Audit status: {analysis?.dataQuality.audit?.status ?? "Waiting for audit…"}. {potentialGapCount != null ? `Potential numeric-ID gaps: ${potentialGapCount}. ` : "Numeric-ID gap estimate unavailable. "}{analysis?.dataQuality.audit?.periodGapCheck.warning ?? ""}</div>
      {(analysis?.dataQuality.audit?.warnings ?? []).length > 0 && <ul>{analysis?.dataQuality.audit?.warnings.map((warning, i)=><li key={i}>{warning}</li>)}</ul>}
      <p className="small">Timestamp field counts: {analysis?.dataQuality.audit ? Object.entries(analysis.dataQuality.audit.sourceTimestampFieldCounts).map(([field,count])=>`${field}: ${count}`).join(" · ") || "No parseable source timestamp fields recorded" : "Waiting for audit…"}</p>
    </section>

    <section className="card section">
      <h2>Paper prediction ledger</h2>
      <p className="small">Record a forecast before the target round is settled. The app refuses periods that already have a stored result. This is for research validation only; it does not produce calibrated probabilities or betting instructions.</p>
      <div className="toolbar" style={{margin:"12px 0 16px"}}>
        <input aria-label="Target period ID" placeholder="Upcoming target period ID" value={targetPeriodId} onChange={e=>setTargetPeriodId(e.target.value)} style={{minWidth:260,flex:"1 1 260px",background:"#0b1020",border:"1px solid #33415c",borderRadius:10,padding:"11px 13px",color:"#eef3ff"}} />
        <button onClick={createPaperPrediction} disabled={predictionBusy}>{predictionBusy?"Recording…":"Record paper prediction"}</button>
      </div>
      <div className="grid" style={{gridTemplateColumns:"repeat(4,minmax(0,1fr))"}}>
        {(predictionData?.modelScorecard||[]).map(m=><div key={m.model}><div className="metric-label">{m.model}</div><div className="metric" style={{fontSize:22}}>{pct(m.accuracy)}</div><div className="small">{m.correct}/{m.predictions} scored predictions</div></div>)}
      </div>
      <div className="table-wrap"><table><thead><tr><th>Recorded</th><th>Target period</th><th>Training rounds</th><th>Model forecasts</th><th>Actual result</th><th>Status</th></tr></thead><tbody>
        {(predictionData?.predictions||[]).map(p=><tr key={p.id}><td>{dt(p.createdAt)}</td><td>{p.targetPeriodId}</td><td>{p.trainingCount}</td><td>{p.models.map(m=>`${m.model}: ${m.prediction}`).join(" · ")}</td><td>{p.actualOutcome?`${p.actualOutcome} (${p.actualNumber})`:"—"}</td><td><span className="pill">{p.status}</span></td></tr>)}
        {!predictionData?.predictions?.length&&<tr><td colSpan={6} className="small">No paper predictions recorded yet. At least 50 valid rounds are required.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="card section">
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <h2>Recent stored rounds</h2><span className="small">Newest first · period IDs preserved as strings</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Period ID</th><th>Number</th><th>Big / Small</th><th>First observed</th><th>Last observed</th></tr></thead>
        <tbody>{(data?.recent||[]).map((r,i)=><tr key={`${r.periodId}-${i}`}>
          <td>{r.periodId}</td><td>{r.resultNumber}</td><td><span className="pill" style={{color:r.outcome==="BIG"?"#f2b84b":"#40d6a2"}}>{r.outcome}</span></td>
          <td>{dt(r.firstSeenAt)}</td><td>{dt(r.lastSeenAt)}</td>
        </tr>)}
        {!data?.recent?.length&&<tr><td colSpan={5} className="small">{loading?"Loading rounds…":"No rounds stored yet. Configure MongoDB and run the collector."}</td></tr>}
        </tbody>
      </table></div>
    </section>

    <section className="card section">
      <h2>API collection audit</h2>
      <p className="small">Each poll is logged separately from unique round records, so we can audit when a response was received and how many records it contained.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Fetched at</th><th>HTTP</th><th>Records in response</th><th>Error</th></tr></thead>
        <tbody>{(data?.fetches||[]).map((f,i)=><tr key={i}><td>{dt(f.fetchedAt)}</td><td>{f.httpStatus}</td><td>{f.recordsSeen}</td><td>{f.error||"—"}</td></tr>)}
        {!data?.fetches?.length&&<tr><td colSpan={4} className="small">No API poll logs yet.</td></tr>}</tbody>
      </table></div>
    </section>

    <p className="foot">Data source endpoint comes from the supplied reference HTML and has not been independently verified as an official provider API. The first-seen timestamp is generated by this collector. API access, CORS/network behavior, historical coverage and the Big/Small mapping must be verified. Do not use these estimates to justify real-money wagers.</p>
  </main>;
}
