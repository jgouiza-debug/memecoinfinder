import { DexScreenerNewApiService } from './dexscreenerNewApi';
import { RugCheckService } from './rugcheckService';
import { PumpPortalService } from './pumpPortalService';
import { HeliusService, HeliusTokenAsset, HELIUS_API_KEY, HELIUS_RPC_URL } from './heliusService';
import { RiskFilter, DEFAULT_FILTER_CONFIG } from '../filters/riskFilter';
import { mapWithConcurrency } from '../utils/async';
import {
  ContractFacts,
  CoinTier,
  DexPairData,
  DexSocialLink,
  FilterConfig,
  FilterPresetId,
  FinderStats,
  MemeCoinSignal,
  RugCheckReport,
} from '../types';

export { HELIUS_API_KEY, HELIUS_RPC_URL, DEFAULT_FILTER_CONFIG };

interface DiscoveryMeta {
  name?: string;
  symbol?: string;
  socials?: DexSocialLink[];
  logoUrl?: string;
  headerUrl?: string;
  description?: string;
  boostCount?: number;
}

/** Everything known about one mint, plus when each upstream last answered. */
interface TokenRecord {
  mint: string;
  source: MemeCoinSignal['source'];
  firstSeenAt: number;
  meta: DiscoveryMeta;

  pair: DexPairData | null;
  pairAt: number;

  helius: HeliusTokenAsset | null;
  heliusAt: number;

  rugCheck: RugCheckReport | null;
  rugCheckAt: number;

  signal: MemeCoinSignal | null;
  dirty: boolean;
}

/** How long a record survives without being re-seen or re-priced. */
const RECORD_TTL_MS = 30 * 60_000;
/** Hard cap on tracked mints — bounds every per-tick loop and the API budget. */
const MAX_TRACKED = 220;
/** Mints whose market data we refresh on each tick, highest interest first. */
const MARKET_REFRESH_LIMIT = 120;
/** Contract lookups started per tick. Keeps the burst inside every rate limit. */
const ENRICH_PER_TICK = 14;
const ENRICH_CONCURRENCY = 6;

const TICK_MS = 3000;
const DISCOVERY_INTERVAL_MS = 12_000;
const PRUNE_INTERVAL_MS = 60_000;

/** 5m volume a verified coin needs to show up under the Momentum view. */
const MOMENTUM_MIN_VOLUME_USD = 5000;
/** Age ceiling for the Fresh view. */
const FRESH_MAX_AGE_MINUTES = 60;

const TIER_RANK: Record<CoinTier, number> = {
  SAFE_HAVEN: 0,
  NEAR_SAFE: 1,
  AUDIT_ONLY: 2,
  WATCH: 3,
  REJECTED: 4,
};

/**
 * Scanning pipeline.
 *
 * The previous version awaited three HTTP calls per token, one token at a time,
 * for every discovered profile, every 3 seconds — roughly 180 serial requests
 * per scan. It never finished a sweep before the next one started, it tripped
 * every provider's rate limit, and each individual token completion triggered a
 * full re-filter, re-sort and React re-render of the whole list.
 *
 * This version separates the three concerns:
 *   discovery  — cheap list endpoints, every 12s, registers mints only
 *   pricing    — one batched request per 30 tracked mints, every tick
 *   enrichment — bounded-concurrency contract lookups for stale records only
 * and coalesces all of it into a single notification per tick.
 */
export class FinderEngine {
  private static filter = new RiskFilter({ heliusApiKey: HELIUS_API_KEY });
  private static store = new Map<string, TokenRecord>();
  private static scannedMints = new Set<string>();

  private static activePreset: FilterPresetId = 'safe_haven';
  private static listeners: Array<(signals: MemeCoinSignal[]) => void> = [];

  private static tickTimer: ReturnType<typeof setInterval> | null = null;
  private static isTicking = false;
  private static isDiscovering = false;
  private static lastDiscoveryAt = 0;
  private static lastPruneAt = 0;
  private static lastScanAt = 0;
  private static solPriceUsd = 165;

  private static signalCache: MemeCoinSignal[] | null = null;
  private static statsCache: FinderStats | null = null;
  private static notifyQueued = false;

  // ---------------------------------------------------------------- lifecycle

