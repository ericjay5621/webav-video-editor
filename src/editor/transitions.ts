import { EditorItem, TransitionType } from './types';

export const TRANSITIONS: Array<{ type: TransitionType; name: string; description: string }> = [
  { type: 'crossfade', name: '叠化', description: '前一段淡出，后一段淡入' },
  { type: 'black', name: '黑场', description: '先淡出到黑场，再淡入下一段' },
  { type: 'push-left', name: '左推', description: '画面向左移动，下一段从右侧进入' },
  { type: 'push-right', name: '右推', description: '画面向右移动，下一段从左侧进入' },
  { type: 'zoom', name: '缩放', description: '前一段放大淡出，后一段放大淡入' },
];

export function transitionName(type: TransitionType) {
  return TRANSITIONS.find(option => option.type === type)?.name || '叠化';
}

export function transitionLimits(source?: EditorItem | null, target?: EditorItem | null) {
  const max = source && target
    ? Math.floor(Math.min(5e6, source.sprite.time.duration / 2, target.sprite.time.duration / 2) / 1e5) / 10
    : 5;
  const locked = [source, target].some(item => item?.sprite.interactable === 'disabled');
  const joined = source && target && Math.abs(
    target.sprite.time.offset + (target.transitionIn?.durationUs || 0)
    - source.sprite.time.offset - source.sprite.time.duration,
  ) <= 40000;
  const reason = !target ? '请先选中后一段视频或图片。'
    : !source ? '第一段素材前方没有画面，请选中后一段。'
    : locked ? '视频轨道已锁定，请先解锁。'
    : !joined ? '两段画面之间有空隙或额外重叠，请先使它们相邻。'
    : max < 0.1 ? '片段过短，无法添加转场。' : '';
  return { max, reason };
}

// Progress runs across the shared overlap, from 0 to 1 for both clips.
export function transitionFrame(type: TransitionType, progress: number, incoming: boolean) {
  const p = Math.min(1, Math.max(0, progress));
  const result = { opacity: 1, translateX: 0, scale: 1 };
  if (type === 'black') {
    result.opacity = incoming ? Math.max(0, p * 2 - 1) : Math.max(0, 1 - p * 2);
  } else if (type === 'push-left' || type === 'push-right') {
    const direction = type === 'push-left' ? -1 : 1;
    result.translateX = direction * (incoming ? p - 1 : p);
  } else {
    result.opacity = incoming ? p : 1 - p;
    if (type === 'zoom') result.scale = incoming ? 0.8 + p * 0.2 : 1 + p * 0.2;
  }
  return result;
}
