/** Daily OHLC only. Automated limited Gartley approximation, not backtested.
 * Primary references: https://harmonictrader.com/harmonic-patterns/gartley-pattern/
 * https://harmonictrader.com/harmonicpatternorigin/
 * Our explicit tolerance bands are implementation policy, not a claim of canonical certification. */
export interface DailyCandle { date: string; open: number; high: number; low: number; close: number }
export interface HarmonicPivot { date: string; price: number; kind: 'high' | 'low'; index: number }
export interface HarmonicCandidate {
  pattern: 'Gartley'; direction: 'bullish' | 'bearish';
  pivots: Record<'X' | 'A' | 'B' | 'C' | 'D', HarmonicPivot>;
  ratios: { AB_XA: number; BC_AB: number; CD_BC: number; AD_XA: number; CD_AB: number };
  prz: { low: number; high: number; evidence: string[] };
  invalidation: { price: number; condition: string };
  targets: { label: string; price: number; basis: string }[];
}
export interface GartleyProjection {
  pattern: 'Gartley'; direction: 'bullish' | 'bearish';
  pivots: Record<'X' | 'A' | 'B' | 'C', HarmonicPivot>;
  ratios: Pick<HarmonicCandidate['ratios'], 'AB_XA' | 'BC_AB'>;
  prz: HarmonicCandidate['prz']; invalidation: HarmonicCandidate['invalidation'];
}
export interface HarmonicWatch {
  stage: 'projected' | 'prz_touched' | 'confirmed' | 'invalidated' | 'expired';
  projection: GartleyProjection;
  provisionalD?: HarmonicPivot; // Observed extreme only; NEVER a confirmed pivot.
  touchedAt?: string; endedAt?: string; reason: string;
}
export interface HarmonicAnalysis {
  status: 'pattern' | 'no_pattern' | 'insufficient' | 'unavailable';
  emiten: string; source: string; timeframe: '1D'; asOf: string;
  /** Authoritative, bounded OHLC snapshot persisted with this exact analysis. Absent on older stories. */
  candles?: DailyCandle[];
  candleCount: number; firstDate?: string; lastDate?: string; lastClose?: number;
  candidate: HarmonicCandidate | null; watch?: HarmonicWatch | null; reason: string; methodology: string;
}
export const HARMONIC_METHODOLOGY = 'Confirmed strict OHLC extrema: 2 candles left + 2 right; same-kind extrema compressed; consecutive XABC projections / XABCD confirmation only. XABC expires >20 bars after C; C extension or far PRZ breach invalidates. Wick touches are provisional until strict D confirmation; consumed target movements expire, not price-invalidated. Latest qualifying C only; no fallback to older setups; a subsequent confirmed swing after D retires the old setup. Gartley subset: AB/XA 0.618 ±0.030; BC/AB [0.382,0.886]; CD/BC [1.272,1.618]; AD/XA 0.786 ±0.020; CD/AB [0.95,1.05] (AB=CD approximation). PRZ is intersection of XA retracement and BC extension and AB=CD ±5% ranges. D must lie inside; latest close must be within 0.15 XA of D; D <=20 bars old. No backtested confidence. Prices are unadjusted provider OHLC; corporate actions can distort ratios.';
export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}

