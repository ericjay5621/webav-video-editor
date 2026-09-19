# WebAV Video Editor

### Edit video in your browser. Keep your media on your machine.

[Live demo](https://ericjay5621.github.io/webav-video-editor/) · [中文文档](README.zh-CN.md) · [Quick start](#quick-start) · [Features](#features) · [Contributing](CONTRIBUTING.md)

A local-first video editing workbench built with **React, TypeScript, WebAV and WebCodecs**. Import media, arrange a timeline, add captions and transitions, then export an MP4 in the browser. No media-upload API or rendering server is required.

**Status:** an experimental editor and integration reference, with a Chinese-language UI. It is not a full replacement for a desktop editing suite. See the limitations below before adopting it in a product.

## Why try it?

- **Local media workflow.** Import and source preview are separate from timeline editing. Importing a file never silently adds it to the timeline.
- **An editable timeline, not just a player.** Trim, split, duplicate, insert, undo and redo across video, image, audio and text clips.
- **Browser-native processing.** WebAV handles decoding, compositing and encoding through WebCodecs. FFmpeg is not part of the application runtime.
- **A readable integration example.** UI and media runtime are separate modules, with regression scripts for editing behavior and decoder lifetimes.
- **A legacy-stack reference.** React 16 and Webpack 4 are intentionally retained for integration into older applications.

## Features

| Area | Implemented workflow |
| --- | --- |
| Media library | Local MP4, MP3 and image import; search; source preview; reuse of one asset; deletion confirmation |
| Timeline | Move, trim, split, copy and delete; zoom and fit; undo/redo; video, text and individual audio lanes |
| Insert content | Insert video, image, audio or text before/after a clip; move later content across tracks; split clips spanning the insertion point |
| Video sound | Keep original audio inside a video clip, or detach it into an independently editable audio clip |
| Track controls | Lock, hide and mute, including global audio controls |
| Text & captions | Text styling and duration; SRT/VTT import; subtitle editing and timeline synchronization |
| Picture controls | Position, size, rotation, opacity, speed, brightness, contrast, saturation, masks and basic keyframe animation |
| Transitions | Dissolve, fade through black, push left/right and zoom, with editable duration |
| Scene analysis | Local frame-change analysis with candidate cut points for review |
| Drafts & export | Local browser draft persistence and MP4 export from the timeline |

## Quick start

Try the [online editor](https://ericjay5621.github.io/webav-video-editor/) without installing anything. Import your own short test file; media processing stays in your browser. Drafts on this hosted origin are separate from localhost drafts. The experimental limitations below apply to the demo too.

Use desktop Chrome or Edge with WebCodecs support. Codec availability also depends on the OS and hardware. Start with a short H.264/AAC MP4. Run the app on localhost or HTTPS, not by opening `index.html` directly.

Use Node.js 22 and npm. The legacy OpenSSL flag below is needed by Webpack 4 on newer Node versions.

```sh
git clone https://github.com/ericjay5621/webav-video-editor.git
cd webav-video-editor
npm ci
```

macOS / Linux:

```sh
NODE_OPTIONS=--openssl-legacy-provider npm run dev
```

Windows PowerShell:

```powershell
$env:NODE_OPTIONS="--openssl-legacy-provider"
npm run dev
```

Open **http://localhost:8092/**. No API key or account is required.

### Your first edit

1. Click **导入素材** (Import) and choose a short MP4 and an image. Both appear in the library; the timeline stays empty.
2. Click a card to preview its source. Click **加入** (Add) to append it to the timeline.
3. Select a timeline clip. Drag its edge to trim, or move the playhead inside it and click **分割** (Split).
4. Click **文本** (Text), enter a title and click **添加** (Add). Adjust its start and duration in the inspector.
5. Select the later visual clip, open **转场** (Transitions), choose an effect and duration, then apply.
6. Play the result, try undo/redo, then click **导出** (Export). Only timeline content is exported.

To insert between clips, select the clip next to the desired position and use **在此前插入** / **在此后插入**. This inserts time into the whole project. To overlay text on existing video instead, use the normal Text panel.

## Architecture

```text
React panels (src/components)
        ↓ user commands / UI state
App.tsx
        ↓
WebAVRuntime.ts ── editing history, media lifetime, timeline operations
        ├── AVCanvas: interactive preview
        ├── av-cliper: clips, compositing and MP4 output
        └── draftStore.ts: local IndexedDB persistence
```

| Dependency | Version | Role |
| --- | --- | --- |
| React / React DOM | 16.12.0 | UI |
| TypeScript | 4.4.4 | Type checking |
| Webpack | 4.44.2 | Build and development server |
| @webav/av-canvas / av-cliper | 1.2.8 | Canvas and media processing |

`webpack.config.js` transpiles modern syntax in WebAV and selected dependencies for Webpack 4. This does not polyfill WebCodecs. The app does not require MobX, an enterprise UI kit, a backend or ffmpeg.wasm.

## Build and test

```sh
npm run type-check
npm test
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

On PowerShell, set `NODE_OPTIONS` as above and run `npm run build`. The bundle is written to `dist/`; serve it at the root of an HTTPS origin. Do not expose the legacy development server publicly.

For subdirectory hosting, set `PUBLIC_PATH` to the path including its trailing slash, e.g. `/webav-video-editor/`. The [Pages workflow](.github/workflows/deploy-pages.yml) reads this path from GitHub Pages, checks and builds the source on `main`, and deploys only `dist/`. See [DEPLOYMENT.md](DEPLOYMENT.md) for setup and rollback.

`npm test` runs four regression scripts for import ordering, asset deletion, trim undo/redo and timeline layout. Some tests use media doubles; they do not prove real decoding or audible playback on every browser.

Optional real-browser suites use **synthetic media**. Install FFmpeg separately, then run:

```sh
npm run test:fixtures
NODE_OPTIONS=--openssl-legacy-provider node scripts/serve-trim-history-test.cjs
```

Open the printed loopback URL and click **开始测试**. For insertion or transitions, pass `insertion-browser.ts` or `transition-browser.ts` as the final argument. These suites use a separate temporary bundle and do not load your editor draft. Generated media stays in ignored `.test-media/`.

## Limits and adoption notes

- Publication browser checks found two unresolved assertions: selection restoration after split → undo → redo, and preview/export pixel matching for a push-right transition on moving MP4 content. See [VALIDATION.md](VALIDATION.md) for passed checks and exact limitations.
- This is a demo, not a production stability or security guarantee. React 16 / Webpack 4 dependencies are old; audit them before deployment. Add production error reporting, compatibility checks and resource limits.
- The UI is Chinese. English localization is not implemented.
- Automatic speech recognition, cloud collaboration, stock-media services and full desktop-editor parity are not included. Some navigation entries are placeholders.
- On very long timelines, short clips can be difficult to read at fit-to-project zoom. A minimum visual clip width may differ from its true time-scaled width. Large files and exports can consume significant memory.
- Drafts belong to the current browser and origin. Clearing browser storage can remove them; there is no cloud backup or cross-device sync.
- Arbitrary formats/codecs, mobile browsers, Safari and Firefox are not guaranteed. Verify preview and export in the target environment.
- Media processing is local in this implementation. Hosting, analytics or backend integrations added by a fork can change that behavior.

## Contribute

Useful contributions include reproducible editing bug reports, browser/codec compatibility results, English localization, long-timeline improvements and regression tests. See [CONTRIBUTING.md](CONTRIBUTING.md). Please use synthetic or shareable media, never private recordings.

If this helps your project, a star helps others discover it. Fork it to experiment, and share a reproducible issue or pull request when you improve a workflow.

## Credits and license

Built on [WebAV](https://github.com/WebAV-Tech/WebAV), React, TypeScript and Webpack. This is an independent demo, not an official WebAV application and not affiliated with CapCut or Jianying.

[MIT](LICENSE) for this project's code. Dependencies retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
