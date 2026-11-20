import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { DrawingCanvas } from './DrawingCanvas';
import {
  addScores,
  calculateRoundScores,
  chooseAlternateUid,
  chooseQuestion,
  clampInteger,
  decodeDrawing,
  DEFAULT_QUESTIONS_PER_ROUND,
  DEFAULT_ROUNDS,
  DEFAULT_TURN_SECONDS,
  encodeDrawing,
  getQuestionProgress,
  isGameComplete,
  MAX_QUESTIONS_PER_ROUND,
  MAX_ROUNDS,
  TURN_SECONDS_OPTIONS,
  MIN_PLAYERS,
  normalizeRoomCode,
  type Assignment,
  type Drawing,
  type GameSettings,
  type Player,
  type PublicRound,
  type Scores,
  type StoredAnswer,
  type Vote,
} from './game';
import {
  closeRoom,
  createRoom,
  finishVoting,
  finishGame,
  joinRoom,
  listenAnswers,
  listenAssignment,
  listenHostPrivate,
  listenMembers,
  listenMeta,
  listenPublicRound,
  listenScores,
  listenVotes,
  removePlayer,
  returnToLobby,
  revealAnswers,
  startRound,
  startVoting,
  submitAnswer,
  submitVote,
  updateCategories,
  updateGameSettings,
  type HostPrivateState,
  type RoomMeta,
} from './game-store';
import { CATEGORIES, QUESTIONS, type Category } from './questions';
import { QrScanner } from './QrScanner';
import './scanner.css';

type Mode = 'home' | 'host' | 'join';

function Shell({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  return <main>
    <header><b>≠</b> Inne pytanie <em className={online ? 'online-label' : 'offline-label'}>{online ? 'online' : 'offline'}</em></header>
    {children}
  </main>;
}

function ErrorMessage({ error }: { error: string }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

function RoomCode({ code }: { code: string }) {
  const [qr, setQr] = useState('');
  const joinUrl = useMemo(() => {
    const url = new URL(location.href);
    url.search = `?room=${code}`;
    return url.toString();
  }, [code]);
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { errorCorrectionLevel: 'M', margin: 1, width: 280 }).then(setQr);
  }, [joinUrl]);
  return <div className="code room-code">
    {qr && <img className="qr" src={qr} alt={`Kod QR pokoju ${code}`} />}
    <span>Kod pokoju</span>
    <strong>{code}</strong>
    <button onClick={() => navigator.clipboard.writeText(joinUrl)}>Kopiuj link</button>
    {'share' in navigator && <button onClick={() => navigator.share({ title: 'Inne pytanie', text: `Dołącz do pokoju ${code}`, url: joinUrl })}>Udostępnij</button>}
  </div>;
}

function CategoryPicker({ selected, onChange, disabled = false }: {
  selected: Category[];
  onChange: (categories: Category[]) => void;
  disabled?: boolean;
}) {
  return <div className="chips">
    <button
      disabled={disabled}
      className={selected.length === CATEGORIES.length ? 'on' : ''}
      onClick={() => onChange(selected.length === CATEGORIES.length ? [] : [...CATEGORIES])}
    >✨ Wszystkie</button>
    {CATEGORIES.map(category => <button
      key={category}
      disabled={disabled}
      className={selected.includes(category) ? 'on' : ''}
      onClick={() => onChange(selected.includes(category)
        ? selected.filter(value => value !== category)
        : [...selected, category])}
    >{category}</button>)}
  </div>;
}

function NumberSetting({ label, value, minimum, maximum, onChange, disabled = false }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return <label className="number-setting">
    <span>{label}</span>
    <div>
      <button disabled={disabled || value <= minimum} onClick={() => onChange(value - 1)} aria-label={`Zmniejsz: ${label}`}>−</button>
      <input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={minimum}
        max={maximum}
        disabled={disabled}
        value={value}
        onChange={event => onChange(clampInteger(Number(event.target.value), minimum, maximum))}
      />
      <button disabled={disabled || value >= maximum} onClick={() => onChange(value + 1)} aria-label={`Zwiększ: ${label}`}>+</button>
    </div>
  </label>;
}

