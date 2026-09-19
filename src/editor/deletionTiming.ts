interface ClipTime {
  offset: number;
  duration: number;
}

interface TimeRange {
  start: number;
  end: number;
}

function mergeRanges(times: ClipTime[]): TimeRange[] {
  const ranges = times.map(({ offset, duration }) => ({
    start: Math.max(0, offset), end: offset + duration,
  })).filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left.start - right.start);
  const merged: TimeRange[] = [];
  ranges.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  });
  return merged;
}

// Collapse only time vacated by this deletion. Original audio overlaps its video,
// so merge those ranges first. Surviving clips (including audio/text) protect their
// entire range; their content and duration must never be cut by a library deletion.
export function createDeletionTimeMapper(removed: ClipTime[], remaining: ClipTime[]) {
  const occupied = mergeRanges(remaining);
  const gaps: TimeRange[] = [];
  mergeRanges(removed).forEach((range) => {
    let cursor = range.start;
    occupied.forEach((keep) => {
      if (keep.end <= cursor || keep.start >= range.end) return;
      if (keep.start > cursor) gaps.push({ start: cursor, end: keep.start });
      cursor = Math.min(range.end, Math.max(cursor, keep.end));
    });
    if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  });
  return (timeUs: number) => Math.max(0, timeUs - gaps.reduce((shift, gap) =>
    shift + Math.max(0, Math.min(timeUs, gap.end) - gap.start), 0));
}
