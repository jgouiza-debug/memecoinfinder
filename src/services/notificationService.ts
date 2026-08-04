export class NotificationService {
  private static audioCtx: AudioContext | null = null;

  public static requestPermission(): void {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }

  /**
   * Loud, crisp, resonant metallic "DING!" bell sound synthesizer
   */
  public static playChime(): void {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx && AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }

      if (this.audioCtx) {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }

        const now = this.audioCtx.currentTime;

        // Primary high bell tone (C6 = 1046.5Hz)
        const osc1 = this.audioCtx.createOscillator();
        const gain1 = this.audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1046.5, now);

        // Loud bell attack & metallic ring decay
        gain1.gain.setValueAtTime(0.9, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

        osc1.connect(gain1);
        gain1.connect(this.audioCtx.destination);

        // Overtone harmonic bell tone (C7 = 2093Hz) for crisp metallic "DING" resonance
        const osc2 = this.audioCtx.createOscillator();
        const gain2 = this.audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(2093, now);

        gain2.gain.setValueAtTime(0.5, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

        osc2.connect(gain2);
        gain2.connect(this.audioCtx.destination);

        // Start both bell oscillators simultaneously
        osc1.start(now);
        osc1.stop(now + 1.2);

        osc2.start(now);
        osc2.stop(now + 0.8);
      }
    } catch (e) {
      // Audio fallback
    }
  }

  public static sendNotification(title: string, body: string, icon?: string): void {
    this.playChime();

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: icon || 'https://pump.fun/favicon.ico',
        });
      } catch (e) {
        // Notification fallback
      }
    }
  }
}
