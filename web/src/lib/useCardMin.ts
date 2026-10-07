import { useState } from 'react';

// Etat "minimise" d'une carte de dashboard (repli sur une seule ligne) :
// la preference est memorisee dans localStorage et survit au rechargement.
// Chaque carte utilise sa propre cle pour etre repliee independamment.
export function useCardMin(key: string) {
  const [min, setMin] = useState(() => {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  });

  const toggleMin = () => {
    const n = !min;
    setMin(n);
    try { localStorage.setItem(key, n ? '1' : '0'); } catch { /* ignore */ }
  };

  return { min, toggleMin };
}
