import test from 'node:test';
import assert from 'node:assert/strict';
const engine=await import('../lib/harmonic-zigzag');
const date=(i:number)=>new Date(Date.UTC(2024,0,5+i*7)).toISOString().slice(0,10);
const bar=(i:number,h:number,l:number)=>({date:date(i),weekStart:new Date(Date.UTC(2024,0,1+i*7)).toISOString().slice(0,10),open:(h+l)/2,high:h,low:l,close:(h+l)/2});
test('strict lookback warmup, outside bars skipped and frozen prior pivots never repaint',()=>{
 const bars=[bar(0,10,8),bar(1,11,9),bar(2,12,10),bar(3,13,7),bar(4,14,10),bar(5,12,6),bar(6,13,5),bar(7,15,7)];
 const p=engine.getZigzagPivots(bars,2);
 assert.deepEqual(p.map(x=>[x.index,x.kind,x.provisional,x.confirmedAt]),[[4,'high',false,date(5)],[6,'low',false,date(7)],[7,'high',true,undefined]]);
 assert.equal(engine.getZigzagPivots(bars.slice(0,2),2).length,0);
 const before=engine.getZigzagPivots(bars.slice(0,6),2);
 assert.deepEqual(before.filter(x=>!x.provisional),p.slice(0,1));
 assert.equal(before.at(-1)!.index,5); assert.equal(p[1].index,6);
});


test('weekly input fails closed for malformed metadata/conflicting duplicates and excludes future/partial weeks',()=>{
 const bars=Array.from({length:70},(_,i)=>bar(i,110+i,100+i));
 const asOf=date(69),run=(input:any,at=asOf)=>engine.analyzeZigzagHarmonics(input,{emiten:'TEST',asOf:at});
 const copy=JSON.stringify(bars),good=run([...bars].reverse());
 assert.equal(good.candleCount,70);assert.equal(JSON.stringify(bars),copy);assert.equal(good.experimental,true);
 assert.deepEqual(good.candles,bars);assert.equal(good.timeframe,'1W');assert.equal(good.supportedPatterns.length,4);
 for(const input of [[...bars,{...bars[0],high:999}],bars.map((b,i)=>i===1?{...b,weekStart:date(1)}:b),bars.map((b,i)=>i===1?{...b,low:0}:b),bars.map((b,i)=>i===1?{...b,high:NaN}:b)]) assert.equal(run(input).status,'unavailable');
 assert.deepEqual(run([...bars,{...bar(70,NaN,NaN)}]),good);
 assert.equal(run(bars,bars[69].weekStart).candleCount,69);
 assert.equal(run([...bars,bars[0]]).candleCount,70);
 assert.equal(run(bars,'not-date').status,'unavailable');
 assert.throws(()=>engine.getZigzagPivots(bars.map((b,i)=>i===1?{...b,low:NaN}:b),8));
 assert.throws(()=>engine.getZigzagPivots(bars,0));
});


function history(prices=[100,200,138.2,183.2,121.4],end=67,bear=false) {
 const anchors=[[0,130],...prices.map((p,i)=>[12+i*12,p]),[84,145]];
 return Array.from({length:end+1},(_,i)=>{
  let j=1;while(j<anchors.length-1&&i>anchors[j][0])j++;
  const [a,v]=anchors[j-1],[b,w]=anchors[j];let p=v+(w-v)*(i-a)/(b-a);if(bear)p=400-p;
  return bar(i,p,p);
 });
}
for(const [pattern,prices] of Object.entries({Gartley:[100,200,138.2,183.2,121.4],Bat:[100,200,150,174.9,111.4],Butterfly:[100,200,121.4,172.822,73],ABCD:[100,200,140,170,110]})) for(const bear of [false,true]) test(`analyzer ${pattern} ${bear?'bear':'bull'} only confirms D at reversal availability`,()=>{
 const bars=history(prices,68,bear),run=(n:number)=>engine.analyzeZigzagHarmonics(bars.slice(0,n+1),{emiten:'TEST',asOf:date(n)});
 const results=run(68).results.filter(r=>r.pattern===pattern);assert.ok(results.length);
 const r=results.find(r=>r.periods.includes(8))!;assert.ok(r); assert.equal(r.stage,'confirmed');
 assert.equal(r.targets.length,2);assert.ok(r.confirmedAt!>r.pivots.D!.date);assert.ok(r.availableAt>=r.pivots.C!.confirmedAt!);
 assert.equal(run(48).results.filter(r=>r.pattern===pattern&&r.pivots.C?.date===date(48)).length,0,'forming C is not a projection');
 const atD=run(60).results.find(x=>x.id===r.id&&x.pattern===pattern&&x.periods.includes(8))!;
 assert.ok(atD);assert.equal(atD.stage,'prz_touched');assert.equal(atD.targets.length,0);assert.equal(atD.pivots.D,undefined);assert.equal(atD.provisionalD!.provisional,true);
 assert.equal(Object.keys(r.pivots).length,pattern==='ABCD'?4:5);
});


