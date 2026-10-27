import test from 'node:test';
import assert from 'node:assert/strict';
const {loadMultiYearHistory}=await import('../lib/stockbit-weekly-history');

test('small page exhausts its date window but does not prematurely terminate earlier years',async()=>{
 const rows=[{date:'2026-10-23',open:5,high:6,low:4,close:5},{date:'2020-03-20',open:4,high:5,low:3,close:4}];
 const result=await loadMultiYearHistory('BBCA','2026-10-26',async(_,s,e)=>rows.filter(r=>r.date>=s&&r.date<=e),{cacheDir:false});
 assert.equal(result.available,true);assert.equal(result.rows.length,2);assert.ok(result.requests>=7);
});
test('wait budget fails closed without automatically retrying an uncertain provider request',async()=>{
 let calls=0;
 const result=await loadMultiYearHistory('BBCA','2026-10-26',()=>{calls++;return new Promise(()=>{})},{cacheDir:false,timeoutMs:15});
 assert.equal(result.available,false);assert.deepEqual(result.rows,[]);assert.equal(calls,1);
});
test('conflicting duplicate dates invalidate provider snapshot rather than arbitrarily picking a price',async()=>{
 const row={date:'2026-10-23',open:5,high:6,low:4,close:5};
 const result=await loadMultiYearHistory('BBCA','2026-10-26',async()=>[row,{...row,close:6}],{cacheDir:false});
 assert.equal(result.available,false);assert.deepEqual(result.rows,[]);
});
