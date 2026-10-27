import type { WeeklyCandle } from './harmonic-weekly';
import { isISODate } from './harmonic';
import { HARMONIC_REGISTRY_VERSION, SUPPORTED_HARMONIC_PATTERNS, projectHarmonicPRZ, matchRegistryPivots, type HarmonicPattern, type HarmonicProjection, type ZigzagPivot } from './harmonic-registry';
export type { ZigzagPivot } from './harmonic-registry';
export const ZIGZAG_METHOD_VERSION='causal-weekly-lookback-v1';
export const ZIGZAG_PERIODS=[8,13,21,34,55] as const;
export interface ZigzagPatternResult extends HarmonicProjection {
 id:string; periods:number[]; period:number; stage:'projected'|'prz_touched'|'confirmed'|'invalidated'|'expired';
 targets:{label:string;price:number;basis:string}[]; reason:string; availableAt:string;
 confirmedAt?:string; touchedAt?:string; endedAt?:string; provisionalD?:ZigzagPivot;
}
export interface ZigzagHarmonicAnalysis {
 status:'pattern'|'no_pattern'|'insufficient'|'unavailable'; emiten:string; asOf:string; timeframe:'1W';source:string;
 candles:WeeklyCandle[]; candleCount:number; firstDate?:string;lastDate?:string;lastClose?:number;
 registryVersion:string; methodology:string; experimental:true; supportedPatterns:HarmonicPattern[]; results:ZigzagPatternResult[];reason:string;
}
/** Strict prior-period breakouts. Ambiguous outside bars are skipped entirely.
 * Exactly one terminal is provisional; reversal freezes the prior pivot at the availability date.
 * No seed before a complete lookback; O(n × period), bounded weekly snapshots. */
export function getZigzagPivots(candles:WeeklyCandle[],period:number):ZigzagPivot[] {
 if(!Number.isInteger(period)||period<1||period>520) throw new RangeError('period must be an integer in [1,520]');
 if(!Array.isArray(candles)||candles.length>520||candles.some((b,i)=>!validWeekly(b)||(i>0&&(b.date<=candles[i-1].date||b.weekStart<=candles[i-1].weekStart)))) throw new TypeError('Expected at most 520 chronological valid weekly candles');
 const pivots:ZigzagPivot[]=[];
 for(let i=period;i<candles.length;i++) {
  const b=candles[i];let high=true,low=true;
  for(let j=i-period;j<i;j++) {high=high&&b.high>candles[j].high;low=low&&b.low<candles[j].low;}
  if(high===low) continue;
  const p:ZigzagPivot={date:b.date,index:i,price:high?b.high:b.low,kind:high?'high':'low',provisional:true};
  const last=pivots.at(-1);
  if(!last) pivots.push(p);
  else if(last.kind===p.kind) {if(high?p.price>last.price:p.price<last.price) pivots[pivots.length-1]=p;}
  else if(high?p.price>last.price:p.price<last.price) {pivots[pivots.length-1]={...last,provisional:false,confirmedAt:weeklyAvailableDate(b)};pivots.push(p);}
 }
 return pivots;
}


