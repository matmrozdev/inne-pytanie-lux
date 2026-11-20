import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import type { User } from 'firebase/auth';
import { database, ensureAnonymousUser } from './firebase';
import {
  createRoomCode,
  MAX_PLAYERS,
  ROOM_TTL_MS,
  sanitizeName,
  type Assignment,
  type GameSettings,
  type Player,
  type PublicRound,
  type Scores,
  type StoredAnswer,
  type Vote,
} from './game';
import type { Category, QuestionPair } from './questions';

export interface RoomMeta {
  hostUid: string;
  createdAt: number;
  expiresAt: number;
  categories: Category[];
  rounds: number;
  questionsPerRound: number;
  turnSeconds: number;
}

export interface HostPrivateState {
  pairId: number;
  alternateUid: string;
  usedIds: number[];
}

const roomPath = (code: string, child = '') => `rooms/${code}${child ? `/${child}` : ''}`;

export async function createRoom(
  hostName: string,
  categories: Category[],
  settings: GameSettings,
): Promise<{ code: string; user: User }> {
  const user = await ensureAnonymousUser();
  const name = sanitizeName(hostName);
  if (!name) throw new Error('Podaj imię hosta.');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createRoomCode();
    const now = Date.now();
    const meta: RoomMeta = {
      hostUid: user.uid,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      categories,
      rounds: settings.rounds,
      questionsPerRound: settings.questionsPerRound,
      turnSeconds: settings.turnSeconds,
    };
    try {
      // A transaction would need read access before this room exists. The
      // creation-only rule rejects collisions without exposing unused codes.
      await set(ref(database, roomPath(code, 'meta')), meta);
    } catch {
      continue;
    }
    try {
      await update(ref(database, roomPath(code)), {
        [`members/${user.uid}`]: {
          uid: user.uid,
          name,
          connected: true,
          joinedAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        },
        public: { phase: 'lobby', roundId: 0 },
      });
    } catch {
      await remove(ref(database, roomPath(code)));
      throw new Error('Nie udało się przygotować pokoju. Spróbuj ponownie.');
    }
    return { code, user };
  }
  throw new Error('Nie udało się utworzyć unikalnego pokoju. Spróbuj ponownie.');
}

export async function joinRoom(code: string, playerName: string): Promise<User> {
  const user = await ensureAnonymousUser();
  const name = sanitizeName(playerName);
  if (!name) throw new Error('Podaj swoje imię.');
  const metaSnapshot = await get(ref(database, roomPath(code, 'meta')));
  const meta = metaSnapshot.val() as RoomMeta | null;
  if (!meta || meta.expiresAt <= Date.now()) throw new Error('Pokój nie istnieje albo już wygasł.');

  await set(ref(database, roomPath(code, `members/${user.uid}`)), {
    uid: user.uid,
    name,
    connected: true,
    joinedAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
  });
  const membersSnapshot = await get(ref(database, roomPath(code, 'members')));
  const members = membersSnapshot.val() as Record<string, Player> | null;
  if (Object.keys(members ?? {}).length > MAX_PLAYERS) {
    await remove(ref(database, roomPath(code, `members/${user.uid}`)));
    throw new Error(`Pokój jest pełny — maksymalnie ${MAX_PLAYERS} graczy.`);
  }
  return user;
}

export async function resumeRoom(code: string): Promise<User | null> {
  const user = await ensureAnonymousUser();
  try {
    const [metaSnapshot, membersSnapshot] = await Promise.all([
      get(ref(database, roomPath(code, 'meta'))),
      get(ref(database, roomPath(code, 'members'))),
    ]);
    const meta = metaSnapshot.val() as RoomMeta | null;
    const members = membersSnapshot.val() as Record<string, Player> | null;
    if (!meta || meta.expiresAt <= Date.now() || !members?.[user.uid]) return null;
    return user;
  } catch {
    return null;
  }
}

export async function registerPresence(code: string, uid: string): Promise<Unsubscribe> {
  const memberRef = ref(database, roomPath(code, `members/${uid}`));
  return onValue(ref(database, '.info/connected'), async snapshot => {
    if (snapshot.val() !== true) return;
    await onDisconnect(memberRef).update({ connected: false, lastSeen: serverTimestamp() });
    await update(memberRef, { connected: true, lastSeen: serverTimestamp() });
  });
}

export function listenMeta(code: string, callback: (meta: RoomMeta | null) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, 'meta')), snapshot => callback(snapshot.val()));
}

export function listenMembers(code: string, callback: (members: Record<string, Player>) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, 'members')), snapshot => callback(snapshot.val() ?? {}));
}

