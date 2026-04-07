@echo off
cd /d C:\Programs\Medilink-AI

start "Medilink Functions + Firestore" cmd /k "cd /d C:\Programs\Medilink-AI && npx firebase-tools emulators:start --config C:\Programs\Medilink-AI\firebase.json --only functions,firestore"
start "Medilink Expo Web" cmd /k "cd /d C:\Programs\Medilink-AI && npm --prefix medilink-mobile run web"
