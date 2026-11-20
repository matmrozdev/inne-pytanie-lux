import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Drawing, EmojiSticker, Point, Stroke } from './game';

interface DrawingCanvasProps {
  drawing: Drawing;
  onChange?: (drawing: Drawing) => void;
}

const WIDTH = 900;
const HEIGHT = 650;
const PEN_WIDTH = 10;
const ERASER_WIDTH = 38;
const ERASER_COLOR = '#ffffff';
const COLORS = [
  { value: '#17162d', label: 'Czarny' },
  { value: '#e11d48', label: 'Czerwony' },
  { value: '#2563eb', label: 'Niebieski' },
  { value: '#16a34a', label: 'Zielony' },
  { value: '#9333ea', label: 'Fioletowy' },
  { value: '#ea580c', label: 'Pomarańczowy' },
] as const;
const EMOJIS = [
  '😀', '😂', '🤣', '😍', '😎', '🤔', '😱', '😭', '😡', '🤡',
  '💀', '👻', '👽', '🤖', '🗿', '🐸', '🐵', '🐶', '🐱', '🦄',
  '🔥', '❤️', '💩', '👍', '👎', '👀', '🎉', '🍕', '⚽', '🚀',
] as const;

function createStickerId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(36)).join('-');
}

function renderDrawing(canvas: HTMLCanvasElement, drawing: Drawing, selectedStickerId?: string | null): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of drawing.strokes) {
    if (!stroke.points.length) continue;
    context.strokeStyle = stroke.color ?? '#17162d';
    context.lineWidth = stroke.width ?? PEN_WIDTH;
    context.beginPath();
    context.moveTo(stroke.points[0].x * WIDTH, stroke.points[0].y * HEIGHT);
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x * WIDTH, point.y * HEIGHT);
    }
    context.stroke();
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const sticker of drawing.stickers ?? []) {
    const size = sticker.size * HEIGHT;
    context.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    context.fillText(sticker.emoji, sticker.x * WIDTH, sticker.y * HEIGHT);
    if (sticker.id === selectedStickerId) {
      context.strokeStyle = '#f472b6';
      context.lineWidth = 4;
      context.setLineDash([10, 8]);
      context.strokeRect(sticker.x * WIDTH - size * 0.55, sticker.y * HEIGHT - size * 0.55, size * 1.1, size * 1.1);
      context.setLineDash([]);
    }
  }
}

