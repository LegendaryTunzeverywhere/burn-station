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

All browser-facing RPC calls go through the same-origin `/api/rpc` proxy (`api/rpc.ts` on Vercel, a Vite dev-middleware locally) instead of talking to the RPC provider directly — this keeps the RPC URL/API key out of client JS and devtools entirely.

| Variable       | Required | Description |
|----------------|----------|-------------|
| `RPC_URL`      | strongly recommended | **Server-side only** (no `VITE_` prefix — never exposed to the browser). A Solana RPC endpoint. The public one is rate-limited and can't serve NFT images. Use a free [Helius](https://helius.dev) key — it also powers token/NFT names & images via the DAS API. In production, set this in Vercel's Environment Variables, not in a committed file. |
| `VITE_FEE_BPS` | no       | Fee in basis points. `100` = 1% (default). |

The fee-receiving wallet is no longer an env var — it's a public Solana address (not a secret) hardcoded as `FEE_WALLET` in `src/lib/config.ts`.

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
│   ├── config.ts          Env parsing: RPC, fee wallet, fee bps
│   ├── burn.ts            Fetch token accounts + build batched burn+close+fee txs
│   ├── prices.ts          Jupiter price API (fails soft)
│   ├── nfts.ts            DAS getAssetBatch metadata enrichment (fails soft)
│   ├── mobileWallet.ts    Registers Mobile Wallet Adapter on Android (fails soft)
│   ├── walletError.ts     Maps adapter errors to friendly messages
│   ├── walletErrorStore.ts Tiny store bridging provider onError → UI toast
│   ├── format.ts          SOL / USD / address formatting
│   └── types.ts           BurnAsset, BurnResult
├── hooks/
│   ├── useAssets.ts       Load + enrich the connected wallet's assets
│   └── useBurn.ts         Sign / send / confirm burn transactions
└── components/
    ├── AssetRow.tsx       One selectable token/NFT row
    ├── BurnSummary.tsx    Gross SOL / fee / net you receive
    ├── WalletErrorToast.tsx Dismissible wallet-error notice
    └── ResultModal.tsx    Success / error + Solscan links
```

## Wallet support

Wallets are discovered through the [Wallet Standard](https://github.com/wallet-standard/wallet-standard), so any compliant wallet works with no per-wallet code:

- **Desktop** — browser extensions (Phantom, Solflare, Backpack, …) are auto-detected. If none is installed, the landing page shows install links instead of a dead "connect" button.
- **Android** — the [Mobile Wallet Adapter](https://docs.solanamobile.com/mobile-wallet-adapter/web-installation) (MWA) is registered on page load (`lib/mobileWallet.ts`), so a regular mobile browser like Chrome can hand off signing to a locally-installed native wallet app. No extension required.
- **iOS** — MWA local association isn't available, so open the page inside your wallet app's built-in browser (Phantom / Solflare both have one); the injected wallet is picked up automatically.

Adapter errors (e.g. selecting a wallet that isn't actually installed, which otherwise surfaces as a cryptic `WalletConnectionError` timeout) are translated to a plain-language toast instead of being dumped to the console.

## Safety notes

- Assets with a known USD value ≥ $1 are flagged with a **"has value"** badge and highlighted in the summary, so users don't accidentally burn something valuable.
- Empty (zero-balance) accounts are pure rent reclaim — use the **"Select empty"** button to clean them up.
- Every transaction is simulated by the wallet before signing (`preflightCommitment: 'confirmed'`).
- Compressed NFTs (cNFTs) are **not** included — they hold no reclaimable rent.


## Support the Project ☕

If you find Burn Station useful and want to support continued development, consider sending SOL to:

**`4nG1VXAKF4zwPV7LZTFgLtGz8fxy2EDgFsQr9PAYFEjc`**

Your support helps maintain the platform and add new features! 🙏

---

## License

MIT License - feel free to fork and modify!

## Links

- 🌐 **Live App**: [burn-station.vercel.app](https://burn-station.vercel.app)
- 💻 **Source Code**: [GitHub Repository](https://github.com/LegendaryTunzeverywhere/burn-station)
- 🐛 **Issues**: [Report bugs or request features](https://github.com/LegendaryTunzeverywhere/burn-station/issues)

---

**Note**: Phantom wallet may show security warnings because this domain is new. This is a legitimate open-source dApp. We're working on getting officially verified.
