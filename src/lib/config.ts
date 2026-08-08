import { PublicKey } from '@solana/web3.js';

const env = import.meta.env;

export const RPC_URL: string =
  (env.VITE_RPC_URL as string | undefined)?.trim() || 'https://api.mainnet-beta.solana.com';

export const FEE_BPS: number = Number(env.VITE_FEE_BPS ?? 100);

/** Parse the configured fee wallet. Left null (fee skipped) if unset/invalid. */
function parseFeeWallet(): PublicKey | null {
  const raw = ((env.VITE_FEE_WALLET as string | undefined) ?? '').trim();
  if (!raw || raw.startsWith('REPLACE')) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

export const FEE_WALLET: PublicKey | null = parseFeeWallet();
export const FEE_ENABLED: boolean = FEE_WALLET !== null && FEE_BPS > 0;

/** Whether the configured RPC looks DAS-capable (Helius), which unlocks NFT metadata/images. */
export const DAS_CAPABLE: boolean = /helius|das/i.test(RPC_URL);

/**
 * Burn + close is two instructions per asset. Keep batches small so each
 * transaction stays well under the packet size limit (Token-2022 accounts are larger).
 */
export const MAX_PER_TX = 6;

/** Priority fee (micro-lamports per compute unit) added to each burn transaction. */
export const PRIORITY_MICRO_LAMPORTS = 20_000;

export const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;
