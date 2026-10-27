import { isISODate, type DailyCandle, type HarmonicPivot } from './harmonic';
import type { WeeklyHarmonicAnalysis, WeeklyPatternResult, WeeklyWatch } from './harmonic-weekly';

export interface ChartPoint { label: string; x: number; y: number; price: number; date?: string; illustrative?: boolean }
export interface WeeklyChartGeometry {
  width: number; height: number; left: number; right: number; top: number; bottom: number; historyRight: number;
  bars: (DailyCandle & { x: number; openY: number; closeY: number; highY: number; lowY: number })[];
  candleWidth: number; ticks: { price: number; y: number }[];
  overlay: null | { stage: WeeklyWatch['stage']; muted: boolean; active: boolean; direction: string; points: ChartPoint[]; d?: ChartPoint;
    zone: { low: number; high: number; top: number; bottom: number }; invalidation: { price: number; y: number } };
}

/** Fail closed on malformed saved snapshots. No network or replacement live data. */
export function weeklyChartCandles(analysis: WeeklyHarmonicAnalysis): DailyCandle[] {
  const rows=analysis.candles;
  if(analysis.timeframe!=='1W' || !isISODate(analysis.asOf) || !Array.isArray(rows) || rows.length>520) return [];
  if(rows.some(r=>!r || typeof r.date!=='string' || !isISODate(r.date) || r.date>analysis.asOf ||
    ![r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0) || r.high<Math.max(r.open,r.low,r.close) || r.low>Math.min(r.open,r.high,r.close))) return [];
  const weekStarts=new Set<string>();
  for(const r of rows) {
    if(!isISODate(r.weekStart)) return [];
    const start=Date.parse(r.weekStart),date=Date.parse(r.date),friday=start+4*86400000;
    if(new Date(start).getUTCDay()!==1 || date<start || date>friday || friday>Date.parse(analysis.asOf) || weekStarts.has(r.weekStart)) return [];
    weekStarts.add(r.weekStart);
  }
  const unique=new Map<string,DailyCandle>();
  for(const r of rows) {
    const old=unique.get(r.date);
    if(old && ['open','high','low','close'].some(k=>old[k as keyof DailyCandle]!==r[k as keyof DailyCandle])) return [];
    unique.set(r.date,r);
  }
  const sorted=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(analysis.candleCount!==sorted.length || (analysis.firstDate!==undefined && analysis.firstDate!==sorted[0]?.date) ||
    (analysis.lastDate!==undefined && analysis.lastDate!==sorted.at(-1)?.date) ||
    (analysis.lastClose!==undefined && analysis.lastClose!==sorted.at(-1)?.close)) return [];
  return sorted;
}

/** Trading-session x coordinates for observations; future space has NO date scale. */
export function buildWeeklyHarmonicChart(analysis: WeeklyHarmonicAnalysis, result?: WeeklyPatternResult): WeeklyChartGeometry {
  const rows=weeklyChartCandles(analysis);
  const width=1000,height=390,left=24,right=904,top=54,bottom=332;
  const stage=result?.watch?.stage ?? (result?.status==='pattern' && result?.candidate?'confirmed':undefined);
  const model=stage==='confirmed' && result?.status==='pattern'?result?.candidate:result?.watch?.projection;
  const index=new Map(rows.map((r,i)=>[r.date,i]));
  const linked=(p:HarmonicPivot)=>p && Number.isFinite(p.price) && p.price>0 && index.has(p.date) &&
    (p.kind==='high' || p.kind==='low') && p.index===index.get(p.date) && rows[index.get(p.date)!][p.kind]===p.price;
  const labels=stage==='confirmed'?['X','A','B','C','D']:['X','A','B','C'];
  const observed=model?.pivots?labels.map(label=>[label,(model.pivots as Record<string,HarmonicPivot>)[label]] as const):[];
  const valid=!!((model?.pattern==='Gartley' || model?.pattern==='Bat') && ['bullish','bearish'].includes(model.direction) && stage &&
    ['projected','prz_touched','confirmed','invalidated','expired'].includes(stage) &&
    observed.length===labels.length && observed.every(([,p],i)=>linked(p) && (!i || p.date>observed[i-1][1].date)) &&
    Number.isFinite(model.prz?.low) && Number.isFinite(model.prz?.high) && model.prz.low>0 && model.prz.high>=model.prz.low && Number.isFinite(model.invalidation?.price) && model.invalidation.price>0);
  const illustrative=valid && stage==='projected';
  const historyRight=illustrative?right-180:right;
  const step=(historyRight-left)/Math.max(rows.length,1), x=(i:number)=>left+step*(i+.5);
  // Normalize before subtraction to avoid overflow even for hostile finite prices.
  const prices=rows.flatMap(r=>[r.low,r.high]);
  if(valid) prices.push(model!.prz.low,model!.prz.high,model!.invalidation.price,...observed.map(([,p])=>p.price));
  const scale=prices.length?Math.max(...prices):1;
  const min=prices.length?Math.min(...prices)/scale:0,max=prices.length?Math.max(...prices)/scale:1;
  const span=Math.max(max-min,.02),lo=Math.max(0,min-span*.12),hi=max+span*.12;
  const y=(price:number)=>bottom-(price/scale-lo)/(hi-lo)*(bottom-top);
  const geometry:WeeklyChartGeometry={width,height,left,right,top,bottom,historyRight,candleWidth:Math.max(1,Math.min(10,step*.64)),
    bars:rows.map((r,i)=>({...r,x:x(i),openY:y(r.open),closeY:y(r.close),highY:y(r.high),lowY:y(r.low)})),
    ticks:Array.from({length:5},(_,i)=>{const n=lo+(max-lo)*i/4;return {price:n*scale,y:y(n*scale)};}),overlay:null};
  if(!rows.length || !valid) return geometry;
  const points=observed.map(([label,p])=>({label,date:p.date,price:p.price,x:x(index.get(p.date)!),y:y(p.price)}));
  let d:ChartPoint|undefined;
  if(stage==='projected') {
    const price=model!.prz.low+(model!.prz.high-model!.prz.low)/2;
    d={label:'D*',price,x:historyRight+92,y:y(price),illustrative:true};
  } else if(stage==='prz_touched' && result?.watch?.provisionalD && linked(result?.watch.provisionalD)) {
    const p=result?.watch.provisionalD;
    d={label:'D provisional',date:p.date,price:p.price,x:x(index.get(p.date)!),y:y(p.price)};
  }
  const muted=stage==='invalidated'||stage==='expired';
  geometry.overlay={stage:stage!,direction:model!.direction,muted,active:!muted,points,d,
    zone:{...model!.prz,top:y(model!.prz.high),bottom:y(model!.prz.low)},invalidation:{price:model!.invalidation.price,y:y(model!.invalidation.price)}};
  return geometry;
}
