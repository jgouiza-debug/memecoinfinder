import {
  CoinTier,
  ContractFacts,
  DexPairData,
  FilterConfig,
  FilterResult,
  Gate0Result,
  RugCheckReport,
  ScoreBreakdown,
  ScoreBreakdownItem,
  VerificationLevel,
} from '../types';

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  maxScore: 500,
  requireMintRevoked: true,
  requireFreezeRevoked: true,
  minLpLockedPct: 0,
  minFdvUsd: 1000,
  minMarketCapUsd: 1000,
  minLiquidityUsd: 1000,
  minVolume5mUsd: 1000,
  maxBundledSupplyPct: 45,
  maxInsiderPct: 30,
  maxSniperHoldingsPct: 40,
  maxTop10Pct: 55,
  maxSingleHolderPct: 25,
  maxDevHoldingsPct: 15,
  minBuyPressurePct: 45,
  maxNegativePriceChange5mPct: -45,
  maxWashScore: 55,
  minOverallScoreToPass: 62,
  onlySafeCoins: true,

  nearSafeMinScore: 45,
  nearSafeFloorFactor: 0.4,
  earlyEntryOnly: false,
  maxPairAgeMinutes: 180,
  maxMarketCapUsd: 250000,
  allowOnchainOnlyVerification: true,
};

/** RugCheck's own "good" ceiling. Anything above this is a genuine red flag. */
const RUGCHECK_GOOD_CEILING = 500;

export interface EvaluationInput {
  contract: ContractFacts;
  rugCheck: RugCheckReport | null;
  pair: DexPairData | null;
}

export class RiskFilter {
  private config: FilterConfig;

  constructor(config?: Partial<FilterConfig>) {
    this.config = { ...DEFAULT_FILTER_CONFIG, ...config };
  }

  public getConfig(): FilterConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Graded credit instead of a pass/fail cliff.
   *
   * A coin sitting at the floor scores half the points; hitting `target` scores
   * full. Below the floor it still earns proportional credit rather than zero.
   * The old binary gate meant one metric $1 short of a threshold zeroed the coin
   * out of every list, which is why almost nothing ever reached the safe zone.
   */
  private static grade(value: number, floor: number, target: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (floor <= 0) return 1;
    if (value <= floor) return Math.min(0.5, (value / floor) * 0.5);
    if (target <= floor) return 1;
    return Math.min(1, 0.5 + 0.5 * ((value - floor) / (target - floor)));
  }

  public computeWashScore(pair?: DexPairData | null): number {
    if (!pair) return 0;

    const buys = pair.txns?.m5?.buys ?? 0;
    const sells = pair.txns?.m5?.sells ?? 0;
    const totalTxns = buys + sells;
    const volume5m = pair.volume?.m5 ?? 0;
    const liquidity = pair.liquidity?.usd ?? 0;
    const priceChange5m = Math.abs(pair.priceChange?.m5 ?? 0);

    if (totalTxns === 0 || liquidity <= 0) return 0;

    const turnover = volume5m / Math.max(1, liquidity);
    let washScore = 0;

    // High churn with a flat price is the classic wash signature.
    if (turnover >= 3 && priceChange5m < 8) washScore += 45;
    else if (turnover >= 2 && priceChange5m < 5) washScore += 35;
    else if (turnover >= 1 && priceChange5m < 3) washScore += 25;

    // A suspiciously perfect buy/sell split at high turnover means bot ping-pong.
    const buyRatio = buys / totalTxns;
    if (turnover >= 1.5 && buyRatio >= 0.47 && buyRatio <= 0.53) {
      washScore += 20;
    }

    return Math.min(100, washScore);
  }

