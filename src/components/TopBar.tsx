import React from 'react';
import { Icon } from './Icon';

export type SaveStatusKind =
  | 'reading'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'restored'
  | 'error';

export interface SaveStatus {
  kind: SaveStatusKind;
  label: string;
}

interface TopBarProps {
  exporting: boolean;
  exportProgress: number;
  saveState: SaveStatus;
  onExport: () => void;
  onCancelExport: () => void;
  onSaveDraft: () => void;
  onRestoreDraft: () => void;
  onShowShortcuts: () => void;
  shortcutsOpen: boolean;
  onNotify: (message: string) => void;
}

export function TopBar({
  exporting,
  exportProgress,
  saveState,
  onExport,
  onCancelExport,
  onSaveDraft,
  onRestoreDraft,
  onShowShortcuts,
  shortcutsOpen,
  onNotify,
}: TopBarProps) {
  const progressPercent = Math.max(0, Math.min(100, Math.round(exportProgress * 100)));
  const ringCircumference = 40.84;
  const ringOffset = ringCircumference * (1 - progressPercent / 100);
  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">数字人视频剪辑</span>
        <span className="top-divider" />
        <button
          className="top-link"
          type="button"
          onClick={() => onNotify('当前为 WebAV 验证工程，仅保留一个演示草稿')}
        >
          项目列表
        </button>
        <span className="top-link top-link--active">视频编辑</span>
      </div>

      <div className="project-title">
        <span>WebAV 功能验证</span>
        {saveState.kind === 'error' ? (
          <button
            type="button"
            className="save-state save-state--error"
            onClick={onSaveDraft}
            title="重新保存草稿"
          >
            <i aria-hidden="true" />
            {saveState.label}
          </button>
        ) : (
          <span
            className={`save-state save-state--${saveState.kind}`}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {saveState.label}
          </span>
        )}
        <button type="button" className="draft-button" onClick={onSaveDraft}>
          保存草稿
        </button>
        <button type="button" className="draft-button" onClick={onRestoreDraft}>
          恢复草稿
        </button>
      </div>

      <div className="top-actions">
        <button
          className="icon-text-button"
          type="button"
          onClick={onShowShortcuts}
          title="查看快捷键 (?)"
          aria-haspopup="dialog"
          aria-expanded={shortcutsOpen}
        >
          <Icon name="help" size={16} />
          操作指南
        </button>
        <div className={`export-control${exporting ? ' export-control--active' : ''}`}>
          <button
            className="primary-button primary-button--export"
            type="button"
            onClick={onExport}
            disabled={exporting}
            aria-label={exporting ? `导出进度 ${progressPercent}%` : '导出视频'}
          >
            {exporting ? (
              <>
                <svg
                  className="export-progress-ring"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle className="export-progress-ring__track" cx="8" cy="8" r="6.5" />
                  <circle
                    className="export-progress-ring__value"
                    cx="8"
                    cy="8"
                    r="6.5"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <span className="export-progress-value">{progressPercent}%</span>
              </>
            ) : (
              <>
                <Icon name="export" size={16} />
                导出
              </>
            )}
          </button>
          {exporting && (
            <>
              <span className="export-control__divider" aria-hidden="true" />
              <button
                className="export-cancel-button"
                type="button"
                onClick={onCancelExport}
              >
                取消
              </button>
              <span className="visually-hidden" role="status" aria-live="polite">
                导出进度 {progressPercent}%
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
