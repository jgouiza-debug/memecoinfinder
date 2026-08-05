import axios from 'axios';
import { DexTokenProfile, DexBoostedToken, DexPairData } from '../types';
import { SingleFlight, TokenBucket, chunk } from '../utils/async';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface PairCacheEntry {
  data: DexPairData | null;
  timestamp: number;
}

/**
 * DexScreener client.
 *
 * Two things matter here for throughput:
 *  1. The token endpoint accepts up to 30 comma-separated mints, so tracking N
 *     tokens costs ceil(N/30) requests per refresh instead of N.
 *  2. Discovery endpoints (profiles/boosts) are capped at 60 req/min upstream,
 *     token lookups at 300 req/min. Separate buckets keep one from starving the
 *     other, and a stale cache entry is served rather than going dark on a 429.
 */
export class DexScreenerNewApiService {
  private static pairCache = new Map<string, PairCacheEntry>();
  private static inflight = new SingleFlight<DexPairData | null>();

  /** Market data goes stale fast on a meme pair, but not faster than this. */
  private static TTL_MS = 3000;

  private static readonly BATCH_SIZE = 30;

  // Upstream documented ceilings, with headroom.
  private static tokenBucket = new TokenBucket(240);
  private static discoveryBucket = new TokenBucket(45);

  private static requestTimestamps: number[] = [];

  private static solPriceUsd = 0;
  private static solPriceAt = 0;