export function analyzeHarmonics(rows: DailyCandle[], options: {emiten: string; asOf: string}): HarmonicAnalysis {
  const result: HarmonicAnalysis={status:'unavailable',emiten:options.emiten,source:'Stockbit historical summary',timeframe:'1D',asOf:options.asOf,candles:[],candleCount:0,candidate:null,reason:'Invalid date or OHLC data.',methodology:HARMONIC_METHODOLOGY};
  if (!isISODate(options.asOf) || !Array.isArray(rows)) return result;
  // Filter before validation/pivot confirmation: a future bar never affects this snapshot.
  const relevant=rows.filter(r=>r && typeof r.date==='string' && r.date<=options.asOf);
  if (rows.some(r=>!r || !isISODate(r.date)) || relevant.some(r=>![r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0) || r.high<Math.max(r.open,r.close,r.low) || r.low>Math.min(r.open,r.close,r.high))) return result;
  const byDate=new Map<string,DailyCandle>();
  for (const r of relevant) {
    const prior=byDate.get(r.date);
    if (prior && ['open','high','low','close'].some(k=>prior[k as keyof DailyCandle]!==r[k as keyof DailyCandle])) return result;
    byDate.set(r.date,r);
  }
  const bars=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-200)
    .map(({date,open,high,low,close})=>({date,open,high,low,close}));
  result.candles=bars;
  result.candleCount=bars.length;
  if (bars.length) Object.assign(result,{firstDate:bars[0].date,lastDate:bars.at(-1)!.date,lastClose:bars.at(-1)!.close});
  if(bars.length<30) return {...result,status:'insufficient',reason:'At least 30 valid daily candles are required; no price scenario generated.'};
  const pivots: HarmonicPivot[]=[];
  for(let i=2;i<bars.length-2;i++) {
    const neighbors=[bars[i-2],bars[i-1],bars[i+1],bars[i+2]];
    const high=neighbors.every(b=>bars[i].high>b.high),low=neighbors.every(b=>bars[i].low<b.low);
    if(high===low) continue; // outside bars ambiguous; ties are not confirmed pivots
    const p:HarmonicPivot={date:bars[i].date,price:high?bars[i].high:bars[i].low,kind:high?'high':'low',index:i};
    const prior=pivots.at(-1);
    if(prior?.kind===p.kind) { if(p.kind==='high'?p.price>prior.price:p.price<prior.price) pivots[pivots.length-1]=p; }
    else pivots.push(p);
  }
  // Latest qualifying C wins. Never fall back to an older active-looking setup.
  let selected: { projection: GartleyProjection; offset: number } | undefined;
  for(let i=0;i<=pivots.length-4;i++) {
    const projection=projectGartleyPRZ(pivots.slice(i,i+4));
    if(projection) selected={projection,offset:i};
  }
  if(!selected) return {...result,status:'no_pattern',watch:null,reason:'No unambiguous consecutive XABC with three-way PRZ convergence; no price scenario generated.'};
  const {projection:p,offset}=selected,{X,A,C}=p.pivots,bull=p.direction==='bullish';
  const complete=matchHarmonicPivots(pivots.slice(offset,offset+5));
  const watch:HarmonicWatch={stage:'projected',projection:p,reason:'Kandidat XABC; PRZ proyeksi belum tersentuh. D belum terkonfirmasi.'};
  let extreme:HarmonicPivot | undefined;
  const end=(stage:'invalidated'|'expired',reason:string,date:string)=>Object.assign(watch,{stage,reason,endedAt:date});
  for(let i=C.index+1;i<bars.length;i++) {
    const b=bars[i],v=bull?b.low:b.high;
    // OHLC cannot order intrabar events: X breach always wins, even on a touch bar.
    if(bull?b.low<=X.price:b.high>=X.price) {end('invalidated','Batas X dilanggar; urutan intrabar tidak diketahui jika PRZ juga tersentuh.',b.date);break;}
    if(!extreme || (bull?v<extreme.price:v>extreme.price)) extreme={date:b.date,price:v,kind:bull?'low':'high',index:i};
    if(!watch.touchedAt && b.low<=p.prz.high && b.high>=p.prz.low) watch.touchedAt=b.date;
    if(watch.touchedAt) watch.provisionalD=extreme;
    const d=complete?.pivots.D;
    const afterD=d && i>d.index;
    if(!afterD && (bull?b.high>C.price:b.low<C.price)) {end('invalidated','Pivot C dilampaui/diganti; struktur XABC lama tidak berlaku.',b.date);break;}
    if(bull?v<p.prz.low-1e-9:v>p.prz.high+1e-9) {end('invalidated','Harga melewati sisi jauh PRZ; calon D tidak lagi memenuhi konvergensi.',b.date);break;}
    if(watch.touchedAt && extreme && i>extreme.index) {
      const target=extreme.price+(bull?1:-1)*.382*Math.abs(A.price-extreme.price);
      if(bull?b.high>=target:b.low<=target) {end('expired','Pergerakan sudah mencapai target pertama; bukan invalidasi harga dan bukan setup aktif.',b.date);break;}
    }
    if(watch.touchedAt) {watch.stage='prz_touched';watch.reason='PRZ tersentuh wick/rentang OHLC; D provisional, menunggu pivot ketat 2 kiri + 2 kanan.';}
  }
  if(!['invalidated','expired'].includes(watch.stage)) {
    const d=complete?.pivots.D;
    if(pivots.length>offset+5) {
      end('expired','Struktur telah berlanjut ke swing terkonfirmasi setelah D; pola lama tidak didaur ulang.',bars.at(-1)!.date);
      return {...result,status:'no_pattern',watch,reason:watch.reason};
    }
    if(d && bars.length-1-d.index<=20 && Math.abs(result.lastClose!-d.price)<=.15*Math.abs(A.price-X.price)) {
      watch.stage='confirmed';watch.reason='D terkonfirmasi 2 kiri + 2 kanan; pendekatan Gartley terbatas, bukan prediksi.';delete watch.provisionalD;
      return {...result,status:'pattern',candidate:complete,watch,reason:watch.reason};
    }
    if((d && (bars.length-1-d.index>20 || Math.abs(result.lastClose!-d.price)>.15*Math.abs(A.price-X.price))) || (!d && bars.length-1-C.index>20))
      end('expired','Setup kedaluwarsa: usia >20 candle atau harga menjauh >0.15 XA dari D.',bars.at(-1)!.date);
    else if(pivots.length>offset+4) end('expired','Pivot D berikutnya tidak memenuhi Gartley atau struktur sudah diganti; tidak didaur ulang.',bars.at(-1)!.date);
  }
  return {...result,status:'no_pattern',watch,reason:watch.reason};
}

