import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const lamportsToSol = (lamports: number): number => lamports / LAMPORTS_PER_SOL;

export const fmtSol = (lamports: number, dp = 5): string =>
  (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });

export const fmtUsd = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

export const fmtAmount = (n: number): string => {
  if (n === 0) return '0';
  if (n > 0 && n < 0.000001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
};

export const shortAddr = (a: string, n = 4): string =>
  a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
