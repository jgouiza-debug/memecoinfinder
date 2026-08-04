import React, { useState, useEffect, useRef } from 'react';
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
  CheckCircle2,
  DollarSign,
  Activity,
  Award,
  Globe,
  Radio,
  Filter,
  Layers,
  Sparkles,
  Lock,
  Play,
  Pause,
  AlertOctagon,
  Cpu,
  Bell,
  BellOff,
  Volume2
} from 'lucide-react';
import { FinderEngine, HELIUS_RPC_URL } from './services/finderEngine';
import { NotificationService } from './services/notificationService';
import { MemeCoinSignal, FilterPresetId, FinderStats, FilterConfig } from './types';

export default function App() {
  const [signals, setSignals] = useState<MemeCoinSignal[]>([]);
  const [stats, setStats] = useState<FinderStats>({
    totalScanned: 0,
    passedFilters: 0,
    boostedCount: 0,
    avgScore: 0,
    solPriceUsd: 165,
  });
  const [activePreset, setActivePreset] = useState<FilterPresetId>('safe_haven');
  const [showCustomFilters, setShowCustomFilters] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toastMessage, setToastMessage] = useState<{ title: string; body: string; symbol: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [bookmarkedMints, setBookmarkedMints] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('meme_finder_bookmarks');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [viewMode, setViewMode] = useState<'all' | 'bookmarks'>('all');
  const [filterConfig, setFilterConfig] = useState<FilterConfig>(FinderEngine.getConfig());

  const previousMintsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    FinderEngine.initialize();
    NotificationService.requestPermission();

    const unsubscribe = FinderEngine.onUpdate((updatedSignals) => {
      setSignals(updatedSignals);
      setStats(FinderEngine.getStats());

      // Detect new Safe Haven coin additions for notifications & audio chime bump
      const currentMints = new Set(updatedSignals.map((s) => s.mint));
      const newCoins = updatedSignals.filter(
        (s) => !previousMintsRef.current.has(s.mint) && previousMintsRef.current.size > 0
      );

      if (newCoins.length > 0) {
        const topGem = newCoins[0];
        if (soundEnabled) {
          NotificationService.sendNotification(
            `🚀 New Safe Haven Gem: $${topGem.symbol}!`,
            `${topGem.name} - $${topGem.marketCapUsd.toLocaleString()} MC | Helius & RugCheck Verified`,
            topGem.logoUrl
          );
        }

        setToastMessage({
          title: `🚀 NEW SAFE HAVEN GEM FOUND!`,
          body: `$${topGem.symbol} (${topGem.name}) | $${topGem.marketCapUsd.toLocaleString()} MC | Mint Revoked`,
          symbol: topGem.symbol,
        });

        setTimeout(() => setToastMessage(null), 5000);
      }

      previousMintsRef.current = currentMints;
    });

    handleScan();

    return () => {
      unsubscribe();
    };
  }, [soundEnabled]);

  // 3-SECOND AUTO RELOAD INTERVAL
  useEffect(() => {
    if (!autoScanEnabled) return;

    const interval = setInterval(() => {
      FinderEngine.triggerScan();
    }, 3000);

    return () => clearInterval(interval);
  }, [autoScanEnabled]);

  const handlePresetChange = (preset: FilterPresetId) => {
    setActivePreset(preset);
    FinderEngine.setPreset(preset);
    setFilterConfig(FinderEngine.getConfig());
  };

  const handleScan = async () => {
    setIsScanning(true);
    await FinderEngine.triggerScan();
    setIsScanning(false);
  };

  const toggleAutoScan = () => {
    setAutoScanEnabled(!autoScanEnabled);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      NotificationService.playChime();
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    await FinderEngine.searchAndEnrich(searchQuery.trim());
    setIsSearching(false);
  };

  const toggleBookmark = (mint: string) => {
    const next = new Set(bookmarkedMints);
    if (next.has(mint)) {
      next.delete(mint);
    } else {
      next.add(mint);
    }
    setBookmarkedMints(next);
    localStorage.setItem('meme_finder_bookmarks', JSON.stringify(Array.from(next)));
  };

  const handleSliderChange = (key: keyof FilterConfig, value: number | boolean) => {
    const nextConfig = { ...filterConfig, [key]: value };
    setFilterConfig(nextConfig);
    setActivePreset('custom');
    FinderEngine.updateConfig(nextConfig);
  };

  const displayedSignals = signals.filter((s) => {
    if (viewMode === 'bookmarks') return bookmarkedMints.has(s.mint);
    return true;
  });

  return (
    <div className="min-h-screen pb-16 relative">
      {/* FLOATING TOAST NOTIFICATION POPUP */}
      {toastMessage && (
        <div className="fixed top-24 right-6 z-50 bg-gradient-to-r from-emerald-950 via-slate-900 to-cyan-950 border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl shadow-emerald-500/20 max-w-sm animate-bounce">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/40">
              <Bell className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="font-black text-emerald-300 text-xs tracking-wider">
                {toastMessage.title}
              </div>
              <p className="text-xs text-white mt-1 font-semibold">{toastMessage.body}</p>
            </div>
          </div>
        </div>
      )}

      {/* Top Banner Header */}
      <header className="glass-panel sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Rocket className="w-6 h-6 text-black stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-extrabold tracking-tight text-white">
                  Meme Coin Finder <span className="gradient-text-emerald">Bot</span>
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-extrabold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 rounded-full flex items-center space-x-1">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span>HELIUS API ONLY (DEFAULT)</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center space-x-2 mt-0.5">
                <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span>Default Helius RPC (dfc72823...) & 3s Chime Bump</span>
              </p>
            </div>
          </div>

          {/* Quick Metrics & 3s Auto Scan Bar */}
          <div className="hidden lg:flex items-center space-x-3 text-sm">
            <div className="glass-panel px-3 py-2 rounded-xl flex items-center space-x-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <div>
                <div className="text-[11px] text-slate-400">Scanned</div>
                <div className="font-bold text-white text-xs">{stats.totalScanned} Mints</div>
              </div>
            </div>

            {/* SOUND BUMP TOGGLE BUTTON */}
            <button
              onClick={toggleSound}
              className={`px-3 py-2 rounded-xl font-extrabold text-xs flex items-center space-x-1.5 border transition-all cursor-pointer ${
                soundEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
              title="Toggle Audio Notification Chime"
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span>DING SOUND: ON</span>
                </>
              ) : (
                <>
                  <BellOff className="w-4 h-4 text-slate-500" />
                  <span>SOUND: OFF</span>
                </>
              )}
            </button>

            {/* 3-SECOND AUTO SCAN TOGGLE BUTTON */}
            <button
              onClick={toggleAutoScan}
              className={`px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center space-x-2 border transition-all cursor-pointer ${
                autoScanEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {autoScanEnabled ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  <Pause className="w-3.5 h-3.5 fill-emerald-400" />
                  <span>AUTO RELOAD: ON (3s)</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                  <Play className="w-3.5 h-3.5 fill-slate-400" />
                  <span>AUTO RELOAD: PAUSED</span>
                </>
              )}
            </button>

            <button
              onClick={handleScan}
              disabled={isScanning}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold hover:from-emerald-400 hover:to-cyan-400 transition-all flex items-center space-x-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Scan Now'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* CALLOUT BANNER */}
        {activePreset === 'almost_safe' ? (
          <div className="mb-6 bg-gradient-to-r from-cyan-950/80 via-slate-900/80 to-emerald-950/80 border border-cyan-500/40 rounded-2xl p-5 shadow-2xl animate-fadeIn">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/40">
                <Zap className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="font-extrabold text-cyan-300 text-sm flex items-center space-x-2">
                  <span>⚡ NEAR SAFE HAVEN MODE (HELIUS RPC DEFAULT)</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 bg-cyan-500/30 text-cyan-200 rounded-md border border-cyan-500/40">
                    $500+ METRICS NEAR MISSES
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Showing early tokens that pass <strong>Helius RPC & RugCheck contract audit</strong> (Mint Revoked: NULL, Freeze Revoked: NULL, Score &le; 500) and have <strong>$500+ Market Cap & Liquidity</strong>.
                </p>
              </div>
            </div>
          </div>
        ) : activePreset === 'rugcheck_only' ? (
          <div className="mb-6 bg-gradient-to-r from-amber-950/80 via-red-950/80 to-slate-900/90 border border-amber-500/50 rounded-2xl p-5 shadow-2xl animate-fadeIn">
            <div className="flex items-start space-x-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/40">
                <AlertOctagon className="w-6 h-6 animate-bounce" />
              </div>
              <div className="space-y-1">
                <div className="font-extrabold text-amber-300 text-sm flex items-center space-x-2">
                  <span>⚠️ HIGH RISK WARNING: VERIFIED HELIUS & RUGCHECK API AUDIT ONLY</span>
                  <span className="text-[10px] font-black px-2.5 py-0.5 bg-red-500/30 text-red-300 rounded-md border border-red-500/40">
                    MARKET FILTERS BYPASSED
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  This view displays tokens that have <strong>ACTUALLY PASSED Helius RPC & RugCheck API audit</strong> (Mint Revoked: NULL, Freeze Revoked: NULL, Score &le; 500). Auto reloading every 3 seconds with metallic DING notifications.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 bg-gradient-to-r from-emerald-950/60 via-slate-900/80 to-cyan-950/60 border border-emerald-500/30 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/30">
                <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
              </div>
              <div>
                <div className="font-extrabold text-white text-sm flex items-center space-x-2">
                  <span>⚡ DEFAULT HELIUS API ONLY (KEY: dfc72823...)</span>
                  <span className="text-xs font-semibold px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded-md">PRIMARY DATA SOURCE</span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Powered by Helius RPC DAS API: <strong>Mint Revoked: NULL</strong> • <strong>Freeze Revoked: NULL</strong> • Loud DING bell sound on new gems!
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={toggleSound}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center space-x-1 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Test Loud DING</span>
              </button>
            </div>
          </div>
        )}

        {/* Strategy Presets & Search */}
        <div className="glass-panel p-5 rounded-2xl mb-8 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Filter Preset Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handlePresetChange('safe_haven')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'safe_haven'
                    ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 font-bold'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Safe Haven ($1k Mins)</span>
              </button>

              <button
                onClick={() => handlePresetChange('almost_safe')}
                className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'almost_safe'
                    ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20 font-bold'
                    : 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-900/50'
                }`}
              >
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>⚡ Near Safe Haven ($500 Mins)</span>
              </button>

              <button
                onClick={() => handlePresetChange('high_momentum')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'high_momentum'
                    ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20 font-bold'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Zap className="w-4 h-4" />
                <span>High Momentum ($5k Vol)</span>
              </button>

              <button
                onClick={() => handlePresetChange('fresh_launches')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'fresh_launches'
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20 font-bold'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Flame className="w-4 h-4" />
                <span>Fresh Pump.fun ($500 Mins)</span>
              </button>

              <button
                onClick={() => handlePresetChange('top_boosted')}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'top_boosted'
                    ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20 font-bold'
                    : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Top Boosted</span>
              </button>

              <button
                onClick={() => handlePresetChange('rugcheck_only')}
                className={`px-4 py-2 rounded-xl text-sm font-extrabold flex items-center space-x-2 transition-all cursor-pointer ${
                  activePreset === 'rugcheck_only'
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                    : 'bg-amber-950/40 text-amber-300 border border-amber-500/30 hover:bg-amber-900/50'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span>⚠️ Passed RugCheck Only (3s)</span>
              </button>

              <button
                onClick={() => setShowCustomFilters(!showCustomFilters)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  showCustomFilters || activePreset === 'custom'
                    ? 'bg-slate-700 text-white border border-slate-500'
                    : 'bg-slate-900/80 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Custom Rules</span>
              </button>
            </div>

            {/* Right Side Controls */}
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setViewMode(viewMode === 'all' ? 'bookmarks' : 'all')}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 border transition-all cursor-pointer ${
                  viewMode === 'bookmarks'
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Watchlist ({bookmarkedMints.size})</span>
              </button>
            </div>
          </div>

          {/* Search Bar Input */}
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
            <input
              type="text"
              placeholder="Search by Solana mint address, token symbol or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-12 pr-28 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
            />
            <button
              type="submit"
              disabled={isSearching}
              className="absolute right-2 top-2 px-4 py-1.5 rounded-lg bg-cyan-500 text-black font-bold text-xs hover:bg-cyan-400 transition-all cursor-pointer"
            >
              {isSearching ? 'Searching...' : 'Lookup'}
            </button>
          </form>

          {/* Custom Filter Sliders Drawer */}
          {showCustomFilters && (
            <div className="pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-4 gap-6 animate-fadeIn">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-2 text-slate-300">
                  <span>Min FDV ($)</span>
                  <span className="text-cyan-400">${filterConfig.minFdvUsd.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100000"
                  step="500"
                  value={filterConfig.minFdvUsd}
                  onChange={(e) => handleSliderChange('minFdvUsd', Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-2 text-slate-300">
                  <span>Min Market Cap ($)</span>
                  <span className="text-cyan-400">${filterConfig.minMarketCapUsd.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100000"
                  step="500"
                  value={filterConfig.minMarketCapUsd}
                  onChange={(e) => handleSliderChange('minMarketCapUsd', Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-2 text-slate-300">
                  <span>Min Liquidity ($)</span>
                  <span className="text-emerald-400">${filterConfig.minLiquidityUsd.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50000"
                  step="500"
                  value={filterConfig.minLiquidityUsd}
                  onChange={(e) => handleSliderChange('minLiquidityUsd', Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-2 text-slate-300">
                  <span>Min 5m Volume ($)</span>
                  <span className="text-amber-400">${filterConfig.minVolume5mUsd.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="20000"
                  step="500"
                  value={filterConfig.minVolume5mUsd}
                  onChange={(e) => handleSliderChange('minVolume5mUsd', Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* Signals List Feed */}
        {displayedSignals.length === 0 ? (
          <div className="glass-panel p-12 text-center rounded-2xl space-y-4">
            <Filter className="w-12 h-12 text-slate-600 mx-auto" />
            <h3 className="text-lg font-bold text-slate-300">Scanning via Helius API (Auto Reloading Every 3s)...</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Auto reload active ({autoScanEnabled ? 'ON - 3s' : 'PAUSED'}). Primary source: <strong>Helius API Key dfc72823...</strong>. Click "Scan Now" to force fetch.
            </p>
            <button
              onClick={handleScan}
              className="px-5 py-2.5 rounded-xl bg-slate-800 text-cyan-400 border border-cyan-500/30 hover:bg-slate-700 transition-all font-semibold text-sm cursor-pointer"
            >
              Run Scan Now
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedSignals.map((token) => {
              const isBookmarked = bookmarkedMints.has(token.mint);

              return (
                <div
                  key={token.mint}
                  className={`glass-card p-5 rounded-2xl relative flex flex-col justify-between space-y-4 border ${
                    activePreset === 'almost_safe'
                      ? 'border-cyan-500/40 bg-slate-900/90 shadow-lg shadow-cyan-500/10'
                      : token.score >= 75
                      ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Header info */}
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        {token.logoUrl ? (
                          <img
                            src={token.logoUrl}
                            alt={token.name}
                            className="w-12 h-12 rounded-xl object-cover border border-slate-700 bg-slate-900"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center text-lg font-black text-cyan-400">
                            ${token.symbol.slice(0, 3)}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-extrabold text-white text-base tracking-tight truncate max-w-[130px]">
                              ${token.symbol}
                            </h3>
                            {token.isBoosted && (
                              <span className="px-2 py-0.5 text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full flex items-center space-x-1">
                                <span>🚀 BOOSTED</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate max-w-[150px]">{token.name}</p>
                        </div>
                      </div>

                      {/* Safety Score / RugCheck Badge */}
                      <div className="flex flex-col items-end">
                        <div
                          className={`px-3 py-1 rounded-xl text-xs font-black flex items-center space-x-1 border ${
                            token.rugCheckScore <= 500
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>RugCheck: {token.rugCheckScore} Good</span>
                        </div>
                        <span className="text-[10px] text-cyan-400 font-extrabold mt-1">
                          ✓ HELIUS: MINT & FREEZE NULL
                        </span>
                      </div>
                    </div>

                    {/* Mint Address Copy */}
                    <div className="mt-3 bg-slate-950/60 rounded-lg p-2 flex items-center justify-between text-xs text-slate-400 font-mono">
                      <span className="truncate max-w-[200px]">{token.mint}</span>
                      <button
                        onClick={() => toggleBookmark(token.mint)}
                        className="text-slate-400 hover:text-amber-400 transition-colors ml-2 cursor-pointer"
                        title={isBookmarked ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      >
                        {isBookmarked ? (
                          <BookmarkCheck className="w-4 h-4 text-amber-400 fill-amber-400" />
                        ) : (
                          <Bookmark className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* DEX API 4-Metric Grid */}
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                      <div className="text-slate-400 flex items-center space-x-1 text-[11px]">
                        <DollarSign className="w-3 h-3 text-cyan-400" />
                        <span>FDV</span>
                      </div>
                      <div className="font-extrabold text-white mt-0.5 text-sm">
                        ${token.fdvUsd.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                      <div className="text-slate-400 flex items-center space-x-1 text-[11px]">
                        <DollarSign className="w-3 h-3 text-emerald-400" />
                        <span>Market Cap</span>
                      </div>
                      <div className="font-extrabold text-emerald-400 mt-0.5 text-sm">
                        ${token.marketCapUsd.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                      <div className="text-slate-400 flex items-center space-x-1 text-[11px]">
                        <Activity className="w-3 h-3 text-amber-400" />
                        <span>5m Volume</span>
                      </div>
                      <div className="font-extrabold text-white mt-0.5 text-sm">
                        ${token.volume5mUsd.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/60">
                      <div className="text-slate-400 flex items-center space-x-1 text-[11px]">
                        <Layers className="w-3 h-3 text-purple-400" />
                        <span>Liquidity</span>
                      </div>
                      <div className="font-extrabold text-purple-300 mt-0.5 text-sm">
                        ${token.liquidityUsd.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Buy Pressure Progress Bar */}
                  <div>
                    <div className="flex justify-between text-[11px] font-semibold text-slate-400 mb-1">
                      <span>Buy Pressure ({token.buyPressurePct}%)</span>
                      <span>{token.buys5m} Buys / {token.sells5m} Sells</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-400 transition-all"
                        style={{ width: `${token.buyPressurePct}%` }}
                      ></div>
                      <div
                        className="h-full bg-red-500 transition-all"
                        style={{ width: `${100 - token.buyPressurePct}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Action Trading Quick Links */}
                  <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
                    <a
                      href={token.quickLinks.photon}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs text-center transition-all shadow-md shadow-emerald-500/10 flex items-center justify-center space-x-1"
                    >
                      <Zap className="w-3.5 h-3.5 fill-black" />
                      <span>Photon SOL</span>
                    </a>

                    <a
                      href={token.quickLinks.dexscreener}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all flex items-center space-x-1"
                      title="View on DEX Screener"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>DEX</span>
                    </a>

                    <a
                      href={token.quickLinks.pumpFun}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all flex items-center space-x-1"
                      title="View on Pump.fun"
                    >
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                    </a>

                    <a
                      href={token.quickLinks.rugcheck}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all flex items-center space-x-1"
                      title="Audit on RugCheck"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
