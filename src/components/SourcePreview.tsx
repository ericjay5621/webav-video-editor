import React, { useLayoutEffect, useRef, useState } from 'react';
import { MediaAsset } from '../editor/types';

export function SourcePreview({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const media = mediaRef.current;
    return () => {
      // Stop the old source synchronously on switch/exit, including pending play().
      if (media) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    };
  }, [asset.id]);
  return <section className="source-preview" aria-label="素材预览" data-preview-asset={asset.id}>
    <div className="source-preview__heading"><span>素材预览 · {asset.name}</span>
      <button type="button" onClick={onClose}>返回时间轴</button></div>
    <div className="source-preview__body">
      {asset.kind === 'image' ? <img src={asset.sourceUrl} alt={asset.name} />
        : asset.kind === 'video' ? <video ref={(el) => { mediaRef.current = el; }} src={asset.sourceUrl} controls playsInline preload="metadata" onError={() => setFailed(true)} />
          : <><p>{asset.name}</p><audio ref={(el) => { mediaRef.current = el; }} src={asset.sourceUrl} controls preload="metadata" onError={() => setFailed(true)} /></>}
      {failed && <p role="alert">浏览器无法预览此素材，请检查文件格式。</p>}
    </div>
    <p className="source-preview__hint">仅预览当前素材，不参与时间轴播放。加入时间轴后可编辑和导出。</p>
  </section>;
}
