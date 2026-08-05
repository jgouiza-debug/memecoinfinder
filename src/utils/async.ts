/**
 * Small async primitives shared by every upstream client.
 *
 * The finder previously fired one DexScreener + one Helius + one RugCheck call
 * per token, sequentially, for ~60 tokens, every 3 seconds. That is both slow
 * (sum of all latencies) and self-defeating: it blows through every provider's
 * rate limit, which is what turned most reports into "no data" and emptied the
 * safe list. These helpers cap concurrency and request rate at the source.
 */

/** Continuously-refilling token bucket. `capacity` requests per `perMs`. */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly capacity: number, private readonly perMs = 60_000) {
    this.tokens = capacity;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / this.perMs) * this.capacity);
    this.lastRefill = now;
  }

  /** Non-blocking: takes a token if one is available. */
  public tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Blocks until a token frees up. Never overruns the configured rate. */
  public async take(): Promise<void> {
    while (!this.tryTake()) {
      this.refill();
      const deficit = 1 - this.tokens;
      await sleep(Math.max(25, Math.ceil((deficit / this.capacity) * this.perMs)));
    }
  }

  public available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 * Rejections resolve to `null` so one bad token never sinks a whole scan.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  if (items.length === 0) return results;

  let cursor = 0;
  const workers = new Array(Math.min(Math.max(1, limit), items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Collapses concurrent calls for the same key onto a single in-flight promise.
 * Without this, five views asking for the same mint means five identical HTTP
 * requests racing each other into the rate limiter.
 */
export class SingleFlight<T> {
  private inflight = new Map<string, Promise<T>>();

  public run(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = factory().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  public size(): number {
    return this.inflight.size;
  }
}

/** Splits an array into fixed-size chunks (batch API payloads). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
