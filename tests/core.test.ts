import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRoomCode,
  decodeDrawing,
  encodeDrawing,
  getQuestionProgress,
  isGameComplete,
  normalizeRoomCode,
  sanitizeName,
} from '../src/game.ts';
import { CATEGORIES, QUESTIONS, shuffle } from '../src/questions.ts';

test('database includes 30 CS2 pairs and many general pairs', () => {
  assert.equal(QUESTIONS.filter(question => question.category === 'CS2').length, 30);
  assert.ok(QUESTIONS.length >= 180);
  assert.ok(CATEGORIES.includes('Polski internet'));
  assert.ok(CATEGORIES.includes('Memy'));
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

test('drawing serialization preserves pen color and eraser width', () => {
  const drawing = { strokes: [{ points: [{ x: 0.2, y: 0.3 }], color: '#2563eb', width: 10 }] };
  assert.deepEqual(decodeDrawing(encodeDrawing(drawing)), drawing);
});

test('room codes avoid ambiguous characters', () => {
  assert.match(createRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
});

test('room codes and player names are normalized', () => {
  assert.equal(normalizeRoomCode(' ab-cd 23! '), 'ABCD23');
  assert.equal(sanitizeName('  Jan   Kowalski  '), 'Jan Kowalski');
});
