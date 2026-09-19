const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/editor/WebAVRuntime.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
class TestClip { constructor(file) { this.duration = file.duration; } }
class TestFile {
  constructor(parts, name, options) { this.name = name; this.type = options.type; this.duration = parts[0].duration; }
  stream() { return this; }
}
let assetId = 0;
const exportsObject = {};
new Function('exports', 'require', 'URL', 'File', compiled)(exportsObject, name => {
  if (name === '@webav/av-cliper') return { AudioClip: TestClip, MP4Clip: TestClip, ImgClip: TestClip };
  if (name === '@webav/av-canvas') return {};
  if (name === './assetReferences') return { resolveAssetReferences: async items => items.map(item => item.sourceAssetId) };
  if (name === './deletionTiming' || name === './transitions' || name === './insertion') {
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, '../src/editor', name + '.ts'), 'utf8');
    new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
    return exports;
  }
  if (/\.(jpg|png)$/.test(name)) return 'test-image';
  if (name === './mediaAssets') return { readMediaAsset: async file => {
    if (file.name === 'bad-import.mp4') throw new Error('metadata failed');
    return { id: String(++assetId), name: file.name, kind: file.type.split('/')[0], blob: file, sourceUrl: 'blob:test', durationUs: file.duration };
  } };
  throw new Error(`Unexpected import: ${name}`);
}, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }, TestFile);
const file = (name, type, duration) => ({ name, type, duration });
const callbacks = Object.fromEntries(['onAssetsChange', 'onItemsChange', 'onSelectionChange', 'onPropertiesChange', 'onTimeChange', 'onPlayingChange', 'onHistoryChange', 'onMessage'].map(key => [key, () => {}]));
async function run() {
  const runtime = new exportsObject.WebAVRuntime(callbacks);
  runtime.canvas = { pause() {}, removeSprite() {}, previewFrame: async () => {} };
  runtime.currentTimeUs = 123;
  runtime.registerClip = async args => {
    await Promise.resolve();
    if (args.name === 'broken.mp4') throw new Error('decode failed');
    const item = { name: args.name, kind: args.kind, hasAudio: false, sourceAssetId: args.sourceAssetId,
      sprite: { time: { offset: args.offsetUs, duration: args.durationUs || args.clip.duration } } };
    runtime.items.push(item);
    return item;
  };
  const [first, second] = await Promise.all([
    runtime.addFiles([file('A.mp3', 'audio/mpeg', 8e6), file('B.mp4', 'video/mp4', 6e6)]),
    runtime.addFiles([file('C.png', 'image/png', 12e6)]),
  ]);
  assert.deepStrictEqual(runtime.assets.map(x => x.name), ['A.mp3', 'B.mp4', 'C.png']);
  assert.strictEqual(runtime.items.length, 0, 'import must not create timeline clips');
  assert.strictEqual(runtime.getTotalDurationUs(), 0);
  const libraryOnlyDraft = runtime.createDraft();
  assert.strictEqual(libraryOnlyDraft.assets.length, 3);
  assert.strictEqual(libraryOnlyDraft.items.length, 0);
  assert.ok(libraryOnlyDraft.assets.every(x => !('sourceUrl' in x)));
  const restored = new exportsObject.WebAVRuntime(callbacks);
  restored.canvas = { pause() {}, previewFrame: async () => {} };
  await restored.restoreDraft(libraryOnlyDraft);
  assert.strictEqual(restored.assets.length, 3);
  assert.strictEqual(restored.items.length, 0);
  await Promise.all([runtime.addAssetToTimeline(first[1].id), runtime.addAssetToTimeline(first[0].id)]);
  assert.deepStrictEqual(runtime.items.map(x => x.name), ['B.mp4', 'A.mp3']);
  assert.deepStrictEqual(runtime.items.map(x => x.sprite.time.offset), [0, 6e6]);
  await runtime.addAssetToTimeline(first[1].id);
  assert.strictEqual(runtime.items[2].sprite.time.offset, 14e6);
  await runtime.removeAsset(first[1].id, () => false);
  assert.strictEqual(runtime.items.length, 3, 'cancel must retain existing clips');
  await runtime.removeAsset(first[1].id, () => true);
  assert.strictEqual(runtime.items.length, 1, 'removing a source must delete all its timeline instances');
  assert.strictEqual(runtime.items[0].sprite.time.offset, 0, 'deletion closes the vacated leading video range');
  await assert.rejects(runtime.addAssetToTimeline(first[1].id), /素材已移除/);
  await assert.rejects(runtime.addFiles([file('bad-import.mp4', 'video/mp4', 2e6)]), /metadata failed/);
  const broken = await runtime.addFiles([file('broken.mp4', 'video/mp4', 2e6)]);
  await assert.rejects(runtime.addAssetToTimeline(broken[0].id), /decode failed/);
  await runtime.addAssetToTimeline(second[0].id);
  assert.strictEqual(runtime.items[1].sprite.time.offset, 8e6);
  console.log('PASS: import isolation, batch order, empty-timeline draft, explicit reverse add, concurrent add, reuse, library deletion, queue recovery');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
