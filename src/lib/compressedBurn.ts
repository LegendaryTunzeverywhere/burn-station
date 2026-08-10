import { PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import type { Umi } from '@metaplex-foundation/umi';
import type { DasApiInterface } from '@metaplex-foundation/digital-asset-standard-api';
import { connection } from './burn';
import { COMPUTE_UNIT_LIMIT, PRIORITY_MICRO_LAMPORTS } from './config';
import type { BurnAsset } from './types';

/**
 * A regular token account's rent can be reclaimed with two plain SPL
 * instructions (burn + close) because the account itself IS the thing
 * being closed. A compressed NFT has no account of its own — it's a leaf
 * in a shared Merkle tree owned by the Bubblegum program — so burning one
 * means proving, on-chain, that this exact leaf (owner, data hash,
 * creator hash, position) is really in that tree, via a Merkle proof
 * fetched from a DAS-capable RPC.
 *
 * `getAssetWithProof` does both required DAS calls (`getAsset` +
 * `getAssetProof`) and — with `truncateCanopy: true` — trims the proof
 * down to just the levels NOT already cached on-chain in the tree's
 * canopy, which keeps the resulting instruction (and transaction) small.
 * Reused across calls; the DAS/program-id plumbing has no per-call state.
 *
 * Typed as `Umi & { rpc: ... & DasApiInterface }` explicitly rather than
 * relying on `@metaplex-foundation/digital-asset-standard-api`'s ambient
 * augmentation of `Umi.rpc` — that augmentation only applies within a
 * TypeScript program if something imports the module it lives in, which
 * is fragile to depend on implicitly.
 *
 * `@metaplex-foundation/umi-bundle-defaults` + `mpl-bubblegum` pull in a
 * large dependency chain (merkletreejs, noble hashes, mpl-token-metadata,
 * ...) that most visitors never need — this app works fine for wallets with
 * zero compressed NFTs, which is most of them. All of it is behind a dynamic
 * `import()` here so it's a separate chunk the browser only fetches the
 * first time a compressed NFT is actually burned, not on initial page load.
 */
type DasCapableUmi = Umi & { rpc: Umi['rpc'] & DasApiInterface };

let umiPromise: Promise<DasCapableUmi> | null = null;
async function getUmi(): Promise<DasCapableUmi> {
  if (!umiPromise) {
    umiPromise = (async () => {
      const [{ createUmi }, { mplBubblegum }] = await Promise.all([
        import('@metaplex-foundation/umi-bundle-defaults'),
        import('@metaplex-foundation/mpl-bubblegum'),
      ]);
      // Same-origin /api/rpc proxy the rest of the app already uses — same
      // DAS-capability (or lack of it) applies here too.
      return createUmi(connection).use(mplBubblegum()) as DasCapableUmi;
    })();
  }
  return umiPromise;
}

/**
 * Build the burn transaction for a single compressed NFT. Each one gets its
 * own transaction rather than being batched with others: the instruction's
 * size depends on that specific asset's tree depth and canopy, which varies
 * per collection, so batching several together risks an oversized
 * transaction that fails (or silently needs its assets dropped) in a way a
 * fixed batch size can't predict up front.
 *
 * There is no rent to reclaim here (the tree's rent is shared across every
 * leaf in it, not held per-asset) and no platform fee is charged on this
 * transaction — `burn.ts` only computes fees from classic assets' `lamports`,
 * which is always 0 for a compressed row (see nfts.ts).
 */
export async function buildCompressedBurnTransaction(
  owner: PublicKey,
  asset: BurnAsset,
  blockhash: string,
): Promise<Transaction> {
  const [ctx, { getAssetWithProof, burn: bubblegumBurn }, { createNoopSigner, publicKey: umiPublicKey }, { fromWeb3JsPublicKey, toWeb3JsInstruction }] =
    await Promise.all([
      getUmi(),
      import('@metaplex-foundation/mpl-bubblegum'),
      import('@metaplex-foundation/umi'),
      import('@metaplex-foundation/umi-web3js-adapters'),
    ]);

  // `pubkey` on a compressed BurnAsset row IS the DAS asset id (see
  // fetchCompressedNfts in nfts.ts) — there's no separate token account.
  const assetId = umiPublicKey(asset.pubkey);

  const assetWithProof = await getAssetWithProof(ctx, assetId, { truncateCanopy: true });

  // getAssetWithProof returns leafOwner as a plain PublicKey (whatever DAS
  // reports on-chain). We override it with a Signer wrapping OUR connected
  // wallet so the generated instruction marks that account isSigner: true —
  // the actual signature still comes from the wallet adapter later in
  // useBurn.ts, exactly like every other transaction this app builds. This
  // will only produce a valid instruction if `owner` really is the asset's
  // on-chain leaf owner, which it is here since assets are only ever listed
  // from fetchCompressedNfts(owner) in the first place.
  const builder = bubblegumBurn(ctx, {
    ...assetWithProof,
    leafOwner: createNoopSigner(fromWeb3JsPublicKey(owner)),
  });

  const instructions = builder.getInstructions().map(toWeb3JsInstruction);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));
  for (const ix of instructions) tx.add(ix);
  tx.feePayer = owner;
  tx.recentBlockhash = blockhash;
  return tx;
}
