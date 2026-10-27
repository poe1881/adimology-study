'use client';

import React, { useId, useState } from 'react';
import type { ZigzagHarmonicAnalysis } from '@/lib/harmonic-zigzag';
import { buildZigzagChart, zigzagResultKey } from '@/lib/harmonic-zigzag-chart';

/** Optional experiment only. Uses the authoritative saved weekly candles; never fetches. */
export function HarmonicZigzagPanel({analysis}:{analysis?:ZigzagHarmonicAnalysis}) {
  const [selectedId,setSelectedId]=useState('');
  const [hover,setHover]=useState<number|null>(null);
  const selectorId=useId();
  const chart=analysis?buildZigzagChart(analysis,selectedId):null;
  const r=chart?.result;
  const ended=r?.stage==='expired'||r?.stage==='invalidated';
  const current=chart?.candles[hover??Math.max(0,(chart?.candles.length??1)-1)];
  const color='var(--accent-primary, #667eea)';
  return <details style={{marginTop:16,padding:12,border:'1px solid var(--border-color)',borderRadius:8,minWidth:0,maxWidth:'100%',color:'var(--text-secondary)'}}>
    <summary style={{cursor:'pointer',fontWeight:600,color:'var(--text-primary)'}}>Eksperimen ZigZag multiskala — Gartley / Bat / ABCD / Butterfly</summary>
    <p>Eksperimental, pembanding saja; baseline daily / weekly tetap utama. Belum ada probabilitas backtest; pola bukan rekomendasi beli.</p>
    {!analysis?<p>Versi Story lama: eksperimen belum tersimpan. Tidak ada pengambilan data tambahan atau pola yang disimpulkan.</p>:<>
      <p>{analysis.emiten} · weekly 1W · asOf {analysis.asOf} · sumber {typeof analysis.source==='string'?analysis.source:'metadata tidak valid'} · {analysis.firstDate??'—'} – {analysis.lastDate??'—'} · {analysis.candleCount} candle</p>
      <p>Period adalah lookback ZigZag 8/13/21/34/55, bukan 8 candle kanan. Pivot dibekukan saat breakout berlawanan; tanggal ekstrem berbeda dari tanggal konfirmasi. Terminal provisional dapat repaint.</p>
      {!chart?.error&&analysis.results.length>1&&<label htmlFor={selectorId}>Pilih keluarga / period / tahap{' '}<select id={selectorId} value={r?zigzagResultKey(r):''} onChange={e=>{setSelectedId(e.target.value);setHover(null);}} style={{maxWidth:'100%',padding:6,color:'var(--text-primary)',background:'var(--bg-card)',border:'1px solid var(--border-color)'}}>{analysis.results.map(item=><option key={zigzagResultKey(item)} value={zigzagResultKey(item)}>{item.pattern} · lookback {item.period} · {item.stage} · {item.availableAt}</option>)}</select></label>}
      {chart?.error?<p role="status">{chart.error} {analysis.reason}</p>:chart&&<>
        <p>{r?`${r.pattern} · ${r.direction} · ${r.stage} · lookback ${r.period} (gabungan ${r.periods.join('/')}) · tersedia ${r.availableAt}${r.confirmedAt?` · dikonfirmasi ${r.confirmedAt}`:''}`:'Tidak ada pola yang memenuhi aturan. Candle weekly aktual tetap ditampilkan.'}</p>
        {ended&&<p>Historis — berakhir {r?.endedAt??'tanpa tanggal'}; bukan setup atau target aktif.</p>}
        <p>{r?.reason??analysis.reason}</p>
        <div role="region" aria-label="Chart candle weekly eksperimen ZigZag" tabIndex={0} style={{overflowX:'auto',maxWidth:'100%',minWidth:0,border:'1px solid var(--border-color)',background:'var(--bg-card)'}}>
          <svg viewBox="0 0 1200 420" role="img" aria-label={`${analysis.emiten} candle weekly aktual dengan overlay ZigZag eksperimental`} style={{width:'100%',minWidth:760,display:'block',color:'var(--text-secondary)'}}>
            <title>Weekly OHLC aktual; D* tidak bertanggal dan hanya ilustrasi PRZ.</title>
            {[0,1,2,3,4].map(i=>{const price=chart.min+(chart.max-chart.min)*i/4;return <g key={i}><line x1={60} x2={1140} y1={chart.y(price)} y2={chart.y(price)} stroke="currentColor" opacity={0.15}/><text x={5} y={chart.y(price)+4} fill="currentColor" fontSize={11}>{price.toLocaleString('id-ID',{maximumFractionDigits:1})}</text></g>;})}
            <line x1={990} x2={990} y1={30} y2={375} stroke="currentColor" opacity={0.3}/>
            <text x={1000} y={25} fill="currentColor" fontSize={11}>Area ilustrasi tanpa tanggal</text>
            {chart.candles.map((c,i)=>{const candleColor=c.close>=c.open?'var(--accent-success, #10b981)':'var(--accent-warning, #f5576c)';const width=Math.max(1,Math.min(8,700/chart.candles.length));return <g key={c.date} tabIndex={0} role="button" aria-label={`${c.date} O ${c.open} H ${c.high} L ${c.low} C ${c.close}`} onMouseEnter={()=>setHover(i)} onFocus={()=>setHover(i)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=Math.max(0,Math.min(chart.candles.length-1,i+(e.key==='ArrowLeft'?-1:1)));setHover(next);(e.currentTarget.parentNode?.querySelectorAll('[data-candle]')[next] as SVGElement|null)?.focus();}}} data-candle={i}>
              <title>{`${c.date}: O ${c.open} H ${c.high} L ${c.low} C ${c.close}`}</title>
              <rect data-hitbox={i} x={c.hitX} y={40} width={c.hitWidth} height={330} fill="transparent"/>
              <line x1={c.x} x2={c.x} y1={chart.y(c.high)} y2={chart.y(c.low)} stroke={candleColor}/><rect x={c.x-width/2} y={Math.min(chart.y(c.open),chart.y(c.close))} width={width} height={Math.max(1,Math.abs(chart.y(c.open)-chart.y(c.close)))} fill={candleColor}/>
            </g>;})}
            {r&&<g data-overlay="zigzag" pointerEvents="none" opacity={ended?0.35:1}>
              <rect x={60} width={1080} y={chart.y(r.prz.high)} height={Math.max(1,chart.y(r.prz.low)-chart.y(r.prz.high))} fill={color} opacity={0.12}/>
              <text data-label="prz-range" x={1000} y={52} fill="currentColor" fontSize={11}>PRZ {r.prz.low.toFixed(1)}–{r.prz.high.toFixed(1)}</text>
              <line x1={60} x2={1140} y1={chart.y(r.invalidation.price)} y2={chart.y(r.invalidation.price)} stroke="var(--accent-warning, #f5576c)" strokeDasharray="3 5"/>
              {chart.pivots.slice(1).map((p,i)=><line key={p.label} x1={chart.pivots[i].x} y1={chart.pivots[i].y} x2={p.x} y2={p.y} stroke={color} strokeWidth={2} strokeDasharray={p.provisional?'6 5':undefined}/>)}
              {chart.pivots.map(p=><g key={p.label} data-pivot={p.label} pointerEvents="all" tabIndex={0} role="img" aria-label={`${p.label} ekstrem ${p.date} ${p.provisional?'provisional / dapat repaint':`dikonfirmasi ${p.confirmedAt}`} · tersedia ${r.availableAt}`}><title>{`${p.label} · ekstrem ${p.date} · ${p.provisional?'provisional / dapat repaint':`dikonfirmasi ${p.confirmedAt}`} · tersedia ${r.availableAt}`}</title><circle cx={p.x} cy={p.y} r={4} fill={color}/><text x={p.x+5} y={p.y+(p.kind==='high'?-12:18)} fill="currentColor" fontSize={13}>{p.label}{p.provisional?'?':''}</text></g>)}
              {chart.projection&&<><line x1={chart.pivots.at(-1)!.x} y1={chart.pivots.at(-1)!.y} x2={chart.projection.x} y2={chart.projection.y} stroke={color} strokeWidth={2} strokeDasharray="6 5"/><circle data-label="projected-d" cx={chart.projection.x} cy={chart.projection.y} r={4} fill="var(--bg-card)" stroke={color} strokeWidth={2}/><text x={chart.projection.x+5} y={chart.projection.y-10} fill="currentColor" fontSize={12}>D* ilustratif</text></>}
            </g>}
            {[chart.candles[0],chart.candles.at(-1)!].map(c=><text key={c.date} x={c.x} y={403} fill="currentColor" fontSize={11} textAnchor="middle">{c.date}</text>)}
          </svg>
        </div>
        <p aria-live="polite" style={{fontVariantNumeric:'tabular-nums'}}>{current?`${current.date} · O ${current.open} · H ${current.high} · L ${current.low} · C ${current.close}`:'OHLC tidak tersedia'}</p>
        <p>Garis solid = pivot observasi terkonfirmasi. Dashed D? = ekstrem provisional pada tanggal aktual. D* ilustratif = titik tengah PRZ di area kanan tanpa tanggal, bukan harga pasti dan bukan tanggal kedatangan.</p>
        {r&&<><p>PRZ: {r.prz.evidence.join('; ')}. {r.pattern==='ABCD'?'ABCD hanya ABC / ABCD; dua zona AB=CD dan BC, tanpa XA.':r.pattern==='Butterfly'?'Butterfly: D ekstensi melewati X.':'Zona mengikuti definisi registry.'}</p><p>Invalidasi {r.invalidation.price}: {r.invalidation.condition}</p></>}
      </>}
      <details style={{fontSize:12,color:'var(--text-secondary)',marginTop:12}}><summary style={{cursor:'pointer'}}>Metodologi dan batasan eksperimen</summary><p>Registry {typeof analysis.registryVersion==='string'?analysis.registryVersion:'—'} · {typeof analysis.methodology==='string'?analysis.methodology:'Metadata tidak valid'}</p></details>
    </>}
  </details>;
}
