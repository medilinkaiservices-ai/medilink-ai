# Medilink-AI

This repo is centered on one frontend app plus Firebase functions:

- `medilink-mobile`: Expo app for Android and hosted web
- `functions`: Firebase Cloud Functions

## Quick start

Run the app from the project root:

```bash
npm run dev
```

Install all dependencies from the repo root:

```bash
npm run bootstrap
```

Build the hosted web app:

```bash
npm run build
```

Run root tests:

```bash
npm run test
```

Lint Firebase functions:

```bash
npm run lint:functions
```

Run Firebase functions emulator:

```bash
npm run serve:functions
```

## Mobile and cloud workflow

For a mobile-first setup with Codex and cloud execution:

- Keep the project in GitHub
- Open it in GitHub Codespaces when you need a full workspace
- Use GitHub Actions for build checks and manual Firebase deploys
- See `MOBILE_CLOUD_SETUP.md` for the setup checklist

## Install dependencies

If you need to reinstall packages:

```bash
npm run install:app
npm run install:functions
```

## Project structure

```text
medilink-mobile/
  App.js        Shared Android + web app shell
  src/          Supporting app modules and assets

functions/
  index.js      Firebase functions entry
  legalCorpus.js Indian law retrieval corpus
```

## Law Assistant module

Hosted web app route:

- `http://localhost:19006`

Inside module:

- Public User Mode (English + Telugu support, structured legal guidance, disclaimer)
- Lawyer Mode (research, drafting, case analyzer, document analyzer, client/case/task workflow, smart memory, voice dictation)
- Billing & Plans (trial/pro/enterprise usage metering)
- Audit Logs (action trace for legal operations)

### Environment variables for AI

Set these in `functions/.env` (or Firebase env equivalent):

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
RAZORPAY_KEY_ID=rzp_live_or_test_key
RAZORPAY_KEY_SECRET=razorpay_secret
```

Fallback behavior:

- If OpenAI key is missing/unavailable, service still responds with deterministic legal guidance using built-in Indian legal corpus.

### Current production notes

- The legal corpus now prefers current Indian criminal-law references under BNS, BNSS and BSA.
- Legacy IPC/CrPC case references may still appear in older judgments, but fresh guidance should verify the updated section mapping before filing or advising.
- OCR-ready extraction endpoint is available via `legalAssistant` action `document_extract`.
- Text files extract directly.
- Images use OpenAI OCR when available, with Gemini fallback.
- PDFs (including scanned-style uploads) now use AI extraction fallback through Gemini in `document_extract`.
- Extraction response includes `qualityScore` and `pagePreviews` for UI confidence and page-wise verification.
- Razorpay billing endpoints are integrated:
  - `legalAssistant` actions: `billing_config`, `billing_create_order`, `billing_verify_payment`
  - webhook function: `legalBillingWebhook`
