import { EditorItem, TextStyle } from './types';

export interface InsertionBoundary {
  anchorId: string;
  side: 'before' | 'after';
  anchorName: string;
  fingerprint: string;
  timeUs: number;
}

export type InsertionContent =
  | { type: 'asset'; assetId: string; durationUs?: number; visible?: boolean }
  | { type: 'text'; text: string; style: TextStyle; durationUs: number; visible?: boolean };

// Existing drafts and browser metadata can differ by milliseconds at the same cut.
export const INSERT_ALIGNMENT_US = 10000;
export function startsAtInsertion(item: EditorItem, timeUs: number) {
  return item.sprite.time.offset >= timeUs - INSERT_ALIGNMENT_US;
}

export function insertionBoundary(items: EditorItem[], anchorId: string, side: 'before' | 'after' = 'before'): InsertionBoundary | null {
  const anchor = items.find(item => item.id === anchorId);
  if (!anchor) return null;
  return { anchorId, side, anchorName: anchor.name,
    timeUs: anchor.sprite.time.offset + (side === 'after' ? anchor.sprite.time.duration : 0),
    fingerprint: JSON.stringify(items.map(item => [item.id, item.sprite.time.offset, item.sprite.time.duration,
      item.sprite.time.playbackRate, item.sourceStartUs, item.transitionIn])) };
}

// A frozen boundary prevents source preview or a late async decode changing the target.
export function insertionPlan(items: EditorItem[], boundary: InsertionBoundary, durationUs: number) {
  const current = insertionBoundary(items, boundary.anchorId, boundary.side);
  const moved = items.filter(item => startsAtInsertion(item, boundary.timeUs));
  const crossing = items.filter(item => !startsAtInsertion(item, boundary.timeUs)
    && item.sprite.time.offset + item.sprite.time.duration > boundary.timeUs + INSERT_ALIGNMENT_US);
  const transitions = items.filter(item => item.transitionIn
    && boundary.timeUs >= item.sprite.time.offset - INSERT_ALIGNMENT_US
    && boundary.timeUs <= item.sprite.time.offset + item.transitionIn.durationUs + INSERT_ALIGNMENT_US);
  const locked = [...moved, ...crossing, ...transitions].filter(item => item.sprite.interactable === 'disabled');
  let reason = '';
  if (!current || current.fingerprint !== boundary.fingerprint || current.timeUs !== boundary.timeUs) {
    reason = '片段位置已变化，请关闭面板后重新选择插入位置';
  } else if (!Number.isFinite(durationUs) || durationUs < 1e5) reason = '插入时长必须至少为 0.1 秒';
  return { reason, moved, crossing, transitions, locked, timeUs: boundary.timeUs, durationUs };
}
