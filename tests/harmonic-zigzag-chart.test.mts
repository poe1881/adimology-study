import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildZigzagChart, zigzagResultKey } = require('../lib/harmonic-zigzag-chart.ts');
import {candles,pivot,result,analysis} from './fixtures-zigzag.mjs';
test('ABCD observed ABC has no X and undated D* is illustrative only',()=>{
 const chart=buildZigzagChart(analysis,result.id); assert.equal(chart.error,null); assert.deepEqual(chart.pivots.map((p:any)=>p.label),['A','B','C']); assert.equal(chart.projection.label,'D*'); assert.equal(chart.projection.date,undefined); assert.equal(chart.projection.price,87.5); assert.ok(chart.projection.x>chart.candles.at(-1).x);
});
test('chart fails closed on bad metadata or pivot candle linkage',()=>{
 assert.ok(buildZigzagChart({...analysis,candleCount:99}).error);
 assert.ok(buildZigzagChart({...analysis,results:[{...result,pivots:{...result.pivots,A:{...result.pivots.A,price:999}}}]}).error);
});
test('no pattern still plots actual weekly OHLC',()=>{const chart=buildZigzagChart({...analysis,results:[]});assert.equal(chart.error,null);assert.equal(chart.candles.length,12);assert.equal(chart.projection,null);});

test('rejects partial week, fake weekly metadata and invalid family pivots without throwing',()=>{
 for(const a of [
 {...analysis,asOf:candles.at(-1)!.weekStart},
 {...analysis,candles:candles.map((c:any,i:number)=>i===0?{...c,weekStart:c.date}:c)},
 {...analysis,results:[{...result,pivots:undefined}]},
 {...analysis,results:[{...result,pivots:{A:result.pivots.A,B:result.pivots.B}}]},
 {...analysis,results:[{...result,periods:undefined}]},
 ]) assert.ok(buildZigzagChart(a).error);
});
test('extreme finite OHLC never creates nonfinite geometry',()=>{
 const huge=candles.map((c:any)=>({...c,open:1e308,high:1.7e308,low:1,close:1e308}));
 const chart=buildZigzagChart({...analysis,results:[],candles:huge,lastClose:1e308});
 assert.ok(chart.error || chart.candles.every((c:any)=>Number.isFinite(c.x)&&Number.isFinite(c.y)));
});
test('historical ended projections do not draw a future D',()=>{assert.equal(buildZigzagChart({...analysis,results:[{...result,stage:'expired',endedAt:analysis.lastDate}]}).projection,null);});

test('provisional ABC cannot masquerade as frozen observed pivots',()=>{
 assert.ok(buildZigzagChart({...analysis,results:[{...result,pivots:{...result.pivots,A:{...result.pivots.A,provisional:true}}}]}).error);
 assert.ok(buildZigzagChart({...analysis,source:{secret:true}}).error);
});
test('actual causal engine results link all four families in either direction at touch and confirmation',()=>{
 const {analyzeZigzagHarmonics}=require('../lib/harmonic-zigzag.ts');
 const d=(i:number)=>new Date(Date.UTC(2024,0,5+i*7)).toISOString().slice(0,10);
 for(const [pattern,prices] of Object.entries({Gartley:[100,200,138.2,183.2,121.4],Bat:[100,200,150,174.9,111.4],Butterfly:[100,200,121.4,172.822,73],ABCD:[100,200,140,170,110]})) for(const bear of [false,true]) {
  const anchors=[[0,130],...prices.map((p,i)=>[12+i*12,p]),[84,145]];
  const bars=Array.from({length:69},(_,i)=>{let j=1;while(j<anchors.length-1&&i>anchors[j][0])j++;const [a,v]=anchors[j-1],[b,w]=anchors[j];let p=v+(w-v)*(i-a)/(b-a);if(bear)p=400-p;return {date:d(i),weekStart:new Date(Date.UTC(2024,0,1+i*7)).toISOString().slice(0,10),open:p,high:p,low:p,close:p};});
  for(const end of [60,68]) {
   const a=analyzeZigzagHarmonics(bars.slice(0,end+1),{emiten:'TEST',asOf:d(end)});
   const r=a.results.find((r:any)=>r.pattern===pattern&&r.periods.includes(8));assert.ok(r,pattern);
   const chart=buildZigzagChart(a,zigzagResultKey(r));assert.equal(chart.error,null,pattern);assert.equal(chart.pivots.length,pattern==='ABCD'?4:5);assert.equal(chart.pivots.at(-1).provisional,end===60,`${pattern} ${bear} end=${end} stage=${r.stage} engineD=${JSON.stringify(r.pivots.D)} provisional=${JSON.stringify(r.provisionalD)} chartD=${JSON.stringify(chart.pivots.at(-1))}`);assert.equal(chart.projection,null);
  }
 }
});

test('362 weekly candle hover hit areas meet at midpoints without overlap',()=>{
 const bars=Array.from({length:362},(_,i)=>({date:new Date(Date.UTC(2019,0,11+i*7)).toISOString().slice(0,10),weekStart:new Date(Date.UTC(2019,0,7+i*7)).toISOString().slice(0,10),open:110,high:150,low:80,close:120}));
 const chart=buildZigzagChart({...analysis,results:[],candles:bars,candleCount:362,firstDate:bars[0].date,lastDate:bars.at(-1)!.date,asOf:bars.at(-1)!.date});
 assert.equal(chart.error,null);
 chart.candles.forEach((c:any,i:number)=>{
  assert.ok(Number.isFinite(c.hitX)&&c.hitWidth>0);
  assert.ok(c.x>=c.hitX&&c.x<=c.hitX+c.hitWidth);
  if(i>0){const p=chart.candles[i-1];assert.ok(p.hitX+p.hitWidth<=c.hitX+1e-9);assert.equal(c.hitX,(p.x+c.x)/2);}
 });
});
