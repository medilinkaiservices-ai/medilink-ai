# Medilink AI Mobile

Expo-based mobile app shell for the Medilink AI law assistant.

## Current state

- Mobile-first launcher home
- Cases screen with sample tracked matters and search
- Case workspace with `Profile / Case Details / Research / Final Summary`
- Copilot, Research, and Final Summary mobile workflows
- Android/iOS package ids updated for Medilink AI
- EAS build profiles added for Android/iOS packaging
- Separate iPhone demo build path added so demo builds do not disturb the main app identity

## Start

1. Run `npm install`
2. Run `npm start`
3. Open Expo Go on your phone and scan the QR code
4. Or press `w` in the terminal to run in the web browser.

## Build commands

1. Run `npm install`
2. Run `npm start` for Expo Go testing
3. Run `npm run build:android:preview` for an installable Android preview build
4. Run `npm run build:android:prod` for the Android production build
5. Run `npx expo start --web` to start the app directly in your browser.
5. Run `npm run build:ios:demo` for a separate internal iPhone demo build
6. Run `npm run build:ios:preview` for the main internal iOS preview build
7. Run `npm run build:ios:prod` for the iOS production build

## EAS setup

1. Run `npx eas login`
2. Run `npx eas build:configure`
3. Then run one of:
   - `npm run build:android:preview`
   - `npm run build:android:prod`
   - `npm run build:ios:demo`
   - `npm run build:ios:preview`
   - `npm run build:ios:prod`

## Release path

1. Use `npm start` and Expo Go for fast daily testing
2. Use `npm run build:android:preview` to generate the installable pilot build
3. Share preview build links with pilot lawyers and collect feedback
4. Promote stable fixes into `npm run build:android:prod`
5. Use `npm run build:ios:demo` for a safe iPhone demo build with a separate iOS app identity
6. Keep iOS on preview/prod EAS builds after the demo flow is stable

## iPhone demo path

Use this when you want the app on an iPhone without disturbing the current Expo Go flow or future production app identity.

1. Run `npx eas login`
2. Run `npx eas build:configure`
3. Run `npm run build:ios:demo`
4. Complete Apple device registration / internal distribution steps when EAS asks
5. Install the generated demo build on the iPhone

Notes:
- Demo build uses a separate iOS bundle identifier: `com.medilink.ai.demo`
- Current Expo Go workflow remains untouched
- Production app identity remains reserved for the final release

## Release docs

- Pilot release checklist: [PILOT_RELEASE_CHECKLIST.md](./PILOT_RELEASE_CHECKLIST.md)
- QA smoke test: [QA_SMOKE_TEST.md](./QA_SMOKE_TEST.md)

## Next build steps

1. Add Firebase auth/session wiring
2. Replace sample matter cards with live case data
3. Connect research, Copilot, and final summary APIs
4. Fine-tune Android drawer/gesture polish
5. Generate Android build first
