import test from 'node:test';
import assert from 'node:assert/strict';
const { aggregateWeeklyCandles, analyzeWeeklyHarmonics } = await import('../lib/harmonic-weekly');
const weekly = await import('../lib/harmonic-weekly');
const bar=(date:string,close=100)=>({date,open:close,high:close+1,low:close-1,close});
test('weekly aggregation preserves actual dates across ISO year and excludes incomplete calendar week',()=>{
 const r=aggregateWeeklyCandles([bar('2020-12-28',100),bar('2020-12-31',104),bar('2021-01-04',105)],'2021-01-04');
 assert.equal(r.valid,true); assert.equal(r.partialWeekExcluded,true);
 assert.deepEqual(r.candles,[{date:'2020-12-31',weekStart:'2020-12-28',open:100,high:105,low:99,close:104}]);
 assert.equal(aggregateWeeklyCandles([bar('2026-10-23')],'2026-10-23').candles.length,1);
});

const dateAt=(i:number)=>new Date(Date.UTC(2024,0,5+i*7)).toISOString().slice(0,10);
function history(values=[100,200,138.2,183.2,121.4],end=56,bear=false) {
 const anchors=[[0,130],[8,values[0]],[18,values[1]],[28,values[2]],[38,values[3]],[48,values[4]],[80,145]];
 return Array.from({length:end+1},(_,i)=>{
  const j=anchors.findIndex(a=>a[0]>=i); const [t,v]=anchors[Math.max(0,j-1)],[u,w]=anchors[j];
  const p=u===t?v:v+(w-v)*(i-t)/(u-t),price=bear?300-p:p;
  return {date:dateAt(i),open:price,high:price,low:price,close:price};
 });
}
test('major weekly structures are detected and deduplicated across 2/4/8 scales',()=>{
 for(const [pattern,prices] of [['Gartley',[100,200,138.2,183.2,121.4]],['Bat',[100,200,150,175,111.4]]] as const) for(const bear of [false,true]) {
  const a=analyzeWeeklyHarmonics(history([...prices],56,bear),{emiten:'TEST',asOf:dateAt(56)});
  assert.equal(a.status,'pattern'); assert.equal(a.timeframe,'1W'); assert.equal(a.candleCount,57);
  const r=a.results.find(r=>r.pattern===pattern)!; assert.ok(r); assert.equal(r.watch.stage,'confirmed');
  assert.deepEqual(r.scales,[2,4,8]); assert.equal(r.scale,8); assert.ok(r.candidate); assert.equal(r.candidate.pivots.D.index,48);
 }
 const projected=analyzeWeeklyHarmonics(history(undefined,46),{emiten:'T',asOf:dateAt(46)});
 assert.equal(projected.results[0].watch.stage,'projected'); assert.equal(projected.results[0].candidate,null);
 const touched=analyzeWeeklyHarmonics(history(undefined,49),{emiten:'T',asOf:dateAt(49)});
 assert.equal(touched.results[0].watch.stage,'prz_touched'); assert.ok(touched.results[0].watch.provisionalD);
});
test('weekly data fails closed and history remains bounded without invented bars',()=>{
 assert.equal(analyzeWeeklyHarmonics([bar('2026-10-23')],{emiten:'T',asOf:'2026-10-23'}).status,'insufficient');
 assert.equal(aggregateWeeklyCandles([bar('2026-10-24')],'2026-10-25').valid,false);
 assert.equal(aggregateWeeklyCandles([bar('2026-10-23'),bar('2026-10-23',101)],'2026-10-23').valid,false);
 assert.equal(aggregateWeeklyCandles([bar('2026-02-30')],'2026-10-23').valid,false);
 assert.equal(aggregateWeeklyCandles([bar('2026-10-23'),bar('2026-10-30',NaN)],'2026-10-23').valid,true);
 const long=Array.from({length:600},(_,i)=>bar(dateAt(i)));
 assert.equal(aggregateWeeklyCandles(long,dateAt(599)).candles.length,520);
});
test('major scale survives intervening minor swings without skipping consecutive pivots at that scale',()=>{
 const rows=history();rows[32]={...rows[32],high:170};rows[34]={...rows[34],low:145};
 const a=analyzeWeeklyHarmonics(rows,{emiten:'T',asOf:dateAt(56)});
 const major=a.results.find(r=>r.scale===8 && r.pattern==='Gartley');assert.ok(major?.candidate);
 assert.deepEqual(Object.values(major.candidate.pivots).map(p=>p.index),[8,18,28,38,48]);
 assert.equal(major.scales.includes(2),false);
});
test('invalid date tokens fail closed even when they sort after asOf',()=>{
 assert.equal(aggregateWeeklyCandles([bar('not-a-date')],'2026-10-23').valid,false);
});
test('weekly lifecycle retires consumed targets, expires age, and invalidates far PRZ and C extension',()=>{
 const run=(rows:ReturnType<typeof history>)=>analyzeWeeklyHarmonics(rows,{emiten:'T',asOf:rows.at(-1)!.date});
 const breached=history(undefined,57); breached[57]={...breached[57],low:118,open:125,close:125,high:130};
 const invalid=run(breached); assert.equal(invalid.status,'no_pattern'); assert.equal(invalid.results[0].watch.stage,'invalidated'); assert.match(invalid.results[0].reason,/Far PRZ/);
 const target=history(undefined,57); target[57]={...target[57],open:130,low:125,high:160,close:130};
 const consumed=run(target);assert.equal(consumed.results[0].watch.stage,'expired'); assert.match(consumed.results[0].reason,/target/);assert.equal(consumed.results[0].candidate,null);
 const age=run(history(undefined,59));assert.equal(age.results[0].watch.stage,'expired');assert.match(age.results[0].reason,/20/);
 const extended=history(undefined,46);extended[46]={...extended[46],open:150,low:140,high:190,close:150};
 const broken=run(extended);assert.equal(broken.results[0].watch.stage,'invalidated'); assert.match(broken.results[0].reason,/C extended/);
});
test('future bars cannot confirm D or change a historical snapshot; tied D lows remain provisional',()=>{
 const full=history(),asOf=dateAt(49);
 assert.deepEqual(analyzeWeeklyHarmonics(full,{emiten:'T',asOf}),analyzeWeeklyHarmonics(full.slice(0,50),{emiten:'T',asOf}));
 const tied=history(undefined,50);tied[49]={...tied[49],low:121.4};
 const a=analyzeWeeklyHarmonics(tied,{emiten:'T',asOf:dateAt(50)});
 assert.equal(a.status,'no_pattern');assert.equal(a.results[0].watch.stage,'prz_touched');assert.equal(a.results[0].candidate,null);
 const flat=Array.from({length:50},(_,i)=>bar(dateAt(i)));
 assert.deepEqual(analyzeWeeklyHarmonics(flat,{emiten:'T',asOf:dateAt(49)}).results,[]);
});
const points=(values:number[],bear=false)=>values.map((price,i)=>({date:new Date(Date.UTC(2025,0,3+i*28)).toISOString().slice(0,10),index:i*4+2,price:bear?300-price:price,kind:(i%2===0)!==bear?'low':'high'}));
test('a subsequent confirmed weekly swing retires D without presenting targets as active',()=>{
 const anchors=[[0,130],[4,100],[10,200],[16,138.2],[22,183.2],[28,121.4],[32,135],[36,127]];
 const rows=Array.from({length:37},(_,i)=>{
  const j=anchors.findIndex(a=>a[0]>=i),[t,v]=anchors[Math.max(0,j-1)],[u,w]=anchors[j];
  const p=u===t?v:v+(w-v)*(i-t)/(u-t);return {date:dateAt(i),open:p,high:p,low:p,close:p};
 });
 const a=analyzeWeeklyHarmonics(rows,{emiten:'T',asOf:dateAt(36)});
 assert.equal(a.status,'no_pattern');assert.equal(a.results[0].watch.stage,'expired');assert.match(a.results[0].reason,/Subsequent/);assert.equal(a.results[0].candidate,null);
});
test('strict weekly subsets project and confirm bullish and bearish Gartley and Bat',()=>{
 for(const [pattern,values] of [['Gartley',[100,200,138.2,183.2,121.4]],['Bat',[100,200,150,175,111.4]]] as const) for(const bear of [false,true]) {
  const p=points([...values],bear);
  const projection=weekly.projectWeeklyPRZ(p.slice(0,4) as any,pattern);
  assert.ok(projection); assert.equal('D' in projection.pivots,false); assert.equal('targets' in projection,false);
  const c=weekly.matchWeeklyPivots(p as any,pattern); assert.ok(c); assert.equal(c.direction,bear?'bearish':'bullish');
  assert.ok(c.prz.low<=p[4].price && c.prz.high>=p[4].price);
  assert.ok(Math.abs(c.invalidation.price-(bear?(pattern==='Bat'?213:200):(pattern==='Bat'?87:100)))<1e-9);
 }
 assert.equal(weekly.projectWeeklyPRZ(points([100,200,138.2,162]) as any,'Gartley'),null);
 assert.equal(weekly.matchWeeklyPivots(points([100,200,150,175,115]) as any,'Bat'),null);
});
