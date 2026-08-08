# 🔥 Burn Station

A **non-custodial** Solana web app to burn worthless SPL tokens, Token-2022 tokens, and NFTs, and reclaim the SOL rent locked in each token account.

This is the web version of the original `burn.js` / `burn2022.js` CLI scripts. The critical difference: **it never sees a private key.** Users connect their own wallet (Phantom, Solflare, Backpack, …) and sign every transaction themselves.

## How it works

Every SPL token account on Solana locks ~0.00204 SOL as rent-exempt reserve. When you burn the token balance to zero and **close** the account, that rent is returned to you. Burn Station:

1. Lists every token / Token-2022 / NFT account in the connected wallet (including empty dust accounts).
2. Shows each asset's price (via Jupiter), USD value being destroyed, and exact SOL rent you'll reclaim.
3. Builds `burn` + `closeAccount` instructions, batched into transactions.
4. Takes a **1% platform fee** of the reclaimed rent, sent atomically to your fee wallet in the same transaction.
5. Returns the remaining ~99% of the rent to the user.

> ⚠️ Burning is irreversible. Tokens are destroyed on-chain — nothing is sold. The only value returned is the account rent (SOL).

## Setup

```bash
cp .env.example .env      # then edit .env (see below)
npm install
npm run dev               # local dev server
```

### `.env` configuration

| Variable          | Required | Description |
|-------------------|----------|-------------|
| `VITE_RPC_URL`    | strongly recommended | A Solana RPC endpoint. The public one is rate-limited and can't serve NFT images. Use a free [Helius](https://helius.dev) key — it also powers token/NFT names & images via the DAS API. |
| `VITE_FEE_WALLET` | **yes**  | Base58 address that receives the 1% platform fee. If unset, the fee is skipped and a warning is shown. |
| `VITE_FEE_BPS`    | no       | Fee in basis points. `100` = 1% (default). |

## Build & deploy

```bash
npm run build            # outputs static site to dist/
npm run preview          # preview the production build
```

`dist/` is a static bundle — deploy to Vercel, Netlify, Cloudflare Pages, or GitHub Pages. Set the same `VITE_*` env vars in your host's dashboard.

### Termux / Android note

Building on Termux requires Rollup's WASM build (native `.node` binaries can't be loaded under Termux's linker namespace). This is already wired up via the `overrides` field in `package.json`, so `npm run build` works on-device. On normal Linux/macOS/CI the override is harmless.

## Architecture

```
src/
├── main.tsx              Wallet-adapter providers (ConnectionProvider / WalletProvider)
├── App.tsx              Layout, tabs, selection state, burn orchestration
├── lib/
│   ├── config.ts        Env parsing: RPC, fee wallet, fee bps
│   ├── burn.ts          Fetch token accounts + build batched burn+close+fee txs
│   ├── prices.ts        Jupiter price API (fails soft)
│   ├── nfts.ts          DAS getAssetBatch metadata enrichment (fails soft)
│   ├── format.ts        SOL / USD / address formatting
│   └── types.ts         BurnAsset, BurnResult
├── hooks/
│   ├── useAssets.ts     Load + enrich the connected wallet's assets
│   └── useBurn.ts       Sign / send / confirm burn transactions
└── components/
    ├── AssetRow.tsx     One selectable token/NFT row
    ├── BurnSummary.tsx  Gross SOL / fee / net you receive
    └── ResultModal.tsx  Success / error + Solscan links
```

## Safety notes

- Assets with a known USD value ≥ $1 are flagged with a **"has value"** badge and highlighted in the summary, so users don't accidentally burn something valuable.
- Empty (zero-balance) accounts are pure rent reclaim — use the **"Select empty"** button to clean them up.
- Every transaction is simulated by the wallet before signing (`preflightCommitment: 'confirmed'`).
- Compressed NFTs (cNFTs) are **not** included — they hold no reclaimable rent.
