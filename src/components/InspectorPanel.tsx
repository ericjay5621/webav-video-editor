import React, { useEffect, useRef, useState } from 'react';
import {
  EditorItem,
  MaskConfig,
  PictureAdjustment,
  SpriteProperties,
} from '../editor/types';
import { RangeSlider } from './RangeSlider';

interface InspectorPanelProps {
  item: EditorItem | null;
  properties: SpriteProperties | null;
  onChange: (patch: Partial<SpriteProperties>) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onPictureAdjustmentChange: (patch: Partial<PictureAdjustment>) => void;
  onPictureAdjustmentPreview: (patch: Partial<PictureAdjustment>) => void;
  onPictureAdjustmentCommit: (before: Partial<PictureAdjustment>) => void | Promise<void>;
  onMaskChange: (patch: Partial<MaskConfig>) => void;
  onMaskPreview: (patch: Partial<MaskConfig>) => void;
  onMaskCommit: (before: Partial<MaskConfig>) => void | Promise<void>;
  onCaptureKeyframeStart: () => void;
  onApplyKeyframeEnd: () => void;
}

interface NumberFieldProps {
  label: string;
  value: number;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

function NumberField(props: NumberFieldProps) {
  const { label, value, suffix, min, max, step, onChange } = props;
  const [draftValue, setDraftValue] = useState(String(value));
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitValue = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setDraftValue(String(value));
      return;
    }
    const parsed = Number(draftValue);
    if (!draftValue.trim() || !Number.isFinite(parsed)) {
      setDraftValue(String(value));
      return;
    }
    const nextValue = Math.min(
      max === undefined ? parsed : max,
      Math.max(min === undefined ? parsed : min, parsed),
    );
    setDraftValue(String(nextValue));
    if (nextValue !== value) onChange(nextValue);
  };

  return (
    <label className="number-field">
      <span>{label}</span>
      <span className="number-input-wrap">
        <input
          aria-label={label}
          type="number"
          value={draftValue}
          min={min}
          max={max}
          step={step || 1}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={commitValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelCommitRef.current = true;
              setDraftValue(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

interface RangeNumberControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function RangeNumberControl({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: RangeNumberControlProps) {
  return (
    <span className="range-number-wrap">
      <input
        aria-label={`${label}数值`}
        className="range-number"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

export function InspectorPanel({
  item,
  properties,
  onChange,
  onVolumeChange,
  onPictureAdjustmentChange,
  onPictureAdjustmentPreview,
  onPictureAdjustmentCommit,
  onMaskChange,
  onMaskPreview,
  onMaskCommit,
  onCaptureKeyframeStart,
  onApplyKeyframeEnd,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<'base' | 'picture' | 'audio'>('base');

  useEffect(() => {
    if (item?.kind === 'audio') setTab('audio');
  }, [item?.id]);

  const audioTarget = item?.kind === 'audio' ? item : null;

  if (!item || !properties) {
    return (
      <aside className="inspector-panel">
        <div className="inspector-tabs inspector-tabs--disabled" role="tablist" aria-label="参数分类">
          <button className="inspector-tab inspector-tab--active" type="button" disabled>基础</button>
          <button className="inspector-tab" type="button" disabled>画面</button>
          <button className="inspector-tab" type="button" disabled>音频</button>
        </div>
        <div className="inspector-empty">
          <span className="inspector-empty__shape" />
          <p>选择画布或时间轴中的素材</p>
          <small>选中后可调整以下参数</small>
          <div className="inspector-empty__capabilities" aria-label="可调整参数">
            <span>位置尺寸</span>
            <span>旋转透明度</span>
            <span>时间与速度</span>
            <span>画面调节</span>
            <span>音量</span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs" role="tablist" aria-label="参数分类">
        {(['base', 'picture', 'audio'] as const).map((key) => (
          <button
            aria-controls="inspector-panel-content"
            aria-selected={tab === key}
            key={key}
            role="tab"
            type="button"
            className={`inspector-tab ${tab === key ? 'inspector-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'base' ? '基础' : key === 'picture' ? '画面' : '音频'}
          </button>
        ))}
      </div>

      <div className="inspector-content" id="inspector-panel-content" role="tabpanel">
        <div className="selected-material-name">
          <span>{tab === 'audio' && audioTarget ? '对应音频' : item.kind === 'audio' ? '音频素材' : '当前素材'}</span>
          <strong title={tab === 'audio' && audioTarget ? audioTarget.name : item.name}>
            {tab === 'audio' && audioTarget ? audioTarget.name : item.name}
          </strong>
        </div>

        {tab === 'base' && (
          <>
            {item.kind !== 'audio' && (
              <section className="property-section">
                <h3>位置与大小</h3>
                <div className="field-grid">
                  <NumberField label="X" value={properties.x} onChange={(x) => onChange({ x })} />
                  <NumberField label="Y" value={properties.y} onChange={(y) => onChange({ y })} />
                  <NumberField label="宽" value={properties.width} min={1} onChange={(width) => onChange({ width })} />
                  <NumberField label="高" value={properties.height} min={1} onChange={(height) => onChange({ height })} />
                </div>
                <NumberField
                  label="旋转"
                  value={properties.rotation}
                  suffix="°"
                  min={-360}
                  max={360}
                  onChange={(rotation) => onChange({ rotation })}
                />
              </section>
            )}

            {item.kind !== 'audio' && (
              <section className="property-section">
                <h3>混合</h3>
                <RangeSlider
                  label="不透明度"
                  min={0}
                  max={100}
                  value={properties.opacity}
                  valueText={`${properties.opacity}%`}
                  onChange={(opacity) => onChange({ opacity })}
                />
              </section>
            )}

            <section className="property-section">
              <h3>时间</h3>
              <div className="field-grid">
                <NumberField
                  label="开始"
                  value={properties.start}
                  suffix="秒"
                  min={0}
                  step={0.1}
                  onChange={(start) => onChange({ start })}
                />
                <NumberField
                  label="时长"
                  value={properties.duration}
                  suffix="秒"
                  min={0.1}
                  step={0.1}
                  onChange={(duration) => onChange({ duration })}
                />
              </div>
              <p className="property-commit-help">输入完成后按 Enter 或点击空白处应用。</p>
              <RangeSlider
                defaultValue={1}
                label="速度"
                min={0.5}
                max={2}
                step={0.1}
                value={properties.speed}
                valueText={`${properties.speed.toFixed(1)}x`}
                onChange={(speed) => onChange({ speed })}
              />
            </section>

            {item.kind !== 'audio' && (
              <section className="property-section">
                <div className="property-section__title">
                  <h3>关键帧</h3>
                  {item.keyframeAnimation && <span className="keyframe-status">已应用</span>}
                </div>
                {item.keyframeAnimation && (
                  <div className="keyframe-summary" aria-label="关键帧参数">
                    <span>
                      起点 X {Math.round(item.keyframeAnimation.start.x)} · Y {Math.round(item.keyframeAnimation.start.y)} ·
                      {' '}{Math.round(item.keyframeAnimation.start.width)} × {Math.round(item.keyframeAnimation.start.height)}
                    </span>
                    <span>
                      终点 X {Math.round(item.keyframeAnimation.end.x)} · Y {Math.round(item.keyframeAnimation.end.y)} ·
                      {' '}{Math.round(item.keyframeAnimation.end.width)} × {Math.round(item.keyframeAnimation.end.height)}
                    </span>
                  </div>
                )}
                <p className="keyframe-help">记录起点，调整位置、大小、旋转或透明度，再记录终点。</p>
                <div className="keyframe-actions">
                  <button type="button" onClick={onCaptureKeyframeStart}>
                    ◇ 记录起点
                  </button>
                  <button type="button" onClick={onApplyKeyframeEnd}>
                    ◇ 记录终点并应用
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'picture' && (
          item.kind === 'video' || item.kind === 'image' ? (
            <>
              <section className="property-section">
                <div className="property-section__title">
                  <h3>画面调节</h3>
                  <button
                    type="button"
                    className="property-reset"
                    onClick={() => onPictureAdjustmentChange({
                      brightness: 100,
                      contrast: 100,
                      saturation: 100,
                    })}
                  >
                    重置
                  </button>
                </div>
                {([
                  ['brightness', '亮度'],
                  ['contrast', '对比度'],
                  ['saturation', '饱和度'],
                ] as Array<[keyof PictureAdjustment, string]>).map(([key, label]) => (
                  <RangeSlider
                    defaultValue={100}
                    key={key}
                    label={label}
                    min={0}
                    max={200}
                    snapToDefault
                    value={item.pictureAdjustment[key]}
                    valueText={`${item.pictureAdjustment[key]}%`}
                    valueControl={(
                      <RangeNumberControl
                        label={label}
                        min={0}
                        max={200}
                        suffix="%"
                        value={item.pictureAdjustment[key]}
                        onChange={(nextValue) => onPictureAdjustmentChange({ [key]: nextValue })}
                      />
                    )}
                    onChange={(nextValue) => onPictureAdjustmentPreview({ [key]: nextValue })}
                    onCommit={(_, previousValue) => onPictureAdjustmentCommit({ [key]: previousValue })}
                  />
                ))}
                <div className="range-group-scale" aria-hidden="true">
                  <span>0%</span>
                  <span>原始</span>
                  <span>200%</span>
                </div>
              </section>
              <section className="property-section">
                <div className="property-section__title">
                  <h3>蒙版</h3>
                  {item.mask.type !== 'none' && (
                    <button
                      type="button"
                      className="property-reset"
                      onClick={() => onMaskChange({ type: 'none' })}
                    >
                      重置
                    </button>
                  )}
                </div>
                <div className="mask-options" role="group" aria-label="蒙版形状">
                  {([
                    ['none', '无'],
                    ['circle', '圆形'],
                    ['rounded', '圆角矩形'],
                  ] as Array<[MaskConfig['type'], string]>).map(([type, label]) => (
                    <button
                      type="button"
                      aria-label={`${label}蒙版`}
                      aria-pressed={item.mask.type === type}
                      className={item.mask.type === type ? 'mask-option mask-option--active' : 'mask-option'}
                      key={type}
                      onClick={() => onMaskChange({ type })}
                    >
                      <span className="mask-option__preview" aria-hidden="true">
                        <span className={`mask-option__shape mask-option__shape--${type}`} />
                      </span>
                      <span className="mask-option__label">{label}</span>
                    </button>
                  ))}
                </div>
                {item.mask.type !== 'none' && (
                  <div className="mask-controls">
                    <RangeSlider
                      label="范围"
                      min={20}
                      max={100}
                      value={item.mask.size}
                      valueText={`${item.mask.size}%`}
                      valueControl={(
                        <RangeNumberControl
                          label="蒙版范围"
                          min={20}
                          max={100}
                          suffix="%"
                          value={item.mask.size}
                          onChange={(size) => onMaskChange({ size })}
                        />
                      )}
                      onChange={(size) => onMaskPreview({ size })}
                      onCommit={(_, previousValue) => onMaskCommit({ size: previousValue })}
                    />
                    <RangeSlider
                      label="羽化"
                      min={0}
                      max={30}
                      value={item.mask.feather}
                      valueControl={(
                        <RangeNumberControl
                          label="蒙版羽化"
                          min={0}
                          max={30}
                          value={item.mask.feather}
                          onChange={(feather) => onMaskChange({ feather })}
                        />
                      )}
                      onChange={(feather) => onMaskPreview({ feather })}
                      onCommit={(_, previousValue) => onMaskCommit({ feather: previousValue })}
                    />
                  </div>
                )}
              </section>
              <div className="property-note property-note--inline">
                <span>画面调节与蒙版会同时应用到预览和导出文件。</span>
              </div>
            </>
          ) : (
            <div className="property-note property-note--unavailable">
              <strong>当前素材不支持画面调节</strong>
              <p>请选择视频或图片素材。</p>
              <button type="button" onClick={() => setTab('base')}>返回基础参数</button>
            </div>
          )
        )}

        {tab === 'audio' && (
          audioTarget || (item.kind === 'video' && item.hasAudio) ? (
            <section className="property-section">
              <h3>音量</h3>
              <RangeSlider
                defaultValue={100}
                label="素材音量"
                min={0}
                max={200}
                scaleLabels={['静音', '原始', '+200%']}
                snapToDefault
                value={(audioTarget || item).audioVolume}
                valueText={`${(audioTarget || item).audioVolume}%`}
                onChange={(volume) => onVolumeChange((audioTarget || item).id, volume)}
              />
              <div className={`property-note property-note--inline ${(audioTarget || item).audioVolume > 100 ? 'property-note--warning' : ''}`}>
                <span>
                  {(audioTarget || item).audioVolume > 100
                    ? '增益超过原始音量，导出时可能出现削波。'
                    : '100% 保持原始音量，向左调整可降低音量。'}
                </span>
              </div>
            </section>
          ) : (
            <div className="property-note property-note--unavailable">
              <strong>{item.audioDetached ? '原声已分离' : '当前素材没有音轨'}</strong>
              <p>
                {item.audioDetached
                  ? '请选中独立的“分离原声”片段调整音量或继续编辑。'
                  : item.kind === 'video'
                    ? '该视频文件未检测到声音。'
                    : '请选择带音轨的视频或独立音频。'}
              </p>
              <button type="button" onClick={() => setTab('base')}>返回基础参数</button>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
