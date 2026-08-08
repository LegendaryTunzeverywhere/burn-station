import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { connection, buildBurnTransactions } from '../lib/burn';
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
        const { transactions, blockhash, lastValidBlockHeight, totalReclaim, totalFee } =
          await buildBurnTransactions(publicKey, assets);

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
          signatures.map((signature) =>
            connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed'),
          ),
        );

        const res: BurnResult = { signatures, reclaimedLamports: totalReclaim, feeLamports: totalFee };
        setResult(res);
        setStatus('done');
        return res;
      } catch (e: any) {
        setError(e?.message ?? 'Burn failed');
        setStatus('error');
        return null;
      }
    },
    [publicKey, sendTransaction, signAllTransactions],
  );

  return { burn, status, error, result, reset, busy: status !== 'idle' && status !== 'done' && status !== 'error' };
}
