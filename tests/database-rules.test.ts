import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';

const projectId = 'demo-inne-pytanie-lux';
const room = 'ABCDEFGH';
const hostUid = 'host-user';
const guestUid = 'guest-user';
let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), `rooms/${room}`), {
      meta: {
        hostUid,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        categories: ['Losowe'],
        rounds: 3,
        questionsPerRound: 3,
        turnSeconds: 60,
      },
      members: {
        [hostUid]: { uid: hostUid, name: 'Host', connected: true, joinedAt: 1, lastSeen: 1 },
        [guestUid]: { uid: guestUid, name: 'Guest', connected: true, joinedAt: 2, lastSeen: 2 },
      },
      public: { phase: 'answering', roundId: 1, deadlineAt: Date.now() + 60_000 },
      assignments: {
        [hostUid]: { roundId: 1, question: 'Host question' },
        [guestUid]: { roundId: 1, question: 'Guest question' },
      },
      answers: {
        [hostUid]: { roundId: 1, drawing: '{"strokes":[]}', submittedAt: 1 },
      },
      hostPrivate: { pairId: 1, alternateUid: guestUid, usedIds: [1] },
    });
  });
});

after(async () => environment.cleanup());

test('members can read lobby data but outsiders cannot', async () => {
  const guest = environment.authenticatedContext(guestUid).database();
  const outsider = environment.authenticatedContext('outsider').database();
  await assertSucceeds(get(ref(guest, `rooms/${room}/members`)));
  await assertFails(get(ref(outsider, `rooms/${room}/members`)));
});

test('an authenticated host can create a room without reading it first', async () => {
  const creatorUid = 'new-host';
  const creator = environment.authenticatedContext(creatorUid).database();
  const newRoom = 'JKMNPQRS';
  await assertSucceeds(set(ref(creator, `rooms/${newRoom}/meta`), {
    hostUid: creatorUid,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    categories: ['Losowe'],
    rounds: 3,
    questionsPerRound: 3,
    turnSeconds: 60,
  }));
  await assertSucceeds(set(ref(creator, `rooms/${newRoom}/members/${creatorUid}`), {
    uid: creatorUid,
    name: 'Host',
    connected: true,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  }));
  await assertSucceeds(set(ref(creator, `rooms/${newRoom}/public`), {
    phase: 'lobby',
    roundId: 0,
  }));
});

test('a guest can only read their own assignment', async () => {
  const guest = environment.authenticatedContext(guestUid).database();
  await assertSucceeds(get(ref(guest, `rooms/${room}/assignments/${guestUid}`)));
  await assertFails(get(ref(guest, `rooms/${room}/assignments/${hostUid}`)));
});

test('only the host can change the public round state', async () => {
  const host = environment.authenticatedContext(hostUid).database();
  const guest = environment.authenticatedContext(guestUid).database();
  await assertFails(set(ref(guest, `rooms/${room}/public`), { phase: 'revealed', roundId: 1, questionA: 'Question' }));
  await assertSucceeds(set(ref(host, `rooms/${room}/public`), { phase: 'revealed', roundId: 1, questionA: 'Question' }));
});

test('the host can atomically start a round while a guest cannot', async () => {
  const nextRound = {
    assignments: {
      [hostUid]: { roundId: 2, question: 'Shared question' },
      [guestUid]: { roundId: 2, question: 'Alternate question' },
    },
    answers: null,
    public: { phase: 'answering', roundId: 2, deadlineAt: Date.now() + 60_000 },
    hostPrivate: { pairId: 2, alternateUid: guestUid, usedIds: [1, 2] },
  };
  const host = environment.authenticatedContext(hostUid).database();
  const guest = environment.authenticatedContext(guestUid).database();
  await assertFails(update(ref(guest, `rooms/${room}`), nextRound));
  await assertSucceeds(update(ref(host, `rooms/${room}`), nextRound));
});

test('only the host can change valid game settings', async () => {
  const host = environment.authenticatedContext(hostUid).database();
  const guest = environment.authenticatedContext(guestUid).database();
  await assertFails(update(ref(guest, `rooms/${room}/meta`), { rounds: 5, questionsPerRound: 2, turnSeconds: 120 }));
  await assertFails(update(ref(host, `rooms/${room}/meta`), { rounds: 0, questionsPerRound: 2, turnSeconds: 120 }));
  await assertFails(update(ref(host, `rooms/${room}/meta`), { rounds: 5, questionsPerRound: 2, turnSeconds: 45 }));
  await assertSucceeds(update(ref(host, `rooms/${room}/meta`), { rounds: 5, questionsPerRound: 2, turnSeconds: 120 }));
});

test('the host can finish a game and return everyone to the lobby', async () => {
  const host = environment.authenticatedContext(hostUid).database();
  const guest = environment.authenticatedContext(guestUid).database();
  await assertFails(set(ref(guest, `rooms/${room}/public`), { phase: 'finished', roundId: 10 }));
  await assertSucceeds(set(ref(host, `rooms/${room}/public`), { phase: 'finished', roundId: 10 }));
  await assertSucceeds(update(ref(host, `rooms/${room}`), {
    assignments: null,
    answers: null,
    hostPrivate: null,
    public: { phase: 'lobby', roundId: 0 },
  }));
});

test('answers are private until the host reveals them', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), `rooms/${room}/public`), { phase: 'answering', roundId: 1, deadlineAt: Date.now() + 60_000 });
  });
  const guest = environment.authenticatedContext(guestUid).database();
  const host = environment.authenticatedContext(hostUid).database();
  await assertSucceeds(get(ref(host, `rooms/${room}/answers`)));
  await assertFails(get(ref(guest, `rooms/${room}/answers`)));
  await assertFails(get(ref(guest, `rooms/${room}/answers/${hostUid}`)));
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), `rooms/${room}/public`), { phase: 'revealed', roundId: 1, questionA: 'Question' });
  });
  await assertSucceeds(get(ref(guest, `rooms/${room}/answers/${hostUid}`)));
  await assertSucceeds(get(ref(guest, `rooms/${room}/answers`)));
});
