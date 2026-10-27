'use client';

import React, { useId, useState } from 'react';
import type { WeeklyHarmonicAnalysis } from '../../lib/harmonic-weekly';
import { HarmonicWeeklyChart } from './HarmonicWeeklyChart';

const price=(n:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
/** Separate saved weekly snapshot. Never substitutes daily candles or makes a live request. */
export function HarmonicWeeklyPanel({analysis}:{analysis?:WeeklyHarmonicAnalysis}) {
 const id=useId(),[selected,setSelected]=useState(0);
 const results=Array.isArray(analysis?.results)?analysis.results.slice(0,8):[];
 const result=results[selected]??results[0],watch=result?.watch;
 const ended=watch?.stage==='invalidated'||watch?.stage==='expired';
 return <section aria-labelledby={`${id}-heading`} style={{marginTop:20,padding:16,border:'1px solid var(--border-color)',borderRadius:12,background:'var(--bg-card)',color:'var(--text-primary)',maxWidth:'100%',minWidth:0}}>
  <h5 id={`${id}-heading`} style={{margin:'0 0 10px',fontSize:16}}>Harmonic &amp; PRZ — Weekly Gartley + Bat</h5>
  {!analysis ? <p role="status">Data weekly belum tersedia pada versi Story ini; generate analisis terbaru. Tidak ada chart, pola, atau target yang direkayasa.</p> : <>
   <p style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6}}>{analysis.emiten} · 1W · as-of {analysis.asOf} · {analysis.candleCount} candle weekly · {analysis.firstDate??'—'} – {analysis.lastDate??'—'}<br/>
    Sumber: {analysis.source}. Agregasi daily → weekly; hanya minggu selesai. Tanggal candle = hari perdagangan aktual terakhir minggu, bukan tanggal D prediksi. Minggu berjalan {analysis.partialWeekExcluded?'dikecualikan':'tidak disertakan bila belum selesai'}.<br/>
    {analysis.completionPolicy} Status penyesuaian harga terhadap split/aksi korporasi belum diketahui; rasio dapat terdistorsi.</p>
   {analysis.history && <p style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6}}>Cakupan permintaan multi-tahun (7 tahun): {analysis.history.requestedStart} – {analysis.history.requestedEnd}.<br/>Tersedia aktual: {analysis.history.actualFirstDate??'—'} – {analysis.history.actualLastDate??'—'} · {analysis.history.dailyCandleCount} candle daily → {analysis.candleCount} minggu selesai. Rentang aktual mengikuti ketersediaan provider, bukan jaminan tujuh tahun lengkap.{analysis.history.retrievedAt && <> Diambil: {analysis.history.retrievedAt}.</>}</p>}
   {results.length>1 && <label htmlFor={`${id}-pattern`} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,fontSize:13}}>Pilih pola / skala
    <select id={`${id}-pattern`} value={Math.min(selected,results.length-1)} onChange={event=>setSelected(Number(event.target.value))} style={{padding:'8px 10px',background:'var(--bg-secondary)',color:'var(--text-primary)',border:'1px solid var(--border-color)',borderRadius:6,maxWidth:'100%'}}>
     {results.map((r,i)=><option key={i} value={i}>{r.pattern} · {r.scales?.join('/')||r.scale} minggu · {r.watch?.stage??r.status}</option>)}
    </select>
   </label>}
   <p style={{fontSize:13,lineHeight:1.6,color:ended?'var(--text-secondary)':'var(--text-primary)'}}>{result?`${result.pattern} · skala ${result.scales?.join('/')||result.scale} minggu · ${watch?.stage??result.status}`:analysis.status} — {result?.reason??analysis.reason}</p>
   {watch?.stage==='prz_touched' && <p>D provisional pada {watch.provisionalD?.date??watch.touchedAt}; belum terkonfirmasi. Menunggu {result?.scale} candle weekly kanan, dengan {result?.scale} kiri.</p>}
   {ended && <p>Setup historis tidak aktif · berakhir {watch?.endedAt??'—'} · tanpa target aktif.</p>}
   <HarmonicWeeklyChart key={`${analysis.emiten}-${selected}`} analysis={analysis} result={result}/>
   {result?.candidate && watch?.stage==='confirmed' && !ended && <p style={{fontSize:12}}>Skenario target (bukan jaminan): {result.candidate.targets.map(t=>`${t.label}: ${price(t.price)}`).join(' · ')}</p>}
   <details style={{fontSize:12,marginTop:12,color:'var(--text-secondary)',lineHeight:1.6}}><summary>Metodologi weekly &amp; batasan</summary><p>{analysis.methodology}</p><p>Skala 2/4/8 berarti jumlah tetangga kiri dan kanan weekly, bukan timeframe berbeda. PRZ wajib irisan tiga zona; tanpa probabilitas atau klaim backtest. Tidak semua pola harmonic didukung.</p></details>
  </>}
 </section>;
}
export default HarmonicWeeklyPanel;
