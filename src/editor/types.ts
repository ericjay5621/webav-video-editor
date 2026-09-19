import { VisibleSprite } from '@webav/av-cliper';

export type ToolKey =
  | 'media'
  | 'audio'
  | 'text'
  | 'subtitle'
  | 'sticker'
  | 'filter'
  | 'transition'
  | 'effect'
  | 'adjust';

export type TrackKind = 'video' | 'image' | 'audio' | 'text';
export type TrackRowKey = 'visual' | 'text' | 'audio';

export interface TrackControlState {
  locked: boolean;
  hidden: boolean;
  muted: boolean;
}

export interface TextStyle {
  fontSize: number;
  color: string;
  bold: boolean;
  strokeColor: string;
  backgroundColor: string;
}

export interface SubtitleCue {
  startUs: number;
  endUs: number;
  text: string;
}

export interface PictureAdjustment {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface MaskConfig {
  type: 'none' | 'circle' | 'rounded';
  size: number;
  feather: number;
}

export interface SceneCandidate {
  timeUs: number;
  score: number;
  thumbnailUrl: string;
}

export interface SceneAnalysisResult {
  itemId: string;
  itemName: string;
  sampleCount: number;
  candidates: SceneCandidate[];
}

export type TransitionType = 'crossfade' | 'black' | 'push-left' | 'push-right' | 'zoom';

export interface TransitionConfig {
  type: TransitionType;
  durationUs: number;
  originalStartUs: number;
  sourceOpacity: number;
  targetOpacity: number;
}

export interface KeyframeState {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface KeyframeAnimation {
  start: KeyframeState;
  end: KeyframeState;
}

export type DraftSource =
  | { type: 'builtin' }
  | { type: 'file'; blob: Blob }
  | { type: 'text'; text: string; style: TextStyle };

export interface EditorItem {
  id: string;
  sourceAssetId?: string;
  name: string;
  kind: TrackKind;
  sprite: VisibleSprite;
  thumbnailUrl?: string;
  sourceUrl?: string;
  draftSource: DraftSource;
  sourceStartUs: number;
  textStyle?: TextStyle;
  isSubtitle?: boolean;
  hasAudio: boolean;
  audioWaveform: number[];
  audioDetached: boolean;
  audioLinkId?: string;
  audioVolume: number;
  pictureAdjustment: PictureAdjustment;
  mask: MaskConfig;
  transitionIn?: TransitionConfig;
  keyframeAnimation?: KeyframeAnimation;
  color: string;
}

export interface StoredMediaAsset {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  blob: Blob;
  durationUs: number;
}

export interface MediaAsset extends StoredMediaAsset {
  sourceUrl: string;
}

export interface SpriteProperties {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  start: number;
  duration: number;
  speed: number;
}

export interface RuntimeCallbacks {
  onAssetsChange?: (assets: MediaAsset[]) => void;
  onItemsChange: (items: EditorItem[]) => void;
  onSelectionChange: (id: string | null) => void;
  onPropertiesChange: (id: string, properties: SpriteProperties) => void;
  onTimeChange: (timeUs: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  onExportProgress: (progress: number) => void;
  onMessage: (
    message: string,
    tone?: 'info' | 'success' | 'error',
    action?: 'undo',
  ) => void;
}

export interface DraftItem {
  sourceAssetId?: string;
  name: string;
  kind: TrackKind;
  isSubtitle?: boolean;
  source: DraftSource;
  sourceStartUs: number;
  properties: SpriteProperties;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  audioDetached?: boolean;
  audioLinkId?: string;
  audioVolume: number;
  pictureAdjustment: PictureAdjustment;
  mask?: MaskConfig;
  transitionIn?: TransitionConfig;
  keyframeAnimation?: KeyframeAnimation;
}

export interface DraftProject {
  version: 1;
  savedAt: number;
  items: DraftItem[];
  assets?: StoredMediaAsset[];
}
