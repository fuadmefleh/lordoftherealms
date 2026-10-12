import React, { useEffect, useRef, useState } from 'react';
import { startTitleBackdrop } from '../ui/titleBackdrop';

/**
 * The living realm behind the title, setup and loading screens. Rendered once
 * by App across those phases, so the flight over the land never cuts.
 */
export default function TitleBackdrop({ phase = 'title' }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = startTitleBackdrop(canvasRef.current, { onReady: () => setReady(true) });
    return stop;
  }, []);

  return (
    <canvas
      id="titleBackdrop"
      ref={canvasRef}
      className={ready ? 'ready' : ''}
      data-phase={phase}
      aria-hidden="true"
    />
  );
}
