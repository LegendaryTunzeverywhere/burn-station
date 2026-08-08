import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
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
} from './config';
import type { BurnAsset } from './types';

export const connection = new Connection(RPC_URL, 'confirmed');

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

  const transactions: Transaction[] = batches.map((batch, i) => {
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));

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

    const fee = batchFees[i];
    if (fee > 0 && FEE_WALLET) {
      tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: FEE_WALLET, lamports: fee }));
    }

    tx.feePayer = owner;
    tx.recentBlockhash = blockhash;
    return tx;
  });

  return { transactions, blockhash, lastValidBlockHeight, totalReclaim, totalFee };
}
