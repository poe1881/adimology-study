import React from 'react';
import type { HarmonicAnalysis } from '../../lib/harmonic';
import { HarmonicChart } from './HarmonicChart';

export interface HarmonicPanelProps { analysis: HarmonicAnalysis }
const price=(n:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(n);

/** Independent technical supplement; never represents fundamental evidence or model predictions. */
export function HarmonicPanel({ analysis }: HarmonicPanelProps) {
  const confirmed=analysis.status==='pattern'?analysis.candidate:null;
  const watch=analysis.watch;
  const c=confirmed??watch?.projection;
  const labels={projected:'Kandidat XABC — PRZ belum tersentuh',prz_touched:'Menunggu konfirmasi D — PRZ tersentuh',confirmed:'D terkonfirmasi',invalidated:'Tidak valid — kandidat dibatalkan',expired:'Kedaluwarsa / pergerakan selesai'};
  return <section className="mt-4 rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-4 text-sm" aria-label="Harmonic pattern dan PRZ">
    <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold text-cyan-300">Harmonic &amp; PRZ — sinyal teknikal</h4>
      <span className="rounded bg-white/5 px-2 py-1 text-xs text-gray-300">{watch?labels[watch.stage]:analysis.status}</span>
    </header>
    <p className="text-xs text-gray-400">{analysis.emiten} · {analysis.source} · {analysis.timeframe} · as-of {analysis.asOf} · {analysis.candleCount} candle</p>
    {analysis.firstDate && <p className="mt-1 text-xs text-gray-400">Cakupan {analysis.firstDate} – {analysis.lastDate}; close terakhir {analysis.lastClose===undefined?'—':price(analysis.lastClose)}</p>}
    <p className="mt-2 text-gray-300">{analysis.reason}</p>
    {watch?.touchedAt && <p className="mt-1 text-xs text-gray-400">PRZ pertama tersentuh {watch.touchedAt}</p>}
    {watch?.endedAt && <p className="mt-1 text-xs text-amber-300">Setup berakhir {watch.endedAt} — bukan entry aktif.</p>}
    {watch?.provisionalD && <p className="mt-1 text-xs text-amber-300">D provisional (belum terkonfirmasi): {watch.provisionalD.date} · {price(watch.provisionalD.price)}; {watch.stage==='prz_touched'?'menunggu pivot ketat 2 kiri + 2 kanan.':'catatan ekstrem observasi, setup tidak aktif.'}</p>}
    <HarmonicChart analysis={analysis}/>
    {c && <div className="mt-3 space-y-3">
      <p className="font-medium text-cyan-200">{c.pattern} · {c.direction} · pendekatan otomatis terbatas</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="text-gray-400"><th className="py-1">Pivot</th><th>Tanggal</th><th>Jenis</th><th>Harga</th></tr></thead><tbody>{Object.entries(c.pivots).map(([label,p])=><tr key={label} className="border-t border-white/5"><td className="py-1">{label}</td><td>{p.date}</td><td>{p.kind}</td><td>{price(p.price)}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-gray-300">Rasio: {Object.entries(c.ratios).map(([k,v])=>`${k} ${v.toFixed(4)}`).join(' · ')}</p>
      <div className="rounded-lg bg-white/5 p-3"><p className="font-medium">{confirmed?'PRZ':'PRZ proyeksi'}: {price(c.prz.low)} – {price(c.prz.high)}</p><p className="mt-1 text-xs text-gray-400">{c.prz.evidence.join(' + ')}</p></div>
      <p className="text-amber-300">Invalidasi {price(c.invalidation.price)}: {c.invalidation.condition}</p>
      <ul className="space-y-1 text-gray-300">{confirmed?.targets.map(t=><li key={t.label}>{t.label}: {price(t.price)} <span className="text-xs text-gray-400">({t.basis})</span></li>)}</ul>
    </div>}
    <details className="mt-3 text-xs text-gray-400"><summary className="cursor-pointer">Metode, batasan &amp; sumber</summary><p className="mt-2">{analysis.methodology}</p><p className="mt-2">Referensi: <a className="underline" href="https://harmonictrader.com/harmonic-patterns/gartley-pattern/" target="_blank" rel="noreferrer">Gartley Pattern</a> · <a className="underline" href="https://harmonictrader.com/harmonicpatternorigin/" target="_blank" rel="noreferrer">Harmonic Pattern Origin</a>. Toleransi adalah kebijakan implementasi; bukan sertifikasi pola.</p></details>
    <p className="mt-3 text-xs text-amber-200/80">Bukan sinyal fundamental, probabilitas, atau rekomendasi transaksi. Belum diuji balik. PRZ dan TP hanya skenario; invalidasi bukan jaminan harga eksekusi stop. Tidak ada target bila data atau pola tidak memenuhi syarat.</p>
  </section>;
}
export default HarmonicPanel;
