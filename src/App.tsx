import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InspectorPanel } from './components/InspectorPanel';
import { Icon } from './components/Icon';
import { MediaPanel } from './components/MediaPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { SourcePreview } from './components/SourcePreview';
import { AssetDeleteRequest, DeleteAssetDialog } from './components/DeleteAssetDialog';
import { TimelinePanel } from './components/TimelinePanel';
import { InsertContentDialog, InsertionPreview } from './components/InsertContentDialog';
import { InsertionBoundary, insertionBoundary } from './editor/insertion';
import { ToolRail } from './components/ToolRail';
import { SaveStatus, TopBar } from './components/TopBar';
import { WebAVRuntime } from './editor/WebAVRuntime';
import { loadDraft, saveDraft } from './editor/draftStore';
import { parseSubtitleText } from './editor/subtitleParser';
import {
  DraftProject,
  EditorItem,
  MediaAsset,
  MaskConfig,
  PictureAdjustment,
  SceneAnalysisResult,
  SpriteProperties,
  TextStyle,
  ToolKey,
  TrackControlState,
  TrackKind,
  TrackRowKey,
  TransitionType,
} from './editor/types';

interface ToastState {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: 'undo';
}

const INITIAL_TRACK_STATES: Record<TrackRowKey, TrackControlState> = {
  visual: { locked: false, hidden: false, muted: false },
  text: { locked: false, hidden: false, muted: false },
  audio: { locked: false, hidden: false, muted: false },
};

const TRACK_KINDS: Record<TrackRowKey, TrackKind[]> = {
  visual: ['video', 'image'],
  text: ['text'],
  audio: ['audio'],
};

const INITIAL_TEXT_STYLE: TextStyle = {
  fontSize: 64,
  color: '#ffffff',
  bold: true,
  strokeColor: '#000000',
  backgroundColor: '#00000000',
};

function getTrackStatesFromDraft(project: DraftProject) {
  const next: Record<TrackRowKey, TrackControlState> = {
    visual: { ...INITIAL_TRACK_STATES.visual },
    text: { ...INITIAL_TRACK_STATES.text },
    audio: { ...INITIAL_TRACK_STATES.audio },
  };
  (Object.keys(TRACK_KINDS) as TrackRowKey[]).forEach((track) => {
    const trackItems = project.items.filter((item) =>
      TRACK_KINDS[track].includes(item.kind),
    );
    if (!trackItems.length) return;
    next[track].locked = trackItems.every((item) => item.locked);
    if (track === 'audio') {
      next[track].muted = trackItems.every((item) => !item.visible);
    } else {
      next[track].hidden = trackItems.every((item) => !item.visible);
    }
  });
  return next;
}

