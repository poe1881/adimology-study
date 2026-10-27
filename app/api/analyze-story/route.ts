import { analyzeZigzagHarmonics } from '@/lib/harmonic-zigzag';
import { NextRequest, NextResponse } from 'next/server';
import { createAgentStory, getAgentStoriesByEmiten, getAgentStoryByContext, getAgentStoryById, updateAgentStory } from '@/lib/supabase';
import { storyInput, storyContext, StoryError } from '@/lib/story-local';
import { StoryJobStore } from '@/lib/story-jobs';
import { pollStory, submitStory } from '@/lib/story-worker';
import { getHarmonicAnalysis } from '@/lib/stockbit-history';
import { getWeeklyHarmonicAnalysis } from '@/lib/stockbit-weekly-history';

export const runtime = 'nodejs';
export const maxDuration = 60;
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('id')) {
      const id = params.get('id')!;
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new StoryError('ID Story tidak valid.', 400);
      const story = await pollStory(Number(id), new StoryJobStore(), { get: getAgentStoryById, update: updateAgentStory });
      if (!story || (params.has('context') && story.thinking_level !== params.get('context'))) return NextResponse.json({ success: false, error: 'Story tidak ditemukan.' }, { status: 404, headers: noStore });
      return NextResponse.json({ success: true, data: story, workerReady: await new StoryJobStore().ready() }, { headers: noStore });
    }
    const emiten = params.get('emiten')?.toUpperCase();
    if (!emiten || !/^[A-Z][A-Z0-9.-]{0,11}$/.test(emiten)) throw new StoryError('Emiten tidak valid.', 400);
    // History only; active job status is always queried by exact ID + context.
    return NextResponse.json({ success: true, data: await getAgentStoriesByEmiten(emiten) }, { headers: noStore });
  } catch (error) {
    const safe = error instanceof StoryError ? error : new StoryError('Gagal memuat analisis.', 503);
    return NextResponse.json({ success: false, error: safe.message }, { status: safe.status, headers: noStore });
  }
}
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > 100000) throw new StoryError('Data analisis terlalu besar.', 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new StoryError('JSON tidak valid.', 400); }
    // Validate before side effects or upstream reads. Client technical fields are ignored.
    let input = storyInput(body);
    const store = new StoryJobStore();
    if (!await store.ready()) throw new StoryError('Story worker belum aktif. Jalankan npm run story:worker.', 503);
    // Missing fundamentals are fetched for this exact symbol; never borrow another stock's cache.
    if (!Object.values(input.data.keyStats).some(rows => rows.length)) {
      try {
        const { fetchKeyStats } = await import('@/lib/stockbit');
        const keyStats = await fetchKeyStats(input.emiten);
        input = storyInput({ ...body, keyStats, keyStatsEmiten: input.emiten });
      } catch { /* Missing fundamentals remain explicitly absent, never invented. */ }
    }
    [input.data.harmonicAnalysis, input.data.weeklyHarmonicAnalysis] = await Promise.all([
      getHarmonicAnalysis(input.emiten, input.data.analysis.input.toDate),
      getWeeklyHarmonicAnalysis(input.emiten, input.data.analysis.input.toDate),
    ]);
    const weekly = input.data.weeklyHarmonicAnalysis;
    const experimental = { ...analyzeZigzagHarmonics(weekly.candles, { emiten: input.emiten, asOf: input.data.analysis.input.toDate }),
      source: `${weekly.source} → completed weekly OHLC → experimental causal ZigZag`,
    };
    input.data.experimentalHarmonicAnalysis = weekly.status === 'unavailable'
      ? { ...experimental, status: 'unavailable', results: [], reason: 'Riwayat weekly tidak tersedia; eksperimen tidak dihitung.' }
      : experimental;
    input.context = storyContext(input.data);
    const saved = await submitStory(input, store, { find: getAgentStoryByContext, create: createAgentStory, update: updateAgentStory });
    return NextResponse.json({ success: true, data: saved, jobId: saved.id }, { status: saved.status === 'completed' || saved.status === 'error' ? 200 : 202, headers: noStore });
  } catch (error) {
    const safe = error instanceof StoryError ? error : new StoryError('Analisis tidak tersedia. Hasil Cek Bandar tetap tersedia.', 503);
    return NextResponse.json({ success: false, error: safe.message }, { status: safe.status, headers: noStore });
  }
}
