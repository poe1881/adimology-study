# Eksperimen harmonic: registry + ZigZag kausal

## Tujuan dan batas

Mode pembanding untuk mengadopsi ide registry pola dan scanning multiskala dari riset `djoffrey/HarmonicPatterns`, tanpa mengimpor Python sebagai dependency runtime dan tanpa mengganti detektor daily/weekly yang sudah ada. Panel eksperimen berbentuk `<details>` tertutup secara default di bawah panel weekly.

Tidak ada klaim metode ini lebih akurat, lebih menguntungkan, non-repaint secara keseluruhan, atau memiliki probabilitas keberhasilan. Tidak ada sinyal otomatis untuk order, transaksi Stockbit, atau rekomendasi beli. Lihat `THIRD_PARTY_HARMONIC_NOTICES.md` untuk atribusi dan batas lisensi.

## Registry kebijakan

Keluarga awal: Gartley, Bat, ABCD, Butterfly. Gartley dan Bat mempertahankan band numerik baseline sebagai kebijakan konservatif; registry tidak mendefinisikan ulang baseline. Toleransi equality simetris diuji secara eksplisit, bukan menyalin perilaku equality satu sisi upstream.

- **Gartley**: AB/XA 0.588–0.648; BC/AB 0.382–0.886; AD/XA 0.766–0.806; CD/BC 1.272–1.618; CD/AB 0.95–1.05. PRZ tiga zona.
- **Bat subset**: AB/XA 0.382–0.50; BC/AB 0.382–0.886; AD/XA 0.866–0.906; CD/BC 1.618–2.618; CD/AB 1.2065–1.3335. PRZ tiga zona.
- **ABCD**: tiga pivot ABC untuk proyeksi dan empat ABCD untuk match, tanpa titik X palsu. BC/AB 0.382–0.886; CD/BC 1.13–2.618; CD/AB 0.95–1.05. PRZ **dua zona**, bukan klaim konvergensi XA.
- **Butterfly subset**: AB/XA 0.756–0.816; BC/AB 0.382–0.886; AD/XA 1.24–1.30; CD/BC 1.618–2.618; CD/AB 1.2065–1.3335. D harus melewati X. PRZ tiga zona.

Band/toleransi tersebut adalah versi implementasi lokal dan tidak mewakili semua variasi setiap pola atau sertifikasi penerbit referensi. Tidak ada penyesuaian band hanya supaya BBCA menghasilkan pola.

## ZigZag dan waktu informasi

- Input adalah snapshot weekly selesai dari loader yang sudah ada: tidak mengunduh histori tambahan untuk eksperimen.
- Lookback 8/13/21/34/55 mengukur breakout terhadap candle sebelumnya, **bukan** jumlah candle kanan fixed untuk konfirmasi.
- Strict high/low breakout, warmup lengkap, ties bukan breakout; outside bar yang simultan memecah high/low dilewati karena urutan intrabar tidak diketahui.
- Pivot terminal boleh diganti jika extreme searah berlanjut. Saat breakout berlawanan, pivot sebelumnya dibekukan dan mencatat `confirmedAt`; pivot baru tetap provisional.
- `date` adalah tanggal extreme aktual; `confirmedAt` adalah kapan konfirmasi bisa diketahui. Keduanya bukan hal yang sama.
- Kalender weekly memakai Jumat sebagai availability tanggal EOD; bila perdagangan terakhir Kamis karena libur, harga tetap bertanggal Kamis tetapi informasi mingguan baru dianggap tersedia pada Jumat. Ini kalender konservatif, bukan feed kalender bursa atau pemeriksaan jam penutupan live.
- Proyeksi baru boleh tersedia setelah C terkonfirmasi. `availableAt` tidak boleh dibalik ke tanggal extreme atau touch lama. Touch sebelum konfirmasi boleh dicatat sebagai riwayat, bukan sinyal retroaktif.
- Completed D memerlukan pivot D yang benar-benar dibekukan; rasio yang cocok pada terminal provisional belum cukup.

## Lifecycle dan visualisasi

Stage: projected, prz_touched, confirmed, invalidated, expired. Pergerakan yang sudah mencapai target, melanggar sisi jauh PRZ/batas struktural, memperpanjang C, atau dilanjutkan swing berikutnya tidak boleh muncul sebagai setup aktif baru. Usia eksperimen dibatasi menurut metodologi yang tersimpan; ini kebijakan operasional, bukan batas universal harmonic.

- D* = midpoint rentang PRZ sebagai ilustrasi. Posisi horizontalnya tidak memiliki tanggal prediksi.
- D provisional = extreme nyata dengan tanggal observasi, dapat berubah sebelum konfirmasi.
- Hanya setup confirmed yang masih aktif boleh membawa skenario target; bukan probabilitas atau jaminan.
- Historical invalidated/expired ditampilkan redup, tanpa target aktif.
- Pemilih hasil mempertahankan keluarga pola dan period. Dedup tidak boleh membuang keluarga berbeda hanya karena indeks sama.

## Integrasi dan provenance

