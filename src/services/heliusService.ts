import axios from 'axios';

export const HELIUS_API_KEY = 'dfc72823-152b-468b-936e-57935ae27b08';
export const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export interface HeliusTokenAsset {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  logoUrl?: string;
}

export class HeliusService {
  /**
   * Fetches token asset data & authority status directly from Helius RPC (DAS API & AccountInfo)
   */
  public static async getTokenAsset(mint: string): Promise<HeliusTokenAsset | null> {
    try {
      // 1. Try Helius Digital Asset Standard (DAS) API
      const response = await axios.post(
        HELIUS_RPC_URL,
        {
          jsonrpc: '2.0',
          id: 'helius-asset-lookup',
          method: 'getAsset',
          params: { id: mint },
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const result = response.data?.result;
      if (result) {
        const tokenInfo = result.token_info || {};
        const content = result.content || {};

        return {
          mint,
          name: content.metadata?.name || 'Solana Token',
          symbol: content.metadata?.symbol || 'SOL',
          decimals: tokenInfo.decimals ?? 6,
          supply: tokenInfo.supply ?? 1000000000,
          mintAuthority: tokenInfo.mint_authority ?? null,
          freezeAuthority: tokenInfo.freeze_authority ?? null,
          logoUrl: content.links?.image || content.files?.[0]?.uri,
        };
      }
    } catch (e) {
      // Fallback to AccountInfo if getAsset is unavailable
    }

    try {
      // 2. Direct Helius RPC getAccountInfo query
      const accResponse = await axios.post(
        HELIUS_RPC_URL,
        {
          jsonrpc: '2.0',
          id: 'helius-account-info',
          method: 'getAccountInfo',
          params: [mint, { encoding: 'jsonParsed' }],
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const parsed = accResponse.data?.result?.value?.data?.parsed?.info;
      if (parsed) {
        return {
          mint,
          name: 'Solana Token',
          symbol: 'SOL',
          decimals: parsed.decimals ?? 6,
          supply: parsed.supply ? Number(parsed.supply) : 1000000000,
          mintAuthority: parsed.mintAuthority ?? null,
          freezeAuthority: parsed.freezeAuthority ?? null,
        };
      }
    } catch (e) {
      // Ignore
    }

    return null;
  }
}
