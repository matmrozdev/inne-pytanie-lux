import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Drawing, Point, Stroke } from './game';

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

function renderDrawing(canvas: HTMLCanvasElement, drawing: Drawing): void {
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
}

export function DrawingCanvas({ drawing, onChange }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStroke = useRef<Stroke | null>(null);
  const [history, setHistory] = useState<Drawing[]>([]);
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [eraser, setEraser] = useState(false);

  useEffect(() => {
    if (canvasRef.current) renderDrawing(canvasRef.current, drawing);
  }, [drawing]);

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
        event.currentTarget.setPointerCapture(event.pointerId);
        activeStroke.current = {
          points: [pointFromEvent(event)],
          color: eraser ? ERASER_COLOR : color,
          width: eraser ? ERASER_WIDTH : PEN_WIDTH,
        };
      }}
      onPointerMove={event => {
        if (!activeStroke.current || !canvasRef.current) return;
        activeStroke.current.points.push(pointFromEvent(event));
        renderDrawing(canvasRef.current, { strokes: [...drawing.strokes, activeStroke.current] });
      }}
      onPointerUp={() => {
        if (!activeStroke.current) return;
        const nextDrawing = { strokes: [...drawing.strokes, activeStroke.current] };
        activeStroke.current = null;
        setHistory(previous => [...previous, drawing]);
        publish(nextDrawing);
      }}
      onPointerCancel={() => { activeStroke.current = null; }}
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
          publish({ strokes: [] });
        }}>Wyczyść wszystko</button>
      </div>
    </>}
  </div>;
}
