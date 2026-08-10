import type { BurnResult } from '../lib/types';
import { fmtSol, shortAddr } from '../lib/format';
import { SOLSCAN_TX } from '../lib/config';

interface Props {
  result: BurnResult | null;
  error: string | null;
  onClose: () => void;
}

export function ResultModal({ result, error, onClose }: Props) {
  if (!result && !error) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {error ? (
          <>
            <h3 className="modal-title error">Burn failed</h3>
            <p className="modal-msg">{error}</p>
          </>
        ) : (
          result && (
            <>
              <h3 className="modal-title success">🔥 Burn complete</h3>
              <p className="modal-msg">
                Reclaimed <strong>{fmtSol(result.reclaimedLamports - result.feeLamports)} SOL</strong> to your
                wallet
                {result.feeLamports > 0 && <> (fee {fmtSol(result.feeLamports)} SOL)</>}.
              </p>
              <div className="modal-sigs">
                {result.signatures.map((sig) => (
                  <a key={sig} href={SOLSCAN_TX(sig)} target="_blank" rel="noreferrer">
                    {shortAddr(sig, 6)} ↗
                  </a>
                ))}
              </div>
              {result.skipped && result.skipped.length > 0 && (
                <div className="modal-skipped">
                  <p className="modal-skipped-title">Couldn't burn {result.skipped.length === 1 ? 'this one' : 'these'}:</p>
                  <ul>
                    {result.skipped.map((s, i) => (
                      <li key={i}>
                        <strong>{s.label}</strong> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )
        )}
        <button className="modal-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
