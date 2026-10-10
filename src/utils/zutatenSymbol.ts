// Symbol je Einkaufsartikel, solange es noch kein KI-Bild gibt. Erst nach
// Stichwort im Namen, dann nach Abteilung, zuletzt ein Einkaufskorb.
const STICHWORTE: [string, string][] = [
  ['milch', 'bottle-tonic-outline'], ['hafer', 'bottle-tonic-outline'], ['soja', 'bottle-tonic-outline'],
  ['ei', 'egg-outline'], ['butter', 'cube-outline'], ['margarine', 'cube-outline'],
  ['käse', 'cheese'], ['mozzarella', 'cheese'], ['gouda', 'cheese'], ['parmesan', 'cheese'], ['feta', 'cheese'],
  ['emmentaler', 'cheese'], ['joghurt', 'cup-outline'], ['skyr', 'cup-outline'], ['topfen', 'cup-outline'],
  ['apfel', 'apple'], ['äpfel', 'apple'], ['birne', 'fruit-pear'], ['banane', 'fruit-pineapple'],
  ['ananas', 'fruit-pineapple'], ['orange', 'fruit-citrus'], ['zitrone', 'fruit-citrus'], ['limette', 'fruit-citrus'],
  ['traube', 'fruit-grapes-outline'], ['erdbeer', 'fruit-cherries'], ['kirsch', 'fruit-cherries'],
  ['melone', 'fruit-watermelon'], ['karotte', 'carrot'], ['kartoffel', 'food-apple-outline'],
  ['zwiebel', 'food-apple-outline'], ['knoblauch', 'food-apple-outline'], ['salat', 'leaf'], ['spinat', 'leaf'],
  ['rucola', 'leaf'], ['petersilie', 'sprout'], ['schnittlauch', 'sprout'], ['basilikum', 'sprout'],
  ['dill', 'sprout'], ['rosmarin', 'sprout'], ['thymian', 'sprout'], ['paprika', 'chili-mild'], ['chili', 'chili-hot'],
  ['pilz', 'mushroom-outline'], ['champignon', 'mushroom-outline'], ['mais', 'corn'], ['brokkoli', 'tree-outline'],
  ['brot', 'bread-slice-outline'], ['toast', 'bread-slice-outline'], ['semmel', 'baguette'], ['baguette', 'baguette'],
  ['croissant', 'baguette'], ['kornspitz', 'baguette'],
  ['hendl', 'food-drumstick-outline'], ['hühner', 'food-drumstick-outline'], ['pute', 'food-drumstick-outline'],
  ['schnitzel', 'food-steak'], ['rind', 'food-steak'], ['faschiert', 'food-steak'], ['speck', 'food-steak'],
  ['schinken', 'food-steak'], ['wurst', 'food-hot-dog'], ['würstel', 'food-hot-dog'], ['salami', 'food-hot-dog'],
  ['lachs', 'fish'], ['forelle', 'fish'], ['thunfisch', 'fish'], ['fisch', 'fish'], ['garnele', 'fish'],
  ['pizza', 'pizza'], ['pommes', 'french-fries'], ['eis', 'ice-cream'], ['nudel', 'pasta'], ['spaghetti', 'pasta'],
  ['penne', 'pasta'], ['gnocchi', 'pasta'], ['reis', 'rice'], ['müsli', 'bowl-mix-outline'], ['hafer', 'bowl-mix-outline'],
  ['mehl', 'sack'], ['zucker', 'cube-scan'], ['salz', 'shaker-outline'], ['pfeffer', 'shaker-outline'],
  ['schokolade', 'candy-outline'], ['kekse', 'cookie-outline'], ['gummi', 'candy-outline'], ['chips', 'food-variant'],
  ['nüsse', 'peanut-outline'], ['mandel', 'peanut-outline'], ['walnuss', 'peanut-outline'], ['honig', 'beehive-outline'],
  ['marmelade', 'jar-outline'], ['nutella', 'jar-outline'], ['öl', 'bottle-wine-outline'], ['essig', 'bottle-wine-outline'],
  ['wein', 'glass-wine'], ['prosecco', 'glass-wine'], ['bier', 'beer-outline'], ['wasser', 'water-outline'],
  ['saft', 'cup-water'], ['cola', 'cup-water'], ['kaffee', 'coffee-outline'], ['tee', 'tea-outline'],
  ['toilettenpapier', 'paper-roll-outline'], ['küchenrolle', 'paper-roll-outline'], ['spülmittel', 'bottle-soda-outline'],
  ['waschmittel', 'washing-machine'], ['seife', 'hand-wash-outline'], ['zahnpasta', 'toothbrush-paste'],
  ['batterie', 'battery-outline'], ['müll', 'trash-can-outline'],
];