export function DrawingCanvas({ drawing, onChange }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const activeSticker = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const draggedDrawing = useRef<Drawing | null>(null);
  const [history, setHistory] = useState<Drawing[]>([]);
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [eraser, setEraser] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);

  useEffect(() => {
    if (canvasRef.current) renderDrawing(canvasRef.current, drawing, onChange ? selectedStickerId : null);
  }, [drawing, onChange, selectedStickerId]);
  useEffect(() => {
    if (selectedStickerId && !(drawing.stickers ?? []).some(sticker => sticker.id === selectedStickerId)) {
      setSelectedStickerId(null);
    }
  }, [drawing.stickers, selectedStickerId]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const publish = (nextDrawing: Drawing) => {
    onChange?.(nextDrawing);
  };

  return <div className="board">
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      onPointerDown={event => {
        if (!onChange) return;
        const point = pointFromEvent(event);
        const sticker = [...(drawing.stickers ?? [])].reverse().find(item => {
          const radius = item.size * HEIGHT * 0.65;
          return Math.abs((point.x - item.x) * WIDTH) <= radius
            && Math.abs((point.y - item.y) * HEIGHT) <= radius;
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        if (sticker) {
          activeSticker.current = { id: sticker.id, offsetX: point.x - sticker.x, offsetY: point.y - sticker.y };
          setSelectedStickerId(sticker.id);
          return;
        }
        setSelectedStickerId(null);
        activeStroke.current = {
          points: [point],
          color: eraser ? ERASER_COLOR : color,
          width: eraser ? ERASER_WIDTH : PEN_WIDTH,
        };
      }}
      onPointerMove={event => {
        if (!canvasRef.current) return;
        if (activeSticker.current) {
          const point = pointFromEvent(event);
          const nextDrawing = {
            ...drawing,
            stickers: (drawing.stickers ?? []).map(sticker => sticker.id === activeSticker.current?.id
              ? {
                ...sticker,
                x: Math.max(0.05, Math.min(0.95, point.x - activeSticker.current.offsetX)),
                y: Math.max(0.07, Math.min(0.93, point.y - activeSticker.current.offsetY)),
              }
              : sticker),
          };
          draggedDrawing.current = nextDrawing;
          renderDrawing(canvasRef.current, nextDrawing, activeSticker.current.id);
          return;
        }
        if (!activeStroke.current) return;
        activeStroke.current.points.push(pointFromEvent(event));
        renderDrawing(canvasRef.current, { ...drawing, strokes: [...drawing.strokes, activeStroke.current] });
      }}
      onPointerUp={() => {
        if (activeSticker.current) {
          const nextDrawing = draggedDrawing.current;
          activeSticker.current = null;
          draggedDrawing.current = null;
          if (nextDrawing) {
            setHistory(previous => [...previous, drawing]);
            publish(nextDrawing);
          }
          return;
        }
        if (!activeStroke.current) return;
        const nextDrawing = { ...drawing, strokes: [...drawing.strokes, activeStroke.current] };
        activeStroke.current = null;
        setHistory(previous => [...previous, drawing]);
        publish(nextDrawing);
      }}
      onPointerCancel={() => {
        activeStroke.current = null;
        activeSticker.current = null;
        draggedDrawing.current = null;
        if (canvasRef.current) renderDrawing(canvasRef.current, drawing, selectedStickerId);
      }}
    />
    {onChange && <>
      <div className="drawing-tools">
        <div className="color-palette" aria-label="Kolor pisaka">
          {COLORS.map(option => <button
            key={option.value}
            type="button"
            className={!eraser && color === option.value ? 'active' : ''}
            style={{ backgroundColor: option.value }}
            aria-label={option.label}
            title={option.label}
            onClick={() => { setColor(option.value); setEraser(false); }}
          />)}
        </div>
        <button type="button" className={eraser ? 'active eraser' : 'eraser'} onClick={() => setEraser(value => !value)}>⌫ Gumka</button>
      </div>
      <div className="drawing-actions">
        <button onClick={() => {
          const previous = history.at(-1) ?? { strokes: [] };
          setHistory(items => items.slice(0, -1));
          publish(previous);
        }}>↶ Cofnij</button>
        <button onClick={() => {
          setHistory(previous => [...previous, drawing]);
          setSelectedStickerId(null);
          publish({ strokes: [], stickers: [] });
        }}>Wyczyść wszystko</button>
      </div>
      <button type="button" className="emoji-toggle" onClick={() => setEmojiOpen(value => !value)}>
        {emojiOpen ? 'Ukryj emotki' : '😀 Dodaj emotkę'}
      </button>
      {emojiOpen && <div className="emoji-picker" aria-label="Emotki do wklejenia">
        {EMOJIS.map(emoji => <button type="button" key={emoji} aria-label={`Dodaj ${emoji}`} onClick={() => {
          const stickers = drawing.stickers ?? [];
          const offset = (stickers.length % 5) * 0.035;
          const sticker: EmojiSticker = {
            id: createStickerId(),
            emoji,
            x: 0.43 + offset,
            y: 0.43 + offset,
            size: 0.16,
          };
          setHistory(previous => [...previous, drawing]);
          setSelectedStickerId(sticker.id);
          publish({ ...drawing, stickers: [...stickers, sticker] });
        }}>{emoji}</button>)}
      </div>}
      {selectedStickerId && <div className="sticker-actions">
        <button type="button" onClick={() => {
          const stickers = (drawing.stickers ?? []).map(sticker => sticker.id === selectedStickerId
            ? { ...sticker, size: Math.max(0.08, sticker.size - 0.03) }
            : sticker);
          setHistory(previous => [...previous, drawing]);
          publish({ ...drawing, stickers });
        }}>− Mniejsza</button>
        <button type="button" onClick={() => {
          const stickers = (drawing.stickers ?? []).map(sticker => sticker.id === selectedStickerId
            ? { ...sticker, size: Math.min(0.32, sticker.size + 0.03) }
            : sticker);
          setHistory(previous => [...previous, drawing]);
          publish({ ...drawing, stickers });
        }}>+ Większa</button>
        <button type="button" className="danger" onClick={() => {
          setHistory(previous => [...previous, drawing]);
          publish({ ...drawing, stickers: (drawing.stickers ?? []).filter(sticker => sticker.id !== selectedStickerId) });
          setSelectedStickerId(null);
        }}>Usuń</button>
      </div>}
    </>}
  </div>;
}