  /**
   * Hard safety gate — the only things that can outright reject a coin.
   *
   * Authority state comes from `contract`, which prefers Helius (the actual mint
   * account on chain) over RugCheck. RugCheck being unavailable is a gap in
   * *risk* data, not evidence of danger, so it no longer rejects anything.
   */
  public evaluateGate0(input: EvaluationInput): Gate0Result {
    const { contract, rugCheck } = input;
    const reasons: string[] = [];

    const contractDataAvailable = contract.source !== 'none';
    const mintAuthorityRevoked = contractDataAvailable && contract.mintAuthority === null;
    const freezeAuthorityRevoked = contractDataAvailable && contract.freezeAuthority === null;

    if (contractDataAvailable) {
      if (this.config.requireMintRevoked && !mintAuthorityRevoked) {
        reasons.push('Mint authority still active (supply can be inflated)');
      }
      if (this.config.requireFreezeRevoked && !freezeAuthorityRevoked) {
        reasons.push('Freeze authority still active (wallets can be frozen)');
      }
    }

    let lpLockedPct = rugCheck?.totalLPPercent ?? 0;
    for (const m of rugCheck?.markets ?? []) {
      if (m.lp?.lpLockedPct !== undefined) lpLockedPct = Math.max(lpLockedPct, m.lp.lpLockedPct);
    }
    const lpBurnedOrLocked = lpLockedPct >= this.config.minLpLockedPct || (rugCheck?.totalMarketLiquidity ?? 0) > 0;

    // RugCheck findings only apply when RugCheck actually has the token indexed.
    if (rugCheck && !rugCheck.isInferred) {
      const meta = rugCheck.fileMeta || {};

      if (meta.rugged) {
        reasons.push('RugCheck has flagged this token as rugged');
      }
      if (rugCheck.risks?.some((r) => r.level === 'danger')) {
        const danger = rugCheck.risks.find((r) => r.level === 'danger');
        reasons.push(`RugCheck danger flag: ${danger?.name ?? 'critical risk'}`);
      }
      if (rugCheck.score > this.config.maxScore) {
        reasons.push(`RugCheck risk score ${rugCheck.score} exceeds limit ${this.config.maxScore}`);
      }
      if (meta.top10Pct !== undefined && meta.top10Pct > this.config.maxTop10Pct) {
        reasons.push(`Top 10 holders control ${meta.top10Pct}% (max ${this.config.maxTop10Pct}%)`);
      }
      if (meta.maxSingleHolderPct !== undefined && meta.maxSingleHolderPct > this.config.maxSingleHolderPct) {
        reasons.push(`Single holder controls ${meta.maxSingleHolderPct}% (max ${this.config.maxSingleHolderPct}%)`);
      }
      if (meta.insiderPct !== undefined && meta.insiderPct > this.config.maxInsiderPct) {
        reasons.push(`Insiders control ${meta.insiderPct}% (max ${this.config.maxInsiderPct}%)`);
      }
    }

    return {
      passed: reasons.length === 0,
      reasons,
      lpBurnedOrLocked,
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
      contractDataAvailable,
    };
  }

