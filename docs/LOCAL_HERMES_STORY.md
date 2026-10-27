# poe-nya-Bandar — local background Story, fundamentals & harmonic PRZ

## Scope

Local-only experiment. Repository/folder remains `adimology-study`; visible app name is `poe-nya-Bandar`; calculation button remains **Cek Bandar**. No public deployment. Database RLS/grants remain unchanged and need a later security phase. Supabase test target is `royqcffrfkbdzmftfpey` only.

## Running this installation

Three local processes are required:

1. Hermes API backend, using Hermes-managed provider authentication:

   ```bash
   python C:/Users/Kapiten/adimology-study/hermes-local-smoke.py
   ```

   Installation-specific experimental launcher injects an API-only gateway config in memory and binds `127.0.0.1:8642`. Main Hermes config is not edited; bearer key is outside the repository. Do not start a duplicate listener.

2. From `C:/Users/Kapiten/Projects/adimology-study`, in a separate terminal:

   ```bash
   npm run story:worker
   ```

   Single worker claims jobs from `.local/story-jobs/`. The directory is ignored by Git; files contain allowlisted market inputs, not credentials. Worker lock and heartbeat prevent a second active worker. If worker is absent, Story submission returns a useful error rather than pretending it started.

3. From the same repository, in another terminal:

   ```bash
   npm run dev -- --hostname 127.0.0.1
   ```

   Open `http://127.0.0.1:3000`, unlock personally, run **Cek Bandar**, then **Analyze Story**.

Server settings live in ignored `.env.local`: `HERMES_API_BASE_URL`, `HERMES_API_KEY`, `HERMES_MODEL`, `HERMES_PROVIDER`, optional `HERMES_STORY_TIMEOUT_MS`. Never expose the key with `NEXT_PUBLIC_`, paste credentials into Story, or commit `.env.local`.

## Jobs, delays and refresh

- Submission validates data, obtains bounded historical OHLC, stores a pending database row and a durable local job, then returns HTTP 202 with its ID. It does not wait for model generation.
- Worker marks processing, requests structured output, validates it, and saves completed/error state. Browser polls the exact job ID/context. Refresh may resume monitoring; it does not require a new generation.
- At two minutes the UI warns that work is still running. Default worker generation wait is three minutes; total queue time and input retrieval are separate.
- The three-minute limit is a wait timeout, not proof that Hermes cancelled its upstream request. Interrupted/uncertain outcomes are not automatically replayed.
- Completed identical contexts are reused; context includes data, deterministic harmonic analysis, model/provider, and version. Old v1/v2 results remain history, not evidence that newer input was analyzed.
- Local file locks are only for this one-machine/shared-directory deployment, not a multi-host distributed queue. Do not horizontally scale this experiment.
- Stopping/restarting a worker reconciles interrupted running jobs without silently reissuing requests. Pending durable jobs can be consumed on restart.
- Model or storage errors preserve the Cek Bandar calculation. Read the exact error before any manual retry.

## Orphan-pending fail-closed reconciliation

This local repair uses reconciliation, **not an outbox or a transaction across Supabase and the filesystem**. Exact-ID GET polling (even with an offline worker) and repeat submissions reconcile a supported v4–v7 pending row with no queued/running file to a persisted Indonesian `error`. They never create a replacement row, enqueue a replacement, or call Hermes. Untouched orphan rows are not scanned at startup; they are reconciled when polled/reused.

Submission, claim (queued → running), worker DB transitions/completion + file removal, and interrupted-job recovery share the same context filesystem lock. Polling's initial read only locates that lock; it rereads the exact ID after acquisition, so a stale pending snapshot cannot overwrite a completed row. The lock is not held while Hermes generates. A queued or running file remains valid evidence during the pending → processing transition.

