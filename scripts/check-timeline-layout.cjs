const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/timelineLayout.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText;
const exported = {};
new Function('exports', compiled)(exported);
const { getAudioRows, getTimelineTicks, formatRulerTime } = exported;
const item = (id, link, start, duration) => ({
  id, kind: 'audio', audioLinkId: link,
  sprite: { time: { offset: start * 1e6, duration: duration * 1e6 } },
});
const clips = [item('short', undefined, 0.5, 8), item('original', 'video-1', 0, 2089.3),
  item('third', undefined, 100, 8), item('fourth', 'video-2', 3000, 30)];
assert.deepStrictEqual(getAudioRows(clips).map(x => x.id), ['original', 'fourth', 'short', 'third']);
clips[0].sprite.time.offset = 5000e6;
assert.deepStrictEqual(getAudioRows(clips).map(x => x.id), ['original', 'fourth', 'short', 'third']);
assert.strictEqual(getAudioRows([]).length, 0);
for (const duration of [0.5, 8, 2089.3, 3691.5, 72000]) {
  for (const width of [500, 1298, 1298 * 128]) {
    const ticks = getTimelineTicks(duration * 1e6, width);
    for (let index = 1; index < ticks.length; index += 1) {
      assert((ticks[index] - ticks[index - 1]) / Math.max(1, duration) * width >= 87.99);
    }
  }
}
assert.strictEqual(formatRulerTime(3600), '01:00:00');
assert.strictEqual(formatRulerTime(3662), '01:01:02');
console.log('PASS: separate audio rows, stable row order, empty audio, adaptive tick spacing, hour labels');
