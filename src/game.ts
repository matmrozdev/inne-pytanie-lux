import type { Category, QuestionPair } from './questions';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
export const ROOM_CODE_LENGTH = 8;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_ROUNDS = 3;
export const DEFAULT_QUESTIONS_PER_ROUND = 3;
export const MAX_ROUNDS = 20;
export const MAX_QUESTIONS_PER_ROUND = 10;
export const TURN_SECONDS_OPTIONS = [30, 60, 90, 120] as const;
export const DEFAULT_TURN_SECONDS = 60;

export type GamePhase = 'lobby' | 'answering' | 'revealed' | 'voting' | 'results' | 'finished';

export interface GameSettings {
  rounds: number;
  questionsPerRound: number;
  turnSeconds: number;
}

export interface Player {
  uid: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  lastSeen: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color?: string;
  width?: number;
}

export interface EmojiSticker {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
}

export interface Drawing {
  strokes: Stroke[];
  stickers?: EmojiSticker[];
}

export interface PublicRound {
  phase: GamePhase;
  roundId: number;
  questionA?: string;
  questionB?: string;
  alternateUid?: string;
  deadlineAt?: number;
}

export interface Assignment {
  roundId: number;
  question: string;
}

export interface StoredAnswer {
  roundId: number;
  drawing: string;
  submittedAt: number;
}

export interface Vote {
  roundId: number;
  targetUid: string;
  submittedAt: number;
}

export type Scores = Record<string, number>;

export function calculateRoundScores(
  votes: Record<string, Vote>,
  alternateUid: string,
  playerUids: string[],
): Scores {
  const points = Object.fromEntries(playerUids.map(uid => [uid, 0]));
  for (const voterUid of playerUids) {
    if (voterUid === alternateUid) continue;
    if (votes[voterUid]?.targetUid === alternateUid) points[voterUid] += 1;
    else points[alternateUid] += 1;
  }
  return points;
}

export function addScores(current: Scores, roundPoints: Scores): Scores {
  return Object.fromEntries(
    Object.keys(roundPoints).map(uid => [uid, (current[uid] ?? 0) + roundPoints[uid]]),
  );
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value) || minimum));
}

export function getQuestionProgress(roundId: number, questionsPerRound: number): {
  roundNumber: number;
  questionNumber: number;
} {
  const safeQuestionCount = clampInteger(questionsPerRound, 1, MAX_QUESTIONS_PER_ROUND);
  const safeRoundId = Math.max(1, roundId);
  return {
    roundNumber: Math.floor((safeRoundId - 1) / safeQuestionCount) + 1,
    questionNumber: ((safeRoundId - 1) % safeQuestionCount) + 1,
  };
}

export function isGameComplete(roundId: number, settings: GameSettings): boolean {
  return roundId >= settings.rounds * settings.questionsPerRound;
}

export function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 30);
}

export function createRoomCode(randomValues?: Uint8Array): string {
  const bytes = randomValues ?? crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return Array.from(bytes.slice(0, ROOM_CODE_LENGTH), value => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
}

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function secureRandomIndex(length: number, randomValue?: number): number {
  if (!Number.isInteger(length) || length < 1) throw new Error('Nie można losować z pustej listy.');
  const value = randomValue ?? crypto.getRandomValues(new Uint32Array(1))[0];
  return Math.floor((value / 0x1_0000_0000) * length);
}

export function chooseQuestion(
  questions: QuestionPair[],
  categories: Category[],
  usedIds: number[],
): { question: QuestionPair; usedIds: number[] } {
  const pool = questions.filter(question => categories.includes(question.category));
  if (!pool.length) throw new Error('Wybierz przynajmniej jedną kategorię.');
  const available = pool.filter(question => !usedIds.includes(question.id));
  const candidates = available.length ? available : pool;
  const question = candidates[secureRandomIndex(candidates.length)];
  const nextUsed = available.length ? [...usedIds, question.id] : [question.id];
  return { question, usedIds: nextUsed };
}

export function chooseAlternateUid(playerUids: string[], previousUid?: string): string {
  if (!playerUids.length) throw new Error('Brak graczy.');
  const candidates = playerUids.length > 1 && previousUid
    ? playerUids.filter(uid => uid !== previousUid)
    : playerUids;
  return candidates[secureRandomIndex(candidates.length)];
}

export function encodeDrawing(drawing: Drawing): string {
  return JSON.stringify(drawing);
}

export function decodeDrawing(value?: string): Drawing {
  if (!value) return { strokes: [] };
  try {
    const parsed = JSON.parse(value) as Drawing;
    if (!Array.isArray(parsed.strokes)) return { strokes: [] };
    if (parsed.stickers !== undefined && !Array.isArray(parsed.stickers)) delete parsed.stickers;
    return parsed;
  } catch {
    return { strokes: [] };
  }
}
