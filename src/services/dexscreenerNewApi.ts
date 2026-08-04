import axios from 'axios';
import { DexTokenProfile, DexBoostedToken, DexPairData } from '../types';

export class DexScreenerNewApiService {
  private static cachePair = new Map<string, { data: DexPairData | null; timestamp: number }>();
  private static TTL_MS = 3000;

  /**
   * NEW API: GET https://api.dexscreener.com/token-profiles/latest/v1
   * Returns latest published token profiles.
   */
  public static async fetchLatestTokenProfiles(): Promise<DexTokenProfile[]> {
    try {
      const response = await axios.get<DexTokenProfile[]>(
        'https://api.dexscreener.com/token-profiles/latest/v1',
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );
      if (Array.isArray(response.data)) {
        // Filter for Solana chain tokens
        return response.data.filter((item) => item.chainId === 'solana');
      }
      return [];
    } catch (err: any) {
      console.warn('[DexScreenerNewApi] Error fetching latest profiles:', err.message);
      return [];
    }
  }

  /**
   * NEW API: GET https://api.dexscreener.com/token-boosts/top/v1
   * Returns tokens with active boosts.
   */
  public static async fetchTopBoostedTokens(): Promise<DexBoostedToken[]> {
    try {
      const response = await axios.get<DexBoostedToken[]>(
        'https://api.dexscreener.com/token-boosts/top/v1',
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );
      if (Array.isArray(response.data)) {
        return response.data.filter((item) => item.chainId === 'solana');
      }
      return [];
    } catch (err: any) {
      console.warn('[DexScreenerNewApi] Error fetching top boosted tokens:', err.message);
      return [];
    }
  }

  /**
   * NEW API: GET https://api.dexscreener.com/token-boosts/latest/v1
   * Returns latest boosted tokens.
   */
  public static async fetchLatestBoostedTokens(): Promise<DexBoostedToken[]> {
    try {
      const response = await axios.get<DexBoostedToken[]>(
        'https://api.dexscreener.com/token-boosts/latest/v1',
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );
      if (Array.isArray(response.data)) {
        return response.data.filter((item) => item.chainId === 'solana');
      }
      return [];
    } catch (err: any) {
      console.warn('[DexScreenerNewApi] Error fetching latest boosted tokens:', err.message);
      return [];
    }
  }

  /**
   * GET https://api.dexscreener.com/latest/dex/tokens/{mint}
   * Fetches pair market metrics for a specific token mint.
   */
  public static async fetchTokenMarketData(mint: string): Promise<DexPairData | null> {
    const cached = this.cachePair.get(mint);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );

      const pairs = response.data?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) {
        this.cachePair.set(mint, { data: null, timestamp: Date.now() });
        return null;
      }

      // Sort by highest liquidity USD
      pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const bestPair: DexPairData = pairs[0];

      this.cachePair.set(mint, { data: bestPair, timestamp: Date.now() });
      return bestPair;
    } catch (err: any) {
      console.warn(`[DexScreenerNewApi] Failed to fetch market data for ${mint}:`, err.message);
      return cached ? cached.data : null;
    }
  }

  /**
   * GET https://api.dexscreener.com/latest/dex/search?q={query}
   * Searches pairs by token symbol, name or mint address.
   */
  public static async searchTokens(query: string): Promise<DexPairData[]> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );

      const pairs = response.data?.pairs;
      if (Array.isArray(pairs)) {
        return pairs.filter((p: any) => p.chainId === 'solana');
      }
      return [];
    } catch (err: any) {
      console.warn(`[DexScreenerNewApi] Search query "${query}" failed:`, err.message);
      return [];
    }
  }
}
