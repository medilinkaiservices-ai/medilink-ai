# Medilink AI QA Smoke Test

Run this after major app changes and before any preview build.

## Lawyer flow

1. Open `Home`
2. Open `Cases`
3. Select a case
4. Open `Workspace`
5. Open `Research`
6. Send one issue or authority to `Copilot`
7. Send a prompt
8. Apply one draft patch
9. Open `Draft`
10. Restore one previous draft version
11. Open `Final Summary`
12. Share one output

## Case and client flow

1. Open `Clients`
2. Start `New Case` from a client
3. Save the case
4. Edit the case
5. Archive the case
6. Restore the case from `Archived`

## Copilot flow

1. Open `Copilot` without a selected case
2. Send a general prompt
3. Attach from `Gallery`
4. Attach from `Files`
5. Open a case and return to `Copilot`
6. Confirm selected case is visible immediately
7. Confirm helper content disappears after chat starts

## Trust layer flow

1. Open `Research`
2. Confirm trust metadata is visible on authority cards
3. Open `Final Summary`
4. Confirm readiness score and review priority are visible
5. Confirm matter-specific checklist is visible

## Roles flow

1. Switch to `Senior`
2. Open `Review Queue`
3. Open `Review Tools`
4. Switch to `Firm`
5. Open `Matters`
6. Open `Firm Tools`

## Pass criteria

- No red screen
- No blocked navigation
- No missing back action
- No hidden composer in Copilot
- No overlapping bottom nav on work screens
- Export actions open the native share sheet
