const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const clips = [];
class Clip {
  constructor(kind, duration = 8e6) {
    this.kind = kind;
    this.meta = { duration, width: kind === 'audio' ? 0 : 640, height: kind === 'audio' ? 0 : 360 };
    this.ready = Promise.resolve(this.meta);
    this.closed = false;
    clips.push(this);
  }
  async tick() {
    if (this.closed) throw new Error('Reader is closed');
    return { video: this.kind === 'audio' ? null : { close() {} }, audio: this.kind === 'audio' ? [new Float32Array([0.5])] : [] };
  }
  async split(time) { assert.ok(time > 0 && time < this.meta.duration); return [new Clip(this.kind, time), new Clip(this.kind, this.meta.duration - time)]; }
  destroy() { this.closed = true; }
}
class Sprite {
  constructor(clip) {
    this.clip = clip;
    this.rect = { x: 10, y: 20, w: 320, h: 180, angle: 0.2, fixedAspectRatio: true };
    this.time = { offset: 0, duration: clip.meta.duration, playbackRate: 1 };
    this.opacity = 0.8; this.zIndex = 1; this.visible = true; this.interactable = 'interactive';
    this.ready = clip.ready;
  }
  getClip() { return this.clip; }
  on() { return () => {}; }
  setAnimation() {}
  destroy() { this.clip.destroy(); this.closed = true; }
}
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = modules[name] = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/editor', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText;
  new Function('exports', 'require', js)(exports, dependency => {
    if (dependency === '@webav/av-cliper') return { VisibleSprite: Sprite, MP4Clip: class {}, AudioClip: class {} };
    if (dependency.startsWith('@webav/')) return {};
    if (/\.(jpg|png)$/.test(dependency)) return 'test-image';
    if (dependency === './mediaAssets') return {};
    return load(dependency.replace('./', ''));
  });
  return exports;
}
const { WebAVRuntime } = load('WebAVRuntime');
const callbacks = Object.fromEntries(['onItemsChange','onSelectionChange','onPropertiesChange','onTimeChange','onPlayingChange','onHistoryChange','onMessage'].map(key => [key, () => {}]));
function setup(kind, linked = false, rate = 1) {
  const runtime = new WebAVRuntime(callbacks);
  const active = new Set();
  // Match installed WebAV ownership: removal destroys the sprite and decoder.
  runtime.canvas = {
    pause() {}, async addSprite(sprite) { assert.ok(!sprite.closed, 'cannot reattach a destroyed sprite'); active.add(sprite); },
    removeSprite(sprite) { active.delete(sprite); sprite.destroy(); },
    async previewFrame() { for (const sprite of active) await sprite.getClip().tick(1e6); },
  };
  const item = (id, type, link) => ({ id, name: id, kind: type, sprite: new Sprite(new Clip(type, 8e6)),
    sourceStartUs: 0, audioWaveform: [0.1,0.4,0.6,0.2], draftSource: { type:'file', blob:{ duration:8e6 } }, audioLinkId:link });
  runtime.items = [item('first', kind, linked ? 'pair1' : undefined)];
  if (linked) runtime.items.push(item('original', 'audio', 'pair1'));
  runtime.items.push(item('second', 'video', 'pair2'), item('second-original', 'audio', 'pair2'));
  runtime.items.forEach((item, index) => {
    item.sprite.time = { offset: index < (linked ? 2 : 1) ? 8e6 : 24e6, duration:8e6 / rate, playbackRate:rate };
    active.add(item.sprite);
  });
  runtime.createClipFromDraftSource = async (kind, source) => new Clip(kind, source.blob.duration);
  runtime.bindClipEffects = () => {};
  runtime.readProperties = id => { const item = runtime.items.find(item => item.id === id); return { start:item.sprite.time.offset / 1e6, duration:item.sprite.time.duration / 1e6 }; };
  runtime.currentTimeUs = 9e6;
  runtime.selectedId = 'first';
  return runtime;
}
const snapshot = runtime => runtime.items.map(item => ({ id:item.id, time:{...item.sprite.time}, rect:{...item.sprite.rect}, sourceStartUs:item.sourceStartUs, waveform:item.audioWaveform.slice(), opacity:item.sprite.opacity }));
async function assertMedia(runtime) {
  for (const item of runtime.items) {
    const sample = await item.sprite.getClip().tick(1e6);
    assert.ok(item.kind === 'audio' ? sample.audio[0][0] !== 0 : sample.video);
    sample.video?.close();
  }
}
async function run() {
  for (const [kind, linked] of [['video',true], ['audio',false], ['image',false]]) {
    for (const edge of ['start','end']) {
      const runtime = setup(kind, linked);
      const before = snapshot(runtime);
      await runtime.trimItem('first', edge, edge === 'start' ? 10e6 : 8e6, 6e6);
      const after = snapshot(runtime);
      assert.strictEqual(after[0].time.duration, 6e6);
      assert.strictEqual(after[0].sourceStartUs, edge === 'start' ? 2e6 : 0);
      if (linked) assert.deepStrictEqual(after[1].time, after[0].time);
      assert.deepStrictEqual(after.slice(linked ? 2 : 1), before.slice(linked ? 2 : 1));
      await assertMedia(runtime);
      for (let round = 0; round < 3; round++) {
        await runtime.undo();
        assert.deepStrictEqual(snapshot(runtime), before);
        await assertMedia(runtime);
        await runtime.redo();
        assert.deepStrictEqual(snapshot(runtime), after);
        await assertMedia(runtime);
      }
      await runtime.trimItem('first', 'start', after[0].time.offset + 1e6, 5e6);
      await runtime.undo();
      await runtime.undo();
      assert.deepStrictEqual(snapshot(runtime), before, 'consecutive trims restore independent snapshots');
      await assertMedia(runtime);
    }
  }
  const fast = setup('video', true, 2);
  await fast.trimItem('first', 'start', 9e6, 3e6);
  assert.strictEqual(fast.items[0].sourceStartUs, 2e6);
  await fast.undo(); await assertMedia(fast); await fast.redo(); await assertMedia(fast);
  await Promise.all([fast.undo(), fast.undo()]);
  assert.strictEqual(fast.items[0].sourceStartUs, 0, 'concurrent undo applies the history entry once');
  assert.strictEqual(fast.redoStack.length, 1);
  await assertMedia(fast);
  // A failed linked decoder must leave both live clips and the undo entry intact.
  const failure = setup('video', true);
  await failure.trimItem('first', 'end', 8e6, 6e6);
  const trimmed = snapshot(failure);
  const create = failure.createClipFromDraftSource;
  failure.createClipFromDraftSource = async (kind, source) => { if (kind === 'audio') throw new Error('decode failure'); return create(kind, source); };
  const clipCount = clips.length;
  await assert.rejects(failure.undo(), /decode failure/);
  assert.deepStrictEqual(snapshot(failure), trimmed);
  assert.strictEqual(failure.undoStack.length, 1);
  assert.ok(clips.slice(clipCount).every(clip => clip.closed), 'release uncommitted replacements after failure');
  failure.createClipFromDraftSource = create;
  await failure.undo(); await assertMedia(failure);
  console.log('PASS: video/original, MP3, image; left/right trim; undo/redo x3 with media reads; consecutive trims; 2x rate; concurrent undo; linked failure rollback and retry');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
