import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addScores,
  calculateRoundScores,
  createRoomCode,
  decodeDrawing,
  encodeDrawing,
  getQuestionProgress,
  isGameComplete,
  normalizeRoomCode,
  sanitizeName,
  secureRandomIndex,
} from '../src/game.ts';
import { CATEGORIES, QUESTIONS, shuffle } from '../src/questions.ts';

test('database includes 30 CS2 pairs and a broad creative question pool', () => {
  assert.equal(QUESTIONS.filter(question => question.category === 'CS2').length, 30);
  assert.ok(QUESTIONS.length >= 200);
  assert.ok(CATEGORIES.includes('Polski internet'));
  assert.ok(CATEGORIES.includes('Memy'));
  assert.ok(QUESTIONS.every(question => !`${question.questionA} ${question.questionB}`.toLowerCase().includes('bezludną wyspę')));
});

test('question IDs are unique and pairs differ', () => {
  assert.equal(new Set(QUESTIONS.map(question => question.id)).size, QUESTIONS.length);
  assert.ok(QUESTIONS.every(question => question.questionA !== question.questionB));
});

test('round progress supports multiple questions per round', () => {
  assert.deepEqual(getQuestionProgress(1, 3), { roundNumber: 1, questionNumber: 1 });
  assert.deepEqual(getQuestionProgress(3, 3), { roundNumber: 1, questionNumber: 3 });
  assert.deepEqual(getQuestionProgress(4, 3), { roundNumber: 2, questionNumber: 1 });
  assert.equal(isGameComplete(8, { rounds: 3, questionsPerRound: 3, turnSeconds: 60 }), false);
  assert.equal(isGameComplete(9, { rounds: 3, questionsPerRound: 3, turnSeconds: 60 }), true);
});

test('shuffle preserves every item', () => {
  assert.deepEqual([...shuffle([1, 2, 3])].sort(), [1, 2, 3]);
});

test('drawing serialization preserves pen color, eraser width, and emoji stickers', () => {
  const drawing = {
    strokes: [{ points: [{ x: 0.2, y: 0.3 }], color: '#2563eb', width: 10 }],
    stickers: [{ id: 'emoji-1', emoji: '😂', x: 0.5, y: 0.4, size: 0.16 }],
  };
  assert.deepEqual(decodeDrawing(encodeDrawing(drawing)), drawing);
});

test('voting awards correct guesses and rewards the alternate player for fooled players', () => {
  const votes = {
    alice: { roundId: 1, targetUid: 'impostor', submittedAt: 1 },
    bob: { roundId: 1, targetUid: 'alice', submittedAt: 1 },
    impostor: { roundId: 1, targetUid: 'bob', submittedAt: 1 },
  };
  const roundPoints = calculateRoundScores(votes, 'impostor', ['alice', 'bob', 'impostor']);
  assert.deepEqual(roundPoints, { alice: 1, bob: 0, impostor: 1 });
  assert.deepEqual(addScores({ alice: 2, bob: 3, impostor: 1 }, roundPoints), {
    alice: 3,
    bob: 3,
    impostor: 2,
  });
});

test('room codes avoid ambiguous characters', () => {
  assert.match(createRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
});

test('room codes and player names are normalized', () => {
  assert.equal(normalizeRoomCode(' ab-cd 23! '), 'ABCD23');
  assert.equal(sanitizeName('  Jan   Kowalski  '), 'Jan Kowalski');
});

test('secure random indexes cover the whole candidate range without depending on list order', () => {
  assert.equal(secureRandomIndex(10, 0), 0);
  assert.equal(secureRandomIndex(10, 0xffff_ffff), 9);
  assert.throws(() => secureRandomIndex(0, 0));
});
