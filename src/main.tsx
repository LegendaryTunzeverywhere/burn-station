import React, { useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';
import { Analytics } from '@vercel/analytics/react';
import { RPC_URL } from './lib/config';
import { translateWalletError } from './lib/walletError';
import { walletErrorStore } from './lib/walletErrorStore';
import { registerMobileWallet } from './lib/mobileWallet';
import App from './App';
import './index.css';

// Register the Mobile Wallet Adapter (Android) so regular mobile browsers can
// sign via a native wallet app. No-op on desktop/iOS. Must run before render.
registerMobileWallet();

function Root() {
  const endpoint = useMemo(() => RPC_URL, []);
  // Wallet Standard auto-detects Phantom, Solflare, Backpack, etc. — no explicit adapters needed.
  const wallets = useMemo(() => [], []);

  // Handle adapter errors ourselves instead of letting the adapter dump the raw
  // error object to the console (the cryptic `_events`/`readyStateChange` blob).
  const onError = useCallback((err: unknown) => {
    console.warn('[wallet]', err);
    walletErrorStore.set(translateWalletError(err));
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
      <Analytics />
    </ConnectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
