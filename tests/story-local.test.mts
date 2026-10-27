import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const local = require('../lib/story-local.ts') as typeof import('../lib/story-local');
const { storyInput, storyTimeout, requestHermes } = local;
const payload = {
  emiten: 'bbca', analysis: {
    input: { emiten: 'BBCA', fromDate: '2026-10-26', toDate: '2026-10-27' },
    stockbitData: { bandar: 'YP', barangBandar: 100, rataRataBandar: 8000 },
    marketData: { harga: 8100, offerTeratas: 8300, bidTerbawah: 7900, fraksi: 25, totalBid: 1000, totalOffer: 1200 },
    calculated: { totalPapan: 16, rataRataBidOfer: 1, a: 400, p: 1, targetRealistis1: 8500, targetMax: 9000 },
    brokerSummary: { detector: { broker_accdist: 'BigDist', total_buyer: 4, total_seller: 9, number_broker_buysell: 13, volume: 10, value: 500, average: 50,
      top1: { vol: 1, percent: 2, amount: 3, accdist: 'Dist' }, top3: { vol: 1, percent: 2, amount: 3, accdist: 'Dist' }, top5: { vol: 1, percent: 2, amount: 3, accdist: 'Dist' }, avg: { vol: 1, percent: 2, amount: 3, accdist: 'Dist' } },
      topBuyers: [{ netbs_broker_code: 'YP', bval: '80000000', blot: '100', netbs_buy_avg_price: '8000', type: 'Local', token: 'DO-NOT-SEND' }],
      topSellers: [{ netbs_broker_code: 'CC', sval: '90000000', slot: '110', netbs_sell_avg_price: '8000', type: 'Foreign' }] },
    token: 'DO-NOT-SEND',
  }, keyStatsEmiten: 'BBCA', keyStats: { currentValuation: [{ id: '1', name: 'PE', value: '20', token: 'DO-NOT-SEND' }] }, token: 'DO-NOT-SEND',
};
const result = {
  matriks_story: [{ kategori_story: 'Data broker', deskripsi_katalis: 'Data', logika_ekonomi_pasar: 'Hipotesis', potensi_dampak_harga: 'Tidak pasti' }],
  swot_analysis: { strengths: ['Data'], weaknesses: ['Terbatas'], opportunities: ['Skenario'], threats: ['Risiko'] },
  checklist_katalis: [{ item: 'Konfirmasi', dampak_instan: 'Belum diketahui' }],
  keystat_signal: 'Data terbatas', strategi_trading: { tipe_saham: 'Belum ditentukan', target_entry: 'Belum cukup data', exit_strategy: { take_profit: 'Skenario', stop_loss: 'Skenario' }, harmonic_analysis: { fabricated: true }, weekly_harmonic_analysis: { fabricated:true }, experimental_harmonic_analysis: { fabricated:true } },
  kesimpulan: 'Analisis data saja.', sources: [],
};
let calls: any[] = [];
process.env.HERMES_API_KEY = 'isolated-hermes-test-key';
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: any, options: any) => {
    calls.push({ url: String(url), options });
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] });
  }) as typeof fetch;
});
test('route returns202 durable ID without Hermes wait; GET resumes exact job ID, rejects offline and invalid inputs', async () => {
  const { NextRequest } = await import('next/server');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'isolated-placeholder';
  const dbModule = await import('../lib/supabase');
  const db = ('default' in dbModule ? dbModule.default : dbModule) as typeof import('../lib/supabase');
  const rows: any[] = [];
  (db.supabase as any).from = (table: string) => {
    let filters: any[] = [], inserted: any;
    const b: any = { select: () => b, order: () => b, limit: () => b,
      eq: (k: string, v: any) => { filters.push([k,v]); return b; },
      insert: (r: any) => { inserted = { ...r, id: rows.length+1, created_at: new Date().toISOString() }; rows.push(inserted); return b; },
      single: async () => ({ data: table === 'agent_stories' ? inserted || rows.find(r => filters.every(([k,v]) => r[k] === v)) || null : null, error: null }),
      maybeSingle: async () => b.single(),
    }; return b;
  };
  const routeModule = await import('../app/api/analyze-story/route');
  const route = ('default' in routeModule ? routeModule.default : routeModule) as typeof import('../app/api/analyze-story/route');
  const jobsModule = await import('../lib/story-jobs');
  const { StoryJobStore } = ('default' in jobsModule ? jobsModule.default : jobsModule) as typeof import('../lib/story-jobs');
  const dir = await mkdtemp(join(tmpdir(), 'story-route-'));
  process.env.STORY_JOB_DIR = dir;
  const req = (body: unknown = payload) => new NextRequest('http://localhost/api/analyze-story', { method: 'POST', body: JSON.stringify(body) });
  try {
    assert.equal((await route.POST(req())).status, 503);
    assert.equal(rows.length, 0);
    const store = new StoryJobStore(dir), release = await store.lockWorker();
    await store.heartbeat();
    const res = await route.POST(req());
    assert.equal(res.status, 202);
    const data = (await res.json()).data;
    assert.equal(data.status, 'pending');
    assert.equal(calls.filter(c => c.url.includes('/chat/completions')).length, 0);
    const queued = await store.claim();
    assert.equal(queued?.id, data.id);
    assert.equal(queued?.data.harmonicAnalysis?.asOf, payload.analysis.input.toDate);
    assert.equal(queued?.data.experimentalHarmonicAnalysis?.timeframe, "1W");
    assert.equal(queued?.data.experimentalHarmonicAnalysis?.status, "unavailable");
    assert.equal(queued?.data.weeklyHarmonicAnalysis?.timeframe, "1W");
    assert.equal(queued?.data.weeklyHarmonicAnalysis?.asOf, payload.analysis.input.toDate);
    assert.ok(!JSON.stringify(queued).includes('DO-NOT-SEND'));
    assert.equal((await (await route.POST(req())).json()).data.id, data.id);
    const status = await route.GET(new NextRequest(`http://localhost/api/analyze-story?id=${data.id}&context=${data.thinking_level}`));
    assert.equal((await status.json()).data.id, data.id);
    assert.equal((await route.GET(new NextRequest('http://localhost/api/analyze-story?id=999'))).status, 404);
    for (const body of [{ emiten: '../BBCA' }, { ...payload, emiten: 'TLKM' }, { ...payload, analysis: {} }]) assert.equal((await route.POST(req(body))).status, 400);
    await release();
  } finally { delete process.env.STORY_JOB_DIR; await rm(dir, { recursive: true, force: true }); }
});

