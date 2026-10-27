import test from 'node:test';
import assert from 'node:assert/strict';
import type { DailyCandle } from '../lib/harmonic';
const {analyzeHarmonics}=await import('../lib/harmonic');

const dates=Array.from({length:240},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));
const flat=(n=40):DailyCandle[]=>dates.slice(0,n).map(date=>({date,open:140,high:141,low:139,close:140}));
// Controlled fixtures, not market data.
function setup(bearish=false,touched=false,confirmed=false) {
  const anchors=[[0,140],[10,120],[12,100],[18,200],[24,138.2],[30,183.2],[39,touched||confirmed?121.4:135],[41,128]];
  const rows=Array.from({length:confirmed?42:40},(_,i)=>{
    const k=anchors.findIndex(a=>a[0]>=i),a=anchors[Math.max(0,k-1)],b=anchors[k];
    let v=a[1]+(b[1]-a[1])*(i-a[0])/(b[0]-a[0]||1); if(bearish)v=300-v;
    return {date:dates[i],open:v,high:v,low:v,close:v};
  });
  if(touched) rows[39]=bearish?{date:dates[39],open:170,close:170,low:170,high:178.6}:{date:dates[39],open:130,close:130,low:121.4,high:130};
  return analyzeHarmonics(rows,{emiten:'TEST',asOf:dates[rows.length-1]});
}
test('geometry links observed pivots by candle date and projects D into an undated PRZ area in either direction',async()=>{
  const chart=await import('../lib/harmonic-chart');
  assert.equal(typeof chart.buildHarmonicChart,'function');
  for(const bearish of [false,true]) {
    const a=setup(bearish),g=chart.buildHarmonicChart(a);
    assert.equal(a.watch?.stage,'projected');
    assert.equal(g.overlay?.stage,'projected');
    assert.equal(g.overlay?.points.length,4);
    const c=g.overlay!.points[3],d=g.overlay!.d!;
    assert.equal(d.label,'D*');assert.equal(d.date,undefined);
    assert.equal(d.illustrative,true);assert.ok(d.x>g.historyRight);
    assert.ok(bearish?d.price>c.price:d.price<c.price);
    assert.ok(bearish?d.y<c.y:d.y>c.y);
    for(const p of g.overlay!.points) assert.equal(p.x,g.bars.find(b=>b.date===p.date)!.x);
  }
});
test('SSR panel integrates actual candles with accessible OHLC, dates and honest no-pattern or legacy fallback',async()=>{
  const {HarmonicPanel}=await import('../app/components/HarmonicPanel');
  const {createElement}=await import('react'); const {renderToStaticMarkup}=await import('react-dom/server');
  const a=analyzeHarmonics(flat(),{emiten:'TEST',asOf:dates[39]});
  const html=renderToStaticMarkup(createElement(HarmonicPanel,{analysis:a}));
  assert.match(html,/<svg/);assert.match(html,/data-candle-date="2026-01-01"/);
  assert.match(html,/O 140.*H 141.*L 139.*C 140/);
  assert.match(html,/Tidak ada kandidat harmonic yang memenuhi syarat/);assert.match(html,/Gartley.*1D/);
  assert.doesNotMatch(html,/D\*|data-prz-active/);
  const {candles,...legacy}=a;
  const old=renderToStaticMarkup(createElement(HarmonicPanel,{analysis:legacy}));
  assert.match(old,/Data chart tidak tersedia untuk versi tersimpan/);assert.doesNotMatch(old,/<svg/);
});
test('wick D stays provisional at actual date; confirmed D joins the solid observed line',async()=>{
  const {buildHarmonicChart}=await import('../lib/harmonic-chart');
  const {HarmonicChart}=await import('../app/components/HarmonicChart');
  const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
  for(const bearish of [false,true]) {
    const a=setup(bearish,true),g=buildHarmonicChart(a);
    assert.equal(g.overlay?.stage,'prz_touched');assert.equal(g.overlay?.d?.label,'D provisional');
    assert.equal(g.overlay?.d?.date,dates[39]);assert.equal(g.overlay?.d?.illustrative,undefined);
    assert.equal(g.overlay?.points.length,4);assert.equal(a.candidate,null);
    const html=renderToStaticMarkup(createElement(HarmonicChart,{analysis:a}));
    assert.match(html,/data-harmonic-line="unfinished"/);assert.doesNotMatch(html,/data-illustrative-area/);
    const confirmed=setup(bearish,false,true),c=buildHarmonicChart(confirmed);
    assert.equal(c.overlay?.stage,'confirmed');assert.equal(c.overlay?.points.at(-1)?.label,'D');
    assert.equal(c.overlay?.points.at(-1)?.date,dates[39]);assert.equal(c.overlay?.d,undefined);
    assert.doesNotMatch(renderToStaticMarkup(createElement(HarmonicChart,{analysis:confirmed})),/data-harmonic-line="unfinished"/);
  }
});
test('ended setups are muted historical overlays without active PRZ, projected D or targets',async()=>{
  const {buildHarmonicChart}=await import('../lib/harmonic-chart');
  const {HarmonicChart}=await import('../app/components/HarmonicChart');
  const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
  for(const stage of ['invalidated','expired'] as const) {
    const a=setup();a.watch!.stage=stage;
    const g=buildHarmonicChart(a);assert.equal(g.overlay?.muted,true);assert.equal(g.overlay?.active,false);assert.equal(g.overlay?.d,undefined);
    const html=renderToStaticMarkup(createElement(HarmonicChart,{analysis:a}));
    assert.match(html,/Overlay historis.*tanpa target aktif/);assert.match(html,/data-prz-historical="true"/);
    assert.doesNotMatch(html,/data-prz-active|data-illustrative-area/);
  }
});
test('only complete Gartley daily overlays render; malformed saved overlays fail closed without losing OHLC',async()=>{
  const {buildHarmonicChart}=await import('../lib/harmonic-chart');
  for(const mutate of [(a:any)=>a.watch.projection.pattern='Bat',(a:any)=>delete a.watch.projection.pivots.C,(a:any)=>delete a.watch.projection.prz]) {
    const a=setup();mutate(a);
    const g=buildHarmonicChart(a);assert.equal(g.bars.length,40);assert.equal(g.overlay,null);
  }
});
test('geometry rejects inconsistent snapshot metadata and unlinked pivots rather than mislabelling data',async()=>{
  const {buildHarmonicChart}=await import('../lib/harmonic-chart');
  const a=setup();
  assert.equal(buildHarmonicChart({...a,candleCount:199}).bars.length,0);
  a.watch!.projection.pivots.X.date=dates[0]; // Price is not the actual candle extreme on this date.
  assert.equal(buildHarmonicChart(a).overlay,null);
});
test('empty, corrupt and extreme finite prices always produce safe finite chart geometry',async()=>{
  const {buildHarmonicChart}=await import('../lib/harmonic-chart');
  const a=setup();
  for(const candles of [[],[{...a.candles![0],high:Infinity}],[{...a.candles![0],close:NaN}],[{...a.candles![0],date:'bad'}],[{...a.candles![0],date:'2099-01-01'}]]) {
    const g=buildHarmonicChart({...a,candles});assert.equal(g.bars.length,0);assert.equal(g.overlay,null);assert.ok(!/NaN|Infinity/.test(JSON.stringify(g)));
  }
  for(const value of [Number.MAX_VALUE,Number.MIN_VALUE,100]) {
    const rows=flat().map(r=>({...r,open:value,high:value,low:value,close:value}));
    const g=buildHarmonicChart(analyzeHarmonics(rows,{emiten:'TEST',asOf:dates[39]}));
    assert.equal(g.bars.length,40);
    assert.ok(g.ticks.every(t=>Number.isFinite(t.price)&&Number.isFinite(t.y)));
    assert.ok(g.bars.every(b=>[b.x,b.lowY,b.highY,b.openY,b.closeY].every(Number.isFinite)));
  }
});
test('chart is self-contained for responsive scrolling and light/dark contrast without utility CSS',async()=>{
  const {HarmonicChart}=await import('../app/components/HarmonicChart');
  const {createElement}=await import('react'); const {renderToStaticMarkup}=await import('react-dom/server');
  const html=renderToStaticMarkup(createElement(HarmonicChart,{analysis:setup()}));
  assert.match(html,/overflow-x:auto/);
  assert.match(html,/display:flex;flex-wrap:wrap/);
  assert.match(html,/color-mix\(in srgb/);
});

test('analysis persists a bounded sorted unique copied OHLC snapshot, including no pattern',()=>{
  const rows=flat(240), a=analyzeHarmonics([...rows].reverse().concat(rows[239]),{emiten:'TEST',asOf:dates[239]});
  assert.equal(a.candles?.length,200);
  assert.equal(a.candleCount,200);
  assert.deepEqual(a.candles?.map(r=>r.date),dates.slice(40));
  assert.equal(a.status,'no_pattern');
  rows[239].close=999;
  assert.equal(a.candles?.at(-1)?.close,140);
  assert.deepEqual(analyzeHarmonics([{...flat()[0],high:Infinity}],{emiten:'TEST',asOf:dates[39]}).candles,[]);
});
