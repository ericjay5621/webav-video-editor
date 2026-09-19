// Run with: NODE_OPTIONS=--openssl-legacy-provider node scripts/serve-trim-history-test.cjs transition-browser.ts
// Real canvas/MP4 checks. This page never opens the editor's draft database.
import { MP4Clip } from '@webav/av-cliper';
import { WebAVRuntime } from '../src/editor/WebAVRuntime';
import { EditorItem, TransitionType } from '../src/editor/types';
import { TRANSITIONS } from '../src/editor/transitions';

const output = document.getElementById('result')!;
const report: object[] = [];
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function createRuntime() {
  return new WebAVRuntime({
    onItemsChange() {}, onSelectionChange() {}, onPropertiesChange() {}, onTimeChange() {},
    onPlayingChange() {}, onHistoryChange() {}, onMessage() {}, onExportProgress() {},
  });
}
function state(runtime: WebAVRuntime) {
  return runtime.getItems().map(item => ({ name: item.name, time: { ...item.sprite.time },
    transition: item.transitionIn, rect: { x: item.sprite.rect.x, y: item.sprite.rect.y,
      w: item.sprite.rect.w, h: item.sprite.rect.h }, opacity: item.sprite.opacity }));
}
async function colorFile(name: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new File([await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))], name, { type: 'image/png' });
}
function samples(canvas: HTMLCanvasElement, points = [0.02, 0.25, 0.75]) {
  const ctx = canvas.getContext('2d')!;
  return points.map(x => Array.from(ctx.getImageData(
    Math.floor(canvas.width * x), Math.floor(canvas.height / 2), 1, 1,
  ).data).slice(0, 3));
}
function checkFrame(type: TransitionType, pixels: number[][], label: string) {
  const [edge, left, right] = pixels;
  const red = (rgb: number[]) => rgb[0] > 200 && rgb[2] < 25;
  const blue = (rgb: number[]) => rgb[2] > 200 && rgb[0] < 25;
  if (type === 'black') check(pixels.every(rgb => Math.max(...rgb) < 25), `${label}: black midpoint ${pixels}`);
  if (type === 'push-left') check(red(left) && blue(right), `${label}: left push ${pixels}`);
  if (type === 'push-right') check(blue(left) && red(right), `${label}: right push ${pixels}`);
  if (type === 'crossfade') check(left[0] > 45 && left[2] > 90, `${label}: blended colors ${pixels}`);
  if (type === 'zoom') check(edge[0] > 90 && edge[2] < 25 && left[2] > 90, `${label}: zoom edge/center ${pixels}`);
}
async function decode(item: EditorItem) {
  const clip = item.sprite.getClip();
  const prime = await clip.tick(0.4e6); prime.video?.close();
  const frame = await clip.tick(0.5e6);
  check(frame.video, `${item.name}: no frame`);
  frame.video?.close();
  if (item.hasAudio) {
    check(frame.audio?.some(channel => channel.some(value => Math.abs(value) > .001)), `${item.name}: no PCM audio`);
  }
}

