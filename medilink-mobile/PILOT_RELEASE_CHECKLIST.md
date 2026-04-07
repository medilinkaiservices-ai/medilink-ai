# Medilink AI Pilot Release Checklist

Use this checklist before sharing any Android preview build with pilot lawyers.

## 1. Local prep

- Run `npm install`
- Run `npx expo start -c`
- Open the app in Expo Go
- Confirm the app launches without red screens

## 2. Core smoke test

- Open `Home`
- Open `Cases`
- Create a `New Case`
- Open `Research`
- Send one authority or citation to `Copilot`
- Generate and apply one draft patch
- Open `Draft` and confirm history/compare works
- Open `Final Summary` and trigger one export/share action
- Archive and restore one case

## 3. Role pass

- Switch to `Lawyer`
- Switch to `Senior`
- Switch to `Firm`
- Confirm `Home`, `Cases`, `Tools`, and `Copilot` labels change correctly

## 4. Trust and readiness pass

- Open `Research`
- Confirm trust cards show:
  - confidence
  - freshness
  - treatment
  - proposition
  - pinpoint
- Open `Final Summary`
- Confirm readiness score and review priority are visible
- Confirm priority banner is visible when support is stale or flagged

## 5. Android preview build

- Run `npx eas login`
- Run `npx eas build:configure`
- Run `npm run build:android:preview`
- Wait for EAS preview build link

## 6. Pilot share pack

Share these items with pilot lawyers:

- Android preview install link
- One-line product positioning
- Short usage note:
  - open a case
  - review research
  - use Copilot
  - apply draft change
  - export final summary
- Known limitation note:
  - verify authorities before filing
  - legal support may still require manual review

## 7. Feedback capture

Collect these 5 items from each pilot user:

- Was case selection clear?
- Did research feel trustworthy?
- Was Copilot useful for drafting?
- Was final summary/export enough for real work?
- Where did they stop trusting the app?
