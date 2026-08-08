/**
 * Turn a wallet-adapter error into a short, human message.
 *
 * The adapter's default behaviour is to console.error the raw error object
 * (and the adapter itself), which is what produces the cryptic
 * `{"error":{},"name":"WalletConnectionError"}` + `_events`/`readyStateChange`
 * blob — most often seen on a browser with NO wallet extension installed, where
 * selecting a wallet in the modal just times out.
 */
export function translateWalletError(err: unknown): string {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name ?? '';
  const message = e?.message ?? '';

  // User dismissed the wallet prompt — expected, not a real failure.
  if (/user rejected|request rejected|rejected the request|user declined/i.test(message)) {
    return 'Connection request was rejected in your wallet.';
  }

  switch (name) {
    case 'WalletNotReadyError':
    case 'WalletNotSelectedError':
    case 'WalletConnectionError':
      return 'Couldn’t reach a Solana wallet. Install Phantom, Solflare, or Backpack on desktop — or open this page inside your wallet app’s built-in browser on mobile — then unlock it and try again.';
    case 'WalletTimeoutError':
      return 'The wallet took too long to respond. Make sure it’s installed and unlocked, then try again.';
    case 'WalletDisconnectedError':
    case 'WalletNotConnectedError':
      return 'Wallet disconnected. Reconnect and try again.';
    case 'WalletSignTransactionError':
      return 'Transaction signing failed or was rejected in your wallet.';
    default:
      return message || name || 'Wallet error. Please try again.';
  }
}
