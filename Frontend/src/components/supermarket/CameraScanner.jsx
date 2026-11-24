// components/supermarket/CameraScanner.jsx
//
// Escáner de QR con la cámara del celular / tableta / PC, en pantalla completa.
// Escanea de corrido: apunte al ticket, suena, muestra el resultado y queda
// listo para el siguiente sin tocar nada.
//
//   - Usa el lector nativo del navegador (BarcodeDetector, Chrome en Android)
//     cuando existe; si no, jsQR (npm install jsqr), que funciona en todos,
//     incluido iPhone.
//   - El mismo QR se manda UNA vez aunque siga frente a la cámara; se vuelve
//     a mandar sólo si sale de cuadro 2.5 s y regresa (y el servidor lo
//     marcaría como "ya recibido" de todos modos).
//   - La cámara sólo abre en https (o localhost): es regla del navegador.
//
// Props:
//   onCode(text)  se llama con el texto del QR (el padre lo registra)
//   last          última respuesta del registro { result, message, panel, stock }
//   busy          true mientras el padre registra el escaneo
//   onClose()

import { useEffect, useRef, useState } from "react";
import { X, Flashlight, FlashlightOff, Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const SCAN_EVERY_MS = 150;     // ~6-7 lecturas por segundo: rápido sin calentar el teléfono
const SAME_CODE_PAUSE_MS = 2500;

const TONE = {
  ok: { frame: "border-emerald-400", card: "bg-emerald-600", Icon: CheckCircle2 },
  duplicate: { frame: "border-amber-400", card: "bg-amber-500", Icon: AlertTriangle },
  error: { frame: "border-red-500", card: "bg-red-600", Icon: XCircle },
};

export default function CameraScanner({ onCode, last, busy = false, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastSeen = useRef({ text: "", at: 0 });
  const onCodeRef = useRef(onCode);
  const busyRef = useRef(busy);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(null); // null = la cámara no tiene linterna
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  // Cada resultado nuevo hace "parpadear" el marco con su color.
  useEffect(() => { if (last) setFlashKey((k) => k + 1); }, [last]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let detector = null;
    let jsQR = null;

    const start = async () => {
      if (!window.isSecureContext) {
        setError("La cámara sólo funciona si la app se abre con https://. Pida que se abra con la dirección segura.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite usar la cámara. Use Chrome o Safari actualizados.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        if (track?.getCapabilities?.().torch) setTorch(false);

        // Lector nativo si existe y sabe leer QR; si no, jsQR.
        if ("BarcodeDetector" in window) {
          try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (formats.includes("qr_code")) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          } catch { /* sin lector nativo */ }
        }
        if (!detector) jsQR = (await import("jsqr")).default;
        setReady(true);
        loop();
      } catch (e) {
        setError(
          e?.name === "NotAllowedError" ? "No se dio permiso para usar la cámara. Permítalo en el candado de la barra de direcciones y vuelva a abrir."
          : e?.name === "NotFoundError" ? "No se encontró ninguna cámara en este equipo."
          : e?.name === "NotReadableError" ? "La cámara está ocupada por otra app. Ciérrela y vuelva a intentar."
          : `No se pudo abrir la cámara: ${e?.message || e}`
        );
      }
    };

    const read = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;
      if (detector) {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue || null;
      }
      // jsQR: cuadro reducido a ≤ 640 px de ancho, suficiente para un ticket.
      const scale = Math.min(1, 640 / (video.videoWidth || 640));
      const w = Math.round((video.videoWidth || 640) * scale);
      const h = Math.round((video.videoHeight || 480) * scale);
      const canvas = canvasRef.current;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const hit = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      return hit?.data || null;
    };

    const loop = async () => {
      if (stopped) return;
      try {
        const text = busyRef.current ? null : await read();
        if (text) {
          const now = Date.now();
          const same = text === lastSeen.current.text && now - lastSeen.current.at < SAME_CODE_PAUSE_MS;
          lastSeen.current = { text, at: now };
          if (!same) onCodeRef.current?.(text);
        }
      } catch { /* cuadro ilegible: seguir */ }
      timer = setTimeout(loop, SCAN_EVERY_MS);
    };

    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Cerrar con Esc / botón atrás del teclado.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { /* sin linterna */ }
  };

  const tone = last ? TONE[last.result] || TONE.error : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col" role="dialog" aria-label="Escanear ticket con la cámara">
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Barra superior */}
      <div className="relative z-10 flex items-center gap-2 p-3 bg-gradient-to-b from-black/70 to-transparent text-white">
        <span className="text-base font-semibold">Escanear tickets</span>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {torch !== null && (
          <button onClick={toggleTorch} aria-label="Linterna" className="ml-auto h-11 w-11 rounded-full bg-white/15 flex items-center justify-center">
            {torch ? <FlashlightOff className="w-5 h-5" /> : <Flashlight className="w-5 h-5" />}
          </button>
        )}
        <button onClick={onClose} aria-label="Cerrar cámara" className={`${torch === null ? "ml-auto" : ""} h-11 w-11 rounded-full bg-white/15 flex items-center justify-center`}>
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Marco guía: parpadea con el color del último resultado */}
      <div className="relative z-10 flex-1 flex items-center justify-center pointer-events-none">
        {!error && (
          <div
            key={flashKey}
            className={`w-64 h-64 sm:w-72 sm:h-72 rounded-3xl border-4 ${tone ? tone.frame : "border-white/80"} shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-colors`}
            style={tone ? { animation: "camFlash .6s ease-out" } : undefined}
          />
        )}
        {!ready && !error && <p className="absolute text-white/80 text-sm">Abriendo cámara…</p>}
        {error && (
          <div className="mx-6 max-w-sm rounded-2xl bg-white p-5 text-center pointer-events-auto">
            <XCircle className="w-8 h-8 text-red-600 mx-auto" />
            <p className="mt-2 text-sm text-gray-800">{error}</p>
            <button onClick={onClose} className="mt-4 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white">Cerrar</button>
          </div>
        )}
      </div>

      {/* Resultado del último ticket */}
      <div className="relative z-10 p-3 pb-6 bg-gradient-to-t from-black/80 to-transparent">
        {last && tone ? (
          <div className={`rounded-2xl ${tone.card} text-white px-4 py-3 flex items-start gap-3 shadow-lg`}>
            <tone.Icon className="w-7 h-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-tight">{last.message}</p>
              {last.panel && (
                <p className="mt-1 text-sm text-white/90">
                  {last.panel.cutNo} · {last.panel.marker} · Talla {last.panel.talla} · Panel {last.panel.panelNo} de {last.panel.panelCount}
                </p>
              )}
            </div>
            {last.stock && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums leading-none">
                  {last.stock.totals.receivedPanels}<span className="text-base text-white/70">/{last.stock.totals.expectedPanels}</span>
                </div>
                <div className="text-[11px] text-white/80 mt-1">paneles</div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-white/90 text-sm">Apunte la cámara al QR del ticket del panel</p>
        )}
      </div>

      <style>{`@keyframes camFlash { 0% { transform: scale(1.06); } 100% { transform: scale(1); } }`}</style>
    </div>
  );
}