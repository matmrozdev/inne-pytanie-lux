import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { DrawingCanvas } from './DrawingCanvas';
import {
  chooseAlternateUid,
  chooseQuestion,
  decodeDrawing,
  encodeDrawing,
  MIN_PLAYERS,
  normalizeRoomCode,
  type Assignment,
  type Drawing,
  type Player,
  type PublicRound,
  type StoredAnswer,
} from './game';
import {
  closeRoom,
  createRoom,
  joinRoom,
  listenAnswers,
  listenAssignment,
  listenHostPrivate,
  listenMembers,
  listenMeta,
  listenPublicRound,
  removePlayer,
  revealAnswers,
  revealSecondQuestion,
  startRound,
  submitAnswer,
  updateCategories,
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

function HostSetup({ onReady }: { onReady: (code: string, uid: string) => void }) {
  const [name, setName] = useState(localStorage.getItem('lux-name') ?? 'Host');
  const [categories, setCategories] = useState<Category[]>(['Losowe']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <Shell><section className="screen">
    <p className="tag">Nowa gra przez internet</p>
    <h1>Utwórz pokój</h1>
    <label>Twoje imię<input value={name} maxLength={30} onChange={event => setName(event.target.value)} /></label>
    <h2>Kategorie</h2>
    <CategoryPicker selected={categories} onChange={setCategories} />
    <ErrorMessage error={error} />
    <button className="primary" disabled={loading || !name.trim() || !categories.length} onClick={async () => {
      setLoading(true);
      setError('');
      try {
        localStorage.setItem('lux-name', name.trim());
        const result = await createRoom(name, categories);
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

function Results({ round, members, answers, isHost, onSecond, onNext }: {
  round: PublicRound;
  members: Record<string, Player>;
  answers: Record<string, StoredAnswer>;
  isHost: boolean;
  onSecond: () => void;
  onNext: () => void;
}) {
  return <Shell><section className="screen">
    <p className="tag">Pytanie większości</p>
    <h1>{round.questionA}</h1>
    <div className="answers">
      {Object.values(members).map(player => <article key={player.uid}>
        <h3>{player.name}</h3>
        {answers[player.uid]?.drawing
          ? <DrawingCanvas drawing={decodeDrawing(answers[player.uid].drawing)} />
          : <p>Brak odpowiedzi</p>}
      </article>)}
    </div>
    {round.phase === 'second' && <div className="second">
      <b>Drugie pytanie</b>
      <p>{round.questionB}</p>
      <strong>Dostał je: {members[round.alternateUid ?? '']?.name ?? 'Nieznany gracz'}</strong>
    </div>}
    {isHost && <div className="actions">
      {round.phase === 'revealed' && <button onClick={onSecond}>Pokaż drugie pytanie</button>}
      <button className="primary" onClick={onNext}>Kolejna runda</button>
    </div>}
  </section></Shell>;
}

function Room({ code, uid, onExit }: { code: string; uid: string; onExit: () => void }) {
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [members, setMembers] = useState<Record<string, Player>>({});
  const [round, setRound] = useState<PublicRound>({ phase: 'lobby', roundId: 0 });
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [answers, setAnswers] = useState<Record<string, StoredAnswer>>({});
  const [hostPrivate, setHostPrivate] = useState<HostPrivateState | null>(null);
  const [drawing, setDrawing] = useState<Drawing>({ strokes: [] });
  const [error, setError] = useState('');
  const isHost = meta?.hostUid === uid;
  const canSeeAllAnswers = isHost || round.phase === 'revealed' || round.phase === 'second';

  useEffect(() => listenMeta(code, setMeta), [code]);
  useEffect(() => listenMembers(code, setMembers), [code]);
  useEffect(() => listenPublicRound(code, setRound), [code]);
  useEffect(() => listenAssignment(code, uid, setAssignment), [code, uid]);
  useEffect(() => listenAnswers(code, uid, canSeeAllAnswers, setAnswers), [code, uid, canSeeAllAnswers]);
  useEffect(() => isHost ? listenHostPrivate(code, setHostPrivate) : undefined, [code, isHost]);
  useEffect(() => {
    setDrawing(decodeDrawing(answers[uid]?.drawing));
  }, [answers, uid, round.roundId]);

  if (!meta) return <Shell><section className="screen"><h1>Łączenie z pokojem…</h1></section></Shell>;

  const connectedPlayers = Object.values(members).filter(player => player.connected);
  const currentPair = hostPrivate ? QUESTIONS.find(question => question.id === hostPrivate.pairId) : undefined;
  const beginRound = async () => {
    if (!isHost) return;
    if (connectedPlayers.length < MIN_PLAYERS) {
      setError(`Potrzeba minimum ${MIN_PLAYERS} graczy online.`);
      return;
    }
    try {
      setError('');
      const selection = chooseQuestion(QUESTIONS, meta.categories, hostPrivate?.usedIds ?? []);
      const alternateUid = chooseAlternateUid(connectedPlayers.map(player => player.uid), hostPrivate?.alternateUid);
      await startRound(code, round.roundId + 1, selection.question, alternateUid, connectedPlayers.map(player => player.uid), selection.usedIds);
      setDrawing({ strokes: [] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się rozpocząć rundy.');
    }
  };

  if (round.phase === 'revealed' || round.phase === 'second') {
    return <Results
      round={round}
      members={members}
      answers={answers}
      isHost={isHost}
      onSecond={async () => {
        if (currentPair && hostPrivate) await revealSecondQuestion(code, round.roundId, currentPair, hostPrivate.alternateUid);
      }}
      onNext={beginRound}
    />;
  }

  if (round.phase === 'answering') {
    return <Shell><section className="screen">
      <p className="tag">Runda {round.roundId}</p>
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
    }} /></>}
    <h2>Gracze ({connectedPlayers.length}/{MIN_PLAYERS}+)</h2>
    <PlayerList members={members} hostUid={meta.hostUid} currentUid={uid} onRemove={isHost ? playerUid => void removePlayer(code, playerUid) : undefined} />
    <ErrorMessage error={error} />
    {isHost
      ? <><button className="primary" disabled={connectedPlayers.length < MIN_PLAYERS} onClick={beginRound}>Rozpocznij grę</button>
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
