import axios from 'axios';
import { RugCheckReport, RugCheckTopHolder } from '../types';
import { SingleFlight, TokenBucket } from '../utils/async';

/**
 * Addresses that hold supply on behalf of a pool rather than a person. Without
 * excluding these, the bonding curve itself shows up as a ~90% holder and every
 * pump.fun token fails the concentration gate.
 */
const POOL_OWNERS = new Set<string>([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',  // Pump.fun AMM
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM v4
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j',  // Raydium Authority
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Orca Whirlpools
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',  // Orca
]);

interface CacheEntry {
  report: RugCheckReport | null;
  timestamp: number;
  /** Consecutive misses, used to back off on mints RugCheck has never indexed. */
  misses: number;
}

/**
 * RugCheck client.
 *
 * Two behavioural changes matter more than the caching:
 *
 *  1. `getReport` returns **null** when RugCheck has no data, instead of a
 *     synthetic report scored 9999. That fake score was being compared against
 *     `<= 500` in every view, so any token RugCheck had not indexed yet — which
 *     on a fresh launch is most of them — was silently dropped from the safe
 *     list. Absence of an audit is now treated as missing information and the
 *     on-chain Helius check carries the safety verdict.
 *
 *  2. Requests are rate-limited, deduplicated and negatively cached with
 *     exponential backoff, so an unindexed mint is not re-requested every scan.
 */
export class RugCheckService {
  private static cache = new Map<string, CacheEntry>();
  private static inflight = new SingleFlight<RugCheckReport | null>();

  private static readonly HIT_TTL_MS = 60_000;
  private static readonly MISS_BASE_TTL_MS = 30_000;
  private static readonly MISS_MAX_TTL_MS = 10 * 60_000;

  // RugCheck is the tightest upstream; keep well under its ceiling.
  private static bucket = new TokenBucket(120);

  private static requestTimestamps: number[] = [];

  public static requestsLastMinute(): number {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < 60_000);
    return this.requestTimestamps.length;
  }

  private static missTtl(misses: number): number {
    return Math.min(this.MISS_MAX_TTL_MS, this.MISS_BASE_TTL_MS * Math.pow(2, Math.max(0, misses - 1)));
  }

  /** Returns the audit report, or null when RugCheck has nothing on this mint. */
  public static async getReport(mint: string): Promise<RugCheckReport | null> {
    const cached = this.cache.get(mint);
    if (cached) {
      const ttl = cached.report ? this.HIT_TTL_MS : this.missTtl(cached.misses);
      if (Date.now() - cached.timestamp < ttl) return cached.report;
    }

    return this.inflight.run(mint, async () => {
      // Out of budget: keep serving the last known answer rather than inventing one.
      if (!this.bucket.tryTake()) return cached?.report ?? null;

      try {
        this.requestTimestamps.push(Date.now());
        const response = await axios.get<RugCheckReport>(
          `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
          { timeout: 7000, headers: { Accept: 'application/json' } }
        );

        const normalized = this.normalizeReport(response.data, mint);
        this.cache.set(mint, { report: normalized, timestamp: Date.now(), misses: 0 });
        return normalized;
      } catch {
        const misses = (cached?.misses ?? 0) + 1;
        // Keep a previously good report alive rather than dropping to unknown on
        // one transient 429.
        const report = cached?.report ?? null;
        this.cache.set(mint, { report, timestamp: Date.now(), misses });
        return report;
      }
    });
  }

  /** True when the report reflects a real, indexed RugCheck audit. */
  public static isIndexed(report: RugCheckReport | null): report is RugCheckReport {
    return Boolean(report && !report.isInferred);
  }

  /**
   * Full audit pass: indexed, both authorities revoked, low risk score and no
   * danger-level findings.
   */
  public static isVerifiedSafe(report: RugCheckReport | null): boolean {
    if (!this.isIndexed(report)) return false;
    const mintRevoked = report.token?.mintAuthority === null;
    const freezeRevoked = report.token?.freezeAuthority === null;
    const lowRisk = (report.score ?? 9999) <= 500;
    const hasDanger = Array.isArray(report.risks) && report.risks.some((r) => r.level === 'danger');
    return mintRevoked && freezeRevoked && lowRisk && !hasDanger;
  }

  /** True when a fresh call would be wasted — cached answer is still valid. */
  public static isFresh(mint: string): boolean {
    const cached = this.cache.get(mint);
    if (!cached) return false;
    const ttl = cached.report ? this.HIT_TTL_MS : this.missTtl(cached.misses);
    return Date.now() - cached.timestamp < ttl;
  }

  private static normalizeReport(report: RugCheckReport, mint: string): RugCheckReport {
    const holders: RugCheckTopHolder[] = Array.isArray(report.topHolders) ? report.topHolders : [];

    // Strip pool-owned balances; they are liquidity, not holder concentration.
    const realHolders = holders.filter((h) => {
      const owner = h.owner || h.address || '';
      return !POOL_OWNERS.has(owner) && !POOL_OWNERS.has(h.address);
    });

    const sorted = [...realHolders].sort((a, b) => (b.pct || 0) - (a.pct || 0));
    let top10Pct = 0;
    for (let i = 0; i < Math.min(10, sorted.length); i++) top10Pct += sorted[i].pct || 0;

    let insiderPct = 0;
    for (const h of realHolders) if (h.insider) insiderPct += h.pct || 0;

    const anyReport = report as any;

    return {
      ...report,
      mint: report.mint || mint,
      isInferred: false,
      fileMeta: {
        ...(report.fileMeta || {}),
        top10Pct: Number(top10Pct.toFixed(2)),
        maxSingleHolderPct: Number((sorted[0]?.pct ?? 0).toFixed(2)),
        insiderPct: Number(insiderPct.toFixed(2)),
        totalHolders: Number(anyReport.totalHolders || 0),
        rugged: Boolean(anyReport.rugged),
        holderSampleSize: realHolders.length,
      },
    };
  }

  public static prune(keep: Set<string>): void {
    for (const mint of this.cache.keys()) {
      if (!keep.has(mint)) this.cache.delete(mint);
    }
  }
}
