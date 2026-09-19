import { AVCanvas } from '@webav/av-canvas';
import {
  AudioClip,
  Combinator,
  IClip,
  ImgClip,
  MP4Clip,
  OffscreenSprite,
  VisibleSprite,
  renderTxt2ImgBitmap,
} from '@webav/av-cliper';
import {
  EditorItem,
  MediaAsset,
  DraftProject,
  DraftSource,
  KeyframeAnimation,
  KeyframeState,
  MaskConfig,
  PictureAdjustment,
  RuntimeCallbacks,
  SceneAnalysisResult,
  SceneCandidate,
  SpriteProperties,
  SubtitleCue,
  TextStyle,
  TrackKind,
  TransitionConfig,
  TransitionType,
} from './types';
import { readMediaAsset } from './mediaAssets';
import { resolveAssetReferences, sameBlob } from './assetReferences';
import { createDeletionTimeMapper } from './deletionTiming';
import { transitionFrame, transitionLimits, transitionName } from './transitions';
import { InsertionBoundary, InsertionContent, insertionPlan } from './insertion';

declare const require: (assetPath: string) => string;

const defaultImageUrl = require('../assets/demo-cover.png');

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const DEFAULT_IMAGE_DURATION = 12e6;
const DEFAULT_TEXT_DURATION = 5e6;
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 64,
  color: '#ffffff',
  bold: true,
  strokeColor: '#000000',
  backgroundColor: '#00000000',
};

const DEFAULT_PICTURE_ADJUSTMENT: PictureAdjustment = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

const DEFAULT_MASK: MaskConfig = {
  type: 'none',
  size: 80,
  feather: 0,
};

const ITEM_COLORS: Record<TrackKind, string> = {
  video: '#2866d8',
  image: '#2866d8',
  audio: '#17785f',
  text: '#7d4aa0',
};

interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface PictureAdjustmentPreviewJob {
  pending: PictureAdjustment | null;
  running: Promise<void>;
}

interface MaskPreviewJob {
  pending: MaskConfig | null;
  running: Promise<void>;
}

interface ItemSpriteState {
  item: EditorItem;
  name: string;
  draftSource: DraftSource;
  textStyle?: TextStyle;
  isSubtitle?: boolean;
  transitionIn?: TransitionConfig;
  hasAudio: boolean;
  audioDetached: boolean;
  audioLinkId?: string;
  audioVolume: number;
  time: VisibleSprite['time'];
  rect: Pick<VisibleSprite['rect'], 'x' | 'y' | 'w' | 'h' | 'angle' | 'fixedAspectRatio'>;
  opacity: number;
  zIndex: number;
  visible: boolean;
  interactable: VisibleSprite['interactable'];
  sourceStartUs: number;
  waveform: number[];
}

let itemSeed = 0;