/** Weekly OHLC is usable only once Friday EOD is available, including holiday-short weeks. */
export function weeklyAvailableDate(b:WeeklyCandle):string {
 return new Date(Date.parse(b.weekStart+'T00:00:00Z')+4*86400000).toISOString().slice(0,10);
}
function validWeeklyMetadata(b:WeeklyCandle):boolean {
 if(!b||!isISODate(b.date)||!isISODate(b.weekStart)) return false;
 const start=new Date(b.weekStart+'T00:00:00Z');
 return start.getUTCDay()===1&&b.date>=b.weekStart&&b.date<=weeklyAvailableDate(b);
}
function validWeekly(b:WeeklyCandle):boolean {
 return validWeeklyMetadata(b)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.low,b.close)&&b.low<=Math.min(b.open,b.high,b.close);
}
export const ZIGZAG_METHODOLOGY=`Experimental ${ZIGZAG_METHOD_VERSION}; weekly only. Periods 8/13/21/34/55; strict prior-period high/low breakouts, ties do not break out, dual outside bars skipped. Warmup needs full lookback, no synthetic X. Exactly one provisional terminal may repaint; prior pivot freezes on opposite breakout, confirmedAt is reversal week's Friday EOD (holiday actual pivot dates retained). C must be confirmed before projection becomes available. Four families follow ${HARMONIC_REGISTRY_VERSION}; Gartley and Bat strict bands preserved, Butterfly narrow chosen subset; ABCD uses four actual points and two zones, no XA. Historical touches before C confirmation are not retroactive signals. Far PRZ breach, hard boundary or C extension invalidates; consumed first target or later confirmed swing retires; age >52 completed weekly bars after C expires. Adverse breach wins ambiguous intrabar ordering; no target on touch bar. Max 520 candles, latest qualifying C per family/period, 12 newest deduplicated structures, periods preserved. No probability, backtested confidence, trade recommendation or guaranteed stop fills. Provider adjustment status unverified; corporate actions may distort ratios. Date-only Friday asOf assumes EOD.`;
export function analyzeZigzagHarmonics(candles:WeeklyCandle[],options:{emiten:string;asOf:string}):ZigzagHarmonicAnalysis {
 const out:ZigzagHarmonicAnalysis={status:'unavailable',emiten:options.emiten,asOf:options.asOf,timeframe:'1W',source:'Provided completed weekly OHLC; price adjustment unverified',candles:[],candleCount:0,registryVersion:HARMONIC_REGISTRY_VERSION,methodology:ZIGZAG_METHODOLOGY,experimental:true,supportedPatterns:[...SUPPORTED_HARMONIC_PATTERNS],results:[],reason:'Invalid weekly metadata, date, OHLC or conflicting duplicate.'};
 if(!isISODate(options.asOf)||!Array.isArray(candles)) return out;
 const weeks=new Map<string,WeeklyCandle>();
 for(const b of candles) {
  if(!b||!isISODate(b.date)) return out;
  if(b.date>options.asOf) continue;
  if(!validWeeklyMetadata(b)) return out;
  if(weeklyAvailableDate(b)>options.asOf) continue;
  if(!validWeekly(b)) return out;
  const old=weeks.get(b.weekStart);
  if(old&&(['date','open','high','low','close'] as const).some(k=>old[k]!==b[k])) return out;
  weeks.set(b.weekStart,{date:b.date,weekStart:b.weekStart,open:b.open,high:b.high,low:b.low,close:b.close});
 }
 const bars=[...weeks.values()].sort((a,b)=>a.weekStart.localeCompare(b.weekStart)).slice(-520);
 Object.assign(out,{candles:bars,candleCount:bars.length,...(bars.length?{firstDate:bars[0].date,lastDate:bars.at(-1)!.date,lastClose:bars.at(-1)!.close}:{})});
 if(bars.length<30) return {...out,status:'insufficient',reason:'At least 30 completed weekly candles required; longer periods need their own warmup.'};
 const found=new Map<string,ZigzagPatternResult>();
 for(const period of ZIGZAG_PERIODS) {
  const pivots=getZigzagPivots(bars,period),confirmed=pivots.filter(p=>!p.provisional);
  for(const pattern of SUPPORTED_HARMONIC_PATTERNS) {
   const size=pattern==='ABCD'?3:4;
   let latest:{projection:HarmonicProjection;offset:number}|undefined;
   for(let offset=0;offset<=confirmed.length-size;offset++) {
    const projection=projectHarmonicPRZ(confirmed.slice(offset,offset+size),pattern);
    if(projection) latest={projection,offset};
   }
   if(!latest) continue;
   const r=assessLifecycle(bars,confirmed,latest.offset,latest.projection,period);
   const key=structureKey(r,true),old=found.get(key);
   // period remains the first (smallest) representative: all timing/stage facts belong to it.
   // periods records shared geometry, not independent evidence or statistical confidence.
   if(old) old.periods.push(period);
   else found.set(key,r);
  }
 }
 out.results=[...found.values()].sort((a,b)=>b.availableAt.localeCompare(a.availableAt)||b.pivots.C!.date.localeCompare(a.pivots.C!.date)||b.period-a.period||a.id.localeCompare(b.id)).slice(0,12);
 out.status=out.results.some(r=>r.stage==='confirmed')?'pattern':'no_pattern';
 out.reason=out.results.length?'Experimental strict subsets only; stages describe observed lifecycle, not likelihood or recommendation.':'No strict convergent harmonic structure.';
 return out;
}