test('confirmed D is retired permanently when first target is consumed; ended structures have no targets',()=>{
 const bars=history(undefined,68),base=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(68)}).results.find(r=>r.pattern==='Gartley')!;
 bars.push(bar(69,160,155),bar(70,140,135));
 const result=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(70)}).results.find(r=>r.id===base.id)!;
 assert.equal(result.stage,'expired');assert.match(result.reason,/target/);assert.equal(result.endedAt,date(69));assert.deepEqual(result.targets,[]);assert.equal(result.provisionalD,undefined);
});
test('hard/far PRZ breach, C extension and mismatched next D cannot leave an active setup',()=>{
 for(const [high,low,reason] of [[120,99,/Hard/],[120,110,/Far/]] as const) {
  const bars=history(undefined,68);bars.push(bar(69,high,low));
  const r=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(69)}).results.find(r=>r.pattern==='Gartley')!;
  assert.equal(r.stage,'invalidated');assert.match(r.reason,reason);assert.deepEqual(r.targets,[]);
 }
 const extended=history(undefined,58);extended[58]=bar(58,190,170);
 const extension=engine.analyzeZigzagHarmonics(extended,{emiten:'T',asOf:date(58)}).results.find(r=>r.pattern==='Gartley')!;
 assert.equal(extension.stage,'invalidated');assert.match(extension.reason,/C extended/);
 const wrong=history([100,200,138.2,183.2,130],68);
 const r=engine.analyzeZigzagHarmonics(wrong,{emiten:'T',asOf:date(68)}).results.find(r=>r.pattern==='Gartley')!;
 assert.equal(r.stage,'expired');assert.match(r.reason,/fails strict D/);assert.deepEqual(r.targets,[]);
});
test('52 completed-bar age limit bounds an unconsumed projection',()=>{
 const bars=history(undefined,53);for(let i=54;i<=101;i++)bars.push(bar(i,150,150));
 const r=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(101)}).results.find(r=>r.pattern==='Gartley')!;
 assert.equal(r.stage,'expired');assert.match(r.reason,/52/);assert.equal(r.endedAt,date(101));assert.deepEqual(r.targets,[]);
});
test('holiday reversal availability is Friday, not last actual Thursday date',()=>{
 const bars=[bar(0,10,8),bar(1,11,9),bar(2,12,10),bar(3,13,11),bar(4,11,6)];
 bars[4].date=new Date(Date.parse(date(4))-86400000).toISOString().slice(0,10);
 const p=engine.getZigzagPivots(bars,2);
 assert.equal(p[0].confirmedAt,date(4));assert.notEqual(p[0].confirmedAt,bars[4].date);
 const baseline=history(undefined,68);baseline[68].date=new Date(Date.parse(date(68))-86400000).toISOString().slice(0,10);
 const thursday=engine.analyzeZigzagHarmonics(baseline,{emiten:'T',asOf:baseline[68].date});
 assert.equal(thursday.candleCount,68);
});
test('prefix replay excludes future input and confirmed pivots are deeply immutable; input untouched',()=>{
 const bars=history(undefined,84),saved=JSON.stringify(bars);let previous:any[]=[];
 for(let n=9;n<bars.length;n++) {
  const prefix=bars.slice(0,n),asOf=date(n-1),p=engine.getZigzagPivots(prefix,8),confirmed=p.filter(x=>!x.provisional);
  assert.deepEqual(confirmed.slice(0,previous.length),previous);previous=confirmed;
  assert.ok(p.every((x,i)=>x.index<n&&(!i||x.kind!==p[i-1].kind)));assert.ok(p.filter(x=>x.provisional).length<=1);
  const fromAll=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf});
  assert.deepEqual(fromAll,engine.analyzeZigzagHarmonics(prefix,{emiten:'T',asOf}));
  for(const r of fromAll.results) {assert.ok(r.availableAt<=asOf);assert.ok(!r.confirmedAt||r.confirmedAt<=asOf);if(r.stage!=='confirmed')assert.deepEqual(r.targets,[]);}
 }
 assert.equal(JSON.stringify(bars),saved);
});
test('ties never create breakouts or repeated same-kind completed pivots',()=>{
 const bars=[bar(0,10,8),bar(1,11,9),bar(2,12,10),bar(3,12,10),bar(4,12,10),bar(5,12,7),bar(6,12,7)];
 const p=engine.getZigzagPivots(bars,2);assert.deepEqual(p.map(x=>x.index),[2,5]);assert.equal(p[0].confirmedAt,date(5));
});