Crash windows:
- Before DB insertion: no accepted row/job; no Hermes request.
- DB insertion commits but enqueue is never reached (including a lost DB response): next exact-ID poll or repeat submission marks the row error, without replay. No input recovery is promised in this window.
- Enqueue succeeds but HTTP response is lost: the queued/running job remains legitimate and the same context is reused.
- Claim succeeds but processing/request is interrupted: the running file remains; existing startup recovery marks pending/processing error without replay.
- Hermes may have received the request or completion persistence fails: retain the running file and stop the worker on persistence failure; recovery never regenerates. A processing row with no file is left uncertain, not retried automatically.
- Completion persisted but running-file removal is interrupted: startup recovery preserves the completed row and removes the stale running file.
- Reconciliation DB write or local filesystem access fails: fail the request rather than claim success or enqueue; a later successful reconciliation can persist the error.

Assumptions/limits: one machine, one shared queue directory, one worker, and all local Story writers use these locks. This does not protect against an independent external DB writer or the old Netlify background function acting on the same rows. No exactly-once guarantee, power-loss/fsync guarantee, distributed transaction, schema/RLS change, or comprehensive security review is claimed. Existing incomplete lock files remain fail-closed/busy and require operator inspection; do not remove locks belonging to a live process.

Isolated verification for this repair: `node --import tsx --test tests/*.test.mts` passed **151/151**; `npx tsc --noEmit --incremental false` passed. Ten new orphan/race tests use an in-memory DB and temporary real queue directories; no live DB, provider requests, or process restarts were used. The pre-existing auth failure-path test emits its expected simulated save-error diagnostic while passing.

## Input coverage and limitations

- Only allowlisted market/calculation/key-stat/broker-summary data is forwarded, not arbitrary client fields or credentials.
- Fundamentals carry a matching emiten label. Missing KeyStats can be fetched for that emiten; another stock's cached values must not be silently substituted.
- Formula metadata documents the existing calculator, including rounding. It does not validate the strategy's predictive accuracy.
- Orderbook display normalization follows current application behavior: raw bid/offer divided by 100. Upstream's field name `lot` is not independent proof of its unit semantics; this is explicitly labeled.
- Historical broker period, live/cache/fallback orderbook, and current fundamental snapshot are distinct. Do not call them a single verified historical snapshot.
- No news research in this phase. Empty external citations are intentional. Outputs are scenarios, not independently verified investment recommendations.
- `tools: []`, `tool_choice: none`, and no-tools prompts express intended request behavior, not an OS/tool sandbox. Harden the dedicated agent separately before multi-user/public use.
- Provider quotas and terms still apply. Hermes connectivity is not unlimited/free API entitlement.

## Section 5: fundamental signal + separate harmonic technical evidence

Fundamentals and harmonic analysis are shown separately. Harmonic facts are computed from actual daily OHLC by code, not invented by the model. Authoritative harmonic output is attached to existing `strategi_trading` JSONB as `harmonic_analysis`, avoiding a schema/RLS migration.

Initial detector supports **only a conservative Gartley subset, bullish and bearish**. `no_pattern` means no match to these configured rules, not that every harmonic family has been excluded. Bat/Butterfly/Crab and intraday patterns are not implemented.

- Read-only Stockbit historical summary; at most four pages of 50 bars, 200 daily bars, a 364-calendar-day range. A 370-day request returned HTTP 400 in live testing; 364 days worked. Candles after requested `asOf` are never used.
- Minimum 30 valid bars. Strict extrema use two bars left and right; ties/outside bars are not forced into pivots. Latest two bars cannot be confirmed pivots.
- Chronological alternating confirmed XABC produces a projected zone; XABCD is required for full confirmation. Adjacent same-kind extrema are compressed.
- Watch stages distinguish `projected` (XABC only), `prz_touched` (OHLC wick/range intersects PRZ, D still provisional), `confirmed` (valid XABCD with two-bar right confirmation), `invalidated` (X/C/PRZ constraints broken), and `expired` (stale or movement already consumed). A target already reached is not described as price invalidation.
- Projections contain XABC, not an invented D or success probability. Tentative targets are provided only for confirmed complete candidates. Invalidated/expired setups must not be displayed as active trading zones.
- OHLC does not establish intrabar event order. If a bar breaches invalidation and also touches PRZ, invalidation takes precedence rather than claiming a successful reaction.
- AB/XA 0.618 ±0.030, BC/AB 0.382–0.886, CD/BC 1.272–1.618, AD/XA 0.786 ±0.020, CD/AB 0.95–1.05.
- PRZ is the intersection of XA, BC and AB=CD projection ranges; D must lie within it. Invalidation is at X; old/already-invalidated or target-achieved candidates are excluded.
- Tentative retracement targets are derived from the A–D leg, not success probabilities. PRZ/targets are theoretical levels, not tick-rounded order instructions or guaranteed stop fills.
- Data insufficient/unavailable or no qualifying pattern: no invented PRZ/target. Corporate actions/unadjusted OHLC and pivot parameter choice can materially change results. This detector has not been backtested.

