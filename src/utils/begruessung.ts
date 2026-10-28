/**
 * Stand der Begruessung (Brutzel-Video beim App-Start, DashboardScreen) - damit Brutzels Fenster
 * (MarketingHost) erst nach der Begruessung kommen und nicht darueber liegen.
 * 'offen' = Startseite hat noch nicht entschieden, 'aktiv' = Begruessung laeuft, 'fertig' = vorbei/keine.
 */
type Stand = 'offen' | 'aktiv' | 'fertig';
let stand: Stand = 'offen';
const hoerer = new Set<() => void>();

export function begruessungStand(): Stand { return stand; }

export function begruessungSetzen(neu: Stand): void {
  if (stand === neu) return;
  stand = neu;
  hoerer.forEach((h) => { try { h(); } catch { /* egal */ } });
}

export function aufBegruessungHoeren(h: () => void): () => void {
  hoerer.add(h);
  return () => { hoerer.delete(h); };
}
