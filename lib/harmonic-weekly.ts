import { isISODate, type DailyCandle, type HarmonicPivot, type HarmonicCandidate } from './harmonic';
export interface WeeklyCandle extends DailyCandle { weekStart: string }
export interface WeeklyAggregation { valid: boolean; candles: WeeklyCandle[]; partialWeekExcluded: boolean; reason: string }
/** Date-only asOf is an end-of-day snapshot, including Friday. Holiday Fridays need no fabricated bar. */
export function aggregateWeeklyCandles(daily: DailyCandle[], asOf: string): WeeklyAggregation {
 const out:WeeklyAggregation={valid:false,candles:[],partialWeekExcluded:false,reason:'Invalid date or OHLC data.'};
 if(!isISODate(asOf)||!Array.isArray(daily)) return out;
 const dates=new Map<string,DailyCandle>();
 for(const r of daily) {
  // Future dated records are irrelevant even when their prices are corrupt.
  if(r && typeof r.date==='string' && isISODate(r.date) && r.date>asOf) continue;
  if(!r || !isISODate(r.date)) return out;
  const weekday=new Date(r.date+'T00:00:00Z').getUTCDay();
  if(weekday===0||weekday===6 || ![r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0) || r.high<Math.max(r.open,r.low,r.close)||r.low>Math.min(r.open,r.high,r.close)) return out;
  const old=dates.get(r.date);
  if(old && (['open','high','low','close'] as const).some(k=>old[k]!==r[k])) return out;
  dates.set(r.date,r);
 }
 const weeks=new Map<string,WeeklyCandle>();
 for(const r of [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))) {
  const monday=new Date(r.date+'T00:00:00Z'); monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
  const weekStart=monday.toISOString().slice(0,10); const friday=new Date(monday); friday.setUTCDate(friday.getUTCDate()+4);
  if(friday.toISOString().slice(0,10)>asOf) {out.partialWeekExcluded=true;continue;}
  const w=weeks.get(weekStart);
  if(w) {w.date=r.date;w.high=Math.max(w.high,r.high);w.low=Math.min(w.low,r.low);w.close=r.close;}
  else weeks.set(weekStart,{date:r.date,weekStart,open:r.open,high:r.high,low:r.low,close:r.close});
 }
 return {...out,valid:true,candles:[...weeks.values()].slice(-520),reason:'Calendar-conservative completed Monday–Friday trading weeks; date-only Friday asOf assumes end of day. Dates are last actual trading dates; no holiday bars synthesized.'};
}
export type WeeklyPattern = 'Gartley' | 'Bat';
export interface WeeklyCandidate extends Omit<HarmonicCandidate,'pattern'> { pattern: WeeklyPattern }
export interface WeeklyProjection {
 pattern: WeeklyPattern; direction: 'bullish'|'bearish'; pivots: Record<'X'|'A'|'B'|'C',HarmonicPivot>;
 ratios: Pick<HarmonicCandidate['ratios'],'AB_XA'|'BC_AB'>; prz: HarmonicCandidate['prz']; invalidation: HarmonicCandidate['invalidation'];
}
export interface WeeklyWatch {
 stage: 'projected'|'prz_touched'|'confirmed'|'invalidated'|'expired'; projection: WeeklyProjection;
 provisionalD?: HarmonicPivot; touchedAt?: string; endedAt?: string; reason: string;
}
export interface WeeklyPatternResult {
 pattern: WeeklyPattern; scale: number; scales: number[]; status: 'pattern'|'no_pattern';
 candidate: WeeklyCandidate|null; watch: WeeklyWatch; reason: string;
}
export interface WeeklyHarmonicAnalysis {
 status: 'pattern'|'no_pattern'|'insufficient'|'unavailable'; emiten: string; source: string; timeframe: '1W'; asOf: string;
 candles: WeeklyCandle[]; candleCount: number; firstDate?: string; lastDate?: string; lastClose?: number;
 reason: string; methodology: string; results: WeeklyPatternResult[]; partialWeekExcluded: boolean;
 completionPolicy: string;
 history?: {requestedStart:string;requestedEnd:string;dailyCandleCount:number;actualFirstDate?:string;actualLastDate?:string;providerRequests:number;retrievedAt?:string;adjustmentStatus:string};
}
export const WEEKLY_HARMONIC_METHODOLOGY = 'Weekly-only limited Gartley + Bat subsets, not all harmonic patterns. Completed calendar Monday–Friday weeks (Friday date-only asOf assumes EOD; holidays use last actual trading date); max 520 weeks, minimum 30. Strict 2/4/8-week left AND right extrema; ambiguous outside bars and ties excluded; same-kind compressed; consecutive XABC/XABCD only. Latest qualifying C per pattern/scale; identical structures deduplicated; at most 8 latest/larger-scale results. Gartley unchanged implementation bands: B/XA [0.588,0.648], C/AB [0.382,0.886], CD/BC [1.272,1.618], AD/XA [0.766,0.806], CD/AB [0.95,1.05]. Bat strict subset: B/XA [0.382,0.50], C/AB [0.382,0.886], CD/BC [1.618,2.618], AD/XA [0.866,0.906], extended CD/AB 1.27 ±5% [1.2065,1.3335]. These tolerance policies are not universal canonical definitions. Three-way PRZ intersection; observed D must lie inside. XABC expires after 20 completed weekly bars; C extension and far PRZ breach invalidate; hard invalidation Gartley X, Bat A − direction × 1.13 XA (0.13 XA beyond X). Wick touches provisional, D requires scale-specific right confirmation; subsequent confirmed swing or consumed first target retires setup. No probability or backtested confidence. Provider price adjustment status is unverified; splits/corporate actions or inconsistent adjustment can distort ratios.';
const bands = {Gartley:{b:[.588,.648],d:[.766,.806],bc:[1.272,1.618],ab:[.95,1.05]},Bat:{b:[.382,.5],d:[.866,.906],bc:[1.618,2.618],ab:[1.2065,1.3335]}};
const inside=(n:number,lo:number,hi:number)=>n>=lo-1e-9&&n<=hi+1e-9;
function validPoints(p:HarmonicPivot[],n:number):boolean {
 return p.length===n && p.every((v,i)=>isISODate(v.date)&&Number.isFinite(v.price)&&v.price>0&&Number.isInteger(v.index)&&v.index>=0&&['high','low'].includes(v.kind)&&(!i||(v.index>p[i-1].index&&v.date>p[i-1].date&&v.kind!==p[i-1].kind)));
}
export function projectWeeklyPRZ(points:HarmonicPivot[],pattern:WeeklyPattern):WeeklyProjection|null {
 if(!validPoints(points,4)||!bands[pattern]) return null;
 const [X,A,B,C]=points,s=X.kind==='low'?1:-1;
 if(![A.price-X.price,A.price-B.price,C.price-B.price,B.price-X.price,A.price-C.price].every(v=>s*v>0)) return null;
 const xa=Math.abs(A.price-X.price),ab=Math.abs(A.price-B.price),bc=Math.abs(C.price-B.price),b=bands[pattern];
 if(!inside(ab/xa,...b.b as [number,number])||!inside(bc/ab,.382,.886)) return null;
 const zones=[[A.price-s*b.d[0]*xa,A.price-s*b.d[1]*xa],[C.price-s*b.bc[0]*bc,C.price-s*b.bc[1]*bc],[C.price-s*b.ab[0]*ab,C.price-s*b.ab[1]*ab]].map(z=>z.sort((a,b)=>a-b));
 const low=Math.max(...zones.map(z=>z[0])),high=Math.min(...zones.map(z=>z[1]));
 if(low>high || (s===1 ? low<=X.price||high>=B.price : high>=X.price||low<=B.price)) return null;
 const price=pattern==='Gartley'?X.price:A.price-s*1.13*xa;
 return {pattern,direction:s===1?'bullish':'bearish',pivots:{X,A,B,C},ratios:{AB_XA:ab/xa,BC_AB:bc/ab},prz:{low,high,evidence:[`XA retracement ${b.d.join('–')}`,`BC extension ${b.bc.join('–')}`,`CD/AB ${b.ab.join('–')}; three-way intersection only`]},invalidation:{price,condition:`Weekly ${s===1?'low at/below':'high at/above'} ${pattern==='Gartley'?'X':'A − direction × 1.13 XA (0.13 XA beyond X)'} invalidates. Far PRZ breach separately invalidates this strict subset; no guaranteed stop fill.`}};
}
export function matchWeeklyPivots(points:HarmonicPivot[],pattern:WeeklyPattern):WeeklyCandidate|null {
 if(!validPoints(points,5)) return null;
 const p=projectWeeklyPRZ(points.slice(0,4),pattern); if(!p) return null;
 const {X,A,B,C}=p.pivots,D=points[4],s=p.direction==='bullish'?1:-1;
 if(![C.price-D.price,B.price-D.price,D.price-X.price].every(v=>s*v>0)||!inside(D.price,p.prz.low,p.prz.high)) return null;
 const xa=Math.abs(A.price-X.price),ab=Math.abs(A.price-B.price),bc=Math.abs(C.price-B.price),cd=Math.abs(C.price-D.price);
 return {...p,pivots:{X,A,B,C,D},ratios:{...p.ratios,CD_BC:cd/bc,AD_XA:Math.abs(A.price-D.price)/xa,CD_AB:cd/ab},targets:[.382,.618].map(r=>({label:`Tentative TP ${r}`,price:D.price+s*r*Math.abs(A.price-D.price),basis:`D + direction × ${r} × |A−D|; scenario only, not guaranteed`}))};
}
function weeklyPivots(bars:WeeklyCandle[],scale:number):HarmonicPivot[] {
 const pivots:HarmonicPivot[]=[];
 for(let i=scale;i<bars.length-scale;i++) {
  const neighbors=bars.slice(i-scale,i).concat(bars.slice(i+1,i+scale+1));
  const high=neighbors.every(b=>bars[i].high>b.high),low=neighbors.every(b=>bars[i].low<b.low);
  if(high===low) continue;
  const p:HarmonicPivot={date:bars[i].date,index:i,price:high?bars[i].high:bars[i].low,kind:high?'high':'low'},last=pivots.at(-1);
  if(last?.kind===p.kind) {if(high?p.price>last.price:p.price<last.price) pivots[pivots.length-1]=p;}
  else pivots.push(p);
 }
 return pivots;
}
function assessWeekly(bars:WeeklyCandle[],pivots:HarmonicPivot[],offset:number,p:WeeklyProjection,scale:number):WeeklyPatternResult {
 const {X,A,C}=p.pivots,bull=p.direction==='bullish',s=bull?1:-1;
 const complete=matchWeeklyPivots(pivots.slice(offset,offset+5),p.pattern),d=complete?.pivots.D;
 const watch:WeeklyWatch={stage:'projected',projection:p,reason:'Convergent XABC projection only; no confirmed D or targets.'};
 const end=(stage:'invalidated'|'expired',reason:string,date:string)=>Object.assign(watch,{stage,reason,endedAt:date});
 let extreme:HarmonicPivot|undefined;
 for(let i=C.index+1;i<bars.length;i++) {
  const b=bars[i],v=bull?b.low:b.high;
  // Unknown intrabar order: adverse hard/PRZ breach wins over a simultaneous touch/target.
  if(bull?b.low<=p.invalidation.price:b.high>=p.invalidation.price) {end('invalidated','Hard structural invalidation breached; intrabar ordering is unknown.',b.date);break;}
  if(bull?v<p.prz.low-1e-9:v>p.prz.high+1e-9) {end('invalidated','Far PRZ boundary breached; strict three-way subset no longer valid.',b.date);break;}
  if(!(d&&i>d.index) && (bull?b.high>C.price:b.low<C.price)) {end('invalidated','C extended; old XABC structure invalidated.',b.date);break;}
  if(i-C.index>20) {end('expired','More than 20 completed weekly bars after C.',b.date);break;}
  if(!extreme||(bull?v<extreme.price:v>extreme.price)) extreme={date:b.date,index:i,price:v,kind:bull?'low':'high'};
  if(!watch.touchedAt && b.low<=p.prz.high && b.high>=p.prz.low) watch.touchedAt=b.date;
  if(watch.touchedAt) {
   watch.stage='prz_touched'; watch.provisionalD=extreme;watch.reason=`Observed wick/range touched PRZ; D awaits strict ${scale}-left/${scale}-right confirmation.`;
   if(extreme && i>extreme.index) {
    const target=extreme.price+s*.382*Math.abs(A.price-extreme.price);
    if(bull?b.high>=target:b.low<=target) {end('expired','First tentative target already consumed; not an active setup.',b.date);break;}
   }
  }
 }
 let candidate:WeeklyCandidate|null=null;
 if(!['invalidated','expired'].includes(watch.stage)) {
  if(pivots.length>offset+5) end('expired','Subsequent confirmed swing after D retires this structure.',bars.at(-1)!.date);
  else if(d) {
   if(Math.abs(bars.at(-1)!.close-d.price)>.15*Math.abs(A.price-X.price)) end('expired','Price moved farther than 0.15 XA from D.',bars.at(-1)!.date);
   else {watch.stage='confirmed';watch.reason=`D confirmed with strict ${scale}-week neighbors on each side; limited ${p.pattern} subset, not a prediction.`;delete watch.provisionalD;candidate=complete;}
  } else if(pivots.length>offset+4) end('expired','Next confirmed pivot does not satisfy the strict D subset.',bars.at(-1)!.date);
 }
 return {pattern:p.pattern,scale,scales:[scale],status:candidate?'pattern':'no_pattern',candidate,watch,reason:watch.reason};
}
export function analyzeWeeklyHarmonics(daily:DailyCandle[],options:{emiten:string;asOf:string}):WeeklyHarmonicAnalysis {
 const agg=aggregateWeeklyCandles(daily,options.asOf),bars=agg.candles;
 const out:WeeklyHarmonicAnalysis={status:'unavailable',emiten:options.emiten,source:'Stockbit historical summary',timeframe:'1W',asOf:options.asOf,candles:bars,candleCount:bars.length,reason:agg.reason,methodology:WEEKLY_HARMONIC_METHODOLOGY,results:[],partialWeekExcluded:agg.partialWeekExcluded,completionPolicy:'Calendar-conservative Monday–Friday; date-only Friday asOf assumes EOD; holiday Friday completion allowed with last actual trade date.'};
 if(!agg.valid) return out;
 if(bars.length) Object.assign(out,{firstDate:bars[0].date,lastDate:bars.at(-1)!.date,lastClose:bars.at(-1)!.close});
 if(bars.length<30) return {...out,status:'insufficient',reason:'At least 30 completed weekly candles are required; no price scenario generated.'};
 const found=new Map<string,WeeklyPatternResult>();
 for(const scale of [2,4,8]) {
  const pivots=weeklyPivots(bars,scale);
  for(const pattern of ['Gartley','Bat'] as const) {
   let selected:{p:WeeklyProjection;offset:number}|undefined;
   for(let i=0;i<=pivots.length-4;i++) {const p=projectWeeklyPRZ(pivots.slice(i,i+4),pattern);if(p) selected={p,offset:i};}
   if(!selected) continue;
   const r=assessWeekly(bars,pivots,selected.offset,selected.p,scale);
   const key=pattern+Object.values(selected.p.pivots).map(p=>`${p.date}:${p.kind}:${p.price}`).join('|'),old=found.get(key);
   // Largest agreeing pivot scale determines lifecycle conservatively; all detecting scales retained.
   if(old) r.scales=[...old.scales,scale];
   found.set(key,r);
  }
 }
 out.results=[...found.values()].sort((a,b)=>b.watch.projection.pivots.C.index-a.watch.projection.pivots.C.index||b.scale-a.scale||a.pattern.localeCompare(b.pattern)).slice(0,8);
 out.status=out.results.some(r=>r.status==='pattern')?'pattern':'no_pattern';
 out.reason=out.status==='pattern'?'Confirmed limited weekly harmonic subset found; see scale-specific lifecycle and caveats.':out.results.length?'No active confirmed weekly pattern; projections and retired structures are explicitly staged.':'No consecutive weekly XABC with strict three-way PRZ convergence at scales 2, 4, or 8; no price scenario generated.';
 return out;
}
