# Inne pytanie Lux

An online-first Polish party game PWA for iPhone, Android, and desktop. Players join a short-lived room with an eight-character code or QR link. Firebase Authentication and Realtime Database synchronize the lobby, private questions, drawings, reveals, and presence across different networks.

The original peer-to-peer application remains available in the separate `inne-pytanie-pwa` repository. This repository does not use WebRTC signaling.

The host can configure one to twenty rounds and one to ten question pairs per round. The local database currently contains 181 paired questions across 19 categories, including Polish internet, memes, movies, places, technology, and everyday topics. Used pairs are avoided until the selected category pool is exhausted.

## Architecture

- React, TypeScript, and Vite
- GitHub Pages for the public PWA
- Firebase Anonymous Authentication
- Firebase Realtime Database
- Firebase Security Rules with per-player private assignments
- Local vector drawing encoded as compact JSON
- Versioned service-worker precache

Firebase web configuration is public by design and contains no administrator credentials. Authorization is enforced by Authentication, App Check, API restrictions, and `database.rules.json`. Never add a service-account key or other administrator credential to this repository.

## Development

```bash
npm install
npm test
npm run dev
```

Run Realtime Database Rules tests with Java 21 or newer:

```bash
npm run test:rules
```

## Firebase setup

1. Create a dedicated Firebase project on the Spark plan.
2. Enable Anonymous Authentication.
3. Create a Realtime Database.
4. Register a web app and copy its public configuration to `src/firebase-config.ts`.
5. Deploy rules with `firebase deploy --only database`.
6. Restrict the Firebase API key to the production GitHub Pages origin and required Firebase APIs.
7. Enable and enforce Firebase App Check after validating production traffic.

## Security model

- A room expires six hours after creation.
- Only the host can change categories, start rounds, reveal answers, or close the room.
- Each player can write only their own presence and answer.
- A player can read only their own private assignment.
- Answers are visible to the host while drawing and to all room members only after reveal.
- Drawing payloads and player names have server-enforced size limits.
- The app stores no email address, password, or profile account.
