import { EditorItem } from '../editor/types';

// Keep source audio and imported audio on separate, stable rows even when
// their time ranges do not overlap. Moving a clip must not change its row.
export function getAudioRows(items: EditorItem[]): EditorItem[] {
  const audio = items.filter((item) => item.kind === 'audio');
  return audio.filter((item) => Boolean(item.audioLinkId))
    .concat(audio.filter((item) => !item.audioLinkId));
}

export function getTimelineTicks(durationUs: number, width: number): number[] {
  const seconds = Math.max(1, durationUs / 1e6);
  const minimumStep = seconds * 88 / Math.max(width, 88);
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((value) => value >= minimumStep)
    || Math.ceil(minimumStep / 3600) * 3600;
  const ticks: number[] = [];
  for (let index = 0; index * step < seconds; index += 1) ticks.push(index * step);
  return ticks;
}

export function formatRulerTime(second: number): string {
  const hours = Math.floor(second / 3600);
  const minutes = Math.floor(second / 60) % 60;
  const seconds = second % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${
    (Number.isInteger(second) ? String(seconds) : seconds.toFixed(1)).padStart(2, '0')
  }`;
}
