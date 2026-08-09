import { memo } from 'react';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import type { BurnAsset } from '../lib/types';
import { fmtAmount, fmtSol, fmtUsd, shortAddr } from '../lib/format';

interface Props {
  asset: BurnAsset;
  selected: boolean;
  onToggle: (pubkey: string) => void;
}

const VALUE_WARN_USD = 1;

function AssetRowInner({ asset, selected, onToggle }: Props) {
  const title = asset.name || asset.symbol || shortAddr(asset.mint, 4);
  const isToken2022 = asset.programId === TOKEN_2022_PROGRAM_ID.toBase58();
  const valuable = (asset.valueUsd ?? 0) >= VALUE_WARN_USD;

  return (
    <label className={`asset-row${selected ? ' is-selected' : ''}${asset.isCompressed ? ' is-disabled' : ''}`}>
      <input
        type="checkbox"
        className="asset-check"
        checked={selected}
        disabled={asset.isCompressed}
        onChange={() => onToggle(asset.pubkey)}
      />

      <div className="asset-thumb">
        {asset.image ? (
          <img src={asset.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
        ) : (
          <span className="asset-thumb-fallback">{asset.isNft ? '🖼️' : '🪙'}</span>
        )}
      </div>

      <div className="asset-info">
        <div className="asset-title">
          <span className="asset-name">{title}</span>
          {asset.isNft && <span className="badge badge-nft">NFT</span>}
          {asset.isCompressed && <span className="badge badge-t22">Compressed</span>}
          {isToken2022 && <span className="badge badge-t22">Token-2022</span>}
          {valuable && <span className="badge badge-warn">has value</span>}
        </div>
        <div className="asset-sub">
          <a
            href={`https://solscan.io/token/${asset.mint}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {shortAddr(asset.mint, 4)}
          </a>
          {!asset.isNft && (
            <span>
              · {fmtAmount(asset.uiAmount)} {asset.symbol ?? 'tokens'}
            </span>
          )}
          {asset.isCompressed && <span className="muted"> · no rent to reclaim, burn not supported yet</span>}
        </div>
      </div>

      <div className="asset-figures">
        <div className="asset-value">
          {asset.isNft ? (
            <span className="muted">NFT</span>
          ) : asset.priceUsd != null ? (
            <>
              <span className={valuable ? 'value-warn' : ''}>{fmtUsd(asset.valueUsd)}</span>
              <span className="muted small">{fmtUsd(asset.priceUsd)}/ea</span>
            </>
          ) : (
            <span className="muted">no market</span>
          )}
        </div>

        <div className="asset-rent">
          {asset.isCompressed ? (
            <span className="muted small">—</span>
          ) : (
            <>
              <span className="rent-amount">+{fmtSol(asset.lamports)} SOL</span>
              <span className="muted small">rent back</span>
            </>
          )}
        </div>
      </div>
    </label>
  );
}

export const AssetRow = memo(AssetRowInner);
