import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  EditorItem,
  TrackControlState,
  TrackKind,
  TrackRowKey,
} from '../editor/types';
import { Icon, IconName } from './Icon';
import { RangeSlider } from './RangeSlider';
import { formatRulerTime, getAudioRows, getTimelineTicks } from './timelineLayout';
import { transitionName } from '../editor/transitions';
import { INSERT_ALIGNMENT_US, insertionBoundary, startsAtInsertion } from '../editor/insertion';
import { InsertionPreview } from './InsertContentDialog';

interface TimelinePanelProps {
  onInsertBefore: (id: string, side?: 'before' | 'after') => void;
  insertionPreview: InsertionPreview | null;
  insertedId: string | null;
  items: EditorItem[];
  selectedId: string | null;
  currentTimeUs: number;
  durationUs: number;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
  onEditTransition: (id: string) => void;
  onSeek: (timeUs: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  trackStates: Record<TrackRowKey, TrackControlState>;
  onToggleTrack: (
    track: TrackRowKey,
    control: keyof TrackControlState,
  ) => void;
  onMove: (id: string, startUs: number) => Promise<void>;
  onTrim: (
    id: string,
    edge: 'start' | 'end',
    startUs: number,
    durationUs: number,
  ) => Promise<void>;
  onImport: (files: FileList) => void;
  onNotify: (message: string) => void;
}

interface TimelineToolButtonProps {
  label: string;
  icon: IconName;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

function TimelineToolButton({
  label,
  icon,
  disabled = false,
  disabledReason,
  onClick,
}: TimelineToolButtonProps) {
  return (
    <span
      className={`timeline-tool ${disabled ? 'timeline-tool--disabled' : ''}`}
      data-tooltip={disabled ? disabledReason : undefined}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={disabled && disabledReason ? `${label}，${disabledReason}` : label}
        onClick={onClick}
      >
        <Icon name={icon} size={17} />{label}
      </button>
    </span>
  );
}

type DragMode = 'move' | 'trim-start' | 'trim-end';

interface TimelineDragState {
  id: string;
  mode: DragMode;
  pointerStartX: number;
  usPerPixel: number;
  originalStartUs: number;
  originalDurationUs: number;
  previewStartUs: number;
  previewDurationUs: number;
  snapTimeUs: number | null;
}

function formatTimelinePoint(timeUs: number) {
  const totalSeconds = Math.max(0, timeUs / 1e6);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatTimelineDelta(deltaUs: number) {
  const value = deltaUs / 1e6;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}s`;
}

function getWaveformBars(item: EditorItem) {
  if (!item.audioWaveform.length) return [];
  const maximumBars = item.kind === 'video' ? 56 : 72;
  if (item.audioWaveform.length <= maximumBars) return item.audioWaveform;
  const grouped: number[] = [];
  for (let index = 0; index < maximumBars; index += 1) {
    const start = Math.floor((index * item.audioWaveform.length) / maximumBars);
    const end = Math.max(start + 1, Math.floor(((index + 1) * item.audioWaveform.length) / maximumBars));
    grouped.push(Math.max(...item.audioWaveform.slice(start, end)));
  }
  return grouped;
}

const trackRows: Array<{
  key: TrackRowKey;
  label: string;
  icon: IconName;
  kinds: TrackKind[];
}> = [
  { key: 'visual', label: '视频 1', icon: 'media', kinds: ['video', 'image'] },
  { key: 'text', label: '文本 1', icon: 'text', kinds: ['text'] },
  { key: 'audio', label: '音频 1', icon: 'music', kinds: ['audio'] },
];

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    onInsertBefore, insertionPreview, insertedId,
    items,
    selectedId,
    currentTimeUs,
    durationUs,
    onSelect,
    onActivate,
    onEditTransition,
    onSeek,
    onSplit,
    onDelete,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onCopy,
    trackStates,
    onToggleTrack,
    onMove,
    onTrim,
    onImport,
    onNotify,
  } = props;
  const timelineRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomFocusRef = useRef<number | null>(null);
  const dragRef = useRef<TimelineDragState | null>(null);
  const didDragRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [emptyDragActive, setEmptyDragActive] = useState(false);
  const [trimAssistId, setTrimAssistId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<TimelineDragState | null>(null);
  const audioRows = useMemo(() => getAudioRows(items), [items]);
  const boundaries = items.map(item => insertionBoundary(items, item.id)!);
  const selectedBoundary = selectedId ? insertionBoundary(items, selectedId) : null;
  const displayRows = [
    ...trackRows.filter((row) => row.key !== 'audio').map((row) => ({ ...row, rowId: row.key, audioItem: undefined as EditorItem | undefined })),
    ...(audioRows.length ? audioRows.map((item, index) => ({
      ...trackRows[2], rowId: item.id, audioItem: item,
      label: `${item.audioLinkId ? '分离原声' : '独立音频'} · ${index + 1}`,
    })) : [{ ...trackRows[2], rowId: 'audio-empty', audioItem: undefined }]),
    ...(insertionPreview?.kind === 'audio' ? [{ ...trackRows[2], rowId: 'insert-audio', audioItem: undefined, label: '待插入音频' }] : []),
  ];
  const safeDuration = Math.max(durationUs, 1e6);
  const tailPaddingUs = Math.min(10e6, Math.max(5e6, safeDuration * 0.1));
  const displayDuration = Math.max(
    safeDuration + tailPaddingUs + (insertionPreview?.durationUs || 0),
    dragPreview
      ? dragPreview.previewStartUs + dragPreview.previewDurationUs + tailPaddingUs
      : 0,
  );

  const ticks = useMemo(() => getTimelineTicks(displayDuration, viewportWidth * zoom), [displayDuration, viewportWidth, zoom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [items.length === 0]);

  useEffect(() => {
    if (zoomFocusRef.current === null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0,
      zoomFocusRef.current / displayDuration * viewportWidth * zoom - viewportWidth * 0.1);
    zoomFocusRef.current = null;
  }, [zoom, displayDuration, viewportWidth]);

  const changeZoom = (value: number, focusUs = currentTimeUs) => {
    zoomFocusRef.current = focusUs;
    setZoom(Math.min(128, Math.max(1, value)));
  };

  const focusSelectedClip = () => {
    const selected = items.find((item) => item.id === selectedId);
    if (!selected || !scrollRef.current) return;
    const nextZoom = Math.min(128, Math.max(1, displayDuration / selected.sprite.time.duration * 0.6));
    changeZoom(nextZoom, selected.sprite.time.offset);
    scrollRef.current.scrollLeft = Math.max(0,
      selected.sprite.time.offset / displayDuration * viewportWidth * nextZoom - viewportWidth * 0.1);
    const row = timelineRef.current?.querySelector(`[data-row-id="${selected.id}"]`);
    const body = bodyRef.current;
    if (row && body) {
      const rowRect = row.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      if (rowRect.top < bodyRect.top) body.scrollTop += rowRect.top - bodyRect.top;
      else if (rowRect.bottom > bodyRect.bottom) body.scrollTop += rowRect.bottom - bodyRect.bottom;
    }
  };

  useEffect(() => {
    if (!insertedId || !scrollRef.current) return;
    const item = items.find(candidate => candidate.id === insertedId);
    if (!item) return;
    scrollRef.current.scrollLeft = Math.max(0, item.sprite.time.offset / displayDuration * viewportWidth * zoom - viewportWidth * 0.15);
    const row = timelineRef.current?.querySelector(`[data-row-id="${item.id}"]`);
    if (row && bodyRef.current) bodyRef.current.scrollTop = (row as HTMLElement).offsetTop;
  }, [insertedId]);

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const progress = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    onSeek(progress * displayDuration);
  };

  const startDrag = (
    event: React.MouseEvent<HTMLElement>,
    item: EditorItem,
    mode: DragMode,
  ) => {
    if (!timelineRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    didDragRef.current = false;
    setTrimAssistId(null);
    onSelect(item.id);

    const row = trackRows.find((candidate) => candidate.kinds.includes(item.kind));
    if (row && trackStates[row.key].locked) {
      onNotify(`${row.label} 已锁定`);
      return;
    }

    const timelineWidth = timelineRef.current.getBoundingClientRect().width;
    const snapTargets: number[] = [0, currentTimeUs];
    items.forEach((candidate) => {
      if (
        candidate.id !== item.id
        && (!row || row.kinds.includes(candidate.kind))
      ) {
        snapTargets.push(candidate.sprite.time.offset);
        snapTargets.push(
          candidate.sprite.time.offset + candidate.sprite.time.duration,
        );
      }
    });
    const initial: TimelineDragState = {
      id: item.id,
      mode,
      pointerStartX: event.clientX,
      usPerPixel: displayDuration / Math.max(timelineWidth, 1),
      originalStartUs: item.sprite.time.offset,
      originalDurationUs: item.sprite.time.duration,
      previewStartUs: item.sprite.time.offset,
      previewDurationUs: item.sprite.time.duration,
      snapTimeUs: null,
    };
    dragRef.current = initial;
    setDragPreview(initial);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const current = dragRef.current;
      if (!current) return;
      if (Math.abs(moveEvent.clientX - current.pointerStartX) >= 3) {
        didDragRef.current = true;
      }
      const deltaUs = (moveEvent.clientX - current.pointerStartX) * current.usPerPixel;
      const minimumDurationUs = 1e5;
      const snapThresholdUs = current.usPerPixel * 8;
      let previewStartUs = current.originalStartUs;
      let previewDurationUs = current.originalDurationUs;
      let snapTimeUs: number | null = null;

      const nearestSnap = (timeUs: number) => {
        let nearest: number | null = null;
        let nearestDistance = snapThresholdUs + 1;
        snapTargets.forEach((target) => {
          const distance = Math.abs(target - timeUs);
          if (distance <= snapThresholdUs && distance < nearestDistance) {
            nearest = target;
            nearestDistance = distance;
          }
        });
        return nearest;
      };

      if (current.mode === 'move') {
        const rawStartUs = Math.max(0, current.originalStartUs + deltaUs);
        const rawEndUs = rawStartUs + current.originalDurationUs;
        const startSnap = nearestSnap(rawStartUs);
        const endSnap = nearestSnap(rawEndUs);
        if (
          startSnap !== null
          && (endSnap === null
            || Math.abs(startSnap - rawStartUs) <= Math.abs(endSnap - rawEndUs))
        ) {
          previewStartUs = startSnap;
          snapTimeUs = startSnap;
        } else if (endSnap !== null) {
          previewStartUs = Math.max(0, endSnap - current.originalDurationUs);
          snapTimeUs = endSnap;
        } else {
          previewStartUs = rawStartUs;
        }
      } else if (current.mode === 'trim-start') {
        const originalEndUs = current.originalStartUs + current.originalDurationUs;
        const rawStartUs = Math.min(
          Math.max(current.originalStartUs + deltaUs, current.originalStartUs),
          originalEndUs - minimumDurationUs,
        );
        const startSnap = nearestSnap(rawStartUs);
        previewStartUs = startSnap !== null
          && startSnap >= current.originalStartUs
          && startSnap <= originalEndUs - minimumDurationUs
          ? startSnap
          : rawStartUs;
        snapTimeUs = previewStartUs === startSnap ? startSnap : null;
        previewDurationUs = originalEndUs - previewStartUs;
      } else {
        const canExtend = item.kind === 'text' || item.kind === 'image';
        const rawDurationUs = Math.max(
          Math.min(
            current.originalDurationUs + deltaUs,
            canExtend ? Number.POSITIVE_INFINITY : current.originalDurationUs,
          ),
          minimumDurationUs,
        );
        const rawEndUs = current.originalStartUs + rawDurationUs;
        const endSnap = nearestSnap(rawEndUs);
        previewDurationUs = endSnap !== null
          && endSnap >= current.originalStartUs + minimumDurationUs
          && (canExtend || endSnap <= current.originalStartUs + current.originalDurationUs)
          ? endSnap - current.originalStartUs
          : rawDurationUs;
        snapTimeUs = current.originalStartUs + previewDurationUs === endSnap
          ? endSnap
          : null;
      }

      const next = {
        ...current,
        previewStartUs,
        previewDurationUs,
        snapTimeUs,
      };
      dragRef.current = next;
      setDragPreview(next);
    };

    const handleMouseUp = async () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDragPreview(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
      if (!current) return;

      const startChanged = Math.abs(
        current.previewStartUs - current.originalStartUs,
      ) >= 1e4;
      const durationChanged = Math.abs(
        current.previewDurationUs - current.originalDurationUs,
      ) >= 1e4;
      if (!startChanged && !durationChanged) return;

      try {
        if (current.mode === 'move') {
          await onMove(current.id, current.previewStartUs);
        } else {
          await onTrim(
            current.id,
            current.mode === 'trim-start' ? 'start' : 'end',
            current.previewStartUs,
            current.previewDurationUs,
          );
        }
      } catch (error) {
        onNotify((error as Error).message);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const moveWithKeyboard = async (
    event: React.KeyboardEvent<HTMLElement>,
    item: EditorItem,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const row = trackRows.find((candidate) => candidate.kinds.includes(item.kind));
    if (row && trackStates[row.key].locked) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    try {
      await onMove(
        item.id,
        Math.max(0, item.sprite.time.offset + direction * 5e5),
      );
    } catch (error) {
      onNotify((error as Error).message);
    }
  };

  const trimWithKeyboard = async (
    event: React.KeyboardEvent<HTMLElement>,
    item: EditorItem,
    edge: 'start' | 'end',
  ) => {
    const shouldTrim =
      (edge === 'start' && event.key === 'ArrowRight') ||
      (edge === 'end' && event.key === 'ArrowLeft');
    if (!shouldTrim) return;
    const row = trackRows.find((candidate) => candidate.kinds.includes(item.kind));
    if (row && trackStates[row.key].locked) return;
    event.preventDefault();
    event.stopPropagation();
    const trimUs = Math.min(5e5, item.sprite.time.duration - 1e5);
    if (trimUs <= 0) return;
    const startUs = edge === 'start'
      ? item.sprite.time.offset + trimUs
      : item.sprite.time.offset;
    try {
      await onTrim(
        item.id,
        edge,
        startUs,
        item.sprite.time.duration - trimUs,
      );
    } catch (error) {
      onNotify((error as Error).message);
    }
  };

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar__left">
          <TimelineToolButton
            label="撤销"
            icon="undo"
            disabled={!canUndo}
            disabledReason="当前没有可撤销的操作"
            onClick={onUndo}
          />
          <TimelineToolButton
            label="重做"
            icon="redo"
            disabled={!canRedo}
            disabledReason="当前没有可重做的操作"
            onClick={onRedo}
          />
          <span className="toolbar-divider" />
          <TimelineToolButton label="在此前插入" icon="plus" disabled={!selectedBoundary}
            disabledReason="请选择一个片段" onClick={() => { if (selectedId) onInsertBefore(selectedId); }} />
          <TimelineToolButton label="在此后插入" icon="plus" disabled={!selectedBoundary}
            disabledReason="请选择一个片段" onClick={() => { if (selectedId) onInsertBefore(selectedId, 'after'); }} />
          <TimelineToolButton
            label="分割"
            icon="split"
            disabled={!selectedId}
            disabledReason="选中一个片段后可用"
            onClick={onSplit}
          />
          <TimelineToolButton
            label="裁剪"
            icon="crop"
            disabled={!selectedId}
            disabledReason="选中一个片段后可用"
            onClick={() => setTrimAssistId(selectedId)}
          />
          <TimelineToolButton
            label="复制"
            icon="copy"
            disabled={!selectedId}
            disabledReason="选中一个片段后可用"
            onClick={onCopy}
          />
          <TimelineToolButton
            label="删除"
            icon="trash"
            disabled={!selectedId}
            disabledReason="选中一个片段后可用"
            onClick={onDelete}
          />
        </div>
        <span className="timeline-toolbar__status">
          {!selectedId
            ? '未选中片段 · 片段操作暂不可用'
            : !canUndo && !canRedo
              ? '当前没有可撤销或重做的操作'
              : '已选中片段 · 可直接拖动与裁剪'}
        </span>
        <div className="timeline-toolbar__right">
          <button type="button" aria-label="放大片段" disabled={!selectedId} onClick={focusSelectedClip}>放大片段</button>
          <button type="button" aria-label="适应全部时间轴" onClick={() => changeZoom(1, 0)}>适应全部</button>
          <button type="button" aria-label="缩小时间轴" onClick={() => changeZoom(zoom / 2)}>
            <Icon name="zoom-out" size={17} />
          </button>
          <div className="timeline-zoom">
            <RangeSlider
              label="时间轴缩放"
              value={Math.log2(zoom)}
              valueText={`${zoom.toFixed(2)}×`}
              defaultValue={0}
              onChange={(value) => changeZoom(Math.pow(2, value))}
              min={0}
              max={7}
              step={0.25}
            />
          </div>
          <button type="button" aria-label="放大时间轴" onClick={() => changeZoom(zoom * 2)}>
            <Icon name="zoom-in" size={17} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div
          className={`timeline-empty ${emptyDragActive ? 'is-drag-over' : ''}`}
          role="region"
          aria-label="空时间轴，可拖入媒体文件"
          onDragEnter={(event) => {
            event.preventDefault();
            setEmptyDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setEmptyDragActive(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setEmptyDragActive(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setEmptyDragActive(false);
            if (event.dataTransfer.files.length > 0) {
              onImport(event.dataTransfer.files);
            }
          }}
        >
          <span className="timeline-empty__icon" aria-hidden="true">
            <Icon name="media" size={23} />
          </span>
          <strong>时间轴还是空的</strong>
          <span>在左侧素材库点击“加入”，或把电脑文件拖到这里</span>
          <small>{emptyDragActive ? '松开即可导入' : '支持视频、音频与图片'}</small>
        </div>
      ) : (
      <div className="timeline-body" ref={bodyRef}>
        <div className="track-labels">
          <div className="track-labels__ruler">
            <span>全部音频</span>
            <button type="button" aria-label={`${trackStates.audio.locked ? '解锁' : '锁定'}全部音频`} aria-pressed={trackStates.audio.locked} onClick={() => onToggleTrack('audio', 'locked')}><Icon name={trackStates.audio.locked ? 'lock' : 'unlock'} size={13} /></button>
            <button type="button" aria-label={`${trackStates.audio.muted ? '取消静音' : '静音'}全部音频`} aria-pressed={trackStates.audio.muted} onClick={() => onToggleTrack('audio', 'muted')}><Icon name={trackStates.audio.muted ? 'volume-off' : 'volume'} size={14} /></button>
          </div>
          {displayRows.map((row) => {
            const state = trackStates[row.key];
            const rowLabel = row.label;
            const stateText = state.locked
              ? '已锁定'
              : row.key === 'audio' && state.muted
                ? '已静音'
                : row.key !== 'audio' && state.hidden
                  ? '已隐藏'
                  : null;
            return (
            <div className={`track-label track-label--${row.key} ${row.audioItem?.id === selectedId ? 'is-linked' : ''}`} key={row.rowId}>
              <span className="track-label__kind-icon" aria-hidden="true">
                <Icon name={row.icon} size={13} />
              </span>
              {row.key === 'audio' ? (
                <button type="button" className="track-label__audio-select" disabled={!row.audioItem}
                  aria-label={row.audioItem ? `选择音轨 ${row.audioItem.name}` : '空音频轨道'}
                  title={row.audioItem ? `${rowLabel}：${row.audioItem.name}` : '导入音频后显示在这里'}
                  onClick={() => { if (row.audioItem) onActivate(row.audioItem.id); }}>
                  <strong>{rowLabel}{row.audioItem ? ` · ${(row.audioItem.sprite.time.duration / 1e6).toFixed(1)}s` : ''}{stateText ? ` · ${stateText}` : ''}</strong>
                  <span>{row.audioItem ? row.audioItem.name : row.rowId === 'insert-audio' ? insertionPreview?.name : '暂无音频'}</span>
                </button>
              ) : <><span
                className={`track-label__name ${stateText ? 'is-state' : ''}`}
                title={stateText ? `${rowLabel} ${stateText}` : rowLabel}
              >
                {stateText || rowLabel}
              </span>
              <button
                type="button"
                className={state.locked ? 'is-active' : ''}
                aria-label={`${state.locked ? '解锁' : '锁定'}${row.label}`}
                onClick={() => onToggleTrack(row.key, 'locked')}
              >
                <Icon name={state.locked ? 'lock' : 'unlock'} size={13} />
              </button>
              <button
                type="button"
                className={state.hidden ? 'is-active' : ''}
                aria-label={`${state.hidden ? '显示' : '隐藏'}${row.label}`}
                onClick={() => onToggleTrack(row.key, 'hidden')}
              >
                <Icon name={state.hidden ? 'eye-off' : 'eye'} size={14} />
              </button></>}
            </div>
          );})}
        </div>

        <div className="timeline-scroll" ref={scrollRef}>
          <div
            className="timeline-content"
            ref={timelineRef}
            style={{ width: `${Math.max(100, zoom * 100)}%` }}
            onClick={handleTimelineClick}
          >
            <div className="timeline-ruler">
              {ticks.map((second) => (
                <span
                  key={second}
                  className="ruler-tick"
                  style={{ left: `${(second * 1e6 * 100) / displayDuration}%` }}
                >
                  {formatRulerTime(second)}
                </span>
              ))}
            </div>

            {displayRows.map((row) => (
              <div
                className={`timeline-track timeline-track--${row.key}`}
                key={row.rowId}
                data-row-id={row.rowId}
                aria-label={row.audioItem ? `${row.label}：${row.audioItem.name}` : row.label}
              >
                {!insertionPreview && boundaries.filter(boundary => row.key === 'audio'
                  ? row.audioItem?.id === boundary.anchorId
                  : items.some(item => item.id === boundary.anchorId && row.kinds.includes(item.kind))).map(boundary => <button
                  type="button" className="timeline-insert-boundary" key={boundary.anchorId}
                  aria-label={`在 ${boundary.anchorName} 前插入内容`}
                  title="在此片段前插入内容" style={{ left: `${boundary.timeUs * 100 / displayDuration}%` }}
                  onMouseDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onInsertBefore(boundary.anchorId); }}>
                  <Icon name="plus" size={14} />
                </button>)}
                {insertionPreview && (row.key === 'visual' || row.rowId === 'insert-audio' || (row.key === 'text' && insertionPreview.kind === 'text')) && <div
                  className={`timeline-insertion-ghost ${row.key === 'visual' && ['audio', 'text'].includes(insertionPreview.kind) ? 'is-empty-visual' : ''}`}
                  style={{ left: `${insertionPreview.timeUs * 100 / displayDuration}%`, width: `${insertionPreview.durationUs * 100 / displayDuration}%` }}>
                  {row.key === 'visual' && insertionPreview.kind === 'audio' ? '音频插入 · 无视频画面' : `待插入 · ${insertionPreview.name}`}
                </div>}
                {items
                  .filter((item) => row.key === 'audio' ? item.id === row.audioItem?.id : row.kinds.includes(item.kind))
                  .map((item) => {
                    const preview = dragPreview?.id === item.id ? dragPreview : null;
                    const trackState = trackStates[row.key];
                    const shifts = insertionPreview && startsAtInsertion(item, insertionPreview.timeUs);
                    const splits = insertionPreview && !shifts
                      && item.sprite.time.offset + item.sprite.time.duration > insertionPreview.timeUs + INSERT_ALIGNMENT_US;
                    const startUs = preview
                      ? preview.previewStartUs
                      : shifts && insertionPreview ? Math.max(item.sprite.time.offset, insertionPreview.timeUs) + insertionPreview.durationUs : item.sprite.time.offset;
                    const duration = preview
                      ? preview.previewDurationUs
                      : splits && insertionPreview ? insertionPreview.timeUs - item.sprite.time.offset : item.sprite.time.duration;
                    const left = (startUs * 100) / displayDuration;
                    const width = (duration * 100) / displayDuration;
                    const originalLeft = (
                      item.sprite.time.offset * 100
                    ) / displayDuration;
                    const originalWidth = (item.sprite.time.duration * 100) / displayDuration;
                    const bubbleTimeUs = preview
                      ? preview.mode === 'trim-start'
                        ? preview.previewStartUs
                        : preview.mode === 'trim-end'
                          ? preview.previewStartUs + preview.previewDurationUs
                          : preview.previewStartUs + preview.previewDurationUs / 2
                      : 0;
                    const bubbleLabel = preview
                      ? preview.mode === 'move'
                        ? `${formatTimelinePoint(preview.originalStartUs)} → ${formatTimelinePoint(preview.previewStartUs)} · ${formatTimelineDelta(preview.previewStartUs - preview.originalStartUs)}`
                        : `时长 ${(preview.previewDurationUs / 1e6).toFixed(1)}s · ${formatTimelineDelta(preview.previewDurationUs - preview.originalDurationUs)}`
                      : '';
                    const waveformBars = getWaveformBars(item);
                    const clipStyle: React.CSSProperties = {
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: item.color,
                      backgroundImage: item.thumbnailUrl
                        ? `linear-gradient(rgba(8, 20, 38, .18), rgba(8, 20, 38, .18)), url("${item.thumbnailUrl}")`
                        : undefined,
                    };
                    return (
                      <React.Fragment key={item.id}>
                      {splits && insertionPreview && <div className="timeline-insertion-ghost" aria-label={`${item.name} 自动分段后半段`}
                        style={{ left: `${(insertionPreview.timeUs + insertionPreview.durationUs) * 100 / displayDuration}%`,
                          width: `${(item.sprite.time.offset + item.sprite.time.duration - insertionPreview.timeUs) * 100 / displayDuration}%` }}>
                        {item.name} · 自动后移
                      </div>}
                      {preview && preview.mode === 'move' && (
                        <div
                          className="timeline-clip__ghost"
                          aria-hidden="true"
                          style={{
                            left: `${originalLeft}%`,
                            width: `${originalWidth}%`,
                          }}
                        />
                      )}
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.kind === 'audio' ? item.audioLinkId ? '分离原声 ' : '独立音频 ' : ''}${item.name} ${(duration / 1e6).toFixed(1)}s`}
                        title={`${item.name} · ${(duration / 1e6).toFixed(1)}s`}
                        data-start-us={startUs}
                        data-end-us={startUs + duration}
                        className={`timeline-clip timeline-clip--${item.kind} ${
                          selectedId === item.id ? 'timeline-clip--selected' : ''
                        } ${trackState.locked ? 'timeline-clip--locked' : ''} ${
                          trackState.hidden || trackState.muted ? 'timeline-clip--disabled' : ''
                        } ${preview ? 'is-dragging' : ''} ${shifts ? 'is-insertion-shift' : ''} ${
                          trimAssistId === item.id ? 'is-trim-active' : ''
                        }`}
                        style={clipStyle}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (didDragRef.current) {
                            didDragRef.current = false;
                            return;
                          }
                          setTrimAssistId(null);
                          onActivate(item.id);
                        }}
                        onMouseDown={(event) => startDrag(event, item, 'move')}
                        onKeyDown={(event) => moveWithKeyboard(event, item)}
                      >
                        <span className="timeline-clip__spine" aria-hidden="true" />
                        {waveformBars.length > 0 && (
                          <span
                            className={`timeline-clip__waveform ${item.kind === 'video' ? 'timeline-clip__waveform--video' : ''}`}
                            aria-hidden="true"
                          >
                            {waveformBars.map((peak, index) => (
                              <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />
                            ))}
                          </span>
                        )}
                        <span
                          className="timeline-clip__handle timeline-clip__handle--start"
                          role="separator"
                          tabIndex={selectedId === item.id ? 0 : -1}
                          aria-label={`裁剪 ${item.name} 左侧`}
                          onMouseDown={(event) => startDrag(event, item, 'trim-start')}
                          onKeyDown={(event) => trimWithKeyboard(event, item, 'start')}
                        />
                        {item.transitionIn && (
                          <button
                            type="button"
                            className="timeline-transition-marker"
                            aria-label={`编辑${transitionName(item.transitionIn.type)}转场 ${(item.transitionIn.durationUs / 1e6).toFixed(1)}秒`}
                            title={`${transitionName(item.transitionIn.type)} ${(item.transitionIn.durationUs / 1e6).toFixed(1)} 秒 · 点击编辑`}
                            onMouseDown={event => event.stopPropagation()}
                            onClick={event => { event.stopPropagation(); onEditTransition(item.id); }}
                            onKeyDown={event => event.stopPropagation()}
                          >
                            <Icon name="transition" size={11} />
                          </button>
                        )}
                        {trackState.locked && (
                          <span className="timeline-clip__lock" title={`${row.label} 已锁定`}>
                            <Icon name="lock" size={11} />
                          </span>
                        )}
                        <span className="timeline-clip__info">
                          {item.kind === 'audio' && (
                            <i className={`timeline-clip__audio-role ${item.audioLinkId ? 'is-original' : 'is-independent'}`}>
                              {item.audioLinkId ? '分离' : '独立'}
                            </i>
                          )}
                          <span className="timeline-clip__name">{item.name}</span>
                          <small>{(duration / 1e6).toFixed(1)}s</small>
                        </span>
                        <span
                          className="timeline-clip__handle timeline-clip__handle--end"
                          role="separator"
                          tabIndex={selectedId === item.id ? 0 : -1}
                          aria-label={`裁剪 ${item.name} 右侧`}
                          onMouseDown={(event) => startDrag(event, item, 'trim-end')}
                          onKeyDown={(event) => trimWithKeyboard(event, item, 'end')}
                        />
                      </div>
                      {preview && (
                        <span
                          className="timeline-drag-bubble"
                          role="status"
                          style={{ left: `${(bubbleTimeUs * 100) / displayDuration}%` }}
                        >
                          {bubbleLabel}
                        </span>
                      )}
                      </React.Fragment>
                    );
                  })}
              </div>
            ))}

            {dragPreview && dragPreview.snapTimeUs !== null && (
              <span
                className="timeline-snap-line"
                aria-hidden="true"
                style={{ left: `${(dragPreview.snapTimeUs * 100) / displayDuration}%` }}
              />
            )}

            <div
              className="timeline-playhead"
              style={{ left: `${(currentTimeUs * 100) / displayDuration}%` }}
            >
              <span>{(currentTimeUs / 1e6).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </div>
      )}
    </section>
  );
}
