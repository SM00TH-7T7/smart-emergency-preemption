import { useCallback, useRef } from 'react';

// Short emergency alert tone — generated via Web Audio API (no external files needed)
function createAlertOscillator(audioCtx, type = 'siren') {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'siren') {
    // Classic two-tone siren sweep
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(600, now);
    oscillator.frequency.linearRampToValueAtTime(900, now + 0.3);
    oscillator.frequency.linearRampToValueAtTime(600, now + 0.6);
    oscillator.frequency.linearRampToValueAtTime(900, now + 0.9);
    oscillator.frequency.linearRampToValueAtTime(600, now + 1.2);
    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.linearRampToValueAtTime(0, now + 1.3);
    oscillator.start(now);
    oscillator.stop(now + 1.3);
  } else if (type === 'alert') {
    // Sharp double-beep for police alerts
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(880, now);
    gainNode.gain.setValueAtTime(0.12, now);
    gainNode.gain.setValueAtTime(0, now + 0.15);
    gainNode.gain.setValueAtTime(0.12, now + 0.25);
    gainNode.gain.setValueAtTime(0, now + 0.4);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  } else if (type === 'success') {
    // Rising tone for positive events
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.linearRampToValueAtTime(660, now + 0.2);
    oscillator.frequency.linearRampToValueAtTime(880, now + 0.4);
    gainNode.gain.setValueAtTime(0.1, now);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
    oscillator.start(now);
    oscillator.stop(now + 0.5);
  }

  return oscillator;
}

/**
 * Custom hook for playing alert sounds via Web Audio API.
 * No external audio files needed — all sounds are synthesized.
 *
 * Usage:
 *   const { playAlert } = useAlertSound();
 *   playAlert('siren');   // ambulance siren sweep
 *   playAlert('alert');   // police double-beep
 *   playAlert('success'); // positive confirmation tone
 */
export default function useAlertSound() {
  const audioCtxRef = useRef(null);
  const lastPlayRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  const playAlert = useCallback(
    (type = 'siren') => {
      // Throttle: don't play more than once per 800ms
      const now = Date.now();
      if (now - lastPlayRef.current < 800) return;
      lastPlayRef.current = now;

      try {
        const ctx = getAudioContext();
        createAlertOscillator(ctx, type);
      } catch {
        // Silently fail if Web Audio API is not available
      }
    },
    [getAudioContext],
  );

  return { playAlert };
}
