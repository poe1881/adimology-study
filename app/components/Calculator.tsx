'use client';

import { useState, useEffect, useRef } from 'react';
import InputForm from './InputForm';
import CompactResultCard from './CompactResultCard';
import BrokerSummaryCard from './BrokerSummaryCard';
import KeyStatsCard from './KeyStatsCard';
import AgentStoryCard from './AgentStoryCard';
import PriceGraph from './PriceGraph';
import BrokerFlowCard from './BrokerFlowCard';
import EmitenHistoryCard from './EmitenHistoryCard';

import * as htmlToImage from 'html-to-image';
import type { StockInput, StockAnalysisResult, KeyStatsData, AgentStoryResult } from '@/lib/types';
import { getDefaultDate } from '@/lib/utils';

interface CalculatorProps {
  selectedStock?: string | null;
}

// Helper function to format the result data for copying
function formatResultForCopy(result: StockAnalysisResult): string {
  const { input, stockbitData, marketData, calculated } = result;

  const formatNumber = (num: number | null | undefined) => num?.toLocaleString() ?? '-';

  const calculateGain = (target: number) => {
    const gain = ((target - marketData.harga) / marketData.harga) * 100;
    return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}`;
  };

  const lines = [
    `ADIMOLGY: ${input.emiten.toUpperCase()}`,
    `${input.fromDate} s/d ${input.toDate}`,
    ``,
    `TOP BROKER`,
    `Broker: ${stockbitData.bandar}`,
    `∑ Brg: ${formatNumber(stockbitData.barangBandar)} lot`,
    `Avg Harga: Rp ${formatNumber(stockbitData.rataRataBandar)}`,
    ``,
    `MARKET DATA`,
    `Harga: Rp ${formatNumber(marketData.harga)}`,
    `Offer Max: Rp ${formatNumber(marketData.offerTeratas)}`,
    `Bid Min: Rp ${formatNumber(marketData.bidTerbawah)}`,
    `Fraksi: ${formatNumber(marketData.fraksi)}`,
    `∑ Bid: ${formatNumber(marketData.totalBid / 100)}`,
    `∑ Offer: ${formatNumber(marketData.totalOffer / 100)}`,
    ``,
    `CALCULATIONS`,
    `∑ Papan: ${formatNumber(calculated.totalPapan)}`,
    `Avg Bid-Offer: ${formatNumber(calculated.rataRataBidOfer)}`,
    `a (5% avg bandar): ${formatNumber(calculated.a)}`,
    `p (Brg/Avg Bid-Offer): ${formatNumber(calculated.p)}`,
    ``,
    `Target 1: ${calculated.targetRealistis1} (${calculateGain(calculated.targetRealistis1)}%)`,
    `Target 2: ${calculated.targetMax} (${calculateGain(calculated.targetMax)}%)`,
  ];

  return lines.join('\n');
}

export default function Calculator({ selectedStock }: CalculatorProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StockAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const [keyStats, setKeyStats] = useState<KeyStatsData | null>(null);

  // Agent Story state
  const [agentStories, setAgentStories] = useState<AgentStoryResult[]>([]);
  const [storyStatus, setStoryStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'error'>('idle');
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const keyStatsRequestRef = useRef<{ emiten: string; generation: number; promise: Promise<KeyStatsData | null> } | null>(null);
  const storyGenerationRef = useRef(0);
  const storyBusyRef = useRef(false);

  // Date state lifted from InputForm
  const [fromDate, setFromDate] = useState(getDefaultDate());
  const [toDate, setToDate] = useState(getDefaultDate());

  // Reset result and error when a new stock is selected from sidebar
  useEffect(() => {
    if (selectedStock) {
      setResult(null);
      setError(null);
      setAgentStories([]);
      setStoryStatus('idle');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      // Auto-analyze with current selected dates
      // This allows clicking watchlist items to RESPECT the date range selected by user
      handleSubmit({
        emiten: selectedStock,
        fromDate,
        toDate
      });
    }
  }, [selectedStock]);

  const handleSubmit = async (data: StockInput) => {
    const generation = ++storyGenerationRef.current;
    storyBusyRef.current = false;
    keyStatsRequestRef.current = null;
    window.dispatchEvent(new CustomEvent('stockbit-fetch-start'));
    setLoading(true);
    setError(null);
    setResult(null);
    setAgentStories([]);
    setStoryStatus('idle');
    setKeyStats(null);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    try {
      const response = await fetch('/api/stock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const json = await response.json();
      if (generation !== storyGenerationRef.current) return;

      if (!json.success) {
        throw new Error(json.error || 'Failed to analyze stock');
      }

      const emiten = json.data.input.emiten.toUpperCase();
      const promise: Promise<KeyStatsData | null> = fetch(`/api/keystats?emiten=${encodeURIComponent(emiten)}`)
        .then(r => r.json()).then(stats => {
          const value = stats.success ? stats.data : null;
          if (generation === storyGenerationRef.current) setKeyStats(value);
          return value;
        }).catch(() => null);
      // Assign the exact result-owner promise before enabling Story via setResult.
      keyStatsRequestRef.current = { emiten, generation, promise };
      setResult(json.data);
      await promise;
      if (generation !== storyGenerationRef.current) return;

      // Fetch existing Agent Story if available
      try {
        const storyRes = await fetch(`/api/analyze-story?emiten=${data.emiten}`);
        const storyJson = await storyRes.json();
        if (storyJson.success && storyJson.data && Array.isArray(storyJson.data)) {
          if (generation !== storyGenerationRef.current || storyBusyRef.current) return;
          const matching = storyJson.data.filter((story: AgentStoryResult) => {
            const period = story.strategi_trading?.story_context?.brokerPeriod;
            return story.status === 'completed' && period?.fromDate === json.data.input.fromDate && period?.toDate === json.data.input.toDate;
          });
          const active = readActiveStory();
          if (active && active.emiten === emiten && active.input.fromDate === json.data.input.fromDate && active.input.toDate === json.data.input.toDate) {
            resumeStoryPolling(active);
          } else if (matching.length) {
            setAgentStories(matching);
            setStoryStatus('completed');
          }
        }
      } catch (storyErr) {
        console.error('Failed to fetch existing agent story:', storyErr);
      }
    } catch (err) {
      if (generation === storyGenerationRef.current) setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      if (generation === storyGenerationRef.current) setLoading(false);
      window.dispatchEvent(new CustomEvent('stockbit-fetch-end'));
    }
  };

  const handleDateChange = (newFrom: string, newTo: string) => {
    setFromDate(newFrom);
    setToDate(newTo);
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      storyGenerationRef.current += 1;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Handle token refresh to auto-retry failed analysis
  useEffect(() => {
    const handleTokenRefresh = () => {
      console.log('Token refreshed event received in Calculator');
      // If there's an error that looks like a token issue, retry the last analysis
      if (error && (error.toLowerCase().includes('token') || error.toLowerCase().includes('401'))) {
        const emitenToRetry = selectedStock || result?.input.emiten;
        if (emitenToRetry) {
          console.log(`Retrying analysis for ${emitenToRetry}`);
          handleSubmit({
            emiten: emitenToRetry,
            fromDate,
            toDate
          });
        }
      }
    };

    window.addEventListener('token-refreshed', handleTokenRefresh);
    return () => window.removeEventListener('token-refreshed', handleTokenRefresh);
  }, [error, selectedStock, result, fromDate, toDate]);

  const readActiveStory = (): { id: number; context: string; emiten: string; input: StockInput } | null => {
    try {
      const saved = JSON.parse(localStorage.getItem('active-story-job') || 'null');
      return saved && Number.isSafeInteger(saved.id) && typeof saved.context === 'string' && saved.input ? saved : null;
    } catch { return null; }
  };

  // Browser wait errors never mutate the durable generation state or resubmit.
  const resumeStoryPolling = (job: { id: number; context: string; emiten: string; input: StockInput }) => {
    const generation = storyGenerationRef.current;
    storyBusyRef.current = true;
    setStoryStatus('pending');
    if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
    const poll = async () => {
      if (generation !== storyGenerationRef.current) return;
      let terminal = false;
      try {
        const response = await fetch(`/api/analyze-story?id=${job.id}&context=${encodeURIComponent(job.context)}`, { cache: 'no-store' });
        const json = await response.json();
        if (generation !== storyGenerationRef.current) return;
        if (json.success && json.data?.id === job.id && json.data.thinking_level === job.context) {
          const story: AgentStoryResult = json.data;
          setAgentStories(prev => [story, ...prev.filter(s => s.id !== job.id)]);
          setStoryStatus(story.status);
          terminal = story.status === 'completed' || story.status === 'error';
          if (terminal) storyBusyRef.current = false;
        }
      } catch { /* Connection/wait error, not confirmed job failure. */ }
      finally {
        if (!terminal && generation === storyGenerationRef.current) pollIntervalRef.current = setTimeout(poll, 3000);
      }
    };
    void poll();
  };

  useEffect(() => {
    const active = readActiveStory();
    if (active && (!selectedStock || selectedStock.toUpperCase() === active.emiten)) resumeStoryPolling(active);
    // Refresh resumes GET only; never POST again automatically.
  }, []);

  // Submit durable work, then observe its exact ID; never retry on a wait timeout.
  const handleAnalyzeStory = async () => {
    if (!result || storyBusyRef.current) return;
    storyBusyRef.current = true;
    const generation = storyGenerationRef.current;
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }

    window.dispatchEvent(new CustomEvent('stockbit-fetch-start'));
    const emiten = result.input.emiten.toUpperCase();
    setStoryStatus('pending');
    setAgentStories([]);

    try {
      const matchingStats = keyStatsRequestRef.current?.emiten === emiten && keyStatsRequestRef.current.generation === generation
        ? await keyStatsRequestRef.current.promise : null;
      if (generation !== storyGenerationRef.current) return;
      // Short submission only. Independent worker owns Hermes execution.
      const response = await fetch('/api/analyze-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emiten,
          analysis: result,
          keyStats: matchingStats,
          keyStatsEmiten: emiten
        })
      });

      const data = await response.json();
      if (generation !== storyGenerationRef.current) return;
      if (!response.ok || !data.success) throw new Error(data.error || 'Gagal menganalisis story.');
      setAgentStories(prev => [data.data, ...prev.filter(s => s.id !== data.data.id)]);
      const job = { id: data.data.id, context: data.data.thinking_level, emiten, input: result.input };
      try { localStorage.setItem('active-story-job', JSON.stringify(job)); } catch { /* Storage may be disabled. */ }
      if (data.data.status === 'completed' || data.data.status === 'error') {
        setStoryStatus(data.data.status);
        storyBusyRef.current = false;
      } else resumeStoryPolling(job);

    } catch (err) {
      if (generation !== storyGenerationRef.current) return;
      storyBusyRef.current = false;
      setStoryStatus('error');
      setAgentStories(prev => [{ emiten, status: 'error', error_message: err instanceof Error ? err.message : 'Gagal menganalisis story. Hasil Cek Bandar tetap tersedia.' }, ...prev]);
    } finally {
      // Accepted jobs retain the busy guard until GET observes a terminal state.
      window.dispatchEvent(new CustomEvent('stockbit-fetch-end'));
    }
  };

  const handleCopy = async () => {
    if (!result) return;

    try {
      const formattedText = formatResultForCopy(result);
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCopyImage = async () => {
    const container = document.getElementById('compact-result-card-container');
    const cardElement = container?.querySelector('.compact-card') as HTMLElement;
    if (!cardElement) return;

    try {
      // Use html-to-image for much better quality and glassmorphism support
      const blob = await htmlToImage.toBlob(cardElement, {
        pixelRatio: 2,
        cacheBust: true,
        // Remove backdrop-filter during capture to prevent the "gray layer" effect
        // Use 'as any' to allow vendor prefixes in the style object
        style: {
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          background: 'var(--bg-secondary)',
          borderRadius: '20px',
        } as any,
        filter: (node: any) => {
          // Ignore the footer buttons and any element marked for ignore
          const exclusionClasses = ['compact-footer'];
          if (node.classList) {
            return !exclusionClasses.some(cls => node.classList.contains(cls)) && 
                   !node.hasAttribute?.('data-html2canvas-ignore');
          }
          return true;
        }
      });

      if (!blob) throw new Error('Failed to generate image blob');

      try {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2000);
      } catch (err) {
        console.error('Clipboard write failed:', err);

        // 1. Fallback for iOS Safari / Mobile: Web Share API
        // This opens the native share sheet which is often preferred on mobile
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], `${result?.input.emiten || 'stock'}-analysis.png`, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'Stock Analysis Result',
            });
            return;
          }
        }

        // 2. If all else fails
        throw err;
      }
    } catch (err) {
      console.error('Failed to generate image:', err);
      setError('Failed to copy image. Try taking a screenshot manually.');
    }
  };

  return (
    <div className="container">


      <InputForm
        onSubmit={handleSubmit}
        loading={loading}
        initialEmiten={selectedStock}
        fromDate={fromDate}
        toDate={toDate}
        onDateChange={handleDateChange}
        onCopyText={handleCopy}
        onCopyImage={handleCopyImage}
        onAnalyzeAI={() => handleAnalyzeStory()}
        copiedText={copied}
        copiedImage={copiedImage}
        storyStatus={storyStatus}
        hasResult={!!result}
      />

      {/* Fetching indicator moved to Navbar */}

      {error && (
        <div className="glass-card mt-4" style={{
          background: 'rgba(245, 87, 108, 0.1)',
          borderColor: 'var(--accent-warning)'
        }}>
          <h3>❌ Error</h3>
          <p style={{ color: 'var(--accent-warning)' }}>{error}</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: '2rem' }}>
          {result.isFromHistory && result.historyDate && (
            <div style={{
              marginBottom: '1.5rem',
              padding: '1rem',
              background: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.3)',
              borderRadius: '12px',
              color: '#ffc107',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.9rem'
            }}>
              <span style={{ fontSize: '1.2rem' }}>⚠️</span>
              <div>
                Data broker live tidak tersedia. Menampilkan data history terakhir dari tanggal
                <strong style={{ marginLeft: '4px', color: '#ffca2c' }}>
                  {new Date(result.historyDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                </strong>
              </div>
            </div>
          )}

          {/* Side-by-side Cards Container */}
          <div className="cards-row">
            {/* Left Column: Compact Result */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div id="compact-result-card-container">
                <CompactResultCard
                  result={result}
                  onCopyText={handleCopy}
                  onCopyImage={handleCopyImage}
                  copiedText={copied}
                  copiedImage={copiedImage}
                />
              </div>


            </div>

            {/* Right Column: Broker Summary */}
            {result.brokerSummary && (
              <BrokerSummaryCard
                emiten={result.input.emiten}
                dateRange={`${result.input.fromDate} — ${result.input.toDate}`}
                brokerSummary={result.brokerSummary}
                sector={result.sector}
              />
            )}

            {/* KeyStats Card */}
            {keyStats && (
              <KeyStatsCard
                emiten={result.input.emiten}
                keyStats={keyStats}
              />
            )}

            {/* Emiten History Card - Full Width */}
            <div style={{
              gridColumn: '1 / -1',
              width: '100%'
            }}>
              <EmitenHistoryCard emiten={result.input.emiten} />
            </div>

            {/* Price Graph + Broker Flow Section */}
            <div style={{
              gridColumn: '1 / -1',
              width: '100%',
              display: 'flex',
              gap: '2rem',
              flexWrap: 'wrap',
              alignItems: 'stretch'
            }}>
              <div style={{ flex: '1 1 0', minWidth: '400px' }}>
                <PriceGraph ticker={result.input.emiten} />
              </div>
              <div style={{ flex: '1 1 0', minWidth: '400px', display: 'flex' }}>
                <BrokerFlowCard emiten={result.input.emiten} />
              </div>
            </div>


          </div>
        </div>
      )}
      {(agentStories.length > 0 || storyStatus !== 'idle') && (
        <div style={{ marginTop: '1.5rem' }}>
          <AgentStoryCard stories={agentStories} status={storyStatus} />
        </div>
      )}
    </div>
  );
}
