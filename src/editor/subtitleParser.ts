import { SubtitleCue } from './types';

function parseTimestamp(value: string) {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
  return Math.round(seconds * 1e6);
}

export function parseSubtitleText(source: string, fallbackStartUs = 0) {
  const blocks = source
    .replace(/^WEBVTT[^\n]*\n/i, '')
    .trim()
    .split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim());
    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex < 0) return;
    const [startText, endWithSettings] = lines[timeLineIndex].split('-->');
    const endText = (endWithSettings || '').trim().split(/\s+/)[0];
    const startUs = parseTimestamp(startText);
    const endUs = parseTimestamp(endText);
    const text = lines.slice(timeLineIndex + 1).join('\n').trim();
    if (startUs === null || endUs === null || endUs <= startUs || !text) return;
    cues.push({ startUs, endUs, text });
  });

  if (cues.length) return cues;
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, index) => ({
      startUs: fallbackStartUs + index * 3e6,
      endUs: fallbackStartUs + (index + 1) * 3e6,
      text,
    }));
}
