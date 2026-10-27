import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const date=(i:number)=>new Date(Date.UTC(2019,0,1+i)).toISOString().slice(0,10);
const rows=Array.from({length:2860},(_,i)=>({date:date(i),open:100,high:102,low:99,close:101})).filter(r=>![0,6].includes(new Date(r.date).getUTCDay()));

test('multi-year adapter paginates bounded 364-day queries across all seven years and reuses exact snapshot cache',async()=>{
 const mod=await import('../lib/stockbit-weekly-history');
 assert.equal(typeof mod.loadMultiYearHistory,'function');
 const dir=await mkdtemp(join(tmpdir(),'weekly-cache-'));const calls:any[]=[];
 const fetcher=async(t:string,start:string,end:string,limit:number)=>{calls.push({t,start,end,limit});return rows.filter(r=>r.date>=start&&r.date<=end).slice(-limit).reverse()};
 try{
  const first=await mod.loadMultiYearHistory('BBCA','2026-10-26',fetcher,{cacheDir:dir});
  assert.equal(first.available,true);assert.equal(first.requestedStart,'2019-10-26');
  assert.ok(first.rows.length>1500);assert.equal(first.rows[0].date,'2019-10-28');
  assert.ok(calls.length<=48&&calls.length>30);
  assert.ok(calls.every(c=>c.limit===50&&(Date.parse(c.end)-Date.parse(c.start))/86400000<=364));
  assert.ok(first.rows.every((r:any,i:number)=>r.date<='2026-10-26'&&(!i||r.date>first.rows[i-1].date)));
  const savedCount=calls.length;
  const cached=await mod.loadMultiYearHistory('BBCA','2026-10-26',fetcher,{cacheDir:dir});
  assert.equal(calls.length,savedCount);assert.deepEqual(cached.rows,first.rows);assert.equal(cached.cacheHit,true);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('provider failure never presents partial multi-year data as available',async()=>{
 const {loadMultiYearHistory}=await import('../lib/stockbit-weekly-history');let n=0;
 const result=await loadMultiYearHistory('BBCA','2026-10-26',async()=>{if(++n===2)throw Error('private-provider-detail');return rows.slice(-50)},{cacheDir:false});
 assert.equal(result.available,false);assert.deepEqual(result.rows,[]);assert.doesNotMatch(JSON.stringify(result),/private-provider-detail/);
});
test('validates identifiers, conflicting prices and request budget before claiming a full scan',async()=>{
 const {loadMultiYearHistory}=await import('../lib/stockbit-weekly-history');let n=0;
 const fetcher=async()=>{n++;return rows.slice(-50)};
 assert.equal((await loadMultiYearHistory('../bad','2026-10-26',fetcher,{cacheDir:false})).available,false);assert.equal(n,0);
 const budget=await loadMultiYearHistory('BBCA','2026-10-26',fetcher,{cacheDir:false,maxRequests:1});assert.equal(budget.available,false);
 const malformed=await loadMultiYearHistory('BBCA','2026-10-26',async()=>[{date:'2026-10-23',open:100,high:90,low:99,close:101}],{cacheDir:false});assert.equal(malformed.available,false);
});
test('corrupt cache and incomplete envelopes trigger fresh read, never silent stale substitution',async()=>{
 const {loadMultiYearHistory}=await import('../lib/stockbit-weekly-history');const dir=await mkdtemp(join(tmpdir(),'weekly-corrupt-'));let n=0;
 const fetcher=async(t:string,s:string,e:string,l:number)=>{n++;return rows.filter(r=>r.date>=s&&r.date<=e).slice(-l)};
 try{
  await loadMultiYearHistory('BBCA','2026-10-26',fetcher,{cacheDir:dir});const previous=n;
  const file=(await readdir(dir)).find(f=>f.endsWith('.json'))!;await writeFile(join(dir,file),'{broken');
  const result=await loadMultiYearHistory('BBCA','2026-10-26',fetcher,{cacheDir:dir});assert.equal(result.available,true);assert.ok(n>previous);
 }finally{await rm(dir,{recursive:true,force:true})}
});
