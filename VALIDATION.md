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

This is the historical 2026-09-19 result. See the local 2026-10-01 follow-up below for the two findings' reproduction, diagnosis and current validation boundaries.

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

## Hosted demo smoke check — 2026-09-19

- URL: https://ericjay5621.github.io/webav-video-editor/
- Deployed source: `ac57035c9648b5a174866df34590f04669e30166`.
- [GitHub Actions build and deployment](https://github.com/ericjay5621/webav-video-editor/actions/runs/35431576074) both succeeded, including type checking and all four logic regression scripts.
- HTTPS HTML, JavaScript and CSS requests returned HTTP 200 with the correct project-subdirectory paths.
- Desktop Chrome UI: imported the generated 8-second H.264/AAC MP4. Import alone left the timeline empty; Add created a clip and rendered the test pattern. Playback advanced to the end.
- Export downloaded an MP4 containing H.264 1280x720 video and AAC 48 kHz stereo audio, with duration 8.128 seconds. FFmpeg decoded the entire downloaded file without errors. This checks file integrity, not subjective audio quality or every editing feature.
- Saved the hosted draft, reloaded, and confirmed restoration of the asset, timeline duration and moving preview.
- Removed only the synthetic test asset through the editor and saved an empty hosted draft. The original local editor draft and all source media were left untouched.
- This smoke check does not resolve or supersede the two browser-suite findings above.

## Local follow-up — 2026-10-01

Baseline: `d31ae05409964bb95f29fbc807b9af6ef296190e`. Both original failures were reproduced in headed Chrome 154 on the user's Mac (macOS 27.0.1, arm64). The existing `H5demo` directory had no Git metadata; its source and regression scripts matched this baseline. It was left untouched. Source changes and this report are tracked for review; browser evidence remains local under ignored `output/playwright/`. The hosted demo was not redeployed for this follow-up.

### Split selection

- History already stored the right-half ID correctly. AVCanvas rounds `timeupdate` to integer microseconds and clears `activeSprite` when seeking outside its range. A fractional split boundary, such as `12033333.333333334` microseconds, can fall after the rounded playhead. The unprotected history seek then cleared the restored selection.
- Split and timeline-history restoration now use the existing protected preview helper, including reattaching the new live sprite. Audio remains selected in the timeline with no canvas selection frame; absent history IDs resolve to no selection.
- The logic regression reproduces the old failure using a canvas event double that models the installed AVCanvas selection behavior and a fractional boundary, and verifies video, MP3 and image selection through three undo/redo cycles. The real-media browser suite verifies restored selection alongside decoding, separate/embedded audio, draft migration, copy, text and subtitle history.

### Moving MP4 push-right comparison

- The failure compared different frames. WebAV 1.2.8 exports in rounded `33333` microsecond steps; decoding at `1600000` returns the frame whose presentation timestamp is `1599984`. Its incoming source frame has timestamp `366666`, whereas preview at exactly `1600000` decodes timestamp `400000`.
- Production rendering before encoding already showed the difference: at `1599984`, the first sampled pixel was `[86,0,255]`; at `1600000`, it was `[255,0,255]`. The original encoded pixel was `[94,0,251]`. This identifies a comparison-time defect in the regression, rather than establishing a production transition-rendering defect.
- The regression now seeks preview to the decoded frame's actual presentation timestamp. It retains the original `.35/.45/.65` sample positions and per-channel error threshold `<25`, records both aligned and unaligned observations, and checks `1.4`, `1.6` and `1.8` seconds. At the original push-right failure point the aligned maximum channel error is 8. It also checks an incoming source trimmed by 0.3 seconds.

### Verified results and boundaries

- Node.js 22.23.2: all four `npm test` logic scripts and `npm run type-check` passed. Browser scripts were compiled with the repository's Webpack/ts-loader test server. A production build with `NODE_OPTIONS=--openssl-legacy-provider` passed; the existing asset-size warnings remain (approximately 590 KiB JavaScript).
- The diagnostic trim/history browser suite completed with PASS, including the fractional video split, audio/image selection, live decoder/PCM probes and all later history checks. The independent insertion browser suite also completed with PASS, including real MP4 output and its 32 anchor/content combinations.
- Still-image transition checks passed. Moving MP4 crossfade, black, push-left and push-right passed the three aligned-time comparisons. Push-right channel errors were 1, 8 and 12; the additional 0.3-second source-trimmed push-right case passed with errors 1, 0 and 1. All five moving effects completed two history/PCM undo/redo cycles. The full transition suite reports **FAIL**: the newly reached moving MP4 zoom midpoint has a sampled channel difference of 26 against the unchanged `<25` threshold. Its aligned preview and production pre-encoding render match exactly at the sampled points, while the encoded result differs. This separate output-comparison boundary is retained, not hidden by increasing the tolerance; later checks continue and report their own results.
- The first post-fix trim/history run intermittently reported a missing tail frame before split; two subsequent complete runs passed. Its cause remains unconfirmed. The suite now reports phases, decoder metadata and probe/canvas tick timing on failures and clears its report before each run. No claim of universal decoder stability follows from the passing runs.
- Browser regression pages use synthetic media and do not open the editor's saved-draft database. PCM decoding does not establish audible playback quality. Other browsers, Windows, long exports and large media remain unvalidated.
- Local evidence is under ignored `output/playwright/`: original failure results, frame-time diagnostics, complete trim/insertion reports, the final transition report, and command logs. No private media or hosted demo was changed.
