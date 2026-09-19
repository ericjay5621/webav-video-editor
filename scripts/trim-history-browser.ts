// Real WebAV decoder regression, isolated from the editor's draft database.
import { WebAVRuntime } from '../src/editor/WebAVRuntime';
import { EditorItem } from '../src/editor/types';

const result = document.getElementById('result')!;
const button = document.getElementById('run') as HTMLButtonElement;
const report: object[] = [];
function check(value: unknown, message: string) { if (!value) throw new Error(message); }
function state(runtime: WebAVRuntime) {
  return runtime.getItems().map(item => ({ id: item.id, time: { ...item.sprite.time }, sourceStartUs: item.sourceStartUs }));
}
async function probe(item: EditorItem) {
  const clip = item.sprite.getClip();
  const points = [0.4e6, item.sprite.time.duration * item.sprite.time.playbackRate - 0.3e6];
  const samples: object[] = [];
  for (const time of points) {
    const prime = await clip.tick(time);
    prime.video?.close();
    const frame = await clip.tick(time + 0.1e6);
    if (item.kind === 'audio') {
      let peak = 0;
      let count = 0;
      (frame.audio || []).forEach(channel => {
        count += channel.length;
        channel.forEach(sample => { peak = Math.max(peak, Math.abs(sample)); });
      });
      check(count > 0 && peak > 0.001, `${item.name}: no decoded audio at ${time}`);
      samples.push({ time, pcmSamples: count, peak });
    } else {
      check(frame.video, `${item.name}: missing video/image frame at ${time}`);
      const canvas = document.createElement('canvas');
      const video = frame.video!;
      canvas.width = video instanceof VideoFrame ? video.displayWidth : video.width;
      canvas.height = video instanceof VideoFrame ? video.displayHeight : video.height;
      const ctx = canvas.getContext('2d')!;
      // Read native pixels; scaled screenshots can choose different GPU filters.
      ctx.drawImage(video, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let rgbSum = 0;
      pixels.forEach((value, index) => { if (index % 4 !== 3) rgbSum += value; });
      frame.video!.close();
      check(rgbSum > 1000, `${item.name}: black/empty decoded frame`);
      let pcmSamples = 0;
      let peak = 0;
      if (item.kind === 'video' && item.hasAudio) {
        (frame.audio || []).forEach(channel => {
          pcmSamples += channel.length;
          channel.forEach(sample => { peak = Math.max(peak, Math.abs(sample)); });
        });
        check(pcmSamples > 0 && peak > 0.001, `${item.name}: embedded audio missing at ${time}`);
      }
      samples.push(item.kind === 'video' && item.hasAudio
        ? { time, rgbSum, pcmSamples, peak }
        : { time, rgbSum });
    }
  }
  return samples;
}

button.onclick = async () => {
  button.disabled = true;
  result.textContent = 'RUNNING: preparing real media';
  const runtime = new WebAVRuntime({
    onItemsChange() {}, onSelectionChange() {}, onPropertiesChange() {},
    onTimeChange() {}, onPlayingChange() {}, onHistoryChange() {}, onMessage() {}, onExportProgress() {},
  });
  try {
    await runtime.mount(document.getElementById('canvas')!);
    const inputs: Array<[string, string]> = [
      ['webav-audio-test.mp3', 'audio/mpeg'],
      ['webav-video-with-audio-test.mp4', 'video/mp4'],
      ['demo-cover.png', 'image/png'],
    ];
    const files = await Promise.all(inputs.map(async ([name, type]) => {
      const response = await fetch(`/media/${name}`);
      check(response.ok, `fixture ${name} unavailable`);
      return new File([await response.blob()], name, { type });
    }));
    const assets = await runtime.addFiles(files);
    for (const index of [0,1,2,1]) await runtime.addAssetToTimeline(assets[index].id);
    const baseline = state(runtime);
    check(baseline.length === 4, 'expected MP3 + two embedded-audio videos + image');
    const firstVideo = runtime.getItems().find(item => item.kind === 'video')!;
    const mp3 = runtime.getItems().find(item => item.kind === 'audio' && !item.audioLinkId)!;
    const image = runtime.getItems().find(item => item.kind === 'image')!;
    check(firstVideo.hasAudio && !firstVideo.audioDetached && !firstVideo.audioLinkId, 'video should keep embedded audio by default');
    check(runtime.getItems().filter(item => item.kind === 'audio').length === 1, 'video audio should not create a separate row');
    for (const target of [firstVideo, mp3, image]) {
      for (const edge of ['end', 'start'] as const) {
        result.textContent = `RUNNING: ${target.kind} ${target.name} ${edge}`;
        const beforeMedia = await probe(target);
        const before = { ...target.sprite.time };
        const trimmedStart = before.offset + (edge === 'start' ? 2e6 : 0);
        await runtime.seek(before.offset + 0.5e6);
        await runtime.trimItem(target.id, edge, trimmedStart, before.duration - 2e6);
        check(Math.abs(target.sprite.time.duration - (before.duration - 2e6)) < 1, 'trim duration');
        const changedIds = new Set([target.id]);
        check(JSON.stringify(state(runtime).filter(item => !changedIds.has(item.id))) === JSON.stringify(baseline.filter(item => !changedIds.has(item.id))), 'other instances changed');
        await probe(target);
        for (let round = 0; round < 3; round++) {
          await runtime.undo();
          check(JSON.stringify(state(runtime)) === JSON.stringify(baseline), 'undo timing/source mismatch');
          const restoredMedia = await probe(target);
          check(JSON.stringify(restoredMedia) === JSON.stringify(beforeMedia), `undo decoded content ${target.name} ${edge}: ${JSON.stringify({ beforeMedia, restoredMedia })}`);
          if (round < 2) { await runtime.redo(); await probe(target); }
        }
        report.push({ kind: target.kind, embeddedAudio: target === firstVideo, edge, undoCycles: 3, restoredMedia: beforeMedia });
      }
    }
    for (const target of [firstVideo, mp3, image]) {
      (runtime as any).select(target.id);
      const before = state(runtime);
      const untouched = before.filter(entry => entry.id !== target.id);
      await runtime.seek(target.sprite.time.offset + target.sprite.time.duration / 2);
      await runtime.splitSelected();
      const splitItems = runtime.getItems().filter(item => item.name === `${target.name} 1` || item.name === `${target.name} 2`);
      check(splitItems.length === 2, `${target.name}: expected two split items`);
      check(runtime.getSelectedId() === splitItems[1].id, `${target.name}: right half not selected`);
      if (target === firstVideo) {
        check(splitItems.every(item => item.hasAudio && !item.audioDetached), 'embedded audio did not split with video');
      }
      check(JSON.stringify(state(runtime).filter(entry => !splitItems.some(item => item.id === entry.id))) === JSON.stringify(untouched), `${target.name}: unrelated items changed by split`);
      await probe(splitItems[0]); await probe(splitItems[1]);
      for (let round = 0; round < 3; round++) {
        await runtime.undo();
        check(JSON.stringify(state(runtime)) === JSON.stringify(before), `${target.name}: split undo state mismatch`);
        await probe(target);
        if (round < 2) {
          await runtime.redo();
          check(runtime.getSelectedId() === splitItems[1].id, `${target.name}: redo did not select right half`);
          await probe(splitItems[0]); await probe(splitItems[1]);
        }
      }
      report.push({ kind: target.kind, embeddedAudio: target === firstVideo, action: 'split', undoCycles: 3 });
    }

    // Jianying model: explicit separation creates independently editable clips.
    (runtime as any).select(firstVideo.id);
    await runtime.extractAudio(firstVideo.id);
    const separatedAudio = runtime.getItems().find(item => item.kind === 'audio' && item.audioLinkId === firstVideo.audioLinkId)!;
    check(firstVideo.audioDetached && separatedAudio.audioDetached, 'separated state missing');
    check(!firstVideo.hasAudio && separatedAudio.hasAudio, 'audio was not removed from video and placed on audio clip');
    await probe(firstVideo); await probe(separatedAudio);
    const separatedBaseline = state(runtime);

    const restoreHost = document.createElement('div');
    restoreHost.style.display = 'none';
    document.body.appendChild(restoreHost);
    const restoredRuntime = new WebAVRuntime({
      onItemsChange() {}, onSelectionChange() {}, onPropertiesChange() {},
      onTimeChange() {}, onPlayingChange() {}, onHistoryChange() {}, onMessage() {}, onExportProgress() {},
    });
    await restoredRuntime.mount(restoreHost);
    const separatedDraft = runtime.createDraft();
    await restoredRuntime.restoreDraft(separatedDraft);
    let restoredSeparatedVideo = restoredRuntime.getItems().find(item => item.kind === 'video' && item.audioDetached)!;
    let restoredSeparatedAudio = restoredRuntime.getItems().find(item => item.kind === 'audio' && item.audioLinkId === restoredSeparatedVideo.audioLinkId)!;
    check(Boolean(restoredSeparatedVideo && restoredSeparatedAudio), 'separated draft did not restore both tracks');
    check(restoredSeparatedAudio.audioDetached, 'restored audio lost independent state');
    await probe(restoredSeparatedVideo); await probe(restoredSeparatedAudio);

    const legacyDraft = runtime.createDraft();
    const legacyVideoDraft = legacyDraft.items.find(item => item.kind === 'video' && item.audioDetached)!;
    const legacyAudioDraft = legacyDraft.items.find(item => item.kind === 'audio' && item.audioLinkId === legacyVideoDraft.audioLinkId)!;
    legacyAudioDraft.name = `${legacyVideoDraft.name} · 原声音频`;
    await restoredRuntime.restoreDraft(legacyDraft);
    restoredSeparatedVideo = restoredRuntime.getItems().find(item => item.kind === 'video' && item.name === legacyVideoDraft.name)!;
    check(restoredRuntime.getItems().length === baseline.length, 'legacy auto-audio row was not merged');
    check(restoredSeparatedVideo.hasAudio && !restoredSeparatedVideo.audioDetached, 'legacy video did not recover embedded audio');
    await probe(restoredSeparatedVideo);
    restoredRuntime.destroy();
    restoreHost.remove();
    report.push({ kind: 'draft', action: 'separated state restore and legacy auto-track migration', decoded: true });

    (runtime as any).select(firstVideo.id);
    const audioBeforeVideoSplit = { ...separatedAudio.sprite.time };
    await runtime.seek(firstVideo.sprite.time.offset + firstVideo.sprite.time.duration / 2);
    await runtime.splitSelected();
    const separatedVideoParts = runtime.getItems().filter(item => item.name === `${firstVideo.name} 1` || item.name === `${firstVideo.name} 2`);
    check(separatedVideoParts.length === 2, 'separated video split failed');
    check(JSON.stringify(separatedAudio.sprite.time) === JSON.stringify(audioBeforeVideoSplit), 'separated audio changed with video split');
    await runtime.undo();
    check(JSON.stringify(state(runtime)) === JSON.stringify(separatedBaseline), 'separated video split undo mismatch');
    await probe(firstVideo); await probe(separatedAudio);

    (runtime as any).select(separatedAudio.id);
    const videoBeforeAudioSplit = { ...firstVideo.sprite.time };
    await runtime.seek(separatedAudio.sprite.time.offset + separatedAudio.sprite.time.duration / 2);
    await runtime.splitSelected();
    const separatedAudioParts = runtime.getItems().filter(item => item.name === `${separatedAudio.name} 1` || item.name === `${separatedAudio.name} 2`);
    check(separatedAudioParts.length === 2, 'separated audio split failed');
    check(JSON.stringify(firstVideo.sprite.time) === JSON.stringify(videoBeforeAudioSplit), 'video changed with separated audio split');
    await runtime.undo();
    check(JSON.stringify(state(runtime)) === JSON.stringify(separatedBaseline), 'separated audio split undo mismatch');
    await probe(firstVideo); await probe(separatedAudio);

    await runtime.undo();
    check(JSON.stringify(state(runtime)) === JSON.stringify(baseline), 'separate-audio undo did not restore embedded video');
    check(firstVideo.hasAudio && !firstVideo.audioDetached, 'embedded state not restored');
    await probe(firstVideo);
    await runtime.redo();
    await probe(firstVideo); await probe(separatedAudio);
    await runtime.undo();
    report.push({ kind: 'video/audio', action: 'embedded split together; separated split independently; undo/redo', decoded: true });
    // Copy/add/subtitle/text/extract-audio paths previously reused destroyed sprites too.
    (runtime as any).select(image.id);
    await runtime.copySelected();
    const copiedImage = runtime.getItems().find(item => item.name === `${image.name} 副本`)!;
    await probe(copiedImage); await runtime.undo(); await runtime.redo(); await probe(copiedImage); await runtime.undo();
    report.push({ kind: 'image', action: 'copy undo/redo', decoded: true });

    await runtime.addAssetToTimeline(assets[0].id);
    const addedMp3 = runtime.getItems().filter(item => item.kind === 'audio' && item.name === mp3.name).slice(-1)[0];
    await runtime.undo(); await runtime.redo(); await probe(addedMp3); await runtime.undo();
    report.push({ kind: 'audio', action: 'add undo/redo', decoded: true });

    await runtime.addSubtitles([{ startUs: 0, endUs: 1e6, text: '字幕撤销测试' }]);
    const subtitle = runtime.getItems().find(item => item.name.includes('字幕撤销测试'))!;
    await runtime.undo(); await runtime.redo(); await probe(subtitle); await runtime.undo();
    report.push({ kind: 'text', action: 'subtitle undo/redo', decoded: true });

    await runtime.addText('文字撤销前');
    const textItem = runtime.getItems().find(item => item.name === '文字撤销前')!;
    const originalTextSource = textItem.draftSource;
    await runtime.updateText(textItem.id, '文字撤销后', textItem.textStyle!);
    await runtime.undo(); check(textItem.draftSource === originalTextSource, 'text source did not restore'); await probe(textItem);
    await runtime.redo(); check(textItem.name === '文字撤销后', 'text redo did not restore content'); await probe(textItem);
    await runtime.undo(); await runtime.undo();
    report.push({ kind: 'text', action: 'update/add undo/redo', decoded: true });

    await runtime.addAssetToTimeline(assets[1].id);
    let latestVideo = runtime.getItems().filter(item => item.kind === 'video').slice(-1)[0];
    check(latestVideo.hasAudio && !latestVideo.audioDetached, 'added video should keep embedded audio');
    await probe(latestVideo);
    await runtime.undo();
    check(runtime.getItems().length === baseline.length, 'add video undo item count');
    await runtime.redo();
    latestVideo = runtime.getItems().filter(item => item.kind === 'video').slice(-1)[0];
    await probe(latestVideo);
    await runtime.extractAudio(latestVideo.id);
    let latestAudio = runtime.getItems().find(item => item.kind === 'audio' && item.audioLinkId === latestVideo.audioLinkId)!;
    await probe(latestVideo); await probe(latestAudio);
    await runtime.undo();
    check(latestVideo.hasAudio && !latestVideo.audioDetached, 'separate undo did not restore embedded audio');
    await probe(latestVideo);
    await runtime.redo();
    latestAudio = runtime.getItems().find(item => item.kind === 'audio' && item.audioLinkId === latestVideo.audioLinkId)!;
    await probe(latestVideo); await probe(latestAudio);
    await runtime.undo(); await runtime.undo();
    check(JSON.stringify(state(runtime)) === JSON.stringify(baseline), 'add video cleanup mismatch');
    report.push({ kind: 'video/audio', action: 'add embedded and separate-audio undo/redo', decoded: true });
    check(JSON.stringify(state(runtime)) === JSON.stringify(baseline), 'final baseline mismatch');
    result.textContent = 'PASS\n' + JSON.stringify(report, null, 2);
  } catch (error) {
    result.textContent = 'FAIL\n' + (error as Error).stack;
  } finally {
    runtime.destroy();
    button.disabled = false;
  }
};