  public static initialize(): void {
    if (this.tickTimer) return;

    PumpPortalService.connect((event) => {
      // Register only. The tick loop decides when to spend API budget on it.
      this.register(event.mint, 'pumpportal_ws', { name: event.name, symbol: event.symbol });
    });

    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  public static shutdown(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    PumpPortalService.disconnect();
  }

  // ------------------------------------------------------------------ config

  /**
   * Presets are pure views — they never move the thresholds.
   *
   * When each preset re-tuned the filter config, the same mint could be Safe
   * Haven under one tab's numbers and Audit Only under another's, so the tab
   * counts disagreed with what you actually saw after clicking. Tiering now runs
   * once against a single config (the sliders), and a preset only decides which
   * tiers are shown and in what order.
   */
  public static setPreset(preset: FilterPresetId): void {
    this.activePreset = preset;
    this.notify();
  }

  public static getPreset(): FilterPresetId {
    return this.activePreset;
  }

  public static updateConfig(config: Partial<FilterConfig>): void {
    this.filter.updateConfig(config);
    this.invalidateAll();
    this.notify();
  }

  public static getConfig(): FilterConfig {
    return this.filter.getConfig();
  }

  // --------------------------------------------------------------- listeners

  public static onUpdate(callback: (signals: MemeCoinSignal[]) => void): () => void {
    this.listeners.push(callback);
    callback(this.getSignals());
    return () => {
      this.listeners = this.listeners.filter((c) => c !== callback);
    };
  }

  /** Coalesces bursts of changes into one render per frame. */
  private static notify(): void {
    if (this.notifyQueued) return;
    this.notifyQueued = true;

    const flush = () => {
      this.notifyQueued = false;
      const signals = this.getSignals();
      for (const listener of this.listeners) listener(signals);
    };

    if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else setTimeout(flush, 0);
  }

  private static invalidateAll(): void {
    for (const record of this.store.values()) record.dirty = true;
    this.signalCache = null;
    this.statsCache = null;
  }

  // ------------------------------------------------------------------ output

  /** All evaluated signals in tier order, regardless of the active preset. */
  public static getAllSignals(): MemeCoinSignal[] {
    if (this.signalCache) return this.signalCache;

    const out: MemeCoinSignal[] = [];
    for (const record of this.store.values()) {
      if (record.dirty || !record.signal) this.rebuild(record);
      if (record.signal) out.push(record.signal);
    }

    out.sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        b.score - a.score ||
        b.liquidityUsd - a.liquidityUsd
    );

    this.signalCache = out;
    return out;
  }

  /**
   * Signals for the active preset.
   *
   * The three safety tabs map onto disjoint tiers, so a coin shown under Safe
   * Haven can no longer also appear under Near Safe or Passed RugCheck. The
   * remaining presets are explicitly cross-cutting *views* (momentum, freshness,
   * boosts) and every card carries its tier badge so the distinction is visible.
   */
  public static getSignals(): MemeCoinSignal[] {
    const all = this.getAllSignals();

    switch (this.activePreset) {
      case 'safe_haven':
        return all.filter((s) => s.tier === 'SAFE_HAVEN');

      case 'almost_safe':
        return all.filter((s) => s.tier === 'NEAR_SAFE');

      case 'rugcheck_only':
        return all
          .filter((s) => s.tier === 'AUDIT_ONLY')
          .sort((a, b) => (a.rugCheckScore ?? 9999) - (b.rugCheckScore ?? 9999) || b.score - a.score);

      case 'high_momentum':
        return all
          .filter(
            (s) =>
              (s.tier === 'SAFE_HAVEN' || s.tier === 'NEAR_SAFE') &&
              s.volume5mUsd >= MOMENTUM_MIN_VOLUME_USD
          )
          .sort((a, b) => b.volume5mUsd - a.volume5mUsd || b.score - a.score);

      case 'fresh_launches':
        return all
          .filter((s) => s.tier !== 'REJECTED' && s.pairAgeMinutes <= FRESH_MAX_AGE_MINUTES)
          .sort((a, b) => b.detectedAt - a.detectedAt);

      case 'top_boosted':
        return all
          .filter((s) => s.tier !== 'REJECTED' && (s.isBoosted || s.boostCount > 0))
          .sort((a, b) => b.boostCount - a.boostCount || b.score - a.score);

      case 'custom':
      default:
        return all.filter((s) => s.tier !== 'REJECTED');
    }
  }