function GameSettingsPicker({ settings, onChange, disabled = false }: {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  disabled?: boolean;
}) {
  return <div className="settings-grid">
    <NumberSetting
      label="Liczba rund"
      value={settings.rounds}
      minimum={1}
      maximum={MAX_ROUNDS}
      disabled={disabled}
      onChange={rounds => onChange({ ...settings, rounds })}
    />
    <NumberSetting
      label="Pytań w rundzie"
      value={settings.questionsPerRound}
      minimum={1}
      maximum={MAX_QUESTIONS_PER_ROUND}
      disabled={disabled}
      onChange={questionsPerRound => onChange({ ...settings, questionsPerRound })}
    />
    <div className="time-setting">
      <span>Czas na pytanie</span>
      <div className="time-options">
        {TURN_SECONDS_OPTIONS.map(seconds => <button
          key={seconds}
          disabled={disabled}
          className={settings.turnSeconds === seconds ? 'on' : ''}
          onClick={() => onChange({ ...settings, turnSeconds: seconds })}
        >{seconds} s</button>)}
      </div>
    </div>
    <p>Łącznie: <strong>{settings.rounds * settings.questionsPerRound}</strong> pytań</p>
  </div>;
}

function QuestionTimer({ deadlineAt, onExpire }: { deadlineAt?: number; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(((deadlineAt ?? Date.now()) - Date.now()) / 1000)));
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);
  useEffect(() => {
    expired.current = false;
    const update = () => {
      const next = Math.max(0, Math.ceil(((deadlineAt ?? Date.now()) - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0 && !expired.current) {
        expired.current = true;
        onExpireRef.current?.();
      }
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, '0');
  return <div className={remaining <= 10 ? 'question-timer urgent' : 'question-timer'}>
    <span>{remaining ? 'Pozostały czas' : 'Czas minął'}</span>
    <strong>{minutes}:{seconds}</strong>
  </div>;
}

function HostSetup({ onReady }: { onReady: (code: string, uid: string) => void }) {
  const [name, setName] = useState(localStorage.getItem('lux-name') ?? 'Host');
  const [categories, setCategories] = useState<Category[]>(['Losowe']);
  const [settings, setSettings] = useState<GameSettings>({
    rounds: clampInteger(Number(localStorage.getItem('lux-rounds') ?? DEFAULT_ROUNDS), 1, MAX_ROUNDS),
    questionsPerRound: clampInteger(Number(localStorage.getItem('lux-questions-per-round') ?? DEFAULT_QUESTIONS_PER_ROUND), 1, MAX_QUESTIONS_PER_ROUND),
    turnSeconds: TURN_SECONDS_OPTIONS.includes(Number(localStorage.getItem('lux-turn-seconds')) as typeof TURN_SECONDS_OPTIONS[number])
      ? Number(localStorage.getItem('lux-turn-seconds'))
      : DEFAULT_TURN_SECONDS,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <Shell><section className="screen">
    <p className="tag">Nowa gra przez internet</p>
    <h1>Utwórz pokój</h1>
    <label>Twoje imię<input value={name} maxLength={30} onChange={event => setName(event.target.value)} /></label>
    <h2>Kategorie</h2>
    <CategoryPicker selected={categories} onChange={setCategories} />
    <h2>Ustawienia gry</h2>
    <GameSettingsPicker settings={settings} onChange={setSettings} />
    <ErrorMessage error={error} />
    <button className="primary" disabled={loading || !name.trim() || !categories.length} onClick={async () => {
      setLoading(true);
      setError('');
      try {
        localStorage.setItem('lux-name', name.trim());
        localStorage.setItem('lux-rounds', String(settings.rounds));
        localStorage.setItem('lux-questions-per-round', String(settings.questionsPerRound));
        localStorage.setItem('lux-turn-seconds', String(settings.turnSeconds));
        const result = await createRoom(name, categories, settings);
        onReady(result.code, result.user.uid);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Nie udało się utworzyć pokoju.');
      } finally {
        setLoading(false);
      }
    }}>{loading ? 'Tworzenie…' : 'Utwórz pokój'}</button>
  </section></Shell>;
}

function JoinSetup({ initialCode, onReady }: { initialCode: string; onReady: (code: string, uid: string) => void }) {
  const [name, setName] = useState(localStorage.getItem('lux-name') ?? 'Gracz');
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <Shell><section className="screen">
    <p className="tag">Dołącz przez internet</p>
    <h1>Dołącz do pokoju</h1>
    <label>Twoje imię<input value={name} maxLength={30} onChange={event => setName(event.target.value)} /></label>
    <QrScanner onScan={value => {
      try {
        setCode(normalizeRoomCode(new URL(value).searchParams.get('room') ?? value));
      } catch {
        setCode(normalizeRoomCode(value));
      }
    }} />
    <label>Kod pokoju<input className="room-input" value={code} inputMode="text" autoCapitalize="characters" onChange={event => setCode(normalizeRoomCode(event.target.value))} /></label>
    <ErrorMessage error={error} />
    <button className="primary" disabled={loading || !name.trim() || code.length !== 8} onClick={async () => {
      setLoading(true);
      setError('');
      try {
        localStorage.setItem('lux-name', name.trim());
        const normalizedCode = normalizeRoomCode(code);
        const user = await joinRoom(normalizedCode, name);
        history.replaceState({}, '', `${location.pathname}?room=${normalizedCode}`);
        onReady(normalizedCode, user.uid);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Nie udało się dołączyć.');
      } finally {
        setLoading(false);
      }
    }}>{loading ? 'Łączenie…' : 'Dołącz'}</button>
  </section></Shell>;
}

function PlayerList({ members, hostUid, currentUid, onRemove }: {
  members: Record<string, Player>;
  hostUid: string;
  currentUid: string;
  onRemove?: (uid: string) => void;
}) {
  return <div className="players">
    {Object.values(members).sort((a, b) => a.joinedAt - b.joinedAt).map(player => <div className="player" key={player.uid}>
      <span><i className={player.connected ? 'online' : ''} />{player.name}{player.uid === hostUid ? ' ★' : ''}</span>
      {onRemove && player.uid !== currentUid && <button onClick={() => onRemove(player.uid)}>Usuń</button>}
    </div>)}
  </div>;
}

function AnswerGallery({ members, answers }: {
  members: Record<string, Player>;
  answers: Record<string, StoredAnswer>;
}) {
  return <div className="answers">
    {Object.values(members).map(player => <article key={player.uid}>
      <h3>{player.name}</h3>
      {answers[player.uid]?.drawing
        ? <DrawingCanvas drawing={decodeDrawing(answers[player.uid].drawing)} />
        : <p>Brak odpowiedzi</p>}
    </article>)}
  </div>;
}

function Results({ round, members, answers, votes, scores, isHost, progressLabel, nextLabel, onNext }: {
  round: PublicRound;
  members: Record<string, Player>;
  answers: Record<string, StoredAnswer>;
  votes: Record<string, Vote>;
  scores: Scores;
  isHost: boolean;
  progressLabel: string;
  nextLabel: string;
  onNext: () => void;
}) {
  const playerUids = Object.keys(members);
  const roundPoints = calculateRoundScores(votes, round.alternateUid ?? '', playerUids);
  const ranking = Object.values(members).sort((a, b) => (scores[b.uid] ?? 0) - (scores[a.uid] ?? 0));
  return <Shell><section className="screen">
    <p className="tag">{progressLabel} · wyniki głosowania</p>
    <h1>{round.questionA}</h1>
    <AnswerGallery members={members} answers={answers} />
    <div className="second">
      <b>Drugie pytanie</b>
      <p>{round.questionB}</p>
      <strong>Osoba z innym pytaniem: {members[round.alternateUid ?? '']?.name ?? 'Nieznany gracz'}</strong>
    </div>
    <h2>Jak głosowaliście</h2>
    <div className="vote-results">
      {Object.values(members).map(player => <div key={player.uid}>
        <span>{player.name} → {members[votes[player.uid]?.targetUid]?.name ?? 'brak głosu'}</span>
        <strong>+{roundPoints[player.uid] ?? 0}</strong>
      </div>)}
    </div>
    <h2>Klasyfikacja</h2>
    <div className="scoreboard">
      {ranking.map((player, index) => <div key={player.uid}>
        <span><b>{index + 1}.</b> {player.name}</span>
        <strong>{scores[player.uid] ?? 0} pkt</strong>
      </div>)}
    </div>
    {isHost && <div className="actions">
      <button className="primary" onClick={onNext}>{nextLabel}</button>
    </div>}
    {!isHost && <p>Host przejdzie dalej.</p>}
  </section></Shell>;
}

function Room({ code, uid, onExit }: { code: string; uid: string; onExit: () => void }) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [members, setMembers] = useState<Record<string, Player>>({});
  const [round, setRound] = useState<PublicRound>({ phase: 'lobby', roundId: 0 });
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [answers, setAnswers] = useState<Record<string, StoredAnswer>>({});
  const [votes, setVotes] = useState<Record<string, Vote>>({});
  const [scores, setScores] = useState<Scores>({});
  const [scoresLoaded, setScoresLoaded] = useState(false);
  const [hostPrivate, setHostPrivate] = useState<HostPrivateState | null>(null);
  const [drawing, setDrawing] = useState<Drawing>({ strokes: [] });
  const [error, setError] = useState('');
  const finalizingRound = useRef<number | null>(null);
  const isHost = meta?.hostUid === uid;
  const settings: GameSettings = {
    rounds: meta?.rounds ?? DEFAULT_ROUNDS,
    questionsPerRound: meta?.questionsPerRound ?? DEFAULT_QUESTIONS_PER_ROUND,
    turnSeconds: meta?.turnSeconds ?? DEFAULT_TURN_SECONDS,
  };
  const progress = getQuestionProgress(round.roundId, settings.questionsPerRound);
  const canSeeAllAnswers = isHost || round.phase === 'revealed' || round.phase === 'voting' || round.phase === 'results';
  const canSeeAllVotes = isHost || round.phase === 'results';
  const allPlayers = useMemo(() => Object.values(members), [members]);
  const playerUids = useMemo(() => allPlayers.map(player => player.uid), [allPlayers]);
  const currentPair = hostPrivate ? QUESTIONS.find(question => question.id === hostPrivate.pairId) : undefined;

  useEffect(() => listenMeta(code, setMeta), [code]);
  useEffect(() => listenMembers(code, setMembers), [code]);
  useEffect(() => listenPublicRound(code, setRound), [code]);
  useEffect(() => listenAssignment(code, uid, setAssignment), [code, uid]);
  useEffect(() => listenAnswers(code, uid, canSeeAllAnswers, setAnswers), [code, uid, canSeeAllAnswers]);
  useEffect(() => listenVotes(code, uid, canSeeAllVotes, setVotes), [code, uid, canSeeAllVotes]);
  useEffect(() => listenScores(code, nextScores => {
    setScores(nextScores);
    setScoresLoaded(true);
  }), [code]);
  useEffect(() => isHost ? listenHostPrivate(code, setHostPrivate) : undefined, [code, isHost]);
  useEffect(() => {
    if (!meta || !isHost) return;
    if (meta.rounds && meta.questionsPerRound && meta.turnSeconds) return;
    void updateGameSettings(code, settings).catch(() => setError('Nie udało się uzupełnić ustawień pokoju.'));
  }, [code, isHost, meta, settings.questionsPerRound, settings.rounds, settings.turnSeconds]);
  useEffect(() => {
    setDrawing(decodeDrawing(answers[uid]?.drawing));
  }, [answers, uid, round.roundId]);
  useEffect(() => {
    if (!isHost || !scoresLoaded || round.phase !== 'voting' || !currentPair || !hostPrivate || !playerUids.length) return;
    const everyoneVoted = playerUids.every(playerUid => votes[playerUid]?.roundId === round.roundId);
    if (!everyoneVoted || finalizingRound.current === round.roundId) return;
    finalizingRound.current = round.roundId;
    const roundPoints = calculateRoundScores(votes, hostPrivate.alternateUid, playerUids);
    void finishVoting(
      code,
      round.roundId,
      currentPair,
      hostPrivate.alternateUid,
      addScores(scores, roundPoints),
    ).catch(() => {
      finalizingRound.current = null;
      setError('Nie udało się podliczyć głosów. Sprawdź internet.');
    });
  }, [code, currentPair, hostPrivate, isHost, playerUids, round.phase, round.roundId, scores, scoresLoaded, votes]);

  if (!meta) return <Shell><section className="screen"><h1>Łączenie z pokojem…</h1></section></Shell>;

  const beginRound = async () => {
    if (!isHost) return;
    if (allPlayers.length < MIN_PLAYERS) {
      setError(`Potrzeba minimum ${MIN_PLAYERS} graczy.`);
      return;
    }
    try {
      setError('');
      const selection = chooseQuestion(QUESTIONS, meta.categories, hostPrivate?.usedIds ?? []);
      const playerUids = allPlayers.map(player => player.uid);
      const alternateUid = chooseAlternateUid(playerUids, hostPrivate?.alternateUid);
      await startRound(code, round.roundId + 1, selection.question, alternateUid, playerUids, selection.usedIds, settings.turnSeconds);
      setDrawing({ strokes: [] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się rozpocząć rundy.');
    }
  };

  if (round.phase === 'finished') {
    return <Shell><section className="home finished-screen">
      <div className="logo">✓</div>
      <p className="tag">Koniec gry</p>
      <h1>Rozegrano wszystkie pytania</h1>
      <p>{settings.rounds} rund · {settings.questionsPerRound} pytań w rundzie · {round.roundId} pytań łącznie</p>
      <h2>Końcowa klasyfikacja</h2>
      <div className="scoreboard">
        {[...allPlayers].sort((a, b) => (scores[b.uid] ?? 0) - (scores[a.uid] ?? 0)).map((player, index) => <div key={player.uid}>
          <span><b>{index + 1}.</b> {player.name}</span>
          <strong>{scores[player.uid] ?? 0} pkt</strong>
        </div>)}
      </div>
      {isHost
        ? <button className="primary" onClick={() => void returnToLobby(code)}>Zagraj ponownie</button>
        : <p>Host może rozpocząć następną grę.</p>}
    </section></Shell>;
  }

  if (round.phase === 'results') {
    return <Results
      round={round}
      members={members}
      answers={answers}
      votes={votes}
      scores={scores}
      isHost={isHost}
      progressLabel={`Runda ${progress.roundNumber}/${settings.rounds} · Pytanie ${progress.questionNumber}/${settings.questionsPerRound}`}
      nextLabel={isGameComplete(round.roundId, settings)
        ? 'Zakończ grę'
        : progress.questionNumber === settings.questionsPerRound ? 'Następna runda' : 'Następne pytanie'}
      onNext={() => isGameComplete(round.roundId, settings)
        ? void finishGame(code, round.roundId)
        : void beginRound()}
    />;
  }

  if (round.phase === 'revealed') {
    return <Shell><section className="screen">
      <p className="tag">Runda {progress.roundNumber}/{settings.rounds} · odpowiedzi</p>
      <h1>{round.questionA}</h1>
      <AnswerGallery members={members} answers={answers} />
      {isHost
        ? <button className="primary" onClick={() => void startVoting(code, round.roundId, round.questionA ?? '')}>Rozpocznij głosowanie</button>
        : <p>Obejrzyj odpowiedzi. Host za chwilę rozpocznie głosowanie.</p>}
    </section></Shell>;
  }

  if (round.phase === 'voting') {
    const ownVote = votes[uid]?.roundId === round.roundId ? votes[uid] : undefined;
    return <Shell><section className="screen">
      <p className="tag">Runda {progress.roundNumber}/{settings.rounds} · głosowanie</p>
      <h1>Kto miał inne pytanie?</h1>
      <p>Porównaj rysunki i wskaż podejrzaną osobę.</p>
      <AnswerGallery members={members} answers={answers} />
      <div className="vote-options">
        {allPlayers.filter(player => player.uid !== uid).map(player => <button
          key={player.uid}
          disabled={Boolean(ownVote)}
          className={ownVote?.targetUid === player.uid ? 'selected' : ''}
          onClick={() => void submitVote(code, uid, {
            roundId: round.roundId,
            targetUid: player.uid,
            submittedAt: Date.now(),
          }).catch(() => setError('Nie udało się zapisać głosu. Sprawdź internet.'))}
        >{player.name}</button>)}
      </div>
      <ErrorMessage error={error} />
      {ownVote
        ? <p className="vote-wait">✓ Głos zapisany. Czekamy na pozostałych graczy.</p>
        : <p>Głosu nie można zmienić po zatwierdzeniu.</p>}
      {isHost && <div className="ready-list">{allPlayers.map(player => <span key={player.uid}>
        {votes[player.uid]?.roundId === round.roundId ? '✓' : '○'} {player.name}
      </span>)}</div>}
    </section></Shell>;
  }

  if (round.phase === 'answering') {
    return <Shell><section className="screen">
      <p className="tag">Runda {progress.roundNumber}/{settings.rounds} · Pytanie {progress.questionNumber}/{settings.questionsPerRound}</p>
      <QuestionTimer
        deadlineAt={round.deadlineAt}
        onExpire={isHost && currentPair ? () => void revealAnswers(code, round.roundId, currentPair.questionA) : undefined}
      />
      <h1>{assignment?.question ?? 'Pobieranie pytania…'}</h1>
      <DrawingCanvas drawing={drawing} onChange={nextDrawing => {
        setDrawing(nextDrawing);
        if (assignment) void submitAnswer(code, uid, {
          roundId: assignment.roundId,
          drawing: encodeDrawing(nextDrawing),
          submittedAt: Date.now(),
        }).catch(() => setError('Nie udało się zapisać odpowiedzi. Sprawdź internet.'));
      }} />
      <ErrorMessage error={error} />
      {isHost
        ? <><div className="ready-list">{Object.values(members).map(player => <span key={player.uid}>{answers[player.uid]?.roundId === round.roundId ? '✓' : '○'} {player.name}</span>)}</div>
          <button className="primary" disabled={!currentPair} onClick={() => currentPair && revealAnswers(code, round.roundId, currentPair.questionA)}>Pokaż odpowiedzi</button></>
        : <p>Odpowiedź zapisuje się automatycznie. Czekaj na hosta.</p>}
    </section></Shell>;
  }

  return <Shell><section className="screen">
    <p className="tag">Pokój online</p>
    <h1>{isHost ? 'Pokój hosta' : 'Poczekalnia'}</h1>
    <RoomCode code={code} />
    {isHost && <><h2>Kategorie</h2><CategoryPicker selected={meta.categories} onChange={categories => {
      if (!categories.length) return;
      void updateCategories(code, categories);
    }} />
      <h2>Ustawienia gry</h2>
      <GameSettingsPicker settings={settings} onChange={nextSettings => void updateGameSettings(code, nextSettings)} />
    </>}
    <h2>Gracze ({allPlayers.length}/{MIN_PLAYERS}+)</h2>
    <PlayerList members={members} hostUid={meta.hostUid} currentUid={uid} onRemove={isHost ? playerUid => void removePlayer(code, playerUid) : undefined} />
    <ErrorMessage error={error} />
    {isHost
      ? <><button className="primary" disabled={allPlayers.length < MIN_PLAYERS} onClick={beginRound}>Rozpocznij grę</button>
        <button className="danger" onClick={async () => { await closeRoom(code); onExit(); }}>Zamknij pokój</button></>
      : <p>Host rozpocznie grę, gdy wszyscy będą gotowi.</p>}
  </section></Shell>;
}

export default function App() {
  const roomFromUrl = normalizeRoomCode(new URLSearchParams(location.search).get('room') ?? '');
  const [mode, setMode] = useState<Mode>(roomFromUrl ? 'join' : 'home');
  const [session, setSession] = useState<{ code: string; uid: string } | null>(null);

  if (session) return <Room code={session.code} uid={session.uid} onExit={() => {
    history.replaceState({}, '', location.pathname);
    setSession(null);
    setMode('home');
  }} />;
  if (mode === 'host') return <HostSetup onReady={(code, uid) => {
    history.replaceState({}, '', `${location.pathname}?room=${code}`);
    setSession({ code, uid });
  }} />;
  if (mode === 'join') return <JoinSetup initialCode={roomFromUrl} onReady={(code, uid) => setSession({ code, uid })} />;
  return <Shell><section className="home">
    <div className="logo">≠</div>
    <p className="tag">Każdy na swoim telefonie</p>
    <h1>Kto dostał inne pytanie?</h1>
    <p>Utwórz pokój online, zaproś znajomych krótkim kodem i grajcie z dowolnej sieci.</p>
    <button className="primary" onClick={() => setMode('host')}>Utwórz grę</button>
    <button onClick={() => setMode('join')}>Dołącz</button>
  </section></Shell>;
}
