import { StoryJobStore, type StoryJob } from './story-jobs';
import { StoryError, type storyInput } from './story-local';
import type { AgentStoryResult } from './types';
// Caller owns the context lock: submission and every worker transition share it.
async function reconcilePending(row: AgentStoryResult, store: StoryJobStore, deps: {
  update(id: number, data: Partial<AgentStoryResult>): Promise<unknown>;
}) {
  if (row.status !== 'pending' || !row.id || await store.hasJob(row.id)) return row;
  const patch = { status: 'error' as const, error_message: 'Antrean Story tidak ditemukan; pengiriman terputus. Tidak diulang otomatis untuk mencegah duplikasi.' };
  await deps.update(row.id, patch);
  return { ...row, ...patch };
}

export async function submitStory(input: ReturnType<typeof storyInput>, store: StoryJobStore, deps: {
  find(emiten: string, context: string): Promise<AgentStoryResult | null>;
  create(emiten: string, context: string): Promise<AgentStoryResult>;
  update(id: number, data: Partial<AgentStoryResult>): Promise<unknown>;
}) {
  if (!await store.ready()) throw new StoryError('Story worker belum aktif. Jalankan npm run story:worker.', 503);
  return store.withContextLock(input.context, async () => {
    const existing = await deps.find(input.emiten, input.context);
    // No automatic retry, even after wait timeout or interrupted worker.
    if (existing) return reconcilePending(existing, store, deps);
    const row = await deps.create(input.emiten, input.context);
    try {
      if (!row.id) throw new Error('Story ID missing');
      await store.enqueue({ id: row.id, emiten: input.emiten, context: input.context, data: input.data, createdAt: row.created_at || new Date().toISOString() });
    } catch {
      if (row.id) await deps.update(row.id, { status: 'error', error_message: 'Gagal menyimpan antrean lokal; analisis tidak dikirim ke Hermes.' });
      throw new StoryError('Antrean Story tidak tersedia.', 503);
    }
    return row;
  });
}
export async function pollStory(id: number, store: StoryJobStore, deps: Pick<WorkerDependencies, 'get' | 'update'>) {
  const initial = await deps.get(id);
  if (!initial || !/^local-data:v[4567]:[a-f0-9]{64}$/.test(initial.thinking_level || '')) return initial;
  return store.withContextLock(initial.thinking_level!, async () => {
    // The first read only locates the lock; never write based on that stale snapshot.
    const current = await deps.get(id);
    if (!current || current.thinking_level !== initial.thinking_level) return current;
    return reconcilePending(current, store, deps);
  });
}

export interface WorkerDependencies {
  get(id: number): Promise<AgentStoryResult | null>;
  update(id: number, data: Partial<AgentStoryResult>): Promise<unknown>;
  generate(data: StoryJob['data']): Promise<Partial<AgentStoryResult>>;
}
export async function runOne(store: StoryJobStore, deps: WorkerDependencies) {
  const job = await store.claim();
  if (!job) return false;
  const shouldGenerate = await store.withContextLock(job.context, async () => {
    const row = await deps.get(job.id);
    if (!row || row.thinking_level !== job.context) throw new Error('Story queue context mismatch');
    if (row.status !== 'pending') {
      if (row.status === 'processing') await deps.update(job.id, { status: 'error', error_message: 'Status proses lama tidak pasti; tidak diulang otomatis.' });
      await store.finish(job.id);
      return false;
    }
    await deps.update(job.id, { status: 'processing', error_message: 'Hermes sedang menganalisis data lokal.' });
    return true;
  });
  if (!shouldGenerate) return true;
  let output: Partial<AgentStoryResult>;
  try {
    const generated = await deps.generate(job.data);
    output = { ...generated, status: 'completed', error_message: '', thinking_level: job.context,
      strategi_trading: { ...generated.strategi_trading!, story_context: { context: job.context, brokerPeriod: job.data.metadata.brokerPeriod, keyStatsEmiten: job.data.metadata.keyStatsEmiten, submittedAt: job.createdAt },
        harmonic_analysis: job.data.harmonicAnalysis, weekly_harmonic_analysis: job.data.weeklyHarmonicAnalysis, experimental_harmonic_analysis: job.data.experimentalHarmonicAnalysis },
    };
  } catch (error) {
    output = { status: 'error', error_message: error instanceof StoryError ? error.message : 'Analisis lokal gagal; hasil Cek Bandar tetap tersedia.' };
  }
  // Persistence failure is deliberately not treated as a generation failure/retry.
  // Retain running file; restart reconciliation marks unknown outcomes without replay.
  await store.withContextLock(job.context, async () => {
    await deps.update(job.id, output);
    await store.finish(job.id);
  });
  return true;
}
export async function recoverInterrupted(store: StoryJobStore, deps: WorkerDependencies) {
  for (const job of await store.running()) {
    await store.withContextLock(job.context, async () => {
      const row = await deps.get(job.id);
      if (row && ['pending', 'processing'].includes(row.status)) await deps.update(job.id, {
        status: 'error', error_message: 'Worker terhenti; hasil/pembatalan Hermes belum terkonfirmasi. Tidak diulang otomatis untuk mencegah duplikasi.',
      });
      await store.finish(job.id);
    });
  }
}
