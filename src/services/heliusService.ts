import axios from 'axios';
import { SingleFlight, TokenBucket } from '../utils/async';

export const HELIUS_API_KEY = 'dfc72823-152b-468b-936e-57935ae27b08';
export const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export interface HeliusTokenAsset {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  logoUrl?: string;
  /** True when the RPC answered. A null asset means "unknown", not "unsafe". */
  verified: boolean;
}

interface CacheEntry {
  asset: HeliusTokenAsset | null;
  timestamp: number;
}

/**
 * Helius RPC — the authoritative source for mint/freeze authority.
 *
 * Authority state is read straight off the mint account, so this is stronger
 * evidence than a third-party audit index and it is available immediately for a
 * brand new token. Results are cached hard: a revoked authority is irreversible,
 * and name/symbol/decimals never change, so re-reading the same mint every 3
 * seconds was pure waste.
 */
export class HeliusService {
  private static cache = new Map<string, CacheEntry>();
  private static inflight = new SingleFlight<HeliusTokenAsset | null>();

  /** Confirmed assets barely change; misses are retried far sooner. */
  private static readonly HIT_TTL_MS = 10 * 60_000;
  private static readonly MISS_TTL_MS = 45_000;

  // Helius free tier is 10 rps; stay well inside it.
  private static bucket = new TokenBucket(300);

  private static requestTimestamps: number[] = [];

  public static requestsLastMinute(): number {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);
    return this.requestTimestamps.length;
  }

  /** Cached lookup that never re-hits the RPC for an already-resolved mint. */
  public static async getTokenAsset(mint: string): Promise<HeliusTokenAsset | null> {
    const cached = this.cache.get(mint);
    if (cached) {
      const ttl = cached.asset ? this.HIT_TTL_MS : this.MISS_TTL_MS;
      if (Date.now() - cached.timestamp < ttl) return cached.asset;
    }

    return this.inflight.run(mint, async () => {
      if (!this.bucket.tryTake()) return cached?.asset ?? null;

      const asset = (await this.fetchViaDas(mint)) ?? (await this.fetchViaAccountInfo(mint));
      this.cache.set(mint, { asset, timestamp: Date.now() });
      return asset;
    });
  }

  /** True when this mint has already been resolved and needs no further calls. */
  public static isResolved(mint: string): boolean {
    const cached = this.cache.get(mint);
    return Boolean(cached?.asset) && Date.now() - (cached?.timestamp ?? 0) < this.HIT_TTL_MS;
  }

  private static async post(body: unknown): Promise<any> {
    this.requestTimestamps.push(Date.now());
    const response = await axios.post(HELIUS_RPC_URL, body, {
      timeout: 6000,
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  }

  /** Digital Asset Standard lookup — carries metadata and authorities together. */
  private static async fetchViaDas(mint: string): Promise<HeliusTokenAsset | null> {
    try {
      const data = await this.post({
        jsonrpc: '2.0',
        id: 'asset',
        method: 'getAsset',
        params: { id: mint },
      });

      const result = data?.result;
      if (!result) return null;

      const tokenInfo = result.token_info || {};
      const content = result.content || {};

      return {
        mint,
        name: content.metadata?.name || 'Unknown Token',
        symbol: content.metadata?.symbol || 'MEME',
        decimals: tokenInfo.decimals ?? 6,
        supply: Number(tokenInfo.supply ?? 0),
        mintAuthority: tokenInfo.mint_authority ?? null,
        freezeAuthority: tokenInfo.freeze_authority ?? null,
        logoUrl: content.links?.image || content.files?.[0]?.uri,
        verified: true,
      };
    } catch {
      return null;
    }
  }

  /** Raw mint account fallback for tokens DAS has not indexed yet. */
  private static async fetchViaAccountInfo(mint: string): Promise<HeliusTokenAsset | null> {
    try {
      const data = await this.post({
        jsonrpc: '2.0',
        id: 'account',
        method: 'getAccountInfo',
        params: [mint, { encoding: 'jsonParsed' }],
      });

      const parsed = data?.result?.value?.data?.parsed?.info;
      if (!parsed) return null;

      return {
        mint,
        name: 'Unknown Token',
        symbol: 'MEME',
        decimals: parsed.decimals ?? 6,
        supply: parsed.supply ? Number(parsed.supply) : 0,
        mintAuthority: parsed.mintAuthority ?? null,
        freezeAuthority: parsed.freezeAuthority ?? null,
        verified: true,
      };
    } catch {
      return null;
    }
  }

  public static prune(keep: Set<string>): void {
    for (const mint of this.cache.keys()) {
      if (!keep.has(mint)) this.cache.delete(mint);
    }
  }
}
