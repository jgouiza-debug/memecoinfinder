export interface PumpPortalNewTokenEvent {
  mint: string;
  name: string;
  symbol: string;
  uri?: string;
  traderPublicKey?: string;
  txType?: string;
  timestamp: number;
}

export class PumpPortalService {
  private static ws: WebSocket | null = null;
  private static listeners: Array<(event: PumpPortalNewTokenEvent) => void> = [];
  private static isConnected = false;
  private static seenMints = new Set<string>();

  public static connect(onTokenReceived?: (event: PumpPortalNewTokenEvent) => void): void {
    if (onTokenReceived) {
      this.listeners.push(onTokenReceived);
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      // Standard browser WebSocket
      const wsUrl = 'wss://pumpportal.fun/api/data';
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('⚡ Connected to PumpPortal WebSocket feed');
        this.ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.mint && !this.seenMints.has(payload.mint)) {
            this.seenMints.add(payload.mint);
            const tokenEvent: PumpPortalNewTokenEvent = {
              mint: payload.mint,
              name: payload.name || 'Unknown Token',
              symbol: payload.symbol || 'UNK',
              uri: payload.uri,
              traderPublicKey: payload.traderPublicKey,
              txType: payload.txType,
              timestamp: Date.now(),
            };

            for (const listener of this.listeners) {
              listener(tokenEvent);
            }
          }
        } catch (err) {
          // Ignore JSON parse errors from heartbeat/ping
        }
      };

      this.ws.onerror = (err) => {
        console.warn('PumpPortal WS error:', err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('PumpPortal WS connection closed. Reconnecting in 5s...');
        setTimeout(() => this.connect(), 5000);
      };
    } catch (e) {
      console.warn('PumpPortal WebSocket init failed:', e);
    }
  }

  public static disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