Method references (implementation tolerances are explicit policy, not certification):
- https://harmonictrader.com/harmonic-patterns/gartley-pattern/
- https://harmonictrader.com/harmonicpatternorigin/

## Saved OHLC chart and D projection

Section 5 now includes a local SVG candlestick chart with saved daily OHLC (up to 200 bars). The snapshot is persisted with the authoritative harmonic analysis in the existing JSONB field; there is no additional chart service or schema migration. Raw candles are removed from the model request to avoid token overhead. Context version `v5` separates chart-capable results from earlier Story versions.

- Solid X–A–B–C lines link to actual candle dates and prices.
- A projected C→D* leg is dashed. D* is only a representative midpoint of the projected PRZ range, not an exact price forecast. Its right-side horizontal position is undated illustrative space, NOT a predicted date or number of sessions.
- A wick touch uses D provisional on its actual observation date; confirmation requires the detector's two-right-bar condition. Confirmed XABCD is a solid observed overlay.
- PRZ is a shaded price band, with a separate invalidation line. Ended setups are muted historical overlays and do not show active targets or a future D*.
- No qualifying candidate: display the actual candlesticks without fabricated pivot overlays. Legacy Stories missing saved candles show a clear unavailable message rather than fetching unrelated live data.
- Hover or keyboard-focus a candle for OHLC details. On small screens, scroll horizontally inside the chart.
- The chart is a snapshot as of the selected analysis, not a streaming live chart. Historical data can be unadjusted for corporate actions.

Isolated visual QA scripts outside the repository render real BBCA data and explicitly labeled synthetic projection fixtures, verify dark/light/mobile layouts, and exercise React hover/focus/scroll events without attaching to the user's browser profile:

```bash
node --import tsx C:/Users/Kapiten/adimology-study/chart-visual-check.mts
node --import tsx C:/Users/Kapiten/adimology-study/chart-interaction-check.mts
```

## Second chart: weekly multi-year Gartley + Bat

A separate weekly chart augments, rather than replaces, the existing daily Gartley detector. No daily ratios, 200-bar bounds, or daily chart semantics are loosened.

**Data:** request seven calendar years of Stockbit DAILY history in sequential <=364-calendar-day windows, with at most 50 rows per page and 48 requests total. Short pages exhaust a window, not the full seven-year scan. Total provider wait is bounded at 45 seconds (one request <=8 seconds); failure/budget exhaustion returns unavailable rather than claiming partial history is a complete scan. Exact ticker/asOf successful snapshots are atomically cached under ignored `.local/weekly-history/` for 24 hours. This is an application policy, NOT a documented Stockbit quota. Adjustment/corporate-action policy is unverified.

**Aggregation:** sorted unique daily rows, open first/high max/low min/close last, Monday–Friday weeks. Week date is the last actual trading date, not a fabricated Friday. A Monday–Thursday asOf excludes its unfinished week; Friday date-only asOf assumes end-of-day. This is a calendar rule, not an exchange holiday/calendar feed or proof that a live Friday session has closed. Historical source completeness cannot be guaranteed beyond the data returned by the provider. Maximum 520 completed weekly candles.

**Major/multi-scale swings:** strict extrema with 2, 4, or 8 weeks on BOTH sides, same-kind compression, chronological consecutive XABC/XABCD per scale. Larger scales can ignore minor intervening moves without arbitrarily skipping pivots at their own scale. Identical pattern structures are deduplicated and retain detecting scales; at most eight results. Larger scale means longer confirmation delay, not higher statistical confidence.

