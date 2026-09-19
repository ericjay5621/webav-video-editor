# Contributing

English and Chinese issues and pull requests are welcome.

## Report a bug

Include the browser and OS version, file format/codecs, clip durations, exact steps, expected behavior and actual behavior. For undo/redo bugs, include the full editing sequence. Use a short synthetic sample whenever possible; never attach private recordings, credentials, local drafts or internal documents.

## Make a change

1. Fork the repository and create a focused branch.
2. Follow the README setup. Retain React 16 / TypeScript 4 / Webpack 4 unless an upgrade is explicitly agreed in the issue.
3. Keep changes small. Cover loading, empty, disabled and error states. Prefer natural user workflows over exposing internal editing constraints.
4. Run `npm run type-check`, `npm test` and a production build. For media behavior, test real preview and export in a supported browser too.
5. Include reproduction steps, test results and remaining limitations in the pull request. Use only shareable media in screenshots.

Useful areas: English localization, codec compatibility, long-timeline layout/performance, accessibility and regression coverage. Please open an issue before a large refactor.

Contributions are provided under this repository's MIT license. Third-party code and media must retain their required attribution and compatible licenses.
