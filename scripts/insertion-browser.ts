// Real media regression in an isolated page; never touches the user's draft database.
import { MP4Clip } from '@webav/av-cliper';
import { WebAVRuntime } from '../src/editor/WebAVRuntime';
import { insertionBoundary, InsertionContent, insertionPlan } from '../src/editor/insertion';
import { EditorItem } from '../src/editor/types';

const output = document.getElementById('result')!;
const report: object[] = [];
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
const style = { fontSize: 64, color: '#ffffff', bold: true, strokeColor: '#000000', backgroundColor: '#00000000' };
function createRuntime() {
  return new WebAVRuntime({ onItemsChange() {}, onSelectionChange() {}, onPropertiesChange() {},
    onTimeChange() {}, onPlayingChange() {}, onHistoryChange() {}, onMessage() {}, onExportProgress() {} });
}
function state(runtime: WebAVRuntime) {
  // MP4 frame rates may yield fractional microseconds; storage resolves to one microsecond.
  return runtime.getItems().map(item => ({ name: item.name, kind: item.kind, time: { ...item.sprite.time,
    offset: Math.round(item.sprite.time.offset), duration: Math.round(item.sprite.time.duration) },
    sourceStartUs: item.sourceStartUs, transition: item.transitionIn, detached: item.audioDetached,
    visible: item.sprite.visible, locked: item.sprite.interactable === 'disabled' }));
}
async function decode(item: EditorItem) {
  const clip = item.sprite.getClip();
  const initial = await clip.tick(.2e6); initial.video?.close();
  const next = await clip.tick(.3e6);
  if (item.kind !== 'audio') check(next.video, `${item.name}: missing video frame`);
  if (item.hasAudio) check(next.audio?.some(channel => channel.some(value => Math.abs(value) > .001)), `${item.name}: no audio samples`);
  next.video?.close();
}
async function mediaFile(name: string, type: string) {
  const response = await fetch(`/media/${name}`);
  check(response.ok, `fixture unavailable: ${name}`);
  return new File([await response.blob()], name, { type });
}
async function rejects(action: () => Promise<unknown>, pattern: RegExp) {
  let message = '';
  try { await action(); } catch (error) { message = (error as Error).message; }
  check(pattern.test(message), `expected rejection ${pattern}, got ${message || 'success'}`);
}

