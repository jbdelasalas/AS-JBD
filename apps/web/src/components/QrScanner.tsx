'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Dual-input scanner: phone camera and hardware wedge.
//
// Camera uses the browser's built-in BarcodeDetector (Chrome/Android, Safari
// 17+) so we ship no decoding library. Where it's unavailable the camera button
// is hidden and the keyboard-wedge field — which is what a USB/Bluetooth gun
// drives anyway — carries the whole flow.

// Minimal shape of the BarcodeDetector API, which TS doesn't ship types for.
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

export interface QrScannerProps {
  /** Called with the raw scanned text. Normalisation happens server-side. */
  onScan: (code: string) => void;
  /** Placeholder for the wedge/manual field. */
  placeholder?: string;
  /** Disables input while a scan is being processed. */
  busy?: boolean;
  autoFocus?: boolean;
}

export default function QrScanner({ onScan, placeholder = 'Scan or type a code…', busy, autoFocus }: QrScannerProps) {
  const [manual, setManual] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Guards against the same physical label firing many times while it sits in
  // frame — the detector reports it on every animation frame.
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => { setSupported(getDetectorCtor() !== null); }, []);

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (lastRef.current.code === code && now - lastRef.current.at < 2500) return;
    lastRef.current = { code, at: now };
    onScan(code);
  }, [onScan]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  // Tear down the camera when the component goes away, so the torch/LED and
  // the camera indicator don't stay on after navigating off the page.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    const Ctor = getDetectorCtor();
    if (!Ctor) { setCameraError('This browser cannot scan with the camera — use a scanner gun or type the code.'); return; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);

      // Wait for the <video> to mount before attaching the stream.
      await new Promise((r) => setTimeout(r, 0));
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play().catch(() => {});

      const detector = new Ctor({ formats: ['qr_code'] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          if (videoRef.current.readyState >= 2) {
            const hits = await detector.detect(videoRef.current);
            if (hits.length) emit(hits[0].rawValue);
          }
        } catch {
          /* transient decode errors are normal between frames */
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as Error).name;
      setCameraError(
        name === 'NotAllowedError' ? 'Camera permission denied — allow it in your browser settings.'
        : name === 'NotFoundError' ? 'No camera found on this device.'
        : 'Could not start the camera.',
      );
      stopCamera();
    }
  }, [emit, stopCamera]);

  return (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); emit(manual); setManual(''); inputRef.current?.focus(); }}
        className="flex gap-2"
      >
        {/* A scanner gun types the code then sends Enter, so this field handles
            hardware and manual entry with the same submit path. */}
        <input
          ref={inputRef}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={busy || !manual.trim()}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          Enter
        </button>
        {supported && (
          <button
            type="button"
            onClick={() => (cameraOn ? stopCamera() : startCamera())}
            className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {cameraOn ? 'Stop camera' : '📷 Camera'}
          </button>
        )}
      </form>

      {cameraError && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{cameraError}</div>
      )}

      {cameraOn && (
        <div className="relative mt-3 overflow-hidden rounded border border-slate-300 bg-black dark:border-slate-700">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} muted playsInline className="h-56 w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-32 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <p className="absolute bottom-1 left-0 right-0 text-center text-[11px] text-white/90">
            Point at a QR label
          </p>
        </div>
      )}

      {!supported && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Camera scanning isn&rsquo;t available in this browser. A USB or Bluetooth scanner gun works in the field above.
        </p>
      )}
    </div>
  );
}
