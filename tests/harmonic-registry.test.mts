import test from 'node:test';
import assert from 'node:assert/strict';
const registry = await import('../lib/harmonic-registry');
const date=(i:number)=>new Date(Date.UTC(2024,0,5+i*7)).toISOString().slice(0,10);
const points=(prices:number[],bear=false,abcd=false)=>prices.map((p,i)=>({price:bear?400-p:p,date:date(i),index:i,kind:((i+(abcd?1:0))%2===0?'low':'high') as 'low'|'high',provisional:false,confirmedAt:date(i+1)})).map(p=>bear?{...p,kind:(p.kind==='low'?'high':'low') as 'low'|'high'}:p);
for(const [pattern,prices] of Object.entries({Gartley:[100,200,138.2,183.2,121.4],Bat:[100,200,150,174.9,111.4],Butterfly:[100,200,121.4,172.822,73],ABCD:[200,140,170,110]})) {
 for(const bear of [false,true]) test(`${pattern} ${bear?'bear':'bull'} projects and matches without fake X`,()=>{
  const p=points(prices,bear,pattern==='ABCD');
  const projection=registry.projectHarmonicPRZ(p.slice(0,-1),pattern as any);
  assert.ok(projection); assert.equal(projection.direction,bear?'bearish':'bullish');
  assert.equal(projection.prz.evidence.length,pattern==='ABCD'?2:3);
  const match=registry.matchRegistryPivots(p,pattern as any); assert.ok(match);
  assert.equal(Object.keys(match.pivots).length,prices.length);
  if(pattern==='ABCD') assert.equal(match.pivots.X,undefined);
  if(pattern==='Butterfly') assert.ok(bear?match.pivots.D!.price>match.pivots.X!.price:match.pivots.D!.price<match.pivots.X!.price);
 });
}
test('matcher rejects malformed geometry, nonfinite, zero legs and unconfirmed D',()=>{
 const good=points([100,200,138.2,183.2,121.4]);
 for(const bad of [good.map((p,i)=>i===2?{...p,price:NaN}:p),good.map((p,i)=>i===2?{...p,price:200}:p),good.map((p,i)=>i===2?{...p,index:0}:p),good.map((p,i)=>i===4?{...p,provisional:true}:p),good.map((p,i)=>i===4?{...p,price:99}:p)]) assert.equal(registry.matchRegistryPivots(bad,'Gartley'),null);
 assert.equal(registry.projectHarmonicPRZ(points([100,200,138.2,162]),'Gartley'),null);
});
test('symmetric relative tolerance includes both boundaries, never a one-sided band',()=>{
 assert.equal(typeof registry.withinTolerance,'function');
 assert.ok(registry.withinTolerance(1.27*.95,1.27,.05));
 assert.ok(registry.withinTolerance(1.27*1.05,1.27,.05));
 assert.equal(registry.withinTolerance(1.27*1.051,1.27,.05),false);
 assert.equal(registry.withinTolerance(NaN,1,.05),false);
});


test('nonpositive hard-boundary policies are rejected rather than emitting impossible prices',()=>{
 assert.equal(registry.projectHarmonicPRZ(points([50,150,71.4,122.822]),'Butterfly'),null);
 assert.equal(registry.projectHarmonicPRZ(points([10,110,60,84.9]),'Bat'),null);
});


test('registry keeps exact versioned bands; zone intersection endpoints are inclusive, not broadened',()=>{
 assert.deepEqual(registry.HARMONIC_REGISTRY.Gartley.b,[.588,.648]);assert.deepEqual(registry.HARMONIC_REGISTRY.Gartley.ad,[.766,.806]);
 assert.deepEqual(registry.HARMONIC_REGISTRY.Bat.b,[.382,.5]);assert.deepEqual(registry.HARMONIC_REGISTRY.Bat.cdAB,[1.2065,1.3335]);
 assert.deepEqual(registry.HARMONIC_REGISTRY.Butterfly.b,[.756,.816]);assert.deepEqual(registry.HARMONIC_REGISTRY.Butterfly.ad,[1.24,1.3]);
 assert.deepEqual(registry.HARMONIC_REGISTRY.ABCD.cdBC,[1.13,2.618]);
 for(const family of Object.values(registry.HARMONIC_REGISTRY)) {assert.equal(family.policyVersion,registry.HARMONIC_REGISTRY_VERSION);assert.ok(family.references[0].startsWith('https://harmonictrader.com/'));}
 const good=points([100,200,138.2,183.2,121.4]),projection=registry.projectHarmonicPRZ(good.slice(0,4),'Gartley')!;
 for(const price of [projection.prz.low,projection.prz.high]) assert.ok(registry.matchRegistryPivots(good.map((p,i)=>i===4?{...p,price}:p),'Gartley'));
 for(const price of [projection.prz.low-1e-6,projection.prz.high+1e-6]) assert.equal(registry.matchRegistryPivots(good.map((p,i)=>i===4?{...p,price}:p),'Gartley'),null);
 assert.equal(registry.matchRegistryPivots(points([100,200,140,170,110]),'ABCD'),null);
});
test('ABCD invalidation description preserves inclusive PRZ endpoint semantics',()=>{
 const p=registry.projectHarmonicPRZ(points([200,140,170],false,true),'ABCD');
 assert.ok(p);assert.match(p.invalidation.condition,/strictly below/);assert.doesNotMatch(p.invalidation.condition,/at\/below/);
});

test('malformed runtime points and unknown families fail closed',()=>{
 assert.equal(registry.matchRegistryPivots([null] as any,'ABCD'),null);
 const good=points([100,200,138.2,183.2,121.4]);
 assert.equal(registry.projectHarmonicPRZ(good.slice(0,4),'toString' as any),null);
 assert.equal(registry.matchRegistryPivots(good.map((p,i)=>i===2?{...p,date:date(0)}:p),'Gartley'),null);
 assert.equal(registry.matchRegistryPivots(good.map((p,i)=>i===2?{...p,kind:'high'}:p),'Gartley'),null);
});