const ABTEILUNG: Record<string, string> = {
  'Obst & Gemüse': 'food-apple-outline',
  'Brot & Gebäck': 'bread-slice-outline',
  'Molkerei & Eier': 'cup-outline',
  'Fleisch & Wurst': 'food-steak',
  'Fisch': 'fish',
  'Tiefkühl': 'snowflake',
  'Konserven & Fertiges': 'tray-full',
  'Nudeln, Reis & Getreide': 'pasta',
  'Backen & Süßes': 'cookie-outline',
  'Gewürze & Saucen': 'shaker-outline',
  'Öl & Essig': 'bottle-wine-outline',
  'Getränke': 'cup-water',
  'Haushalt': 'spray-bottle',
};

export function zutatenSymbol(name: string, abteilung?: string | null): any {
  const n = (name || '').toLowerCase();
  for (const [wort, symbol] of STICHWORTE) {
    if (n.includes(wort)) return symbol;
  }
  return (abteilung && ABTEILUNG[abteilung]) || 'cart-outline';
}

// Passendes Emoji je Artikel (erste Uebereinstimmung gewinnt, Reihenfolge zaehlt:
// Spezielles vor Allgemeinem). Kurze Stichworte (unter 4 Buchstaben) muessen
// das ganze Wort sein, laengere duerfen im Wort stecken (Basmatireis).
const EMOJIS: [string, string][] = [
  ['paprikapulver', '🧂'], ['gemüse', '🥦'], ['dosentomaten', '🥫'], ['tomatenmark', '🥫'], ['passiert', '🥫'], ['konserve', '🥫'],
  ['kokosmilch', '🥥'], ['leberkäse', '🥩'], ['eisberg', '🥬'], ['süßkartoffel', '🍠'], ['kartoffel', '🥔'],
  ['erdapfel', '🥔'], ['pommes', '🍟'], ['salat', '🥬'], ['spinat', '🥬'], ['rucola', '🥬'], ['kohlrabi', '🥬'],
  ['lauch', '🥬'], ['sellerie', '🥬'], ['karotte', '🥕'], ['möhre', '🥕'], ['zwiebel', '🧅'], ['knoblauch', '🧄'],
  ['tomate', '🍅'], ['paradeiser', '🍅'], ['ketchup', '🍅'], ['gurke', '🥒'], ['zucchini', '🥒'], ['paprika', '🫑'],
  ['chili', '🌶️'], ['melanzani', '🍆'], ['aubergine', '🍆'], ['kürbis', '🎃'], ['brokkoli', '🥦'], ['karfiol', '🥦'],
  ['blumenkohl', '🥦'], ['pilz', '🍄'], ['champignon', '🍄'], ['mais', '🌽'], ['ingwer', '🫚'], ['radieschen', '🔴'],
  ['petersilie', '🌿'], ['schnittlauch', '🌿'], ['basilikum', '🌿'], ['dill', '🌿'], ['rosmarin', '🌿'],
  ['thymian', '🌿'], ['oregano', '🌿'], ['kräuter', '🌿'],
  ['apfel', '🍎'], ['äpfel', '🍎'], ['birne', '🍐'], ['banane', '🍌'], ['orange', '🍊'], ['zitrone', '🍋'],
  ['limette', '🍋'], ['traube', '🍇'], ['erdbeer', '🍓'], ['himbeer', '🍓'], ['heidelbeer', '🫐'], ['kirsch', '🍒'],
  ['melone', '🍉'], ['ananas', '🍍'], ['kiwi', '🥝'], ['mango', '🥭'], ['avocado', '🥑'], ['pfirsich', '🍑'],
  ['marille', '🍑'],
  ['toast', '🍞'], ['brot', '🍞'], ['knäcke', '🍞'], ['semmel', '🥖'], ['baguette', '🥖'], ['kornspitz', '🥖'],
  ['croissant', '🥐'], ['brezel', '🥨'], ['tortilla', '🫓'],
  ['milch', '🥛'], ['obers', '🥛'], ['sahne', '🥛'], ['sauerrahm', '🥛'], ['butter', '🧈'], ['margarine', '🧈'],
  ['käse', '🧀'], ['mozzarella', '🧀'], ['gouda', '🧀'], ['parmesan', '🧀'], ['feta', '🧀'], ['emmentaler', '🧀'],
  ['mascarpone', '🧀'], ['joghurt', '🥣'], ['skyr', '🥣'], ['topfen', '🥣'], ['ei', '🥚'], ['eier', '🥚'],
  ['hendl', '🍗'], ['hühner', '🍗'], ['pute', '🍗'], ['schnitzel', '🥩'], ['rind', '🥩'], ['faschiert', '🥩'],
  ['schwein', '🥩'], ['speck', '🥓'], ['schinken', '🥓'], ['wurst', '🌭'], ['würstel', '🌭'], ['salami', '🌭'],
  ['lachs', '🐟'], ['forelle', '🐟'], ['fisch', '🐟'], ['thunfisch', '🐟'], ['garnele', '🦐'],
  ['pizza', '🍕'], ['eis', '🍨'], ['nudel', '🍝'], ['spaghetti', '🍝'], ['penne', '🍝'], ['gnocchi', '🍝'],
  ['reis', '🍚'], ['couscous', '🍚'], ['polenta', '🌽'], ['müsli', '🥣'], ['haferflocken', '🥣'], ['cornflakes', '🥣'],
  ['linsen', '🫘'], ['bohne', '🫘'], ['kichererbsen', '🫘'], ['kidney', '🫘'],
  ['mehl', '🌾'], ['zucker', '🍬'], ['salz', '🧂'], ['pfeffer', '🧂'], ['curry', '🧂'], ['zimt', '🧂'],
  ['muskat', '🧂'], ['suppenwürze', '🧂'], ['schokolade', '🍫'], ['nutella', '🍫'], ['kakao', '🍫'], ['kekse', '🍪'],
  ['gummi', '🍬'], ['chips', '🥔'], ['nüsse', '🥜'], ['mandel', '🥜'], ['walnüsse', '🥜'], ['honig', '🍯'],
  ['marmelade', '🍯'], ['oliven', '🫒'], ['essig', '🫙'], ['senf', '🫙'], ['mayonnaise', '🫙'], ['sojasauce', '🫙'],
  ['wein', '🍷'], ['prosecco', '🍾'], ['bier', '🍺'], ['wasser', '💧'], ['saft', '🧃'], ['cola', '🥤'],
  ['kaffee', '☕'], ['tee', '🍵'], ['tiefkühl', '🧊'],
  ['toilettenpapier', '🧻'], ['küchenrolle', '🧻'], ['spülmittel', '🧴'], ['waschmittel', '🧺'], ['seife', '🧼'],
  ['duschgel', '🧴'], ['zahnpasta', '🪥'], ['batterie', '🔋'], ['müllsäcke', '🗑️'],
];

export function zutatenEmoji(name: string): string | null {
  const tokens = (name || '').toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  if (!tokens.length) return null;
  for (const [wort, emoji] of EMOJIS) {
    for (const tok of tokens) {
      if (tok === wort || (wort.length >= 4 && tok.includes(wort))) return emoji;
      if (tok.length > 3 && tok.endsWith('öl')) return '🫒';
    }
  }
  return null;
}