  public static getStats(): FinderStats {
    if (this.statsCache) return this.statsCache;

    const all = this.getAllSignals();
    let safeHaven = 0, nearSafe = 0, auditOnly = 0, rejected = 0, boosted = 0, scoreSum = 0;

    for (const s of all) {
      switch (s.tier) {
        case 'SAFE_HAVEN': safeHaven++; break;
        case 'NEAR_SAFE': nearSafe++; break;
        case 'AUDIT_ONLY': auditOnly++; break;
        case 'REJECTED': rejected++; break;
      }
      if (s.isBoosted || s.boostCount > 0) boosted++;
      scoreSum += s.score;
    }

    this.statsCache = {
      totalScanned: this.scannedMints.size,
      tracked: this.store.size,
      safeHavenCount: safeHaven,
      nearSafeCount: nearSafe,
      auditOnlyCount: auditOnly,
      rejectedCount: rejected,
      passedFilters: safeHaven + nearSafe,
      boostedCount: boosted,
      avgScore: all.length ? Math.round(scoreSum / all.length) : 0,
      solPriceUsd: this.solPriceUsd,
      lastScanAt: this.lastScanAt,
      apiCallsLastMinute:
        DexScreenerNewApiService.requestsLastMinute() +
        HeliusService.requestsLastMinute() +
        RugCheckService.requestsLastMinute(),
    };
    return this.statsCache;
  }

  // ----------------------------------------------------------------- scanning

  /** Manual "Scan Now": forces a discovery sweep on the next tick. */
  public static async triggerScan(): Promise<void> {
    this.lastDiscoveryAt = 0;
    await this.tick();
  }

  private static async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const now = Date.now();

      if (now - this.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
        this.lastDiscoveryAt = now;
        await this.discover();
      }

      await this.refreshMarketData();
      await this.enrichContracts();

      if (now - this.lastPruneAt >= PRUNE_INTERVAL_MS) {
        this.lastPruneAt = now;
        this.prune();
        this.solPriceUsd = await DexScreenerNewApiService.getSolPriceUsd();
      }

