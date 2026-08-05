export type FilterPresetId = 'safe_haven' | 'almost_safe' | 'high_momentum' | 'fresh_launches' | 'top_boosted' | 'rugcheck_only' | 'custom';

/**
 * Mutually exclusive safety tiers. Every signal lands in exactly one, so a coin
 * can never appear in both the Safe Haven and the Near Safe / Audit lists.
 *
 *  SAFE_HAVEN — contract verified clean AND market metrics strong
 *  NEAR_SAFE  — contract verified clean, market metrics moderate
 *  AUDIT_ONLY — contract verified clean, market metrics thin or failing
 *  WATCH      — contract not verifiable yet (brand new mint, no data)
 *  REJECTED   — contract failed a hard safety gate
 */
export type CoinTier = 'SAFE_HAVEN' | 'NEAR_SAFE' | 'AUDIT_ONLY' | 'WATCH' | 'REJECTED';

/** How much of the safety picture we could actually confirm. */
export type VerificationLevel = 'full' | 'onchain' | 'unverified';

export interface DexSocialLink {
  type?: string;
  label?: string;
  url: string;
}

export interface DexTokenProfile {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: DexSocialLink[];
}

export interface DexBoostedToken {
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  icon?: string;
  header?: string;
  description?: string;
  links?: DexSocialLink[];
}

export interface DexPairData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: number;
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  volume?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url: string }>;
    socials?: Array<{ type?: string; url: string }>;
  };
  boosts?: {
    active?: number;
  };
}

export interface RugCheckTopHolder {
  address: string;
  pct: number;
  owner?: string;
  insider?: boolean;
}

export interface RugCheckReport {
  mint: string;
  score: number;
  /** True when RugCheck had no data — the report carries no safety information. */
  isInferred?: boolean;
  token?: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply: number;
    decimals: number;
  };
  topHolders?: RugCheckTopHolder[];
  totalLPPercent?: number;
  totalMarketLiquidity?: number;
  markets?: Array<{
    lp?: {
      lpLockedPct?: number;
    };
  }>;
  risks?: Array<{
    name: string;
    level: string;
    description?: string;
  }>;
  fileMeta?: {
    top10Pct?: number;
    maxSingleHolderPct?: number;
    insiderPct?: number;
    insiderNetworkCount?: number;
    graphInsidersDetected?: number;
    totalHolders?: number;
    rugged?: boolean;
    holderSampleSize?: number;
    bundledSupplyPct?: number;
    sniperHoldingsPct?: number;
    devHoldingsPct?: number;
    devPriorRugRate?: number;
  };
}

/** On-chain authority facts. Helius reads these straight off the mint account. */
export interface ContractFacts {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Where the authority values came from. 'none' means nothing could be read. */
  source: 'helius' | 'rugcheck' | 'none';
}

export interface FilterConfig {
  maxScore: number;                 // Maximum RugCheck risk score allowed
  requireMintRevoked: boolean;      // Require mint authority to be null
  requireFreezeRevoked: boolean;    // Require freeze authority to be null
  minLpLockedPct: number;           // Min % of LP locked/burned
  minFdvUsd: number;                // Min FDV
  minMarketCapUsd: number;          // Min market cap
  minLiquidityUsd: number;          // Min liquidity
  minVolume5mUsd: number;           // Min 5m volume
  maxBundledSupplyPct: number;      // Max % supply bundled at creation
  maxInsiderPct: number;            // Max insider holding %
  maxSniperHoldingsPct: number;     // Max sniper holding %
  maxTop10Pct: number;              // Max top 10 holders %
  maxSingleHolderPct: number;       // Max single holder %
  maxDevHoldingsPct: number;        // Max dev wallet holding %
  minBuyPressurePct: number;        // Min buys / total txns % over 5m
  maxNegativePriceChange5mPct: number; // Max allowed drawdown % over 5m
  maxWashScore: number;             // Max wash trading churn score (0-100)
  minOverallScoreToPass: number;    // Score required for the SAFE_HAVEN tier
  onlySafeCoins: boolean;           // Zero-tolerance filter

