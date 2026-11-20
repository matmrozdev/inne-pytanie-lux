import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { firebaseConfig } from './firebase-config';

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);

export async function ensureAnonymousUser(): Promise<User> {
  await auth.authStateReady();
  await setPersistence(auth, browserLocalPersistence);
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}
