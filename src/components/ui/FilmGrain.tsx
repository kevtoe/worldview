import { useEffect, useRef } from 'react';

/**
 * Full-screen animated film grain overlay rendered via <canvas>.
 * Generates random luminance noise at ~12 fps for a subtle analogue feel.
 * Purely cosmetic — pointer-events: none so it never blocks interaction.
 */
export default function FilmGrain({ opacity = 0.06 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Higher resolution = finer grain when scaled to fullscreen
    const GRAIN_W = 1024;
    const GRAIN_H = 1024;
    canvas.width = GRAIN_W;
    canvas.height = GRAIN_H;

    const imageData = ctx.createImageData(GRAIN_W, GRAIN_H);
    const pixels = imageData.data;

    let animId: number;

    const draw = () => {
      // Fill pixel buffer with random grey values
      for (let i = 0; i < pixels.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        pixels[i] = v;       // R
        pixels[i + 1] = v;   // G
        pixels[i + 2] = v;   // B
        pixels[i + 3] = 255; // A
      }
      ctx.putImageData(imageData, 0, 0);
      animId = requestAnimationFrame(draw);
    };

    // Throttle to ~12 fps to keep it cinematic & save CPU
    let lastTime = 0;
    const FPS = 12;
    const interval = 1000 / FPS;

    const throttledDraw = (time: number) => {
      animId = requestAnimationFrame(throttledDraw);
      const delta = time - lastTime;
      if (delta < interval) return;
      lastTime = time - (delta % interval);

      for (let i = 0; i < pixels.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        pixels[i] = v;
        pixels[i + 1] = v;
        pixels[i + 2] = v;
        pixels[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    };

    animId = requestAnimationFrame(throttledDraw);

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        opacity,
        pointerEvents: 'none',
        zIndex: 9999,
        mixBlendMode: 'screen',
      }}
    />
  );
}
