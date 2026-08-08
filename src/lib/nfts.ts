import { RPC_URL } from './config';

/**
 * Metadata enrichment via the DAS (Digital Asset Standard) API — `getAssetBatch`.
 * Works on DAS-capable RPCs (e.g. Helius) for BOTH fungible tokens and NFTs,
 * returning name, symbol and image. Fails soft to an empty map otherwise, so
 * burning still works with a plain RPC (assets just show as their mint address).
 */

export interface AssetMeta {
  name?: string;
  symbol?: string;
  image?: string;
}

function pickImage(asset: any): string | undefined {
  const links = asset?.content?.links;
  if (links?.image) return links.image;
  const files = asset?.content?.files;
  if (Array.isArray(files)) {
    const withUri = files.find((f: any) => f?.cdn_uri || f?.uri);
    if (withUri) return withUri.cdn_uri || withUri.uri;
  }
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
          };
        }
      } catch {
        /* ignore — metadata is best-effort */
      }
    }),
  );

  return out;
}
