import { DexScreenerNewApiService } from './dexscreenerNewApi';
import { RugCheckService } from './rugcheckService';
import { PumpPortalService } from './pumpPortalService';
import { RiskFilter, DEFAULT_FILTER_CONFIG } from '../filters/riskFilter';
import {
  MemeCoinSignal,
  FilterConfig,
  FilterPresetId,
  FinderStats,
  DexPairData,
  DexSocialLink
} from '../types';

export const HELIUS_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=dfc72823-152b-468b-936e-57935ae27b08';

export class FinderEngine {
  private static filter = new RiskFilter({
    heliusApiKey: 'dfc72823-152b-468b-936e-57935ae27b08',
  });
  private static scannedMints = new Set<string>();
  private static tokenStore = new Map<string, MemeCoinSignal>();
  private static activePreset: FilterPresetId = 'safe_haven';
  private static onUpdateCallbacks: Array<(signals: MemeCoinSignal[]) => void> = [];
  private static isScanning = false;

  public static initialize(): void {
    PumpPortalService.connect((event) => {
      this.processNewMint(event.mint, 'pumpportal_ws', event.name, event.symbol);
    });
  }

  public static setPreset(preset: FilterPresetId): void {
    this.activePreset = preset;
    let configPartial: Partial<FilterConfig> = {};

    switch (preset) {
      case 'safe_haven':
        configPartial = {
          minFdvUsd: 1000,
          minMarketCapUsd: 1000,
          minLiquidityUsd: 1000,
          minVolume5mUsd: 1000,
          minBuyPressurePct: 45,
          maxWashScore: 40,
          minOverallScoreToPass: 70,
          onlySafeCoins: true,
          requireMintRevoked: true,
          requireFreezeRevoked: true,
        };
        break;
      case 'high_momentum':
        configPartial = {
          minFdvUsd: 1000,
          minMarketCapUsd: 1000,
          minLiquidityUsd: 1000,
          minVolume5mUsd: 5000,
          minBuyPressurePct: 60,
          maxWashScore: 50,
          minOverallScoreToPass: 60,
          onlySafeCoins: true,
          requireMintRevoked: true,
          requireFreezeRevoked: true,
        };
        break;
      case 'fresh_launches':
        configPartial = {
          minFdvUsd: 1000,
          minMarketCapUsd: 1000,
          minLiquidityUsd: 1000,
          minVolume5mUsd: 1000,
          minBuyPressurePct: 35,
          maxWashScore: 60,
          minOverallScoreToPass: 50,
          onlySafeCoins: true,
          requireMintRevoked: true,
          requireFreezeRevoked: true,
        };
        break;
      case 'top_boosted':
        configPartial = {
          minFdvUsd: 1000,
          minMarketCapUsd: 1000,
          minLiquidityUsd: 1000,
          minVolume5mUsd: 1000,
          minBuyPressurePct: 40,
          maxWashScore: 50,
          minOverallScoreToPass: 55,
          onlySafeCoins: true,
          requireMintRevoked: true,
          requireFreezeRevoked: true,
        };
        break;
      case 'rugcheck_only':
        configPartial = {
          minFdvUsd: 0,
          minMarketCapUsd: 0,
          minLiquidityUsd: 0,
          minVolume5mUsd: 0,
          minBuyPressurePct: 0,
          maxWashScore: 100,
          minOverallScoreToPass: 0,
          onlySafeCoins: false,
          requireMintRevoked: true,
          requireFreezeRevoked: true,
        };
        break;
      case 'custom':
        return;
    }

    this.filter.updateConfig(configPartial);
    this.notifyUpdate();
  }

  public static updateConfig(config: Partial<FilterConfig>): void {
    this.filter.updateConfig(config);
    this.notifyUpdate();
  }

  public static getConfig(): FilterConfig {
    return this.filter.getConfig();
  }

  public static onUpdate(callback: (signals: MemeCoinSignal[]) => void): () => void {
    this.onUpdateCallbacks.push(callback);
    callback(this.getSignals());
    return () => {
      this.onUpdateCallbacks = this.onUpdateCallbacks.filter((c) => c !== callback);
    };
  }