  /** Unified 0-100 safety & quality evaluation with an exclusive tier verdict. */
  public evaluateToken(input: EvaluationInput): FilterResult {
    const { contract, rugCheck, pair } = input;
    const cfg = this.config;
    const gate0 = this.evaluateGate0(input);
    const washScore = this.computeWashScore(pair);

    const items: ScoreBreakdownItem[] = [];
    const disqualifyReasons: string[] = [...gate0.reasons];
    const weaknesses: string[] = [];

    const rugCheckIndexed = Boolean(rugCheck && !rugCheck.isInferred);
    const rugCheckScore = rugCheckIndexed ? Number(rugCheck!.score ?? 0) : null;

    // ---- 1. Contract & security (35) ----
    let contractScore = 0;
    if (gate0.mintAuthorityRevoked) contractScore += 12;
    if (gate0.freezeAuthorityRevoked) contractScore += 12;

    if (rugCheckScore !== null) {
      // Full marks for a clean RugCheck score, tapering to 0 at 3x the ceiling.
      contractScore += rugCheckScore <= RUGCHECK_GOOD_CEILING
        ? 6
        : Math.max(0, Math.round(6 * (1 - (rugCheckScore - RUGCHECK_GOOD_CEILING) / (RUGCHECK_GOOD_CEILING * 2))));
      contractScore += rugCheck!.risks?.some((r) => r.level === 'danger') ? 0 : 5;
    } else if (gate0.contractDataAvailable && cfg.allowOnchainOnlyVerification) {
      // No RugCheck data yet. On-chain authority proof is the stronger signal
      // anyway, so award partial credit instead of zeroing the whole category.
      contractScore += 5;
      weaknesses.push('RugCheck has not indexed this mint yet (on-chain verified only)');
    } else {
      weaknesses.push('Contract authorities could not be verified');
    }

    items.push({
      category: 'Contract & Security',
      score: contractScore,
      maxScore: 35,
      reason: gate0.mintAuthorityRevoked && gate0.freezeAuthorityRevoked
        ? rugCheckIndexed ? 'Mint & freeze revoked · RugCheck audited' : 'Mint & freeze revoked on-chain'
        : gate0.contractDataAvailable ? 'Authority vulnerability detected' : 'Authorities unknown',
    });

    // ---- 2. Liquidity depth (20) ----
    const liquidity = pair?.liquidity?.usd ?? 0;
    const liquidityScore = Math.round(20 * RiskFilter.grade(liquidity, cfg.minLiquidityUsd, cfg.minLiquidityUsd * 5));
    if (liquidity < cfg.minLiquidityUsd) {
      weaknesses.push(`Liquidity $${Math.round(liquidity).toLocaleString()} below $${cfg.minLiquidityUsd.toLocaleString()} floor`);
    }
    items.push({
      category: 'Liquidity Depth',
      score: liquidityScore,
      maxScore: 20,
      reason: `$${Math.round(liquidity).toLocaleString()} pooled`,
    });

    // ---- 3. Market size (15) ----
    const marketCap = pair?.marketCap ?? pair?.fdv ?? 0;
    const fdv = pair?.fdv ?? marketCap;
    const sizeScore = Math.round(
      15 * (0.6 * RiskFilter.grade(marketCap, cfg.minMarketCapUsd, cfg.minMarketCapUsd * 10)
        + 0.4 * RiskFilter.grade(fdv, cfg.minFdvUsd, cfg.minFdvUsd * 10))
    );
    if (marketCap < cfg.minMarketCapUsd) {
      weaknesses.push(`Market cap $${Math.round(marketCap).toLocaleString()} below $${cfg.minMarketCapUsd.toLocaleString()} floor`);
    }
    items.push({
      category: 'Market Size',
      score: sizeScore,
      maxScore: 15,
      reason: `MC $${Math.round(marketCap).toLocaleString()} · FDV $${Math.round(fdv).toLocaleString()}`,
    });

    // ---- 4. Demand / volume (15) ----
    const volume5m = pair?.volume?.m5 ?? 0;
    let demandScore = Math.round(13 * RiskFilter.grade(volume5m, cfg.minVolume5mUsd, cfg.minVolume5mUsd * 6));
    const turnover = liquidity > 0 ? volume5m / liquidity : 0;
    // Some turnover proves the pool is tradeable; runaway turnover is churn.
    if (turnover >= 0.15 && turnover <= 4) demandScore += 2;
    demandScore = Math.min(15, demandScore);
    if (volume5m < cfg.minVolume5mUsd) {
      weaknesses.push(`5m volume $${Math.round(volume5m).toLocaleString()} below $${cfg.minVolume5mUsd.toLocaleString()} floor`);
    }
    items.push({
      category: 'Demand & Volume',
      score: demandScore,
      maxScore: 15,
      reason: `$${Math.round(volume5m).toLocaleString()} in 5m · ${turnover.toFixed(2)}x turnover`,
    });

    // ---- 5. Microstructure (15) ----
    const buys5m = pair?.txns?.m5?.buys ?? 0;
    const sells5m = pair?.txns?.m5?.sells ?? 0;
    const totalTxns5m = buys5m + sells5m;
    const buyPressurePct = totalTxns5m > 0 ? (buys5m / totalTxns5m) * 100 : 50;
    const priceChange5m = pair?.priceChange?.m5 ?? 0;

    let microScore = Math.round(9 * RiskFilter.grade(buyPressurePct, cfg.minBuyPressurePct, 75));
    if (priceChange5m >= cfg.maxNegativePriceChange5mPct) {
      microScore += 6;
    } else {
      weaknesses.push(`5m drawdown ${priceChange5m.toFixed(1)}% steeper than ${cfg.maxNegativePriceChange5mPct}%`);
    }
    // A pool with buys and zero sells over 5 minutes behaves like a honeypot.
    if (totalTxns5m >= 25 && sells5m === 0) {
      disqualifyReasons.push('No sells recorded against 25+ buys (honeypot behaviour)');
    }
    microScore = Math.min(15, microScore);
    items.push({
      category: 'Microstructure',
      score: microScore,
      maxScore: 15,
      reason: `${buyPressurePct.toFixed(0)}% buy pressure · ${buys5m}B/${sells5m}S`,
    });

    // ---- 6. Wash guard (deduction, max 0) ----
    let washPenalty = 0;
    if (washScore > cfg.maxWashScore) {
      washPenalty = -Math.min(15, Math.round((washScore - cfg.maxWashScore) / 3));
      weaknesses.push(`Elevated wash-trading churn (${washScore}/100)`);
    }
    items.push({
      category: 'Wash Trading Guard',
      score: washPenalty,
      maxScore: 0,
      reason: washScore > cfg.maxWashScore ? `Churn score ${washScore}/100` : 'Organic volume profile',
    });

    const totalScore = Math.max(0, Math.min(100, items.reduce((acc, item) => acc + item.score, 0)));

    const breakdown: ScoreBreakdown = {
      totalScore,
      maxPossibleScore: 100,
      items,
    };

    const verification: VerificationLevel = !gate0.contractDataAvailable
      ? 'unverified'
      : rugCheckIndexed ? 'full' : 'onchain';

    const tier = this.classify({
      gate0,
      totalScore,
      verification,
      liquidity,
      marketCap,
      volume5m,
      pairAgeMinutes: pair?.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 60000 : 0,
      hasPair: Boolean(pair),
      hardFailures: disqualifyReasons.length,
    });

    return {
      gate0,
      washScore,
      breakdown,
      passedAll: tier === 'SAFE_HAVEN',
      tier,
      verification,
      disqualifyReasons,
      weaknesses,
    };
  }

