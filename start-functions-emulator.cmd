@echo off
cd /d C:\Programs\Medilink-AI
set GEMINI_KEY=AIzaSyCl7dqFMm8c0qGVdkm50hifhtvPGSh5PCs
set WHATSAPP_PHONE_NUMBER_ID=964932490041852
set WHATSAPP_TOKEN=local-dev-token
npx firebase-tools emulators:start --only functions > firebase-functions-live.log 2> firebase-functions-live.err.log
