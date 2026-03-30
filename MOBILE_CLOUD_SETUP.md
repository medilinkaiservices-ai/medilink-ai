# Medilink AI Mobile + Cloud Setup

This repo is now prepared for a mobile-first workflow where the files live in GitHub and builds or deploys run in the cloud.

## Recommended stack

- GitHub for source control
- GitHub Codespaces for full cloud development
- GitHub Actions for build checks and manual deploys
- Firebase Hosting + Firebase Functions for runtime

## Daily workflow

1. Make changes with Codex and push them to GitHub.
2. Open the repo in Codespaces from mobile when you need a full terminal workspace.
3. Let the dev container install dependencies automatically.
4. Run `npm run dev` for the React app.
5. Run `npm run serve:functions` when you need the Firebase emulator.
6. Trigger `Firebase Deploy` from the GitHub Actions tab when you want a cloud deploy.

## Files added for this setup

- `.devcontainer/devcontainer.json`
- `.github/workflows/cloud-checks.yml`
- `.github/workflows/firebase-deploy.yml`

## Required GitHub secret

Add this repository secret before running deploys:

- `FIREBASE_SERVICE_ACCOUNT_MEDILINK_AI_B3CF9`

Use a Firebase service account JSON from project `medilink-ai-b3cf9`.

## Important cleanup note

Environment-style files are now ignored by `.gitignore`, but any secret files that were already tracked in git still need a separate cleanup commit.
