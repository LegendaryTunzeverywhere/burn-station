import { useMemo, useState, useCallback, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useAssets } from './hooks/useAssets';
import { useBurn } from './hooks/useBurn';
import { AssetRow } from './components/AssetRow';
import { BurnSummary } from './components/BurnSummary';
import { ResultModal } from './components/ResultModal';
import { WalletErrorToast } from './components/WalletErrorToast';
import { FEE_BPS } from './lib/config';
import type { BurnAsset } from './lib/types';

type Tab = 'tokens' | 'nfts';

const STATUS_LABEL: Record<string, string> = {
  building: 'Building transaction…',
  signing: 'Approve in your wallet…',
  sending: 'Sending…',
  confirming: 'Confirming…',
};

export default function App() {
  const { connected, wallets } = useWallet();
  const { assets, loading, error: loadError, refresh } = useAssets();
  const { burn, status, error: burnError, result, reset, busy } = useBurn();

  // Wallet Standard populates `wallets` with every detected wallet. Empty means
  // no Solana wallet is installed in this browser (e.g. plain Chrome).
  const hasWallet = wallets.length > 0;

  const [tab, setTab] = useState<Tab>('tokens');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Asks the /api/rpc proxy (server-side) whether the configured upstream RPC
  // is DAS-capable, rather than sniffing the RPC URL client-side — the URL
  // itself is never sent to the browser now.
  const [dasCapable, setDasCapable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/rpc')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDasCapable(!!d.dasCapable);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tokens = useMemo(() => assets.filter((a) => !a.isNft), [assets]);
  const nfts = useMemo(() => assets.filter((a) => a.isNft), [assets]);
  const visible = tab === 'tokens' ? tokens : nfts;

  const selectedAssets = useMemo(
    () => assets.filter((a) => selected.has(a.pubkey)),
    [assets, selected],
  );

  const toggle = useCallback((pubkey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(pubkey) ? next.delete(pubkey) : next.add(pubkey);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((a) => next.add(a.pubkey));
      return next;
    });
  }, [visible]);

  const selectEmpty = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.filter((a) => a.uiAmount === 0).forEach((a) => next.add(a.pubkey));
      return next;
    });
  }, [visible]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const doBurn = useCallback(async () => {
    const res = await burn(selectedAssets);
    if (res) {
      setSelected(new Set());
      refresh();
    }
  }, [burn, selectedAssets, refresh]);

  const closeModal = useCallback(() => reset(), [reset]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">🔥</span>
          <div>
            <h1>Burn Station</h1>
            <p className="brand-tag">Burn dead tokens &amp; NFTs · reclaim locked SOL</p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      {!dasCapable && (
        <div className="config-banner">
          <span>ℹ️ Using a non-DAS RPC — token/NFT names &amp; images may be limited.</span>
        </div>
      )}

      <div className="config-banner" style={{ background: '#1a2808', color: '#b5f089', borderColor: '#2a3f0f' }}>
        <span>⚠️ Phantom may show security warnings because this domain is new. This is a legitimate open-source dApp (<a href="https://github.com/LegendaryTunzeverywhere/burn-station" target="_blank" rel="noreferrer" style={{ color: '#b5f089', textDecoration: 'underline' }}>view source</a>). We're working on official verification.</span>
      </div>

      <main className="content">
        {!connected ? (
          <section className="hero">
            <div className="hero-flame">🔥</div>
            <h2>Turn dead tokens into SOL</h2>
            <p>
              Every token account on Solana locks ~0.002 SOL in rent. Burn the worthless dust and
              NFTs cluttering your wallet and reclaim that SOL — minus a {FEE_BPS / 100}% fee.
            </p>
            {hasWallet ? (
              <>
                <WalletMultiButton />
                <p className="hero-note">Non-custodial. You sign every transaction. We never touch your keys.</p>
              </>
            ) : (
              <div className="hero-install">
                <p className="hero-install-title">No Solana wallet detected in this browser</p>
                <div className="install-links">
                  <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Phantom</a>
                  <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>
                  <a href="https://backpack.app/downloads" target="_blank" rel="noreferrer">Backpack</a>
                </div>
                <p className="hero-note">
                  Install one of these extensions and reload — or on mobile, open this page inside your
                  wallet app’s built-in browser.
                </p>
              </div>
            )}
          </section>
        ) : (
          <div className="workspace">
            <section className="list-panel">
              <div className="tabs">
                <button className={tab === 'tokens' ? 'tab active' : 'tab'} onClick={() => setTab('tokens')}>
                  Tokens <span className="tab-count">{tokens.length}</span>
                </button>
                <button className={tab === 'nfts' ? 'tab active' : 'tab'} onClick={() => setTab('nfts')}>
                  NFTs <span className="tab-count">{nfts.length}</span>
                </button>
                <div className="tab-spacer" />
                <button className="link-btn" onClick={refresh} disabled={loading}>
                  ↻ Refresh
                </button>
              </div>

              <div className="list-actions">
                <button className="chip" onClick={selectAllVisible} disabled={visible.length === 0}>
                  Select all
                </button>
                <button className="chip" onClick={selectEmpty} disabled={visible.length === 0}>
                  Select empty
                </button>
                <button className="chip" onClick={clearSelection} disabled={selected.size === 0}>
                  Clear ({selected.size})
                </button>
              </div>

              {loading ? (
                <div className="state-msg">Loading your assets…</div>
              ) : loadError ? (
                <div className="state-msg error">{loadError}</div>
              ) : visible.length === 0 ? (
                <div className="state-msg">
                  {tab === 'nfts' ? (
                    <>
                      <p>No NFTs found in this wallet.</p>
                      {!dasCapable && (
                        <p className="small muted">
                          This RPC can't read NFT metadata, so NFT names &amp; images may be
                          limited. Compressed NFTs also require a DAS-capable RPC.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>No tokens found in this wallet.</p>
                  )}
                </div>
              ) : (
                <div className="asset-list">
                  {visible.map((a: BurnAsset) => (
                    <AssetRow key={a.pubkey} asset={a} selected={selected.has(a.pubkey)} onToggle={toggle} />
                  ))}
                </div>
              )}
            </section>

            <BurnSummary
              selected={selectedAssets}
              busy={busy}
              statusLabel={STATUS_LABEL[status] ?? 'Working…'}
              onBurn={doBurn}
            />
          </div>
        )}
      </main>

      <footer className="footer">
        <span>Burn Station · non-custodial · {FEE_BPS / 100}% platform fee</span>
      </footer>

      <ResultModal result={result} error={burnError} onClose={closeModal} />
      <WalletErrorToast />
    </div>
  );
}
