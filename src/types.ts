export type FilterPresetId = 'safe_haven' | 'high_momentum' | 'fresh_launches' | 'top_boosted' | 'custom';

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

export interface FilterConfig {
  maxScore: number;                 // Maximum RugCheck risk score allowed
  requireMintRevoked: boolean;      // Require mint authority to be null
  requireFreezeRevoked: boolean;    // Require freeze authority to be null
  minLpLockedPct: number;           // Min % of LP locked/burned
  minMarketCapUsd: number;          // Min market cap ($)
  minLiquidityUsd: number;          // Min liquidity ($)
  minVolume5mUsd: number;           // Min 5m volume ($)
  maxBundledSupplyPct: number;      // Max % supply bundled at creation
  maxInsiderPct: number;            // Max insider holding %
  maxSniperHoldingsPct: number;     // Max sniper holding %
  maxTop10Pct: number;              // Max top 10 holders %
  maxSingleHolderPct: number;       // Max single holder %
  maxDevHoldingsPct: number;        // Max dev wallet holding %
  minBuyPressurePct: number;        // Min buys / total txns % over 5m
  maxNegativePriceChange5mPct: number; // Max allowed drawdown % over 5m (e.g. -35%)
  maxWashScore: number;             // Max wash trading churn score (0-100)
  minOverallScoreToPass: number;    // Overall safety score required (0-100)
}

export interface Gate0Result {
  passed: boolean;
  reasons: string[];
  lpBurnedOrLocked: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
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
  disqualifyReasons: string[];
}

export interface MemeCoinSignal {
  mint: string;
  name: string;
  symbol: string;
  logoUrl?: string;
  headerUrl?: string;
  description?: string;
  priceUsd: number;
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
  score: number;                   // Unified 0-100 safety score
  washScore: number;               // 0-100 wash trading churn
  rugCheckScore: number;           // Raw RugCheck score
  passedGate0: boolean;
  passedAllFilters: boolean;
  disqualifyReasons: string[];
  socials: DexSocialLink[];
  quickLinks: {
    dexscreener: string;
    photon: string;
    raydium: string;
    pumpFun: string;
    rugcheck: string;
  };
  detectedAt: number;
  source: 'dexscreener_profile' | 'dexscreener_boost' | 'pumpportal_ws' | 'search';
}

export interface FinderStats {
  totalScanned: number;
  passedFilters: number;
  boostedCount: number;
  avgScore: number;
  solPriceUsd: number;
}
