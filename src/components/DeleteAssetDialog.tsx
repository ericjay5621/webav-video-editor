import React, { useEffect, useRef } from 'react';
import { EditorItem, MediaAsset } from '../editor/types';

export interface AssetDeleteRequest {
  asset: MediaAsset;
  items: EditorItem[];
  resolve: (confirmed: boolean) => void;
}

export function DeleteAssetDialog({ request, onClose }: {
  request: AssetDeleteRequest;
  onClose: (confirmed: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const audioCount = request.items.filter((item) => item.kind === 'audio').length;
  return <div className="asset-delete-backdrop">
    <section className="asset-delete-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="asset-delete-title" aria-describedby="asset-delete-description"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onClose(false); }
        if (event.key === 'Tab') {
          event.preventDefault();
          (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
        }
      }}>
      <h2 id="asset-delete-title">确认删除素材？</h2>
      <div id="asset-delete-description">
        <p className="asset-delete-name">{request.asset.name}</p>
        <p>{request.items.length
          ? `将同时删除时间轴中使用该素材的 ${request.items.length} 个片段（其中音频 ${audioCount} 个）。`
          : '该素材尚未添加到时间轴。'}</p>
        {request.items.length > 0 && <p>后续片段将前移，消除本次删除产生的空白；其他片段占用的时段和原有空隙保留。</p>}
        <p>电脑上的原文件不会删除，操作后可撤销。</p>
      </div>
      <footer>
        <button ref={cancelRef} type="button" className="secondary-button" onClick={() => onClose(false)}>取消</button>
        <button ref={confirmRef} type="button" className="primary-button" onClick={() => onClose(true)}>确认删除</button>
      </footer>
    </section>
  </div>;
}
