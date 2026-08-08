import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { connection, buildBurnTransactions, confirmSignature } from '../lib/burn';
import type { BurnAsset, BurnResult } from '../lib/types';

type Status = 'idle' | 'building' | 'signing' | 'sending' | 'confirming' | 'done' | 'error';

export function useBurn() {
  const { publicKey, sendTransaction, signAllTransactions } = useWallet();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BurnResult | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  const burn = useCallback(
    async (assets: BurnAsset[]): Promise<BurnResult | null> => {
      if (!publicKey || assets.length === 0) return null;
      setError(null);
      setResult(null);
      try {
        setStatus('building');
        const { transactions, lastValidBlockHeight, totalReclaim, totalFee } =
          await buildBurnTransactions(publicKey, assets);
        console.info(`[burn] built ${transactions.length} transaction(s); requesting wallet signature`);

        const signatures: string[] = [];

        // One approval for the whole batch set when the wallet supports it.
        if (transactions.length > 1 && signAllTransactions) {
          setStatus('signing');
          try {
            const signed = await signAllTransactions(transactions);
            setStatus('sending');
            for (const tx of signed) {
              const sig = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true, // Skip preflight since rent is reclaimed during tx execution
                maxRetries: 2,
              });
              signatures.push(sig);
            }
          } catch (signError: any) {
            // Handle user rejection gracefully
            if (/user rejected|rejected/i.test(signError?.message)) {
              throw new Error('Transaction signing was rejected');
            }
            throw signError;
          }
        } else {
          for (const tx of transactions) {
            setStatus('sending');
            try {
              const sig = await sendTransaction(tx, connection, {
                skipPreflight: true, // Skip preflight since rent is reclaimed during tx execution
                maxRetries: 2,
              });
              signatures.push(sig);
            } catch (sendError: any) {
              // Handle user rejection gracefully
              if (/user rejected|rejected/i.test(sendError?.message)) {
                throw new Error('Transaction was rejected');
              }
              throw sendError;
            }
          }
        }

        setStatus('confirming');
        await Promise.all(
          signatures.map((signature) => confirmSignature(signature, lastValidBlockHeight)),
        );

        const res: BurnResult = { signatures, reclaimedLamports: totalReclaim, feeLamports: totalFee };
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
        }
        
        // Append logs if available for debugging
        const logs: string[] | undefined = e?.logs;
        if (Array.isArray(logs) && logs.length && import.meta.env.DEV) {
          msg += `\n\n${logs.slice(-4).join('\n')}`;
        }
        
        setError(msg);
        setStatus('error');
        return null;
      }
    },
    [publicKey, sendTransaction, signAllTransactions],
  );

  return { burn, status, error, result, reset, busy: status !== 'idle' && status !== 'done' && status !== 'error' };
}
