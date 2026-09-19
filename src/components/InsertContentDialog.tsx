import React, { useEffect, useRef, useState } from 'react';
import { EditorItem, MediaAsset, TextStyle, TrackControlState, TrackRowKey } from '../editor/types';
import { InsertionBoundary, InsertionContent, insertionPlan } from '../editor/insertion';
import { Icon } from './Icon';

export interface InsertionPreview { timeUs: number; durationUs: number; kind: string; name: string }

interface Props {
  boundary: InsertionBoundary;
  items: EditorItem[];
  assets: MediaAsset[];
  trackStates: Record<TrackRowKey, TrackControlState>;
  totalUs: number;
  onImport: (files: File[]) => Promise<MediaAsset[]>;
  onInsert: (content: InsertionContent, unlockTracks: TrackRowKey[]) => Promise<void>;
  onPreview: (preview: InsertionPreview | null) => void;
  onClose: () => void;
}

export function InsertContentDialog({ boundary, items, assets, trackStates, totalUs, onImport, onInsert, onPreview, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [mode, setMode] = useState<'asset' | 'text'>('asset');
  const [assetId, setAssetId] = useState('');
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [duration, setDuration] = useState('12');
  const [style, setStyle] = useState<TextStyle>({ fontSize: 64, color: '#ffffff', bold: true,
    strokeColor: '#000000', backgroundColor: '#00000000' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const asset = assets.find(candidate => candidate.id === assetId);
  const kind = mode === 'text' ? 'text' : asset?.kind;
  const customDuration = kind === 'image' || kind === 'text';
  const durationUs = customDuration ? Math.round(Number(duration) * 1e6) : asset?.durationUs || 0;
  const plan = insertionPlan(items, boundary, durationUs);
  const track = kind === 'text' ? 'text' : kind === 'audio' ? 'audio' : 'visual';
  const state = trackStates[track];
  const unlockTracks = (['visual', 'audio', 'text'] as TrackRowKey[]).filter(key =>
    (key === track && trackStates[key].locked) || plan.locked.some(item =>
      (item.kind === 'audio' ? 'audio' : item.kind === 'text' ? 'text' : 'visual') === key));
  const contentReason = mode === 'text' && !text.trim() ? '请输入文字内容'
    : mode === 'asset' && !asset ? '请选择一个素材'
      : plan.reason;
  const visible = !state.hidden && !state.muted;
  const label = mode === 'text' ? text.trim() : asset?.name || '';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { mountedRef.current = false; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const media = mediaRef.current;
    return () => { if (media) { media.pause(); media.removeAttribute('src'); media.load(); } };
  }, [assetId, mode]);
  useEffect(() => {
    onPreview(!contentReason ? { timeUs: boundary.timeUs, durationUs, kind: kind!, name: label } : null);
    return () => onPreview(null);
  }, [contentReason, boundary.timeUs, durationUs, kind, label, onPreview]);

  const choose = (selected: MediaAsset) => {
    setMode('asset'); setAssetId(selected.id); setDuration('12'); setError('');
  };
  const importFile = async (file?: File) => {
    if (!file || pendingRef.current) return;
    pendingRef.current = true; setBusy('正在导入素材…'); setError('');
    try { const imported = await onImport([file]); if (mountedRef.current && imported[0]) choose(imported[0]); }
    catch (err) { if (mountedRef.current) setError((err as Error).message); }
    finally { pendingRef.current = false; if (mountedRef.current) setBusy(''); }
  };
  const submit = async () => {
    if (pendingRef.current || contentReason) return;
    pendingRef.current = true; setBusy('正在插入…'); setError(''); mediaRef.current?.pause();
    try {
      await onInsert(mode === 'text' ? { type: 'text', text, style, durationUs, visible }
        : { type: 'asset', assetId, durationUs: customDuration ? durationUs : undefined, visible }, unlockTracks);
    } catch (err) { if (mountedRef.current) setError((err as Error).message); }
    finally { pendingRef.current = false; if (mountedRef.current) setBusy(''); }
  };

  return <div className="insert-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !pendingRef.current) onClose();
  }}>
    <section className="insert-dialog" ref={dialogRef} role="dialog" aria-modal="true"
      aria-labelledby="insert-title" aria-describedby="insert-location" aria-busy={Boolean(busy)}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); if (!pendingRef.current) onClose(); }
        if (event.key === 'Tab') {
          const controls = Array.from(dialogRef.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled):not([type="file"]),textarea:not(:disabled),select:not(:disabled),video[controls],audio[controls]'));
          const first = controls[0]; const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><h2 id="insert-title">插入内容</h2><p id="insert-location">在 <strong>{boundary.anchorName}</strong> {boundary.side === 'after' ? '后' : '前'}插入 · {(boundary.timeUs / 1e6).toFixed(2)} 秒</p></div></header>
      <div className="insert-body">
        <div className="insert-tabs" role="group" aria-label="插入内容来源">
          <button disabled={Boolean(busy)} aria-pressed={mode === 'asset'} onClick={() => { setMode('asset'); setDuration('12'); setError(''); }}>已导入素材</button>
          <button disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>本地文件</button>
          <button disabled={Boolean(busy)} aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setDuration('5'); setError(''); }}>新建文字</button>
          <input hidden type="file" ref={inputRef} accept="video/mp4,audio/*,image/*" aria-label="选择要插入的本地文件"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} />
        </div>
        <fieldset disabled={Boolean(busy)}>
          {mode === 'asset' ? <>
            <input aria-label="搜索插入素材" placeholder="搜索素材" value={query} onChange={event => setQuery(event.target.value)} />
            <div className="insert-assets" role="group" aria-label="选择插入素材">
              {assets.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).map(item => <button
                key={item.id} type="button" className={assetId === item.id ? 'is-selected' : ''}
                aria-pressed={assetId === item.id} title={item.name} onClick={() => choose(item)}>
                <Icon name={item.kind === 'audio' ? 'music' : item.kind === 'image' ? 'image' : 'media'} size={18} />
                <span>{item.name}</span><small>{(item.durationUs / 1e6).toFixed(1)}s</small>
              </button>)}
              {!assets.length && <p>暂无素材，请选择“本地文件”。</p>}
              {assets.length > 0 && !assets.some(item => item.name.toLowerCase().includes(query.toLowerCase())) && <p>没有匹配的素材。</p>}
            </div>
            {asset && <div className="insert-source" key={asset.id}>
              {asset.kind === 'image' ? <img src={asset.sourceUrl} alt={asset.name} />
                : asset.kind === 'video' ? <video ref={node => { mediaRef.current = node; }} src={asset.sourceUrl} controls preload="metadata" />
                  : <audio ref={node => { mediaRef.current = node; }} src={asset.sourceUrl} controls preload="metadata" />}
              <small>仅预览所选素材，插入位置保持不变。</small>
            </div>}
          </> : <>
            <label>文字内容<textarea aria-label="插入文字内容" value={text} onChange={event => setText(event.target.value)} placeholder="输入需要显示的文字" /></label>
            <div className="insert-text-style">
              <label>字号<input aria-label="插入文字字号" type="number" min={24} max={120} value={style.fontSize}
                onChange={event => setStyle({ ...style, fontSize: Math.min(120, Math.max(24, Number(event.target.value))) })} /></label>
              <label>颜色<input aria-label="插入文字颜色" type="color" value={style.color} onChange={event => setStyle({ ...style, color: event.target.value })} /></label>
              <label>描边<input aria-label="插入文字描边" type="color" value={style.strokeColor} onChange={event => setStyle({ ...style, strokeColor: event.target.value })} /></label>
              <label><input type="checkbox" checked={style.bold} onChange={event => setStyle({ ...style, bold: event.target.checked })} />加粗</label>
              <label><input type="checkbox" checked={style.backgroundColor !== '#00000000'} onChange={event => setStyle({ ...style, backgroundColor: event.target.checked ? '#000000' : '#00000000' })} />背景</label>
              {style.backgroundColor !== '#00000000' && <input aria-label="插入文字背景颜色" type="color" value={style.backgroundColor} onChange={event => setStyle({ ...style, backgroundColor: event.target.value })} />}
            </div>
          </>}
          {customDuration && <label className="insert-duration">显示时长（秒）<input aria-label="插入时长（秒）" type="number" min="0.1" step="0.1" value={duration} onChange={event => setDuration(event.target.value)} /></label>}
        </fieldset>
      </div>
      <div className="insert-feedback">
        {!contentReason && <div className="insert-summary" role="status">
          <strong>插入{customDuration ? ' ' : '约 '}{(durationUs / 1e6).toFixed(2)} 秒，后续内容自动后移。可撤销。</strong>
          {plan.crossing.length > 0 && <p>跨过此处的片段会自动分段，保留全部内容。</p>}
          {plan.transitions.length > 0 && <p>此处转场将自动解除，可随插入操作一起撤销。</p>}
        </div>}
        {(kind === 'audio' || kind === 'text') && <p className="insert-note">{kind === 'audio' ? '插入期间播放音频，画面显示画布背景。' : '插入期间，文字显示在画布背景上。'}</p>}
        {!visible && <p className="insert-note">目标轨道当前已{kind === 'audio' ? '静音' : '隐藏'}，新片段会继承该状态。</p>}
        {unlockTracks.length > 0 && <p className="insert-note">确认后将解锁相关轨道并插入内容。</p>}
        {(error || contentReason) && <p className="insert-error" role={error ? 'alert' : 'status'}>{error || contentReason}</p>}
      </div>
      <footer><button ref={cancelRef} type="button" className="secondary-button" disabled={Boolean(busy)} onClick={onClose}>取消</button>
        <button type="button" className="primary-button" disabled={Boolean(contentReason || busy)} onClick={() => void submit()}>{busy || (unlockTracks.length ? '解锁并插入' : '确认插入')}</button></footer>
    </section>
  </div>;
}