  public static getSignals(): MemeCoinSignal[] {
    const all = Array.from(this.tokenStore.values());
    const config = this.filter.getConfig();

    if (this.activePreset === 'rugcheck_only') {
      // RugCheck Only Mode: Requires real RugCheck audit pass (Gate 0 passed & RugCheck score <= 500)
      return all
        .filter((s) => s.passedGate0 && s.rugCheckScore <= 500)
        .sort((a, b) => a.rugCheckScore - b.rugCheckScore || b.score - a.score || b.detectedAt - a.detectedAt);
    }

    // Safe Haven & Other Presets: Must strictly pass Gate 0, RugCheck <= 500, and market filters
    const filtered = all.filter((s) => {
      const passesRugCheckAudit = s.passedGate0 && s.rugCheckScore <= 500;
      const isEarly = s.marketCapUsd <= 60000 && s.priceChange5mPct <= 150 && s.pairAgeMinutes <= 30;

      if (config.onlySafeCoins || this.activePreset === 'safe_haven') {
        return passesRugCheckAudit && s.passedAllFilters && s.score >= config.minOverallScoreToPass && isEarly;
      }
      return passesRugCheckAudit && isEarly;
    });

    if (this.activePreset === 'top_boosted') {
      return filtered
        .filter((s) => s.isBoosted || s.boostCount > 0)
        .sort((a, b) => b.boostCount - a.boostCount || b.score - a.score);
    }

    return filtered.sort((a, b) => b.score - a.score || b.marketCapUsd - a.marketCapUsd);
  }

  public static getStats(): FinderStats {
    const all = Array.from(this.tokenStore.values());
    const passed = all.filter((s) => s.passedGate0 && s.rugCheckScore <= 500);
    const boosted = all.filter((s) => s.isBoosted || s.boostCount > 0);
    const avgScore = all.length > 0 ? all.reduce((acc, s) => acc + s.score, 0) / all.length : 0;

    return {
      totalScanned: this.scannedMints.size,
      passedFilters: passed.length,
      boostedCount: boosted.length,
      avgScore: Math.round(avgScore),
      solPriceUsd: 165,
    };
  }

  public static async triggerScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const profiles = await DexScreenerNewApiService.fetchLatestTokenProfiles();
      for (const p of profiles) {
        if (p.tokenAddress) {
          await this.processNewMint(p.tokenAddress, 'dexscreener_profile', undefined, undefined, p.links, p.icon, p.header, p.description);
        }
      }