  private static noteRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    if (this.requestTimestamps.length > 400) {
      this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);
    }
  }

  /** Requests actually sent upstream in the last minute — surfaced in the UI. */
  public static requestsLastMinute(): number {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);
    return this.requestTimestamps.length;
  }

  public static setCacheTtl(ms: number): void {
    this.TTL_MS = Math.max(1500, ms);
  }

  /** GET /token-profiles/latest/v1 — newly published Solana token profiles. */
  public static async fetchLatestTokenProfiles(): Promise<DexTokenProfile[]> {
    if (!this.discoveryBucket.tryTake()) return [];
    try {
      this.noteRequest();
      const response = await axios.get<DexTokenProfile[]>(
        'https://api.dexscreener.com/token-profiles/latest/v1',
        { timeout: 6000, headers: { Accept: 'application/json' } }
      );
      return Array.isArray(response.data) ? response.data.filter((i) => i.chainId === 'solana') : [];
    } catch {
      return [];
    }
  }

  /** GET /token-boosts/top/v1 — tokens with the most active boosts. */
  public static async fetchTopBoostedTokens(): Promise<DexBoostedToken[]> {
    if (!this.discoveryBucket.tryTake()) return [];
    try {
      this.noteRequest();
      const response = await axios.get<DexBoostedToken[]>(
        'https://api.dexscreener.com/token-boosts/top/v1',
        { timeout: 6000, headers: { Accept: 'application/json' } }
      );
      return Array.isArray(response.data) ? response.data.filter((i) => i.chainId === 'solana') : [];
    } catch {
      return [];
    }
  }

  /** GET /token-boosts/latest/v1 — most recently boosted tokens. */
  public static async fetchLatestBoostedTokens(): Promise<DexBoostedToken[]> {
    if (!this.discoveryBucket.tryTake()) return [];
    try {
      this.noteRequest();
      const response = await axios.get<DexBoostedToken[]>(
        'https://api.dexscreener.com/token-boosts/latest/v1',
        { timeout: 6000, headers: { Accept: 'application/json' } }
      );
      return Array.isArray(response.data) ? response.data.filter((i) => i.chainId === 'solana') : [];
    } catch {
      return [];
    }
  }

  /** Cached single-mint lookup. Prefer `fetchManyTokenMarketData` for lists. */
  public static async fetchTokenMarketData(mint: string): Promise<DexPairData | null> {
    const cached = this.pairCache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) return cached.data;

    return this.inflight.run(mint, async () => {
      if (!this.tokenBucket.tryTake()) return cached?.data ?? null;
      const grouped = await this.requestBatch([mint]);
      const data = grouped.get(mint) ?? null;
      this.pairCache.set(mint, { data, timestamp: Date.now() });
      return data;
    });
  }

  /**
   * Batched market data for many mints. Cache hits are served locally and only
   * the misses are chunked into 30-mint requests.
   */
  public static async fetchManyTokenMarketData(mints: string[]): Promise<Map<string, DexPairData | null>> {
    const out = new Map<string, DexPairData | null>();
    const now = Date.now();
    const misses: string[] = [];

    for (const mint of new Set(mints)) {
      const cached = this.pairCache.get(mint);
      if (cached && now - cached.timestamp < this.TTL_MS) out.set(mint, cached.data);
      else misses.push(mint);
    }

    const batches = chunk(misses, this.BATCH_SIZE);

    // Batches are independent HTTP calls; run them together rather than in
    // series so a refresh costs one round-trip, not one per chunk.
    const responses = await Promise.all(
      batches.map(async (batch) => {
        if (!this.tokenBucket.tryTake()) return null;
        return this.requestBatch(batch);
      })
    );

    responses.forEach((grouped, i) => {
      const batch = batches[i];
      if (!grouped) {
        // Rate limited: serve whatever we last knew rather than reporting zeros.
        for (const mint of batch) out.set(mint, this.pairCache.get(mint)?.data ?? null);
        return;
      }
      const stamp = Date.now();
      for (const mint of batch) {
        const data = grouped.get(mint) ?? null;
        this.pairCache.set(mint, { data, timestamp: stamp });
        out.set(mint, data);
      }
    });

    return out;
  }

  private static async requestBatch(mints: string[]): Promise<Map<string, DexPairData>> {
    const grouped = new Map<string, DexPairData>();

    try {
      this.noteRequest();
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`,
        { timeout: 8000, headers: { Accept: 'application/json' } }
      );

      const pairs = response.data?.pairs;
      if (!Array.isArray(pairs)) return grouped;

      // The batch response is one flat pair list spanning every requested mint,
      // so bucket by base token before picking each mint's deepest pool.
      const byMint = new Map<string, any[]>();
      for (const pair of pairs) {
        if (pair?.chainId && pair.chainId !== 'solana') continue;
        const base = pair?.baseToken?.address;
        if (!base) continue;
        const bucket = byMint.get(base);
        if (bucket) bucket.push(pair);
        else byMint.set(base, [pair]);
      }

      for (const [mint, tokenPairs] of byMint) {
        // Deepest liquidity wins — that is the pool a trade would route through.
        tokenPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        grouped.set(mint, tokenPairs[0] as DexPairData);
      }
    } catch {
      // Quiet by design: this runs on a loop and callers fall back to cache.
    }

    return grouped;
  }

  /** GET /latest/dex/search — symbol, name or mint lookup. */
  public static async searchTokens(query: string): Promise<DexPairData[]> {
    if (!this.tokenBucket.tryTake()) return [];
    try {
      this.noteRequest();
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
        { timeout: 6000, headers: { Accept: 'application/json' } }
      );
      const pairs = response.data?.pairs;
      return Array.isArray(pairs) ? pairs.filter((p: any) => p.chainId === 'solana') : [];
    } catch {
      return [];
    }
  }

  /** Live SOL price, refreshed at most once a minute. Was hardcoded to 165. */
  public static async getSolPriceUsd(): Promise<number> {
    if (this.solPriceUsd > 0 && Date.now() - this.solPriceAt < 60_000) return this.solPriceUsd;
    if (!this.tokenBucket.tryTake()) return this.solPriceUsd || 165;

    const grouped = await this.requestBatch([WSOL_MINT]);
    const price = Number(grouped.get(WSOL_MINT)?.priceUsd ?? 0);
    if (price > 0) {
      this.solPriceUsd = price;
      this.solPriceAt = Date.now();
    }
    return this.solPriceUsd || 165;
  }

  /** Drops cache entries for mints the engine no longer tracks. */
  public static prune(keep: Set<string>): void {
    for (const mint of this.pairCache.keys()) {
      if (!keep.has(mint)) this.pairCache.delete(mint);
    }
  }
}