function structureKey(p:HarmonicProjection,includeD=false):string {
 return [p.pattern,p.direction,...(['X','A','B','C',...(includeD?['D']:[])] as const).map(k=>{const v=p.pivots[k as keyof typeof p.pivots];return v?`${k}:${v.date}:${v.price}`:'';})].join('|');
}
function assessLifecycle(bars:WeeklyCandle[],confirmed:ZigzagPivot[],offset:number,p:HarmonicProjection,period:number):ZigzagPatternResult {
 const size=p.pattern==='ABCD'?3:4,C=p.pivots.C!,A=p.pivots.A!,s=p.direction==='bullish'?1:-1,bull=s===1;
 const next=confirmed[offset+size],match=next?matchRegistryPivots(confirmed.slice(offset,offset+size+1),p.pattern):null;
 const later=confirmed[offset+size+1];
 const r:ZigzagPatternResult={...p,id:`${structureKey(p)}|representative:${period}`,period,periods:[period],stage:'projected',targets:[],availableAt:C.confirmedAt!,reason:'Confirmed C; strict convergent PRZ projection only, no D or targets.'};
 let extreme:ZigzagPivot|undefined;
 const end=(stage:'invalidated'|'expired',reason:string,date:string)=>{r.stage=stage;r.reason=reason;r.endedAt=date;r.targets=[];};
 for(let i=C.index+1;i<bars.length;i++) {
  const b=bars[i],available=weeklyAvailableDate(b),v=bull?b.low:b.high;
  if(!extreme||(bull?v<extreme.price:v>extreme.price)) extreme={date:b.date,index:i,price:v,kind:bull?'low':'high',provisional:true};
  // Retain historical touch information even if it predates C's availability or loses to an adverse breach.
  if(!r.touchedAt&&b.low<=p.prz.high&&b.high>=p.prz.low) r.touchedAt=available;
  if(p.pattern!=='ABCD'&&(bull?b.low<=p.invalidation.price:b.high>=p.invalidation.price)) {end('invalidated','Hard structural boundary breached; adverse event wins unknown intrabar ordering.',available);break;}
  if(bull?v<p.prz.low-1e-9:v>p.prz.high+1e-9) {end('invalidated','Far PRZ boundary breached; strict subset retired permanently.',available);break;}
  if((!r.touchedAt||i===extreme.index)&&(bull?b.high>C.price:b.low<C.price)) {end('invalidated','C extended; old projection retired, not recycled.',available);break;}
  if(i-C.index>52) {end('expired','More than 52 completed weekly bars after C; explicit age policy.',available);break;}
  if(r.touchedAt) {
   r.stage='prz_touched';r.provisionalD={...extreme};r.reason='Observed PRZ touch only; terminal D can repaint until opposite breakout.';
   const target=extreme.price+s*.382*Math.abs(A.price-extreme.price);
   // Touch and target on one OHLC bar have unknown order; no target inference on that bar.
   if(i>extreme.index&&(bull?b.high>=target:b.low<=target)) {end('expired','First tentative target already consumed, possibly before delayed D confirmation; not active.',available);break;}
  }
  if(next?.confirmedAt&&available>=next.confirmedAt) {
   if(!match) {end('expired','Next frozen pivot fails strict D ratios; do not reactivate an older projection.',available);break;}
   Object.assign(r,{pivots:match.pivots,ratios:match.ratios,targets:match.targets,stage:'confirmed',confirmedAt:next.confirmedAt,reason:'D frozen at actual opposite-lookback reversal availability; strict experimental match only.'});
   delete r.provisionalD;
  }
  if(later?.confirmedAt&&available>=later.confirmedAt) {end('expired','Subsequent confirmed swing retires the matched historical D; never reactivated.',available);break;}
 }
 if(r.stage==='invalidated'||r.stage==='expired') {r.targets=[];delete r.provisionalD;}
 return r;
}
