import { ShoppingCategory } from "@/lib/types";

/**
 * Deterministic keyword fallback for the manual quick-add path — the AI tool
 * passes a category itself (language judgment), but the no-AI path should
 * still group sensibly. First match wins; order matters (e.g. "frozen" beats
 * food words so "frozen berries" lands in frozen).
 */
const KEYWORDS: [ShoppingCategory, RegExp][] = [
  ["frozen", /frozen|ice cream|popsicle/i],
  ["cleaning", /detergent|bleach|cleaner|sponge|paper towel|dish soap|garbage bag|trash bag|wipes/i],
  ["toiletries", /toilet paper|toothpaste|shampoo|soap|deodorant|razor|floss|tampon|lotion/i],
  ["pets", /dog|cat|pet|litter|kibble/i],
  ["dairy", /milk|cheese|yogurt|butter|cream|eggs/i],
  ["bakery", /bread|bagel|croissant|bun|tortilla|pita/i],
  ["meat", /chicken|beef|pork|turkey|steak|bacon|sausage|ground/i],
  ["seafood", /salmon|tuna|shrimp|fish|cod|tilapia/i],
  ["produce", /apple|banana|lettuce|tomato|onion|potato|carrot|pepper|broccoli|spinach|fruit|vegetable|avocado|berr|grape|cucumber|garlic|lemon|lime/i],
  ["drinks", /coffee|tea|juice|soda|water|beer|wine|kombucha/i],
  ["snacks", /chips|crackers|cookie|chocolate|candy|granola|popcorn|nuts/i],
  ["pantry", /rice|pasta|flour|sugar|oil|sauce|cereal|beans|soup|spice|salt|oats|honey|peanut butter/i],
];

export function categorizeItem(name: string): ShoppingCategory {
  for (const [category, pattern] of KEYWORDS) {
    if (pattern.test(name)) return category;
  }
  return "other";
}
