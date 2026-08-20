'use client';

import * as React from 'react';
import { ViewTransition } from 'react';

/**
 * Envuelve el contenido de cada página con una transición direccional
 * (slide forward/back según el tipo de navegación), siguiendo la skill
 * de Vercel React View Transitions.
 *
 * Los enlaces deben etiquetar la navegación con `transitionTypes={['nav-forward']}`
 * (o `['nav-back']` para volver) para activar los slides.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      exit={{ 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