(document.getElementById('run') as HTMLButtonElement).onclick = async () => {
  (document.getElementById('run') as HTMLButtonElement).disabled = true;
  const runtime = createRuntime();
  let restored: WebAVRuntime | undefined;
  try {
    await runtime.mount(document.getElementById('canvas')!);
    const assets = await runtime.addFiles(await Promise.all([
      colorFile('Red.png', '#ff0000'), colorFile('Blue.png', '#0000ff'), colorFile('Green.png', '#00ff00'),
    ]));
    for (const asset of assets) {
      await runtime.addAssetToTimeline(asset.id);
      const item = runtime.getItems().slice(-1)[0];
      await runtime.trimItem(item.id, 'end', item.sprite.time.offset, 2e6);
    }
    const [first, second, third] = runtime.getItems();
    const baseline = JSON.stringify(state(runtime));
    for (const { type } of TRANSITIONS) {
      output.textContent = `RUNNING: ${type} preview + export`;
      runtime.select(second.id);
      await runtime.applyTransition(type, .8);
      check(second.sprite.time.offset === 1.2e6 && third.sprite.time.offset === 3.2e6, `${type}: ripple offsets`);
      const applied = JSON.stringify(state(runtime));
      await runtime.seek(1.6e6);
      await delay(200);
      const canvas = document.querySelector('#canvas canvas') as HTMLCanvasElement;
      const preview = samples(canvas);
      checkFrame(type, preview, `${type} preview`);

      // Use the production export builder, then decode the resulting MP4.
      const combinator = await (runtime as any).createExportCombinator();
      const blob = await new Response(combinator.output()).blob();
      combinator.destroy();
      const exported = new MP4Clip(blob.stream());
      await exported.ready;
      const tick = await exported.tick(1.6e6);
      check(tick.video, `${type}: missing exported frame`);
      const decodedCanvas = document.createElement('canvas');
      decodedCanvas.width = 1280; decodedCanvas.height = 720;
      decodedCanvas.getContext('2d')!.drawImage(tick.video!, 0, 0, 1280, 720);
      tick.video?.close(); exported.destroy();
      const encoded = samples(decodedCanvas);
      checkFrame(type, encoded, `${type} MP4`);

      for (let round = 0; round < 2; round++) {
        await runtime.undo();
        check(JSON.stringify(state(runtime)) === baseline, `${type}: undo state`);
        await decode(first); await decode(second);
        await runtime.redo();
        check(JSON.stringify(state(runtime)) === applied, `${type}: redo state`);
        await decode(second);
      }
      if (!restored) {
        const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px';
        document.body.appendChild(host); restored = createRuntime(); await restored.mount(host);
      }
      await restored.restoreDraft(runtime.createDraft());
      check(JSON.stringify(state(restored)) === applied, `${type}: draft restore`);
      await restored.seek(1.6e6); await delay(100);
      await decode(restored.getItems()[1]);
      await runtime.removeTransition();
      check(JSON.stringify(state(runtime)) === baseline, `${type}: remove state`);
      await runtime.undo(); check(JSON.stringify(state(runtime)) === applied, `${type}: remove undo`);
      await runtime.redo(); check(JSON.stringify(state(runtime)) === baseline, `${type}: remove redo`);
      report.push({ type, preview, encoded, exportedBytes: blob.size, undoRedoCycles: 2, draftRestore: true, removeUndoRedo: true });
    }
    runtime.select(second.id); await runtime.applyTransition('push-left', .8);
    runtime.select(third.id); await runtime.applyTransition('black', .5);
    runtime.select(second.id); await runtime.applyTransition('push-right', 1.2);
    // Two-second clips cap the requested 1.2 seconds at 1.0 second.
    check(second.transitionIn?.durationUs === 1e6, 'duration upper bound');
    check(second.sprite.time.offset === 1e6 && third.sprite.time.offset === 2.5e6, 'chained transition ripple');
    check(third.transitionIn?.originalStartUs === 3e6, 'chained removal anchor');
    await runtime.applyTransition('zoom', 1);
    check(second.sprite.time.offset === 1e6, 'replacing effect accumulated overlap');
    await runtime.removeTransition();
    check(second.sprite.time.offset === 2e6 && third.sprite.time.offset === 3.5e6, 'remove first in chain');
    runtime.select(third.id); await runtime.removeTransition();
    check(JSON.stringify(state(runtime)) === baseline, 'remove chained transitions restore adjacency');
    runtime.select(first.id);
    let rejected = false;
    try { await runtime.applyTransition('black', 1); } catch { rejected = true; }
    check(rejected, 'first item must reject transition');
    runtime.select(second.id); runtime.setTrackLocked(['image', 'video'], true);
    rejected = false;
    try { await runtime.applyTransition('black', 1); } catch { rejected = true; }
    check(rejected, 'locked track must reject transition');
    runtime.setTrackLocked(['image', 'video'], false);
    report.push({ chainedTransitions: true, replaceWithoutAccumulation: true, lockAndFirstItemGuards: true });

    runtime.select(second.id); await runtime.applyTransition('crossfade', .8);
    await runtime.updateProperties(second.id, { opacity: 60 });
    check(runtime.createDraft().items[1].properties.opacity === 60, 'transition overwrote saved base opacity');

    output.textContent = 'RUNNING: MP4 embedded audio undo/redo';
    // Empty only this isolated in-memory test timeline, without accessing saved drafts.
    await runtime.restoreDraft({ version: 1, savedAt: Date.now(), assets: [], items: [] });
    const mp4 = await fetch('/media/webav-video-with-audio-test.mp4').then(res => res.blob());
    const videoAssets = await runtime.addFiles([new File([mp4], 'Video.mp4', { type: 'video/mp4' })]);
    for (let i = 0; i < 2; i++) {
      await runtime.addAssetToTimeline(videoAssets[0].id);
      const item = runtime.getItems().slice(-1)[0];
      await runtime.trimItem(item.id, 'end', item.sprite.time.offset, 2e6);
    }
    const videos = runtime.getItems().filter(item => item.kind === 'video');
    runtime.select(videos[1].id);
    for (const { type } of TRANSITIONS) {
      output.textContent = `RUNNING: MP4 ${type} playback/undo/export`;
      await runtime.applyTransition(type, .8);
      await runtime.seek(1.6e6); await delay(200);
      const preview = samples(document.querySelector('#canvas canvas') as HTMLCanvasElement, [.35, .45, .65]);
      const combinator = await (runtime as any).createExportCombinator();
      const blob = await new Response(combinator.output()).blob(); combinator.destroy();
      const exported = new MP4Clip(blob.stream()); await exported.ready;
      const prime = await exported.tick(1.5e6); prime.video?.close();
      const tick = await exported.tick(1.6e6);
      check(tick.video, `${type}: exported MP4 source has no frame`);
      check(tick.audio?.some(channel => channel.some(value => Math.abs(value) > .001)), `${type}: exported audio missing`);
      const decodedCanvas = document.createElement('canvas'); decodedCanvas.width = 1280; decodedCanvas.height = 720;
      decodedCanvas.getContext('2d')!.drawImage(tick.video!, 0, 0, 1280, 720);
      const encoded = samples(decodedCanvas, [.35, .45, .65]);
      tick.video?.close(); exported.destroy();
      check(preview.every((rgb, i) => rgb.every((value, j) => Math.abs(value - encoded[i][j]) < 25)),
        `${type}: MP4 preview/export mismatch ${JSON.stringify({ preview, encoded })}`);
      for (let round = 0; round < 2; round++) {
        await runtime.undo(); await decode(videos[0]); await decode(videos[1]);
        await runtime.redo(); await decode(videos[0]); await decode(videos[1]);
      }
      await runtime.removeTransition();
      report.push({ mp4Type: type, preview, encoded, audioDecoded: true, exportedBytes: blob.size });
    }
    report.push({ mp4Transitions: 5, embeddedAudioDecoded: true, undoRedoCyclesEach: 2 });
    output.textContent = JSON.stringify({ status: 'PASS', checks: report }, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ status: 'FAIL', error: String(error), stack: (error as Error).stack, completed: report }, null, 2);
  } finally { runtime.destroy(); restored?.destroy(); }
};