test('dedup preserves periods but representative period retains its own availability facts',()=>{
 const anchors=[[0,130],[24,100],[48,200],[72,138.2],[96,183.2],[120,121.4],[168,145]];
 const bars=Array.from({length:141},(_,i)=>{let j=1;while(j<anchors.length-1&&i>anchors[j][0])j++;const [a,v]=anchors[j-1],[b,w]=anchors[j];const p=v+(w-v)*(i-a)/(b-a);return bar(i,p,p);});
 const all=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(140)}).results;
 const r=all.find(x=>x.pattern==='Gartley'&&x.stage==='confirmed')!;assert.ok(r);assert.ok(r.periods.includes(8)&&r.periods.includes(13));
 const actual=engine.getZigzagPivots(bars,r.period).find(p=>p.date===r.pivots.C!.date)!;
 assert.equal(r.pivots.C!.confirmedAt,actual.confirmedAt);assert.equal(r.availableAt,actual.confirmedAt);
 assert.equal(new Set(all.map(r=>[r.pattern,r.direction,...Object.values(r.pivots).map(p=>p!.date+':'+p!.price)].join('|'))).size,all.length);
});
test('historical pre-confirmation touch is not a retroactive signal, and later confirmed swings retire D',()=>{
 const bars=history(undefined,68);bars[49]=bar(49,190,122);
 const r=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(68)}).results.find(r=>r.pattern==='Gartley')!;
 assert.ok(r.touchedAt!<r.availableAt);assert.ok(r.availableAt>=r.pivots.C!.confirmedAt!);assert.equal(r.stage,'invalidated');assert.deepEqual(r.targets,[]);
 const subsequent=history(undefined,68);
 for(let i=69;i<=80;i++){const p=i<=72?130+(i-68)*2.5:140-(i-72)*1.875;subsequent.push(bar(i,p,p));}
 const ended=engine.analyzeZigzagHarmonics(subsequent,{emiten:'T',asOf:date(80)}).results.find(r=>r.pattern==='Gartley')!;
 assert.equal(ended.stage,'expired');assert.match(ended.reason,/Subsequent confirmed/);assert.deepEqual(ended.targets,[]);
});


test('unavailable partial-week prices never influence an earlier asOf snapshot',()=>{
 const bars=history(undefined,68),thursday=new Date(Date.parse(date(68))-86400000).toISOString().slice(0,10);
 const future={...bars[68],date:thursday,open:NaN,high:NaN,low:NaN,close:NaN};
 assert.deepEqual(engine.analyzeZigzagHarmonics([...bars.slice(0,68),future],{emiten:'T',asOf:thursday}),engine.analyzeZigzagHarmonics(bars.slice(0,68),{emiten:'T',asOf:thursday}));
});
test('representatives have unique ids even when periods share XABC but disagree about D availability',()=>{
 const anchors=[[0,130],[24,100],[48,200],[72,138.2],[96,183.2],[120,121.4],[168,145]];
 const bars=Array.from({length:129},(_,i)=>{let j=1;while(j<anchors.length-1&&i>anchors[j][0])j++;const [a,v]=anchors[j-1],[b,w]=anchors[j];const p=v+(w-v)*(i-a)/(b-a);return bar(i,p,p);});
 const results=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(128)}).results;
 assert.ok(results.some(r=>r.pattern==='Gartley'&&r.stage==='confirmed'));assert.ok(results.some(r=>r.pattern==='Gartley'&&r.stage==='prz_touched'));
 assert.equal(new Set(results.map(r=>r.id)).size,results.length);
});


test('first target consumed before delayed D reversal cannot become a fresh confirmed setup',()=>{
 const bars=history(undefined,60);bars.push(bar(61,151.5,151.5),bar(62,150,150),bar(63,152,152));
 const frozen=engine.getZigzagPivots(bars,8).find(p=>p.index===60)!;
 assert.equal(frozen.confirmedAt,date(63));
 const result=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(63)}).results.find(r=>r.pattern==='Gartley')!;
 assert.equal(result.stage,'expired');assert.equal(result.endedAt,date(61));assert.deepEqual(result.targets,[]);assert.equal(result.confirmedAt,undefined);
});
test('analysis bounds candles at 520, results at 12, and sorts newest representative availability first',()=>{
 const bars=Array.from({length:600},(_,i)=>bar(i,1000+i,990+i));
 const r=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(599)});
 assert.equal(r.candleCount,520);assert.equal(r.firstDate,date(80));assert.equal(r.lastDate,date(599));
 const scenarios=engine.analyzeZigzagHarmonics(history(undefined,84),{emiten:'T',asOf:date(84)}).results;
 assert.ok(scenarios.length<=12);assert.ok(scenarios.every((r,i)=>!i||r.availableAt<=scenarios[i-1].availableAt));
});


test('ABCD lower overlap endpoint is a valid D, not an at-boundary hard invalidation',()=>{
 const bars=history([100,200,140,170,107],68);
 const r=engine.analyzeZigzagHarmonics(bars,{emiten:'T',asOf:date(68)}).results.find(r=>r.pattern==='ABCD'&&r.periods.includes(8))!;
 assert.equal(r.prz.low,107);assert.equal(r.stage,'confirmed');assert.equal(r.pivots.D!.price,107);
});
