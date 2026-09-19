import React, { useEffect, useRef, useState } from 'react';
import {
  EditorItem,
  MediaAsset,
  SceneAnalysisResult,
  TextStyle,
  ToolKey,
  TransitionType,
} from '../editor/types';
import { TRANSITIONS, transitionLimits, transitionName } from '../editor/transitions';
import { ColorPicker, SelectionCheckbox, ToggleSwitch } from './FormControls';
import { Icon } from './Icon';
import { RangeSlider } from './RangeSlider';
import { AssetLibrary } from './AssetLibrary';

interface MediaPanelProps {
  activeTool: ToolKey;
  items: EditorItem[];
  assets: MediaAsset[];
  previewAssetId: string | null;
  onPreviewAsset: (asset: MediaAsset) => void;
  onAddAsset: (id: string) => void;
  onRemoveAsset: (id: string) => void;
  selectedId: string | null;
  textValue: string;
  textStyle: TextStyle;
  onTextChange: (value: string) => void;
  onTextStyleChange: (patch: Partial<TextStyle>) => void;
  onAddText: () => void;
  onUpdateText: () => void;
  subtitleValue: string;
  onSubtitleChange: (value: string) => void;
  onGenerateSubtitles: () => void;
  onApplyTransition: (type: TransitionType, durationSeconds: number) => Promise<void>;
  onRemoveTransition: () => Promise<void>;
  sceneAnalysis: SceneAnalysisResult | null;
  selectedSceneCutUs: number[];
  sceneAnalyzing: boolean;
  onAnalyzeScenes: () => void;
  onToggleSceneCut: (timeUs: number) => void;
  onPreviewSceneCut: (timeUs: number) => void;
  onApplySceneCuts: () => void;
  onImport: (files: FileList) => void;
  onExtractAudio: (id: string) => void;
  onSelect: (id: string) => void;
  onNotify: (message: string) => void;
}

const toolDescriptions: Record<Exclude<ToolKey, 'media' | 'audio' | 'text'>, string> = {
  subtitle: '字幕识别依赖语音转写服务，当前 Demo 保留接入位置。',
  sticker: '贴纸素材库属于业务资源，当前 Demo 暂未接入。',
  filter: 'WebAV 可通过帧拦截器扩展滤镜，当前阶段验证基础剪辑链路。',
  transition: '转场需要相邻素材过渡算法，列入下一阶段。',
  effect: '浏览器本地分析画面变化并生成候选切点。',
  adjust: '基础位置、尺寸、旋转和透明度请在右侧参数区调整。',
};

const toolNames: Record<ToolKey, string> = {
  media: '素材',
  audio: '音频',
  text: '文本',
  subtitle: '字幕',
  sticker: '贴纸',
  filter: '滤镜',
  transition: '转场',
  effect: '智能工具',
  adjust: '调节',
};

