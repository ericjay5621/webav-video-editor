// Optional browser-test fixtures. Requires a local FFmpeg installation.
// Generates only synthetic media; never reads or overwrites user recordings.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-media');
fs.mkdirSync(output, { recursive: true });
function ffmpeg(filename, args) {
  const destination = path.join(output, filename);
  if (fs.existsSync(destination)) { console.log(`Keeping ${filename}`); return; }
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args, destination], { stdio: 'inherit' });
  if (result.error) throw new Error('Install FFmpeg and add it to PATH to generate browser-test media.');
  if (result.status !== 0) throw new Error(`FFmpeg failed: ${filename}`);
  console.log(`Generated ${filename}`);
}
ffmpeg('webav-audio-test.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'libmp3lame', '-q:a', '5']);
ffmpeg('webav-video-with-audio-test.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart']);
const cover = path.join(output, 'demo-cover.png');
if (!fs.existsSync(cover)) fs.copyFileSync(path.join(root, 'src/assets/demo-cover.png'), cover);
console.log('Synthetic fixtures ready in .test-media/');