      this.lastScanAt = Date.now();
      this.signalCache = null;
      this.statsCache = null;
      this.notify();
    } finally {
      this.isTicking = false;
    }
  }

  /** Cheap list endpoints. Registers mints without spending per-token budget. */
  private static async discover(): Promise<void> {
    if (this.isDiscovering) return;
    this.isDiscovering = true;

    try {
      const [profiles, boosted] = await Promise.all([
        DexScreenerNewApiService.fetchLatestTokenProfiles(),
        DexScreenerNewApiService.fetchTopBoostedTokens(),
      ]);

      for (const p of profiles) {
        if (!p.tokenAddress) continue;
        this.register(p.tokenAddress, 'dexscreener_profile', {
          socials: p.links,
          logoUrl: p.icon,
          headerUrl: p.header,
          description: p.description,
        });
      }

      for (const b of boosted) {
        if (!b.tokenAddress) continue;
        this.register(b.tokenAddress, 'dexscreener_boost', {
          socials: b.links,
          logoUrl: b.icon,
          headerUrl: b.header,
          description: b.description,
          boostCount: b.totalAmount || b.amount,
        });
      }
    } finally {
      this.isDiscovering = false;
    }
  }

  /**
   * One batched DexScreener request per 30 tracked mints. Priority goes to
   * tokens already in a safe tier and to the newest arrivals — a coin we hold an
   * opinion on is worth more than the tail of the store.
   */
  private static async refreshMarketData(): Promise<void> {
    if (this.store.size === 0) return;

    const candidates = Array.from(this.store.values()).sort((a, b) => {
      const rank = TIER_RANK[a.signal?.tier ?? 'WATCH'] - TIER_RANK[b.signal?.tier ?? 'WATCH'];
      if (rank !== 0) return rank;
      return b.firstSeenAt - a.firstSeenAt;
    });

    const targets = candidates.slice(0, MARKET_REFRESH_LIMIT);
    const quotes = await DexScreenerNewApiService.fetchManyTokenMarketData(targets.map((r) => r.mint));

    const stamp = Date.now();
    for (const record of targets) {
      const pair = quotes.get(record.mint);
      if (pair === undefined) continue;
      record.pair = pair;
      record.pairAt = stamp;
      record.dirty = true;
    }
  }

  /**
   * Contract verification for records that still need it, newest first and
   * capped per tick. Helius and RugCheck run in parallel per token, and a mint
   * whose data is already fresh is skipped entirely.
   */
  private static async enrichContracts(): Promise<void> {
    const pending = Array.from(this.store.values())
      .filter((r) => !HeliusService.isResolved(r.mint) || !RugCheckService.isFresh(r.mint))
      .sort((a, b) => {
        // Never-verified records first; then most recently discovered.
        const aNew = a.heliusAt === 0 ? 0 : 1;
        const bNew = b.heliusAt === 0 ? 0 : 1;
        return aNew - bNew || b.firstSeenAt - a.firstSeenAt;
      })
      .slice(0, ENRICH_PER_TICK);

    if (pending.length === 0) return;

    await mapWithConcurrency(pending, ENRICH_CONCURRENCY, async (record) => {
      const [helius, rugCheck] = await Promise.all([
        HeliusService.getTokenAsset(record.mint),
        RugCheckService.getReport(record.mint),
      ]);

      const stamp = Date.now();
      if (helius) {
        record.helius = helius;
        record.heliusAt = stamp;
      } else {
        record.heliusAt = stamp;
      }
      if (rugCheck) {
        record.rugCheck = rugCheck;
        record.rugCheckAt = stamp;
      } else {
        record.rugCheckAt = stamp;
      }
      record.dirty = true;
      return true;
    });
  }

  /** Bounds memory and per-tick work: drops stale records and their caches. */
  private static prune(): void {
    const now = Date.now();

    for (const [mint, record] of this.store) {
      const lastTouch = Math.max(record.firstSeenAt, record.pairAt, record.heliusAt);
      if (now - lastTouch > RECORD_TTL_MS) this.store.delete(mint);
    }

    if (this.store.size > MAX_TRACKED) {
      // Keep the most interesting: better tier first, then most recent.
      const ordered = Array.from(this.store.values()).sort(
        (a, b) =>
          TIER_RANK[a.signal?.tier ?? 'WATCH'] - TIER_RANK[b.signal?.tier ?? 'WATCH'] ||
          b.firstSeenAt - a.firstSeenAt
      );
      for (const record of ordered.slice(MAX_TRACKED)) this.store.delete(record.mint);
    }

    const keep = new Set(this.store.keys());
    DexScreenerNewApiService.prune(keep);
    HeliusService.prune(keep);
    RugCheckService.prune(keep);

    // The scanned-mint counter is a lifetime tally; cap it so it cannot grow
    // without bound over a long session.
    if (this.scannedMints.size > 50_000) this.scannedMints.clear();
  }

  // ------------------------------------------------------------------ search

  public static async searchAndEnrich(query: string): Promise<MemeCoinSignal[]> {
    const pairs = await DexScreenerNewApiService.searchTokens(query);
    const top = pairs.slice(0, 8);

    const records = top.map((pair) => {
      const record = this.register(pair.baseToken.address, 'search', {});
      record.pair = pair;
      record.pairAt = Date.now();
      record.dirty = true;
      return record;
    });

    await mapWithConcurrency(records, ENRICH_CONCURRENCY, async (record) => {
      const [helius, rugCheck] = await Promise.all([
        HeliusService.getTokenAsset(record.mint),
        RugCheckService.getReport(record.mint),
      ]);
      const stamp = Date.now();
      record.helius = helius ?? record.helius;
      record.heliusAt = stamp;
      record.rugCheck = rugCheck ?? record.rugCheck;
      record.rugCheckAt = stamp;
      record.dirty = true;
      return true;
    });

    this.signalCache = null;
    this.statsCache = null;
    this.notify();

    return records.map((r) => (this.rebuild(r), r.signal)).filter((s): s is MemeCoinSignal => s !== null);
  }

  // --------------------------------------------------------------- internals

  private static register(mint: string, source: MemeCoinSignal['source'], meta: DiscoveryMeta): TokenRecord {
    this.scannedMints.add(mint);

    const existing = this.store.get(mint);
    if (existing) {
      // Merge new discovery metadata without discarding what we already have.
      existing.meta = {
        name: meta.name ?? existing.meta.name,
        symbol: meta.symbol ?? existing.meta.symbol,
        socials: meta.socials?.length ? meta.socials : existing.meta.socials,
        logoUrl: meta.logoUrl ?? existing.meta.logoUrl,
        headerUrl: meta.headerUrl ?? existing.meta.headerUrl,
        description: meta.description ?? existing.meta.description,
        boostCount: Math.max(meta.boostCount ?? 0, existing.meta.boostCount ?? 0) || undefined,
      };
      return existing;
    }

    const record: TokenRecord = {
      mint,
      source,
      firstSeenAt: Date.now(),
      meta,
      pair: null,
      pairAt: 0,
      helius: null,
      heliusAt: 0,
      rugCheck: null,
      rugCheckAt: 0,
      signal: null,
      dirty: true,
    };

    this.store.set(mint, record);
    this.signalCache = null;
    return record;
  }

  /** Authority facts, preferring the on-chain read over the audit index. */
  private static contractFacts(record: TokenRecord): ContractFacts {
    if (record.helius?.verified) {
      return {
        mintAuthority: record.helius.mintAuthority,
        freezeAuthority: record.helius.freezeAuthority,
        source: 'helius',
      };
    }
    if (record.rugCheck && !record.rugCheck.isInferred && record.rugCheck.token) {
      return {
        mintAuthority: record.rugCheck.token.mintAuthority,
        freezeAuthority: record.rugCheck.token.freezeAuthority,
        source: 'rugcheck',
      };
    }
    return { mintAuthority: null, freezeAuthority: null, source: 'none' };
  }

  /** Recomputes one record's signal from its cached upstream data. No I/O. */
  private static rebuild(record: TokenRecord): void {
    const { pair, meta } = record;
    const contract = this.contractFacts(record);
    const evaluation = this.filter.evaluateToken({ contract, rugCheck: record.rugCheck, pair });

    const buys5m = pair?.txns?.m5?.buys ?? 0;
    const sells5m = pair?.txns?.m5?.sells ?? 0;
    const totalTxns5m = buys5m + sells5m;
    const buyPressurePct = totalTxns5m > 0 ? Math.round((buys5m / totalTxns5m) * 100) : 50;

    const volume5mUsd = pair?.volume?.m5 ?? 0;
    const liquidityUsd = pair?.liquidity?.usd ?? 0;
    const marketCapUsd = pair?.marketCap ?? pair?.fdv ?? 0;

    const socials: DexSocialLink[] = [];
    const seenUrls = new Set<string>();
    const pushSocial = (link: DexSocialLink) => {
      if (!link.url || seenUrls.has(link.url)) return;
      seenUrls.add(link.url);
      socials.push(link);
    };
    for (const s of meta.socials ?? []) pushSocial(s);
    for (const w of pair?.info?.websites ?? []) pushSocial({ type: 'website', label: w.label || 'Website', url: w.url });
    for (const s of pair?.info?.socials ?? []) pushSocial({ type: s.type || 'social', label: s.type || 'Social', url: s.url });

    const boostCount = meta.boostCount ?? pair?.boosts?.active ?? 0;
    const rugIndexed = RugCheckService.isIndexed(record.rugCheck);

    record.signal = {
      mint: record.mint,
      name: pair?.baseToken?.name || record.helius?.name || meta.name || 'Unknown Meme',
      symbol: pair?.baseToken?.symbol || record.helius?.symbol || meta.symbol || 'MEME',
      logoUrl: pair?.info?.imageUrl || record.helius?.logoUrl || meta.logoUrl,
      headerUrl: meta.headerUrl,
      description: meta.description,
      priceUsd: Number(pair?.priceUsd ?? 0),
      fdvUsd: pair?.fdv ?? marketCapUsd,
      marketCapUsd,
      liquidityUsd,
      volume5mUsd,
      priceChange5mPct: pair?.priceChange?.m5 ?? 0,
      priceChange1hPct: pair?.priceChange?.h1 ?? 0,
      buys5m,
      sells5m,
      buyPressurePct,
      turnover5m: liquidityUsd > 0 ? Number((volume5mUsd / liquidityUsd).toFixed(2)) : 0,
      pairAgeMinutes: pair?.pairCreatedAt ? Math.max(0, Math.round((Date.now() - pair.pairCreatedAt) / 60000)) : 0,
      isBoosted: boostCount > 0,
      boostCount,
      score: evaluation.breakdown.totalScore,
      washScore: evaluation.washScore,
      rugCheckScore: rugIndexed ? Number(record.rugCheck!.score ?? 0) : null,
      tier: evaluation.tier,
      verification: evaluation.verification,
      mintRevoked: evaluation.gate0.mintAuthorityRevoked,
      freezeRevoked: evaluation.gate0.freezeAuthorityRevoked,
      top10Pct: record.rugCheck?.fileMeta?.top10Pct ?? null,
      passedGate0: evaluation.gate0.passed,
      passedAllFilters: evaluation.passedAll,
      disqualifyReasons: evaluation.disqualifyReasons,
      weaknesses: evaluation.weaknesses,
      socials,
      quickLinks: {
        dexscreener: pair?.url || `https://dexscreener.com/solana/${record.mint}`,
        photon: `https://photon-sol.tinyastro.io/en/lp/${record.mint}`,
        raydium: `https://raydium.io/swap/?inputMint=sol&outputMint=${record.mint}`,
        pumpFun: `https://pump.fun/${record.mint}`,
        rugcheck: `https://rugcheck.xyz/tokens/${record.mint}`,
      },
      detectedAt: record.firstSeenAt,
      updatedAt: Date.now(),
      source: record.source,
    };

    record.dirty = false;
  }
}
