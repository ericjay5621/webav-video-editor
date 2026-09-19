# Publication validation — 2026-09-19

These are observed results, not a guarantee that all editing workflows work.

## Passed

- Clean public-file copy, Node.js 22.23.2: `npm ci --ignore-scripts --no-audit --no-fund`.
- `npm run type-check`.
- `npm test`: import/library isolation, asset deletion and timing, trim history with media doubles, timeline layout.
- `NODE_OPTIONS=--openssl-legacy-provider npm run build`.
- Synthetic fixture generation: 8-second MP3, 8-second H.264/AAC MP4 and a geometric PNG. No private media is needed.
- Real-browser `insertion-browser.ts`: video/audio/image/text insertion, MP4 output, undo/redo, draft restore, crossing-clip handling, 32 anchor/content combinations, existing gaps and mixed insertion sequences.
- In `transition-browser.ts`, all five synthetic still-image effects completed preview/export comparison, history and draft checks. MP4 dissolve, black and push-left comparisons also completed before the failure below.
- Public-file review: only source, config, lockfile, public documentation, regression scripts and the synthetic cover are included. Recordings, browser drafts, personal screenshots and internal notes are excluded.

## Unresolved browser result

The real-media `trim-history-browser.ts` suite was run in desktop Chrome with generated fixtures. Video, MP3 and image left/right trimming and their repeated undo/redo probes completed before the suite failed during split history:

```text
webav-video-with-audio-test.mp4: redo did not select right half
```

The suite stopped at that assertion. Later checks in that suite were not reached and must not be treated as passed. This finding concerns selection restoration; it does not establish the status of all subsequent decoding/playback paths. No audible-playback claim is made by the automated PCM probes.

The `transition-browser.ts` suite subsequently failed on moving MP4 content:

```text
push-right: MP4 preview/export mismatch
preview: [[255,0,255],[1,255,255],[0,255,1]]
encoded: [[94,0,251],[1,255,255],[0,255,1]]
```

The mismatch is an observed pixel-comparison failure. Its cause has not been isolated; the later MP4 zoom check was not reached. The still-image transition checks passed, but the full transition suite must not be presented as passing.

## Build warnings and boundaries

- Production JavaScript is approximately 589 KiB uncompressed, above Webpack's recommended asset-size threshold.
- Installation reports deprecated packages in the legacy build toolchain. A security audit or dependency upgrade was not performed as part of publication.
- Windows, other browsers, very large files and long exports were not revalidated for this publication.
