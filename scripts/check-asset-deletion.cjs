const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/editor', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
  new Function('exports', 'require', js)(exports, dependency => {
    if (dependency.startsWith('@webav/')) return {};
    if (/\.(jpg|png)$/.test(dependency)) return 'test-image';
    if (dependency === './mediaAssets') return {};
    return load(dependency.replace('./', ''));
  });
  return exports;
}
const { WebAVRuntime } = load('WebAVRuntime');
const { resolveAssetReferences } = load('assetReferences');
const { createDeletionTimeMapper } = load('deletionTiming');
async function run() {
  const events = {};
  const callbacks = Object.fromEntries(['onAssetsChange', 'onItemsChange', 'onSelectionChange', 'onPropertiesChange', 'onTimeChange', 'onPlayingChange', 'onHistoryChange', 'onMessage'].map(key => [key, (...args) => { events[key] = args; }]));
  const runtime = new WebAVRuntime(callbacks);
  const removedSprites = [];
  runtime.canvas = { pause() {}, removeSprite(sprite) { removedSprites.push(sprite); }, addSprite: async () => {}, previewFrame: async () => {} };
  runtime.recreateItemSprite = async item => ({ ...item.sprite, time: { ...item.sprite.time } });
  runtime.readProperties = () => ({ start: 0, duration: 1 });
  const makeItem = (id, sourceAssetId, kind, offset, duration) => ({ id, sourceAssetId, kind, name: 'same.mp4', sprite: { time: { offset, duration }, interactable: 'interactive' } });
  const a = { id: 'a', name: 'same.mp4', sourceUrl: 'blob:a' };
  const b = { id: 'b', name: 'same.mp4', sourceUrl: 'blob:b' };
  runtime.assets = [a, b];
  runtime.items = [makeItem('b-video','b','video',0,8), makeItem('a-video','a','video',8,8), makeItem('a-audio','a','audio',8,8), makeItem('a-copy','a','video',16,8), makeItem('a-copy-audio','a','audio',16,8)];
  runtime.currentTimeUs = 23;
  runtime.selectedId = 'a-video';
  assert.strictEqual(await runtime.removeAsset('a', () => false), false);
  assert.strictEqual(runtime.items.length, 5);
  assert.strictEqual(runtime.assets.length, 2);
  assert.strictEqual(runtime.currentTimeUs, 23);
  assert.strictEqual(runtime.undoStack.length, 0);
  runtime.items[2].sprite.interactable = 'disabled';
  await assert.rejects(runtime.removeAsset('a', () => { throw new Error('must not confirm'); }), /锁定/);
  assert.strictEqual(runtime.items.length, 5);
  runtime.items[2].sprite.interactable = 'interactive';
  await runtime.removeAsset('a', (asset, items) => { assert.strictEqual(items.length, 4); return true; });
  assert.deepStrictEqual(runtime.items.map(x => x.id), ['b-video']);
  assert.strictEqual(runtime.assets[0], b, 'same-name different source must survive');
  assert.strictEqual(removedSprites.length, 4);
  assert.strictEqual(runtime.currentTimeUs, 8);
  assert.strictEqual(runtime.selectedId, null);
  assert.deepStrictEqual(events.onPlayingChange, [false]);
  assert.strictEqual(runtime.undoStack.length, 1, 'one deletion is one undo');
  await runtime.undo();
  assert.strictEqual(runtime.items.length, 5);
  assert.deepStrictEqual(runtime.assets, [a,b]);
  assert.strictEqual(runtime.currentTimeUs, 23);
  assert.strictEqual(runtime.selectedId, 'a-video');
  await runtime.redo();
  await runtime.removeAsset('b', () => true);
  assert.strictEqual(runtime.getTotalDurationUs(), 0);
  assert.strictEqual(runtime.currentTimeUs, 0);
  assert.strictEqual(runtime.items.length, 0);
  assert.strictEqual(runtime.assets.length, 0);
  await runtime.undo();
  assert.strictEqual(runtime.items[0].sourceAssetId, 'b');
  assert.strictEqual(runtime.createDraft().items[0].sourceAssetId, 'b');
  // A pending decoder completes before deletion calculates its impact.
  runtime.assets.push(a);
  runtime.addQueue = Promise.resolve().then(() => runtime.items.push(makeItem('late','a','audio',8,4)));
  await runtime.removeAsset('a', (_, items) => { assert.strictEqual(items.length, 1); return true; });
  assert.deepStrictEqual(runtime.items.map(x => x.id), ['b-video']);
  // Unused media must also support deletion/undo without changing the timeline.
  runtime.assets.push(a);
  await runtime.removeAsset('a', (_, items) => { assert.strictEqual(items.length, 0); return true; });
  await runtime.undo();
  assert.strictEqual(runtime.items.length, 1);
  // P0-08: MP3 -> video/original -> image -> reused video/original.
  // Fractional frame durations reproduce the user's real MP4, not just integers.
  const ripple = new WebAVRuntime(callbacks);
  ripple.canvas = runtime.canvas;
  ripple.recreateItemSprite = runtime.recreateItemSprite;
  ripple.readProperties = id => {
    const item = ripple.items.find(item => item.id === id);
    return { start: item.sprite.time.offset / 1e6, duration: item.sprite.time.duration / 1e6 };
  };
  const videoDuration = 8e6 + 1e6 / 30;
  const imageStart = 8e6 + videoDuration;
  const lastStart = imageStart + 12e6;
  const end = lastStart + videoDuration;
  ripple.assets = [a, b, { id: 'image' }];
  ripple.items = [
    makeItem('mp3', 'b', 'audio', 0, 8e6),
    makeItem('video1', 'a', 'video', 8e6, videoDuration),
    makeItem('audio1', 'a', 'audio', 8e6, videoDuration),
    makeItem('image', 'image', 'image', imageStart, 12e6),
    makeItem('video2', 'a', 'video', lastStart, videoDuration),
    makeItem('audio2', 'a', 'audio', lastStart, videoDuration),
  ];
  const originalTimes = () => ripple.items.map(item => [item.id, item.sprite.time.offset, item.sprite.time.duration]);
  const beforeTimes = originalTimes();
  const imageItem = ripple.items[3];
  ripple.currentTimeUs = end;
  ripple.selectedId = 'image';
  imageItem.sprite.interactable = 'disabled';
  await assert.rejects(ripple.removeAsset('a', () => { throw new Error('must not confirm'); }), /前移.*锁定/);
  assert.deepStrictEqual(originalTimes(), beforeTimes);
  assert.strictEqual(ripple.undoStack.length, 0);
  imageItem.sprite.interactable = 'interactive';
  await ripple.removeAsset('a', () => false);
  assert.deepStrictEqual(originalTimes(), beforeTimes, 'cancel preserves all offsets');
  await ripple.removeAsset('a', (_, clips) => { assert.strictEqual(clips.length, 4); return true; });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
  const checkDeleted = () => {
    assert.deepStrictEqual(ripple.items.map(item => item.id), ['mp3', 'image']);
    assert.strictEqual(ripple.assets.length, 2);
    close(ripple.items[0].sprite.time.offset, 0);
    close(imageItem.sprite.time.offset, 8e6);
    close(ripple.getTotalDurationUs(), 20e6);
    close(ripple.currentTimeUs, 20e6);
    assert.strictEqual(imageItem.sprite.time.duration, 12e6);
    assert.strictEqual(ripple.selectedId, 'image');
    close(ripple.createDraft().items.find(item => item.sourceAssetId === 'image').properties.start, 8);
  };
  checkDeleted();
  assert.strictEqual(ripple.undoStack.length, 1);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await ripple.undo();
    assert.deepStrictEqual(originalTimes(), beforeTimes, 'one undo restores exact positions and ordering');
    assert.strictEqual(ripple.assets.length, 3);
    assert.strictEqual(ripple.currentTimeUs, end);
    await ripple.redo();
    checkDeleted();
  }
  // Surviving source deletion/recreation must not break the earlier position snapshot.
  await ripple.removeAsset('image', () => true);
  await ripple.undo();
  await ripple.undo();
  assert.deepStrictEqual(originalTimes(), beforeTimes);
  await ripple.redo();
  checkDeleted();
  // Time-union rules: duplicate original audio, overlaps, existing gaps and playhead.
  const time = (offset, duration) => ({ offset, duration });
  const map = createDeletionTimeMapper([time(8,8), time(8,8), time(28,8)], [time(0,8), time(16,12)]);
  assert.deepStrictEqual([0,8,12,16,20,28,30,36].map(map), [0,8,8,8,12,20,20,20]);
  const preserveGap = createDeletionTimeMapper([time(8,8)], [time(0,6), time(18,12)]);
  assert.strictEqual(preserveGap(18), 10, 'pre-existing 6-8 and 16-18 gaps remain');
  const overlap = createDeletionTimeMapper([time(8,8), time(12,8)], [time(10,3), time(20,4)]);
  assert.deepStrictEqual([10,13,20].map(overlap), [8,11,11], 'retained overlay content is never cut');
  const continuousAudio = createDeletionTimeMapper([time(8,8)], [time(0,30)]);
  assert.strictEqual(continuousAudio(20), 20, 'surviving background audio protects its entire interval');
  assert.strictEqual(createDeletionTimeMapper([], [time(10,5)])(10), 10);
  assert.strictEqual(createDeletionTimeMapper([time(0,36)], [])(30), 0);
  // A later video and its linked original must move together; transition reset time follows.
  const linked = new WebAVRuntime(callbacks);
  linked.canvas = runtime.canvas;
  linked.recreateItemSprite = runtime.recreateItemSprite;
  linked.readProperties = runtime.readProperties;
  linked.assets = [a, b];
  linked.items = [makeItem('deleted','a','video',0,8), makeItem('later-video','b','video',8,12), makeItem('later-audio','b','audio',8,12)];
  linked.items[1].transitionIn = { originalStartUs: 9 };
  linked.currentTimeUs = 12;
  await linked.removeAsset('a', () => true);
  assert.deepStrictEqual(linked.items.map(item => item.sprite.time.offset), [0,0]);
  assert.strictEqual(linked.items[0].transitionIn.originalStartUs, 1);
  assert.strictEqual(linked.currentTimeUs, 4);
  await linked.undo();
  assert.strictEqual(linked.items[1].transitionIn.originalStartUs, 9);
  assert.deepStrictEqual(linked.items.map(item => item.sprite.time.offset), [0,8,8]);
  const blob = new Blob(['abcd'], { type: 'video/mp4' });
  const different = new Blob(['abce'], { type: 'video/mp4' });
  const draftItem = { source: { type: 'file', blob: blob.slice(0, blob.size, blob.type) } };
  const stored = [{ id: 'original', blob }, { id: 'same-size-different-content', blob: different }];
  assert.deepStrictEqual(await resolveAssetReferences([draftItem, draftItem], stored), ['original', 'original']);
  assert.deepStrictEqual(await resolveAssetReferences([{ ...draftItem, sourceAssetId: 'fixed' }], stored), ['fixed']);
  assert.deepStrictEqual(await resolveAssetReferences([draftItem], [...stored, { id: 'ambiguous', blob }]), [undefined]);
  assert.deepStrictEqual(await resolveAssetReferences([draftItem], []), [undefined]);
  const recovered = [];
  let recoveries = 0;
  assert.deepStrictEqual(await resolveAssetReferences([draftItem, { ...draftItem, source: { type: 'file', blob: blob.slice(0, blob.size, blob.type) } }], recovered, async (_, source) => {
    recoveries += 1;
    return { id: 'recovered', blob: source };
  }), ['recovered', 'recovered']);
  assert.strictEqual(recoveries, 1, 'orphaned old clips should recover one library asset, without discarding timeline edits');
  console.log('PASS: cancel, lock protection, repeated/linked clips, same-name isolation, pause/selection/time, atomic undo/redo, empty timeline, queued add, unused asset, serialized source id, byte-verified legacy migration');
  console.log('PASS: P0-08 gap closure, fractional frames, undo/redo x3, subsequent deletion/undo, linked movement, occupied overlaps, preserved existing gaps, move-lock protection, playhead and serialized positions');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