export function MediaPanel(props: MediaPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const {
    activeTool,
    items,
    selectedId,
    textValue,
    textStyle,
    onTextChange,
    onTextStyleChange,
    onAddText,
    onUpdateText,
    subtitleValue,
    onSubtitleChange,
    onGenerateSubtitles,
    onApplyTransition,
    onRemoveTransition,
    sceneAnalysis,
    selectedSceneCutUs,
    sceneAnalyzing,
    onAnalyzeScenes,
    onToggleSceneCut,
    onPreviewSceneCut,
    onApplySceneCuts,
    onImport,
    onExtractAudio,
    onSelect,
    onNotify,
  } = props;
  const [transitionDuration, setTransitionDuration] = useState(1);
  const [transitionDurationDraft, setTransitionDurationDraft] = useState('1.0');
  const [transitionType, setTransitionType] = useState<TransitionType>('crossfade');
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [mediaDragActive, setMediaDragActive] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const selectedText = items.find(
    (item) => item.id === selectedId && item.kind === 'text',
  );
  const subtitleItems = items.filter((item) => item.isSubtitle);
  const selectedVideo = items.find(
    (item) => item.id === selectedId && item.kind === 'video',
  );
  const audioItems = items.filter((item) => item.kind === 'audio');
  const selectedVideoAudios = selectedVideo?.audioLinkId
    ? audioItems.filter((item) => item.audioLinkId === selectedVideo.audioLinkId)
    : [];
  const selectedVideoAudio = selectedVideoAudios[0];
  const displayedAudioItems = selectedVideo
    ? selectedVideoAudios
    : audioItems;
  const selectedTransitionTarget = items.find(
    (item) => item.id === selectedId && (item.kind === 'video' || item.kind === 'image'),
  );
  const visualItems = items
    .filter((item) => item.kind === 'video' || item.kind === 'image')
    .sort((left, right) => left.sprite.time.offset - right.sprite.time.offset);
  const selectedTransitionIndex = visualItems.findIndex(
    (item) => item.id === selectedTransitionTarget?.id,
  );
  const transitionSource = selectedTransitionIndex > 0
    ? visualItems[selectedTransitionIndex - 1]
    : null;
  const transitionAvailability = transitionLimits(transitionSource, selectedTransitionTarget);
  const transitionMaxDuration = Math.max(0.1, transitionAvailability.max);
  const textPreviewMedia = items.find(
    (item) => item.kind === 'video' || item.kind === 'image',
  );
  const normalizedMediaSearch = mediaSearch.trim().toLocaleLowerCase('zh-CN');
  const filteredMediaItems = props.assets.filter((asset) =>
    asset.name.toLocaleLowerCase('zh-CN').includes(normalizedMediaSearch));

  const formatSceneTime = (timeUs: number) => {
    const totalSeconds = Math.max(0, timeUs / 1e6);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const tenths = Math.floor((totalSeconds % 1) * 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  };

  const formatMediaDuration = (item: EditorItem) => {
    const seconds = Math.max(0, item.sprite.time.duration / 1e6);
    return `${seconds.toFixed(1)}s`;
  };

  useEffect(() => {
    const existingDuration = selectedTransitionTarget?.transitionIn?.durationUs;
    const preferredDuration = existingDuration === undefined
      ? transitionDuration
      : existingDuration / 1e6;
    const nextDuration = Number(
      Math.min(transitionMaxDuration, Math.max(0.1, preferredDuration)).toFixed(1),
    );
    setTransitionDuration(nextDuration);
    setTransitionDurationDraft(nextDuration.toFixed(1));
    setTransitionType(selectedTransitionTarget?.transitionIn?.type || 'crossfade');
  }, [
    selectedTransitionTarget?.id,
    selectedTransitionTarget?.transitionIn?.durationUs,
    selectedTransitionTarget?.transitionIn?.type,
    transitionMaxDuration,
  ]);

  const changeTransitionDuration = (value: number) => {
    const nextDuration = Number(
      Math.min(transitionMaxDuration, Math.max(0.1, value)).toFixed(1),
    );
    setTransitionDuration(nextDuration);
    setTransitionDurationDraft(nextDuration.toFixed(1));
  };

  const commitTransitionDuration = () => {
    const parsed = Number(transitionDurationDraft);
    if (!transitionDurationDraft.trim() || !Number.isFinite(parsed)) {
      setTransitionDurationDraft(transitionDuration.toFixed(1));
      return;
    }
    changeTransitionDuration(parsed);
  };

  const submitTransition = async (remove = false) => {
    if (transitionBusy) return;
    setTransitionBusy(true);
    try {
      if (remove) await onRemoveTransition();
      else {
        const parsed = Number(transitionDurationDraft);
        const duration = transitionDurationDraft.trim() && Number.isFinite(parsed)
          ? Math.min(transitionMaxDuration, Math.max(0.1, Math.round(parsed * 10) / 10))
          : transitionDuration;
        changeTransitionDuration(duration);
        await onApplyTransition(transitionType, duration);
      }
    } finally { setTransitionBusy(false); }
  };

  return (
    <aside className="media-panel">
      <div className="panel-heading">
        <h2>{toolNames[activeTool]}</h2>
      </div>

      {activeTool === 'media' && (
        <>
          <div className="media-actions">
            <button
              className="primary-button media-import-button"
              type="button"
              onClick={() => inputRef.current && inputRef.current.click()}
            >
              <Icon name="upload" size={16} />
              导入素材
            </button>
            <button className="square-button" type="button" aria-label="导入选项">
              <Icon name="chevron-down" size={16} />
            </button>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept="video/mp4,audio/mpeg,audio/mp4,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                if (event.target.files && event.target.files.length) {
                  onImport(event.target.files);
                  event.target.value = '';
                }
              }}
            />
          </div>

          {props.assets.length ? (
            <>
              <div className="media-filter-row">
                <button className="filter-chip" type="button" onClick={() => setMediaSearch('')}>全部 <span>{props.assets.length}</span></button>
                <label className="search-box"><Icon name="search" size={15} /><input aria-label="搜索素材" placeholder="搜索素材" value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} /></label>
              </div>
              <p className="asset-library-hint">点击预览 · 加入时间轴后编辑</p>
              {filteredMediaItems.length ? (
                <AssetLibrary assets={filteredMediaItems} selectedId={props.previewAssetId} onPreview={props.onPreviewAsset} onAdd={props.onAddAsset} onRemove={props.onRemoveAsset} />
              ) : (
                <div className="media-search-empty" role="status">
                  <span className="media-search-empty__icon" aria-hidden="true">
                    <Icon name="search" size={20} />
                  </span>
                  <strong>没有找到素材</strong>
                  <span>换个名称或素材类型试试。</span>
                  <button type="button" onClick={() => setMediaSearch('')}>
                    清空搜索
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="media-empty-state">
              <button
                className={`media-drop-zone ${mediaDragActive ? 'media-drop-zone--active' : ''}`}
                type="button"
                onClick={() => inputRef.current && inputRef.current.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setMediaDragActive(true);
                }}
                onDragLeave={() => setMediaDragActive(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setMediaDragActive(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setMediaDragActive(false);
                  if (event.dataTransfer.files.length) onImport(event.dataTransfer.files);
                }}
              >
                <span className="media-drop-zone__icon"><Icon name="upload" size={19} /></span>
                <strong>把文件拖到这里</strong>
                <small>MP4 · MP3 · PNG · JPG · WebP</small>
                <span>解析在浏览器本地完成，素材不会上传</span>
              </button>
            </div>
          )}
        </>
      )}

      {activeTool === 'audio' && (
        <div className="audio-tool">
          <div className="audio-tool__tabs" role="tablist" aria-label="音频工具">
            <button type="button" role="tab" aria-selected="true" className="is-active">导入</button>
            <button type="button" role="tab" aria-selected="false" onClick={() => onNotify('已导入的音频会显示在下方')}>我的音频</button>
          </div>

          <section className="audio-tool__section">
            <div className="audio-tool__section-title">
              <span className="audio-tool__section-icon"><Icon name="upload" size={17} /></span>
              <span>
                <strong>导入音频</strong>
                <small>从电脑选择音乐、旁白或音效</small>
              </span>
            </div>
            <button
              className="primary-button audio-tool__primary"
              type="button"
              onClick={() => audioInputRef.current?.click()}
            >
              <Icon name="plus" size={15} />
              导入本地音频
            </button>
            <input
              ref={audioInputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg"
              onChange={(event) => {
                if (event.target.files && event.target.files.length) {
                  onImport(event.target.files);
                  event.target.value = '';
                }
              }}
            />
            <p className="audio-tool__format">MP3 · M4A · AAC · WAV · FLAC</p>
          </section>

          <section className="audio-tool__section audio-tool__extract">
            <div className="audio-tool__section-title">
              <span className="audio-tool__section-icon"><Icon name="music" size={17} /></span>
              <span>
                <strong>分离音频</strong>
                <small>分离后，视频与原声可分别编辑</small>
              </span>
            </div>
            {selectedVideo ? (
              <div className={`audio-source-card ${selectedVideo.hasAudio ? '' : 'audio-source-card--disabled'}`}>
                <span className="audio-source-card__thumb">
                  {selectedVideo.thumbnailUrl ? <img src={selectedVideo.thumbnailUrl} alt="" /> : <Icon name="media" size={19} />}
                </span>
                <span className="audio-source-card__meta">
                  <strong title={selectedVideo.name}>{selectedVideo.name}</strong>
                  <small>
                    {selectedVideo.hasAudio
                      ? '检测到内嵌原声'
                      : selectedVideo.audioDetached && selectedVideoAudio
                        ? `已分离：${selectedVideoAudio.name}`
                        : '该视频没有音轨'}
                  </small>
                </span>
                <button
                  type="button"
                  disabled={!selectedVideo.hasAudio}
                  onClick={() => onExtractAudio(selectedVideo.id)}
                >
                  {selectedVideo.audioDetached ? '已分离' : '分离音频'}
                </button>
              </div>
            ) : (
              <div className="audio-tool__selection-hint">
                <Icon name="media" size={18} />
                <span>先在时间轴选择一个视频</span>
              </div>
            )}
          </section>

          <section className="audio-tool__library">
            <h3>音频素材库</h3>
            <AssetLibrary assets={props.assets.filter((asset) => asset.kind === 'audio')} selectedId={props.previewAssetId} onPreview={props.onPreviewAsset} onAdd={props.onAddAsset} onRemove={props.onRemoveAsset} />
            <div className="audio-tool__library-title">
              <strong>{selectedVideo ? '当前视频的分离原声' : '时间轴音频片段'}</strong>
              <span>{displayedAudioItems.length}</span>
            </div>
            {displayedAudioItems.length ? (
              <div className="audio-list" aria-live="polite">
                {displayedAudioItems.map((item) => (
                  <button
                    type="button"
                    className={`audio-list__item ${selectedId === item.id ? 'is-selected' : ''} ${selectedVideoAudio?.id === item.id ? 'is-related' : ''}`}
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                  >
                    <span className="audio-list__play"><Icon name="music" size={16} /></span>
                    <span className="audio-list__wave" aria-hidden="true">
                      {(item.audioWaveform.length ? item.audioWaveform.slice(0, 18) : [0.2, 0.35, 0.55, 0.3, 0.7, 0.45]).map((peak, index) => (
                        <i key={index} style={{ height: `${Math.max(14, peak * 100)}%` }} />
                      ))}
                    </span>
                    <span className="audio-list__meta">
                      <strong title={item.name}>{item.name}</strong>
                      <small>{formatMediaDuration(item)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="audio-tool__empty">
                <span><Icon name="music" size={20} /></span>
                <strong>{selectedVideo ? '当前视频没有独立音频' : '还没有独立音频'}</strong>
                <small>{selectedVideo ? '执行分离后，这里会显示该视频的独立原声。' : '导入音频，或从带声音的视频中分离原声。'}</small>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTool === 'text' && (
        <div className="text-tool">
          <section className="text-tool__section">
            <h3 className="text-tool__label">内容</h3>
            <div className="text-input-wrap">
              <textarea
                value={textValue}
                maxLength={80}
                placeholder="输入要添加到画面的文字"
                onChange={(event) => onTextChange(event.target.value)}
              />
              <span className="text-count">{textValue.length}/80</span>
            </div>
            <p className="text-tool__hint">在播放头位置创建 5 秒文字素材。</p>
          </section>

          <section className="text-tool__section">
            <h3 className="text-tool__label">样式</h3>
            <RangeSlider
              label="字号"
              min={24}
              max={120}
              step={2}
              value={textStyle.fontSize}
              valueControl={(
              <input
                className="text-size-number"
                aria-label="文字字号"
                type="number"
                min="24"
                max="120"
                step="2"
                value={textStyle.fontSize}
                onChange={(event) => onTextStyleChange({
                  fontSize: Math.min(120, Math.max(24, Number(event.target.value))),
                })}
              />
              )}
              onChange={(fontSize) => onTextStyleChange({ fontSize })}
            />
            <div className="text-color-row">
              <ColorPicker
                label="文字"
                value={textStyle.color}
                open={activeColorPicker === 'text'}
                onChange={(color) => onTextStyleChange({ color })}
                onOpenChange={(open) => setActiveColorPicker(open ? 'text' : null)}
              />
              <ColorPicker
                label="描边"
                value={textStyle.strokeColor}
                open={activeColorPicker === 'stroke'}
                onChange={(strokeColor) => onTextStyleChange({ strokeColor })}
                onOpenChange={(open) => setActiveColorPicker(open ? 'stroke' : null)}
              />
              {textStyle.backgroundColor !== '#00000000' && (
                <ColorPicker
                  label="背景"
                  value={textStyle.backgroundColor}
                  open={activeColorPicker === 'background'}
                  onChange={(backgroundColor) => onTextStyleChange({ backgroundColor: `${backgroundColor}cc` })}
                  onOpenChange={(open) => setActiveColorPicker(open ? 'background' : null)}
                />
              )}
            </div>
            <div className="text-toggle-row">
              <ToggleSwitch
                label="加粗"
                checked={textStyle.bold}
                onChange={(bold) => onTextStyleChange({ bold })}
              />
              <ToggleSwitch
                label="文字背景"
                checked={textStyle.backgroundColor !== '#00000000'}
                onChange={(checked) => {
                  if (!checked) setActiveColorPicker(null);
                  onTextStyleChange({ backgroundColor: checked ? '#000000cc' : '#00000000' });
                }}
              />
            </div>
          </section>

          <section className="text-tool__section">
            <h3 className="text-tool__label">预览</h3>
            <div className="text-preview-frame">
              {textPreviewMedia && textPreviewMedia.kind === 'video' && textPreviewMedia.sourceUrl ? (
                <video src={textPreviewMedia.sourceUrl} muted preload="metadata" />
              ) : textPreviewMedia && textPreviewMedia.thumbnailUrl ? (
                <img src={textPreviewMedia.thumbnailUrl} alt="" />
              ) : (
                <span className="text-preview-frame__empty"><Icon name="image" size={20} /></span>
              )}
              <span className="text-preview-frame__shade" aria-hidden="true" />
              <strong style={{
                color: textStyle.color,
                fontSize: `${Math.max(12, Math.min(textStyle.fontSize * 0.32, 24))}px`,
                fontWeight: textStyle.bold ? 700 : 400,
                background: textStyle.backgroundColor,
                WebkitTextStroke: `1px ${textStyle.strokeColor}`,
              }}>{textValue || '文字预览'}</strong>
            </div>
          </section>

          <div className="text-action-footer">
            <div className="text-action-row">
              <button className="primary-button" type="button" onClick={onAddText}>
                <Icon name="plus" size={15} />
                添加
              </button>
              <button type="button" disabled={!selectedText} onClick={onUpdateText}>更新所选</button>
            </div>
            {!selectedText && <p className="control-reason">选中时间轴上的文字素材后可更新。</p>}
          </div>
        </div>
      )}

      {activeTool === 'subtitle' && (
        <div className="subtitle-tool">
          <div className="subtitle-tabs">
            <button type="button" className="is-active">导入字幕</button>
            <button disabled title="需要接入语音转写服务" type="button" onClick={() => onNotify('语音识别需要接入转写服务')}>智能识别</button>
            <button disabled title="请直接在下方输入纯文本" type="button" onClick={() => onNotify('直接输入纯文本时，每行会生成 3 秒字幕')}>新建字幕</button>
          </div>
          <p className="control-reason">智能识别需接入转写服务；纯文本可直接在下方输入。</p>
          <div className="subtitle-recognition-note">
            <strong>识别字幕</strong>
            <span>生产环境可接入 Whisper 或企业语音转写接口。</span>
          </div>
          <button
            type="button"
            className="subtitle-import-button"
            onClick={() => subtitleInputRef.current?.click()}
          >
            <Icon name="upload" size={15} />导入 SRT / VTT
          </button>
          <input
            ref={subtitleInputRef}
            className="visually-hidden"
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file) onSubtitleChange(await file.text());
              input.value = '';
            }}
          />
          <textarea
            aria-label="字幕内容"
            value={subtitleValue}
            placeholder={'1\n00:00:01,000 --> 00:00:03,000\n第一句字幕'}
            onChange={(event) => onSubtitleChange(event.target.value)}
          />
          <p className="subtitle-help">支持 SRT、VTT；纯文本按每行 3 秒生成。清空内容会同步移除已生成的字幕。</p>
          <button
            type="button"
            className="primary-button subtitle-generate-button"
            disabled={!subtitleValue.trim()}
            onClick={onGenerateSubtitles}
          >
            {subtitleItems.length ? '更新字幕片段' : '生成字幕片段'}
          </button>
          {!subtitleValue.trim() && <p className="control-reason">请先导入 SRT / VTT，或输入至少一行文本。</p>}
        </div>
      )}

      {activeTool === 'transition' && (
        <div className="transition-tool">
          <p className="tool-help">选中后一段画面，选择效果与时长后应用。点击时间轴的转场标记可再次编辑。</p>
          {selectedTransitionTarget?.transitionIn && (
            <p className="transition-current" role="status">
              当前：{transitionName(selectedTransitionTarget.transitionIn.type)} · {(selectedTransitionTarget.transitionIn.durationUs / 1e6).toFixed(1)} 秒
            </p>
          )}
          <div className="transition-options" role="group" aria-label="转场效果">
            {TRANSITIONS.map(option => (
              <button
                key={option.type}
                type="button"
                aria-pressed={transitionType === option.type}
                aria-label={option.name}
                disabled={transitionBusy}
                className={`transition-card ${transitionType === option.type ? 'transition-card--active' : ''}`}
                onClick={() => setTransitionType(option.type)}
              >
                <Icon name="transition" size={20} />
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <div className="transition-duration">
            <span>转场时长</span>
            <div className="transition-duration__presets">
              {[0.5, 1, 1.5].map((duration) => (
                <button
                  key={duration}
                  type="button"
                  className={Math.abs(transitionDuration - duration) < 0.001 ? 'is-active' : ''}
                  disabled={transitionBusy || duration > transitionMaxDuration}
                  onClick={() => changeTransitionDuration(duration)}
                >
                  {duration} 秒
                </button>
              ))}
            </div>
            <div className="transition-duration__custom">
              <RangeSlider
                label="精确时长"
                value={transitionDuration}
                min={0.1}
                max={transitionMaxDuration}
                step={0.1}
                disabled={transitionBusy}
                valueText={`${transitionDuration.toFixed(1)} 秒`}
                scaleLabels={[
                  '0.1 秒',
                  `${((transitionMaxDuration + 0.1) / 2).toFixed(1)} 秒`,
                  `${transitionMaxDuration.toFixed(1)} 秒`,
                ]}
                valueControl={(
                  <span className="range-number-wrap transition-duration__number">
                    <input
                      aria-describedby="transition-duration-hint"
                      aria-label="转场时长数值"
                      className="range-number"
                      type="number"
                      min={0.1}
                      max={transitionMaxDuration}
                      step={0.1}
                      disabled={transitionBusy}
                      value={transitionDurationDraft}
                      onBlur={commitTransitionDuration}
                      onChange={(event) => setTransitionDurationDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setTransitionDurationDraft(transitionDuration.toFixed(1));
                        }
                      }}
                    />
                    <em>秒</em>
                  </span>
                )}
                onChange={changeTransitionDuration}
              />
              <p id="transition-duration-hint" className="transition-duration__hint">
                可输入 0.1–{transitionMaxDuration.toFixed(1)} 秒，调整后点击下方按钮应用。
              </p>
            </div>
          </div>
          <div className="transition-actions">
          <button
            type="button"
            className="primary-button transition-apply"
            disabled={transitionBusy || Boolean(transitionAvailability.reason)}
            onClick={() => submitTransition()}
          >
            {transitionBusy ? '正在更新转场…' : selectedTransitionTarget?.transitionIn ? '更新转场' : '应用到所选片段'}
          </button>
          {selectedTransitionTarget?.transitionIn && (
            <button type="button" className="transition-remove"
              disabled={transitionBusy || selectedTransitionTarget.sprite.interactable === 'disabled'}
              onClick={() => submitTransition(true)}>
              <Icon name="trash" size={14} />移除转场
            </button>
          )}
          {transitionAvailability.reason && <p className="control-reason">{transitionAvailability.reason}</p>}
          </div>
        </div>
      )}

      {activeTool === 'effect' && (
        <div className="scene-tool">
          <div className="scene-tool__intro">
            <span className="scene-tool__badge">本地分析</span>
            <h3>智能分镜</h3>
            <p>按画面变化查找候选切点。视频不会上传，确认后才会分割时间轴。</p>
          </div>
          <button
            type="button"
            className="primary-button scene-analyze-button"
            disabled={!selectedVideo || sceneAnalyzing}
            onClick={onAnalyzeScenes}
          >
            {sceneAnalyzing ? '正在分析画面…' : '分析所选视频'}
          </button>
          {!selectedVideo && !sceneAnalyzing && (
            <p className="scene-tool__hint">请先在素材区或时间轴选择一个视频。</p>
          )}
          {sceneAnalyzing && (
            <div className="scene-analyzing" role="status">
              <span className="loading-spinner" />
              <div>
                <strong>正在逐帧取样并比对画面</strong>
                <span className="scene-analyzing__track"><i /></span>
                <small>长视频需要几十秒，请保持页面打开。</small>
              </div>
            </div>
          )}
          {sceneAnalysis && !sceneAnalyzing && (
            <div className="scene-result">
              <div className="scene-result__summary">
                <strong>{sceneAnalysis.itemName}</strong>
                <span>采样 {sceneAnalysis.sampleCount} 帧 · 候选切点 {sceneAnalysis.candidates.length} 个</span>
              </div>
              {sceneAnalysis.candidates.length ? (
                <>
                  <div className="scene-candidate-list">
                    {sceneAnalysis.candidates.map((candidate) => (
                      <div className="scene-candidate" key={candidate.timeUs}>
                        <SelectionCheckbox
                          label={`选择切点 ${formatSceneTime(candidate.timeUs)}`}
                          checked={selectedSceneCutUs.includes(candidate.timeUs)}
                          onChange={() => onToggleSceneCut(candidate.timeUs)}
                        />
                        <button
                          type="button"
                          aria-label={`预览切点 ${formatSceneTime(candidate.timeUs)}`}
                          onClick={() => onPreviewSceneCut(candidate.timeUs)}
                        >
                          <img src={candidate.thumbnailUrl} alt="" />
                          <span>
                            <strong>{formatSceneTime(candidate.timeUs)}</strong>
                            <small>画面变化 {candidate.score}</small>
                            <span className="scene-strength" aria-hidden="true">
                              <i style={{ width: `${Math.max(0, Math.min(100, candidate.score))}%` }} />
                            </span>
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary-button scene-apply-button"
                    disabled={!selectedSceneCutUs.length}
                    onClick={onApplySceneCuts}
                  >
                    按 {selectedSceneCutUs.length} 个切点分割
                  </button>
                </>
              ) : (
                <div className="scene-empty-result">
                  <Icon name="split" size={20} />
                  <strong>未发现明显画面切换</strong>
                  <span>将播放头移到目标位置，再用时间轴工具栏的“分割”。</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTool !== 'media' && activeTool !== 'audio' && activeTool !== 'text' && activeTool !== 'subtitle' && activeTool !== 'transition' && activeTool !== 'effect' && (
        <div className="empty-tool-state">
          <span className="empty-tool-state__badge">规划中</span>
          <Icon
            name={activeTool === 'sticker' ? 'sticker' : activeTool === 'filter' ? 'filter' : 'adjust'}
            size={34}
          />
          <h3>{toolNames[activeTool]}</h3>
          <p>{toolDescriptions[activeTool]}</p>
        </div>
      )}
    </aside>
  );
}
