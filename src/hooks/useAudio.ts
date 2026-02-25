import { useState, useEffect, useCallback, useMemo } from 'react';
import { tacticalAudio, type SoundEffect } from '../lib/audio';

/**
 * React hook exposing the tactical audio engine.
 *
 * Returns stable references so it's safe to pass into memoised children.
 */
export function useAudio() {
  const [muted, setMuted] = useState(tacticalAudio.muted);

  // Keep React state in sync with the singleton on mount
  useEffect(() => {
    setMuted(tacticalAudio.muted);
  }, []);

  const toggleMute = useCallback(() => {
    const nowMuted = tacticalAudio.toggleMute();
    setMuted(nowMuted);

    // If un-muting, ensure the AudioContext is warm (user-gesture requirement)
    if (!nowMuted) {
      tacticalAudio.play('click');
    }
  }, []);

  const play = useCallback((effect: SoundEffect) => {
    tacticalAudio.play(effect);
  }, []);

  const startAmbient = useCallback(() => {
    tacticalAudio.startAmbient();
  }, []);

  const stopAmbient = useCallback(() => {
    tacticalAudio.stopAmbient();
  }, []);

  // Clean-up on unmount
  useEffect(() => {
    return () => {
      tacticalAudio.stopAmbient();
    };
  }, []);

  return useMemo(
    () => ({ muted, toggleMute, play, startAmbient, stopAmbient }),
    [muted, toggleMute, play, startAmbient, stopAmbient],
  );
}

export type AudioControls = ReturnType<typeof useAudio>;
