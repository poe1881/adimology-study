import {mkdir,readFile,rename,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isISODate,type DailyCandle} from './harmonic';
import type {HistoryFetcher} from './stockbit-history';
import type {WeeklyHarmonicAnalysis} from './harmonic-weekly';

export interface MultiYearHistory {
 available:boolean; emiten:string; asOf:string; requestedStart:string; rows:DailyCandle[];
 requests:number; cacheHit:boolean; reason:string; retrievedAt?:string;
}
interface HistoryOptions {cacheDir?:string|false;maxRequests?:number;timeoutMs?:number}
const shift=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const pending=new Map<string,Promise<MultiYearHistory>>();
const validRow=(r:DailyCandle)=>r&&isISODate(r.date)&&![0,6].includes(new Date(r.date).getUTCDay())&&[r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0)&&r.high>=Math.max(r.open,r.low,r.close)&&r.low<=Math.min(r.open,r.high,r.close);
function normalize(rows:DailyCandle[],start:string,end:string):DailyCandle[] {
 if(rows.length>2600||rows.some(r=>!validRow(r)||r.date<start||r.date>end))throw Error('Invalid historical snapshot');
 const unique=new Map<string,DailyCandle>();
 for(const r of rows){const old=unique.get(r.date);if(old&&(['open','high','low','close'] as const).some(k=>old[k]!==r[k]))throw Error('Conflicting historical rows');unique.set(r.date,{date:r.date,open:r.open,high:r.high,low:r.low,close:r.close})}
 return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
async function deadline<T>(promise:Promise<T>,ms:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('History wait timed out')),ms)})])}finally{if(timer)clearTimeout(timer)}
}
/** Seven-year daily retrieval via empirically supported <=364-day intervals/50 rows.
 * Date windows are exhausted before stepping backward; short pages do not truncate earlier years.
 * Fail closed on provider errors or exhausted budget. Cache is local, exact ticker/asOf,
 * atomically written, TTL 24h; no token, provider errors, or partial snapshots persisted.
 * A timeout stops waiting, not a claim that the upstream HTTP request was cancelled.
 */
export async function loadMultiYearHistory(emiten:string,asOf:string,fetcher:HistoryFetcher,options:HistoryOptions={}):Promise<MultiYearHistory>{
 const safe=/^[A-Za-z0-9]{1,12}$/.test(emiten)&&isISODate(asOf);
 const requestedStart=safe?`${String(Number(asOf.slice(0,4))-7).padStart(4,'0')}${asOf.slice(4)}`:'';
 // Feb29 -> last valid day in corresponding seventh year.
 const start=requestedStart&&!isISODate(requestedStart)?requestedStart.slice(0,8)+'28':requestedStart;
 const base:MultiYearHistory={available:false,emiten:safe?emiten.toUpperCase():'',asOf:safe?asOf:'',requestedStart:start,rows:[],requests:0,cacheHit:false,reason:'Histori multi-tahun tidak tersedia; tidak ada pola mingguan yang disimpulkan.'};
 if(!safe)return base;
 const dir=options.cacheDir===false?false:options.cacheDir??join(process.cwd(),'.local','weekly-history');
 const file=dir&&join(dir,`${base.emiten}-${asOf}-7y-v1.json`);
 if(file)try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  const age=Date.now()-Date.parse(saved.retrievedAt);
  if(saved.version===1&&saved.available===true&&saved.emiten===base.emiten&&saved.asOf===asOf&&saved.requestedStart===start&&age>=0&&age<86400000&&Array.isArray(saved.rows)&&saved.scannedToStart===true&&Number.isInteger(saved.requests)&&saved.requests>=0&&saved.requests<=48){
   const rows=normalize(saved.rows,start,asOf);
   return {...base,available:true,rows,requests:saved.requests,retrievedAt:saved.retrievedAt,cacheHit:true,reason:'Snapshot histori tujuh tahun dari cache lokal; cakupan aktual mengikuti ketersediaan provider.'};
  }
 }catch{/* Corrupt cache is never treated as market evidence. */}
 const limit=Math.max(0,Math.min(48,options.maxRequests??48));
 const until=Date.now()+Math.max(1,Math.min(45000,options.timeoutMs??45000));
 let end=asOf;const collected:DailyCandle[]=[];
 try{
  while(end>=start){
   const windowStart=shift(end,-364)>start?shift(end,-364):start;
   let cursor=end;
   while(cursor>=windowStart){
    if(base.requests>=limit||Date.now()>=until)throw Error('History budget exhausted');
    base.requests++;
    const page=await deadline(fetcher(base.emiten,windowStart,cursor,50),Math.max(1,Math.min(8000,until-Date.now())));
    if(!Array.isArray(page)||page.length>50)throw Error('Unexpected historical page');
    const normalized=normalize(page,windowStart,cursor);collected.push(...normalized);
    if(page.length<50)break;
    const oldest=normalized[0]?.date;if(!oldest)throw Error('Empty historical page');
    const next=shift(oldest,-1);if(next>=cursor)throw Error('Historical cursor not progressing');cursor=next;
   }
   end=shift(windowStart,-1);
  }
  const rows=normalize(collected,start,asOf),retrievedAt=new Date().toISOString();
  const result={...base,available:true,rows,retrievedAt,reason:'Histori harian tujuh tahun dipindai sampai awal rentang; cakupan aktual mengikuti ketersediaan provider.'};
  if(file&&dir){
   const tmp=file+'.'+randomUUID()+'.tmp';
   try{await mkdir(dir,{recursive:true});await writeFile(tmp,JSON.stringify({...result,version:1,scannedToStart:true}),{mode:0o600});await rename(tmp,file)}catch{try{await unlink(tmp)}catch{} /* Cache failure does not falsify successfully fetched data. */}
  }
  return result;
 }catch{return {...base,rows:[]}}
}
export async function getWeeklyHarmonicAnalysis(emiten:string,asOf:string):Promise<WeeklyHarmonicAnalysis>{
 const key=emiten.toUpperCase()+':'+asOf;
 let job=pending.get(key);
 if(!job){job=loadMultiYearHistory(emiten,asOf,async(...args)=>{const {fetchHistoricalSummary}=await import('./stockbit');return fetchHistoricalSummary(...args)});pending.set(key,job)}
 let history:MultiYearHistory;
 try{history=await job}finally{pending.delete(key)}
 const {analyzeWeeklyHarmonics}=await import('./harmonic-weekly');
 const analysis=analyzeWeeklyHarmonics(history.rows,{emiten:history.emiten||emiten,asOf});
 if(!history.available)return {...analysis,status:'unavailable',reason:history.reason,results:[]};
 return {...analysis,source:'Stockbit daily historical summary → completed weekly OHLC',history:{requestedStart:history.requestedStart,requestedEnd:asOf,dailyCandleCount:history.rows.length,actualFirstDate:history.rows[0]?.date,actualLastDate:history.rows.at(-1)?.date,providerRequests:history.requests,retrievedAt:history.retrievedAt,adjustmentStatus:'Provider adjustment status unverified; corporate actions can distort ratios.'}} as WeeklyHarmonicAnalysis;
}
