import axios from 'axios';
import { RugCheckReport, RugCheckTopHolder } from '../types';

const POOL_OWNERS = new Set<string>([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',  // Pump.fun AMM
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM v4
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j',  // Raydium Authority
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca Whirlpools
]);

export class RugCheckService {
  private static cache = new Map<string, { report: RugCheckReport; timestamp: number }>();
  private static TTL_MS = 10000;

  public static async getReport(mint: string): Promise<RugCheckReport> {
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.timestamp < this.TTL_MS) {
      return cached.report;
    }

    try {
      const response = await axios.get<RugCheckReport>(
        `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
        {
          timeout: 6000,
          headers: { Accept: 'application/json' }
        }
      );

      const normalized = this.normalizeReport(response.data, mint);
      this.cache.set(mint, { report: normalized, timestamp: Date.now() });
      return normalized;
    } catch (err: any) {
      const inferred = this.buildInferredReport(mint);
      return inferred;
    }
  }

  private static normalizeReport(report: RugCheckReport, mint: string): RugCheckReport {
    const holders: RugCheckTopHolder[] = Array.isArray(report.topHolders) ? report.topHolders : [];

    const realHolders = holders.filter((h) => {
      const owner = h.owner || h.address || '';
      return !POOL_OWNERS.has(owner) && !POOL_OWNERS.has(h.address);
    });

    const sorted = [...realHolders].sort((a, b) => (b.pct || 0) - (a.pct || 0));
    const top10Pct = sorted.slice(0, 10).reduce((acc, h) => acc + (h.pct || 0), 0);
    const maxSingleHolderPct = sorted.length > 0 ? (sorted[0].pct || 0) : 0;
    const insiderPct = realHolders
      .filter((h) => h.insider)
      .reduce((acc, h) => acc + (h.pct || 0), 0);

    return {
      ...report,
      mint: report.mint || mint,
      isInferred: false,
      fileMeta: {
        ...(report.fileMeta || {}),
        top10Pct: Number(top10Pct.toFixed(2)),
        maxSingleHolderPct: Number(maxSingleHolderPct.toFixed(2)),
        insiderPct: Number(insiderPct.toFixed(2)),
        holderSampleSize: realHolders.length,
      },
    };
  }

  private static buildInferredReport(mint: string): RugCheckReport {
    return {
      mint,
      score: 0,
      isInferred: true,
      token: {
        mintAuthority: null,
        freezeAuthority: null,
        supply: 1000000000,
        decimals: 6,
      },
      fileMeta: {
        top10Pct: 20,
        maxSingleHolderPct: 5,
        insiderPct: 0,
        holderSampleSize: 0,
      },
    };
  }
}
