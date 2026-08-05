import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  ShieldCheck,
  Zap,
  Flame,
  Rocket,
  SlidersHorizontal,
  Search,
  ExternalLink,
  RefreshCw,
  Bookmark,
  BookmarkCheck,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Activity,
  Radio,
  Filter,
  Layers,
  Play,
  Pause,
  Cpu,
  Bell,
  BellOff,
  Volume2,
  Copy,
  Check,
} from 'lucide-react';
import { FinderEngine } from './services/finderEngine';
import { NotificationService } from './services/notificationService';
import { MemeCoinSignal, FilterPresetId, FinderStats, FilterConfig, CoinTier } from './types';

/** Compact currency formatting — long strings are what break card layouts. */
function fmtUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

function fmtAge(minutes: number): string {
  if (minutes <= 0) return 'new';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

const TIER_META: Record<CoinTier, { label: string; chip: string; ring: string }> = {
  SAFE_HAVEN: {
    label: 'SAFE HAVEN',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    ring: 'border-emerald-500/40 shadow-lg shadow-emerald-500/5',
  },
  NEAR_SAFE: {
    label: 'NEAR SAFE',
    chip: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
    ring: 'border-cyan-500/40 shadow-lg shadow-cyan-500/5',
  },
  AUDIT_ONLY: {
    label: 'AUDIT ONLY',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    ring: 'border-amber-500/30',
  },
  WATCH: {
    label: 'UNVERIFIED',
    chip: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
    ring: 'border-slate-700',
  },
  REJECTED: {
    label: 'REJECTED',
    chip: 'bg-red-500/15 text-red-300 border-red-500/40',
    ring: 'border-red-500/30',
  },
};

const PRESETS: Array<{
  id: FilterPresetId;
  label: string;
  icon: React.ReactNode;
  active: string;
  idle: string;
  countKey?: keyof FinderStats;
}> = [
  {
    id: 'safe_haven',
    label: 'Safe Haven',
    icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    active: 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20',
    idle: 'bg-slate-900/80 text-slate-300 hover:bg-slate-800',
    countKey: 'safeHavenCount',
  },
  {
    id: 'almost_safe',
    label: 'Near Safe',
    icon: <Zap className="w-4 h-4 shrink-0" />,
    active: 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20',
    idle: 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/50',
    countKey: 'nearSafeCount',
  },
  {
    id: 'rugcheck_only',
    label: 'Audit Passed',
    icon: <AlertTriangle className="w-4 h-4 shrink-0" />,
    active: 'bg-amber-500 text-black shadow-lg shadow-amber-500/20',
    idle: 'bg-amber-950/40 text-amber-300 border border-amber-500/30 hover:bg-amber-900/50',
    countKey: 'auditOnlyCount',
  },
  {
    id: 'high_momentum',
    label: 'Momentum',
    icon: <TrendingUp className="w-4 h-4 shrink-0" />,
    active: 'bg-violet-500 text-white shadow-lg shadow-violet-500/20',
    idle: 'bg-slate-900/80 text-slate-300 hover:bg-slate-800',
  },
  {
    id: 'fresh_launches',
    label: 'Fresh',
    icon: <Flame className="w-4 h-4 shrink-0" />,
    active: 'bg-orange-500 text-black shadow-lg shadow-orange-500/20',
    idle: 'bg-slate-900/80 text-slate-300 hover:bg-slate-800',
  },
  {
    id: 'top_boosted',
    label: 'Boosted',
    icon: <Rocket className="w-4 h-4 shrink-0" />,
    active: 'bg-purple-500 text-white shadow-lg shadow-purple-500/20',
    idle: 'bg-slate-900/80 text-slate-300 hover:bg-slate-800',
  },
];

const PRESET_BLURB: Record<FilterPresetId, string> = {
  safe_haven: 'Mint & freeze revoked on-chain, no danger flags, and market metrics above every floor.',
  almost_safe: 'Same contract safety as Safe Haven, but market metrics only clear the reduced floors.',
  rugcheck_only: 'Contract audit passed, market metrics thin or failing. Highest risk of the verified tiers.',
  high_momentum: 'Verified coins (Safe Haven + Near Safe) doing $5K+ in 5m volume, ranked by volume.',
  fresh_launches: 'Anything not rejected, under 60 minutes old, newest first.',
  top_boosted: 'Anything not rejected that is currently running a DexScreener boost.',
  custom: 'Your own thresholds. Contract safety gates stay on regardless.',
};

/** Which tier chip to show beside the active preset's description. */
const PRESET_TIER: Record<FilterPresetId, CoinTier> = {
  safe_haven: 'SAFE_HAVEN',
  almost_safe: 'NEAR_SAFE',
  rugcheck_only: 'AUDIT_ONLY',
  high_momentum: 'SAFE_HAVEN',
  fresh_launches: 'WATCH',
  top_boosted: 'WATCH',
  custom: 'WATCH',
};

// ---------------------------------------------------------------- signal card

interface CardProps {
  token: MemeCoinSignal;
  isBookmarked: boolean;
  onToggleBookmark: (mint: string) => void;
}

/**
 * Memoized so a tick that changes three coins re-renders three cards, not all
 * of them. Every text node that can grow is truncated and every fixed-size
 * element is `shrink-0`, so nothing can push a neighbour out of the card.
 */
const SignalCard = memo(function SignalCard({ token, isBookmarked, onToggleBookmark }: CardProps) {
  const [copied, setCopied] = useState(false);
  const tier = TIER_META[token.tier];

  const copyMint = useCallback(() => {
    navigator.clipboard?.writeText(token.mint).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined
    );
  }, [token.mint]);

  return (
    <article
      className={`glass-card rounded-2xl p-4 flex flex-col gap-3.5 min-w-0 overflow-hidden border ${tier.ring}`}
    >
      {/* Tier + score strip */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider border shrink-0 ${tier.chip}`}>
          {tier.label}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-500 font-semibold uppercase">Score</span>
          <span
            className={`text-sm font-black tabular-nums ${
              token.score >= 62 ? 'text-emerald-400' : token.score >= 45 ? 'text-cyan-400' : 'text-slate-300'
            }`}
          >
            {token.score}
          </span>
        </div>
      </div>

      {/* Identity */}
      <div className="flex items-start gap-3 min-w-0">
        {token.logoUrl ? (
          <img
            src={token.logoUrl}
            alt=""
            loading="lazy"
            className="w-11 h-11 rounded-xl object-cover border border-slate-700 bg-slate-900 shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        ) : (
          <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-black text-cyan-400 shrink-0">
            {token.symbol.slice(0, 3).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-extrabold text-white text-base truncate">${token.symbol}</h3>
            {token.isBoosted && (
              <span className="px-1.5 py-0.5 text-[9px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded shrink-0">
                BOOST {token.boostCount}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate">{token.name}</p>
        </div>

        <button
          onClick={() => onToggleBookmark(token.mint)}
          className="text-slate-500 hover:text-amber-400 transition-colors shrink-0 p-1 -m-1 cursor-pointer"
          title={isBookmarked ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          {isBookmarked ? <BookmarkCheck className="w-4 h-4 text-amber-400" /> : <Bookmark className="w-4 h-4" />}
        </button>
      </div>

      {/* Verification line */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold min-w-0">
        <span
          className={`px-1.5 py-0.5 rounded border ${
            token.mintRevoked
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          MINT {token.mintRevoked ? 'REVOKED' : 'ACTIVE'}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded border ${
            token.freezeRevoked
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          FREEZE {token.freezeRevoked ? 'REVOKED' : 'ACTIVE'}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded border ${
            token.rugCheckScore === null
              ? 'bg-slate-700/30 text-slate-400 border-slate-600/40'
              : token.rugCheckScore <= 500
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
          }`}
          title={token.rugCheckScore === null ? 'RugCheck has not indexed this mint yet' : 'RugCheck risk score'}
        >
          RUGCHECK {token.rugCheckScore === null ? 'PENDING' : token.rugCheckScore}
        </span>
        <span className="px-1.5 py-0.5 rounded border bg-slate-800/60 text-slate-400 border-slate-700">
          {fmtAge(token.pairAgeMinutes)}
        </span>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs min-w-0">
        {[
          { icon: <DollarSign className="w-3 h-3 text-emerald-400 shrink-0" />, label: 'Market Cap', value: fmtUsd(token.marketCapUsd), color: 'text-emerald-400' },
          { icon: <Layers className="w-3 h-3 text-purple-400 shrink-0" />, label: 'Liquidity', value: fmtUsd(token.liquidityUsd), color: 'text-purple-300' },
          { icon: <Activity className="w-3 h-3 text-amber-400 shrink-0" />, label: '5m Volume', value: fmtUsd(token.volume5mUsd), color: 'text-white' },
          { icon: <DollarSign className="w-3 h-3 text-cyan-400 shrink-0" />, label: 'FDV', value: fmtUsd(token.fdvUsd), color: 'text-white' },
        ].map((m) => (
          <div key={m.label} className="bg-slate-900/60 p-2 rounded-xl border border-slate-800/60 min-w-0">
            <div className="text-slate-400 flex items-center gap-1 text-[10px] min-w-0">
              {m.icon}
              <span className="truncate">{m.label}</span>
            </div>
            <div className={`font-extrabold mt-0.5 text-sm truncate tabular-nums ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Buy pressure */}
      <div className="min-w-0">
        <div className="flex justify-between gap-2 text-[10px] font-semibold text-slate-400 mb-1 min-w-0">
          <span className="truncate">Buy pressure {token.buyPressurePct}%</span>
          <span className="shrink-0 tabular-nums">
            {token.buys5m}B / {token.sells5m}S
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-400" style={{ width: `${token.buyPressurePct}%` }} />
          <div className="h-full bg-red-500/70" style={{ width: `${100 - token.buyPressurePct}%` }} />
        </div>
      </div>

      {/* Why it is not higher tier */}
      {token.weaknesses.length > 0 && (
        <ul className="text-[10px] text-slate-400 space-y-0.5 min-w-0">
          {token.weaknesses.slice(0, 2).map((w) => (
            <li key={w} className="truncate" title={w}>
              · {w}
            </li>
          ))}
        </ul>
      )}

      {/* Mint */}
      <div className="bg-slate-950/60 rounded-lg px-2 py-1.5 flex items-center gap-2 text-[10px] text-slate-400 font-mono min-w-0">
        <span className="truncate flex-1">{token.mint}</span>
        <button
          onClick={copyMint}
          className="shrink-0 text-slate-500 hover:text-cyan-400 transition-colors cursor-pointer"
          title="Copy mint address"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Actions */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 mt-auto min-w-0">
        <a
          href={token.quickLinks.photon}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-0 py-2 px-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs text-center transition-colors flex items-center justify-center gap-1"
        >
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Photon</span>
        </a>
        <a
          href={token.quickLinks.dexscreener}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          title="DexScreener"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={token.quickLinks.pumpFun}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 transition-colors"
          title="Pump.fun"
        >
          <Flame className="w-3.5 h-3.5" />
        </a>
        <a
          href={token.quickLinks.rugcheck}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 transition-colors"
          title="RugCheck audit"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
        </a>
      </div>
    </article>
  );
});

// ----------------------------------------------------------------------- app

export default function App() {
  const [signals, setSignals] = useState<MemeCoinSignal[]>([]);
  const [stats, setStats] = useState<FinderStats>(() => FinderEngine.getStats());
  const [activePreset, setActivePreset] = useState<FilterPresetId>('safe_haven');
  const [showCustomFilters, setShowCustomFilters] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'bookmarks'>('all');
  const [filterConfig, setFilterConfig] = useState<FilterConfig>(() => FinderEngine.getConfig());
  const [bookmarkedMints, setBookmarkedMints] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('meme_finder_bookmarks');
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const previousMintsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the subscription without making it a dependency — otherwise
  // toggling sound would tear down and re-initialize the whole engine.
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    FinderEngine.initialize();
    NotificationService.requestPermission();

    const unsubscribe = FinderEngine.onUpdate((updated) => {
      setSignals(updated);
      setStats(FinderEngine.getStats());

      const currentMints = new Set(updated.map((s) => s.mint));
      const isFirstFill = previousMintsRef.current.size === 0;
      const fresh = isFirstFill ? [] : updated.filter((s) => !previousMintsRef.current.has(s.mint));
      previousMintsRef.current = currentMints;

      // Only the top safety tier is worth interrupting the user for.
      const gem = fresh.find((s) => s.tier === 'SAFE_HAVEN') ?? fresh[0];
      if (!gem) return;

      if (soundRef.current) {
        NotificationService.sendNotification(
          `New ${TIER_META[gem.tier].label} coin: $${gem.symbol}`,
          `${gem.name} · ${fmtUsd(gem.marketCapUsd)} MC · score ${gem.score}`,
          gem.logoUrl
        );
      }

      setToast({
        title: `${TIER_META[gem.tier].label} · $${gem.symbol}`,
        body: `${fmtUsd(gem.marketCapUsd)} MC · ${fmtUsd(gem.liquidityUsd)} liquidity · score ${gem.score}`,
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    });

    return () => {
      unsubscribe();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Manual refresh loop. The engine runs its own 3s tick; this only forces an
  // extra discovery sweep, so pausing it does not stop live pricing.
  useEffect(() => {
    if (!autoScanEnabled) return;
    const interval = setInterval(() => void FinderEngine.triggerScan(), 15_000);
    return () => clearInterval(interval);
  }, [autoScanEnabled]);

  const handlePresetChange = useCallback((preset: FilterPresetId) => {
    setActivePreset(preset);
    FinderEngine.setPreset(preset);
    setFilterConfig(FinderEngine.getConfig());
  }, []);

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    try {
      await FinderEngine.triggerScan();
    } finally {
      setIsScanning(false);
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      if (!prev) NotificationService.playChime(true);
      return !prev;
    });
  }, []);

  const handleSearchSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!searchQuery.trim()) return;
      setIsSearching(true);
      try {
        await FinderEngine.searchAndEnrich(searchQuery.trim());
      } finally {
        setIsSearching(false);
      }
    },
    [searchQuery]
  );

  const toggleBookmark = useCallback((mint: string) => {
    setBookmarkedMints((prev) => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint);
      else next.add(mint);
      try {
        localStorage.setItem('meme_finder_bookmarks', JSON.stringify(Array.from(next)));
      } catch {
        // Storage full or blocked — the in-memory set still works this session.
      }
      return next;
    });
  }, []);

  const toggleEarlyEntry = useCallback(() => {
    setFilterConfig((prev) => {
      const next = { ...prev, earlyEntryOnly: !prev.earlyEntryOnly };
      FinderEngine.updateConfig({ earlyEntryOnly: next.earlyEntryOnly });
      return next;
    });
  }, []);

  const handleSliderChange = useCallback(
    (key: keyof FilterConfig, value: number) => {
      const next = { ...filterConfig, [key]: value };
      setFilterConfig(next);
      setActivePreset('custom');
      FinderEngine.updateConfig({ [key]: value } as Partial<FilterConfig>);
    },
    [filterConfig]
  );

  const displayedSignals = useMemo(
    () => (viewMode === 'bookmarks' ? signals.filter((s) => bookmarkedMints.has(s.mint)) : signals),
    [signals, viewMode, bookmarkedMints]
  );

  return (
    <div className="min-h-screen pb-16">
      {/* Toast — anchored bottom-right so it can never sit on top of the header
          or the first row of cards, and width-clamped on small screens. */}
      {toast && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-50 animate-slide-in">
          <div className="glass-panel border border-emerald-500/50 rounded-2xl p-3.5 flex items-start gap-3 min-w-0">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/40 shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-black text-emerald-300 text-xs tracking-wide truncate">{toast.title}</div>
              <p className="text-[11px] text-slate-300 mt-0.5 truncate">{toast.body}</p>
            </div>
          </div>
        </div>
      )}

      {/* Header — wraps instead of overflowing; nothing is absolutely placed. */}
      <header className="glass-panel sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0">
              <Rocket className="w-5 h-5 text-black stroke-[2.5]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight text-white truncate">
                Meme Coin Finder <span className="gradient-text-emerald">Bot</span>
              </h1>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5 min-w-0">
                <Radio className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">
                  Helius on-chain verify · RugCheck audit · {stats.apiCallsLastMinute} API calls/min
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={toggleSound}
              className={`px-2.5 py-2 rounded-xl font-bold text-[11px] flex items-center gap-1.5 border transition-colors cursor-pointer ${
                soundEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
              title="Toggle notification chime"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 shrink-0" /> : <BellOff className="w-4 h-4 shrink-0" />}
              <span className="hidden sm:inline">{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span>
            </button>

            <button
              onClick={() => setAutoScanEnabled((v) => !v)}
              className={`px-2.5 py-2 rounded-xl font-bold text-[11px] flex items-center gap-1.5 border transition-colors cursor-pointer ${
                autoScanEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {autoScanEnabled ? <Pause className="w-3.5 h-3.5 shrink-0" /> : <Play className="w-3.5 h-3.5 shrink-0" />}
              <span className="hidden sm:inline">{autoScanEnabled ? 'AUTO ON' : 'PAUSED'}</span>
            </button>

            <button
              onClick={handleScan}
              disabled={isScanning}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${isScanning ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isScanning ? 'Scanning' : 'Scan Now'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-5">
        {/* Funnel strip — where every scanned coin actually ended up. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {[
            { label: 'Scanned', value: stats.totalScanned, color: 'text-slate-200' },
            { label: 'Tracked', value: stats.tracked, color: 'text-slate-200' },
            { label: 'Safe Haven', value: stats.safeHavenCount, color: 'text-emerald-400' },
            { label: 'Near Safe', value: stats.nearSafeCount, color: 'text-cyan-400' },
            { label: 'Audit Only', value: stats.auditOnlyCount, color: 'text-amber-400' },
            { label: 'Rejected', value: stats.rejectedCount, color: 'text-red-400' },
          ].map((s) => (
            <div key={s.label} className="glass-panel rounded-xl px-3 py-2.5 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{s.label}</div>
              <div className={`text-lg font-black tabular-nums ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="glass-panel p-4 rounded-2xl space-y-3.5">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {PRESETS.map((preset) => {
              const isActive = activePreset === preset.id;
              const count = preset.countKey ? (stats[preset.countKey] as number) : null;
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isActive ? preset.active : preset.idle
                  }`}
                >
                  {preset.icon}
                  <span className="whitespace-nowrap">{preset.label}</span>
                  {count !== null && (
                    <span
                      className={`px-1.5 rounded tabular-nums text-[10px] ${
                        isActive ? 'bg-black/20' : 'bg-slate-800/80 text-slate-300'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              onClick={() => setShowCustomFilters((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                showCustomFilters || activePreset === 'custom'
                  ? 'bg-slate-700 text-white border border-slate-500'
                  : 'bg-slate-900/80 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Custom</span>
            </button>

            <button
              onClick={() => setViewMode((v) => (v === 'all' ? 'bookmarks' : 'all'))}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-colors cursor-pointer ml-auto ${
                viewMode === 'bookmarks'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">Watchlist ({bookmarkedMints.size})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
            <p className="text-[11px] text-slate-400 leading-relaxed flex items-start gap-2 flex-1 min-w-[240px]">
              <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-slate-300">{TIER_META[PRESET_TIER[activePreset]].label}</strong> —{' '}
                {PRESET_BLURB[activePreset]} Tiers are exclusive: a coin appears in exactly one of Safe Haven,
                Near Safe and Audit Passed.
              </span>
            </p>

            {/* Age and market cap are entry-timing preferences, not safety —
                so they live behind an explicit toggle rather than silently
                demoting audited coins out of the safe tiers. */}
            <button
              onClick={toggleEarlyEntry}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border transition-colors cursor-pointer shrink-0 ${
                filterConfig.earlyEntryOnly
                  ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
              title="Restrict the safe tiers to young, small-cap pairs"
            >
              <Flame className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">
                Early entry only {filterConfig.earlyEntryOnly ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by mint address, symbol or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-24 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-cyan-500 text-black font-bold text-xs disabled:opacity-50 cursor-pointer"
            >
              {isSearching ? '...' : 'Lookup'}
            </button>
          </form>

          {showCustomFilters && (
            <div className="pt-3.5 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {([
                { key: 'minMarketCapUsd', label: 'Min Market Cap', max: 100_000, step: 250, accent: 'accent-emerald-500' },
                { key: 'minLiquidityUsd', label: 'Min Liquidity', max: 50_000, step: 250, accent: 'accent-purple-500' },
                { key: 'minVolume5mUsd', label: 'Min 5m Volume', max: 20_000, step: 250, accent: 'accent-amber-500' },
                { key: 'minOverallScoreToPass', label: 'Safe Haven Score', max: 100, step: 1, accent: 'accent-cyan-500' },
              ] as const).map((slider) => (
                <div key={slider.key} className="min-w-0">
                  <div className="flex justify-between gap-2 text-[11px] font-semibold mb-1.5 text-slate-300 min-w-0">
                    <span className="truncate">{slider.label}</span>
                    <span className="text-cyan-400 shrink-0 tabular-nums">
                      {slider.key === 'minOverallScoreToPass'
                        ? filterConfig[slider.key]
                        : fmtUsd(filterConfig[slider.key] as number)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={slider.max}
                    step={slider.step}
                    value={filterConfig[slider.key] as number}
                    onChange={(e) => handleSliderChange(slider.key, Number(e.target.value))}
                    className={`w-full cursor-pointer ${slider.accent}`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feed */}
        {displayedSignals.length === 0 ? (
          <div className="glass-panel p-10 text-center rounded-2xl space-y-3">
            <Filter className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-300">
              {viewMode === 'bookmarks'
                ? 'No bookmarked coins yet'
                : `No coins in ${TIER_META[PRESET_TIER[activePreset]].label} right now`}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Tracking {stats.tracked} mints · {stats.safeHavenCount} safe haven · {stats.nearSafeCount} near safe ·{' '}
              {stats.auditOnlyCount} audit only. Try a lower tier or loosen the thresholds under Custom.
            </p>
            <button
              onClick={handleScan}
              className="px-4 py-2 rounded-xl bg-slate-800 text-cyan-400 border border-cyan-500/30 hover:bg-slate-700 font-semibold text-xs cursor-pointer"
            >
              Scan Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {displayedSignals.map((token) => (
              <SignalCard
                key={token.mint}
                token={token}
                isBookmarked={bookmarkedMints.has(token.mint)}
                onToggleBookmark={toggleBookmark}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