Hasil eksperimen dihitung server-side dari weekly snapshot yang sama. Input teknikal buatan client diabaikan. Field JSONB terpisah `strategi_trading.experimental_harmonic_analysis` menyimpan hasil authoritative; model tidak boleh menggantinya. Context Story versi baru memisahkan hasil lama. Raw candle daily, weekly dan eksperimen tidak dikirim ke model; hanya allowlist ringkasan, versi registry, stage, tanggal availability dan alasan.

Data provider dapat mengandung penyesuaian split/aksi korporasi yang belum diketahui. Karena itu konsistensi harga/adjustment harus diverifikasi sebelum memakai rasio sebagai dasar keputusan finansial.

## Pengujian yang harus dibedakan

1. **Unit/regresi**: matematika, geometri, toleransi, outside bar, ties, kaki nol, invalid data, dedup dan fixture keluarga bullish/bearish.
2. **Replay engineering as-of**: hasil pada prefix harus sama dengan full dataset yang dipotong asOf; pivot yang sudah dibekukan tidak berubah; terminal boleh berubah; tidak ada `availableAt`/`confirmedAt` masa depan.
3. **Uji UI**: candlestick aktual, ABCD tanpa X, D* tanpa tanggal, selector, tooltip tanggal extreme/konfirmasi, keyboard dan overflow mobile.
4. **Uji integrasi nyata**: snapshot tersimpan dan dibaca ulang dari project percobaan, tidak sekadar respons model.
5. **Backtest strategi trading**: BELUM merupakan bagian klaim mode ini. Memerlukan definisi entry/exit, horizon, biaya/slippage/tick size, corporate action dan evaluasi out-of-sample beberapa saham/periode. Replay engineering bukan bukti win-rate.

Replay developer lokal menggunakan data nyata BBCA yang sudah tersedia dan fixture mirror berlabel sintetis:

```bash
node --import tsx C:/Users/Kapiten/adimology-study/research/zigzag-replay-check.mts
```

Artefak JSON/CSV di folder riset adalah bukti engineering, bukan data pasar sintetis yang menyamar sebagai hasil nyata. Skrip dan fixture QA di luar repo tidak ikut deployment.

## Hasil verifikasi implementasi lokal

- Suite akhir **141/141 tes lulus**, TypeScript dan production build lulus, serta `git diff --check` bersih. Server aplikasi kembali HTTP 200, worker ready, dan listener aplikasi/Hermes terikat hanya ke 127.0.0.1.

- Replay data nyata BBCA: 362 snapshot mingguan diuji berurutan. Pada setiap asOf, output prefix sama dengan output full dataset yang dibatasi asOf. Sebanyak 1.810 pemeriksaan prefix pivot terkonfirmasi pada lima lookback tidak menemukan perubahan pivot yang sudah dibekukan atau pelanggaran alternasi. Terminal tetap boleh berubah; itu bukan klaim semua ZigZag non-repaint.
- Mirror harga sintetis berlabel diuji terpisah sebagai fixture bearish; bukan saham kedua atau observasi pasar tambahan.
- Snapshot BBCA final: dua ABCD berstatus projected dan satu ABCD expired; tidak ada D confirmed aktif dari eksperimen ini. Proyeksi bukan ramalan bahwa harga akan mencapai zona.
- Browser React/Chrome terisolasi: panel tertutup default, 362 candle nyata, ABCD tanpa X palsu, selector, hover, fokus dan arrow-key, dark/light, scroll internal pada layar 390px. Area hover dibuat bertemu pada midpoint tanpa overlap; label PRZ dipisahkan dari label D*.
- Story v7 nyata selesai dan dibaca ulang dari project database percobaan; ketiga panel merender 200 daily / 362 weekly / 362 experimental candles. Hasil eksperimen tersimpan dibandingkan langsung dengan engine saat readback dan identik. Model tidak menjadi sumber pivot/rasio/PRZ.
- Enam file inti engine dan chart baseline diverifikasi terhadap manifest SHA-256 awal, tanpa perubahan. Tidak ada dependency Python runtime atau service Python tambahan untuk detektor.
- MIT notice upstream disimpan dalam dokumentasi. Tidak ada commit, push, deploy publik atau perubahan schema/RLS pada pekerjaan ini.

Artefak verifikasi di folder riset:

- `default-harmonic-baseline.json`
- `zigzag-replay-check.mts`, `zigzag-replay-results.json`, `zigzag-replay-summary.csv`
- `zigzag-visual-cases.mts`, `zigzag-visual-cases.json` (fixture sintetis berlabel terpisah)
- `zigzag-browser-check.mts`, `zigzag-chart-qa-{dark,light,mobile}.png`

## Referensi

- https://github.com/djoffrey/HarmonicPatterns/tree/1e0cd81a96132a1c3337dbbfce39f13d4606758b
- https://harmonictrader.com/harmonic-patterns/gartley-pattern/
- https://harmonictrader.com/harmonic-patterns/bat-pattern/
- https://harmonictrader.com/harmonic-patterns/abcd-pattern/
- https://harmonictrader.com/harmonic-patterns/butterfly-pattern/
