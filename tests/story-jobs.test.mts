import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const worker = require('../lib/story-worker.ts') as typeof import('../lib/story-worker');
const storyJobs = require('../lib/story-jobs.ts') as typeof import('../lib/story-jobs');
import { writeFile } from 'node:fs/promises';
const { StoryJobStore } = storyJobs;

test('concurrent submission durably queues one pending row without running Hermes and rejects offline worker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'story-submit-'));
  try {
    const store = new StoryJobStore(dir);
    const input = { emiten: 'BBCA', context: 'local-data:v6:' + 'a'.repeat(64), data: {} } as any;
    let row: any = null;
    let creates = 0;
    const deps = { find: async () => row, create: async () => { creates++; row = { id: 17, status: 'pending', created_at: new Date().toISOString() }; return row; }, update: async () => {} };
    await assert.rejects(worker.submitStory(input, store, deps), /worker.*aktif/);
    assert.equal(creates, 0);
    const release = await store.lockWorker();
    await store.heartbeat();
    assert.equal(await store.withContextLock('local-data:v4:'+'b'.repeat(64),async()=>'legacy'),'legacy');
    assert.equal(await store.withContextLock('local-data:v5:'+'c'.repeat(64),async()=>'legacy'),'legacy');
    assert.equal(await store.withContextLock('local-data:v7:'+'d'.repeat(64),async()=>'new'),'new');
    const submitted = await Promise.all([worker.submitStory(input, store, deps), worker.submitStory(input, new StoryJobStore(dir), deps)]);
    assert.equal(submitted[0].id, submitted[1].id);
    assert.equal(creates, 1);
    assert.equal((await store.claim())?.id, 17);
    row.status = 'error';
    await worker.submitStory(input, store, deps);
    assert.equal(await store.claim(), null, 'terminal errors never replay automatically');
    await release();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('worker persists processing and completed with authoritative technical result, never replays interrupted jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'story-worker-'));
  try {
    const store = new StoryJobStore(dir);
    const { analyzeHarmonics } = require('../lib/harmonic.ts') as typeof import('../lib/harmonic');
    const snapshot=analyzeHarmonics(Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,8,i+1)).toISOString().slice(0,10),open:140,high:141,low:139,close:140})),{emiten:'BBCA',asOf:'2026-10-27'});
    const harmonicAnalysis = { ...snapshot, watch: { stage: 'prz_touched', touchedAt: '2026-10-27', projection: { prz: { low: 119.4, high: 123.4 } }, provisionalD: { price: 121.4 } } };
    const job = { id: 9, emiten: 'BBCA', context: 'local-data:v4:' + 'a'.repeat(64), createdAt: new Date().toISOString(), data: { metadata: { brokerPeriod: { fromDate: '2026-10-26', toDate: '2026-10-27' }, keyStatsEmiten: 'BBCA' }, harmonicAnalysis, experimentalHarmonicAnalysis: { experimental:true, candles:[], results:[] }, weeklyHarmonicAnalysis: { timeframe:"1W", candles:[], results:[] } } } as any;
    let row: any = { id: 9, status: 'pending', thinking_level: job.context };
    const statuses: string[] = [];
    let generated = 0;
    const deps = { get: async () => row, update: async (_: number, patch: any) => { row = { ...row, ...patch }; statuses.push(patch.status); }, generate: async () => { generated++; return { strategi_trading: { harmonic_analysis: { fabricated: true }, weekly_harmonic_analysis: { fabricated:true }, experimental_harmonic_analysis: { fabricated:true } } } as any; } };
    await store.enqueue(job);
    await worker.runOne(store, deps);
    assert.deepEqual(statuses, ['processing', 'completed']);
    assert.deepEqual(row.strategi_trading.harmonic_analysis, harmonicAnalysis);
    assert.deepEqual(row.strategi_trading.weekly_harmonic_analysis, job.data.weeklyHarmonicAnalysis);
    assert.deepEqual(row.strategi_trading.experimental_harmonic_analysis, job.data.experimentalHarmonicAnalysis);
    assert.equal(row.strategi_trading.story_context.context, job.context);
    assert.equal(await worker.runOne(store, deps), false);
    assert.equal(generated, 1);
    row.status = 'processing';
    await store.enqueue(job);
    await store.claim();
    await worker.recoverInterrupted(store, deps);
    assert.equal(row.status, 'error');
    assert.match(row.error_message, /belum terkonfirmasi/);
    assert.equal(generated, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stale dead worker lock can be replaced, but stale heartbeat is not readiness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'story-lock-'));
  try {
    const store = new StoryJobStore(dir);
    await writeFile(join(dir, 'worker.lock'), JSON.stringify({ pid: 2147483647 }));
    const release = await store.lockWorker();
    await writeFile(join(dir, 'heartbeat.json'), JSON.stringify({ pid: process.pid, at: 0 }));
    assert.equal(await store.ready(), false);
    await release();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('durable queue survives store recreation, claims once, and heartbeat requires live worker', async () => {
  assert.equal(typeof StoryJobStore, 'function', 'durable job store is required');
  const dir = await mkdtemp(join(tmpdir(), 'story-jobs-'));
  try {
    const store = new StoryJobStore(dir);
    assert.equal(await store.ready(), false);
    const release = await store.lockWorker();
    await store.heartbeat();
    assert.equal(await new StoryJobStore(dir).ready(), true);
    await assert.rejects(store.lockWorker(), /already/);
    const job = { id: 7, context: 'local-data:v4:' + 'a'.repeat(64), emiten: 'BBCA', createdAt: new Date().toISOString(), data: { safe: 'data' } };
    await store.enqueue(job as any);
    const restarted = new StoryJobStore(dir);
    assert.equal((await restarted.claim())?.id, 7);
    assert.equal(await restarted.claim(), null);
    await restarted.finish(7);
    await release();
    assert.equal(await store.ready(), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
