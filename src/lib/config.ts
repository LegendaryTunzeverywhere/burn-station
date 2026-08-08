import { PublicKey } from '@solana/web3.js';

// All RPC traffic goes through /api/rpc — a Vercel serverless function in
// production, a Vite dev-server middleware locally (see vite.config.ts). The
// real upstream RPC URL/API key lives only in the server-side RPC_URL env
// var and is never bundled into client JS or visible in devtools.
export const RPC_URL = typeof window !== 'undefined' 
  ? `${window.location.origin}/api/rpc`
  : '/api/rpc';

export const FEE_BPS: number = Number(import.meta.env.VITE_FEE_BPS ?? 100);

// Wallet that receives the platform fee. This is a public Solana address,
// not a secret — it's visible on-chain in every burn transaction regardless
// of where it lives in the code, so hardcoding it here (instead of an env
// var) doesn't change what's exposed to anyone; it just fixes the value.
export const FEE_WALLET: PublicKey = new PublicKey(
  '4nG1VXAKF4zwPV7LZTFgLtGz8fxy2EDgFsQr9PAYFEjc',
);
export const FEE_ENABLED: boolean = FEE_BPS > 0;

/**
 * Burn + close is two instructions per asset. Keep batches small so each
 * transaction stays well under the packet size limit (Token-2022 accounts are larger).
 */
export const MAX_PER_TX = 6;

/** Priority fee (micro-lamports per compute unit) added to each burn transaction. */
export const PRIORITY_MICRO_LAMPORTS = 100_000;

/** Compute unit limit per transaction to ensure sufficient budget */
export const COMPUTE_UNIT_LIMIT = 400_000;

export const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;
