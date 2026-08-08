import type { BurnAsset } from '../lib/types';
import { fmtSol, fmtUsd } from '../lib/format';
import { feeFor } from '../lib/burn';
import { FEE_BPS, FEE_ENABLED } from '../lib/config';

interface Props {
  selected: BurnAsset[];
  busy: boolean;
  statusLabel: string;
  onBurn: () => void;
}

export function BurnSummary({ selected, busy, statusLabel, onBurn }: Props) {
  const count = selected.length;
  const nftCount = selected.filter((a) => a.isNft).length;
  const tokenCount = count - nftCount;
  const grossLamports = selected.reduce((s, a) => s + a.lamports, 0);
  const feeLamports = feeFor(grossLamports);
  const netLamports = grossLamports - feeLamports;
  const destroyedUsd = selected.reduce((s, a) => s + (a.valueUsd ?? 0), 0);
  const feePct = (FEE_BPS / 100).toString();

  return (
    <aside className="summary">
      <h2 className="summary-title">Burn summary</h2>

      <div className="summary-row">
        <span>Assets selected</span>
        <strong>{count}</strong>
      </div>
      {count > 0 && (
        <div className="summary-row muted small">
          <span>Breakdown</span>
          <span>
            {tokenCount} token{tokenCount === 1 ? '' : 's'} · {nftCount} NFT{nftCount === 1 ? '' : 's'}
          </span>
        </div>
      )}
      <div className="summary-row">
        <span>SOL rent to reclaim</span>
        <strong>{fmtSol(grossLamports)} SOL</strong>
      </div>
      <div className="summary-row muted">
        <span>Platform fee ({FEE_ENABLED ? `${feePct}% of total` : 'off'})</span>
        <span>−{fmtSol(feeLamports)} SOL</span>
      </div>
      <div className="summary-divider" />
      <div className="summary-row summary-net">
        <span>You receive</span>
        <strong>{fmtSol(netLamports)} SOL</strong>
      </div>

      {(destroyedUsd > 0 || nftCount > 0) && (
        <div className="summary-destroyed">
          You are permanently destroying
          {destroyedUsd > 0 && <> ~{fmtUsd(destroyedUsd)} of tokens</>}
          {destroyedUsd > 0 && nftCount > 0 && ' and'}
          {nftCount > 0 && <> {nftCount} NFT{nftCount === 1 ? '' : 's'}</>}. This cannot be undone.
        </div>
      )}

      <button className="burn-btn" disabled={count === 0 || busy} onClick={onBurn}>
        {busy ? statusLabel : count === 0 ? 'Select assets to burn' : `🔥 Burn ${count} & reclaim SOL`}
      </button>

      <p className="summary-note">
        The {feePct}% fee is charged once on the combined SOL rent of everything selected — tokens and
        NFTs together. Burning is irreversible; nothing is sold, you only receive reclaimed account rent.
      </p>
    </aside>
  );
}
