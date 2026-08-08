import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  type Commitment,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  RPC_URL,
  FEE_WALLET,
  FEE_BPS,
  FEE_ENABLED,
  MAX_PER_TX,
  PRIORITY_MICRO_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
} from './config';
import type { BurnAsset } from './types';

export const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Poll for confirmation over plain HTTP instead of `connection.confirmTransaction`,
 * which by default opens a WebSocket derived from the RPC endpoint URL. Since
 * RPC_URL is now the same-origin `/api/rpc` proxy (no WS server behind it),
 * that subscription would just hang — polling avoids the WS dependency entirely.
 */
export async function confirmSignature(
  signature: string,
  lastValidBlockHeight: number,
  commitment: Commitment = 'confirmed',
  intervalMs = 1500,
): Promise<void> {
  for (;;) {
    const { value: statuses } = await connection.getSignatureStatuses([signature]);
    const status = statuses[0];
    if (status) {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === commitment || status.confirmationStatus === 'finalized') {
        return;
      }
    }
    const blockHeight = await connection.getBlockHeight(commitment);
    if (blockHeight > lastValidBlockHeight) {
      throw new Error('Transaction expired (blockhash no longer valid) before confirmation');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Resolve a base58 program id string back to the correct PublicKey constant. */
function programKey(id: string): PublicKey {
  return id === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Fee (in lamports) that will be taken from a given amount of reclaimed rent. */
export function feeFor(lamports: number): number {
  if (!FEE_ENABLED) return 0;
  return Math.floor((lamports * FEE_BPS) / 10_000);
}

/** Load every SPL + Token-2022 account owned by `owner` (including empty/dust ones). */
export async function fetchTokenAccounts(owner: PublicKey): Promise<BurnAsset[]> {
  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection
      .getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
      .catch(() => ({ value: [] as never[] })),
  ]);

  const groups = [
    { value: classic.value, programId: TOKEN_PROGRAM_ID },
    { value: token2022.value, programId: TOKEN_2022_PROGRAM_ID },
  ];

  const rows: BurnAsset[] = [];
  for (const group of groups) {
    for (const acc of group.value) {
      const info = (acc.account.data as any).parsed.info;
      const ta = info.tokenAmount;
      const amountRaw: string = ta.amount;
      const decimals: number = ta.decimals;
      const isNft = decimals === 0 && (amountRaw === '1' || amountRaw === '0');
      rows.push({
        pubkey: acc.pubkey.toBase58(),
        mint: info.mint,
        programId: group.programId.toBase58(),
        amountRaw,
        decimals,
        uiAmount: ta.uiAmount ?? 0,
        lamports: acc.account.lamports,
        isNft,
      });
    }
  }
  return rows;
}

export interface BuiltBurn {
  transactions: Transaction[];
  blockhash: string;
  lastValidBlockHeight: number;
  totalReclaim: number;
  totalFee: number;
}

/**
 * Build one or more transactions that burn each selected asset and close its
 * account (reclaiming rent to the owner). A proportional platform fee is added
 * per transaction so each transaction is self-contained and atomic.
 */
export async function buildBurnTransactions(
  owner: PublicKey,
  assets: BurnAsset[],
): Promise<BuiltBurn> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const batches = chunk(assets, MAX_PER_TX);

  // Check wallet SOL balance to determine if we can charge fees
  const walletBalance = await connection.getBalance(owner);
  
  console.info(`[burn] Wallet balance: ${walletBalance} lamports (${(walletBalance / 1e9).toFixed(4)} SOL)`);
  
  // Estimate transaction fee: base fee (5000 lamports) + priority fee
  // Priority fee = COMPUTE_UNIT_LIMIT * PRIORITY_MICRO_LAMPORTS / 1,000,000
  const estimatedTxFee = 5_000 + Math.ceil((COMPUTE_UNIT_LIMIT * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  const minRequiredBalance = estimatedTxFee * batches.length; // Need enough for all transactions
  
  // Charge exactly FEE_BPS (1%) of the COMBINED rent of every selected asset —
  // tokens and NFTs alike. Burns are split across several transactions, so we
  // compute the fee on the grand total once, then distribute it across the
  // batches, dropping any rounding remainder onto the first batches. This makes
  // the on-chain fee equal the total shown in the UI to the lamport, instead of
  // flooring per batch (which would undercharge). Each batch's slice stays far
  // below the rent that same batch reclaims, so it's always covered even for a
  // wallet holding almost no SOL.
  const totalReclaim = assets.reduce((sum, a) => sum + a.lamports, 0);
  const totalFee = feeFor(totalReclaim);

  const batchFees = batches.map((b) => feeFor(b.reduce((s, a) => s + a.lamports, 0)));
  let remainder = totalFee - batchFees.reduce((s, f) => s + f, 0);
  for (let i = 0; i < batchFees.length && remainder > 0; i++) {
    batchFees[i] += 1;
    remainder -= 1;
  }
  
  // Calculate total fees we'll charge across all batches
  const totalFeesToCharge = batchFees.reduce((sum, f) => sum + f, 0);
  
  // If wallet doesn't have enough SOL for transaction fees + platform fees, skip platform fees
  // The user will still reclaim rent, just won't pay the 1% platform fee
  const canAffordFees = walletBalance >= (minRequiredBalance + totalFeesToCharge);
  const actualFee = canAffordFees ? totalFee : 0;
  
  if (!canAffordFees && FEE_ENABLED) {
    console.info(
      `[burn] Wallet has ${walletBalance} lamports, needs ${minRequiredBalance + totalFeesToCharge}. ` +
      `Skipping platform fee to allow burn to proceed.`
    );
  }

  const transactions: Transaction[] = batches.map((batch, i) => {
    const tx = new Transaction();
    
    // Set compute budget first - both limit and price
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT })
    );
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS })
    );

    for (const a of batch) {
      const pid = programKey(a.programId);
      const ata = new PublicKey(a.pubkey);
      const mint = new PublicKey(a.mint);

      // Only burn if there is a non-zero balance; empty accounts just get closed.
      if (BigInt(a.amountRaw) > 0n) {
        tx.add(
          createBurnCheckedInstruction(ata, mint, owner, BigInt(a.amountRaw), a.decimals, [], pid),
        );
      }
      tx.add(createCloseAccountInstruction(ata, owner, owner, [], pid));
    }

    // Only add fee transfer if wallet can afford it
    const fee = canAffordFees ? batchFees[i] : 0;
    if (fee > 0 && FEE_WALLET) {
      tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: FEE_WALLET, lamports: fee }));
    }

    tx.feePayer = owner;
    tx.recentBlockhash = blockhash;
    
    console.info(
      `[burn] Transaction ${i + 1}: ${batch.length} assets, ` +
      `fee=${fee} lamports, reclaim=${batch.reduce((s, a) => s + a.lamports, 0)} lamports`
    );
    
    return tx;
  });

  return { transactions, blockhash, lastValidBlockHeight, totalReclaim, totalFee: actualFee };
}