export function listenPublicRound(code: string, callback: (round: PublicRound) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, 'public')), snapshot => callback(snapshot.val() ?? { phase: 'lobby', roundId: 0 }));
}

export function listenAssignment(code: string, uid: string, callback: (assignment: Assignment | null) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, `assignments/${uid}`)), snapshot => callback(snapshot.val()));
}

export function listenAnswers(
  code: string,
  uid: string,
  canSeeAll: boolean,
  callback: (answers: Record<string, StoredAnswer>) => void,
): Unsubscribe {
  if (canSeeAll) {
    return onValue(ref(database, roomPath(code, 'answers')), snapshot => callback(snapshot.val() ?? {}));
  }
  return onValue(ref(database, roomPath(code, `answers/${uid}`)), snapshot => {
    callback(snapshot.exists() ? { [uid]: snapshot.val() } : {});
  });
}

export function listenVotes(
  code: string,
  uid: string,
  canSeeAll: boolean,
  callback: (votes: Record<string, Vote>) => void,
): Unsubscribe {
  if (canSeeAll) {
    return onValue(ref(database, roomPath(code, 'votes')), snapshot => callback(snapshot.val() ?? {}));
  }
  return onValue(ref(database, roomPath(code, `votes/${uid}`)), snapshot => {
    callback(snapshot.exists() ? { [uid]: snapshot.val() } : {});
  });
}

export function listenScores(code: string, callback: (scores: Scores) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, 'scores')), snapshot => callback(snapshot.val() ?? {}));
}

export function listenHostPrivate(code: string, callback: (state: HostPrivateState | null) => void): Unsubscribe {
  return onValue(ref(database, roomPath(code, 'hostPrivate')), snapshot => callback(snapshot.val()));
}

export async function updateCategories(code: string, categories: Category[]): Promise<void> {
  await set(ref(database, roomPath(code, 'meta/categories')), categories);
}

export async function updateGameSettings(code: string, settings: GameSettings): Promise<void> {
  await update(ref(database, roomPath(code, 'meta')), settings);
}

export async function startRound(
  code: string,
  roundId: number,
  pair: QuestionPair,
  alternateUid: string,
  playerUids: string[],
  usedIds: number[],
  turnSeconds: number,
): Promise<void> {
  const assignments = Object.fromEntries(playerUids.map(uid => [uid, {
    roundId,
    question: uid === alternateUid ? pair.questionB : pair.questionA,
  }]));
  await update(ref(database, roomPath(code)), {
    assignments,
    answers: null,
    votes: null,
    public: { phase: 'answering', roundId, deadlineAt: Date.now() + turnSeconds * 1000 },
    hostPrivate: { pairId: pair.id, alternateUid, usedIds },
  });
}

export async function submitAnswer(code: string, uid: string, answer: StoredAnswer): Promise<void> {
  await set(ref(database, roomPath(code, `answers/${uid}`)), {
    ...answer,
    submittedAt: serverTimestamp(),
  });
}

export async function revealAnswers(code: string, roundId: number, questionA: string): Promise<void> {
  await set(ref(database, roomPath(code, 'public')), { phase: 'revealed', roundId, questionA });
}

export async function startVoting(
  code: string,
  roundId: number,
  questionA: string,
): Promise<void> {
  await set(ref(database, roomPath(code, 'public')), { phase: 'voting', roundId, questionA });
}

export async function submitVote(code: string, uid: string, vote: Vote): Promise<void> {
  await set(ref(database, roomPath(code, `votes/${uid}`)), {
    ...vote,
    submittedAt: serverTimestamp(),
  });
}

export async function finishVoting(
  code: string,
  roundId: number,
  pair: QuestionPair,
  alternateUid: string,
  scores: Scores,
): Promise<void> {
  await update(ref(database, roomPath(code)), {
    scores,
    public: {
      phase: 'results',
      roundId,
      questionA: pair.questionA,
      questionB: pair.questionB,
      alternateUid,
    },
  });
}

export async function finishGame(code: string, roundId: number): Promise<void> {
  await set(ref(database, roomPath(code, 'public')), { phase: 'finished', roundId });
}

export async function returnToLobby(code: string): Promise<void> {
  await update(ref(database, roomPath(code)), {
    assignments: null,
    answers: null,
    votes: null,
    scores: null,
    hostPrivate: null,
    public: { phase: 'lobby', roundId: 0 },
  });
}

export async function removePlayer(code: string, uid: string): Promise<void> {
  await remove(ref(database, roomPath(code, `members/${uid}`)));
}

export async function closeRoom(code: string): Promise<void> {
  await remove(ref(database, roomPath(code)));
}
