import { useState, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Transaction } from '@solana/web3.js';
import { connection, buildBurnTransactions, confirmSignature } from '../lib/burn';
import type { BurnAsset, BurnResult } from '../lib/types';

type Status = 'idle' | 'building' | 'signing' | 'sending' | 'confirming' | 'done' | 'error';

export function useBurn() {
  const { publicKey, sendTransaction, signTransaction, signAllTransactions } = useWallet();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BurnResult | null>(null);
  // Synchronous re-entrancy lock. `busy` (React state) already disables the burn
  // button in the UI, but state updates aren't visible until the next render —
  // a fast double-tap (common on mobile touchscreens) can fire `burn()` twice
  // before that lands. Solflare specifically only allows one approval dialog
  // at a time and errors ("Missing or invalid parameters") if a second request
  // arrives while the first is still pending, so this guard earns its keep
  // even though the UI-level guard covers most cases already.
  const burningRef = useRef(false);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  const burn = useCallback(
    async (assets: BurnAsset[]): Promise<BurnResult | null> => {
      if (!publicKey || assets.length === 0) return null;
      if (burningRef.current) return null;
      burningRef.current = true;
      setError(null);
      setResult(null);
      try {
        setStatus('building');
        const { transactions, lastValidBlockHeight, totalReclaim, totalFee, skipped } =
          await buildBurnTransactions(publicKey, assets);
        console.info(`[burn] built ${transactions.length} transaction(s); requesting wallet signature`);

        const signatures: string[] = [];

        const broadcast = (tx: Transaction) =>
          connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true, // Skip preflight since rent is reclaimed during tx execution
            maxRetries: 2,
          });

        try {
          if (transactions.length > 1 && signAllTransactions) {
            // One approval for the whole batch when the wallet supports it.
            setStatus('signing');
            const signed = await signAllTransactions(transactions);
            setStatus('sending');
            for (const tx of signed) {
              signatures.push(await broadcast(tx));
            }
          } else if (signTransaction) {
            // Sign ourselves and broadcast with our own connection rather than
            // calling the wallet adapter's sendTransaction(). That convenience
            // method (StandardWalletAdapter.sendTransaction, used by every
            // Wallet Standard wallet incl. Phantom/Solflare/Backpack) derives a
            // "chain" from our RPC URL and throws immediately — before any
            // approval UI even opens, with no error message — if the connected
            // account's self-reported `chains` doesn't include it. That array
            // isn't populated consistently across every mobile wallet session;
            // plain signTransaction skips the check entirely and hands the
            // exact same signed bytes to the exact same broadcast path the
            // batch branch above already uses, so behavior is identical across
            // wallets and platforms instead of depending on this metadata.
            for (const tx of transactions) {
              setStatus('signing');
              const signed = await signTransaction(tx);
              setStatus('sending');
              signatures.push(await broadcast(signed));
            }
          } else {
            // Last resort for a wallet that exposes signAndSendTransaction only.
            for (const tx of transactions) {
              setStatus('sending');
              signatures.push(
                await sendTransaction(tx, connection, { skipPreflight: true, maxRetries: 2 }),
              );
            }
          }
        } catch (signError: any) {
          // Handle user rejection gracefully
          if (/user rejected|rejected/i.test(signError?.message)) {
            throw new Error('Transaction was rejected in your wallet');
          }
          // The chain-mismatch failure described above throws with no message
          // at all, as can a couple of other standard-wallet edge cases — in
          // every one of them the actionable advice is the same.
          if (!signError?.message && /^Wallet(SendTransaction|Account|Config)Error$/.test(signError?.name ?? '')) {
            throw new Error(
              "Your wallet didn't respond to the request. If it's set to a different network than Mainnet, switch to Mainnet and try again.",
            );
          }
          throw signError;
        }

        setStatus('confirming');
        await Promise.all(
          signatures.map((signature) => confirmSignature(signature, lastValidBlockHeight)),
        );

        const res: BurnResult = {
          signatures,
          reclaimedLamports: totalReclaim,
          feeLamports: totalFee,
          skipped: skipped.length > 0 ? skipped : undefined,
        };
        setResult(res);
        setStatus('done');
        return res;
      } catch (e: any) {
        // Solana's useful failure detail lives in `logs`, not `message` (which is
        // often a bare "Transaction simulation failed"). Surface both so a burn
        // that "does nothing" actually tells you why.
        console.error('[burn] failed', e);
        
        let msg = e?.message ?? 'Burn failed';
        
        // Handle common error types with user-friendly messages
        if (/insufficient.*funds/i.test(msg)) {
          msg = 'Insufficient SOL to complete transaction. Please add at least 0.001 SOL to your wallet.';
        } else if (/user.*rejected|user.*declined|rejected.*request/i.test(msg)) {
          msg = 'Transaction was rejected in your wallet.';
        } else if (/blockhash.*not.*found|transaction.*expired/i.test(msg)) {
          msg = 'Transaction expired. Please try again.';
        } else if (/timeout/i.test(msg)) {
          msg = 'Transaction timed out. Please try again.';
        } else if (/429|too many requests|rate.?limit/i.test(msg)) {
          msg = 'The Solana RPC endpoint is rate-limiting requests right now. Wait a few seconds and try again — if this keeps happening, the site needs a dedicated RPC provider instead of the public one.';
        }
        
        // Append logs if available for debugging
        const logs: string[] | undefined = e?.logs;
        if (Array.isArray(logs) && logs.length && import.meta.env.DEV) {
          msg += `\n\n${logs.slice(-4).join('\n')}`;
        }
        
        setError(msg);
        setStatus('error');
        return null;
      } finally {
        burningRef.current = false;
      }
    },
    [publicKey, sendTransaction, signTransaction, signAllTransactions],
  );

  return { burn, status, error, result, reset, busy: status !== 'idle' && status !== 'done' && status !== 'error' };
}
