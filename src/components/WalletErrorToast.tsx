import { useWalletError, walletErrorStore } from '../lib/walletErrorStore';

/**
 * Dismissible toast for wallet-adapter errors (e.g. no wallet installed, or a
 * connection timeout). Reads the shared store the WalletProvider's `onError`
 * writes to. Renders nothing when there is no active error.
 */
export function WalletErrorToast() {
  const message = useWalletError();
  if (!message) return null;

  return (
    <div className="wallet-toast" role="alert">
      <span className="wallet-toast-icon">⚠️</span>
      <span className="wallet-toast-msg">{message}</span>
      <button className="wallet-toast-close" onClick={() => walletErrorStore.clear()} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
