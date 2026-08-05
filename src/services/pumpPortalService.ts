export interface PumpPortalNewTokenEvent {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  traderPublicKey?: string;
  txType?: string;
  timestamp: number;
}

/**
 * PumpPortal live launch feed.
 *
 * Reconnects with exponential backoff rather than a flat 5s retry (a flat retry
 * against a down endpoint is just a slow request loop), and bounds the seen-mint
 * set so a long session cannot grow it without limit.
 */
export class PumpPortalService {
  private static ws: WebSocket | null = null;
  private static listeners: Array<(event: PumpPortalNewTokenEvent) => void> = [];
  private static seenMints = new Set<string>();
  private static reconnectAttempts = 0;
  private static reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static shouldReconnect = true;

  private static readonly MAX_SEEN = 20_000;

  public static connect(onTokenReceived?: (event: PumpPortalNewTokenEvent) => void): void {
    if (onTokenReceived && !this.listeners.includes(onTokenReceived)) {
      this.listeners.push(onTokenReceived);
    }

    this.shouldReconnect = true;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket('wss://pumpportal.fun/api/data');

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload?.mint || this.seenMints.has(payload.mint)) return;

          if (this.seenMints.size >= this.MAX_SEEN) this.seenMints.clear();
          this.seenMints.add(payload.mint);

          const tokenEvent: PumpPortalNewTokenEvent = {
            mint: payload.mint,
            name: payload.name || 'Unknown Token',
            symbol: payload.symbol || 'MEME',
            uri: payload.uri,
            traderPublicKey: payload.traderPublicKey,
            txType: payload.txType,
            timestamp: Date.now(),
          };

          for (const listener of this.listeners) listener(tokenEvent);
        } catch {
          // Heartbeat / non-JSON frame.
        }
      };

      this.ws.onerror = () => {
        // onclose fires next and owns the retry.
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.shouldReconnect) return;

        const delay = Math.min(30_000, 2000 * Math.pow(2, this.reconnectAttempts));
        this.reconnectAttempts++;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      };
    } catch {
      this.ws = null;
    }
  }

  public static isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public static disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closing */ }
      this.ws = null;
    }
  }
}
