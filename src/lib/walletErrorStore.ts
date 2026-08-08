import { useSyncExternalStore } from 'react';

/**
 * Minimal external store for the most recent wallet error message, so the
 * WalletProvider's `onError` (which lives above the app tree) can push a
 * user-facing message that any component can read. Null = no active error.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const walletErrorStore = {
  set(message: string | null) {
    current = message;
    emit();
  },
  clear() {
    walletErrorStore.set(null);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get() {
    return current;
  },
};

export function useWalletError(): string | null {
  return useSyncExternalStore(walletErrorStore.subscribe, walletErrorStore.get, walletErrorStore.get);
}
