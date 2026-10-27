import test from 'node:test';
import assert from 'node:assert/strict';
const harmonic = await import('../lib/harmonic');

const dates = Array.from({length: 60}, (_,i) => new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
const pivots = [100,200,138.2,183.2,121.4].map((price,i)=>({date:dates[2+i*6],price,kind:i%2 ? 'high' : 'low',index:2+i*6}));
test('conservative bullish Gartley has intersecting Fibonacci PRZ and deterministic legs',()=>{
  assert.equal(typeof harmonic.matchHarmonicPivots, 'function');
  const result = harmonic.matchHarmonicPivots(pivots as any);
  assert.equal(result?.pattern,'Gartley');
  assert.equal(result?.direction,'bullish');
  assert.ok(result!.prz.low <= 121.4 && result!.prz.high >=121.4);
  assert.ok(result!.invalidation.price < result!.prz.low);
  assert.ok(result!.targets[0].price >121.4);
});
test('XABC projection is a three-way intersection, not a confirmed D',()=>{
  for (const bearish of [false,true]) {
    const points=pivots.slice(0,4).map(p=>({...p,price:bearish?300-p.price:p.price,kind:bearish?(p.kind==='low'?'high':'low'):p.kind}));
    const p=harmonic.projectGartleyPRZ(points as any);
    assert.equal(p?.direction,bearish?'bearish':'bullish');
    assert.deepEqual(Object.keys(p!.pivots),['X','A','B','C']);
    assert.ok(p!.prz.low<= (bearish?178.6:121.4) && p!.prz.high >= (bearish?178.6:121.4));
    if(!bearish) {assert.ok(Math.abs(p!.prz.low-119.4)<1e-9);assert.ok(Math.abs(p!.prz.high-123.4)<1e-9);}
    assert.equal('targets' in p!,false);
  }
  const noOverlap=pivots.slice(0,4).map(p=>({...p}));noOverlap[3].price=170;
  assert.equal(harmonic.projectGartleyPRZ(noOverlap as any),null);
});
test('rejects missing AB=CD convergence despite other Gartley ratios',()=>{
  const approximate=pivots.map(p=>({...p})); approximate[3].price=170;
  assert.equal(harmonic.matchHarmonicPivots(approximate as any),null);
});

function candles(bearish=false) {
  const anchors=[[0,120],[2,100],[8,200],[14,138.2],[20,183.2],[26,121.4],[29,128]];
  return Array.from({length:30},(_,i)=>{
    const k=anchors.findIndex(a=>a[0]>=i); const a=anchors[Math.max(0,k-1)],b=anchors[k];
    let v=a[1]+(b[1]-a[1])*(i-a[0])/(b[0]-a[0] || 1); if(bearish)v=300-v;
    return {date:dates[i],open:v,high:v,low:v,close:v};
  });
}
test('daily OHLC detector confirms both directions and does not use future bars',()=>{
  assert.equal(typeof harmonic.analyzeHarmonics,'function');
  for(const bearish of [false,true]) {
    const result=harmonic.analyzeHarmonics(candles(bearish),{emiten:'TEST',asOf:dates[29]});
    assert.equal(result.status,'pattern'); assert.equal(result.candidate?.direction,bearish?'bearish':'bullish');
  }
  assert.equal(harmonic.analyzeHarmonics(candles(),{emiten:'TEST',asOf:dates[27]}).status,'insufficient');
});

test('rejects malformed chronological, alternating, degenerate pivot sequences',()=>{
  for(const change of [(p:any[])=>p[1].date=p[0].date,(p:any[])=>p[1].kind='low',(p:any[])=>p[1].price=100,(p:any[])=>p[2].price=NaN,(p:any[])=>p[2].index=0]) {
    const p=pivots.map(x=>({...x}));change(p);assert.equal(harmonic.matchHarmonicPivots(p as any),null);
  }
});
test('invalid, insufficient and monotonic candles never generate targets',()=>{
  const opts={emiten:'TEST',asOf:dates[29]};
  for(const [rows,status] of [[[], 'insufficient'],[candles().map((r,i)=>i===0?{...r,high:0}:r),'unavailable'],[candles().map((r,i)=>({...r,open:i+10,close:i+10,high:i+10,low:i+10})),'no_pattern']] as const) {
    const a=harmonic.analyzeHarmonics(rows as any,opts); assert.equal(a.status,status); assert.equal(a.candidate,null);
  }
});
test('invalidation after D or target already reached excludes old candidates',()=>{
 for(const price of [99,160]) { const rows=candles();rows[29]={...rows[29],low:price,high:price,open:price,close:price};assert.equal(harmonic.analyzeHarmonics(rows,{emiten:'TEST',asOf:dates[29]}).candidate,null); }
});
test('history adapter shrinks end date with limit50, stops at200, sanitizes failures',async()=>{
  const history=await import('../lib/stockbit-history');
  assert.equal(typeof history.getHarmonicAnalysis,'function');
  const calls:any[]=[];
  const rows=Array.from({length:240},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:100,high:101,low:99,close:100}));
  const result=await history.getHarmonicAnalysisWithFetcher('TEST','2026-08-28',async(_e,start,end,limit)=>{calls.push({start,end,limit});return rows.filter(r=>r.date>=start && r.date<=end).reverse().slice(0,limit);});
  assert.equal(calls.length,4); assert.equal(result.candleCount,200);assert.ok(calls.every(c=>c.limit===50));assert.ok(calls[1].end<calls[0].end);
  assert.ok(calls.every(c=>(Date.parse(c.end)-Date.parse(c.start))/86400000<=364), 'Provider requests must fit the verified one-year history window');
  const failure=await history.getHarmonicAnalysisWithFetcher('TEST','2026-08-28',async()=>{throw new Error('secret-token');});
  assert.equal(failure.status,'unavailable');assert.equal(failure.candidate,null);assert.ok(!JSON.stringify(failure).includes('secret-token'));
});

