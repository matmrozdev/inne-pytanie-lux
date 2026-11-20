import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export function QrScanner({ onScan }: { onScan: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const scanHandler = useRef(onScan);

  useEffect(() => { scanHandler.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!navigator.mediaDevices?.getUserMedia || !context) {
      setError('Ta przeglądarka nie udostępnia aparatu. Wpisz kod ręcznie.');
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
      .then(async cameraStream => {
        stream = cameraStream;
        if (!video.current) return;
        video.current.srcObject = cameraStream;
        await video.current.play();
        const scan = () => {
          const source = video.current;
          if (stopped || !source) return;
          if (source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const scale = Math.min(1, 960 / source.videoWidth);
            canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
            context.drawImage(source, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            if (result?.data) {
              scanHandler.current(result.data);
              setOpen(false);
              return;
            }
          }
          timer = requestAnimationFrame(scan);
        };
        scan();
      })
      .catch(() => setError('Nie udało się uruchomić aparatu. Sprawdź uprawnienia albo wpisz kod ręcznie.'));

    return () => {
      stopped = true;
      cancelAnimationFrame(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [open]);

  return <div className="scanner">
    {open
      ? <><div className="camera"><video ref={video} playsInline muted autoPlay /><span>Umieść kod QR w ramce</span></div><button onClick={() => setOpen(false)}>Anuluj skanowanie</button></>
      : <button onClick={() => { setError(''); setOpen(true); }}>Skanuj kod QR</button>}
    {error && <small>{error}</small>}
  </div>;
}