  /** Score required for the NEAR_SAFE tier. Below this a verified coin is AUDIT_ONLY. */
  nearSafeMinScore: number;
  /** Fraction of the market floors a NEAR_SAFE coin has to clear (0-1). */
  nearSafeFloorFactor: number;
  /**
   * When true, coins past `maxPairAgeMinutes` / `maxMarketCapUsd` drop out of the
   * safe tiers. Off by default: age and size are entry-timing preferences, not
   * safety facts, and treating them as safety was demoting fully-audited coins.
   */
  earlyEntryOnly: boolean;
  /** Age bound applied only when `earlyEntryOnly` is on. */
  maxPairAgeMinutes: number;
  /** Market-cap bound applied only when `earlyEntryOnly` is on. */
  maxMarketCapUsd: number;
  /** Accept Helius on-chain authority proof when RugCheck has no data yet. */
  allowOnchainOnlyVerification: boolean;

  heliusApiKey?: string;            // Helius RPC API Key
}

export interface Gate0Result {
  passed: boolean;
  reasons: string[];
  lpBurnedOrLocked: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  /** False when neither Helius nor RugCheck could confirm the authorities. */
  contractDataAvailable: boolean;
}

export interface ScoreBreakdownItem {
  category: string;
  score: number;
  maxScore: number;
  reason: string;
}

export interface ScoreBreakdown {
  totalScore: number;
  maxPossibleScore: number;
  items: ScoreBreakdownItem[];
}

export interface FilterResult {
  gate0: Gate0Result;
  washScore: number;
  breakdown: ScoreBreakdown;
  passedAll: boolean;
  tier: CoinTier;
  verification: VerificationLevel;
  /** Hard failures only. Soft metric shortfalls live in `weaknesses`. */
  disqualifyReasons: string[];
  /** Non-fatal shortfalls that cost score but do not reject the coin. */
  weaknesses: string[];
}

export interface MemeCoinSignal {
  mint: string;
  name: string;
  symbol: string;
  logoUrl?: string;
  headerUrl?: string;
  description?: string;
  priceUsd: number;
  fdvUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume5mUsd: number;
  priceChange5mPct: number;
  priceChange1hPct: number;
  buys5m: number;
  sells5m: number;
  buyPressurePct: number;
  turnover5m: number;
  pairAgeMinutes: number;
  isBoosted: boolean;
  boostCount: number;
  score: number;                   // Unified 1-100 safety score
  washScore: number;               // 0-100 wash trading churn
  /** Raw RugCheck score, or null when RugCheck has no data on this mint. */
  rugCheckScore: number | null;
  /** Exclusive bucket. Drives which tab the coin shows up in. */
  tier: CoinTier;
  verification: VerificationLevel;
  mintRevoked: boolean;
  freezeRevoked: boolean;
  top10Pct: number | null;
  passedGate0: boolean;
  passedAllFilters: boolean;
  disqualifyReasons: string[];
  weaknesses: string[];
  socials: DexSocialLink[];
  quickLinks: {
    dexscreener: string;
    photon: string;
    raydium: string;
    pumpFun: string;
    rugcheck: string;
  };
  detectedAt: number;
  updatedAt: number;
  source: 'dexscreener_profile' | 'dexscreener_boost' | 'pumpportal_ws' | 'search';
}

export interface FinderStats {
  totalScanned: number;
  tracked: number;
  safeHavenCount: number;
  nearSafeCount: number;
  auditOnlyCount: number;
  rejectedCount: number;
  /** Kept for backwards compatibility — equals safeHavenCount + nearSafeCount. */
  passedFilters: number;
  boostedCount: number;
  avgScore: number;
  solPriceUsd: number;
  lastScanAt: number;
  /** Rolling count of enrichment calls made in the last minute, per upstream. */
  apiCallsLastMinute: number;
}