      const boosted = await DexScreenerNewApiService.fetchTopBoostedTokens();
      for (const b of boosted) {
        if (b.tokenAddress) {
          await this.processNewMint(b.tokenAddress, 'dexscreener_boost', undefined, undefined, b.links, b.icon, b.header, b.description, b.totalAmount || b.amount);
        }
      }
    } finally {
      this.isScanning = false;
      this.notifyUpdate();
    }
  }

  public static async searchAndEnrich(query: string): Promise<MemeCoinSignal[]> {
    const pairs = await DexScreenerNewApiService.searchTokens(query);
    const results: MemeCoinSignal[] = [];

    for (const pair of pairs.slice(0, 10)) {
      const mint = pair.baseToken.address;
      const signal = await this.processPairToSignal(mint, pair, 'search');
      if (signal) {
        results.push(signal);
      }
    }
    return results;
  }

  private static async processNewMint(
    mint: string,
    source: MemeCoinSignal['source'],
    fallbackName?: string,
    fallbackSymbol?: string,
    socials?: DexSocialLink[],
    logoUrl?: string,
    headerUrl?: string,
    description?: string,
    boostCount?: number
  ): Promise<void> {
    this.scannedMints.add(mint);

    const pair = await DexScreenerNewApiService.fetchTokenMarketData(mint);
    const signal = await this.processPairToSignal(
      mint,
      pair,
      source,
      fallbackName,
      fallbackSymbol,
      socials,
      logoUrl,
      headerUrl,
      description,
      boostCount
    );

    if (signal) {
      this.tokenStore.set(mint, signal);
      this.notifyUpdate();
    }
  }

  private static async processPairToSignal(
    mint: string,
    pair: DexPairData | null,
    source: MemeCoinSignal['source'],
    fallbackName?: string,
    fallbackSymbol?: string,
    extraSocials?: DexSocialLink[],
    logoUrl?: string,
    headerUrl?: string,
    description?: string,
    boostCount?: number
  ): Promise<MemeCoinSignal | null> {
    const rugCheck = await RugCheckService.getReport(mint);
    const evaluation = this.filter.evaluateToken(rugCheck, pair || undefined);

    const buys5m = pair?.txns?.m5?.buys ?? 0;
    const sells5m = pair?.txns?.m5?.sells ?? 0;
    const totalTxns5m = buys5m + sells5m;
    const buyPressurePct = totalTxns5m > 0 ? Math.round((buys5m / totalTxns5m) * 100) : 50;

    const volume5mUsd = pair?.volume?.m5 ?? 0;
    const liquidityUsd = pair?.liquidity?.usd ?? 0;
    const turnover5m = liquidityUsd > 0 ? Number((volume5mUsd / liquidityUsd).toFixed(2)) : 0;
    const marketCapUsd = pair?.marketCap ?? pair?.fdv ?? 0;
    const fdvUsd = pair?.fdv ?? marketCapUsd;

    const createdAt = pair?.pairCreatedAt ? pair.pairCreatedAt : Date.now();
    const pairAgeMinutes = Math.max(0, Math.round((Date.now() - createdAt) / 60000));

    const socials: DexSocialLink[] = [...(extraSocials || [])];
    if (pair?.info?.websites) {
      for (const w of pair.info.websites) {
        if (!socials.some((s) => s.url === w.url)) {
          socials.push({ type: 'website', label: w.label || 'Website', url: w.url });
        }
      }
    }
    if (pair?.info?.socials) {
      for (const s of pair.info.socials) {
        if (!socials.some((x) => x.url === s.url)) {
          socials.push({ type: s.type || 'social', label: s.type || 'Social', url: s.url });
        }
      }
    }

    const isBoosted = Boolean((pair?.boosts?.active ?? 0) > 0 || (boostCount ?? 0) > 0);

    // Exact RugCheck risk score feed:
    // If indexed on RugCheck, rugCheck.score is the real score (0-1000).
    // If inferred/unindexed, set to 9999 so it fails score checks.
    const rawRugCheckScore = rugCheck.isInferred ? 9999 : Number(rugCheck.score ?? 0);

    const signal: MemeCoinSignal = {
      mint,
      name: pair?.baseToken?.name || fallbackName || 'Unknown Meme',
      symbol: pair?.baseToken?.symbol || fallbackSymbol || 'MEME',
      logoUrl: pair?.info?.imageUrl || logoUrl,
      headerUrl,
      description,
      priceUsd: pair?.priceUsd ?? 0,
      fdvUsd,
      marketCapUsd,
      liquidityUsd,
      volume5mUsd,
      priceChange5mPct: pair?.priceChange?.m5 ?? 0,
      priceChange1hPct: pair?.priceChange?.h1 ?? 0,
      buys5m,
      sells5m,
      buyPressurePct,
      turnover5m,
      pairAgeMinutes,
      isBoosted,
      boostCount: boostCount || pair?.boosts?.active || 0,
      score: evaluation.breakdown.totalScore,
      washScore: evaluation.washScore,
      rugCheckScore: rawRugCheckScore,
      passedGate0: evaluation.gate0.passed,
      passedAllFilters: evaluation.passedAll,
      disqualifyReasons: evaluation.disqualifyReasons,
      socials,
      quickLinks: {
        dexscreener: pair?.url || `https://dexscreener.com/solana/${mint}`,
        photon: `https://photon-sol.tinyastro.io/en/lp/${mint}`,
        raydium: `https://raydium.io/swap/?inputMint=sol&outputMint=${mint}`,
        pumpFun: `https://pump.fun/${mint}`,
        rugcheck: `https://rugcheck.xyz/tokens/${mint}`,
      },
      detectedAt: Date.now(),
      source,
    };

    return signal;
  }

  private static notifyUpdate(): void {
    const signals = this.getSignals();
    for (const callback of this.onUpdateCallbacks) {
      callback(signals);
    }
  }
}
