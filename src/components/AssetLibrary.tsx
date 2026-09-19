import React from 'react';
import { MediaAsset } from '../editor/types';
import { Icon } from './Icon';

interface Props {
  assets: MediaAsset[];
  selectedId: string | null;
  onPreview: (asset: MediaAsset) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

export function AssetLibrary({ assets, selectedId, onPreview, onAdd, onRemove }: Props) {
  return <div className="media-grid" aria-label="素材库">
    {assets.map((asset) => <div className="media-card-shell" key={asset.id} data-asset-id={asset.id}>
      <button type="button" className={`media-card ${selectedId === asset.id ? 'media-card--selected' : ''}`}
        onClick={() => onPreview(asset)} aria-label={`预览素材 ${asset.name}`}>
        <span className="media-card__preview">
          {asset.kind === 'video' ? <video src={asset.sourceUrl} muted preload="metadata" />
            : asset.kind === 'image' ? <img src={asset.sourceUrl} alt="" />
              : <span className="media-card__type-icon"><Icon name="music" size={24} /></span>}
          <span className="media-card__kind">{asset.kind === 'video' ? '视频' : asset.kind === 'audio' ? '音频' : '图片'}</span>
          <span className="media-card__duration">{(asset.durationUs / 1e6).toFixed(1)}s</span>
        </span>
        <span className="media-card__name" title={asset.name}>{asset.name}</span>
      </button>
      <div className="asset-actions">
        <button type="button" onClick={() => onAdd(asset.id)} aria-label={`加入时间轴 ${asset.name}`} title="追加到时间轴末尾"><Icon name="plus" size={13} />加入</button>
        <button type="button" onClick={() => onRemove(asset.id)} aria-label={`移除素材 ${asset.name}`} title="删除素材及其时间轴片段（需确认，可撤销）"><Icon name="trash" size={13} /></button>
      </div>
    </div>)}
  </div>;
}
