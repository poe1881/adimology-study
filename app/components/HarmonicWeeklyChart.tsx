'use client';

import React, { useId, useState } from 'react';
import type { WeeklyHarmonicAnalysis, WeeklyPatternResult } from '../../lib/harmonic-weekly';
import { buildWeeklyHarmonicChart, type ChartPoint } from '../../lib/harmonic-weekly-chart';

const price=(n:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);
const dateLabel=(date:string)=>`${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;

/** Local SVG only. Observed dates are linked to saved OHLC, never a fresh live quote. */
export function HarmonicWeeklyChart({analysis,result}:{analysis:WeeklyHarmonicAnalysis;result?:WeeklyPatternResult}) {
  const id=useId();
  const [selected,setSelected]=useState<string|null>(null);
  const g=buildWeeklyHarmonicChart(analysis,result),o=g.overlay;
  if(!g.bars.length) return <div className="mt-3 rounded-lg p-3 text-xs" style={{background:'var(--bg-secondary)',color:'var(--text-secondary)',border:'1px solid var(--border-color)'}} role="status">
    {analysis.candles===undefined?'Data chart tidak tersedia untuk versi tersimpan; generate analisis terbaru.':'Data OHLC chart tidak tersedia atau tidak valid untuk snapshot ini.'} Tidak mengambil harga live pengganti.
  </div>;
  const bar=g.bars.find(b=>b.date===selected)??g.bars.at(-1)!;
  const description=(b:typeof bar)=>`${analysis.emiten} · ${b.date} · O ${price(b.open)} · H ${price(b.high)} · L ${price(b.low)} · C ${price(b.close)} · 1W · as-of ${analysis.asOf}`;
  const accent=o?.muted?'var(--text-secondary)':'var(--accent-title)';
  const zone=o?.muted?'var(--text-muted)':'color-mix(in srgb, var(--accent-orange) 60%, var(--text-primary))';
  const markers=o?[...o.points,...(o.d?[o.d]:[])]:[];
  const coords=(ps:ChartPoint[])=>ps.map(p=>`${p.x},${p.y}`).join(' ');
  const dateIndices=[...new Set([0,...[1,2,3].map(n=>Math.round((g.bars.length-1)*n/4)),g.bars.length-1])];
  return <figure className="mt-4 overflow-hidden rounded-xl" style={{background:'var(--bg-secondary)',border:'1px solid var(--border-color)',color:'var(--text-primary)',margin:'16px 0 0',borderRadius:12,overflow:'hidden'}} aria-label={`Chart OHLC ${analysis.emiten} dan Harmonic PRZ`}>
    <figcaption className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-xs" style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8,padding:'12px 16px 0',fontSize:12}}>
      <strong>{analysis.emiten} · OHLC 1W</strong><span style={{color:'var(--text-secondary)'}}>{result?.pattern ?? 'Gartley + Bat'} · skala {result?.scale ?? '2/4/8'} minggu · as-of {analysis.asOf} · {g.bars.length} candle aktual</span>
    </figcaption>
    <p className="px-4 pt-2 text-xs" style={{color:'var(--text-secondary)',minHeight:32,padding:'8px 16px 0',fontSize:12,margin:'0 0 8px'}} aria-live="polite" aria-atomic="true">{description(bar)}</p>
    <div className="overflow-x-auto" style={{overflowX:'auto',maxWidth:'100%'}} tabIndex={0} role="region" aria-label="Chart dapat digeser horizontal pada layar kecil; fokus candle untuk membaca OHLC">
      <svg viewBox={`0 0 ${g.width} ${g.height}`} style={{display:'block',width:'100%',minWidth:760,height:'auto',fontFamily:'inherit'}} role="group" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{`${analysis.emiten} · candlestick aktual dan ${o?`${result?.pattern} ${o.direction}`:'tanpa kandidat harmonic'}`}</title>
        <desc id={`${id}-desc`}>{`OHLC dari ${analysis.source}, timeframe 1W sampai ${analysis.asOf}. Garis solid adalah pivot observasi. Garis putus-putus belum terkonfirmasi.${o?.stage==='projected'?' D* hanya titik ilustrasi tengah PRZ, bukan prediksi harga pasti atau waktu.':''}`}</desc>
        {g.ticks.map((tick,i)=><g key={i}>
          <line x1={g.left} x2={g.right} y1={tick.y} y2={tick.y} stroke="var(--border-color)"/>
          <text x={g.right+10} y={tick.y+4} fill="var(--text-secondary)" fontSize={11}>{price(tick.price)}</text>
        </g>)}
        <text x={g.right+10} y={28} fill="var(--text-secondary)" fontSize={11}>Harga · IDR</text>
        {o?.d?.illustrative && <g data-illustrative-area="true">
          <rect x={g.historyRight} y={g.top} width={g.right-g.historyRight} height={g.bottom-g.top} fill="var(--accent-title)" opacity={.05}/>
          <line x1={g.historyRight} x2={g.historyRight} y1={g.top} y2={g.bottom} stroke="var(--text-muted)" strokeDasharray="3 5"/>
          <text x={g.historyRight+12} y={24} fill="var(--text-secondary)" fontSize={11}>Area ilustrasi D*</text>
          <text x={g.historyRight+12} y={40} fill="var(--text-secondary)" fontSize={10}>bukan prediksi waktu</text>
        </g>}
        {o && <g data-overlay-stage={o.stage} opacity={o.muted ? .45 : 1}>
          <rect data-prz-active={o.active?'true':undefined} data-prz-historical={o.muted?'true':undefined} x={o.points[0].x} y={o.zone.top} width={g.right-o.points[0].x} height={Math.max(1,o.zone.bottom-o.zone.top)} fill={zone} opacity={.15}/>
          {[o.zone.top,o.zone.bottom].map((y,i)=><line key={i} x1={o.points[0].x} x2={g.right} y1={y} y2={y} stroke={zone} strokeDasharray="4 4" opacity={.7}/>)}
          <line x1={o.points[0].x} x2={g.right} y1={o.invalidation.y} y2={o.invalidation.y} stroke="var(--accent-warning)" strokeDasharray="7 5"/>
          <text x={g.left+5} y={Math.min(g.bottom-3,o.invalidation.y+15)} fill="var(--accent-warning)" fontSize={11}>{o.muted?'Batas invalidasi historis':'Invalidasi'} · {price(o.invalidation.price)}</text>
        </g>}
        {g.bars.map(b=><g key={b.date} data-candle-date={b.date} role="img" tabIndex={0} aria-label={description(b)} onFocus={()=>setSelected(b.date)} onMouseEnter={()=>setSelected(b.date)} style={{outline:'none'}}>
          <title>{description(b)}</title>
          <rect x={b.x-g.candleWidth/2-1} y={g.top} width={g.candleWidth+2} height={g.bottom-g.top} fill="transparent"/>
          <line x1={b.x} x2={b.x} y1={b.highY} y2={b.lowY} stroke={b.close>=b.open?'var(--sentiment-positive)':'var(--sentiment-negative)'} opacity={.65}/>
          <rect x={b.x-g.candleWidth/2} y={Math.min(b.openY,b.closeY)} width={g.candleWidth} height={Math.max(1,Math.abs(b.openY-b.closeY))} fill={b.close>=b.open?'var(--sentiment-positive)':'var(--sentiment-negative)'} opacity={.65}/>
        </g>)}
        {selected && g.bars.some(b=>b.date===selected) && <line x1={bar.x} x2={bar.x} y1={g.top} y2={g.bottom} stroke="var(--text-secondary)" strokeDasharray="2 4" pointerEvents="none" opacity={.6}/>}
        {o && <g opacity={o.muted ? .45 : 1} pointerEvents="none">
          <polyline data-harmonic-line="observed" points={coords(o.points)} fill="none" stroke={accent} strokeWidth={2.4} strokeLinejoin="round"/>
          {o.d && <line data-harmonic-line="unfinished" x1={o.points.at(-1)!.x} y1={o.points.at(-1)!.y} x2={o.d.x} y2={o.d.y} stroke={zone} strokeWidth={2.4} strokeDasharray="7 5"/>}
          {markers.map(p=><g key={p.label} data-pivot-label={p.label} data-pivot-date={p.date}>
            <circle cx={p.x} cy={p.y} r={p.illustrative?5:4} fill="var(--bg-secondary)" stroke={p.label.startsWith('D')&&p.label!=='D'?zone:accent} strokeWidth={2}/>
            <text x={p.x} y={p.y-12} textAnchor={p.x>g.right-90?'end':'middle'} fill={p.label.startsWith('D')?zone:accent} fontSize={12} fontWeight={700} style={{paintOrder:'stroke',stroke:'var(--bg-secondary)',strokeWidth:3}}>{p.label}</text>
          </g>)}
        </g>}
        {dateIndices.map(i=><text key={i} x={g.bars[i].x} y={g.bottom+24} textAnchor={i===0?'start':i===g.bars.length-1?'end':'middle'} fill="var(--text-secondary)" fontSize={11}>{dateLabel(g.bars[i].date)}</text>)}
        <text x={g.left} y={g.height-15} fill="var(--text-secondary)" fontSize={11}>Tanggal observasi · jarak per minggu perdagangan aktual</text>
      </svg>
    </div>
    <div className="space-y-2 px-4 pb-4 text-xs" style={{color:'var(--text-secondary)',padding:'0 16px 12px',fontSize:12,lineHeight:1.5}}>
      <p>▥ Candle: OHLC aktual · ━ Pivot terkonfirmasi · ┄ Leg belum selesai · <span style={{color:zone}}>▰ PRZ</span></p>
      {!o && <p>Tidak ada kandidat harmonic yang memenuhi syarat pada snapshot ini; tidak ada pivot atau target yang dibuat.</p>}
      {o && <p style={{color:o.muted?'var(--text-secondary)':zone}}>{o.muted?'Overlay historis — setup tidak aktif; tanpa target aktif.':'PRZ proyeksi'} · {price(o.zone.low)} – {price(o.zone.high)}</p>}
      {o?.stage==='projected' && <p>D* = ilustrasi titik tengah PRZ ({price(o.d!.price)}), bukan D terkonfirmasi atau target harga pasti. Posisi horizontal hanya ruang ilustrasi; bukan prediksi tanggal/waktu D.</p>}
      {o?.stage==='prz_touched' && <p>D provisional = ekstrem OHLC aktual {o.d?.date ?? '(tidak dapat ditautkan ke snapshot)'}, belum pivot terkonfirmasi. C→D putus-putus; menunggu {result?.scale} candle weekly kanan (dan {result?.scale} kiri).</p>}
      {o?.stage==='confirmed' && <p>D terkonfirmasi pada candle aktual; X–A–B–C–D ditautkan ke tanggal OHLC, bukan proyeksi waktu.</p>}
      <p>Hover atau fokus candle untuk detail OHLC. Status penyesuaian harga provider terhadap aksi korporasi belum diketahui. Gartley + Bat 1W; bukan rekomendasi transaksi.</p>
    </div>
  </figure>;
}
export default HarmonicWeeklyChart;
