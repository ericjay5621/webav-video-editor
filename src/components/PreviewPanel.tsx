import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export function formatTimecode(timeUs: number) {
  const totalCentiseconds = Math.max(0, Math.floor(timeUs / 10000));
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `:${String(centiseconds).padStart(2, '0')}`;
}

interface PreviewPanelProps {
  sourcePreview?: React.ReactNode;
  currentTimeUs: number;
  durationUs: number;
  playing: boolean;
  onCanvasHost: (element: HTMLDivElement | null) => void;
  onTogglePlayback: () => void;
  onSeek: (timeUs: number) => void;
  onNotify: (message: string) => void;
}

export function PreviewPanel(props: PreviewPanelProps) {
  const {
    currentTimeUs,
    durationUs,
    playing,
    onCanvasHost,
    onTogglePlayback,
    onSeek,
    onNotify,
  } = props;
  const previewRootRef = useRef<HTMLElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const updateFullscreen = () => {
      setFullscreen(document.fullscreenElement === previewRootRef.current);
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (previewRootRef.current) {
        await previewRootRef.current.requestFullscreen();
      }
    } catch (error) {
      onNotify((error as Error).message || '浏览器未能进入全屏');
    }
  }, [onNotify]);

  return (
    <section className={`preview-panel ${props.sourcePreview ? 'preview-panel--source' : ''}`} ref={previewRootRef}>
      {props.sourcePreview}
      <div className="preview-stage-wrap">
        <span className="timeline-preview-label">时间轴预览</span>
        <div className="preview-stage" ref={onCanvasHost} />
        <div className="preview-stage-tools" role="group" aria-label="画布显示选项">
          <button
            className="fit-button"
            type="button"
            onClick={() => onNotify('画布已自动适应预览区域')}
          >
            <Icon name="crop" size={13} />
            适应
            <Icon name="chevron-down" size={12} />
          </button>
          <button
            className="aspect-button"
            type="button"
            onClick={() => onNotify('当前画布比例为 16:9')}
          >
            16:9
          </button>
        </div>
      </div>
      <div className="preview-controls">
        <div className="timecode">
          <strong>{formatTimecode(currentTimeUs)}</strong>
          <span>/</span>
          <span>{formatTimecode(durationUs)}</span>
        </div>
        <div className="transport-controls">
          <button
            type="button"
            aria-label="跳到开始"
            onClick={() => onSeek(0)}
          >
            <Icon name="previous" size={18} />
          </button>
          <button
            className="transport-play"
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            onClick={onTogglePlayback}
          >
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <button
            type="button"
            aria-label="跳到结束"
            onClick={() => onSeek(Math.max(0, durationUs - 1000))}
          >
            <Icon name="next" size={18} />
          </button>
        </div>
        <div className="preview-options">
          <button
            type="button"
            aria-label={fullscreen ? '退出全屏预览' : '全屏预览'}
            aria-pressed={fullscreen}
            title={fullscreen ? '退出全屏' : '全屏预览'}
            onClick={toggleFullscreen}
          >
            <Icon name="fullscreen" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
