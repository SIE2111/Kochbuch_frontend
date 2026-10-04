/**
 * Alle Kategorien, die die KI vergeben kann - dieselben Namen wie in
 * Kochbuch_backend routers/ai_generation.py und web_import.py.
 * Werden überall zur Auswahl angeboten, auch wenn noch kein Rezept sie
 * trägt (04.10.2026: Grillen, Chinesisch, Japanisch, Indisch, Polnisch
 * erschienen sonst nicht, weil bestehende Rezepte vorher eingeordnet wurden).
 */
export const BEKANNTE_KATEGORIEN = [
  'Klassiker', 'Traditionell', 'Schnell', 'Einfach', 'Vegetarisch', 'Vegan', 'Glutenfrei', 'Scharf', 'Mild', 'Süß',
  'Warm', 'Kalt', 'Exotisch', 'Weihnachten', 'Cocktail', 'Alkoholisch', 'Alkoholfrei', 'Österreichische Küche',
  'Italienisch', 'Polnisch', 'Chinesisch', 'Japanisch', 'Indisch', 'Grillen',
];
