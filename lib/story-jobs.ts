import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { storyInput } from './story-local';

export interface StoryJob {
  id: number;
  emiten: string;
  context: string;
  createdAt: string;
  data: ReturnType<typeof storyInput>['data'];
}
const alive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
export class StoryJobStore {
  constructor(public dir = resolve(process.env.STORY_JOB_DIR || '.local/story-jobs')) {}
  private async atomic(name: string, value: unknown) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temp = join(this.dir, `.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, join(this.dir, name));
  }
  private async json(name: string) {
    try { return JSON.parse(await readFile(join(this.dir, name), 'utf8')); } catch { return null; }
  }
  async lockWorker() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, 'worker.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(path, 'wx', 0o600);
        const token = randomUUID();
        await file.writeFile(JSON.stringify({ pid: process.pid, token }));
        await file.close();
        return async () => {
          if ((await this.json('worker.lock'))?.token === token) {
            await unlink(path).catch(() => {});
            await unlink(join(this.dir, 'heartbeat.json')).catch(() => {});
          }
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const lock = await this.json('worker.lock');
        // Invalid/incomplete locks are not stolen (another process may be writing).
        if (!lock || alive(lock.pid)) throw new Error('Story worker already running or lock incomplete');
        await unlink(path).catch(() => {});
      }
    }
    throw new Error('Story worker already running');
  }
  async heartbeat() { await this.atomic('heartbeat.json', { pid: process.pid, at: Date.now() }); }
  async ready() {
    const [beat, lock] = await Promise.all([this.json('heartbeat.json'), this.json('worker.lock')]);
    return !!(beat && lock && beat.pid === lock.pid && alive(lock.pid) && Date.now() - beat.at < 15000);
  }
  async withContextLock<T>(context: string, task: () => Promise<T>): Promise<T> {
    if (!/^local-data:v[4567]:[a-f0-9]{64}$/.test(context)) throw new Error('Invalid Story context');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const name = `submit-${context.split(':').at(-1)}.lock`;
    const path = join(this.dir, name);
    for (let attempt = 0; attempt < 100; attempt++) {
      let file;
      try { file = await open(path, 'wx', 0o600); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const owner = await this.json(name);
        if (owner && !alive(owner.pid)) await unlink(path).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      try {
        await file.writeFile(JSON.stringify({ pid: process.pid }));
        await file.close();
        return await task();
      } finally { await file.close().catch(() => {}); await unlink(path).catch(() => {}); }
    }
    throw new Error('Story submission is busy');
  }
  // Call under the context lock shared with claim/finish transitions.
  async hasJob(id: number) {
    for (const state of ['queued', 'running']) {
      try { await readFile(join(this.dir, `${id}.${state}.json`)); return true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    return false;
  }
  async enqueue(job: StoryJob) { await this.atomic(`${job.id}.queued.json`, job); }
  async claim(): Promise<StoryJob | null> {
    const names = (await readdir(this.dir)).filter(n => /^\d+\.queued\.json$/.test(n)).sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]));
    for (const name of names) {
      const queued = await this.json(name);
      if (!queued) continue;
      const job = await this.withContextLock(queued.context, async () => {
        try { await rename(join(this.dir, name), join(this.dir, name.replace('.queued.', '.running.'))); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
        const running = await this.json(name.replace('.queued.', '.running.'));
        if (!running || running.id !== Number(name.split('.')[0])) throw new Error('Invalid local Story job');
        return running as StoryJob;
      });
      if (job) return job;
    }
    return null;
  }
  async running(): Promise<StoryJob[]> {
    const names = (await readdir(this.dir)).filter(n => /^\d+\.running\.json$/.test(n));
    return (await Promise.all(names.map(n => this.json(n)))).filter(Boolean);
  }
  async finish(id: number) { await unlink(join(this.dir, `${id}.running.json`)).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
