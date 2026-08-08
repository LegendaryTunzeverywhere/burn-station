import { useCallback, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchTokenAccounts } from '../lib/burn';
import { fetchPrices } from '../lib/prices';
import { fetchAssetMeta } from '../lib/nfts';
import type { BurnAsset } from '../lib/types';

interface State {
  assets: BurnAsset[];
  loading: boolean;
  error: string | null;
}

export function useAssets() {
  const { publicKey } = useWallet();
  const [state, setState] = useState<State>({ assets: [], loading: false, error: null });

  const load = useCallback(async (owner: PublicKey) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const base = await fetchTokenAccounts(owner);

      // Enrich in parallel; both are best-effort and must not break the list.
      const mints = base.map((a) => a.mint);
      const [prices, meta] = await Promise.all([
        fetchPrices(base.filter((a) => !a.isNft).map((a) => a.mint)),
        fetchAssetMeta(mints),
      ]);

      const enriched: BurnAsset[] = base.map((a) => {
        const price = prices[a.mint];
        const m = meta[a.mint];
        return {
          ...a,
          name: m?.name,
          symbol: m?.symbol,
          image: m?.image,
          priceUsd: price ?? null,
          valueUsd: price != null ? price * a.uiAmount : null,
        };
      });

      // Sort: highest known USD value first, then by rent, so risky burns stand out.
      enriched.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0) || y.lamports - x.lamports);

      setState({ assets: enriched, loading: false, error: null });
    } catch (e: any) {
      setState({ assets: [], loading: false, error: e?.message ?? 'Failed to load assets' });
    }
  }, []);

  const refresh = useCallback(() => {
    if (publicKey) load(publicKey);
  }, [publicKey, load]);

  useEffect(() => {
    if (publicKey) load(publicKey);
    else setState({ assets: [], loading: false, error: null });
  }, [publicKey, load]);

  return { ...state, refresh };
}
