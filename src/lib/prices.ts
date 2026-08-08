/**
 * Token USD prices via Jupiter's keyless Price API.
 * Fails soft: any error just yields no price for that mint.
 */

const PRICE_URL = 'https://lite-api.jup.ag/price/v2';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Returns a map of mint -> USD price per whole token. Missing = no market. */
export async function fetchPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const unique = Array.from(new Set(mints)).filter(Boolean);
  if (unique.length === 0) return out;

  await Promise.all(
    chunk(unique, 100).map(async (batch) => {
      try {
        const res = await fetch(`${PRICE_URL}?ids=${batch.join(',')}`);
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.data ?? json ?? {};
        for (const mint of batch) {
          const entry = data[mint];
          const raw = entry?.price ?? entry?.usdPrice ?? entry;
          const num = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
          if (Number.isFinite(num) && num > 0) out[mint] = num;
        }
      } catch {
        /* ignore — price is best-effort */
      }
    }),
  );

  return out;
}
