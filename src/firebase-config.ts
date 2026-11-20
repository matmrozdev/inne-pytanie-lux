import type { FirebaseOptions } from 'firebase/app';

// Firebase web configuration identifies the project and is public by design.
// Authorization is enforced by Authentication, App Check, and Database Rules.
export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyD8CtG488BWmpZ3zXsdkdQq8Hhue_kd3hc',
  authDomain: 'inne-pytanie-lux.firebaseapp.com',
  databaseURL:
    'https://inne-pytanie-lux-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'inne-pytanie-lux',
  appId: '1:38004256922:web:a1e9610bb305ba35272f23',
};
