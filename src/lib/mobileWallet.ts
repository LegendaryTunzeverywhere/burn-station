import {
  registerMwa,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
} from '@solana-mobile/wallet-standard-mobile';

/**
 * Register the Solana Mobile Wallet Adapter (MWA) as a Wallet Standard wallet.
 *
 * This is what lets a *regular* mobile browser (e.g. Chrome on Android) sign
 * transactions: the page hands off to a locally-installed native wallet app
 * (Phantom, Solflare, …) via the MWA protocol — no browser extension needed.
 * Once registered it shows up automatically in the wallet-adapter list, so no
 * other wiring changes are required.
 *
 * Local association is only supported on Android today. iOS has no local MWA,
 * so there we skip registration and keep steering users to the wallet app's
 * built-in browser (handled by the no-wallet hero in App.tsx).
 */

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

let registered = false;

export function registerMobileWallet(): void {
  if (registered || !isAndroid()) return;
  registered = true;

  try {
    registerMwa({
      appIdentity: {
        name: 'Burn Station',
        uri: typeof window !== 'undefined' ? window.location.origin : undefined,
        icon: 'favicon.svg', // resolved relative to `uri`
      },
      authorizationCache: createDefaultAuthorizationCache(),
      chains: ['solana:mainnet'],
      chainSelector: createDefaultChainSelector(),
      // Shows a default "wallet not found" modal directing the user to install one.
      onWalletNotFound: createDefaultWalletNotFoundHandler(),
    });
  } catch (e) {
    // Non-fatal: extension wallets still work if MWA fails to register.
    console.warn('[mwa] registration failed', e);
  }
}
