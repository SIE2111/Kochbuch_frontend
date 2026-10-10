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
