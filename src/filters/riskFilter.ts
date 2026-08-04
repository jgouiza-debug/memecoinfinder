import {
  FilterConfig,
  FilterResult,
  RugCheckReport,
  Gate0Result,
  ScoreBreakdown,
  ScoreBreakdownItem,
  DexPairData
} from '../types';

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  maxScore: 100,
  requireMintRevoked: true,
  requireFreezeRevoked: true,
  minLpLockedPct: 0,
  minMarketCapUsd: 2000,
  minLiquidityUsd: 3000,
  minVolume5mUsd: 1000,
  maxBundledSupplyPct: 35,
  maxInsiderPct: 20,
  maxSniperHoldingsPct: 30,
  maxTop10Pct: 35,
  maxSingleHolderPct: 15,
  maxDevHoldingsPct: 10,
  minBuyPressurePct: 40,
  maxNegativePriceChange5mPct: -35,
  maxWashScore: 70,
  minOverallScoreToPass: 60,
};

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
   * Evaluates wash trading churn signature.
   * Churn without price movement or artificial 50/50 buy-sell ratio at high turnover
   * indicates bot wash trading.
   */
  public computeWashScore(pair?: DexPairData): number {
    if (!pair) return 0;

    const buys = pair.txns?.m5?.buys ?? 0;
    const sells = pair.txns?.m5?.sells ?? 0;
    const totalTxns = buys + sells;
    const volume5m = pair.volume?.m5 ?? 0;
    const liquidity = pair.liquidity?.usd ?? 1;
    const priceChange5m = Math.abs(pair.priceChange?.m5 ?? 0);

    if (totalTxns === 0 || liquidity === 0) return 0;

    const turnover = volume5m / Math.max(1, liquidity);
    let washScore = 0;

    // High turnover with minimal price movement
    if (turnover >= 1 && priceChange5m < 3) washScore += 45;
    else if (turnover >= 2 && priceChange5m < 5) washScore += 30;
    else if (turnover >= 3 && priceChange5m < 8) washScore += 20;

    // Synthetic 50/50 buy/sell split at high volume
    const buyRatio = buys / totalTxns;
    if (turnover >= 1.5 && buyRatio >= 0.46 && buyRatio <= 0.54) {
      washScore += 25;
    }

    return Math.min(100, washScore);
  }

  /**
   * GATE 0: Hard safety disqualifiers.
   */
  public evaluateGate0(rugCheck: RugCheckReport): Gate0Result {
    const reasons: string[] = [];
    const isInferred = rugCheck.isInferred === true;

    const mintAuthorityRevoked = rugCheck.token?.mintAuthority === null;
    const freezeAuthorityRevoked = rugCheck.token?.freezeAuthority === null;

    let lpLockedPct = rugCheck.totalLPPercent ?? 0;
    if (rugCheck.markets) {
      for (const m of rugCheck.markets) {
        if (m.lp?.lpLockedPct !== undefined) {
          lpLockedPct = Math.max(lpLockedPct, m.lp.lpLockedPct);
        }
      }
    }

    const lpBurnedOrLocked = lpLockedPct >= this.config.minLpLockedPct || (rugCheck.totalMarketLiquidity ?? 0) > 0;

    if (this.config.requireMintRevoked && !mintAuthorityRevoked && !isInferred) {
      reasons.push("Mint Authority active (Token can be inflated)");
    }
    if (this.config.requireFreezeRevoked && !freezeAuthorityRevoked && !isInferred) {
      reasons.push("Freeze Authority active (Wallets can be blacklisted)");
    }
    if (rugCheck.score > this.config.maxScore && !isInferred) {
      reasons.push(`RugCheck risk score exceeds limit (${rugCheck.score} > ${this.config.maxScore})`);
    }

    // Concentration gates when data is available
    const meta = rugCheck.fileMeta || {};
    if (meta.top10Pct !== undefined && meta.top10Pct > this.config.maxTop10Pct) {
      reasons.push(`Top 10 holders control ${meta.top10Pct}% (Max: ${this.config.maxTop10Pct}%)`);
    }
    if (meta.maxSingleHolderPct !== undefined && meta.maxSingleHolderPct > this.config.maxSingleHolderPct) {
      reasons.push(`Single holder controls ${meta.maxSingleHolderPct}% (Max: ${this.config.maxSingleHolderPct}%)`);
    }
    if (meta.insiderPct !== undefined && meta.insiderPct > this.config.maxInsiderPct) {
      reasons.push(`Insider holdings control ${meta.insiderPct}% (Max: ${this.config.maxInsiderPct}%)`);
    }

    return {
      passed: reasons.length === 0,
      reasons,
      lpBurnedOrLocked,
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
    };
  }

  /**
   * Computes comprehensive score breakdown (0-100).
   */
  public evaluateToken(rugCheck: RugCheckReport, pair?: DexPairData): FilterResult {
    const gate0 = this.evaluateGate0(rugCheck);
    const washScore = this.computeWashScore(pair);
    const items: ScoreBreakdownItem[] = [];
    const disqualifyReasons: string[] = [...gate0.reasons];

    // 1. Contract & Security (30 pts)
    let contractScore = 0;
    if (rugCheck.token?.mintAuthority === null) contractScore += 12;
    if (rugCheck.token?.freezeAuthority === null) contractScore += 12;
    if (rugCheck.score < 500) contractScore += 6;
    items.push({
      category: "Contract & Security",
      score: contractScore,
      maxScore: 30,
      reason: contractScore >= 24 ? "Authorities revoked & clean code" : "Partial authority risk",
    });

    // 2. Liquidity & Market Cap (25 pts)
    let liquidityScore = 0;
    const marketCap = pair?.marketCap ?? pair?.fdv ?? 0;
    const liquidity = pair?.liquidity?.usd ?? 0;

    if (liquidity >= this.config.minLiquidityUsd * 2) liquidityScore += 15;
    else if (liquidity >= this.config.minLiquidityUsd) liquidityScore += 10;
    else disqualifyReasons.push(`Insufficient Liquidity ($${liquidity.toLocaleString()} < $${this.config.minLiquidityUsd.toLocaleString()})`);

    if (marketCap >= this.config.minMarketCapUsd) liquidityScore += 10;
    else disqualifyReasons.push(`Market Cap below threshold ($${marketCap.toLocaleString()} < $${this.config.minMarketCapUsd.toLocaleString()})`);

    items.push({
      category: "Liquidity & Market Cap",
      score: liquidityScore,
      maxScore: 25,
      reason: `$${liquidity.toLocaleString()} Liquidity | $${marketCap.toLocaleString()} MC`,
    });

    // 3. Trading Microstructure & Volume (25 pts)
    let microScore = 0;
    const buys5m = pair?.txns?.m5?.buys ?? 0;
    const sells5m = pair?.txns?.m5?.sells ?? 0;
    const totalTxns5m = buys5m + sells5m;
    const volume5m = pair?.volume?.m5 ?? 0;
    const buyPressurePct = totalTxns5m > 0 ? (buys5m / totalTxns5m) * 100 : 50;
    const priceChange5m = pair?.priceChange?.m5 ?? 0;

    if (volume5m >= this.config.minVolume5mUsd) microScore += 10;
    else disqualifyReasons.push(`5m Volume too low ($${volume5m.toLocaleString()} < $${this.config.minVolume5mUsd.toLocaleString()})`);

    if (buyPressurePct >= this.config.minBuyPressurePct) microScore += 10;
    else disqualifyReasons.push(`Buy pressure weak (${buyPressurePct.toFixed(1)}% < ${this.config.minBuyPressurePct}%)`);

    if (priceChange5m >= this.config.maxNegativePriceChange5mPct) microScore += 5;
    else disqualifyReasons.push(`5m Drawdown too steep (${priceChange5m.toFixed(1)}%)`);

    items.push({
      category: "Microstructure & Momentum",
      score: microScore,
      maxScore: 25,
      reason: `${buyPressurePct.toFixed(0)}% Buy Pressure | $${volume5m.toLocaleString()} 5m Vol`,
    });

    // 4. Wash-Trading & Holder Concentration (20 pts)
    let washAndHolderScore = 20;
    if (washScore > this.config.maxWashScore) {
      washAndHolderScore -= 15;
      disqualifyReasons.push(`High wash trading risk score (${washScore}/100)`);
    }

    items.push({
      category: "Wash-Trading & Holder Health",
      score: Math.max(0, washAndHolderScore),
      maxScore: 20,
      reason: washScore > 40 ? `Elevated Wash Score (${washScore}/100)` : "Clean organic volume",
    });

    const totalScore = items.reduce((acc, item) => acc + item.score, 0);
    const breakdown: ScoreBreakdown = {
      totalScore,
      maxPossibleScore: 100,
      items,
    };

    const passedAll = gate0.passed && disqualifyReasons.length === 0 && totalScore >= this.config.minOverallScoreToPass;

    return {
      gate0,
      washScore,
      breakdown,
      passedAll,
      disqualifyReasons,
    };
  }
}
