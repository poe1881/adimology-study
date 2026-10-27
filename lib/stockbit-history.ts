import { analyzeHarmonics, isISODate, type DailyCandle, type HarmonicAnalysis } from './harmonic';

export type HistoryFetcher = (emiten: string, startDate: string, endDate: string, limit: number) => Promise<DailyCandle[]>;
const shiftDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

/** Read-only OHLC retrieval through existing authenticated Stockbit helper.
 * limit=50 was verified live; >50 is not assumed supported. Four calls maximum,
 * 200 candles maximum, 364 calendar days lookback, strictly bounded by asOf.
 * No token/error payload is returned to the model or UI. No cache across asOfs.
 */
export async function getHarmonicAnalysisWithFetcher(emiten: string, asOf: string, fetcher: HistoryFetcher): Promise<HarmonicAnalysis> {
  const base=analyzeHarmonics([],{emiten,asOf});
  if(!/^[A-Za-z0-9]{1,12}$/.test(emiten) || !isISODate(asOf)) return {...base,status:'unavailable',reason:'Invalid ticker or as-of date.',candidate:null};
  const start=shiftDate(asOf,-364),collected:DailyCandle[]=[];
  let end=asOf;
  try {
    for(let call=0;call<4 && end>=start;call++) {
      const page=await fetcher(emiten.toUpperCase(),start,end,50);
      if(!Array.isArray(page) || page.some(r=>!r || !isISODate(r.date))) throw new Error('Invalid OHLC response');
      const bounded=page.filter(r=>r.date>=start && r.date<=end);
      if(!bounded.length) break;
      collected.push(...bounded);
      const oldest=bounded.reduce((d,r)=>r.date<d?r.date:d,end);
      const nextEnd=shiftDate(oldest,-1);
      if(nextEnd>=end) break;
      end=nextEnd;
      if(page.length<50) break;
    }
    return analyzeHarmonics(collected,{emiten:emiten.toUpperCase(),asOf});
  } catch {
    return {...base,status:'unavailable',reason:'Daily OHLC history unavailable or incomplete after a provider error; no price scenario generated.',candidate:null};
  }
}

export async function getHarmonicAnalysis(emiten: string, asOf: string): Promise<HarmonicAnalysis> {
  return getHarmonicAnalysisWithFetcher(emiten,asOf,async(...args)=>{
    const { fetchHistoricalSummary }=await import('./stockbit');
    return fetchHistoricalSummary(...args);
  });
}