export function matchHarmonicPivots(points: HarmonicPivot[]): HarmonicCandidate | null {
  if (points.length !== 5 || points.some(p => !isISODate(p.date) || !Number.isFinite(p.price) || p.price <=0 || !Number.isInteger(p.index) || p.index <0 || !['low','high'].includes(p.kind))) return null;
  if (points.some((p,i) => i>0 && (p.date<=points[i-1].date || p.index<=points[i-1].index || p.kind===points[i-1].kind))) return null;
  const [X,A,B,C,D] = points;
  const bullish = X.kind==='low';
  const s = bullish ? 1 : -1;
  if (!(s*(A.price-X.price)>0 && s*(A.price-B.price)>0 && s*(C.price-B.price)>0 && s*(C.price-D.price)>0 && s*(B.price-X.price)>0 && s*(A.price-C.price)>0 && s*(B.price-D.price)>0 && s*(D.price-X.price)>0)) return null;
  const xa=Math.abs(A.price-X.price), ab=Math.abs(B.price-A.price), bc=Math.abs(C.price-B.price), cd=Math.abs(D.price-C.price);
  const ratios={AB_XA:ab/xa,BC_AB:bc/ab,CD_BC:cd/bc,AD_XA:Math.abs(D.price-A.price)/xa,CD_AB:cd/ab};
  const inside=(v:number,lo:number,hi:number)=>v>=lo-1e-9 && v<=hi+1e-9;
  if (!inside(ratios.AB_XA,.588,.648) || !inside(ratios.BC_AB,.382,.886) || !inside(ratios.CD_BC,1.272,1.618) || !inside(ratios.AD_XA,.766,.806) || !inside(ratios.CD_AB,.95,1.05)) return null;
  const xaZone=[A.price-s*.766*xa,A.price-s*.806*xa].sort((a,b)=>a-b);
  const bcZone=[C.price-s*1.272*bc,C.price-s*1.618*bc].sort((a,b)=>a-b);
  const abZone=[C.price-s*.95*ab,C.price-s*1.05*ab].sort((a,b)=>a-b);
  const low=Math.max(xaZone[0],bcZone[0],abZone[0]),high=Math.min(xaZone[1],bcZone[1],abZone[1]);
  if (low>high || !inside(D.price,low,high)) return null;
  const invalidationPrice=X.price;
  return {pattern:'Gartley',direction:bullish?'bullish':'bearish',pivots:{X,A,B,C,D},ratios,
    prz:{low,high,evidence:['XA retracement 0.766–0.806','BC extension 1.272–1.618','AB=CD ±5%; three-way overlapping intersection only']},
    invalidation:{price:invalidationPrice,condition:bullish?'Daily low at or below X invalidates; not a guaranteed stop fill.':'Daily high at or above X invalidates; not a guaranteed stop fill.'},
    targets:[.382,.618].map(r=>({label:`Tentative TP ${r}`,price:D.price+s*r*Math.abs(A.price-D.price),basis:`D + direction × ${r} × |A−D|; scenario only, not guaranteed`}))};
}

/** XABC only: no invented D, target, confidence or probability. */
export function projectGartleyPRZ(points: HarmonicPivot[]): GartleyProjection | null {
  if(points.length!==4 || points.some(p=>!isISODate(p.date) || !Number.isFinite(p.price) || p.price<=0 || !Number.isInteger(p.index) || p.index<0 || !['high','low'].includes(p.kind))) return null;
  if(points.some((p,i)=>i>0 && (p.date<=points[i-1].date || p.index<=points[i-1].index || p.kind===points[i-1].kind))) return null;
  const [X,A,B,C]=points,s=X.kind==='low'?1:-1;
  if(![A.price-X.price,A.price-B.price,C.price-B.price,B.price-X.price,A.price-C.price].every(v=>s*v>0)) return null;
  const xa=Math.abs(A.price-X.price),ab=Math.abs(A.price-B.price),bc=Math.abs(C.price-B.price);
  const AB_XA=ab/xa,BC_AB=bc/ab;
  if(AB_XA<.588-1e-9 || AB_XA>.648+1e-9 || BC_AB<.382-1e-9 || BC_AB>.886+1e-9) return null;
  const ranges=[[A.price-s*.766*xa,A.price-s*.806*xa],[C.price-s*1.272*bc,C.price-s*1.618*bc],[C.price-s*.95*ab,C.price-s*1.05*ab]].map(r=>r.sort((a,b)=>a-b));
  const low=Math.max(...ranges.map(r=>r[0])),high=Math.min(...ranges.map(r=>r[1]));
  if(low>high || (s===1 ? low<=X.price || high>=B.price : high>=X.price || low<=B.price)) return null;
  return {pattern:'Gartley',direction:s===1?'bullish':'bearish',pivots:{X,A,B,C},ratios:{AB_XA,BC_AB},
    prz:{low,high,evidence:['XA retracement 0.766–0.806','BC extension 1.272–1.618','AB=CD ±5%; three-way overlapping intersection only']},
    invalidation:{price:X.price,condition:s===1?'Daily low at or below X invalidates; not a guaranteed stop fill.':'Daily high at or above X invalidates; not a guaranteed stop fill.'}};
}
