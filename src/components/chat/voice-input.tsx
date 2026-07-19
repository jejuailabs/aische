'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale } from '@/hooks/use-locale';
import { usePrefStore } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
}

/* ------------------------------------------------------------------ */
/*  SpeechRecognition type declaration                                 */
/* ------------------------------------------------------------------ */

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CANVAS_SIZE = 120; // px – visualizer canvas diameter
const BUTTON_SIZE = 40; // px – mic button diameter
const BASE_RADIUS = 28; // px – base radius of the waveform ring
const MAX_AMPLITUDE = 18; // px – max outward extension of waveform
const FFT_SIZE = 256;
const SMOOTHING = 0.8;

/* ------------------------------------------------------------------ */
/*  Pulse ring keyframes (CSS)                                         */
/* ------------------------------------------------------------------ */

const pulseRingVariants = {
  initial: { scale: 1, opacity: 0.6 },
  animate: {
    scale: [1, 1.45, 1],
    opacity: [0.6, 0, 0.6],
    transition: {
      duration: 1.8,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  exit: { opacity: 0, scale: 1.2 },
};

const pulseRingVariants2 = {
  initial: { scale: 1, opacity: 0.4 },
  animate: {
    scale: [1, 1.7, 1],
    opacity: [0.4, 0, 0.4],
    transition: {
      duration: 1.8,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: 0.6,
    },
  },
  exit: { opacity: 0, scale: 1.3 },
};

/* ------------------------------------------------------------------ */
/*  VoiceButton Component                                              */
/* ------------------------------------------------------------------ */

export function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const { t } = useLocale();
  const language = usePrefStore((s) => s.language);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const prevDataRef = useRef<Uint8Array | null>(null);
  const drawWaveformRef = useRef<() => void>(() => {});

  /* ---------------------------------------------------------------- */
  /*  Draw circular waveform on canvas                                 */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const drawWaveform = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const displaySize = CANVAS_SIZE;
      canvas.width = displaySize * dpr;
      canvas.height = displaySize * dpr;
      canvas.style.width = `${displaySize}px`;
      canvas.style.height = `${displaySize}px`;
      ctx.scale(dpr, dpr);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      // Smooth with previous frame
      if (prevDataRef.current) {
        for (let i = 0; i < bufferLength; i++) {
          dataArray[i] = Math.round(
            prevDataRef.current[i] * SMOOTHING +
              dataArray[i] * (1 - SMOOTHING)
          );
        }
      }
      prevDataRef.current = new Uint8Array(dataArray);

      const cx = displaySize / 2;
      const cy = displaySize / 2;

      ctx.clearRect(0, 0, displaySize, displaySize);

      // Use a subset of frequency bins for the circular waveform
      const barCount = Math.min(bufferLength, 64);
      const angleStep = (Math.PI * 2) / barCount;

      ctx.beginPath();
      for (let i = 0; i <= barCount; i++) {
        const idx = i % barCount;
        const value = dataArray[idx] / 255; // 0-1
        const radius = BASE_RADIUS + value * MAX_AMPLITUDE;
        const angle = idx * angleStep - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Gradient fill – teal/emerald
      const gradient = ctx.createRadialGradient(cx, cy, BUTTON_SIZE / 2, cx, cy, BASE_RADIUS + MAX_AMPLITUDE + 4);
      gradient.addColorStop(0, 'rgba(20, 184, 166, 0.25)');
      gradient.addColorStop(1, 'rgba(16, 185, 129, 0.08)');
      ctx.fillStyle = gradient;
      ctx.fill();

      // Stroke
      ctx.strokeStyle = 'rgba(20, 184, 166, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animationRef.current = requestAnimationFrame(drawWaveform);
    };

    drawWaveformRef.current = drawWaveform;
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Stop all resources cleanly                                       */
  /* ---------------------------------------------------------------- */

  const stopResources = useCallback(() => {
    // Stop animation frame
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // already stopped
      }
      recognitionRef.current = null;
    }

    // Close audio stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    prevDataRef.current = null;
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Start recording                                                  */
  /* ---------------------------------------------------------------- */

  const startRecording = useCallback(async () => {
    // Check browser support
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setIsSupported(false);
      toast.error(t.voice.notSupported);
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2. Set up AudioContext + AnalyserNode
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 3. Set up SpeechRecognition
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = language === 'ko' ? 'ko-KR' : 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;

      let finalTranscript = '';

      recognition.onstart = () => {
        setIsRecording(true);
        setIsProcessing(false);
        // Start visualization
        drawWaveformRef.current();
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        // Could update a live preview here in the future
      };

      recognition.onend = () => {
        stopResources();
        setIsRecording(false);
        if (finalTranscript.trim()) {
          onTranscript(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        stopResources();
        setIsRecording(false);
        setIsProcessing(false);
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
          toast.error(t.voice.error);
        }
      };

      // 4. Start recognition
      recognition.start();
    } catch (err) {
      stopResources();
      setIsProcessing(false);
      setIsRecording(false);
      toast.error(t.voice.error);
    }
  }, [language, t, onTranscript, stopResources]);

  /* ---------------------------------------------------------------- */
  /*  Stop recording (user-initiated)                                  */
  /* ---------------------------------------------------------------- */

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Toggle handler                                                   */
  /* ---------------------------------------------------------------- */

  const handleClick = useCallback(() => {
    if (isProcessing) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, isProcessing, startRecording, stopRecording]);

  /* ---------------------------------------------------------------- */
  /*  Cleanup on unmount                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    return () => {
      stopResources();
    };
  }, [stopResources]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (!isSupported) {
    // Fallback: disabled mic button
    return (
      <button
        type="button"
        className="relative flex items-center justify-center size-8 rounded-full text-muted-foreground opacity-40 cursor-not-allowed"
        aria-label={t.voice.notSupported}
        disabled
      >
        <MicOff className="size-4" />
      </button>
    );
  }

  const ariaLabel = isRecording ? t.voice.tapToStop : t.voice.startRecording;

  return (
    <div className="relative flex items-center justify-center" style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}>
      {/* Canvas visualizer – behind the button */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />

      {/* Pulse rings (framer-motion) */}
      <AnimatePresence>
        {isRecording && (
          <>
            <motion.div
              key="pulse-1"
              className="absolute rounded-full bg-teal-500/20 pointer-events-none"
              style={{ width: BUTTON_SIZE + 8, height: BUTTON_SIZE + 8 }}
              variants={pulseRingVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            />
            <motion.div
              key="pulse-2"
              className="absolute rounded-full bg-emerald-500/15 pointer-events-none"
              style={{ width: BUTTON_SIZE + 8, height: BUTTON_SIZE + 8 }}
              variants={pulseRingVariants2}
              initial="initial"
              animate="animate"
              exit="exit"
            />
          </>
        )}
      </AnimatePresence>

      {/* Mic button */}
      <motion.button
        type="button"
        id="voice-btn"
        className={`
          relative z-10 flex items-center justify-center rounded-full
          transition-colors duration-200 focus:outline-none focus-visible:ring-2
          focus-visible:ring-teal-400 focus-visible:ring-offset-2
          ${
            isRecording
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-teal-500 text-white hover:bg-teal-600'
          }
          ${isProcessing ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
        `}
        style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
        onClick={handleClick}
        disabled={isProcessing}
        aria-label={ariaLabel}
        title={ariaLabel}
        whileTap={isRecording ? { scale: 0.9 } : { scale: 0.92 }}
        whileHover={!isProcessing ? { scale: 1.08 } : {}}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        {isProcessing ? (
          <motion.div
            className="size-4 border-2 border-white/60 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          />
        ) : isRecording ? (
          <MicOff className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </motion.button>
    </div>
  );
}