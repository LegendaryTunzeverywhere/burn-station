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
   * per-asset rent to reclaim (the tree's rent is shared across every leaf
   * in it). Burning one uses a Merkle-proof instruction (see
   * lib/compressedBurn.ts) instead of the classic burn+close pair.
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
  /**
   * Selected assets that couldn't be burned this run — currently only
   * possible for compressed NFTs, if fetching a Merkle proof for one fails
   * (e.g. it was transferred/burned elsewhere since the list loaded, or the
   * RPC isn't DAS-capable). The rest of the burn still proceeds.
   */
  skipped?: { label: string; reason: string }[];
}