(document.getElementById('run') as HTMLButtonElement).onclick = async () => {
  (document.getElementById('run') as HTMLButtonElement).disabled = true;
  const runtime = createRuntime();
  const restored = createRuntime();
  const matrix = createRuntime();
  try {
    await runtime.mount(document.getElementById('canvas')!);
    const host = document.createElement('div'); host.style.cssText = 'width:640px;height:360px'; document.body.appendChild(host);
    await restored.mount(host);
    const assets = await runtime.addFiles(await Promise.all([
      mediaFile('webav-video-with-audio-test.mp4', 'video/mp4'),
      mediaFile('webav-audio-test.mp3', 'audio/mpeg'),
      mediaFile('demo-cover.png', 'image/png'),
    ]));
    for (let i = 0; i < 2; i++) {
      await runtime.addAssetToTimeline(assets[0].id);
      const item = runtime.getItems().slice(-1)[0];
      await runtime.trimItem(item.id, 'end', item.sprite.time.offset, 2e6);
    }
    const [a, b] = runtime.getItems();
    await runtime.extractAudio(b.id);
    await runtime.addSubtitles([{ startUs: 2e6, endUs: 3e6, text: '跟随 B 的字幕' }]);
    let boundary = insertionBoundary(runtime.getItems(), b.id)!;
    const baseline = JSON.stringify(state(runtime));
    const baseDuration = runtime.getTotalDurationUs();
    const baseHistory = (runtime as any).undoStack.length;
    const contents: InsertionContent[] = [
      { type: 'asset', assetId: assets[0].id },
      { type: 'asset', assetId: assets[1].id },
      { type: 'asset', assetId: assets[2].id, durationUs: 1.5e6 },
      { type: 'text', text: '插入文字 C', style, durationUs: 1.2e6 },
    ];
    for (const content of contents) {
      output.textContent = `RUNNING ${JSON.stringify(content)}: insert, history, decoder, draft, MP4 export`;
      const id = await runtime.insertAtBoundary(boundary, content);
      const inserted = runtime.getItems().find(item => item.id === id)!;
      const duration = inserted.sprite.time.duration;
      check(inserted.sprite.time.offset === 2e6 && runtime.getSelectedId() === id, 'insert position and selection');
      check(a.sprite.time.offset === 0 && b.sprite.time.offset === 2e6 + duration, 'A preserved and B shifted');
      check(runtime.getItems().filter(item => item !== a && item !== inserted).every(item => item.sprite.time.offset === 2e6 + duration), 'audio and subtitles shifted together');
      check(runtime.getTotalDurationUs() === baseDuration + duration, 'total duration');
      check((runtime as any).undoStack.length === baseHistory + 1, 'one history entry');
      const insertedState = JSON.stringify(state(runtime));
      await decode(inserted);
      for (let round = 0; round < 2; round++) {
        await runtime.undo(); check(JSON.stringify(state(runtime)) === baseline, 'undo all offsets');
        for (const item of runtime.getItems()) await decode(item);
        await runtime.redo(); check(JSON.stringify(state(runtime)) === insertedState, 'redo all offsets');
        for (const item of runtime.getItems()) await decode(item);
      }
      await runtime.seek(2.3e6);
      runtime.togglePlayback(false);
      await new Promise(resolve => setTimeout(resolve, 180)); runtime.pause();
      await restored.restoreDraft(runtime.createDraft());
      check(JSON.stringify(state(restored)) === insertedState, `draft restoration: expected ${insertedState}\nactual ${JSON.stringify(state(restored))}`);
      for (const item of restored.getItems()) await decode(item);
      const combinator = await (runtime as any).createExportCombinator();
      const blob = await new Response(combinator.output()).blob(); combinator.destroy();
      check(blob.size > 1000, 'export produced MP4');
      const exported = new MP4Clip(blob.stream()); await exported.ready;
      check(Math.abs(exported.meta.duration - runtime.getTotalDurationUs()) < .15e6, 'export duration');
      for (const at of [.3e6, 2.2e6, 2.3e6, 2.2e6 + duration, 2.3e6 + duration]) {
        const frame = await exported.tick(at); check(frame.video, 'export video frame'); frame.video?.close();
        if (at === 2.3e6 || at === 2.3e6 + duration) {
          const audible = frame.audio.some(channel => channel.some(value => Math.abs(value) > .001));
          check(audible === (at > 2.3e6 || inserted.hasAudio), `${inserted.kind}: exported audio interval at ${at}`);
        }
      }
      exported.destroy();
      report.push({ kind: inserted.kind, duration, exportedBytes: blob.size, undoRedo: 2, mediaReads: true, draft: true });
      await runtime.undo(); check(JSON.stringify(state(runtime)) === baseline, 'restore test baseline');
    }
    runtime.setTrackLocked(['audio'], true);
    await rejects(() => runtime.insertAtBoundary(boundary, contents[2]), /锁定/);
    runtime.setTrackLocked(['audio'], false);
    const audio = runtime.getItems().find(item => item.kind === 'audio')!;
    await runtime.moveItem(audio.id, 1e6);
    const subtitle = runtime.getItems().find(item => item.kind === 'text')!;
    await runtime.moveItem(subtitle.id, 1.5e6);
    boundary = insertionBoundary(runtime.getItems(), b.id)!;
    const crossedBaseline = JSON.stringify(state(runtime));
    const crossingHistory = (runtime as any).undoStack.length;
    const crossingId = await runtime.insertAtBoundary(boundary, contents[2]);
    const parts = runtime.getItems().filter(item => item.kind === 'audio');
    check(parts.length === 2 && parts[0].sprite.time.offset === 1e6 && parts[0].sprite.time.duration === 1e6
      && parts[1].sprite.time.offset === 3.5e6 && parts[1].sprite.time.duration === 1e6
      && parts[1].sourceStartUs === audio.sourceStartUs + 1e6, 'crossing audio splits with correct source offset');
    const captions = runtime.getItems().filter(item => item.kind === 'text');
    check(captions.length === 2 && captions[0].sprite.time.duration === .5e6
      && captions[1].sprite.time.offset === 3.5e6 && captions[1].sprite.time.duration === .5e6, 'crossing subtitle splits');
    check((runtime as any).undoStack.length === crossingHistory + 1, 'auto splits are one undo entry');
    const crossedAfter = JSON.stringify(state(runtime));
    for (let round = 0; round < 2; round++) {
      for (const item of runtime.getItems()) await decode(item);
      await runtime.undo(); check(JSON.stringify(state(runtime)) === crossedBaseline, 'undo joins audio and subtitles');
      for (const item of runtime.getItems()) await decode(item);
      await runtime.redo(); check(JSON.stringify(state(runtime)) === crossedAfter, 'redo automatic split');
    }
    check(runtime.getSelectedId() === crossingId, 'inserted clip selected after auto split redo');
    await restored.restoreDraft(runtime.createDraft());
    check(JSON.stringify(state(restored)) === crossedAfter, 'split draft restores');
    for (const item of restored.getItems()) await decode(item);
    // Validate the exported audio after automatic splitting, not just UI lengths.
    const splitCombinator = await (runtime as any).createExportCombinator();
    const splitBlob = await new Response(splitCombinator.output()).blob(); splitCombinator.destroy();
    const splitExport = new MP4Clip(splitBlob.stream()); await splitExport.ready;
    for (const at of [2.2e6, 2.3e6, 3.7e6, 3.8e6]) {
      const frame = await splitExport.tick(at); frame.video?.close();
      if (at === 2.3e6 || at === 3.8e6) check(frame.audio.some(channel => channel.some(value => Math.abs(value) > .001)) === (at === 3.8e6), 'auto split export silence then original audio');
    }
    splitExport.destroy();
    await runtime.undo();
    // Transaction rollback with automatic splits must leave live readers usable.
    const seekCrossed = runtime.seek.bind(runtime);
    let failCrossed = true;
    runtime.seek = async time => { if (failCrossed) { failCrossed = false; throw new Error('crossed preview failure'); } await seekCrossed(time); };
    await rejects(() => runtime.insertAtBoundary(boundary, contents[2]), /crossed preview failure/);
    runtime.seek = seekCrossed;
    check(JSON.stringify(state(runtime)) === crossedBaseline, 'crossed failure rollback');
    for (const item of runtime.getItems()) await decode(item);
    await runtime.undo();
    await runtime.undo();
    // Legacy near-aligned timestamps should shift as a whole, never demand a split.
    await runtime.moveItem(audio.id, boundary.timeUs - 3000);
    boundary = insertionBoundary(runtime.getItems(), b.id)!;
    const nearBaseline = JSON.stringify(state(runtime));
    await runtime.insertAtBoundary(boundary, contents[2]);
    check(runtime.getItems().filter(item => item.kind === 'audio').length === 1
      && audio.sprite.time.offset === 3.5e6, 'near-aligned audio snaps and moves with B');
    await runtime.undo(); check(JSON.stringify(state(runtime)) === nearBaseline, 'near-aligned exact undo');
    await runtime.undo();
    boundary = insertionBoundary(runtime.getItems(), b.id)!;
    await rejects(() => runtime.insertAtBoundary({ ...boundary, timeUs: 3e6 }, contents[2]), /位置已变化/);
    await rejects(() => runtime.insertAtBoundary(boundary, { type: 'text', text: ' ', style, durationUs: 1e6 }), /文字/);
    await rejects(() => runtime.insertAtBoundary(boundary, { type: 'text', text: 'X', style, durationUs: -1 }), /时长/);
    check(JSON.stringify(state(runtime)) === baseline, 'validation failures leave timeline unchanged');
    // Decoder/add/preview failures must retain timeline and history, including retry.
    const internal = runtime as any;
    const history = internal.undoStack.length;
    const originalCreate = internal.createClipFromDraftSource;
    internal.createClipFromDraftSource = async () => { throw new Error('test decode failure'); };
    await rejects(() => runtime.insertAtBoundary(boundary, contents[2]), /test decode failure/);
    internal.createClipFromDraftSource = originalCreate;
    const originalSeek = runtime.seek.bind(runtime);
    let failOnce = true;
    runtime.seek = async time => { if (failOnce) { failOnce = false; throw new Error('test preview failure'); } await originalSeek(time); };
    await rejects(() => runtime.insertAtBoundary(boundary, contents[2]), /test preview failure/);
    runtime.seek = originalSeek;
    check(JSON.stringify(state(runtime)) === baseline && internal.undoStack.length === history, 'failure rollback');
    for (const item of runtime.getItems()) await decode(item);
    await runtime.insertAtBoundary(boundary, contents[2]);
    await runtime.undo();
    // A repeated queued request cannot insert twice at a stale boundary.
    const results = await Promise.all([runtime.insertAtBoundary(boundary, contents[2]), runtime.insertAtBoundary(boundary, contents[2])]
      .map(pending => pending.then(() => true, () => false)));
    check(results[0] && !results[1], 'duplicate request protection');
    await runtime.undo();
    check(JSON.stringify(state(runtime)) === baseline, 'duplicate undo restores baseline');
    // Downstream transitions keep their original-position anchor when shifted.
    await runtime.addAssetToTimeline(assets[2].id);
    const third = runtime.getItems().slice(-1)[0];
    runtime.select(third.id); await runtime.applyTransition('black', .5);
    boundary = insertionBoundary(runtime.getItems(), b.id)!;
    const anchor = third.transitionIn!.originalStartUs;
    await runtime.insertAtBoundary(boundary, contents[2]);
    check(third.transitionIn!.originalStartUs === anchor + 1.5e6, 'downstream transition anchor shifts');
    await runtime.undo(); check(third.transitionIn!.originalStartUs === anchor, 'anchor undo');
    const crossingTransition = insertionBoundary(runtime.getItems(), third.id)!;
    const transitionBefore = JSON.stringify(state(runtime));
    check(!insertionPlan(runtime.getItems(), crossingTransition, 1e6).reason, 'transition insertion allowed');
    await runtime.insertAtBoundary(crossingTransition, contents[2]);
    check(!third.transitionIn, 'cut transition removed automatically');
    for (const item of runtime.getItems()) await decode(item);
    await runtime.undo(); check(JSON.stringify(state(runtime)) === transitionBefore, 'transition and crossing video undo');
    await runtime.redo(); for (const item of runtime.getItems()) await decode(item);
    await runtime.undo();
    report.push({ guards: ['locked', 'stale', 'invalid text/duration'], automaticAudioSubtitleSplit: true,
      automaticTransitionRemoval: true, crossingVideoUndoRedo: true,
      autoSplitExportBytes: splitBlob.size, crossingUndoRedo: 2, nearAlignedAudio: true,
      failureRollback: true, duplicateRequest: true, downstreamTransition: true });
    const matrixHost = document.createElement('div'); matrixHost.style.cssText = 'width:640px;height:360px'; document.body.appendChild(matrixHost);
    await matrix.mount(matrixHost);
    const matrixAssets = await matrix.addFiles(assets.map(asset => new File([asset.blob], asset.name, { type: asset.blob.type })));
    for (const asset of matrixAssets) {
      await matrix.addAssetToTimeline(asset.id);
      const item = matrix.getItems().slice(-1)[0];
      await matrix.trimItem(item.id, 'end', item.sprite.time.offset, 2e6);
    }
    await matrix.seek(matrix.getTotalDurationUs()); await matrix.addText('文字锚点', style);
    const last = matrix.getItems().slice(-1)[0];
    await matrix.trimItem(last.id, 'end', last.sprite.time.offset, 2e6);
    const anchors = matrix.getItems().slice();
    const matrixContents: InsertionContent[] = [
      ...matrixAssets.map(asset => ({ type: 'asset' as const, assetId: asset.id, durationUs: asset.kind === 'image' ? 1e6 : undefined })),
      { type: 'text', text: '连续插入文字', style, durationUs: 1e6 },
    ];
    const matrixBaseline = JSON.stringify(state(matrix));
    let cases = 0;
    for (const anchorItem of anchors) for (const side of ['before', 'after'] as const) for (const content of matrixContents) {
      output.textContent = `RUNNING insertion matrix ${++cases}/32`;
      const target = insertionBoundary(matrix.getItems(), anchorItem.id, side)!;
      const id = await matrix.insertAtBoundary(target, content);
      const item = matrix.getItems().find(candidate => candidate.id === id)!;
      check(item.sprite.time.offset === target.timeUs, 'all kinds use selected edge');
      await decode(item);
      const insertedState = JSON.stringify(state(matrix));
      await matrix.undo(); check(JSON.stringify(state(matrix)) === matrixBaseline, 'matrix atomic undo');
      await matrix.redo(); check(JSON.stringify(state(matrix)) === insertedState, 'matrix redo');
      await decode(matrix.getItems().find(candidate => candidate.id === id)!);
      await matrix.undo();
    }
    // Screenshot scenario: an audio-only interval between two videos, then insert again.
    const firstVideo = anchors[0];
    const gapAudio = await matrix.insertAtBoundary(insertionBoundary(matrix.getItems(), firstVideo.id, 'after')!, matrixContents[1]);
    const afterAudio = insertionBoundary(matrix.getItems(), gapAudio, 'after')!;
    const nextVideo = await matrix.insertAtBoundary(afterAudio, matrixContents[0]);
    check(matrix.getItems().find(item => item.id === nextVideo)!.sprite.time.offset === afterAudio.timeUs, 'video after inserted MP3');
    await matrix.insertAtBoundary(insertionBoundary(matrix.getItems(), nextVideo)!, matrixContents[3]);
    await restored.restoreDraft(matrix.createDraft());
    check(JSON.stringify(state(restored)) === JSON.stringify(state(matrix)), 'mixed repeated insertion draft');
    for (const item of restored.getItems()) await decode(item);
    await matrix.undo(); await matrix.undo(); await matrix.undo();
    check(JSON.stringify(state(matrix)) === matrixBaseline, 'three continuous insertions undo');
    await matrix.moveItem(last.id, last.sprite.time.offset + 3e6);
    const gapStart = last.sprite.time.offset;
    await matrix.insertAtBoundary(insertionBoundary(matrix.getItems(), last.id)!, matrixContents[2]);
    check(last.sprite.time.offset === gapStart + 1e6, 'existing gap preserved');
    await matrix.undo(); await matrix.undo();
    // Audio edge inside a video: split video and preserve decoded source range.
    const anchorAudio = anchors[1];
    await matrix.moveItem(anchorAudio.id, 1e6);
    const overlapBaseline = JSON.stringify(state(matrix));
    await matrix.insertAtBoundary(insertionBoundary(matrix.getItems(), anchorAudio.id)!, matrixContents[2]);
    const visualParts = matrix.getItems().filter(item => item.kind === 'video');
    check(visualParts.length === 2 && visualParts[1].sourceStartUs === 1e6, 'video splits at audio edge');
    for (const item of matrix.getItems()) await decode(item);
    await matrix.undo(); check(JSON.stringify(state(matrix)) === overlapBaseline, 'cross-track split undo');
    report.push({ allAnchorAndContentCombinations: cases, continuousMixedInsertion: true, existingGap: true,
      videoSplitAtAudioEdge: true, mixedDraft: true });
    output.textContent = JSON.stringify({ result: 'PASS', report }, null, 2);
  } catch (error) {
    output.textContent = `FAIL: ${(error as Error).stack}`; console.error(error);
  } finally { runtime.destroy(); restored.destroy(); matrix.destroy(); }
};
