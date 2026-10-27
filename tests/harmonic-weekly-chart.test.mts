import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,3+i*7)).toISOString().slice(0,10));
function fixture(){
 const candles=dates.map((date,i)=>({date,weekStart:new Date(Date.parse(date)-4*86400000).toISOString().slice(0,10),open:150,high:160,low:140,close:151}));
 const pivots=Object.fromEntries(['X','A','B','C'].map((k,i)=>{const index=2+i*5,kind=i%2?'high':'low';return [k,{date:dates[index],index,kind,price:kind==='high'?160:140}]}));
 const projection={pattern:'Bat',direction:'bullish',pivots,ratios:{AB_XA:.4,BC_AB:.6},prz:{low:145,high:147,evidence:['three zones']},invalidation:{price:130,condition:'Weekly low'}};
 return {status:'no_pattern',emiten:'TEST',timeframe:'1W',asOf:dates[39],source:'Saved historical daily aggregation',candles,candleCount:40,firstDate:dates[0],lastDate:dates[39],lastClose:151,reason:'Projection',methodology:'Strict weekly',partialWeekExcluded:true,completionPolicy:'Completed weeks',results:[{pattern:'Bat',scale:4,scales:[4,8],status:'no_pattern',candidate:null,watch:{stage:'projected',projection,reason:'Waiting'}}]} as any;
}
test('weekly chart preserves true 1W candles, Bat selection and undated projected D',()=>{
 const {buildWeeklyHarmonicChart}=require('../lib/harmonic-weekly-chart');
 const a=fixture(),g=buildWeeklyHarmonicChart(a,a.results[0]);
 assert.equal(g.bars.length,40);assert.equal(g.overlay.stage,'projected');
 assert.equal(g.overlay.d.date,undefined);assert.equal(g.overlay.d.price,146);assert.ok(g.overlay.d.x>g.historyRight);
 assert.equal(buildWeeklyHarmonicChart({...a,timeframe:'1D'},a.results[0]).bars.length,0);
 assert.equal(buildWeeklyHarmonicChart({...a,candles:undefined},a.results[0]).bars.length,0);
 assert.equal(buildWeeklyHarmonicChart({...a,candles:[...a.candles,{...a.candles[0],date:'2099-01-02'}]},a.results[0]).bars.length,0);
});
test('weekly panel SSR shows selection, closed-week provenance, tooltips and legacy fallback',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {HarmonicWeeklyPanel}=require('../app/components/HarmonicWeeklyPanel');
 const a=fixture();a.history={requestedStart:"2018-10-03",requestedEnd:a.asOf,dailyCandleCount:200,actualFirstDate:"2025-01-03",actualLastDate:a.lastDate,providerRequests:4,adjustmentStatus:"Unknown"};a.results.push({...a.results[0],pattern:'Gartley',scale:2,scales:[2]});
 const html=renderToStaticMarkup(React.createElement(HarmonicWeeklyPanel,{analysis:a}));
 assert.match(html,/Harmonic &amp; PRZ — Weekly Gartley \+ Bat/);assert.match(html,/<select/);assert.match(html,/Bat.*4/);assert.match(html,/OHLC 1W/);assert.match(html,/data-candle-date=/);assert.match(html,/bukan prediksi tanggal\/waktu/);assert.match(html,/Status penyesuaian/);assert.match(html,/200.*candle daily/);assert.match(html,/2018-10-03/);
 const legacy=renderToStaticMarkup(React.createElement(HarmonicWeeklyPanel,{}));assert.match(legacy,/versi Story/);assert.doesNotMatch(legacy,/<svg/);
});
test('weekly snapshot rejects incomplete calendar weeks and daily bars relabeled weekly',()=>{
 const {buildWeeklyHarmonicChart}=require('../lib/harmonic-weekly-chart');
 const a=fixture();
 assert.equal(buildWeeklyHarmonicChart({...a,asOf:dates[39].slice(0,8)+String(Number(dates[39].slice(8))-1).padStart(2,'0')},a.results[0]).bars.length,0);
 const bad={...a,candles:a.candles.map((r:any)=>({...r,weekStart:r.date}))};assert.equal(buildWeeklyHarmonicChart(bad,bad.results[0]).bars.length,0);
 const noWeeks={...a,candles:a.candles.map(({weekStart,...r}:any)=>r)};assert.equal(buildWeeklyHarmonicChart(noWeeks,noWeeks.results[0]).bars.length,0);
});
test('weekly touched D uses actual date, ended setups muted, no-pattern has no overlay',()=>{
 const {buildWeeklyHarmonicChart}=require('../lib/harmonic-weekly-chart');const a=fixture(),r=a.results[0];
 r.watch.stage='prz_touched';r.watch.provisionalD={date:dates[30],index:30,price:140,kind:'low'};
 assert.equal(buildWeeklyHarmonicChart(a,r).overlay.d.date,dates[30]);
 r.watch.stage='expired';const g=buildWeeklyHarmonicChart(a,r);assert.equal(g.overlay.active,false);assert.equal(g.overlay.muted,true);assert.equal(g.overlay.d,undefined);
 assert.equal(buildWeeklyHarmonicChart({...a,results:[]}).overlay,null);
});
