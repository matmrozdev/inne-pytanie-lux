import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';

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
      },
      members: {
        [hostUid]: { uid: hostUid, name: 'Host', connected: true, joinedAt: 1, lastSeen: 1 },
        [guestUid]: { uid: guestUid, name: 'Guest', connected: true, joinedAt: 2, lastSeen: 2 },
      },
      public: { phase: 'answering', roundId: 1 },
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

test('answers are private until the host reveals them', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), `rooms/${room}/public`), { phase: 'answering', roundId: 1 });
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