function LoadingSkeleton() {
  return (
    <div className="loading-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">正在准备 WebAV 编辑器</span>
      <div className="loading-skeleton__rail">
        {Array.from({ length: 7 }).map((_, index) => (
          <span className="skeleton-block skeleton-block--tool" key={index} />
        ))}
      </div>
      <div className="loading-skeleton__media">
        <span className="skeleton-block skeleton-block--heading" />
        <span className="skeleton-block skeleton-block--button" />
        <span className="skeleton-block skeleton-block--input" />
        <div className="loading-skeleton__cards">
          {Array.from({ length: 4 }).map((_, index) => (
            <span className="skeleton-block skeleton-block--card" key={index} />
          ))}
        </div>
      </div>
      <div className="loading-skeleton__preview">
        <span className="skeleton-block skeleton-block--canvas" />
        <div className="loading-skeleton__transport">
          <span className="skeleton-block skeleton-block--time" />
          <span className="skeleton-block skeleton-block--play" />
          <span className="skeleton-block skeleton-block--time" />
        </div>
      </div>
      <div className="loading-skeleton__inspector">
        <span className="skeleton-block skeleton-block--tabs" />
        <span className="skeleton-block skeleton-block--heading" />
        {Array.from({ length: 5 }).map((_, index) => (
          <span className="skeleton-block skeleton-block--field" key={index} />
        ))}
      </div>
      <div className="loading-skeleton__timeline">
        <span className="skeleton-block skeleton-block--timeline-tools" />
        <span className="skeleton-block skeleton-block--track" />
        <span className="skeleton-block skeleton-block--track" />
        <span className="skeleton-block skeleton-block--track" />
        <div className="loading-skeleton__progress">
          <span><i /></span>
          <small>正在准备编辑器</small>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const runtimeRef = useRef<WebAVRuntime | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const autoSaveTimerRef = useRef<number | null>(null);
  const shortcutCloseRef = useRef<HTMLButtonElement | null>(null);
  const [canvasHost, setCanvasHost] = useState<HTMLDivElement | null>(null);
  const [activeTool, setActiveTool] = useState<ToolKey>('media');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [insertBoundary, setInsertBoundary] = useState<InsertionBoundary | null>(null);
  const [insertPreview, setInsertPreview] = useState<InsertionPreview | null>(null);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const [assetDeleteRequest, setAssetDeleteRequest] = useState<AssetDeleteRequest | null>(null);
  const assetDeleteRequestRef = useRef<AssetDeleteRequest | null>(null);
  useEffect(() => () => { assetDeleteRequestRef.current?.resolve(false); }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [properties, setProperties] = useState<SpriteProperties | null>(null);
  const [currentTimeUs, setCurrentTimeUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [trackStates, setTrackStates] = useState(INITIAL_TRACK_STATES);
  const [textValue, setTextValue] = useState('数字人视频剪辑');
  const [textStyle, setTextStyle] = useState(INITIAL_TEXT_STYLE);
  const [subtitleValue, setSubtitleValue] = useState('');
  const generatedSubtitleSourceRef = useRef('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [sceneAnalysis, setSceneAnalysis] = useState<SceneAnalysisResult | null>(null);
  const [selectedSceneCutUs, setSelectedSceneCutUs] = useState<number[]>([]);
  const [sceneAnalyzing, setSceneAnalyzing] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveStatus>({
    kind: 'reading',
    label: '正在读取草稿…',
  });
  const [startupError, setStartupError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const notify = useCallback(
    (
      message: string,
      tone: ToastState['tone'] = 'info',
      action?: ToastState['action'],
    ) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, message, tone, action });
      if (tone !== 'error') {
        toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
      }
    },
    [],
  );

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  useEffect(() => {
    if (shortcutsOpen) shortcutCloseRef.current?.focus();
  }, [shortcutsOpen]);

  const copyStartupError = useCallback(async () => {
    if (!startupError) return;
    try {
      await navigator.clipboard.writeText(startupError);
      notify('错误信息已复制', 'success');
    } catch (error) {
      notify('复制失败，请手动选择错误信息', 'error');
    }
  }, [notify, startupError]);

  useEffect(() => {
    if (!canvasHost || runtimeRef.current) return;
    const runtime = new WebAVRuntime({
      onItemsChange: setItems,
      onAssetsChange: setAssets,
      onSelectionChange: (id) => {
        setSelectedId(id);
        if (!id) setProperties(null);
      },
      onPropertiesChange: (id, nextProperties) => {
        if (runtimeRef.current?.getSelectedId() === id) {
          setProperties(nextProperties);
        }
      },
      onTimeChange: setCurrentTimeUs,
      onPlayingChange: setPlaying,
      onHistoryChange: (nextCanUndo, nextCanRedo) => {
        setCanUndo(nextCanUndo);
        setCanRedo(nextCanRedo);
      },
      onExportProgress: setExportProgress,
      onMessage: notify,
    });
    runtimeRef.current = runtime;
    runtime.mount(canvasHost).then(
      async () => {
        try {
          const draft = await loadDraft();
          if (draft) {
            await runtime.restoreDraft(draft);
            setTrackStates(getTrackStatesFromDraft(draft));
            setSaveState({ kind: 'restored', label: '草稿已恢复' });
          } else {
            setSaveState({ kind: 'pending', label: '等待自动保存' });
          }
          setDraftReady(true);
        } catch (error) {
          notify((error as Error).message, 'error');
          setSaveState({ kind: 'error', label: '草稿读取失败 · 重试' });
        } finally {
          setLoading(false);
        }
      },
      (error: Error) => {
        setStartupError(error.message || 'WebAV 初始化失败');
        notify(error.message || 'WebAV 初始化失败', 'error');
        setLoading(false);
      },
    );

    return () => {
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, [canvasHost, notify]);

  const durationUs = useMemo(
    () =>
      Math.max(
        ...items.map(
          (item) => item.sprite.time.offset + item.sprite.time.duration,
        ),
        0,
      ),
    [items],
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  const selectItem = useCallback((id: string) => {
    setPreviewAsset(null);
    const item = items.find((candidate) => candidate.id === id);
    if (item?.draftSource.type === 'text') {
      setTextValue(item.draftSource.text);
      setTextStyle(item.draftSource.style);
    }
    runtimeRef.current?.select(id);
  }, [items]);

  const activateItem = useCallback(async (id: string) => {
    setPreviewAsset(null);
    const item = items.find((candidate) => candidate.id === id);
    if (item?.draftSource.type === 'text') {
      setTextValue(item.draftSource.text);
      setTextStyle(item.draftSource.style);
    }
    try {
      await runtimeRef.current?.selectAndReveal(id);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [items, notify]);

  const seek = useCallback(async (timeUs: number) => {
    setPreviewAsset(null);
    try {
      await runtimeRef.current?.seek(timeUs);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const togglePlayback = useCallback(() => {
    setPreviewAsset(null);
    runtimeRef.current?.togglePlayback(playing);
  }, [playing]);

  const previewMediaAsset = useCallback((asset: MediaAsset) => {
    runtimeRef.current?.pause();
    runtimeRef.current?.select(null);
    setPreviewAsset(asset);
  }, []);

  const addMediaAsset = useCallback(async (id: string) => {
    setPreviewAsset(null);
    runtimeRef.current?.pause();
    try {
      await runtimeRef.current?.addAssetToTimeline(id);
      notify('已加入时间轴，可在时间轴上编辑', 'success');
    } catch (error) { notify((error as Error).message, 'error'); }
  }, [notify]);

  const removeMediaAsset = useCallback(async (id: string) => {
    try {
      await runtimeRef.current?.removeAsset(id, (asset, affectedItems) => new Promise<boolean>((resolve) => {
        const request = { asset, items: affectedItems, resolve };
        assetDeleteRequestRef.current = request;
        setAssetDeleteRequest(request);
      }));
    } catch (error) { notify((error as Error).message, 'error'); }
  }, [notify]);

  const closeAssetDelete = useCallback((confirmed: boolean) => {
    const request = assetDeleteRequestRef.current;
    if (!request) return;
    if (confirmed) setPreviewAsset((current) => current?.id === request.asset.id ? null : current);
    assetDeleteRequestRef.current = null;
    setAssetDeleteRequest(null);
    request.resolve(confirmed);
  }, []);

  const addText = useCallback(async () => {
    try {
      await runtimeRef.current?.addText(textValue, textStyle);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, textStyle, textValue]);

  const updateSelectedText = useCallback(async () => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.updateText(selectedId, textValue, textStyle);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId, textStyle, textValue]);

  const generateSubtitles = useCallback(async () => {
    try {
      const cues = parseSubtitleText(subtitleValue, currentTimeUs);
      if (!cues.length) throw new Error('没有解析到有效字幕');
      await runtimeRef.current?.addSubtitles(cues);
      generatedSubtitleSourceRef.current = subtitleValue;
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [currentTimeUs, notify, subtitleValue]);

  const changeSubtitleValue = useCallback((value: string) => {
    const shouldClearTimeline = Boolean(subtitleValue.trim()) && !value.trim();
    setSubtitleValue(value);
    if (!shouldClearTimeline) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const sourceBeforeClear = generatedSubtitleSourceRef.current || subtitleValue;
    runtime.clearSubtitles().then((removedCount) => {
      if (removedCount) generatedSubtitleSourceRef.current = '';
    }).catch((error) => {
      setSubtitleValue(sourceBeforeClear);
      notify((error as Error).message, 'error');
    });
  }, [notify, subtitleValue]);

  const importFiles = useCallback(async (files: FileList) => {
    try {
      setLoading(true);
      await runtimeRef.current?.addFiles(files);
      notify('已导入素材库，点击素材预览，点击“加入”开始剪辑', 'success');
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const importToTimeline = useCallback(async (files: FileList) => {
    setPreviewAsset(null);
    const runtime = runtimeRef.current;
    if (!runtime) return;
    try {
      setLoading(true);
      const imported = await runtime.addFiles(files);
      for (const asset of imported) await runtime.addAssetToTimeline(asset.id);
    } catch (error) { notify((error as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  const extractAudio = useCallback(async (id: string) => {
    try {
      setLoading(true);
      await runtimeRef.current?.extractAudio(id);
      setActiveTool('audio');
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const updateProperties = useCallback(async (patch: Partial<SpriteProperties>) => {
    if (!selectedId) return;
    setProperties((current) => (current ? { ...current, ...patch } : current));
    try {
      await runtimeRef.current?.updateProperties(selectedId, patch);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const updateVolume = useCallback(async (id: string, volume: number) => {
    try {
      await runtimeRef.current?.updateVolume(id, volume);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const updatePictureAdjustment = useCallback(async (
    patch: Partial<PictureAdjustment>,
  ) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.updatePictureAdjustment(selectedId, patch);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const previewPictureAdjustment = useCallback(async (
    patch: Partial<PictureAdjustment>,
  ) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.previewPictureAdjustment(selectedId, patch);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const commitPictureAdjustment = useCallback(async (
    before: Partial<PictureAdjustment>,
  ) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.commitPictureAdjustment(selectedId, before);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const updateMask = useCallback(async (patch: Partial<MaskConfig>) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.updateMask(selectedId, patch);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const previewMask = useCallback(async (patch: Partial<MaskConfig>) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.previewMask(selectedId, patch);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const commitMask = useCallback(async (before: Partial<MaskConfig>) => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.commitMask(selectedId, before);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const splitSelected = useCallback(async () => {
    try {
      await runtimeRef.current?.splitSelected();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const applyTransition = useCallback(async (type: TransitionType, durationSeconds: number) => {
    try {
      await runtimeRef.current?.applyTransition(type, durationSeconds);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const removeTransition = useCallback(async () => {
    try {
      await runtimeRef.current?.removeTransition();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const analyzeScenes = useCallback(async () => {
    if (!selectedId) {
      notify('请先选择视频素材', 'error');
      return;
    }
    setSceneAnalyzing(true);
    try {
      const result = await runtimeRef.current?.analyzeScenes(selectedId);
      if (result) {
        setSceneAnalysis(result);
        setSelectedSceneCutUs(result.candidates.map((candidate) => candidate.timeUs));
      }
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setSceneAnalyzing(false);
    }
  }, [notify, selectedId]);

  const toggleSceneCut = useCallback((timeUs: number) => {
    setSelectedSceneCutUs((current) => (
      current.includes(timeUs)
        ? current.filter((candidate) => candidate !== timeUs)
        : [...current, timeUs].sort((left, right) => left - right)
    ));
  }, []);

  const previewSceneCut = useCallback(async (timeUs: number) => {
    if (!sceneAnalysis) return;
    const item = items.find((candidate) => candidate.id === sceneAnalysis.itemId);
    if (!item) return;
    runtimeRef.current?.select(item.id);
    await runtimeRef.current?.seek(item.sprite.time.offset + timeUs);
  }, [items, sceneAnalysis]);

  const applySceneCuts = useCallback(async () => {
    if (!sceneAnalysis) return;
    try {
      await runtimeRef.current?.splitVideoByScenes(
        sceneAnalysis.itemId,
        selectedSceneCutUs,
      );
      setSceneAnalysis(null);
      setSelectedSceneCutUs([]);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, sceneAnalysis, selectedSceneCutUs]);

  const captureKeyframeStart = useCallback(() => {
    if (!selectedId) return;
    try {
      runtimeRef.current?.captureKeyframeStart(selectedId);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const applyKeyframeEnd = useCallback(async () => {
    if (!selectedId) return;
    try {
      await runtimeRef.current?.applyKeyframeEnd(selectedId);
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify, selectedId]);

  const deleteSelected = useCallback(() => {
    setPreviewAsset(null);
    runtimeRef.current?.deleteSelected();
  }, []);

  const moveTimelineItem = useCallback(async (id: string, startUs: number) => {
    await runtimeRef.current?.moveItem(id, startUs);
  }, []);

  const trimTimelineItem = useCallback(async (
    id: string,
    edge: 'start' | 'end',
    startUs: number,
    durationUs: number,
  ) => {
    await runtimeRef.current?.trimItem(id, edge, startUs, durationUs);
  }, []);

  const undo = useCallback(async () => {
    setPreviewAsset(null);
    try {
      await runtimeRef.current?.undo();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const redo = useCallback(async () => {
    setPreviewAsset(null);
    try {
      await runtimeRef.current?.redo();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const copySelected = useCallback(async () => {
    setPreviewAsset(null);
    try {
      await runtimeRef.current?.copySelected();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const toggleTrack = useCallback((
    track: TrackRowKey,
    control: keyof TrackControlState,
  ) => {
    setTrackStates((current) => {
      const nextValue = !current[track][control];
      const nextTrack = { ...current[track], [control]: nextValue };
      const next = { ...current, [track]: nextTrack };
      const runtime = runtimeRef.current;
      if (control === 'locked') {
        runtime?.setTrackLocked(TRACK_KINDS[track], nextValue);
      } else if (control === 'hidden' || control === 'muted') {
        runtime?.setTrackVisible(TRACK_KINDS[track], !nextValue).catch((error: Error) => {
          notify(error.message, 'error');
        });
      }
      return next;
    });
  }, [notify]);

  const exportVideo = useCallback(async () => {
    if (exporting) return;
    setPreviewAsset(null);
    runtimeRef.current?.pause();
    try {
      setExporting(true);
      await runtimeRef.current?.exportVideo();
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  }, [exporting, notify]);

  const cancelExport = useCallback(async () => {
    try {
      await runtimeRef.current?.cancelExport();
    } catch (error) {
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const persistDraft = useCallback(async (manual = false) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setSaveState({ kind: 'saving', label: '正在保存…' });
    try {
      const draft = runtime.createDraft();
      await saveDraft(draft);
      const savedTime = new Date(draft.savedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      setSaveState({ kind: 'saved', label: `已自动保存 ${savedTime}` });
      if (manual) notify('草稿已保存到当前浏览器', 'success');
    } catch (error) {
      setSaveState({ kind: 'error', label: '草稿保存失败 · 重试' });
      notify((error as Error).message, 'error');
    }
  }, [notify]);

  const restoreLatestDraft = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setPreviewAsset(null);
    setDraftReady(false);
    try {
      setLoading(true);
      const draft = await loadDraft();
      if (!draft) throw new Error('当前浏览器中没有可恢复的草稿');
      await runtime.restoreDraft(draft);
      setTrackStates(getTrackStatesFromDraft(draft));
      setSaveState({ kind: 'restored', label: '草稿已恢复' });
      setDraftReady(true);
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (!draftReady || insertBoundary) return;
    setSaveState({ kind: 'pending', label: '等待自动保存' });
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      persistDraft();
    }, 700);
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [draftReady, items, assets, persistDraft, trackStates, insertBoundary]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (assetDeleteRequestRef.current || insertBoundary) return;
      if (previewAsset) return;
      if (event.key === 'Escape' && shortcutsOpen) {
        event.preventDefault();
        setShortcutsOpen(false);
        return;
      }
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShortcutsOpen((current) => !current);
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        exportVideo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedId) {
        event.preventDefault();
        copySelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelected, deleteSelected, exportVideo, redo, selectedId, shortcutsOpen, togglePlayback, undo, previewAsset, insertBoundary]);

  return (
    <div className="app-shell" aria-busy={loading}>
      <TopBar
        exporting={exporting}
        exportProgress={exportProgress}
        saveState={saveState}
        onExport={exportVideo}
        onCancelExport={cancelExport}
        onSaveDraft={() => persistDraft(true)}
        onRestoreDraft={restoreLatestDraft}
        onShowShortcuts={() => setShortcutsOpen(true)}
        shortcutsOpen={shortcutsOpen}
        onNotify={notify}
      />

      <main className="editor-main">
        <ToolRail activeTool={activeTool} onChange={(tool) => { setPreviewAsset(null); setActiveTool(tool); }} />
        <MediaPanel
          activeTool={activeTool}
          items={items}
          assets={assets}
          previewAssetId={previewAsset?.id || null}
          onPreviewAsset={previewMediaAsset}
          onAddAsset={addMediaAsset}
          onRemoveAsset={removeMediaAsset}
          selectedId={selectedId}
          textValue={textValue}
          textStyle={textStyle}
          onTextChange={setTextValue}
          onTextStyleChange={(patch) => setTextStyle((current) => ({ ...current, ...patch }))}
          onAddText={addText}
          onUpdateText={updateSelectedText}
          subtitleValue={subtitleValue}
          onSubtitleChange={changeSubtitleValue}
          onGenerateSubtitles={generateSubtitles}
          onApplyTransition={applyTransition}
          onRemoveTransition={removeTransition}
          sceneAnalysis={sceneAnalysis}
          selectedSceneCutUs={selectedSceneCutUs}
          sceneAnalyzing={sceneAnalyzing}
          onAnalyzeScenes={analyzeScenes}
          onToggleSceneCut={toggleSceneCut}
          onPreviewSceneCut={previewSceneCut}
          onApplySceneCuts={applySceneCuts}
          onImport={importFiles}
          onExtractAudio={extractAudio}
          onSelect={activateItem}
          onNotify={notify}
        />
        <PreviewPanel
          sourcePreview={previewAsset ? <SourcePreview key={previewAsset.id} asset={previewAsset} onClose={() => setPreviewAsset(null)} /> : undefined}
          currentTimeUs={currentTimeUs}
          durationUs={durationUs}
          playing={playing}
          onCanvasHost={setCanvasHost}
          onTogglePlayback={togglePlayback}
          onSeek={seek}
          onNotify={notify}
        />
        <InspectorPanel
          item={selectedItem}
          properties={properties}
          onChange={updateProperties}
          onVolumeChange={updateVolume}
          onPictureAdjustmentChange={updatePictureAdjustment}
          onPictureAdjustmentPreview={previewPictureAdjustment}
          onPictureAdjustmentCommit={commitPictureAdjustment}
          onMaskChange={updateMask}
          onMaskPreview={previewMask}
          onMaskCommit={commitMask}
          onCaptureKeyframeStart={captureKeyframeStart}
          onApplyKeyframeEnd={applyKeyframeEnd}
        />
        <TimelinePanel
          insertionPreview={insertPreview}
          insertedId={insertedId}
          onInsertBefore={(id, side) => {
            if (exporting || sceneAnalyzing) { notify('正在处理媒体，请稍后再插入'); return; }
            const runtime = runtimeRef.current;
            const boundary = runtime && insertionBoundary(runtime.getItems(), id, side);
            if (!boundary) { notify('请选择一个时间轴片段'); return; }
            runtime!.pause();
            setPreviewAsset(null);
            setInsertBoundary(boundary);
          }}
          items={items}
          selectedId={selectedId}
          currentTimeUs={currentTimeUs}
          durationUs={durationUs}
          onSelect={selectItem}
          onActivate={activateItem}
          onEditTransition={(id) => {
            setPreviewAsset(null);
            const runtime = runtimeRef.current;
            runtime?.select(id);
            setActiveTool('transition');
            const item = runtime?.getItems().find(candidate => candidate.id === id);
            if (runtime && item?.transitionIn) {
              runtime.seek(item.sprite.time.offset + item.transitionIn.durationUs / 2)
                .catch(error => notify((error as Error).message, 'error'));
            }
          }}
          onSeek={seek}
          onSplit={splitSelected}
          onDelete={deleteSelected}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onCopy={copySelected}
          trackStates={trackStates}
          onToggleTrack={toggleTrack}
          onMove={moveTimelineItem}
          onTrim={trimTimelineItem}
          onImport={importToTimeline}
          onNotify={notify}
        />
      </main>

      {loading && <LoadingSkeleton />}
      {assetDeleteRequest && <DeleteAssetDialog request={assetDeleteRequest} onClose={closeAssetDelete} />}
      {insertBoundary && <InsertContentDialog boundary={insertBoundary} items={items} assets={assets}
        trackStates={trackStates} totalUs={durationUs} onPreview={setInsertPreview}
        onClose={() => { setInsertBoundary(null); setInsertPreview(null); }}
        onImport={async files => {
          const runtime = runtimeRef.current;
          if (!runtime) throw new Error('编辑器尚未初始化');
          return runtime.addFiles(files);
        }}
        onInsert={async (content, unlockTracks) => {
          const runtime = runtimeRef.current;
          if (!runtime) throw new Error('编辑器尚未初始化');
          // Unlock only after explicit confirmation; restore locks if insertion fails.
          unlockTracks.forEach(key => runtime.setTrackLocked(TRACK_KINDS[key], false));
          let id: string;
          try { id = await runtime.insertAtBoundary(insertBoundary, content); }
          catch (error) {
            unlockTracks.forEach(key => runtime.setTrackLocked(TRACK_KINDS[key], true));
            throw error;
          }
          setTrackStates(current => {
            const next = { ...current };
            unlockTracks.forEach(key => { next[key] = { ...next[key], locked: false }; });
            return next;
          });
          setPreviewAsset(null); setInsertedId(id);
          setInsertBoundary(null); setInsertPreview(null);
        }} />}

      {startupError && (
        <div className="startup-error-backdrop">
          <section
            className="startup-error"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="startup-error-title"
          >
            <span className="startup-error__icon" aria-hidden="true">
              <Icon name="alert" size={22} />
            </span>
            <div className="startup-error__content">
              <strong id="startup-error-title">WebAV 未能初始化</strong>
              <p>当前浏览器无法启动视频编辑能力。</p>
              <small>需要 Chrome / Edge 94 或更高版本，并启用 WebCodecs。</small>
              <code>{startupError}</code>
              <div className="startup-error__actions">
                <button type="button" className="primary-button" onClick={() => window.location.reload()}>
                  重新加载
                </button>
                <button type="button" className="secondary-button" onClick={copyStartupError}>
                  复制错误信息
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div
          className={`toast toast--${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          key={toast.id}
        >
          <span className="toast__icon" aria-hidden="true">
            <Icon
              name={toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'alert' : 'help'}
              size={15}
            />
          </span>
          <span className="toast__message">{toast.message}</span>
          {toast.action === 'undo' && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                dismissToast();
                undo();
              }}
            >
              撤销
            </button>
          )}
          {toast.tone === 'error' ? (
            <button
              type="button"
              className="toast__close"
              onClick={dismissToast}
              aria-label="关闭错误提示"
            >
              <Icon name="close" size={14} />
            </button>
          ) : (
            <span className="toast__timer" aria-hidden="true" />
          )}
        </div>
      )}

      {shortcutsOpen && (
        <div
          className="shortcut-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShortcutsOpen(false);
          }}
        >
          <section
            className="shortcut-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcut-dialog-title"
            aria-describedby="shortcut-dialog-note"
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                event.preventDefault();
                shortcutCloseRef.current?.focus();
              }
            }}
          >
            <header className="shortcut-dialog__header">
              <div>
                <span>操作指南</span>
                <h2 id="shortcut-dialog-title">键盘快捷键</h2>
              </div>
              <button
                type="button"
                ref={shortcutCloseRef}
                onClick={() => setShortcutsOpen(false)}
                aria-label="关闭快捷键面板"
              >
                <Icon name="close" size={17} />
              </button>
            </header>
            <div className="shortcut-dialog__grid">
              <div><span>播放 / 暂停</span><kbd>Space</kbd></div>
              <div><span>删除所选片段</span><kbd>Delete</kbd></div>
              <div><span>撤销</span><span className="shortcut-keys"><kbd>⌘ / Ctrl</kbd><kbd>Z</kbd></span></div>
              <div><span>重做</span><span className="shortcut-keys"><kbd>⌘ / Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd></span></div>
              <div><span>另一种重做方式</span><span className="shortcut-keys"><kbd>⌘ / Ctrl</kbd><kbd>Y</kbd></span></div>
              <div><span>复制所选片段</span><span className="shortcut-keys"><kbd>⌘ / Ctrl</kbd><kbd>C</kbd></span></div>
              <div><span>导出视频</span><span className="shortcut-keys"><kbd>⌘ / Ctrl</kbd><kbd>E</kbd></span></div>
              <div><span>片段左右移动 0.5 秒</span><span className="shortcut-keys"><kbd>←</kbd><kbd>→</kbd></span></div>
              <div><span>把手上裁剪 0.5 秒</span><span className="shortcut-keys"><kbd>←</kbd><kbd>→</kbd></span></div>
              <div><span>打开 / 关闭此面板</span><kbd>?</kbd></div>
            </div>
            <p id="shortcut-dialog-note">方向键会根据当前焦点执行操作：聚焦片段时移动，聚焦裁剪把手时裁剪。</p>
          </section>
        </div>
      )}

      <div className="small-viewport-warning">
        <span className="small-viewport-warning__icon" aria-hidden="true">
          <Icon name="monitor" size={22} />
        </span>
        <strong>请扩大浏览器窗口</strong>
        <span>当前 {viewportWidth}px · 建议至少 1180px</span>
        <small>扩大窗口后，编辑器会自动恢复。</small>
      </div>
    </div>
  );
}