**Patterns:** Gartley retains exactly the daily implementation's ratio bands. Bat is an explicitly conservative SUBSET: AB/XA 0.382–0.50; BC/AB 0.382–0.886; AD/XA 0.886 ±0.020; CD/BC 1.618–2.618; extended CD/AB 1.27 ±5%. Three-way PRZ overlap is mandatory; no generic relaxed Gartley, universal Bat coverage, probability, or guarantee of screenshot replication. References distinguish preferred Bat B levels from the broader B<0.618 condition; this implementation deliberately supports a narrower band.

**Lifecycle:** projected / wick-touched provisional / confirmed / invalidated / expired; 20-week age policy after C, C extension, far-side PRZ breach, consumed first target, and subsequent confirmed swing retire setups as applicable. Bat hard invalidation is A − direction×1.13XA (0.13XA beyond X), while the strict PRZ far boundary can invalidate earlier. Historical retired overlays are muted and not active buy signals. D* is an undated midpoint illustration, not an exact price or arrival-time prediction. No synthetic examples are persisted as actual market analysis.

**Persistence:** server-owned `weeklyHarmonicAnalysis` is preserved under `strategi_trading.weekly_harmonic_analysis` in the existing JSONB schema. Story context `v6` separates old results; raw daily and weekly candles are excluded from model context. Older results without weekly data show an explicit latest-analysis notice.

**References:**
- https://harmonictrader.com/harmonic-patterns/bat-pattern/
- https://harmonictrader.com/harmonicpatternorigin/
- https://harmonictrader.com/harmonic-patterns/gartley-pattern/

## Optional causal ZigZag experiment (Story v7)

The original daily and weekly detectors remain unchanged. A collapsed experimental panel follows the weekly chart and reuses the exact completed weekly OHLC snapshot—no extra market fetch or Python detector service. It supports versioned conservative Gartley/Bat/ABCD/Butterfly policies, causal lookback periods 8/13/21/34/55, immutable confirmed pivots with separate confirmation/availability dates, and an explicitly repaintable provisional terminal.

Server-authoritative results persist in `strategi_trading.experimental_harmonic_analysis`. Client-supplied experimental data is ignored; model requests receive an allowlisted summary without candles and cannot overwrite the saved technical result. Story contexts now use v7; v4/v5/v6 queue entries remain readable. ABCD uses true ABC/ABCD without an invented X; D* remains an undated illustration, not a timing forecast. This is an engineering experiment, not a validated trading strategy.

See `HARMONIC_EXPERIMENT.md` for policies, replay/browser evidence and limitations; `THIRD_PARTY_HARMONIC_NOTICES.md` retains upstream MIT attribution.

## Verification

```bash
node --import tsx --test tests/*.test.mts
npx tsc --noEmit
npm run build
git diff --check
```

Stop the dev server before production build to avoid concurrent `.next` artifact writes, then restart on loopback.

Real installation-specific integration check (writes calculation/Story only to TEST project):

```bash
node --env-file=.env.local --import tsx C:/Users/Kapiten/adimology-study/story-background-live-check.mts
```

This calls real route handlers (not a browser authentication test), submits real BBCA calculation/KeyStats to the durable worker, polls status, reads the completed DB row, and verifies reuse. Evidence is saved outside the repository as `story-background-live-result.json`. Raw harmonic-only evidence is `C:/Users/Kapiten/adimology-study/harmonic-bbca-live.json`.

Latest weekly verification: 88/88 automated tests, TypeScript and production build passed. Real BBCA history returned 1,685 daily candles (2019-10-28–2026-10-26), aggregated to 362 completed weeks ending 2026-10-23; the current week was excluded. No active qualifying weekly setup; the detected old Gartley was invalidated and rendered as historical only. A v6 Story completed with both authoritative snapshots (200 daily / 362 weekly candles), read back from the test database and rendered independently. Isolated headless Chrome QA checked real OHLC hover/focus, explicit synthetic Bat projection fixtures, pattern/scale selector, dark/light layouts and mobile horizontal scrolling. QA artifacts/scripts are `weekly-chart-visual-check.mts`, `weekly-chart-interaction-check.mts`, and `harmonic-weekly-qa*.png` under `C:/Users/Kapiten/adimology-study/`.