test('UI polls exact durable ID, resumes storage, awaits matching fundamentals, and separates section5 technical facts', async () => {
  const calculator = await readFile(new URL('../app/components/Calculator.tsx', import.meta.url), 'utf8');
  const card = await readFile(new URL('../app/components/AgentStoryCard.tsx', import.meta.url), 'utf8');
  assert.match(calculator, /analyze-story\?id=/);
  assert.match(calculator, /localStorage\.getItem\('active-story-job'\)/);
  assert.match(calculator, /await.*keyStatsRequestRef\.current\.promise/);
  assert.match(calculator, /keyStatsEmiten: emiten/);
  assert.ok(!calculator.includes('MAX_POLL_ATTEMPTS'));
  assert.match(card, /masih berjalan/);
  assert.match(card, /Fundamental Signal &amp; Harmonic \/ PRZ/);
  assert.match(card, /<HarmonicPanel analysis=\{data.strategi_trading.harmonic_analysis\}/);
  assert.match(card, /<HarmonicWeeklyPanel analysis=\{data.strategi_trading\?\.weekly_harmonic_analysis\}/);
});

test('sanitized context includes broker distribution, normalized units and actual calculator formulas', () => {
  const input = storyInput(payload);
  assert.match(input.context, /^local-data:v7:/);
  assert.equal(storyInput({...payload, weeklyHarmonicAnalysis:{injected:true}}).data.weeklyHarmonicAnalysis, undefined);
  assert.ok(input.data.analysis.brokerSummary);
  assert.equal(input.data.analysis.brokerSummary.detector.broker_accdist, 'BigDist');
  assert.equal(input.data.analysis.brokerSummary.topSellers[0].slot, '110');
  assert.equal(input.data.metadata.units.orderbookDisplayLots.totalBid, 10);
  assert.match(input.data.metadata.formulas.targetRealistis1, /p.*2/);
  assert.match(input.data.metadata.quoteSnapshot, /timestamp.*tidak tersedia/);
  assert.equal(input.data.metadata.keyStatsEmiten, 'BBCA');
  assert.ok(!JSON.stringify(input).includes('DO-NOT-SEND'));
  assert.throws(() => storyInput({ ...payload, keyStatsEmiten: 'TLKM' }), /Emiten KeyStats/);
  assert.notEqual(input.context, storyInput({ ...payload, keyStats: null }).context);
});
test('default hard timeout is three minutes and cannot exceed it', () => {
  delete process.env.HERMES_STORY_TIMEOUT_MS;
  assert.equal(storyTimeout(), 180000);
  process.env.HERMES_STORY_TIMEOUT_MS = '999999';
  assert.equal(storyTimeout(), 180000);
  delete process.env.HERMES_STORY_TIMEOUT_MS;
});
test('Hermes has no tools/news, narrates authoritative daily harmonic only, rejects fake citations and fake technical payload', async () => {
  const input = storyInput(payload);
  const out = await requestHermes(input.data);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.model, 'gpt-6.1-sol');
  assert.equal(sent.provider, 'openai-codex');
  assert.deepEqual(sent.tools, []);
  assert.match(sent.messages[0].content, /tanpa backtest/);
  assert.match(sent.messages[0].content, /harmonicAnalysis/);
  assert.match(sent.messages[0].content, /prz_touched/);
  assert.match(sent.messages[0].content, /expired/);
  assert.match(sent.messages[0].content, /bukan snapshot historis/);
  assert.ok(!calls[0].options.body.includes('DO-NOT-SEND'));
  assert.equal(out.strategi_trading?.harmonic_analysis, undefined);
  assert.equal(out.strategi_trading?.weekly_harmonic_analysis, undefined);
  assert.equal(out.strategi_trading?.experimental_harmonic_analysis, undefined);
  assert.deepEqual(out.sources, []);
});
test('Hermes payload omits OHLC and nonallowlisted harmonic fields while retaining deterministic facts',async()=>{
  const input=storyInput(payload);
  const {analyzeHarmonics}=await import('../lib/harmonic');
  const rows=Array.from({length:200},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100,high:102,low:99,close:101}));
  input.data.harmonicAnalysis=Object.assign(analyzeHarmonics(rows,{emiten:'BBCA',asOf:'2026-10-27'}),{notAllowed:'DO-NOT-SEND'});
  await requestHermes(input.data);
  const sent=JSON.parse(calls[0].options.body),modelData=JSON.parse(sent.messages[1].content);
  assert.equal(modelData.harmonicAnalysis.candles,undefined);
  assert.equal(modelData.harmonicAnalysis.notAllowed,undefined);
  assert.equal(modelData.harmonicAnalysis.candleCount,200);
  assert.equal(input.data.harmonicAnalysis.candles?.length,200);
  assert.ok(Buffer.byteLength(calls[0].options.body)<160000);
});
test('weekly model summary excludes OHLC and unknown fields, preserves weekly provenance and scales',async()=>{
  const input=storyInput(payload);
  input.data.weeklyHarmonicAnalysis={status:'no_pattern',emiten:'BBCA',timeframe:'1W',asOf:'2026-10-27',source:'Daily aggregation',candles:[{injected:'DO-NOT-SEND'}],candleCount:365,partialWeekExcluded:true,methodology:'Strict weekly',results:[],reason:'No pattern',completionPolicy:'Closed weeks',secret:'DO-NOT-SEND'} as any;
  input.data.weeklyHarmonicAnalysis!.history={requestedStart:'2019-10-27',requestedEnd:'2026-10-27',dailyCandleCount:1685,providerRequests:40,adjustmentStatus:'Unknown',secret:'DO-NOT-SEND'} as any;
  await requestHermes(input.data);
  const sent=JSON.parse(calls[0].options.body),w=JSON.parse(sent.messages[1].content).weeklyHarmonicAnalysis;
  assert.equal(w.candles,undefined);assert.equal(w.secret,undefined);assert.equal(w.timeframe,'1W');assert.equal(w.candleCount,365);assert.equal(w.partialWeekExcluded,true);assert.equal(w.source,'Daily aggregation');assert.deepEqual(w.results,[]);assert.ok(!calls[0].options.body.includes('DO-NOT-SEND'));
  assert.match(sent.messages[0].content,/weeklyHarmonicAnalysis/);
  assert.equal(w.history.dailyCandleCount,1685);assert.equal(w.history.secret,undefined);
});
test('model request fails closed before fetch when total payload exceeds bound',async()=>{
  const input=storyInput(payload);
  (input.data.metadata as any).huge='x'.repeat(160001);
  await assert.rejects(requestHermes(input.data),/terlalu besar/);
  assert.equal(calls.length,0);
});
test('timeout is an uncertain upstream wait outcome, not confirmed cancellation; malformed output and Hermes error fail', async () => {
  const data = storyInput(payload).data;
  globalThis.fetch = (async () => { throw new DOMException('private-detail', 'TimeoutError'); }) as typeof fetch;
  await assert.rejects(requestHermes(data), /belum terkonfirmasi.*Jangan otomatis/);
  for (const response of [{ choices: [{ finish_reason: 'cancelled', message: { content: JSON.stringify(result) } }] }, { choices: [{ message: { content: '{}' } }] }, { hermes: { error_code: 'private' } }]) {
    globalThis.fetch = (async () => Response.json(response)) as typeof fetch;
    await assert.rejects(requestHermes(data), /tidak tersedia/);
  }
});


