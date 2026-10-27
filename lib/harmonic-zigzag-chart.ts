import type { ZigzagHarmonicAnalysis, ZigzagPatternResult, ZigzagPivot } from './harmonic-zigzag';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const date = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const labels = ['X','A','B','C','D'] as const;
/** A structure id can occur at multiple periods/stages; selection must include its scale. */
export const zigzagResultKey = (r: ZigzagPatternResult) => `${r.id}::${r.periods.join(',')}::${r.stage}`;
export function buildZigzagChart(analysis: ZigzagHarmonicAnalysis, selectedId?: string) {
  const empty = (error: string) => ({error,candles:[] as ChartCandle[],pivots:[] as ChartPivot[],projection:null as ChartProjection|null,result:null as ZigzagPatternResult|null,y:(_n:number)=>0,x:(_n:number)=>0,min:0,max:0});
  if (!analysis || analysis.experimental !== true || analysis.timeframe !== '1W' || !date(analysis.asOf) || !['pattern','no_pattern','insufficient'].includes(analysis.status) || !Array.isArray(analysis.candles) || !analysis.candles.length || !Array.isArray(analysis.results)) return empty('Data weekly eksperimen tidak tersedia.');
  if(['emiten','source','registryVersion','methodology'].some(k=>typeof analysis[k as keyof ZigzagHarmonicAnalysis]!=='string')) return empty('Metadata sumber eksperimen tidak valid.');
  if(analysis.results.some(r=>!r || !Array.isArray(r.periods))) return empty('Metadata hasil eksperimen tidak valid.');
  const candles = analysis.candles;
  if(candles.length>520 || candles.some((c,i)=>!c || !date(c.weekStart) || new Date(c.weekStart+'T00:00:00Z').getUTCDay()!==1 || !date(c.date) || c.date<c.weekStart || c.date>new Date(Date.parse(c.weekStart+'T00:00:00Z')+4*86400000).toISOString().slice(0,10) || new Date(Date.parse(c.weekStart+'T00:00:00Z')+4*86400000).toISOString().slice(0,10)>analysis.asOf || (i>0&&c.weekStart<=candles[i-1].weekStart))) return empty('Weekly tidak lengkap / metadata kalender tidak valid.');
  if (analysis.candleCount !== candles.length || analysis.firstDate !== candles[0].date || analysis.lastDate !== candles.at(-1)!.date || analysis.lastClose !== candles.at(-1)!.close || candles.some((c,i)=>!date(c.date)||c.date>analysis.asOf||(i>0&&c.date<=candles[i-1].date)||![c.open,c.high,c.low,c.close].every(finite)||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close))) return empty('Metadata / OHLC weekly tidak valid; chart ditahan.');
  const result = analysis.results.find(r=>r && (zigzagResultKey(r)===selectedId || r.id===selectedId)) || analysis.results[0] || null;
  const pivots: ChartPivot[] = [];
  if(result) {
    if(!result.pivots || !Array.isArray(result.periods) || !result.periods.length || result.periods.some(p=>![8,13,21,34,55].includes(p)) || !Array.isArray(result.prz?.evidence) || result.prz.evidence.some(s=>typeof s!=='string') || !['bullish','bearish'].includes(result.direction) || !['Gartley','Bat','ABCD','Butterfly'].includes(result.pattern)||!['projected','prz_touched','confirmed','invalidated','expired'].includes(result.stage)||![8,13,21,34,55].includes(result.period)||!date(result.availableAt)||result.availableAt>analysis.asOf||!result.prz||!finite(result.prz.low)||!finite(result.prz.high)||result.prz.low>result.prz.high||!finite(result.invalidation?.price)) return empty('Metadata pola tidak valid; overlay ditahan.');
    if((result.stage==='expired'||result.stage==='invalidated')&&(!date(result.endedAt)||result.endedAt>analysis.asOf)) return empty('Tanggal akhir pola tidak valid.');
    const required=result.pattern==='ABCD'?['A','B','C']:['X','A','B','C'];
    if(required.some(k=>!result.pivots[k as keyof typeof result.pivots])||(result.pattern==='ABCD'&&result.pivots.X)) return empty('Pivot pola tidak lengkap / salah keluarga.');
    const entries=labels.filter(l=>result.pivots[l]).map(label=>({label,...result.pivots[label]!}));
    if(result.provisionalD && !result.pivots.D) entries.push({label:'D',...result.provisionalD});
    for(const p of entries) {
      const c=candles[p.index];
      if(typeof p.provisional!=='boolean' || (p.label!=='D'&&p.provisional) || !Number.isInteger(p.index)||!c||c.date!==p.date||!['high','low'].includes(p.kind)||!finite(p.price)||p.price!==c[p.kind]||(pivots.length>0&&(p.index<=pivots.at(-1)!.index||p.kind===pivots.at(-1)!.kind))||(!p.provisional&&(!date(p.confirmedAt)||p.confirmedAt<p.date||p.confirmedAt>analysis.asOf))||(!p.provisional&&p.label!=='D'&&p.confirmedAt! > result.availableAt)) return empty('Pivot tidak terhubung dengan candle / konfirmasi; overlay ditahan.');
      pivots.push({...p,x:0,y:0});
    }
    if(result.stage==='confirmed'&&(!result.pivots.D||result.pivots.D.provisional||!date(result.confirmedAt)||result.confirmedAt>analysis.asOf)) return empty('Konfirmasi D tidak valid.');
  }
  const bounds=candles.flatMap(c=>[c.low,c.high]);
  if(result) bounds.push(result.prz.low,result.prz.high,result.invalidation.price);
  const min=Math.min(...bounds), max=Math.max(...bounds), pad=Math.max((max-min)*0.1,max*0.01);
  if(!Number.isFinite(max-min+2*pad)) return empty('Rentang harga tidak aman untuk chart.');
  const y=(price:number)=>360-(price-min+pad)/(max-min+2*pad)*310;
  const x=(index:number)=>60+index/Math.max(1,candles.length-1)*900;
  const projection:ChartProjection|null=result&&result.stage!=='expired'&&result.stage!=='invalidated'&&!pivots.some(p=>p.label==='D')?{label:'D*',price:result.prz.low+(result.prz.high-result.prz.low)/2,x:1060,y:y(result.prz.low+(result.prz.high-result.prz.low)/2)}:null;
  return {error:null,candles:candles.map((c,index)=>{
    const step=candles.length>1?x(1)-x(0):12;
    const hitX=index===0?x(index)-step/2:(x(index-1)+x(index))/2;
    const hitEnd=index===candles.length-1?x(index)+step/2:(x(index)+x(index+1))/2;
    return {...c,x:x(index),y:y(c.close),hitX,hitWidth:hitEnd-hitX};
  }),pivots:pivots.map(p=>({...p,x:x(p.index),y:y(p.price)})),projection,result,y,x,min,max};
}
export interface ChartPivot extends ZigzagPivot {label:'X'|'A'|'B'|'C'|'D';x:number;y:number}
interface ChartCandle {date:string;open:number;high:number;low:number;close:number;x:number;y:number;hitX:number;hitWidth:number}
interface ChartProjection {label:'D*';price:number;x:number;y:number;date?:never}
