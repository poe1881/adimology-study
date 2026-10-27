import { StoryJobStore } from '../lib/story-jobs';
import { recoverInterrupted, runOne } from '../lib/story-worker';
import { requestHermes } from '../lib/story-local';
import { getAgentStoryById, updateAgentStory } from '../lib/supabase';

async function main() {
  const store = new StoryJobStore();
  const release = await store.lockWorker();
  const deps = { get: getAgentStoryById, update: updateAgentStory, generate: requestHermes };
  let stopping = false;
  let heartbeatFailed = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });
  // Never replay a request whose prior outcome may have reached the gateway.
  await recoverInterrupted(store, deps);
  await store.heartbeat();
  const heartbeat = setInterval(() => {
    store.heartbeat().catch(() => { heartbeatFailed = true; stopping = true; });
  }, 3000);
  console.log('Story worker ready (local durable queue; one job at a time).');
  try {
    while (!stopping) {
      // A persistence failure stops the worker; do not consume/replay more jobs.
      const ran = await runOne(store, deps);
      if (!ran) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (heartbeatFailed) throw new Error('Story heartbeat unavailable');
  } finally {
    clearInterval(heartbeat);
    await release();
  }
}
main().catch(() => {
  console.error('Story worker stopped or another worker owns the lock. Check local queue/DB connectivity; no automatic request retry.');
  process.exitCode = 1;
});
