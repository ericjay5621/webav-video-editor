# GitHub Pages deployment

Public demo: https://ericjay5621.github.io/webav-video-editor/

## How it is published

1. Repository Settings → Pages → Source: **GitHub Actions**.
2. `.github/workflows/deploy-pages.yml` runs for relevant `main` changes, or manually through Actions → Deploy online demo → Run workflow.
3. Node 22 installs the lockfile with lifecycle scripts disabled, runs type checking and logic regressions, then creates a Webpack production build.
4. `PUBLIC_PATH` comes from Pages configuration, so JavaScript, CSS and assets resolve under the repository URL. Local development remains at `/`.
5. Only `dist/` is published. No private recordings, drafts, test media or internal documents are included. The workflow's deployment job has Pages-specific permissions; the build cannot push source changes.

No custom domain, paid hosting plan, rendering backend or application secret is required by this workflow. Imported media and drafts remain on the visitor's browser in the current implementation. GitHub serves the application files.

## Check a deployment

- Actions → Deploy online demo must show both build and deploy as successful.
- Open the HTTPS demo URL in desktop Chrome/Edge. Check library import, explicit timeline insertion, preview and MP4 export with a short shareable sample.
- Refresh and confirm the draft restores on that origin. Localhost drafts will not appear on the hosted origin.
- The full browser regressions are separate from the deployment checks; known failures remain documented in `VALIDATION.md`.

## Roll back or stop hosting

- Revert the source change on `main`; the workflow will build and redeploy the previous behavior. Use a normal revert rather than rewriting shared history.
- To take the demo offline, use Settings → Pages → Unpublish site. This does not delete the source repository.
- Forks must enable their own Pages settings and update README links for their owner/repository. `configure-pages` determines the build base path automatically.
