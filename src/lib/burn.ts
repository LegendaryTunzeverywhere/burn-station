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
import { buildCompressedBurnTransaction } from './compressedBurn';

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
  /** Selected assets a transaction couldn't be built for — see BurnResult. */
  skipped: { label: string; reason: string }[];
}

/**
 * Build one or more transactions that burn each selected asset. Classic SPL /
 * Token-2022 accounts (including regular NFTs) are batched several-per-
 * transaction using burn+close, closing the account and reclaiming its rent.
 * Compressed NFTs have no account to close — each gets its own transaction
 * built separately via a Merkle-proof burn instruction (compressedBurn.ts),
 * since there's nothing to batch and no rent to reclaim from them.
 */
export async function buildBurnTransactions(
  owner: PublicKey,
  assets: BurnAsset[],
): Promise<BuiltBurn> {
  const classicAssets = assets.filter((a) => !a.isCompressed);
  const compressedAssets = assets.filter((a) => a.isCompressed);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const batches = chunk(classicAssets, MAX_PER_TX);
  const totalTxCount = batches.length + compressedAssets.length;

  // Check both the payer's balance (to size fees) and the fee wallet's
  // balance (see WALLET_RENT_EXEMPT note below — a transfer INTO an
  // under-funded destination account is just as much a rent-exempt
  // violation as leaving the source stranded).
  const [walletBalance, feeWalletBalance] = await Promise.all([
    connection.getBalance(owner),
    FEE_WALLET ? connection.getBalance(FEE_WALLET).catch(() => 0) : Promise.resolve(0),
  ]);
  console.info(`[burn] Wallet balance: ${walletBalance} lamports (${(walletBalance / 1e9).toFixed(4)} SOL)`);

  // Solana only requires an account's balance to be zero-or-rent-exempt at the
  // END of a transaction, not mid-transaction — a wallet is free to dip below
  // the rent-exempt floor while a transaction is executing, as long as it
  // clears the floor (or hits zero) by the time the transaction finishes. Each
  // batch here closes token accounts and credits their reclaimed rent back to
  // the owner BEFORE the platform-fee transfer runs, so the wallet does not
  // need to hold the rent-exempt minimum up front — only enough to cover the
  // network fee, which is deducted before any instruction executes.
  //
  // The SAME invariant applies to the RECEIVING side of any transfer, though:
  // if FEE_WALLET currently holds 0 SOL (never funded) and we send it a small
  // fee below the rent-exempt minimum, it ends up with a positive balance
  // that's still not rent-exempt — which the runtime rejects just as it would
  // for a stranded sender. That's `InsufficientFundsForRent` on the fee
  // wallet's account index, not the burner's.
  const WALLET_RENT_EXEMPT = 890_880;

  // Estimate transaction fee: base fee (5000 lamports) + priority fee
  // Priority fee = COMPUTE_UNIT_LIMIT * PRIORITY_MICRO_LAMPORTS / 1,000,000
  const priorityFeePerTx = Math.ceil((COMPUTE_UNIT_LIMIT * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  const estimatedTxFee = 5_000 + priorityFeePerTx;
  // Every transaction pays this network fee — classic batches AND each
  // compressed NFT's own transaction alike — so size this against the total
  // transaction count, not just the classic batch count.
  const minRequiredBalance = estimatedTxFee * totalTxCount;

  console.info(`[burn] Estimated tx fee: ${estimatedTxFee} lamports (${totalTxCount} transactions = ${minRequiredBalance} total)`);

  // The only hard requirement: the wallet must be able to cover the network
  // fee(s) up front, since fees are deducted before any instruction runs.
  if (walletBalance < minRequiredBalance) {
    throw new Error(
      `Insufficient SOL to cover network fees. ` +
      `You need at least ${(minRequiredBalance / 1e9).toFixed(6)} SOL ` +
      `(${minRequiredBalance} lamports) for transaction fees, but your wallet has ` +
      `${(walletBalance / 1e9).toFixed(6)} SOL (${walletBalance} lamports).`
    );
  }

  // Charge exactly FEE_BPS (1%) of the COMBINED rent of every selected CLASSIC
  // asset (compressed ones always contribute 0 — nothing to reclaim from
  // them). Burns are split across several transactions, so we compute the fee
  // on the grand total once, then distribute it across the batches, dropping
  // any rounding remainder onto the first batches. This makes the on-chain
  // fee equal the total shown in the UI to the lamport, instead of flooring
  // per batch (which would undercharge). Each batch's slice stays far below
  // the rent that same batch reclaims, so it's always covered even for a
  // wallet holding almost no SOL.
  const totalReclaim = classicAssets.reduce((sum, a) => sum + a.lamports, 0);
  const totalFee = feeFor(totalReclaim);

  const batchFees = batches.map((b) => feeFor(b.reduce((s, a) => s + a.lamports, 0)));
  let remainder = totalFee - batchFees.reduce((s, f) => s + f, 0);
  for (let i = 0; i < batchFees.length && remainder > 0; i++) {
    batchFees[i] += 1;
    remainder -= 1;
  }

  // Calculate total fees we'll charge across all batches
  let totalFeesToCharge = batchFees.reduce((sum, f) => sum + f, 0);

  // Only skip the platform fee if it would leave the WALLET stranded with a
  // non-zero, non-rent-exempt balance once the WHOLE transaction settles (fee
  // paid, accounts closed & rent reclaimed, platform fee sent out) — that's
  // the actual on-chain invariant, so project the end-of-transaction balance
  // instead of demanding the rent-exempt buffer exist beforehand.
  const projectedEndBalance = walletBalance - minRequiredBalance + totalReclaim - totalFeesToCharge;
  let canAffordFees = projectedEndBalance === 0 || projectedEndBalance >= WALLET_RENT_EXEMPT;

  if (!canAffordFees && FEE_ENABLED) {
    console.info(
      `[burn] Projected end balance ${projectedEndBalance} lamports would be stranded below the ` +
      `${WALLET_RENT_EXEMPT} rent-exempt floor. Skipping platform fee to allow burn to proceed.`
    );
  }

  // Separately guard the FEE WALLET side of the same invariant. If it's
  // already rent-exempt, any addition keeps it that way and every batch's
  // slice is safe as split above. If it isn't (e.g. never funded), a split
  // per-batch transfer could land a partial fee that's still short of the
  // floor even when the grand total would clear it — so route the WHOLE fee
  // through a single instruction (the first batch) instead of splitting it,
  // guaranteeing one shot at clearing the floor rather than several shots
  // each too small on their own. If even the full total can't clear it,
  // there's no way to charge a fee without failing, so skip it entirely.
  if (canAffordFees && totalFeesToCharge > 0 && feeWalletBalance < WALLET_RENT_EXEMPT) {
    if (feeWalletBalance + totalFeesToCharge >= WALLET_RENT_EXEMPT) {
      console.info(
        `[burn] Fee wallet has ${feeWalletBalance} lamports (below the ${WALLET_RENT_EXEMPT} rent-exempt floor). ` +
        `Routing the full ${totalFeesToCharge}-lamport fee through a single transfer instead of splitting it across batches.`,
      );
      batchFees.fill(0);
      batchFees[0] = totalFeesToCharge;
    } else {
      console.info(
        `[burn] Fee wallet has ${feeWalletBalance} lamports and this burn's total fee (${totalFeesToCharge}) ` +
        `still wouldn't clear the ${WALLET_RENT_EXEMPT} rent-exempt floor. Skipping the platform fee — ` +
        `fund the fee wallet with at least ${WALLET_RENT_EXEMPT} lamports once to enable fee collection.`,
      );
      canAffordFees = false;
      batchFees.fill(0);
      totalFeesToCharge = 0;
    }
  }

  const actualFee = canAffordFees ? totalFee : 0;

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

  // Compressed NFTs: one transaction each, built independently so a proof
  // fetch failing for one (e.g. it moved/was burned elsewhere since the list
  // loaded, or a non-DAS RPC) doesn't block the rest of the burn — classic
  // assets and every other compressed asset still proceed.
  const compressedResults = await Promise.allSettled(
    compressedAssets.map((a) => buildCompressedBurnTransaction(owner, a, blockhash)),
  );

  const skipped: { label: string; reason: string }[] = [];
  compressedResults.forEach((r, i) => {
    const a = compressedAssets[i];
    const label = a.name || a.pubkey;
    if (r.status === 'fulfilled') {
      transactions.push(r.value);
      console.info(`[burn] Compressed NFT "${label}": built burn transaction`);
    } else {
      const reason = r.reason?.message ?? String(r.reason);
      console.warn(`[burn] Compressed NFT "${label}": couldn't build burn transaction — ${reason}`);
      skipped.push({ label, reason });
    }
  });

  if (transactions.length === 0) {
    throw new Error(
      skipped.length > 0
        ? `Couldn't build a burn transaction for any selected asset: ${skipped.map((s) => s.reason).join('; ')}`
        : 'Nothing selected to burn.',
    );
  }

  return { transactions, blockhash, lastValidBlockHeight, totalReclaim, totalFee: actualFee, skipped };
}
