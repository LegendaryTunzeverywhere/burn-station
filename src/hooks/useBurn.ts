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
          const signed = await signAllTransactions(transactions);
          setStatus('sending');
          for (const tx of signed) {
            const sig = await connection.sendRawTransaction(tx.serialize(), {
              skipPreflight: false,
              preflightCommitment: 'confirmed',
            });
            signatures.push(sig);
          }
        } else {
          for (const tx of transactions) {
            setStatus('sending');
            const sig = await sendTransaction(tx, connection, {
              preflightCommitment: 'confirmed',
            });
            signatures.push(sig);
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
        const logs: string[] | undefined = e?.logs;
        if (Array.isArray(logs) && logs.length) {
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
