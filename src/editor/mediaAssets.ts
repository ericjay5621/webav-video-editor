import { MediaAsset } from './types';

export async function readMediaAsset(file: File): Promise<MediaAsset> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const major = file.type.split('/')[0];
  const kind = major === 'video' || extension === 'mp4' ? 'video'
    : major === 'audio' || /^(mp3|m4a|aac|wav|flac|ogg)$/.test(extension) ? 'audio'
    : major === 'image' ? 'image' : null;
  if (!kind) throw new Error(`不支持的素材格式：${file.name}`);
  const sourceUrl = URL.createObjectURL(file);
  try {
    const durationUs = await new Promise<number>((resolve, reject) => {
      const element = kind === 'image' ? new Image() : document.createElement(kind);
      const timer = window.setTimeout(() => finish(new Error(`读取素材超时：${file.name}`)), 15000);
      const finish = (error?: Error, duration = 12e6) => {
        window.clearTimeout(timer);
        element.onload = null;
        element.onerror = null;
        if (element instanceof HTMLMediaElement) {
          element.onloadedmetadata = null;
          element.removeAttribute('src');
          element.load();
        }
        if (error) reject(error);
        else resolve(duration);
      };
      element.onerror = () => finish(new Error(`无法读取素材：${file.name}`));
      if (element instanceof HTMLMediaElement) {
        element.preload = 'metadata';
        element.onloadedmetadata = () => {
          const duration = element.duration * 1e6;
          finish(Number.isFinite(duration) && duration > 0 ? undefined : new Error('素材时长无效'), duration);
        };
      } else element.onload = () => finish();
      element.src = sourceUrl;
    });
    return { id: `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, kind, blob: file, durationUs, sourceUrl };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}