  /**
   * Assigns exactly one tier. The tiers are ordered and disjoint, so the Safe
   * Haven / Near Safe / Audit tabs can never show the same mint twice.
   */
  private classify(ctx: {
    gate0: Gate0Result;
    totalScore: number;
    verification: VerificationLevel;
    liquidity: number;
    marketCap: number;
    volume5m: number;
    pairAgeMinutes: number;
    hasPair: boolean;
    hardFailures: number;
  }): CoinTier {
    const cfg = this.config;

    if (ctx.hardFailures > 0) return 'REJECTED';

    // Nothing to verify against yet: brand new mint, no Helius/RugCheck answer.
    if (ctx.verification === 'unverified') return 'WATCH';
    if (ctx.verification === 'onchain' && !cfg.allowOnchainOnlyVerification) return 'WATCH';
    if (!ctx.gate0.mintAuthorityRevoked || !ctx.gate0.freezeAuthorityRevoked) return 'REJECTED';

    // Contract is clean from here down. The remaining question is market quality.
    if (!ctx.hasPair) return 'AUDIT_ONLY';

    // Age and size only demote a coin when the user has asked for early entries.
    // A six-hour-old token with a clean audit and deep liquidity is not less safe
    // than a six-minute-old one — it is just a different trade.
    if (cfg.earlyEntryOnly) {
      const tooOld = ctx.pairAgeMinutes > cfg.maxPairAgeMinutes;
      const tooBig = ctx.marketCap > cfg.maxMarketCapUsd;
      if (tooOld || tooBig) return 'AUDIT_ONLY';
    }

    const meetsSafeFloors =
      ctx.liquidity >= cfg.minLiquidityUsd &&
      ctx.marketCap >= cfg.minMarketCapUsd &&
      ctx.volume5m >= cfg.minVolume5mUsd;

    if (ctx.totalScore >= cfg.minOverallScoreToPass && meetsSafeFloors) return 'SAFE_HAVEN';

    const f = cfg.nearSafeFloorFactor;
    const meetsNearFloors =
      ctx.liquidity >= cfg.minLiquidityUsd * f &&
      ctx.marketCap >= cfg.minMarketCapUsd * f &&
      ctx.volume5m >= cfg.minVolume5mUsd * f;

    if (ctx.totalScore >= cfg.nearSafeMinScore && meetsNearFloors) return 'NEAR_SAFE';

    return 'AUDIT_ONLY';
  }
}
