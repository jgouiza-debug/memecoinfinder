import { DexScreenerNewApiService } from '../src/services/dexscreenerNewApi';
import { RugCheckService } from '../src/services/rugcheckService';

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { path } = req.query;

  try {
    if (path === 'profiles' || req.url.includes('/api/profiles')) {
      const profiles = await DexScreenerNewApiService.fetchLatestTokenProfiles();
      return res.status(200).json({ success: true, count: profiles.length, data: profiles });
    }

    if (path === 'boosts' || req.url.includes('/api/boosts')) {
      const boosts = await DexScreenerNewApiService.fetchTopBoostedTokens();
      return res.status(200).json({ success: true, count: boosts.length, data: boosts });
    }

    if (req.query?.mint) {
      const mint = String(req.query.mint);
      const [marketData, rugCheck] = await Promise.all([
        DexScreenerNewApiService.fetchTokenMarketData(mint),
        RugCheckService.getReport(mint),
      ]);
      return res.status(200).json({ success: true, mint, marketData, rugCheck });
    }

    // Default status route
    return res.status(200).json({
      status: 'online',
      app: 'Meme Coin Finder Bot API',
      version: '2.0.0',
      endpoints: ['/api/profiles', '/api/boosts', '/api?mint=<SOLANA_MINT>'],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