test('standalone panel renders evidence but no target on unavailable data',async()=>{
  const {HarmonicPanel}=await import('../app/components/HarmonicPanel');
  const {createElement}=await import('react'); const {renderToStaticMarkup}=await import('react-dom/server');
  const unavailable=harmonic.analyzeHarmonics([],{emiten:'TEST',asOf:dates[29]});
  const html=renderToStaticMarkup(createElement(HarmonicPanel,{analysis:unavailable}));
  assert.match(html,/insufficient/);assert.match(html,/Stockbit/);assert.doesNotMatch(html,/Tentative TP/);
  const good=renderToStaticMarkup(createElement(HarmonicPanel,{analysis:harmonic.analyzeHarmonics(candles(),{emiten:'TEST',asOf:dates[29]})}));
  assert.match(good,/Gartley/);assert.match(good,/PRZ/);assert.match(good,/AB_XA/);assert.match(good,/Tentative TP/);assert.match(good,/harmonictrader.com/);
});

function watchRows(bearish=false) {
  const base=candles();
  const values=[...Array.from({length:10},(_,i)=>140-i),...base.map(r=>r.close)];
  for(let i=31;i<40;i++) values[i]=180-(i-30)*5;
  return values.map((v,i)=>{v=bearish?300-v:v;return {date:dates[i],open:v,high:v,low:v,close:v};});
}
const analyze=(rows:any[],i=rows.length-1)=>harmonic.analyzeHarmonics(rows,{emiten:'TEST',asOf:dates[i]});
test('watch projects both directions; wick touch remains provisional until two right bars',()=>{
  for(const bearish of [false,true]) {
    const rows=watchRows(bearish);
    assert.equal(analyze(rows).watch?.stage,'projected');
    assert.equal(analyze(rows).candidate,null);
    rows[39]=bearish?{date:dates[39],open:170,close:170,low:170,high:178.6}:{date:dates[39],open:130,close:130,low:121.4,high:130};
    const touched=analyze(rows);
    assert.equal(touched.status,'no_pattern'); assert.equal(touched.watch?.stage,'prz_touched');
    assert.equal(touched.watch?.touchedAt,dates[39]);assert.equal(touched.watch?.provisionalD?.date,dates[39]);
    for(const [i,v] of [[40,126],[41,128]]) {const p=bearish?300-v:v;rows.push({date:dates[i],open:p,close:p,high:p,low:p});}
    assert.equal(analyze(rows,40).watch?.stage,'prz_touched');
    assert.equal(analyze(rows).watch?.stage,'confirmed'); assert.equal(analyze(rows).status,'pattern');
    assert.deepEqual(analyze(rows,39),touched,'future bars cannot confirm D');
  }
});
test('invalidations take precedence over wick touch; broken C, stale and consumed setups are not active',()=>{
  for(const [field,value,stage,reason] of [['low',99,'invalidated',/X/],['high',184,'invalidated',/C/]] as const) {
    const rows=watchRows(); rows[39]={...rows[39],[field]:value};
    const a=analyze(rows);assert.equal(a.watch?.stage,stage);assert.match(a.watch!.reason,reason);assert.equal(a.candidate,null);
  }
  const rows=watchRows();
  for(let i=40;i<53;i++) rows.push({date:dates[i],open:134,close:134,high:134,low:134});
  assert.equal(analyze(rows).watch?.stage,'expired');assert.equal(analyze(rows).candidate,null);
  const complete=candles(); assert.equal(analyze(complete).watch?.stage,'confirmed');
  complete[29]={...complete[29],open:160,close:160,high:160,low:160};
  assert.equal(analyze(complete).watch?.stage,'expired');assert.match(analyze(complete).watch!.reason,/target/i);
});
test('C replacement recomputes projection and consumed provisional movement is expired, never confirmed',()=>{
  const rows=watchRows();
  for(let i=31;i<39;i++) rows[i]={date:dates[i],open:170,close:170,low:170,high:170};
  rows[39]={date:dates[39],open:184,close:184,low:184,high:184};
  for(const [i,v] of [[40,170],[41,160]]) rows.push({date:dates[i],open:v,close:v,high:v,low:v});
  const replacement=analyze(rows);
  assert.equal(replacement.watch?.projection.pivots.C.date,dates[39]);
  assert.equal(replacement.watch?.stage,'projected');
  const consumed=watchRows();consumed[39]={date:dates[39],open:130,close:130,high:130,low:121.4};
  consumed.push({date:dates[40],open:160,close:160,high:160,low:160});
  assert.equal(analyze(consumed).watch?.stage,'expired');assert.equal(analyze(consumed).candidate,null);
  assert.match(analyze(consumed).watch!.reason,/target/);
});
test('a later confirmed swing retires a completed D rather than recycling an older pattern',()=>{
  const rows=candles();
  rows[29]={date:dates[29],open:140,close:140,high:140,low:140};
  for(const [i,v] of [[30,132],[31,130]]) rows.push({date:dates[i],open:v,close:v,high:v,low:v});
  assert.equal(analyze(rows).candidate,null);
  assert.equal(analyze(rows).watch?.stage,'expired');
});
test('ambiguous outside extrema and flat data do not invent a projection',()=>{
  const rows=watchRows();rows[30]={...rows[30],low:90};
  assert.equal(analyze(rows).watch??null,null);
  const p=pivots.slice(0,4).map(p=>({...p}));p[3].kind='low';
  assert.equal(harmonic.projectGartleyPRZ(p as any),null);
});

test('panel renders Indonesian watch stages, provisional dates and no projected or ended targets',async()=>{
  const {HarmonicPanel}=await import('../app/components/HarmonicPanel');
  const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
  const rows=watchRows();
  for(const [value,label] of [[135,'Kandidat XABC'],[121.4,'Menunggu konfirmasi D'],[99,'Tidak valid']] as const) {
    rows[39]={...rows[39],open:135,close:135,low:value,high:135};
    const html=renderToStaticMarkup(createElement(HarmonicPanel,{analysis:analyze(rows)}));
    assert.match(html,new RegExp(label));assert.match(html,/PRZ proyeksi/);assert.match(html,/2026-02-09/);assert.doesNotMatch(html,/Tentative TP/);
    if(value===121.4) assert.match(html,/D provisional/);
  }
});
