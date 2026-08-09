import { RPC_URL } from './config';
import type { BurnAsset } from './types';

/**
 * Metadata enrichment via the DAS (Digital Asset Standard) API — `getAssetBatch`.
 * Works on DAS-capable RPCs (e.g. Helius) for BOTH fungible tokens and NFTs,
 * returning name, symbol, image, and an authoritative fungible/non-fungible
 * classification (via the asset `interface`). Fails soft to an empty map, so
 * burning still works with a plain RPC — assets just fall back to the on-chain
 * decimals heuristic and show their mint address.
 */

export interface AssetMeta {
  name?: string;
  symbol?: string;
  image?: string;
  /** From DAS `interface`: true = NFT, false = fungible, undefined = unknown. */
  isNft?: boolean;
}

function pickImage(asset: any): string | undefined {
  const links = asset?.content?.links;
  if (links?.image) return links.image;
  const files = asset?.content?.files;
  if (Array.isArray(files)) {
    const withUri = files.find((f: any) => f?.cdn_uri || f?.uri);
    if (withUri) return withUri.cdn_uri || withUri.uri;
  }
  const metaImage = asset?.content?.metadata?.image;
  if (metaImage) return metaImage;
  return undefined;
}

/** Classify from the DAS `interface` string. Undefined when unrecognised. */
function classify(iface?: string): boolean | undefined {
  if (!iface) return undefined;
  if (/fungible/i.test(iface)) return false; // FungibleToken / FungibleAsset
  if (/nft|print|mplcoreasset/i.test(iface)) return true; // V1_NFT, ProgrammableNFT, V1_PRINT, MplCoreAsset…
  return undefined;
}

/** ids -> metadata. DAS getAssetBatch accepts up to 1000 ids per call. */
export async function fetchAssetMeta(mints: string[]): Promise<Record<string, AssetMeta>> {
  const out: Record<string, AssetMeta> = {};
  const unique = Array.from(new Set(mints)).filter(Boolean);
  if (unique.length === 0) return out;

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 1000) batches.push(unique.slice(i, i + 1000));

  await Promise.all(
    batches.map(async (ids) => {
      try {
        const res = await fetch(RPC_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'burn-station',
            method: 'getAssetBatch',
            params: { ids },
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        const result = json?.result;
        if (!Array.isArray(result)) return;
        for (const asset of result) {
          if (!asset?.id) continue;
          const md = asset.content?.metadata;
          out[asset.id] = {
            name: md?.name || undefined,
            symbol: md?.symbol || asset.token_info?.symbol || undefined,
            image: pickImage(asset),
            isNft: classify(asset.interface),
          };
        }
      } catch {
        /* ignore — metadata is best-effort */
      }
    }),
  );

  return out;
}

/**
 * Compressed NFTs (Bubblegum) have no SPL token account — `getParsedTokenAccountsByOwner`
 * (used in burn.ts) will never see them, since they live as leaves in a shared
 * Merkle tree rather than individual accounts. The only way to discover them is
 * DAS `getAssetsByOwner`. Requires a DAS-capable RPC; fails soft to an empty
 * list otherwise (same convention as fetchAssetMeta above) so a plain RPC just
 * shows nothing extra instead of erroring.
 *
 * Returned as BurnAsset-shaped rows with `isCompressed: true` and `lamports: 0`
 * — there's no per-asset rent to reclaim (the tree's rent is shared across all
 * its leaves), and burning a cNFT needs a Merkle-proof instruction this app
 * doesn't build yet. They're surfaced so they're visible, not so they can be
 * burned here — the UI should keep them unselectable.
 */
export async function fetchCompressedNfts(owner: string): Promise<BurnAsset[]> {
  const out: BurnAsset[] = [];
  const PAGE_LIMIT = 1000;
  let page = 1;

  try {
    for (;;) {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'burn-station',
          method: 'getAssetsByOwner',
          params: { ownerAddress: owner, page, limit: PAGE_LIMIT },
        }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const items: any[] = json?.result?.items ?? [];
      if (items.length === 0) break;

      for (const asset of items) {
        if (!asset?.compression?.compressed) continue; // this endpoint can also return regular assets
        if (asset.burnt) continue;
        out.push({
          pubkey: asset.id,
          mint: asset.id,
          programId: 'compressed',
          amountRaw: '1',
          decimals: 0,
          uiAmount: 1,
          lamports: 0,
          isNft: true,
          isCompressed: true,
          name: asset.content?.metadata?.name || undefined,
          symbol: asset.content?.metadata?.symbol || undefined,
          image: pickImage(asset),
        });
      }

      if (items.length < PAGE_LIMIT) break;
      page += 1;
    }
  } catch {
    /* ignore — DAS not available on this RPC, or the call failed; fail soft */
  }

  return out;
}