test('experimental model summary is explicitly allowlisted and never forwards OHLC or injected secrets', async()=>{
  const input=storyInput({...payload,experimentalHarmonicAnalysis:{secret:'CLIENT-SPOOF'}});
  assert.equal(input.data.experimentalHarmonicAnalysis,undefined);
  const { analysis, result }=await import('./fixtures-zigzag.mjs');
  input.data.experimentalHarmonicAnalysis={...analysis,token:'EXPERIMENT-SECRET',results:[{...result,token:'EXPERIMENT-SECRET',pivots:{...result.pivots,A:{...result.pivots.A,token:'EXPERIMENT-SECRET'}},ratios:{BC_AB:0.6,token:'EXPERIMENT-SECRET'},prz:{...result.prz,token:'EXPERIMENT-SECRET'}}]} as any;
  assert.notEqual(local.storyContext(input.data),storyInput(payload).context);
  await requestHermes(input.data);
  const body=JSON.parse(calls[0].options.body);
  const facts=JSON.parse(body.messages[1].content).experimentalHarmonicAnalysis;
  assert.equal(facts.experimental,true);
  assert.equal(facts.results[0].availableAt,result.availableAt);
  assert.equal(facts.results[0].pivots.A.confirmedAt,result.pivots.A.confirmedAt);
  assert.equal(facts.candles,undefined);
  assert.ok(!calls[0].options.body.includes('EXPERIMENT-SECRET'));
  assert.match(body.messages[0].content,/experimentalHarmonicAnalysis/);
  assert.match(body.messages[0].content,/baseline.*utama/);
});
