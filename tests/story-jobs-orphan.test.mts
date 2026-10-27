import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const worker = require('../lib/story-worker.ts') as typeof import('../lib/story-worker');
const { StoryJobStore } = require('../lib/story-jobs.ts') as typeof import('../lib/story-jobs');
const context = 'local-data:v7:' + 'a'.repeat(64);
async function fixture(task: (f: any) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'story-orphan-'));
  const store = new StoryJobStore(dir);
  const release = await store.lockWorker();
  await store.heartbeat();
  let row: any = { id: 41, emiten: 'BBCA', thinking_level: context, status: 'pending' };
  const deps = { get: async () => ({ ...row }), find: async () => ({ ...row }),
    create: async () => { throw new Error('must not create again'); },
    update: async (_: number, patch: any) => { row = { ...row, ...patch }; },
    generate: async () => { throw new Error('must not replay Hermes'); } };
  try { await task({ store, deps, row: () => row, set: (value: any) => { row = value; },
    input: { emiten: 'BBCA', context, data: {} },
    job: { id: 41, emiten: 'BBCA', context, createdAt: '2026-10-27', data: {} } }); }
  finally { await release(); await rm(dir, { recursive: true, force: true }); }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test('queued and running pending rows remain legitimate on poll and repeat submit', async () => {
  await fixture(async ({ store, deps, job, input }: any) => {
    await store.enqueue(job);
    for (const state of ['queued', 'running']) {
      assert.equal((await worker.pollStory(41, store, deps))?.status, 'pending', state);
      assert.equal((await worker.submitStory(input, store, deps)).status, 'pending', state);
      if (state === 'queued') await store.claim();
    }
  });
});
test('poll cannot mark insertion in flight orphan before enqueue finishes', async () => {
  await fixture(async ({ store, deps, input, row }: any) => {
    const inserted = deferred(), allowCreate = deferred(), read = deferred();
    deps.find = async () => null;
    deps.create = async () => { inserted.resolve(); await allowCreate.promise; return row(); };
    const submission = worker.submitStory(input, store, deps);
    await inserted.promise;
    deps.get = async () => { read.resolve(); return { ...row() }; };
    let polled = false;
    const polling = worker.pollStory(41, store, deps).then(result => { polled = true; return result; });
    await read.promise;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(polled, false);
    allowCreate.resolve();
    await submission;
    assert.equal((await polling)?.status, 'pending');
    assert.equal(row().status, 'pending');
  });
});
test('completed after stale poll read is reread under lock and never overwritten', async () => {
  await fixture(async ({ store, deps, row, set }: any) => {
    let reads = 0;
    deps.get = async () => {
      const snapshot = { ...row() };
      if (++reads === 1) set({ ...snapshot, status: 'completed', ringkasan: 'saved result' });
      return snapshot;
    };
    const result = await worker.pollStory(41, store, deps);
    assert.equal(result?.status, 'completed');
    assert.equal(row().ringkasan, 'saved result');
    assert.equal(reads, 2);
  });
});
test('uncertain processing without queue never requeues or retries Hermes', async () => {
  await fixture(async ({ store, deps, input, row, set }: any) => {
    set({ ...row(), status: 'processing' });
    assert.equal((await worker.pollStory(41, store, deps))?.status, 'processing');
    assert.equal((await worker.submitStory(input, store, deps)).status, 'processing');
    assert.equal(await worker.runOne(store, deps), false);
  });
});
test('orphan error persistence failure rejects poll and submit without enqueue', async () => {
  await fixture(async ({ store, deps, input, row }: any) => {
    deps.update = async () => { throw new Error('DB unavailable'); };
    await assert.rejects(worker.pollStory(41, store, deps), /DB unavailable/);
    await assert.rejects(worker.submitStory(input, store, deps), /DB unavailable/);
    assert.equal(row().status, 'pending');
    assert.equal(await store.claim(), null);
  });
});
test('completion persistence failure retains running file and recovery never generates again', async () => {
  await fixture(async ({ store, deps, job, row }: any) => {
    job.data = { metadata: {} };
    let generations = 0;
    const update = deps.update;
    deps.generate = async () => { generations++; return { strategi_trading: {} }; };
    deps.update = async (id: number, patch: any) => {
      if (patch.status === 'completed') throw new Error('DB unavailable');
      await update(id, patch);
    };
    await store.enqueue(job);
    await assert.rejects(worker.runOne(store, deps), /DB unavailable/);
    assert.equal((await store.running()).length, 1);
    assert.equal(row().status, 'processing');
    await worker.pollStory(41, store, deps);
    await worker.recoverInterrupted(store, deps);
    assert.equal(row().status, 'error');
    assert.equal(generations, 1);
    assert.equal(await worker.runOne(store, deps), false);
  });
});

test('worker completion waits for reconciliation context lock', async () => {
  await fixture(async ({ store, deps, job, row }: any) => {
    job.data = { metadata: {} };
    let allowGeneration!: () => void;
    let started!: () => void;
    const generating = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { allowGeneration = resolve; });
    deps.generate = async () => { started(); await gate; return { strategi_trading: {} }; };
    await store.enqueue(job);
    const running = worker.runOne(store, deps);
    await generating;
    await store.withContextLock(context, async () => {
      allowGeneration();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(row().status, 'processing');
    });
    await running;
    assert.equal(row().status, 'completed');
  });
});
test('claim waits for context lock so queued to running cannot be mistaken for orphan', async () => {
  await fixture(async ({ store, job, deps }: any) => {
    await store.enqueue(job);
    let claimed = false;
    let claim: Promise<any>;
    await store.withContextLock(context, async () => {
      claim = store.claim().then((value: any) => { claimed = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(claimed, false);
    });
    assert.equal((await claim!).id, 41);
    assert.equal((await worker.pollStory(41, store, deps))?.status, 'pending');
  });
});
test('exact ID polling reconciles orphan even without worker heartbeat', async () => {
  await fixture(async ({ store, deps, row }: any) => {
    await rm(join(store.dir, 'heartbeat.json'));
    const result = await worker.pollStory(41, store, deps);
    assert.equal(result?.status, 'error');
    assert.equal(row().status, 'error');
  });
});
test('repeat submit fails closed for pending row left by crash before enqueue', async () => {
  await fixture(async ({ store, deps, input, row }: any) => {
    const result = await worker.submitStory(input, store, deps);
    assert.equal(result.status, 'error');
    assert.equal(row().status, 'error');
    assert.equal(await store.claim(), null);
  });
});
