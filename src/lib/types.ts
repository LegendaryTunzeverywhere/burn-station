/** A burnable token account owned by the connected wallet. */
export interface BurnAsset {
  /** The token account (ATA) address — this is what gets closed. */
  pubkey: string;
  /** Mint address of the token. */
  mint: string;
  /** Owning token program (classic SPL Token or Token-2022), base58. */
  programId: string;
  /** Raw token amount (integer string, pre-decimals). */
  amountRaw: string;
  decimals: number;
  /** Human-readable balance. */
  uiAmount: number;
  /** Lamports of rent locked in this account — reclaimed on close. */
  lamports: number;
  /** Heuristic + metadata classification. */
  isNft: boolean;
  /**
   * Compressed NFT (Bubblegum/DAS) — has no SPL token account, so `pubkey`/
   * `mint` are both the DAS asset id and `lamports` is always 0: there is no
   * per-asset rent to reclaim, and burning it requires a Merkle proof via a
   * different instruction than classic burn+close. Not selectable for burn
   * in this app yet — shown so it's not silently invisible.
   */
  isCompressed?: boolean;
  /** Enriched metadata (best-effort). */
  name?: string;
  symbol?: string;
  image?: string;
  /** USD price per whole token (fungibles only), null if no market found. */
  priceUsd?: number | null;
  /** uiAmount * priceUsd, null if unknown. */
  valueUsd?: number | null;
}

export interface BurnResult {
  signatures: string[];
  reclaimedLamports: number;
  feeLamports: number;
}
