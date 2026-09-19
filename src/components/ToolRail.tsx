import React from 'react';
import { ToolKey } from '../editor/types';
import { Icon, IconName } from './Icon';

const tools: Array<{ key: ToolKey; label: string; icon: IconName }> = [
  { key: 'media', label: '素材', icon: 'media' },
  { key: 'audio', label: '音频', icon: 'music' },
  { key: 'text', label: '文本', icon: 'text' },
  { key: 'subtitle', label: '字幕', icon: 'subtitle' },
  { key: 'sticker', label: '贴纸', icon: 'sticker' },
  { key: 'filter', label: '滤镜', icon: 'filter' },
  { key: 'transition', label: '转场', icon: 'transition' },
  { key: 'effect', label: '智能', icon: 'effect' },
  { key: 'adjust', label: '调节', icon: 'adjust' },
];

interface ToolRailProps {
  activeTool: ToolKey;
  onChange: (tool: ToolKey) => void;
}

export function ToolRail({ activeTool, onChange }: ToolRailProps) {
  return (
    <nav className="tool-rail" aria-label="编辑工具">
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          className={`tool-rail__item ${
            activeTool === tool.key ? 'tool-rail__item--active' : ''
          }`}
          onClick={() => onChange(tool.key)}
        >
          <Icon name={tool.icon} size={21} />
          <span>{tool.label}</span>
        </button>
      ))}
    </nav>
  );
}
