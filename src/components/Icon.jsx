import React from 'react';
import { glyphParts } from '../ui/icons';

/** One of the realm's engraved glyphs (ui/icons.js), drawn in currentColor. */
export default function Icon({ name, className = '' }) {
  return (
    <svg
      className={`ico${className ? ' ' + className : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphParts(name).map((p, i) => (
        p.mode === 'stroke'
          ? <path key={i} d={p.d} />
          : <path key={i} d={p.d} fill="currentColor" fillOpacity={p.mode === 'tint' ? 0.2 : 1} stroke="none" />
      ))}
    </svg>
  );
}