function createItemId(kind: TrackKind) {
  itemSeed += 1;
  return `${kind}-${Date.now()}-${itemSeed}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function textStyleToCss(style: TextStyle) {
  const weight = style.bold ? 700 : 400;
  const stroke = style.strokeColor === '#00000000'
    ? ''
    : `-webkit-text-stroke: 2px ${style.strokeColor};`;
  return `font-size: ${style.fontSize}px; line-height: 1.3; font-weight: ${weight}; color: ${style.color}; background: ${style.backgroundColor}; padding: 8px 14px; ${stroke} text-shadow: 0 2px 8px rgba(0,0,0,.75); font-family: Arial, PingFang SC, Microsoft YaHei, sans-serif;`;
}

function normalizeWaveform(values: number[]) {
  const maximum = Math.max(...values, 0);
  if (maximum <= 0) return values.map(() => 0.08);
  return values.map((value) => clamp(value / maximum, 0.08, 1));
}

function waveformFromPCM(channels: Float32Array[], barCount = 72) {
  const sampleCount = Math.max(...channels.map((channel) => channel.length), 0);
  if (!sampleCount) return [];
  const result: number[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = Math.floor((bar * sampleCount) / barCount);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * sampleCount) / barCount));
    let peak = 0;
    channels.forEach((channel) => {
      for (let index = start; index < Math.min(end, channel.length); index += 1) {
        peak = Math.max(peak, Math.abs(channel[index]));
      }
    });
    result.push(peak);
  }
  return normalizeWaveform(result);
}

function sliceWaveform(values: number[], startRatio: number, endRatio: number) {
  if (!values.length) return [];
  const start = Math.min(values.length - 1, Math.max(0, Math.floor(startRatio * values.length)));
  const end = Math.max(start + 1, Math.min(values.length, Math.ceil(endRatio * values.length)));
  return values.slice(start, end);
}

export class WebAVRuntime {
  private canvas: AVCanvas | null = null;
  private items: EditorItem[] = [];
  private callbacks: RuntimeCallbacks;
  private currentTimeUs = 0;
  private selectedId: string | null = null;
  private preserveSelection = false;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private historyBusy = false;
  private clipEditBusy = false;
  private activeCombinator: Combinator | null = null;
  private exportReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private exportCancelled = false;
  private cleanupListeners: Array<() => void> = [];
  private ownedObjectUrls: string[] = [];
  private pendingKeyframeStarts = new Map<string, KeyframeState>();
  private importQueue: Promise<void> = Promise.resolve();
  private assets: MediaAsset[] = [];
  private addQueue: Promise<void> = Promise.resolve();
  private copyQueue: Promise<void> = Promise.resolve();
  private pictureAdjustmentPreviewJobs = new Map<string, PictureAdjustmentPreviewJob>();
  private maskPreviewJobs = new Map<string, MaskPreviewJob>();

  constructor(callbacks: RuntimeCallbacks) {
    this.callbacks = callbacks;
  }

  async mount(container: HTMLElement) {
    this.canvas = new AVCanvas(container, {
      bgColor: '#050608',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });

    this.cleanupListeners.push(
      this.canvas.on('timeupdate', (timeUs) => {
        this.currentTimeUs = timeUs;
        this.callbacks.onTimeChange(timeUs);
      }),
      this.canvas.on('playing', () => {
        this.callbacks.onPlayingChange(true);
      }),
      this.canvas.on('paused', () => {
        this.callbacks.onPlayingChange(false);
      }),
      this.canvas.on('activeSpriteChange', (sprite) => {
        if (!sprite && this.preserveSelection && this.selectedId) return;
        const item = this.items.find((candidate) => candidate.sprite === sprite);
        this.selectedId = item ? item.id : null;
        this.callbacks.onSelectionChange(this.selectedId);
        if (item) {
          this.callbacks.onPropertiesChange(
            item.id,
            this.readProperties(item.id)!,
          );
        }
      }),
    );

    // An empty project has no timeline clips. Importing and adding are separate.
    this.callbacks.onHistoryChange(false, false);
  }

  isSupported() {
    return (
      typeof window !== 'undefined' &&
      'VideoDecoder' in window &&
      'VideoEncoder' in window &&
      'AudioData' in window
    );
  }

  getItems() {
    return this.items.slice();
  }

  getSelectedId() {
    return this.selectedId;
  }

  getTotalDurationUs() {
    return Math.max(
      ...this.items.map(
        (item) => item.sprite.time.offset + item.sprite.time.duration,
      ),
      0,
    );
  }

  private async addDefaultImage() {
    if (!this.canvas) return;
    const response = await fetch(defaultImageUrl);
    if (!response.body) throw new Error('默认图片读取失败');
    const clip = new ImgClip(response.body);
    await this.registerClip({
      name: 'demo-cover.png',
      kind: 'image',
      clip,
      thumbnailUrl: defaultImageUrl,
      sourceUrl: defaultImageUrl,
      offsetUs: 0,
      durationUs: DEFAULT_IMAGE_DURATION,
      draftSource: { type: 'builtin' },
      recordHistory: false,
    });
    await this.seek(0);
    this.callbacks.onMessage('默认素材已载入，可直接体验编辑功能', 'success');
  }

  async addFiles(files: FileList | File[]) {
    const batch = Array.from(files as ArrayLike<File>);
    const imported: MediaAsset[] = [];
    // Keep library order stable even when metadata resolves asynchronously.
    const pending = this.importQueue.then(async () => {
      for (const file of batch) {
        const asset = await readMediaAsset(file);
        this.assets.push(asset);
        imported.push(asset);
        this.ownedObjectUrls.push(asset.sourceUrl);
        this.callbacks.onAssetsChange?.(this.assets.slice());
      }
    });
    this.importQueue = pending.catch(() => undefined);
    await pending;
    return imported;
  }

  pause() { this.canvas?.pause(); }

  addAssetToTimeline(id: string) {
    const pending = this.addQueue.then(async () => {
      const asset = this.assets.find((candidate) => candidate.id === id);
      if (!asset) throw new Error('素材已移除，请重新导入');
      const mime = asset.blob.type || (asset.kind === 'video' ? 'video/mp4' : asset.kind === 'audio' ? 'audio/mpeg' : 'image/png');
      await this.addFile(new File([asset.blob], asset.name, { type: mime }), asset.id);
    });
    this.addQueue = pending.catch(() => undefined);
    return pending;
  }

  insertAtBoundary(boundary: InsertionBoundary, content: InsertionContent) {
    const pending = this.addQueue.then(async () => {
      if (!this.canvas) throw new Error('编辑器尚未初始化');
      if (this.historyBusy || this.clipEditBusy || this.activeCombinator) throw new Error('正在处理媒体，请稍后再插入');
      this.clipEditBusy = true;
      let prepared: EditorItem | undefined;
      let clip: IClip | undefined;
      try {
        const initial = insertionPlan(this.items, boundary, content.durationUs === undefined ? 1e6 : content.durationUs);
        if (initial.reason) throw new Error(initial.reason);
        if (initial.locked.length) throw new Error('相关轨道已锁定，请选择“解锁并插入”');
        let source: DraftSource;
        let kind: TrackKind;
        let name: string;
        let asset: MediaAsset | undefined;
        if (content.type === 'text') {
          if (!content.text.trim()) throw new Error('请输入文字内容');
          source = { type: 'text', text: content.text.trim(), style: { ...content.style } };
          kind = 'text'; name = content.text.trim().slice(0, 16);
        } else {
          asset = this.assets.find(candidate => candidate.id === content.assetId);
          if (!asset) throw new Error('素材已移除，请重新选择');
          source = { type: 'file', blob: asset.blob }; kind = asset.kind; name = asset.name;
        }
        clip = await this.createClipFromDraftSource(kind, source);
        prepared = await this.registerClip({ kind, name, clip, draftSource: source,
          sourceAssetId: asset?.id, sourceUrl: asset?.sourceUrl,
          thumbnailUrl: kind === 'audio' ? undefined : asset?.sourceUrl,
          offsetUs: boundary.timeUs,
          durationUs: kind === 'image' || kind === 'text' ? content.durationUs : undefined,
          prepareOnly: true, recordHistory: false, announce: false });
        prepared.sprite.visible = content.visible !== false;
        if (kind === 'text') {
          prepared.sprite.zIndex = 10;
          prepared.sprite.rect.y = CANVAS_HEIGHT - prepared.sprite.rect.h - 72;
        }
        // Recheck after asynchronous decoding; use actual decoded duration for media.
        const plan = insertionPlan(this.items, boundary, prepared.sprite.time.duration);
        if (plan.reason) throw new Error(plan.reason);
        if (plan.locked.length) throw new Error('相关轨道已锁定，请选择“解锁并插入”');
        const before = this.items.filter(item => !plan.crossing.includes(item)
          && (plan.moved.includes(item) || plan.transitions.includes(item))).map(item => ({ item, offset: item.sprite.time.offset,
          transition: item.transitionIn ? { ...item.transitionIn } : undefined }));
        const after = before.map(entry => ({ ...entry,
          offset: plan.moved.includes(entry.item) ? Math.max(boundary.timeUs, entry.offset) + plan.durationUs : entry.offset,
          transition: entry.transition && !plan.transitions.includes(entry.item) ? { ...entry.transition,
            originalStartUs: entry.transition.originalStartUs + plan.durationUs } : undefined }));
        const state = this.captureItemSpriteState(prepared);
        const oldSelected = this.selectedId;
        const oldTime = this.currentTimeUs;
        const oldOrder = this.items.slice();
        const originals = plan.crossing.map(item => this.captureItemSpriteState(item));
        const splitStates: ItemSpriteState[] = [];
        const replacements = new Map<EditorItem, EditorItem[]>();
        const splitLinks = new Map<string, string[]>();
        for (const original of originals) {
          const leftDuration = boundary.timeUs - original.time.offset;
          const ratio = leftDuration / original.time.duration;
          const animation = original.item.keyframeAnimation;
          const midpoint = animation ? this.getKeyframeStateAt(original.item, ratio) : undefined;
          if (original.audioLinkId && !original.audioDetached && !splitLinks.has(original.audioLinkId)) {
            splitLinks.set(original.audioLinkId, [createItemId('audio'), createItemId('audio')]);
          }
          const parts = [0, 1].map(part => {
            const nextItem = { ...original.item, id: createItemId(original.item.kind),
              keyframeAnimation: animation && midpoint ? {
                start: { ...(part === 0 ? animation.start : midpoint) },
                end: { ...(part === 0 ? midpoint : animation.end) },
              } : undefined };
            const nextState: ItemSpriteState = { ...original, item: nextItem,
              audioLinkId: original.audioLinkId && !original.audioDetached ? splitLinks.get(original.audioLinkId)![part] : original.audioLinkId,
              transitionIn: part === 0 && !plan.transitions.includes(original.item) ? original.transitionIn : undefined,
              time: { ...original.time,
                offset: part === 0 ? original.time.offset : boundary.timeUs + plan.durationUs,
                duration: part === 0 ? leftDuration : original.time.duration - leftDuration },
              sourceStartUs: original.sourceStartUs + (part === 0 ? 0 : leftDuration * original.time.playbackRate),
              waveform: sliceWaveform(original.waveform, part === 0 ? 0 : ratio, part === 0 ? ratio : 1),
            };
            splitStates.push(nextState);
            return nextItem;
          });
          replacements.set(original.item, parts);
        }
        const newOrder = oldOrder.reduce<EditorItem[]>((result, item) => result.concat(replacements.get(item) || [item]), []);
        newOrder.push(state.item);
        const apply = async (present: boolean, timings: typeof before, selection: string | null, time: number,
          readySprite?: VisibleSprite) => {
          if (!this.canvas) throw new Error('编辑器已关闭');
          this.canvas.pause();
          this.callbacks.onPlayingChange(false);
          const previous = timings.map(entry => ({ item: entry.item, offset: entry.item.sprite.time.offset,
            transition: entry.item.transitionIn ? { ...entry.item.transitionIn } : undefined }));
          const previousSelection = this.selectedId;
          const previousTime = this.currentTimeUs;
          const previousOrder = this.items.slice();
          const incoming = present ? [...splitStates, state] : originals;
          const outgoing = present ? originals : [...splitStates, state];
          const added: Array<{ state: ItemSpriteState; sprite: VisibleSprite; attached: boolean }> = [];
          const hidden = outgoing.map(entry => ({ sprite: entry.item.sprite, visible: entry.item.sprite.visible }));
          const setTimes = (entries: typeof before) => entries.forEach(entry => {
            entry.item.sprite.time.offset = entry.offset;
            entry.item.transitionIn = entry.transition ? { ...entry.transition } : undefined;
          });
          try {
            for (const entry of incoming) {
              const sprite = entry === state && readySprite ? readySprite : await this.recreateItemSprite(entry.item, entry);
              added.push({ state: entry, sprite, attached: false });
            }
            for (const entry of added) {
              await this.canvas.addSprite(entry.sprite);
              entry.attached = true;
              this.applyItemSpriteState(entry.state, entry.sprite);
            }
            hidden.forEach(entry => { entry.sprite.visible = false; });
            this.items = (present ? newOrder : oldOrder).slice();
            setTimes(timings);
            this.restoreSpriteAnimations();
            await this.seek(time);
          } catch (error) {
            setTimes(previous);
            this.items = previousOrder;
            added.forEach(entry => {
              if (entry.attached) this.canvas!.removeSprite(entry.sprite);
              else entry.sprite.destroy();
            });
            hidden.forEach(entry => { entry.sprite.visible = entry.visible; });
            this.restoreSpriteAnimations();
            this.select(previousSelection);
            await this.seek(previousTime).catch(() => undefined);
            throw error;
          }
          hidden.forEach(entry => this.canvas!.removeSprite(entry.sprite));
          this.notifyItems();
          this.select(selection);
        };
        await apply(true, after, prepared.id, boundary.timeUs, prepared.sprite);
        this.recordHistory({ label: `插入 ${prepared.name}`,
          undo: () => apply(false, before, oldSelected, oldTime),
          redo: () => apply(true, after, state.item.id, boundary.timeUs) });
        this.callbacks.onMessage('已插入，后续内容已同步后移', 'success', 'undo');
        return prepared.id;
      } catch (error) {
        if (prepared && !this.items.includes(prepared)) prepared.sprite.destroy();
        else if (!prepared) clip?.destroy();
        throw error;
      } finally { this.clipEditBusy = false; }
    });
    this.addQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  removeAsset(id: string, confirm: (asset: MediaAsset, items: EditorItem[]) => boolean | Promise<boolean>) {
    // Serialize with decoding/addition so a late add cannot resurrect deleted media.
    const pending = this.addQueue.then(async () => {
      const assetIndex = this.assets.findIndex((candidate) => candidate.id === id);
      if (assetIndex < 0 || !this.canvas) return false;
      const asset = this.assets[assetIndex];
      for (const item of this.items) {
        if (!item.sourceAssetId && item.draftSource.type === 'file'
          && await sameBlob(item.draftSource.blob, asset.blob)) {
          throw new Error('旧草稿重复导入了相同文件，无法确定片段来源。请先从时间轴删除这些片段，再删除素材');
        }
      }
      const removed = this.items.map((item, index) => ({ item, index }))
        .filter(({ item }) => item.sourceAssetId === id);
      if (removed.some(({ item }) => item.sprite.interactable === 'disabled')) {
        throw new Error('该素材的时间轴片段或关联原声已锁定，请先解锁后再删除');
      }
      const remaining = this.items.filter((item) => item.sourceAssetId !== id);
      const mapTime = createDeletionTimeMapper(
        removed.map(({ item }) => item.sprite.time), remaining.map((item) => item.sprite.time),
      );
      const moved = remaining.map((item) => ({
        item,
        before: item.sprite.time.offset,
        after: mapTime(item.sprite.time.offset),
        transitionStart: item.transitionIn?.originalStartUs,
      })).filter((entry) => entry.before !== entry.after);
      if (moved.some(({ item }) => item.sprite.interactable === 'disabled')) {
        throw new Error('删除后需要前移的片段已锁定，请先解锁后再删除');
      }
      if (!await confirm(asset, removed.map(({ item }) => item))) return false;
      const previousSelection = this.selectedId;
      const previousTime = this.currentTimeUs;
      const applyPositions = (restore: boolean) => {
        moved.forEach(({ item, before, after, transitionStart }) => {
          item.sprite.time.offset = restore ? before : after;
          if (item.transitionIn && transitionStart !== undefined) {
            item.transitionIn.originalStartUs = restore ? transitionStart : mapTime(transitionStart);
          }
        });
      };
      const remove = async () => {
        this.canvas!.pause();
        this.callbacks.onPlayingChange(false);
        removed.forEach(({ item }) => this.canvas!.removeSprite(item.sprite));
        this.items = this.items.filter((item) => item.sourceAssetId !== id);
        this.assets = this.assets.filter((candidate) => candidate.id !== id);
        applyPositions(false);
        this.notifyItems();
        this.callbacks.onAssetsChange?.(this.assets.slice());
        this.select(this.items.some((item) => item.id === this.selectedId) ? this.selectedId : null);
        await this.seek(mapTime(previousTime));
      };
      await remove();
      // Keep blob URLs alive for undo; dispose() releases them with the runtime.
      this.recordHistory({
        label: `删除素材 ${asset.name} 及 ${removed.length} 个时间轴片段`,
        undo: async () => {
          if (!this.canvas) return;
          this.canvas.pause();
          this.callbacks.onPlayingChange(false);
          for (const entry of removed) {
            entry.item.sprite = await this.recreateItemSprite(entry.item);
            await this.canvas.addSprite(entry.item.sprite);
            this.items.splice(Math.min(entry.index, this.items.length), 0, entry.item);
          }
          this.assets.splice(Math.min(assetIndex, this.assets.length), 0, asset);
          applyPositions(true);
          this.notifyItems();
          this.callbacks.onAssetsChange?.(this.assets.slice());
          this.select(previousSelection);
          await this.seek(previousTime);
        },
        redo: remove,
      });
      this.callbacks.onMessage(`已删除素材及 ${removed.length} 个时间轴片段，电脑原文件保留`, 'success', 'undo');
      return true;
    });
    this.addQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async readAudioInfo(clip: IClip, kind: TrackKind) {
    const isAudioClip = clip instanceof AudioClip;
    const isMP4Clip = clip instanceof MP4Clip;
    const hasAudio = isAudioClip
      ? clip.meta.chanCount > 0
      : isMP4Clip
        ? clip.meta.audioChanCount > 0
        : false;
    if (!hasAudio || (kind !== 'audio' && kind !== 'video')) {
      return { hasAudio: false, waveform: [] as number[] };
    }

    if (isAudioClip) {
      return {
        hasAudio: true,
        waveform: waveformFromPCM(clip.getPCMData()),
      };
    }

    const sampleClip = await clip.clone();
    const durationUs = Math.max(1, sampleClip.meta.duration);
    const peaks: number[] = [];
    try {
      const barCount = 56;
      for (let bar = 0; bar < barCount; bar += 1) {
        const startUs = Math.floor((bar * durationUs) / barCount);
        const endUs = Math.min(durationUs, startUs + 75000);
        const startResult = await sampleClip.tick(startUs);
        startResult.video?.close();
        const result = await sampleClip.tick(endUs);
        let peak = 0;
        (result.audio || []).forEach((channel) => {
          for (let index = 0; index < channel.length; index += 1) {
            peak = Math.max(peak, Math.abs(channel[index]));
          }
        });
        result.video?.close();
        peaks.push(peak);
      }
      return { hasAudio: true, waveform: normalizeWaveform(peaks) };
    } catch (error) {
      return { hasAudio: true, waveform: [] as number[] };
    } finally {
      sampleClip.destroy();
    }
  }

  private async addFile(file: File, sourceAssetId: string) {
    if (!this.canvas) return;
    const majorType = file.type.split('/')[0];
    const objectUrl = URL.createObjectURL(file);
    this.ownedObjectUrls.push(objectUrl);

    if (majorType === 'video') {
      const clip = new MP4Clip(file.stream(), { audio: true });
      await this.registerClip({
        name: file.name,
        kind: 'video',
        sourceAssetId,
        clip,
        thumbnailUrl: objectUrl,
        sourceUrl: objectUrl,
        draftSource: { type: 'file', blob: file },
        offsetUs: this.getTotalDurationUs(),
      });
      return;
    }

    if (majorType === 'audio') {
      const clip = new AudioClip(file.stream(), { volume: 1 });
      await this.registerClip({
        name: file.name,
        kind: 'audio',
        sourceAssetId,
        clip,
        sourceUrl: objectUrl,
        draftSource: { type: 'file', blob: file },
        offsetUs: this.getTotalDurationUs(),
      });
      return;
    }

    if (majorType === 'image') {
      const clip = new ImgClip(file.stream());
      await this.registerClip({
        name: file.name,
        kind: 'image',
        sourceAssetId,
        clip,
        thumbnailUrl: objectUrl,
        sourceUrl: objectUrl,
        draftSource: { type: 'file', blob: file },
        offsetUs: this.getTotalDurationUs(),
        durationUs: DEFAULT_IMAGE_DURATION,
      });
      return;
    }

    URL.revokeObjectURL(objectUrl);
    this.ownedObjectUrls = this.ownedObjectUrls.filter(
      (url) => url !== objectUrl,
    );
    throw new Error(`暂不支持 ${file.name} 的文件格式`);
  }

  async extractAudio(id: string) {
    if (!this.canvas) throw new Error('编辑器尚未初始化');
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'video') throw new Error('请先选择一个视频素材');
    if (!item.hasAudio || item.audioDetached) throw new Error('该视频没有可分离的原声');
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    await this.detachVideoAudio(item, {
      name: `${item.name} · 分离原声`,
      recordHistory: true,
      announce: true,
      selectAudio: true,
    });
  }

  private async detachVideoAudio(
    item: EditorItem,
    options: {
      name: string;
      recordHistory: boolean;
      announce: boolean;
      selectAudio: boolean;
    },
  ) {
    if (!this.canvas) throw new Error('编辑器尚未初始化');
    const clip = item.sprite.getClip();
    if (!(clip instanceof MP4Clip)) throw new Error('当前视频格式不支持分离音频');

    const tracks = await clip.splitTrack();
    const videoTrack = tracks.find((track) => track.meta.width > 0);
    const audioTrack = tracks.find((track) => track.meta.audioChanCount > 0 && track.meta.width === 0);
    if (!videoTrack || !audioTrack) {
      tracks.forEach((track) => track.destroy());
      throw new Error('该视频没有可分离的原声');
    }

    const oldSprite = item.sprite;
    const beforeState = this.captureItemSpriteState(item);
    const itemIndex = this.items.indexOf(item);
    const oldAudioVolume = item.audioVolume;
    const audioLinkId = item.audioLinkId || `audio-link-${item.id}`;
    const videoSprite = new VisibleSprite(videoTrack);
    await videoSprite.ready;
    oldSprite.copyStateTo(videoSprite);
    this.bindSpriteProperties(item, videoSprite);
    this.bindClipEffects(item, videoSprite);
    await this.canvas.addSprite(videoSprite);
    this.canvas.removeSprite(oldSprite);
    item.sprite = videoSprite;
    item.hasAudio = false;
    item.audioWaveform = [];
    item.audioDetached = true;
    item.audioLinkId = audioLinkId;
    item.audioVolume = 100;

    const audioItem = await this.registerClip({
      name: options.name,
      kind: 'audio',
      clip: audioTrack,
      draftSource: item.draftSource,
      sourceAssetId: item.sourceAssetId,
      offsetUs: videoSprite.time.offset,
      durationUs: videoSprite.time.duration,
      recordHistory: false,
      announce: false,
    });
    audioItem.sourceStartUs = item.sourceStartUs;
    audioItem.sprite.time.playbackRate = videoSprite.time.playbackRate;
    audioItem.audioDetached = true;
    audioItem.audioLinkId = audioLinkId;
    audioItem.audioVolume = oldAudioVolume;
    const audioIndex = this.items.indexOf(audioItem);

    this.notifyItems();
    this.select(options.selectAudio ? audioItem.id : item.id);
    await this.seek(item.sprite.time.offset);
    if (options.recordHistory) {
      const videoState = this.captureItemSpriteState(item);
      const audioState = this.captureItemSpriteState(audioItem);
      this.recordHistory({
        label: '分离音频',
        undo: () => this.replaceTimelineItems(
          [item, audioItem], [{ state: beforeState, index: itemIndex }],
          item.id, beforeState.time.offset,
        ),
        redo: () => this.replaceTimelineItems(
          [item], [
            { state: videoState, index: itemIndex },
            { state: audioState, index: audioIndex },
          ], options.selectAudio ? audioItem.id : item.id, videoState.time.offset,
        ),
      });
    } else {
      oldSprite.destroy();
    }
    if (options.announce) {
      this.callbacks.onMessage('视频原声已分离，可独立移动、裁剪、分割或删除', 'success');
    }
    return audioItem;
  }

  async addText(text: string, style: TextStyle = DEFAULT_TEXT_STYLE) {
    if (!text.trim()) throw new Error('请输入文字内容');
    const bitmap = await renderTxt2ImgBitmap(
      text.trim(),
      textStyleToCss(style),
    );
    const clip = new ImgClip(bitmap);
    const item = await this.registerClip({
      name: text.trim().slice(0, 16),
      kind: 'text',
      clip,
      draftSource: { type: 'text', text: text.trim(), style },
      offsetUs: this.currentTimeUs,
      durationUs: DEFAULT_TEXT_DURATION,
    });
    item.sprite.zIndex = 10;
    item.textStyle = { ...style };
    item.sprite.rect.y = CANVAS_HEIGHT - item.sprite.rect.h - 72;
    await this.seek(this.currentTimeUs);
  }

  async updateText(id: string, text: string, style: TextStyle) {
    if (!this.canvas || !text.trim()) throw new Error('请输入文字内容');
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'text') throw new Error('请先选择文字素材');
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');

    const bitmap = await renderTxt2ImgBitmap(text.trim(), textStyleToCss(style));
    const clip = new ImgClip(bitmap);
    const oldSprite = item.sprite;
    const beforeState = this.captureItemSpriteState(item);
    const nextSprite = new VisibleSprite(clip);
    await nextSprite.ready;
    const centerX = oldSprite.rect.x + oldSprite.rect.w / 2;
    const centerY = oldSprite.rect.y + oldSprite.rect.h / 2;
    this.fitSprite(nextSprite);
    nextSprite.rect.x = Math.round(centerX - nextSprite.rect.w / 2);
    nextSprite.rect.y = Math.round(centerY - nextSprite.rect.h / 2);
    nextSprite.rect.angle = oldSprite.rect.angle;
    nextSprite.opacity = oldSprite.opacity;
    nextSprite.time = { ...oldSprite.time };
    nextSprite.zIndex = oldSprite.zIndex;
    nextSprite.visible = oldSprite.visible;
    nextSprite.interactable = oldSprite.interactable;
    this.bindSpriteProperties(item, nextSprite);

    const nextName = text.trim().slice(0, 16);
    const nextSource: DraftSource = { type: 'text', text: text.trim(), style };
    await this.replaceTextSprite(item, nextSprite, nextName, nextSource, style);
    const afterState = this.captureItemSpriteState(item);
    this.recordHistory({
      label: '修改文字样式',
      undo: () => this.replaceItemSpriteStates([beforeState], item.id),
      redo: () => this.replaceItemSpriteStates([afterState], item.id),
    });
    this.callbacks.onMessage('文字内容和样式已更新', 'success');
  }

  async addSubtitles(cues: SubtitleCue[]) {
    if (!this.canvas || !cues.length) throw new Error('没有可生成的字幕内容');
    const replacedItems = this.items.filter((item) => item.isSubtitle);
    if (replacedItems.some((item) => item.sprite.interactable === 'disabled')) {
      throw new Error('文本轨道已锁定，请解锁后更新字幕');
    }
    const replacedEntries = replacedItems.map((item) => ({
      state: this.captureItemSpriteState(item),
      index: this.items.indexOf(item),
    }));
    const previousSelectedId = this.selectedId;
    const previousTimeUs = this.currentTimeUs;
    const subtitleStyle: TextStyle = {
      fontSize: 44,
      color: '#ffffff',
      bold: true,
      strokeColor: '#000000',
      backgroundColor: '#00000000',
    };
    const createdItems: EditorItem[] = [];
    try {
      for (const cue of cues) {
        const bitmap = await renderTxt2ImgBitmap(
          cue.text,
          textStyleToCss(subtitleStyle),
        );
        const item = await this.registerClip({
          name: `[字幕] ${cue.text.slice(0, 14)}`,
          kind: 'text',
          clip: new ImgClip(bitmap),
          draftSource: { type: 'text', text: cue.text, style: subtitleStyle },
          offsetUs: cue.startUs,
          durationUs: cue.endUs - cue.startUs,
          isSubtitle: true,
          recordHistory: false,
          announce: false,
        });
        item.sprite.zIndex = 12;
        item.sprite.rect.y = CANVAS_HEIGHT - item.sprite.rect.h - 48;
        item.textStyle = { ...subtitleStyle };
        createdItems.push(item);
      }
    } catch (error) {
      if (createdItems.length) {
        await this.replaceTimelineItems(
          createdItems,
          [],
          previousSelectedId,
          previousTimeUs,
        );
      }
      throw error;
    }
    const selectedItem = createdItems[createdItems.length - 1];
    if (replacedItems.length) {
      await this.replaceTimelineItems(
        replacedItems,
        [],
        selectedItem.id,
        selectedItem.sprite.time.offset,
      );
    } else {
      this.notifyItems();
      this.select(selectedItem.id);
      await this.seek(selectedItem.sprite.time.offset);
    }
    const createdStates = createdItems.map((item) => this.captureItemSpriteState(item));
    const createdEntries = createdStates.map((state) => ({
      state, index: this.items.indexOf(state.item),
    }));
    this.recordHistory({
      label: `${replacedItems.length ? '更新' : '生成'} ${createdItems.length} 条字幕`,
      undo: () => this.replaceTimelineItems(
        createdItems,
        replacedEntries,
        previousSelectedId,
        previousTimeUs,
      ),
      redo: () => this.replaceTimelineItems(
        replacedItems, createdEntries,
        selectedItem.id,
        createdStates[createdStates.length - 1].time.offset,
      ),
    });
    this.callbacks.onMessage(
      `已${replacedItems.length ? '更新' : '生成'} ${createdItems.length} 条字幕`,
      'success',
    );
  }

  async clearSubtitles() {
    if (!this.canvas) return 0;
    const subtitleItems = this.items.filter((item) => item.isSubtitle);
    if (!subtitleItems.length) return 0;
    if (subtitleItems.some((item) => item.sprite.interactable === 'disabled')) {
      throw new Error('文本轨道已锁定，请解锁后清空字幕');
    }
    const removedEntries = subtitleItems.map((item) => ({
      state: this.captureItemSpriteState(item),
      index: this.items.indexOf(item),
    }));
    const previousSelectedId = this.selectedId;
    const previousTimeUs = this.currentTimeUs;
    const nextSelectedId = previousSelectedId
      && subtitleItems.some((item) => item.id === previousSelectedId)
      ? null
      : previousSelectedId;
    await this.replaceTimelineItems(
      subtitleItems,
      [],
      nextSelectedId,
      previousTimeUs,
    );
    this.recordHistory({
      label: `清空 ${subtitleItems.length} 条字幕`,
      undo: () => this.replaceTimelineItems(
        [],
        removedEntries,
        previousSelectedId,
        previousTimeUs,
      ),
      redo: () => this.replaceTimelineItems(
        subtitleItems,
        [],
        nextSelectedId,
        previousTimeUs,
      ),
    });
    this.callbacks.onMessage(`已同步清空 ${subtitleItems.length} 条字幕`, 'info', 'undo');
    return subtitleItems.length;
  }

  private async registerClip(args: {
    sourceAssetId?: string;
    name: string;
    kind: TrackKind;
    clip: IClip;
    thumbnailUrl?: string;
    sourceUrl?: string;
    draftSource: DraftSource;
    offsetUs: number;
    durationUs?: number;
    isSubtitle?: boolean;
    recordHistory?: boolean;
    announce?: boolean;
    prepareOnly?: boolean;
  }) {
    if (!this.canvas) throw new Error('编辑器尚未初始化');

    const sprite = new VisibleSprite(args.clip);
    await sprite.ready;
    const clipDuration = args.clip.meta.duration;
    const safeDuration = Number.isFinite(clipDuration)
      ? clipDuration
      : args.durationUs || DEFAULT_IMAGE_DURATION;
    const audioInfo = await this.readAudioInfo(args.clip, args.kind);

    sprite.time = {
      offset: args.offsetUs,
      duration: args.durationUs || safeDuration,
      playbackRate: 1,
    };

    if (args.kind !== 'audio') {
      this.fitSprite(sprite);
    }

    const item: EditorItem = {
      id: createItemId(args.kind),
      sourceAssetId: args.sourceAssetId,
      name: args.name,
      kind: args.kind,
      sprite,
      thumbnailUrl: args.thumbnailUrl,
      sourceUrl: args.sourceUrl,
      draftSource: args.draftSource,
      sourceStartUs: 0,
      textStyle:
        args.draftSource.type === 'text'
          ? { ...args.draftSource.style }
          : undefined,
      isSubtitle: args.isSubtitle,
      hasAudio: audioInfo.hasAudio,
      audioWaveform: audioInfo.waveform,
      audioDetached: false,
      audioVolume: 100,
      pictureAdjustment: { ...DEFAULT_PICTURE_ADJUSTMENT },
      mask: { ...DEFAULT_MASK },
      color: ITEM_COLORS[args.kind],
    };
    this.bindClipEffects(item, sprite);

    this.bindSpriteProperties(item, sprite);

    if (args.prepareOnly) return item;

    await this.canvas.addSprite(sprite);
    this.items.push(item);
    this.notifyItems();
    this.select(item.id);
    await this.seek(args.offsetUs);
    if (args.recordHistory !== false) {
      const itemIndex = this.items.indexOf(item);
      const itemState = this.captureItemSpriteState(item);
      this.recordHistory({
        label: `添加 ${item.name}`,
        undo: () => this.replaceTimelineItems([item], [], null, this.currentTimeUs),
        redo: () => this.replaceTimelineItems([], [{ state: itemState, index: itemIndex }], item.id, itemState.time.offset),
      });
    }
    if (args.announce !== false) {
      this.callbacks.onMessage(`${args.name} 已加入时间轴`, 'success');
    }
    return item;
  }

  private fitSprite(sprite: VisibleSprite) {
    if (!sprite.rect.w || !sprite.rect.h) return;
    const scale = Math.min(
      CANVAS_WIDTH / sprite.rect.w,
      CANVAS_HEIGHT / sprite.rect.h,
      1,
    );
    sprite.rect.w = Math.round(sprite.rect.w * scale);
    sprite.rect.h = Math.round(sprite.rect.h * scale);
    sprite.rect.x = Math.round((CANVAS_WIDTH - sprite.rect.w) / 2);
    sprite.rect.y = Math.round((CANVAS_HEIGHT - sprite.rect.h) / 2);
    sprite.rect.fixedAspectRatio = true;
  }

  select(id: string | null) {
    this.selectedId = id;
    const item = this.items.find((candidate) => candidate.id === id) || null;
    if (this.canvas) {
      this.preserveSelection = true;
      this.canvas.activeSprite = item && item.kind !== 'audio' ? item.sprite : null;
      this.preserveSelection = false;
    }
    this.callbacks.onSelectionChange(id);
    if (item) {
      this.callbacks.onPropertiesChange(item.id, this.readProperties(item.id)!);
    }
  }

  async selectAndReveal(id: string) {
    if (!this.canvas) return;
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;

    const frameUs = 33333;
    const transitionEndUs = (item.transitionIn?.durationUs || 0) + frameUs;
    const lastVisibleFrameUs = Math.max(0, item.sprite.time.duration - frameUs);
    const previewOffsetUs = clamp(
      transitionEndUs,
      Math.min(frameUs, lastVisibleFrameUs),
      lastVisibleFrameUs,
    );

    this.canvas.pause();
    this.select(id);
    this.preserveSelection = true;
    try {
      await this.seek(item.sprite.time.offset + previewOffsetUs);
    } finally {
      this.preserveSelection = false;
      if (this.canvas && this.selectedId === id) {
        this.preserveSelection = true;
        this.canvas.activeSprite = item.kind === 'audio' ? null : item.sprite;
        this.preserveSelection = false;
      }
    }
  }

  readProperties(id: string): SpriteProperties | null {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    const { rect, time, opacity } = item.sprite;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.w),
      height: Math.round(rect.h),
      rotation: Math.round(radiansToDegrees(rect.angle)),
      opacity: Math.round(opacity * 100),
      start: Number((time.offset / 1e6).toFixed(2)),
      duration: Number((time.duration / 1e6).toFixed(2)),
      speed: Number(time.playbackRate.toFixed(2)),
    };
  }

  async updateProperties(id: string, patch: Partial<SpriteProperties>) {
    const editableItem = this.items.find((candidate) => candidate.id === id);
    if (editableItem?.sprite.interactable === 'disabled') {
      throw new Error('当前轨道已锁定');
    }
    const before = this.readProperties(id);
    await this.applyProperties(id, patch);
    const after = this.readProperties(id);
    if (!before || !after) return;
    const beforePatch: Partial<SpriteProperties> = {};
    const afterPatch: Partial<SpriteProperties> = {};
    (Object.keys(patch) as Array<keyof SpriteProperties>).forEach((key) => {
      beforePatch[key] = before[key] as never;
      afterPatch[key] = after[key] as never;
    });
    this.recordHistory({
      label: '修改素材属性',
      undo: () => this.applyProperties(id, beforePatch),
      redo: () => this.applyProperties(id, afterPatch),
    });
  }

  private async applyProperties(id: string, patch: Partial<SpriteProperties>) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const { sprite } = item;

    if (patch.x !== undefined) sprite.rect.x = patch.x;
    if (patch.y !== undefined) sprite.rect.y = patch.y;
    if (patch.width !== undefined) sprite.rect.w = Math.max(1, patch.width);
    if (patch.height !== undefined) sprite.rect.h = Math.max(1, patch.height);
    if (patch.rotation !== undefined) {
      sprite.rect.angle = degreesToRadians(patch.rotation);
    }
    if (patch.opacity !== undefined) {
      sprite.opacity = clamp(patch.opacity, 0, 100) / 100;
    }
    if (patch.start !== undefined) {
      sprite.time.offset = Math.max(0, patch.start * 1e6);
    }
    if (patch.duration !== undefined) {
      const clipDuration = sprite.getClip().meta.duration;
      const nextDuration = Math.max(0.1, patch.duration) * 1e6;
      sprite.time.duration = Number.isFinite(clipDuration)
        ? Math.min(nextDuration, clipDuration)
        : nextDuration;
    }
    if (patch.speed !== undefined) {
      sprite.time.playbackRate = clamp(patch.speed, 0.5, 2);
    }

    const linkedItem = this.getLinkedItem(item);
    if (linkedItem) {
      if (patch.start !== undefined) {
        linkedItem.sprite.time.offset = sprite.time.offset;
      }
      if (patch.duration !== undefined) {
        linkedItem.sprite.time.duration = sprite.time.duration;
      }
      if (patch.speed !== undefined) {
        linkedItem.sprite.time.playbackRate = sprite.time.playbackRate;
      }
    }

    this.notifyItems();
    const properties = this.readProperties(id);
    if (properties) this.callbacks.onPropertiesChange(id, properties);
    await this.refreshPreviewWithSelection(id, sprite);
  }

  async moveItem(id: string, startUs: number) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const linkedItem = this.getLinkedItem(item);
    const movedItems = linkedItem ? [item, linkedItem] : [item];
    if (movedItems.some((candidate) => candidate.sprite.interactable === 'disabled')) {
      throw new Error(linkedItem ? '视频或关联原声轨道已锁定' : '当前轨道已锁定');
    }
    const beforeStartUs = item.sprite.time.offset;
    const afterStartUs = Math.max(0, Math.round(startUs));
    const deltaUs = afterStartUs - beforeStartUs;
    const beforeStarts = movedItems.map((candidate) => ({
      id: candidate.id,
      startUs: candidate.sprite.time.offset,
    }));
    const afterStarts = movedItems.map((candidate) => ({
      id: candidate.id,
      startUs: Math.max(0, candidate.sprite.time.offset + deltaUs),
    }));
    await this.applyItemStarts(afterStarts, id);
    this.recordHistory({
      label: linkedItem ? '移动视频及原声' : '移动素材',
      undo: () => this.applyItemStarts(beforeStarts, id),
      redo: () => this.applyItemStarts(afterStarts, id),
    });
    this.callbacks.onMessage(
      `${linkedItem ? '视频和原声' : '素材'}已移动到 ${(item.sprite.time.offset / 1e6).toFixed(1)} 秒`,
      'success',
    );
  }

  async trimItem(
    id: string,
    edge: 'start' | 'end',
    startUs: number,
    durationUs: number,
  ) {
    if (!this.canvas) return;
    if (this.historyBusy || this.clipEditBusy) throw new Error('正在恢复媒体，请稍后再裁剪');
    const itemIndex = this.items.findIndex((candidate) => candidate.id === id);
    if (itemIndex < 0) return;
    const item = this.items[itemIndex];
    const linkedItem = this.getLinkedItem(item);
    const trimmedItems = linkedItem ? [item, linkedItem] : [item];
    if (trimmedItems.some((candidate) => candidate.sprite.interactable === 'disabled')) {
      throw new Error(linkedItem ? '视频或关联原声轨道已锁定' : '当前轨道已锁定');
    }
    const oldStartUs = item.sprite.time.offset;
    const oldDurationUs = item.sprite.time.duration;
    const nextStartUs = Math.max(oldStartUs, Math.round(startUs));
    const nextDurationUs = Math.max(1e5, Math.round(durationUs));
    const canExtendRight = edge === 'end' && (item.kind === 'text' || item.kind === 'image');
    const primaryTrimPointUs = edge === 'start'
      ? nextStartUs - oldStartUs
      : nextDurationUs;
    if (
      primaryTrimPointUs <= 0
      || (!canExtendRight && primaryTrimPointUs >= oldDurationUs)
    ) {
      throw new Error('裁剪位置需要位于素材内部');
    }
    if (nextStartUs === oldStartUs && nextDurationUs === oldDurationUs) return;

    const startTrimUs = edge === 'start' ? nextStartUs - oldStartUs : 0;
    const endTrimUs = edge === 'end' ? oldDurationUs - nextDurationUs : 0;
    const trimStates: Array<{ before: ItemSpriteState; after: ItemSpriteState }> = [];
    for (const targetItem of trimmedItems) {
      const targetOldSprite = targetItem.sprite;
      const targetOldDurationUs = targetOldSprite.time.duration;
      const targetStartUs = edge === 'start'
        ? targetOldSprite.time.offset + startTrimUs
        : targetOldSprite.time.offset;
      const targetDurationUs = edge === 'start'
        ? targetOldDurationUs - startTrimUs
        : targetOldDurationUs - endTrimUs;
      const targetTrimPointUs = edge === 'start' ? startTrimUs : targetDurationUs;
      const targetCanExtendRight = edge === 'end'
        && (targetItem.kind === 'text' || targetItem.kind === 'image');
      if (
        targetTrimPointUs <= 0
        || (!targetCanExtendRight && targetTrimPointUs >= targetOldDurationUs)
      ) {
        throw new Error('关联原声无法按当前位置裁剪');
      }
      const splitTimeUs = targetTrimPointUs * targetOldSprite.time.playbackRate;
      const before = this.captureItemSpriteState(targetItem);
      const nextWaveform = edge === 'start'
        ? sliceWaveform(before.waveform, startTrimUs / targetOldDurationUs, 1)
        : sliceWaveform(before.waveform, 0, targetDurationUs / targetOldDurationUs);
      trimStates.push({
        before,
        after: {
          ...before,
          time: { ...before.time, offset: targetStartUs, duration: targetDurationUs },
          sourceStartUs: edge === 'start'
            ? targetItem.sourceStartUs + splitTimeUs
            : targetItem.sourceStartUs,
          waveform: nextWaveform,
        },
      });
    }

    await this.replaceItemSpriteStates(
      trimStates.map((state) => state.after),
      id,
    );
    this.recordHistory({
      label: `${canExtendRight && nextDurationUs > oldDurationUs ? '延长' : `${edge === 'start' ? '左侧' : '右侧'}裁剪`}${linkedItem ? '视频及原声' : ''}`,
      undo: () => this.replaceItemSpriteStates(
        trimStates.map((state) => state.before),
        id,
      ),
      redo: () => this.replaceItemSpriteStates(
        trimStates.map((state) => state.after),
        id,
      ),
    });
    this.callbacks.onMessage(
      `${canExtendRight && nextDurationUs > oldDurationUs ? '时长已延长' : `${edge === 'start' ? '左侧' : '右侧'}裁剪完成`}${linkedItem ? '，对应原声已同步' : ''}，当前时长 ${(nextDurationUs / 1e6).toFixed(1)} 秒`,
      'success',
    );
  }

  async seek(timeUs: number) {
    if (!this.canvas) return;
    const safeTime = clamp(timeUs, 0, this.getTotalDurationUs());
    this.currentTimeUs = safeTime;
    this.callbacks.onTimeChange(safeTime);
    await this.canvas.previewFrame(safeTime);
  }

  togglePlayback(playing: boolean) {
    if (!this.canvas || !this.items.length) return;
    if (playing) {
      this.canvas.pause();
      return;
    }
    const totalDuration = this.getTotalDurationUs();
    const start = this.currentTimeUs >= totalDuration ? 0 : this.currentTimeUs;
    this.canvas.play({ start, end: totalDuration });
  }

  deleteSelected() {
    if (!this.selectedId) return;
    this.deleteItem(this.selectedId);
  }

  deleteItem(id: string) {
    if (!this.canvas) return;
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const item = this.items[index];
    const linkedItem = this.getLinkedItem(item);
    const deletedItems = linkedItem ? [item, linkedItem] : [item];
    if (deletedItems.some((candidate) => candidate.sprite.interactable === 'disabled')) {
      this.callbacks.onMessage(
        linkedItem ? '视频或关联原声轨道已锁定' : '当前轨道已锁定',
        'error',
      );
      return;
    }
    const removedEntries = deletedItems
      .map((candidate) => ({
        item: candidate,
        index: this.items.indexOf(candidate),
      }))
      .sort((left, right) => left.index - right.index);
    removedEntries
      .slice()
      .sort((left, right) => right.index - left.index)
      .forEach((entry) => {
        this.canvas!.removeSprite(entry.item.sprite);
        this.items.splice(entry.index, 1);
      });
    this.selectedId = null;
    this.notifyItems();
    this.callbacks.onSelectionChange(null);
    this.recordHistory({
      label: linkedItem ? `删除 ${item.name} 及原声` : `删除 ${item.name}`,
      undo: async () => {
        if (!this.canvas) return;
        for (const entry of removedEntries) {
          entry.item.sprite = await this.recreateItemSprite(entry.item);
          await this.canvas.addSprite(entry.item.sprite);
          this.items.splice(
            Math.min(entry.index, this.items.length),
            0,
            entry.item,
          );
        }
        this.notifyItems();
        this.select(item.id);
        await this.seek(item.sprite.time.offset);
      },
      redo: async () => {
        if (!this.canvas) return;
        removedEntries.forEach((entry) => {
          this.canvas!.removeSprite(entry.item.sprite);
          const currentIndex = this.items.indexOf(entry.item);
          if (currentIndex >= 0) this.items.splice(currentIndex, 1);
        });
        this.notifyItems();
        this.select(null);
        await this.seek(this.currentTimeUs);
      },
    });
    this.callbacks.onMessage(
      `${item.name}${linkedItem ? ' 及对应原声' : ''}已删除`,
      'info',
      'undo',
    );
  }

  copySelected() {
    // Cloning a WebAV clip is asynchronous. Queue requests so rapid clicks do
    // not all read the same selection and land at the same timeline offset.
    // Each completed copy becomes the selection, so the next queued copy is
    // placed after it and every click keeps its own history entry.
    const pending = this.copyQueue.then(() => this.copySelectedNow());
    this.copyQueue = pending.catch(() => undefined);
    return pending;
  }

  private async copySelectedNow() {
    if (!this.canvas || !this.selectedId) {
      throw new Error('请先选择需要复制的素材');
    }
    const source = this.items.find((item) => item.id === this.selectedId);
    if (!source) return;
    if (source.sprite.interactable === 'disabled') {
      throw new Error('当前轨道已锁定');
    }
    let clip: IClip;
    try {
      clip = await source.sprite.getClip().clone();
    } catch (error) {
      // Restored ImgClip instances may no longer expose a reusable ImageBitmap.
      // Rebuild from the draft source so copying still works after a reload.
      clip = await this.createClipFromDraftSource(source.kind, source.draftSource);
    }
    const sprite = new VisibleSprite(clip);
    await sprite.ready;
    sprite.rect.x = source.sprite.rect.x;
    sprite.rect.y = source.sprite.rect.y;
    sprite.rect.w = source.sprite.rect.w;
    sprite.rect.h = source.sprite.rect.h;
    sprite.rect.angle = source.sprite.rect.angle;
    sprite.rect.fixedAspectRatio = source.sprite.rect.fixedAspectRatio;
    sprite.opacity = source.sprite.opacity;
    sprite.zIndex = source.sprite.zIndex;
    sprite.visible = source.sprite.visible;
    sprite.interactable = source.sprite.interactable;
    sprite.time = {
      offset: source.sprite.time.offset + source.sprite.time.duration,
      duration: source.sprite.time.duration,
      playbackRate: source.sprite.time.playbackRate,
    };
    const copy: EditorItem = {
      ...source,
      id: createItemId(source.kind),
      name: `${source.name.replace(/(?: 副本)+$/, '')} 副本`,
      sprite,
      pictureAdjustment: { ...source.pictureAdjustment },
      mask: { ...source.mask },
      transitionIn: undefined,
      keyframeAnimation: source.keyframeAnimation
        ? {
          start: { ...source.keyframeAnimation.start },
          end: { ...source.keyframeAnimation.end },
        }
        : undefined,
    };
    this.bindSpriteProperties(copy, sprite);
    this.bindClipEffects(copy, sprite);
    const insertIndex = this.items.indexOf(source) + 1;
    await this.canvas.addSprite(sprite);
    this.items.splice(insertIndex, 0, copy);
    this.notifyItems();
    this.select(copy.id);
    await this.seek(sprite.time.offset);
    const copyState = this.captureItemSpriteState(copy);
    this.recordHistory({
      label: `复制 ${source.name}`,
      undo: () => this.replaceTimelineItems([copy], [], source.id, source.sprite.time.offset),
      redo: () => this.replaceTimelineItems([], [{ state: copyState, index: insertIndex }], copy.id, copyState.time.offset),
    });
    this.callbacks.onMessage('素材副本已放到原素材后方', 'success');
  }

  async splitSelected() {
    if (!this.canvas || !this.selectedId) {
      throw new Error('请先选择需要分割的时间轴素材');
    }
    const itemIndex = this.items.findIndex(
      (candidate) => candidate.id === this.selectedId,
    );
    if (itemIndex < 0) return;
    const item = this.items[itemIndex];
    if (item.sprite.interactable === 'disabled') {
      throw new Error('当前轨道已锁定');
    }
    const relativeTime = this.currentTimeUs - item.sprite.time.offset;
    if (relativeTime <= 1e5 || relativeTime >= item.sprite.time.duration - 1e5) {
      throw new Error('播放头需要位于所选素材内部');
    }
    const clip = item.sprite.getClip();
    if (!clip.split) throw new Error('当前素材不支持分割');

    const originalState = this.captureItemSpriteState(item);
    const properties = this.readProperties(item.id)!;
    const zIndex = item.sprite.zIndex;
    const clips = await clip.split(relativeTime * item.sprite.time.playbackRate);
    const offsets = [item.sprite.time.offset, this.currentTimeUs];
    const durations = [relativeTime, item.sprite.time.duration - relativeTime];
    const nextItems: EditorItem[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      let sprite: VisibleSprite | undefined;
      try {
        sprite = new VisibleSprite(clips[index]);
        await sprite.ready;
        sprite.rect.x = properties.x;
        sprite.rect.y = properties.y;
        sprite.rect.w = properties.width;
        sprite.rect.h = properties.height;
        sprite.rect.angle = degreesToRadians(properties.rotation);
        sprite.rect.fixedAspectRatio = true;
        sprite.opacity = properties.opacity / 100;
        sprite.time = {
          offset: offsets[index],
          duration: durations[index],
          playbackRate: properties.speed,
        };
        sprite.zIndex = zIndex;
        sprite.visible = originalState.visible;
        sprite.interactable = originalState.interactable;
        const nextItem: EditorItem = {
          ...item,
          id: createItemId(item.kind),
          name: `${item.name} ${index + 1}`,
          sprite,
          sourceStartUs: item.sourceStartUs + (
            index === 0 ? 0 : relativeTime * properties.speed
          ),
          audioWaveform: sliceWaveform(
            item.audioWaveform,
            index === 0 ? 0 : relativeTime / item.sprite.time.duration,
            index === 0 ? relativeTime / item.sprite.time.duration : 1,
          ),
        };
        this.bindSpriteProperties(nextItem, sprite);
        this.bindClipEffects(nextItem, sprite);
        nextItems.push(nextItem);
      } catch (error) {
        if (sprite) sprite.destroy();
        else clips[index].destroy();
        nextItems.forEach((nextItem) => nextItem.sprite.destroy());
        clips.slice(index + 1).forEach((remaining) => remaining.destroy());
        throw error;
      }
    }
    let addedCount = 0;
    try {
      for (const nextItem of nextItems) {
        await this.canvas.addSprite(nextItem.sprite);
        addedCount += 1;
      }
    } catch (error) {
      nextItems.forEach((nextItem, index) => {
        if (index < addedCount) this.canvas!.removeSprite(nextItem.sprite);
        else nextItem.sprite.destroy();
      });
      throw error;
    }

    this.canvas.removeSprite(item.sprite);
    this.items.splice(itemIndex, 1, ...nextItems);
    this.notifyItems();
    this.select(nextItems[1].id);
    await this.seek(this.currentTimeUs);
    const nextStates = nextItems.map((nextItem) => this.captureItemSpriteState(nextItem));
    this.recordHistory({
      label: '分割素材',
      undo: () => this.replaceTimelineItems(
        nextItems, [{ state: originalState, index: itemIndex }], item.id, this.currentTimeUs,
      ),
      redo: () => this.replaceTimelineItems(
        [item], nextStates.map((state, index) => ({ state, index: itemIndex + index })),
        nextItems[1].id, this.currentTimeUs,
      ),
    });
    this.callbacks.onMessage('素材已按播放头位置分割', 'success');
  }

  async analyzeScenes(id: string): Promise<SceneAnalysisResult> {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.kind !== 'video') throw new Error('请选择需要分析的视频素材');
    const clip = item.sprite.getClip();
    if (!(clip instanceof MP4Clip)) throw new Error('当前视频不支持智能分镜');
    const sourceDurationUs = item.sprite.time.duration * item.sprite.time.playbackRate;
    const sampleStepUs = clamp(
      Math.ceil(sourceDurationUs / 60),
      1e6,
      15e6,
    );
    const thumbnails = await clip.thumbnails(96, {
      start: 0,
      end: sourceDurationUs,
      step: sampleStepUs,
    });
    if (thumbnails.length < 2) throw new Error('视频时长过短，无法分析分镜');

    const signatures: number[][] = [];
    for (const thumbnail of thumbnails) {
      signatures.push(await this.createThumbnailSignature(thumbnail.img));
    }
    const originUs = thumbnails[0].ts;
    const differences = thumbnails.slice(1).map((thumbnail, index) => ({
      index: index + 1,
      timeUs: clamp(
        (thumbnail.ts - originUs) / item.sprite.time.playbackRate,
        0,
        item.sprite.time.duration,
      ),
      score: this.compareThumbnailSignatures(signatures[index], signatures[index + 1]),
    }));
    const mean = differences.reduce((sum, entry) => sum + entry.score, 0) /
      Math.max(differences.length, 1);
    const variance = differences.reduce(
      (sum, entry) => sum + Math.pow(entry.score - mean, 2),
      0,
    ) / Math.max(differences.length, 1);
    const threshold = Math.max(14, mean + Math.sqrt(variance) * 0.8);
    const ranked = differences
      .filter((entry) => (
        entry.timeUs > 5e5 &&
        entry.timeUs < item.sprite.time.duration - 5e5 &&
        entry.score >= threshold
      ))
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) {
      const strongest = differences
        .filter((entry) => entry.score >= 10)
        .sort((left, right) => right.score - left.score)[0];
      if (strongest) ranked.push(strongest);
    }

    const selected: typeof ranked = [];
    for (const entry of ranked) {
      if (selected.length >= 12) break;
      if (selected.every((candidate) => Math.abs(candidate.timeUs - entry.timeUs) >= 2e6)) {
        selected.push(entry);
      }
    }
    selected.sort((left, right) => left.timeUs - right.timeUs);
    const candidates: SceneCandidate[] = selected.map((entry) => {
      const thumbnail = thumbnails[entry.index];
      const thumbnailUrl = URL.createObjectURL(thumbnail.img);
      this.ownedObjectUrls.push(thumbnailUrl);
      return {
        timeUs: Math.round(entry.timeUs),
        score: Math.round(entry.score),
        thumbnailUrl,
      };
    });
    this.callbacks.onMessage(
      candidates.length
        ? `智能分镜识别到 ${candidates.length} 个候选切点`
        : '未识别到明显的画面切换',
      candidates.length ? 'success' : 'info',
    );
    return {
      itemId: item.id,
      itemName: item.name,
      sampleCount: thumbnails.length,
      candidates,
    };
  }

  async splitVideoByScenes(id: string, cutTimesUs: number[]) {
    if (!this.canvas) return;
    const itemIndex = this.items.findIndex((candidate) => candidate.id === id);
    if (itemIndex < 0) throw new Error('原视频素材已不存在');
    const item = this.items[itemIndex];
    if (item.kind !== 'video') throw new Error('请选择需要分割的视频素材');
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const cuts = Array.from(new Set(cutTimesUs.map((timeUs) => Math.round(timeUs))))
      .filter((timeUs) => timeUs > 1e5 && timeUs < item.sprite.time.duration - 1e5)
      .sort((left, right) => left - right);
    if (!cuts.length) throw new Error('请至少选择一个候选切点');

    let remainingClip = await item.sprite.getClip().clone();
    const clips: IClip[] = [];
    let previousCutUs = 0;
    for (const cutUs of cuts) {
      const sourceCutUs = (cutUs - previousCutUs) * item.sprite.time.playbackRate;
      const splitClips = await remainingClip.split!(sourceCutUs);
      clips.push(splitClips[0]);
      remainingClip = splitClips[1];
      previousCutUs = cutUs;
    }
    clips.push(remainingClip);

    const boundaries = [0, ...cuts, item.sprite.time.duration];
    const baseState = item.keyframeAnimation?.start;
    const originalVisible = item.sprite.visible;
    const sceneItems: EditorItem[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const sprite = new VisibleSprite(clips[index]);
      await sprite.ready;
      sprite.rect.x = baseState ? baseState.x : item.sprite.rect.x;
      sprite.rect.y = baseState ? baseState.y : item.sprite.rect.y;
      sprite.rect.w = baseState ? baseState.width : item.sprite.rect.w;
      sprite.rect.h = baseState ? baseState.height : item.sprite.rect.h;
      sprite.rect.angle = baseState
        ? degreesToRadians(baseState.rotation)
        : item.sprite.rect.angle;
      sprite.rect.fixedAspectRatio = item.sprite.rect.fixedAspectRatio;
      sprite.opacity = baseState ? baseState.opacity / 100 : item.sprite.opacity;
      sprite.time = {
        offset: item.sprite.time.offset + boundaries[index],
        duration: boundaries[index + 1] - boundaries[index],
        playbackRate: item.sprite.time.playbackRate,
      };
      sprite.zIndex = item.sprite.zIndex;
      sprite.visible = item.sprite.visible;
      sprite.interactable = item.sprite.interactable;
      const sceneItem: EditorItem = {
        ...item,
        id: createItemId('video'),
        name: `${item.name} · 分镜 ${index + 1}`,
        sprite,
        sourceStartUs: item.sourceStartUs +
          boundaries[index] * item.sprite.time.playbackRate,
        pictureAdjustment: { ...item.pictureAdjustment },
        mask: { ...item.mask },
        transitionIn: index === 0 && item.transitionIn
          ? { ...item.transitionIn }
          : undefined,
        keyframeAnimation: undefined,
      };
      this.bindSpriteProperties(sceneItem, sprite);
      this.bindClipEffects(sceneItem, sprite);
      await this.canvas.addSprite(sprite);
      sceneItems.push(sceneItem);
    }
    item.sprite.visible = false;
    this.items.splice(itemIndex, 1, ...sceneItems);
    this.restoreSpriteAnimations();
    this.notifyItems();
    this.select(sceneItems[0].id);
    await this.seek(sceneItems[0].sprite.time.offset);
    this.recordHistory({
      label: `智能分镜 ${sceneItems.length} 段`,
      undo: async () => {
        if (!this.canvas) return;
        sceneItems.forEach((sceneItem) => {
          sceneItem.sprite.visible = false;
        });
        item.sprite.visible = originalVisible;
        this.items.splice(itemIndex, sceneItems.length, item);
        this.restoreSpriteAnimations();
        this.notifyItems();
        this.select(item.id);
        await this.seek(item.sprite.time.offset);
      },
      redo: async () => {
        if (!this.canvas) return;
        item.sprite.visible = false;
        sceneItems.forEach((sceneItem) => {
          sceneItem.sprite.visible = originalVisible;
        });
        this.items.splice(itemIndex, 1, ...sceneItems);
        this.restoreSpriteAnimations();
        this.notifyItems();
        this.select(sceneItems[0].id);
        await this.seek(sceneItems[0].sprite.time.offset);
      },
    });
    this.callbacks.onMessage(
      `智能分镜完成，视频已分为 ${sceneItems.length} 段`,
      'success',
    );
  }

  createDraft(): DraftProject {
    return {
      version: 1,
      savedAt: Date.now(),
      assets: this.assets.map(({ sourceUrl, ...asset }) => asset),
      items: this.items.map((item) => {
        const properties = this.readProperties(item.id)!;
        // Keep exact timeline timing in storage; inspector formatting is display-only.
        properties.start = item.sprite.time.offset / 1e6;
        properties.duration = item.sprite.time.duration / 1e6;
        properties.speed = item.sprite.time.playbackRate;
        if (item.keyframeAnimation) {
          properties.x = item.keyframeAnimation.start.x;
          properties.y = item.keyframeAnimation.start.y;
          properties.width = item.keyframeAnimation.start.width;
          properties.height = item.keyframeAnimation.start.height;
          properties.rotation = item.keyframeAnimation.start.rotation;
        }
        return {
        name: item.name,
        kind: item.kind,
        isSubtitle: item.isSubtitle,
        sourceAssetId: item.sourceAssetId,
        source: item.draftSource,
        sourceStartUs: item.sourceStartUs,
        properties,
        zIndex: item.sprite.zIndex,
        visible: item.sprite.visible,
        locked: item.sprite.interactable === 'disabled',
        audioDetached: item.audioDetached,
        audioLinkId: item.audioLinkId,
        audioVolume: item.audioVolume,
        pictureAdjustment: { ...item.pictureAdjustment },
        mask: { ...item.mask },
        transitionIn: item.transitionIn ? { ...item.transitionIn } : undefined,
        keyframeAnimation: item.keyframeAnimation
          ? {
            start: { ...item.keyframeAnimation.start },
            end: { ...item.keyframeAnimation.end },
          }
          : undefined,
      };
      }),
    };
  }

  async restoreDraft(project: DraftProject) {
    if (!this.canvas || project.version !== 1) return;
    this.canvas.pause();
    this.items.forEach((item) => {
      this.canvas!.removeSprite(item.sprite);
      item.sprite.destroy();
    });
    this.items = [];
    this.selectedId = null;
    this.notifyItems();

    this.assets.forEach((asset) => URL.revokeObjectURL(asset.sourceUrl));
    this.assets = [];
    if (project.assets) {
      this.assets = project.assets.map((asset) => ({ ...asset, sourceUrl: URL.createObjectURL(asset.blob) }));
    } else {
      // Old drafts contain only timeline clips. Recover original files once;
      // extracted audio is already represented by its source video.
      const seen = new Set<string>();
      for (const item of project.items) {
        if (item.source.type !== 'file' || item.kind === 'text') continue;
        if (item.kind === 'audio' && (item.audioLinkId || item.source.blob.type.startsWith('video/'))) continue;
        const key = `${item.name}:${item.kind}:${item.source.blob.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const asset = await readMediaAsset(new File([item.source.blob], item.name, { type: item.source.blob.type }));
        this.assets.push(asset);
      }
    }
    // Old library-only deletions left timeline clips without a library entry.
    // Recover their saved source so users can explicitly confirm deletion now;
    // never silently discard their existing edit on migration.
    let recoveredAssets = 0;
    const assetIds = await resolveAssetReferences(project.items, this.assets, async (item, blob) => {
      const name = blob instanceof File ? blob.name : item.name.replace(/ · 原声音频$| 副本$/g, '');
      const asset = await readMediaAsset(new File([blob], name, { type: blob.type }));
      recoveredAssets += 1;
      return asset;
    });
    this.ownedObjectUrls.push(...this.assets.map((asset) => asset.sourceUrl));
    this.callbacks.onAssetsChange?.(this.assets.slice());
    if (recoveredAssets) this.callbacks.onMessage(`已恢复 ${recoveredAssets} 个仍被旧时间轴使用的素材，可从素材库确认删除`, 'info');
    for (let draftIndex = 0; draftIndex < project.items.length; draftIndex += 1) {
      const draftItem = project.items[draftIndex];
      let clip = await this.createClipFromDraftSource(
        draftItem.kind,
        draftItem.source,
      );
      if (draftItem.kind === 'video' && draftItem.audioDetached && clip instanceof MP4Clip) {
        const tracks = await clip.splitTrack();
        const videoTrack = tracks.find((track) => track.meta.width > 0);
        tracks.filter((track) => track !== videoTrack).forEach((track) => track.destroy());
        clip.destroy();
        if (!videoTrack) throw new Error(`${draftItem.name} 的画面轨道无法恢复`);
        clip = videoTrack;
      }
      const sourceDurationUs =
        draftItem.properties.duration * 1e6 * draftItem.properties.speed;
      if (draftItem.sourceStartUs > 0 && clip.split) {
        const split = await clip.split(draftItem.sourceStartUs);
        clip = split[1];
      }
      if (
        clip.split &&
        Number.isFinite(clip.meta.duration) &&
        sourceDurationUs < clip.meta.duration - 1e4
      ) {
        const split = await clip.split(sourceDurationUs);
        clip = split[0];
      }

      let restoredSourceUrl: string | undefined;
      if (draftItem.source.type === 'builtin') {
        restoredSourceUrl = defaultImageUrl;
      } else if (draftItem.source.type === 'file') {
        restoredSourceUrl = URL.createObjectURL(draftItem.source.blob);
        this.ownedObjectUrls.push(restoredSourceUrl);
      }
      const item = await this.registerClip({
        name: draftItem.name,
        kind: draftItem.kind,
        isSubtitle: draftItem.isSubtitle === undefined
          ? draftItem.name.startsWith('[字幕]')
          : draftItem.isSubtitle,
        clip,
        draftSource: draftItem.source,
        sourceAssetId: assetIds[draftIndex],
        sourceUrl: restoredSourceUrl,
        thumbnailUrl:
          draftItem.kind === 'video' || draftItem.kind === 'image'
            ? restoredSourceUrl
            : undefined,
        offsetUs: Math.round(draftItem.properties.start * 1e6),
        durationUs: Math.round(draftItem.properties.duration * 1e6),
        recordHistory: false,
        announce: false,
      });
      item.sourceStartUs = draftItem.sourceStartUs;
      item.sprite.rect.x = draftItem.properties.x;
      item.sprite.rect.y = draftItem.properties.y;
      item.sprite.rect.w = draftItem.properties.width;
      item.sprite.rect.h = draftItem.properties.height;
      item.sprite.rect.angle = degreesToRadians(draftItem.properties.rotation);
      item.sprite.opacity = draftItem.properties.opacity / 100;
      item.sprite.time.playbackRate = draftItem.properties.speed;
      item.sprite.zIndex = draftItem.zIndex;
      item.sprite.visible = draftItem.visible;
      item.sprite.interactable = draftItem.locked ? 'disabled' : 'interactive';
      item.audioVolume = draftItem.audioVolume === undefined ? 100 : draftItem.audioVolume;
      item.audioDetached = Boolean(draftItem.audioDetached);
      item.audioLinkId = draftItem.audioLinkId;
      item.pictureAdjustment = draftItem.pictureAdjustment || {
        ...DEFAULT_PICTURE_ADJUSTMENT,
      };
      item.mask = draftItem.mask ? { ...draftItem.mask } : { ...DEFAULT_MASK };
      item.transitionIn = draftItem.transitionIn
        ? { ...draftItem.transitionIn }
        : undefined;
      item.keyframeAnimation = draftItem.keyframeAnimation
        ? {
          start: { ...draftItem.keyframeAnimation.start },
          end: { ...draftItem.keyframeAnimation.end },
        }
        : undefined;
    }

    // Drafts created before the Jianying-style audio model automatically
    // expanded every video's embedded audio into a linked "原声音频" row.
    // Merge only those generated pairs. User-triggered extraction remains an
    // independent audio row.
    let mergedEmbeddedAudioCount = 0;
    const legacyVideos = this.items.filter(
      (item) => item.kind === 'video' && item.audioDetached,
    );
    for (const videoItem of legacyVideos) {
      const expectedName = `${videoItem.name} · 原声音频`;
      const audioItem = this.items
        .filter((candidate) => (
          candidate.kind === 'audio'
          && candidate.name === expectedName
          && (
            !videoItem.sourceAssetId
            || !candidate.sourceAssetId
            || candidate.sourceAssetId === videoItem.sourceAssetId
          )
        ))
        .sort((left, right) => {
          const score = (candidate: EditorItem) => (
            (candidate.audioLinkId === videoItem.audioLinkId ? -1e15 : 0)
            + Math.abs(candidate.sprite.time.offset - videoItem.sprite.time.offset)
            + Math.abs(candidate.sprite.time.duration - videoItem.sprite.time.duration)
          );
          return score(left) - score(right);
        })[0];
      if (!audioItem) continue;
      const videoIndex = this.items.indexOf(videoItem);
      const embeddedState: ItemSpriteState = {
        ...this.captureItemSpriteState(videoItem),
        hasAudio: true,
        audioDetached: false,
        audioLinkId: undefined,
        audioVolume: audioItem.audioVolume,
        waveform: audioItem.audioWaveform.slice(),
      };
      await this.replaceTimelineItems(
        [videoItem, audioItem],
        [{ state: embeddedState, index: videoIndex }],
        videoItem.id,
        videoItem.sprite.time.offset,
      );
      mergedEmbeddedAudioCount += 1;
    }

    // Preserve provenance for old user-triggered extraction records while
    // keeping both clips independently editable.
    this.items
      .filter((item) => item.kind === 'video' && item.audioDetached && !item.audioLinkId)
      .forEach((videoItem) => {
        const audioItem = this.items.find((candidate) => (
          candidate.kind === 'audio'
          && !candidate.audioLinkId
          && (
            candidate.name === `${videoItem.name} · 提取音频`
            || candidate.name === `${videoItem.name} · 分离原声`
          )
        ));
        if (!audioItem) return;
        const audioLinkId = `audio-link-${videoItem.id}`;
        videoItem.audioLinkId = audioLinkId;
        audioItem.audioLinkId = audioLinkId;
        audioItem.audioDetached = true;
      });

    this.restoreSpriteAnimations();

    this.undoStack = [];
    this.redoStack = [];
    this.notifyItems();
    this.notifyHistory();
    if (this.items[0]) {
      this.select(this.items[0].id);
      await this.seek(this.items[0].sprite.time.offset);
    } else {
      await this.seek(0);
    }
    this.callbacks.onMessage(
      mergedEmbeddedAudioCount
        ? `草稿已恢复，${mergedEmbeddedAudioCount} 条旧原声轨道已合并回视频`
        : '草稿已恢复',
      'success',
    );
  }

  private async createClipFromDraftSource(
    kind: TrackKind,
    source: DraftSource,
  ): Promise<IClip> {
    if (source.type === 'text') {
      const bitmap = await renderTxt2ImgBitmap(
        source.text,
        textStyleToCss(source.style || DEFAULT_TEXT_STYLE),
      );
      return new ImgClip(bitmap);
    }
    if (source.type === 'builtin') {
      const response = await fetch(defaultImageUrl);
      if (!response.body) throw new Error('内置素材读取失败');
      return new ImgClip(response.body);
    }
    if (kind === 'video') {
      return new MP4Clip(source.blob.stream(), { audio: true });
    }
    if (kind === 'audio') {
      if (source.blob.type.startsWith('video/')) {
        const mp4Clip = new MP4Clip(source.blob.stream(), { audio: true });
        await mp4Clip.ready;
        const tracks = await mp4Clip.splitTrack();
        const audioTrack = tracks.find((track) => track.meta.audioChanCount > 0 && track.meta.width === 0);
        tracks.filter((track) => track !== audioTrack).forEach((track) => track.destroy());
        mp4Clip.destroy();
        if (!audioTrack) throw new Error('原视频没有可恢复的音轨');
        return audioTrack;
      }
      return new AudioClip(source.blob.stream(), { volume: 1 });
    }
    return new ImgClip(source.blob.stream());
  }

  private async createExportClip(item: EditorItem): Promise<IClip> {
    let clip = await this.createClipFromDraftSource(item.kind, item.draftSource);
    if (item.kind === 'video' && item.audioDetached && clip instanceof MP4Clip) {
      const tracks = await clip.splitTrack();
      const videoTrack = tracks.find((track) => track.meta.width > 0);
      tracks.filter((track) => track !== videoTrack).forEach((track) => track.destroy());
      clip.destroy();
      if (!videoTrack) throw new Error(`${item.name} 的画面轨道无法导出`);
      clip = videoTrack;
    }
    const sourceDurationUs = item.sprite.time.duration * item.sprite.time.playbackRate;

    if (item.sourceStartUs > 0 && clip.split) {
      const split = await clip.split(item.sourceStartUs);
      clip = split[1];
    }
    if (
      clip.split &&
      Number.isFinite(clip.meta.duration) &&
      sourceDurationUs < clip.meta.duration - 1e4
    ) {
      const split = await clip.split(sourceDurationUs);
      clip = split[0];
    }

    return clip;
  }

  private async createExportCombinator() {
    const combinator = new Combinator({
      bgColor: '#050608',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: 30,
    });
    let addedCount = 0;

    try {
      for (const item of this.items) {
        if (!item.sprite.visible) continue;
        const clip = await this.createExportClip(item);
        this.bindClipEffectsToClip(item, clip);
        const exportSprite = new OffscreenSprite(clip);
        try {
          await exportSprite.ready;
          item.sprite.copyStateTo(exportSprite);
          await combinator.addSprite(exportSprite);
        } finally {
          exportSprite.destroy();
        }
        addedCount += 1;
      }
      if (!addedCount) throw new Error('时间轴中没有可导出的可见素材');
      return combinator;
    } catch (error) {
      combinator.destroy();
      throw error;
    }
  }

  async exportVideo() {
    if (!this.canvas || !this.items.length) {
      throw new Error('时间轴中没有可导出的素材');
    }
    if (!this.isSupported()) {
      throw new Error('当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge');
    }
    this.callbacks.onMessage('正在浏览器内合成视频，请稍候', 'info');
    this.callbacks.onExportProgress(0);
    this.exportCancelled = false;
    const combinator = await this.createExportCombinator();
    this.activeCombinator = combinator;
    if (this.exportCancelled) {
      combinator.destroy();
      this.activeCombinator = null;
      this.callbacks.onMessage('导出已取消', 'info');
      return;
    }
    const stopProgress = combinator.on('OutputProgress', (progress) => {
      this.callbacks.onExportProgress(clamp(progress, 0, 1));
    });
    const reader = combinator.output().getReader();
    this.exportReader = reader;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value) chunks.push(result.value);
      }
      if (this.exportCancelled) {
        this.callbacks.onMessage('导出已取消', 'info');
        return;
      }
      const blob = new Blob(chunks, { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `webav-demo-${Date.now()}.mp4`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.callbacks.onExportProgress(1);
      this.callbacks.onMessage('视频合成完成，已开始下载', 'success');
    } finally {
      stopProgress();
      this.exportReader = null;
      this.activeCombinator = null;
      combinator.destroy();
    }
  }

  async cancelExport() {
    this.exportCancelled = true;
    if (!this.activeCombinator) return;
    this.activeCombinator.destroy();
  }

  async updateVolume(id: string, volume: number) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'audio' && item.kind !== 'video') || !item.hasAudio) {
      throw new Error('当前素材没有可调节的音轨');
    }
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const before = item.audioVolume;
    const after = clamp(Math.round(volume), 0, 200);
    this.applyVolume(item, after);
    this.recordHistory({
      label: '修改音量',
      undo: async () => this.applyVolume(item, before),
      redo: async () => this.applyVolume(item, after),
    });
    this.callbacks.onMessage(`音量已调整为 ${after}%`, 'success');
  }

  async updatePictureAdjustment(
    id: string,
    patch: Partial<PictureAdjustment>,
  ) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) {
      throw new Error('当前素材不支持画面调节');
    }
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const before = { ...item.pictureAdjustment };
    const after = {
      brightness: clamp(
        Math.round(patch.brightness === undefined ? before.brightness : patch.brightness),
        0,
        200,
      ),
      contrast: clamp(
        Math.round(patch.contrast === undefined ? before.contrast : patch.contrast),
        0,
        200,
      ),
      saturation: clamp(
        Math.round(patch.saturation === undefined ? before.saturation : patch.saturation),
        0,
        200,
      ),
    };
    await this.applyPictureAdjustment(item, after);
    this.recordHistory({
      label: '修改画面调节',
      undo: () => this.applyPictureAdjustment(item, before),
      redo: () => this.applyPictureAdjustment(item, after),
    });
    this.callbacks.onMessage('画面调节已更新', 'success');
  }

  async previewPictureAdjustment(
    id: string,
    patch: Partial<PictureAdjustment>,
  ) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) {
      throw new Error('当前素材不支持画面调节');
    }
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const activeJob = this.pictureAdjustmentPreviewJobs.get(id);
    const before = activeJob?.pending || item.pictureAdjustment;
    const after = {
      brightness: clamp(
        Math.round(patch.brightness === undefined ? before.brightness : patch.brightness),
        0,
        200,
      ),
      contrast: clamp(
        Math.round(patch.contrast === undefined ? before.contrast : patch.contrast),
        0,
        200,
      ),
      saturation: clamp(
        Math.round(patch.saturation === undefined ? before.saturation : patch.saturation),
        0,
        200,
      ),
    };
    if (activeJob) {
      activeJob.pending = after;
      await activeJob.running;
      return;
    }
    const job: PictureAdjustmentPreviewJob = {
      pending: after,
      running: Promise.resolve(),
    };
    job.running = (async () => {
      try {
        while (job.pending) {
          const next = job.pending;
          job.pending = null;
          await this.applyPictureAdjustment(item, next);
        }
      } finally {
        if (this.pictureAdjustmentPreviewJobs.get(id) === job) {
          this.pictureAdjustmentPreviewJobs.delete(id);
        }
      }
    })();
    this.pictureAdjustmentPreviewJobs.set(id, job);
    await job.running;
  }

  async commitPictureAdjustment(
    id: string,
    beforePatch: Partial<PictureAdjustment>,
  ) {
    const activeJob = this.pictureAdjustmentPreviewJobs.get(id);
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) return;
    const after = { ...(activeJob?.pending || item.pictureAdjustment) };
    const before = {
      brightness: clamp(
        Math.round(beforePatch.brightness === undefined ? after.brightness : beforePatch.brightness),
        0,
        200,
      ),
      contrast: clamp(
        Math.round(beforePatch.contrast === undefined ? after.contrast : beforePatch.contrast),
        0,
        200,
      ),
      saturation: clamp(
        Math.round(beforePatch.saturation === undefined ? after.saturation : beforePatch.saturation),
        0,
        200,
      ),
    };
    if (
      before.brightness === after.brightness
      && before.contrast === after.contrast
      && before.saturation === after.saturation
    ) return;
    this.recordHistory({
      label: '修改画面调节',
      undo: async () => {
        try { await activeJob?.running; } catch (error) { /* The undo still restores state. */ }
        await this.applyPictureAdjustment(item, before);
      },
      redo: async () => {
        try { await activeJob?.running; } catch (error) { /* The redo still restores state. */ }
        await this.applyPictureAdjustment(item, after);
      },
    });
    this.callbacks.onMessage('画面调节已更新', 'success');
    if (activeJob) await activeJob.running;
  }

  async updateMask(id: string, patch: Partial<MaskConfig>) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) {
      throw new Error('当前素材不支持蒙版');
    }
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const before = { ...item.mask };
    const after: MaskConfig = {
      type: patch.type || before.type,
      size: clamp(
        Math.round(patch.size === undefined ? before.size : patch.size),
        20,
        100,
      ),
      feather: clamp(
        Math.round(patch.feather === undefined ? before.feather : patch.feather),
        0,
        30,
      ),
    };
    await this.applyMask(item, after);
    this.recordHistory({
      label: '修改蒙版',
      undo: () => this.applyMask(item, before),
      redo: () => this.applyMask(item, after),
    });
    this.callbacks.onMessage(
      after.type === 'none' ? '蒙版已关闭' : '蒙版已更新',
      'success',
    );
  }

  async previewMask(id: string, patch: Partial<MaskConfig>) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) {
      throw new Error('当前素材不支持蒙版');
    }
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    const activeJob = this.maskPreviewJobs.get(id);
    const before = activeJob?.pending || item.mask;
    const after: MaskConfig = {
      type: patch.type || before.type,
      size: clamp(
        Math.round(patch.size === undefined ? before.size : patch.size),
        20,
        100,
      ),
      feather: clamp(
        Math.round(patch.feather === undefined ? before.feather : patch.feather),
        0,
        30,
      ),
    };
    if (activeJob) {
      activeJob.pending = after;
      await activeJob.running;
      return;
    }
    const job: MaskPreviewJob = {
      pending: after,
      running: Promise.resolve(),
    };
    job.running = (async () => {
      try {
        while (job.pending) {
          const next = job.pending;
          job.pending = null;
          await this.applyMask(item, next);
        }
      } finally {
        if (this.maskPreviewJobs.get(id) === job) {
          this.maskPreviewJobs.delete(id);
        }
      }
    })();
    this.maskPreviewJobs.set(id, job);
    await job.running;
  }

  async commitMask(id: string, beforePatch: Partial<MaskConfig>) {
    const activeJob = this.maskPreviewJobs.get(id);
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || (item.kind !== 'video' && item.kind !== 'image')) return;
    const after = { ...(activeJob?.pending || item.mask) };
    const before: MaskConfig = {
      type: beforePatch.type || after.type,
      size: clamp(
        Math.round(beforePatch.size === undefined ? after.size : beforePatch.size),
        20,
        100,
      ),
      feather: clamp(
        Math.round(beforePatch.feather === undefined ? after.feather : beforePatch.feather),
        0,
        30,
      ),
    };
    if (
      before.type === after.type
      && before.size === after.size
      && before.feather === after.feather
    ) return;
    this.recordHistory({
      label: '修改蒙版',
      undo: async () => {
        try { await activeJob?.running; } catch (error) { /* The undo still restores state. */ }
        await this.applyMask(item, before);
      },
      redo: async () => {
        try { await activeJob?.running; } catch (error) { /* The redo still restores state. */ }
        await this.applyMask(item, after);
      },
    });
    this.callbacks.onMessage('蒙版已更新', 'success');
    if (activeJob) await activeJob.running;
  }

  async applyCrossfade(durationSeconds: number) {
    return this.applyTransition('crossfade', durationSeconds);
  }

  async applyTransition(type: TransitionType, durationSeconds: number) {
    if (this.historyBusy || this.clipEditBusy) throw new Error('正在更新媒体，请稍后再操作');
    if (!this.selectedId) throw new Error('请先选择后一段视频或图片素材');
    const visualItems = this.getVisualItemsInTimelineOrder();
    const targetIndex = visualItems.findIndex((item) => item.id === this.selectedId);
    if (targetIndex <= 0) throw new Error('所选素材前方需要有一段视频或图片');
    const source = visualItems[targetIndex - 1];
    const target = visualItems[targetIndex];
    const limits = transitionLimits(source, target);
    if (limits.reason) throw new Error(limits.reason);
    if (!Number.isFinite(durationSeconds)) throw new Error('请输入有效的转场时长');
    const durationUs = Math.round(clamp(durationSeconds, 0.1, limits.max) * 10) * 1e5;
    const existing = target.transitionIn
      ? { ...target.transitionIn }
      : undefined;
    const beforeStartUs = target.sprite.time.offset;
    const sourceOpacity = existing?.sourceOpacity ?? source.transitionIn?.targetOpacity ?? source.sprite.opacity;
    const targetOpacity = existing?.targetOpacity ?? target.sprite.opacity;
    const transition: TransitionConfig = {
      type,
      durationUs,
      originalStartUs: existing?.originalStartUs ?? beforeStartUs,
      sourceOpacity,
      targetOpacity,
    };
    if (existing?.type === type && existing.durationUs === durationUs) return;
    await this.changeTransition(source, target, transition);
    this.callbacks.onMessage(
      `${transitionName(type)}转场已应用，时长 ${(durationUs / 1e6).toFixed(1)} 秒`,
      'success',
    );
  }

  async removeTransition() {
    if (this.historyBusy || this.clipEditBusy) throw new Error('正在更新媒体，请稍后再操作');
    const visualItems = this.getVisualItemsInTimelineOrder();
    const index = visualItems.findIndex(item => item.id === this.selectedId);
    const target = visualItems[index];
    if (index <= 0 || !target?.transitionIn) throw new Error('请先选中已有转场');
    await this.changeTransition(visualItems[index - 1], target, undefined);
    this.callbacks.onMessage('转场已移除，画面片段已恢复相邻', 'success');
  }

  private async changeTransition(source: EditorItem, target: EditorItem, transition?: TransitionConfig) {
    const nextStart = transition
      ? source.sprite.time.offset + source.sprite.time.duration - transition.durationUs
      : target.transitionIn!.originalStartUs;
    const delta = nextStart - target.sprite.time.offset;
    const moved = this.getVisualItemsInTimelineOrder().filter(item =>
      item.id === source.id || item.sprite.time.offset >= target.sprite.time.offset,
    );
    // Legacy linked original audio follows its video. Explicitly separated audio stays independent.
    moved.slice().forEach(item => {
      const linked = this.getLinkedItem(item);
      if (linked && !moved.includes(linked)) moved.push(linked);
    });
    if (moved.some(item => item.sprite.interactable === 'disabled')) {
      throw new Error('需要移动的画面或关联原声已锁定，请先解锁');
    }
    const before = moved.map(item => this.captureItemSpriteState(item));
    const after = before.map(state => {
      const isSource = state.item === source || state.item === this.getLinkedItem(source);
      return {
        ...state,
        time: { ...state.time, offset: state.time.offset + (isSource ? 0 : delta) },
        transitionIn: state.item === target ? transition && { ...transition }
          : state.transitionIn && {
            ...state.transitionIn,
            originalStartUs: state.transitionIn.originalStartUs + (isSource ? 0 : delta),
          },
      };
    });
    const previousTime = this.currentTimeUs;
    const nextTime = nextStart + (transition?.durationUs || 0) / 2;
    const apply = async (states: ItemSpriteState[], time: number) => {
      await this.replaceItemSpriteStates(states, target.id);
      await this.seek(time);
    };
    await apply(after, nextTime);
    this.recordHistory({
      label: transition ? `设置${transitionName(transition.type)}转场` : '移除转场',
      undo: () => apply(before, previousTime),
      redo: () => apply(after, nextTime),
    });
  }

  captureKeyframeStart(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.kind === 'audio') throw new Error('请选择画面或文字素材');
    if (item.sprite.interactable === 'disabled') throw new Error('当前轨道已锁定');
    this.pendingKeyframeStarts.set(id, this.readKeyframeState(item));
    item.sprite.setAnimation({ '0%': {}, '100%': {} }, {
      duration: item.sprite.time.duration * item.sprite.time.playbackRate,
      iterCount: 1,
    });
    this.callbacks.onMessage('已记录关键帧起点，请调整位置、大小或透明度', 'success');
  }

  async applyKeyframeEnd(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.kind === 'audio') throw new Error('请选择画面或文字素材');
    const start = this.pendingKeyframeStarts.get(id) || item.keyframeAnimation?.start;
    if (!start) throw new Error('请先记录关键帧起点');
    const before = item.keyframeAnimation
      ? {
        start: { ...item.keyframeAnimation.start },
        end: { ...item.keyframeAnimation.end },
      }
      : undefined;
    const next: KeyframeAnimation = {
      start: { ...start },
      end: this.readKeyframeState(item),
    };
    await this.applyKeyframeAnimation(item, next);
    this.pendingKeyframeStarts.delete(id);
    this.recordHistory({
      label: '添加关键帧动画',
      undo: () => this.applyKeyframeAnimation(item, before),
      redo: () => this.applyKeyframeAnimation(item, next),
    });
    this.callbacks.onMessage('关键帧动画已应用到整个片段', 'success');
  }

  setTrackLocked(kinds: TrackKind[], locked: boolean) {
    this.items
      .filter((item) => kinds.includes(item.kind))
      .forEach((item) => {
        item.sprite.interactable = locked ? 'disabled' : 'interactive';
      });
    this.callbacks.onMessage(locked ? '轨道已锁定' : '轨道已解锁', 'info');
  }

  async setTrackVisible(kinds: TrackKind[], visible: boolean) {
    this.items
      .filter((item) => kinds.includes(item.kind))
      .forEach((item) => {
        item.sprite.visible = visible;
      });
    await this.seek(this.currentTimeUs);
    this.callbacks.onMessage(visible ? '轨道已恢复' : '轨道已关闭', 'info');
  }

  private notifyItems() {
    this.callbacks.onItemsChange(this.items.slice());
  }

  private getLinkedItem(item: EditorItem) {
    if (!item.audioLinkId || item.audioDetached) return null;
    return this.items.find(
      (candidate) => candidate.id !== item.id
        && candidate.audioLinkId === item.audioLinkId
        && !candidate.audioDetached,
    ) || null;
  }

  private captureItemSpriteState(item: EditorItem): ItemSpriteState {
    const { sprite } = item;
    const { x, y, w, h, angle, fixedAspectRatio } = sprite.rect;
    return {
      item, name: item.name, draftSource: item.draftSource,
      textStyle: item.textStyle ? { ...item.textStyle } : undefined,
      isSubtitle: item.isSubtitle,
      transitionIn: item.transitionIn ? { ...item.transitionIn } : undefined,
      hasAudio: item.hasAudio, audioDetached: item.audioDetached,
      audioLinkId: item.audioLinkId, audioVolume: item.audioVolume,
      time: { ...sprite.time }, rect: { x, y, w, h, angle, fixedAspectRatio },
      opacity: sprite.opacity, zIndex: sprite.zIndex, visible: sprite.visible,
      interactable: sprite.interactable, sourceStartUs: item.sourceStartUs,
      waveform: item.audioWaveform.slice(),
    };
  }

  private async recreateItemSprite(item: EditorItem, state = this.captureItemSpriteState(item)) {
    let clip = await this.createClipFromDraftSource(item.kind, state.draftSource);
    let sprite: VisibleSprite | undefined;
    try {
      await clip.ready;
      if (item.kind === 'video' && state.audioDetached && clip instanceof MP4Clip) {
        const tracks = await clip.splitTrack();
        const videoTrack = tracks.find((track) => track.meta.width > 0);
        tracks.filter((track) => track !== videoTrack).forEach((track) => track.destroy());
        clip.destroy();
        if (!videoTrack) throw new Error(`${item.name} 的画面轨道无法恢复`);
        clip = videoTrack;
      }
      const sourceDurationUs = state.time.duration * state.time.playbackRate;
      const keepSplit = async (atUs: number, keep: 0 | 1) => {
        const previous = clip;
        if (!previous.split) throw new Error('当前素材不支持裁剪');
        const split = await previous.split(atUs);
        clip = split[keep];
        try { await clip.ready; }
        finally { split[keep === 0 ? 1 : 0].destroy(); previous.destroy(); }
      };
      if (state.sourceStartUs > 0) await keepSplit(state.sourceStartUs, 1);
      if (
        clip.split
        && Number.isFinite(clip.meta.duration)
        && sourceDurationUs < clip.meta.duration - 1e4
      ) {
        await keepSplit(sourceDurationUs, 0);
      }

      sprite = new VisibleSprite(clip);
      await sprite.ready;
      Object.assign(sprite.rect, state.rect);
      sprite.opacity = state.opacity;
      sprite.zIndex = state.zIndex;
      sprite.visible = state.visible;
      sprite.interactable = state.interactable;
      sprite.time = { ...state.time };
      this.bindSpriteProperties(item, sprite);
      this.bindClipEffects(item, sprite);
      return sprite;
    } catch (error) {
      if (sprite) sprite.destroy();
      else clip.destroy();
      throw error;
    }
  }

  private async applyItemStarts(
    entries: Array<{ id: string; startUs: number }>,
    selectedId: string,
  ) {
    entries.forEach((entry) => {
      const item = this.items.find((candidate) => candidate.id === entry.id);
      if (item) item.sprite.time.offset = entry.startUs;
    });
    this.notifyItems();
    const selectedItem = this.items.find((candidate) => candidate.id === selectedId);
    if (!selectedItem) return;
    this.callbacks.onPropertiesChange(selectedId, this.readProperties(selectedId)!);
    await this.refreshPreviewWithSelection(selectedId, selectedItem.sprite);
  }

  private async replaceItemSprite(
    item: EditorItem,
    target: VisibleSprite,
    sourceStartUs: number,
    waveform: number[],
  ) {
    if (!this.canvas) return;
    const current = item.sprite;
    if (current === target) return;
    await this.canvas.addSprite(target);
    this.canvas.removeSprite(current);
    item.sprite = target;
    item.sourceStartUs = sourceStartUs;
    item.audioWaveform = waveform.slice();
    this.notifyItems();
    this.select(item.id);
    await this.refreshPreviewWithSelection(item.id, target);
  }

  private async replaceItemSpriteStates(
    states: ItemSpriteState[],
    selectedId: string,
  ) {
    if (!this.canvas) return;
    if (this.clipEditBusy) throw new Error('正在恢复媒体，请稍后再操作');
    this.clipEditBusy = true;
    try {
      await this.applyItemSpriteStates(states, selectedId);
    } finally {
      this.clipEditBusy = false;
    }
  }

  private async applyItemSpriteStates(states: ItemSpriteState[], selectedId: string) {
    if (!this.canvas) return;
    this.canvas.pause();
    this.callbacks.onPlayingChange(false);
    // removeSprite destroys its decoder. History owns plain parameters only;
    // every application gets fresh resources. Prepare the whole linked group
    // before removing any live sprite, so a decoder failure cannot split the pair.
    const prepared: Array<{ state: ItemSpriteState; sprite: VisibleSprite; added: boolean }> = [];
    try {
      for (const state of states) {
        prepared.push({ state, sprite: await this.recreateItemSprite(state.item, state), added: false });
      }
      for (const entry of prepared) {
        await this.canvas.addSprite(entry.sprite);
        entry.added = true;
      }
    } catch (error) {
      prepared.forEach(({ sprite, added }) => {
        if (added) this.canvas!.removeSprite(sprite);
        else sprite.destroy();
      });
      throw error;
    }
    for (const { state, sprite } of prepared) {
      this.canvas.removeSprite(state.item.sprite);
      this.applyItemSpriteState(state, sprite);
    }
    this.restoreSpriteAnimations();
    this.notifyItems();
    this.select(selectedId);
    const selectedItem = this.items.find((candidate) => candidate.id === selectedId);
    if (selectedItem) {
      await this.refreshPreviewWithSelection(selectedId, selectedItem.sprite);
    }
  }

  private applyItemSpriteState(state: ItemSpriteState, sprite: VisibleSprite) {
    const { item } = state;
    item.sprite = sprite;
    item.name = state.name;
    item.draftSource = state.draftSource;
    item.textStyle = state.textStyle ? { ...state.textStyle } : undefined;
    item.isSubtitle = state.isSubtitle;
    item.transitionIn = state.transitionIn ? { ...state.transitionIn } : undefined;
    item.hasAudio = state.hasAudio;
    item.audioDetached = state.audioDetached;
    item.audioLinkId = state.audioLinkId;
    item.audioVolume = state.audioVolume;
    item.sourceStartUs = state.sourceStartUs;
    item.audioWaveform = state.waveform.slice();
  }

  private async replaceTimelineItems(
    removed: EditorItem[],
    added: Array<{ state: ItemSpriteState; index: number }>,
    selectedId: string | null,
    seekUs: number,
  ) {
    if (!this.canvas) return;
    this.canvas.pause();
    this.callbacks.onPlayingChange(false);
    const prepared: Array<{ state: ItemSpriteState; sprite: VisibleSprite; added: boolean }> = [];
    try {
      for (const { state } of added) {
        prepared.push({ state, sprite: await this.recreateItemSprite(state.item, state), added: false });
      }
      for (const entry of prepared) {
        await this.canvas.addSprite(entry.sprite);
        entry.added = true;
      }
    } catch (error) {
      prepared.forEach(({ sprite, added: onCanvas }) => {
        if (onCanvas) this.canvas!.removeSprite(sprite);
        else sprite.destroy();
      });
      throw error;
    }
    removed.forEach((item) => {
      const index = this.items.indexOf(item);
      if (index >= 0) this.items.splice(index, 1);
      this.canvas!.removeSprite(item.sprite);
    });
    prepared.map((entry, index) => ({ ...entry, index: added[index].index }))
      .sort((left, right) => left.index - right.index)
      .forEach(({ state, sprite, index }) => {
        this.applyItemSpriteState(state, sprite);
        this.items.splice(Math.min(index, this.items.length), 0, state.item);
      });
    this.restoreSpriteAnimations();
    this.notifyItems();
    this.select(selectedId);
    await this.seek(seekUs);
  }

  private async replaceTextSprite(
    item: EditorItem,
    target: VisibleSprite,
    name: string,
    source: DraftSource,
    style: TextStyle,
  ) {
    if (!this.canvas) return;
    const current = item.sprite;
    if (current !== target) {
      await this.canvas.addSprite(target);
      this.canvas.removeSprite(current);
      item.sprite = target;
    }
    item.name = name;
    item.draftSource = source;
    item.textStyle = { ...style };
    this.notifyItems();
    this.select(item.id);
    await this.refreshPreviewWithSelection(item.id, target);
  }

  private recordHistory(entry: HistoryEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.notifyHistory();
  }

  private notifyHistory() {
    this.callbacks.onHistoryChange(
      this.undoStack.length > 0,
      this.redoStack.length > 0,
    );
  }

  async undo() {
    if (this.historyBusy || this.clipEditBusy) return;
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return;
    this.historyBusy = true;
    try {
      await entry.undo();
      this.undoStack.pop();
      this.redoStack.push(entry);
      this.notifyHistory();
      this.callbacks.onMessage(`已撤销：${entry.label}`, 'info');
    } finally { this.historyBusy = false; }
  }

  async redo() {
    if (this.historyBusy || this.clipEditBusy) return;
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return;
    this.historyBusy = true;
    try {
      await entry.redo();
      this.redoStack.pop();
      this.undoStack.push(entry);
      this.notifyHistory();
      this.callbacks.onMessage(`已重做：${entry.label}`, 'info');
    } finally { this.historyBusy = false; }
  }

  private bindSpriteProperties(item: EditorItem, sprite: VisibleSprite) {
    sprite.on('propsChange', () => {
      const properties = this.readProperties(item.id);
      if (properties) {
        this.callbacks.onPropertiesChange(item.id, properties);
      }
    });
  }

  private bindClipEffects(item: EditorItem, sprite: VisibleSprite) {
    this.bindClipEffectsToClip(item, sprite.getClip());
  }

  private bindClipEffectsToClip(item: EditorItem, clip: IClip) {
    if (item.kind === 'text') return;
    type ClipTickResult = {
      video?: VideoFrame | ImageBitmap | null;
      audio?: Float32Array[];
      state: 'success' | 'done';
    };
    const target = clip as unknown as {
      tickInterceptor: (
        time: number,
        result: ClipTickResult,
      ) => Promise<ClipTickResult>;
    };
    target.tickInterceptor = async (time, tickResult) => {
      let nextResult = tickResult;
      if (tickResult.audio && item.audioVolume !== 100) {
        const scale = item.audioVolume / 100;
        nextResult = {
          ...nextResult,
          audio: tickResult.audio.map((channel: Float32Array) => {
            const output = channel.slice();
            for (let index = 0; index < output.length; index += 1) {
              output[index] *= scale;
            }
            return output;
          }),
        };
      }
      if (
        tickResult.video &&
        item.kind !== 'audio' &&
        (
          !this.isDefaultPictureAdjustment(item.pictureAdjustment) ||
          !this.isDefaultMask(item.mask)
        )
      ) {
        nextResult = {
          ...nextResult,
          video: await this.renderAdjustedFrame(
            tickResult.video,
            item.pictureAdjustment,
            item.mask,
          ),
        };
      }
      if (nextResult.video && item.kind !== 'audio') {
        const visualItems = this.getVisualItemsInTimelineOrder();
        const index = visualItems.indexOf(item);
        const localTime = time / item.sprite.time.playbackRate;
        const incoming = index > 0 ? item.transitionIn : undefined;
        const outgoing = index >= 0 ? visualItems[index + 1]?.transitionIn : undefined;
        const effects = [];
        if (incoming && localTime <= incoming.durationUs) {
          effects.push(transitionFrame(incoming.type, localTime / incoming.durationUs, true));
        }
        if (outgoing && localTime >= item.sprite.time.duration - outgoing.durationUs) {
          effects.push(transitionFrame(outgoing.type,
            (localTime - item.sprite.time.duration + outgoing.durationUs) / outgoing.durationUs, false));
        }
        if (effects.length) {
          nextResult = { ...nextResult, video: await this.renderTransitionFrame(nextResult.video, effects) };
        }
      }
      return nextResult;
    };
  }

  private applyVolume(item: EditorItem, volume: number) {
    item.audioVolume = volume;
    this.notifyItems();
  }

  private async applyPictureAdjustment(
    item: EditorItem,
    adjustment: PictureAdjustment,
  ) {
    item.pictureAdjustment = { ...adjustment };
    this.notifyItems();
    await this.rebuildSpriteForEffects(item);
  }

  private async applyMask(item: EditorItem, mask: MaskConfig) {
    item.mask = { ...mask };
    this.notifyItems();
    await this.rebuildSpriteForEffects(item);
  }

  private async rebuildSpriteForEffects(item: EditorItem, refresh = true) {
    if (!this.canvas) return;
    const current = item.sprite;
    const keepSelected = this.selectedId === item.id;
    const clip = await current.getClip().clone();
    const next = new VisibleSprite(clip);
    await next.ready;
    next.rect.x = current.rect.x;
    next.rect.y = current.rect.y;
    next.rect.w = current.rect.w;
    next.rect.h = current.rect.h;
    next.rect.angle = current.rect.angle;
    next.rect.fixedAspectRatio = current.rect.fixedAspectRatio;
    next.opacity = current.opacity;
    next.time = { ...current.time };
    next.zIndex = current.zIndex;
    next.visible = current.visible;
    next.interactable = current.interactable;
    this.bindSpriteProperties(item, next);
    this.bindClipEffects(item, next);
    this.preserveSelection = true;
    try {
      await this.canvas.addSprite(next);
      item.sprite = next;
      this.canvas.removeSprite(current);
      if (keepSelected) this.canvas.activeSprite = next;
    } finally {
      this.preserveSelection = false;
    }
    if (!refresh) return;
    this.restoreSpriteAnimations();
    this.notifyItems();
    this.select(item.id);
    await this.refreshPreviewWithSelection(item.id, next);
  }

  private isDefaultPictureAdjustment(adjustment: PictureAdjustment) {
    return adjustment.brightness === 100 &&
      adjustment.contrast === 100 &&
      adjustment.saturation === 100;
  }

  private isDefaultMask(mask: MaskConfig) {
    return mask.type === 'none';
  }

  private getVisualItemsInTimelineOrder() {
    return this.items
      .filter((item) => item.kind === 'video' || item.kind === 'image')
      .sort((left, right) => left.sprite.time.offset - right.sprite.time.offset);
  }

  // Both preview and export pass through bindClipEffectsToClip. Keeping transition
  // pixels there avoids writing temporary push/zoom geometry into saved properties.
  private async renderTransitionFrame(
    source: VideoFrame | ImageBitmap,
    effects: Array<ReturnType<typeof transitionFrame>>,
  ) {
    const width = source instanceof VideoFrame ? source.displayWidth : source.width;
    const height = source instanceof VideoFrame ? source.displayHeight : source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return source;
    const opacity = effects.reduce((value, effect) => value * effect.opacity, 1);
    const scale = effects.reduce((value, effect) => value * effect.scale, 1);
    const x = effects.reduce((value, effect) => value + effect.translateX, 0) * width;
    context.globalAlpha = opacity;
    context.drawImage(source, x + (width - width * scale) / 2,
      (height - height * scale) / 2, width * scale, height * scale);
    const output = await createImageBitmap(canvas);
    source.close();
    return output;
  }

  private restoreSpriteAnimations() {
    this.items.forEach(item => {
      if (!item.keyframeAnimation) {
        item.sprite.setAnimation({ '0%': {}, '100%': {} }, {
          duration: item.sprite.time.duration * item.sprite.time.playbackRate, iterCount: 1,
        });
        return;
      }
      const frame = (state: KeyframeState) => ({
        x: state.x, y: state.y, w: state.width, h: state.height,
        angle: degreesToRadians(state.rotation), opacity: state.opacity / 100,
      });
      item.sprite.setAnimation({
        '0%': frame(item.keyframeAnimation.start),
        '100%': frame(item.keyframeAnimation.end),
      }, {
        duration: item.sprite.time.duration * item.sprite.time.playbackRate, iterCount: 1,
      });
    });
  }

  private readKeyframeState(item: EditorItem): KeyframeState {
    const properties = this.readProperties(item.id)!;
    return {
      x: properties.x,
      y: properties.y,
      width: properties.width,
      height: properties.height,
      rotation: properties.rotation,
      opacity: properties.opacity,
    };
  }

  private getKeyframeStateAt(item: EditorItem, progress: number): KeyframeState {
    const animation = item.keyframeAnimation;
    if (!animation) return this.readKeyframeState(item);
    const valueAt = (start: number, end: number) =>
      start + (end - start) * progress;
    return {
      x: valueAt(animation.start.x, animation.end.x),
      y: valueAt(animation.start.y, animation.end.y),
      width: valueAt(animation.start.width, animation.end.width),
      height: valueAt(animation.start.height, animation.end.height),
      rotation: valueAt(animation.start.rotation, animation.end.rotation),
      opacity: valueAt(animation.start.opacity, animation.end.opacity),
    };
  }

  private async applyKeyframeAnimation(
    item: EditorItem,
    animation: KeyframeAnimation | undefined,
  ) {
    item.keyframeAnimation = animation
      ? {
        start: { ...animation.start },
        end: { ...animation.end },
      }
      : undefined;
    await this.rebuildSpriteForEffects(item);
  }

  private async renderAdjustedFrame(
    source: VideoFrame | ImageBitmap,
    adjustment: PictureAdjustment,
    mask: MaskConfig,
  ) {
    const width = source instanceof VideoFrame
      ? source.displayWidth
      : source.width;
    const height = source instanceof VideoFrame
      ? source.displayHeight
      : source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.filter = [
      `brightness(${adjustment.brightness}%)`,
      `contrast(${adjustment.contrast}%)`,
      `saturate(${adjustment.saturation}%)`,
    ].join(' ');
    context.drawImage(source, 0, 0, width, height);
    context.filter = 'none';
    if (mask.type !== 'none') {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskContext = maskCanvas.getContext('2d');
      if (maskContext) {
        const sizeRatio = clamp(mask.size, 20, 100) / 100;
        const maskWidth = width * sizeRatio;
        const maskHeight = height * sizeRatio;
        const left = (width - maskWidth) / 2;
        const top = (height - maskHeight) / 2;
        const featherPixels = Math.min(width, height) * (mask.feather / 100) * 0.08;
        if (featherPixels > 0) {
          maskContext.filter = `blur(${featherPixels.toFixed(2)}px)`;
        }
        maskContext.fillStyle = '#ffffff';
        maskContext.beginPath();
        if (mask.type === 'circle') {
          const radius = Math.min(maskWidth, maskHeight) / 2;
          maskContext.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        } else {
          const radius = Math.min(maskWidth, maskHeight) * 0.12;
          const right = left + maskWidth;
          const bottom = top + maskHeight;
          maskContext.moveTo(left + radius, top);
          maskContext.lineTo(right - radius, top);
          maskContext.quadraticCurveTo(right, top, right, top + radius);
          maskContext.lineTo(right, bottom - radius);
          maskContext.quadraticCurveTo(right, bottom, right - radius, bottom);
          maskContext.lineTo(left + radius, bottom);
          maskContext.quadraticCurveTo(left, bottom, left, bottom - radius);
          maskContext.lineTo(left, top + radius);
          maskContext.quadraticCurveTo(left, top, left + radius, top);
        }
        maskContext.closePath();
        maskContext.fill();
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(maskCanvas, 0, 0);
        context.globalCompositeOperation = 'source-over';
      }
    }
    const output = await createImageBitmap(canvas);
    source.close();
    return output;
  }

  private async createThumbnailSignature(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 14;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return [];
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const signature: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      signature.push(
        pixels[index] * 0.299 +
        pixels[index + 1] * 0.587 +
        pixels[index + 2] * 0.114,
      );
    }
    return signature;
  }

  private compareThumbnailSignatures(left: number[], right: number[]) {
    const length = Math.min(left.length, right.length);
    if (!length) return 0;
    let difference = 0;
    for (let index = 0; index < length; index += 1) {
      difference += Math.abs(left[index] - right[index]);
    }
    return difference / length;
  }

  private async refreshPreviewWithSelection(id: string, sprite: VisibleSprite) {
    this.preserveSelection = true;
    try {
      await this.seek(this.currentTimeUs);
    } finally {
      this.preserveSelection = false;
      if (this.canvas && this.selectedId === id) {
        this.canvas.activeSprite = sprite;
      }
    }
  }

  destroy() {
    this.cleanupListeners.forEach((cleanup) => cleanup());
    this.cleanupListeners = [];
    if (this.canvas) this.canvas.destroy();
    this.canvas = null;
    this.ownedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.ownedObjectUrls = [];
    this.items = [];
    this.exportCancelled = true;
    this.activeCombinator?.destroy();
    this.exportReader = null;
    this.activeCombinator = null;
    this.undoStack = [];
    this.redoStack = [];
    this.pendingKeyframeStarts.clear();
  }
}
