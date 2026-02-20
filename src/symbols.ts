/**
 * Symbol configuration and paytable logic.
 * Encapsulates: symbol IDs, weights, paytables, and weighted RNG.
 */

export const SYMBOL_ASSETS = [
  "/cherry.png",
  "/lemon.png",
  "/orange.png",
  "/plum.png",
  "/grape.png",
  "/watermelon.png",
  "/mango.png",
  "/strawberry.png",
  "/wild.png",
  "/scatter.png",
];

export const TOTAL_SYMBOLS = 10;
export const WILD_SYMBOL_ID = 8;
export const SCATTER_SYMBOL_ID = 9;

/**
 * 243 Ways = 3 rows ^ 5 reels.
 * Every spin covers all 243 possible left-to-right combinations.
 */
export const TOTAL_WAYS = 243;

/** Symbol weights for weighted RNG (higher = more common) */
export const SYMBOL_WEIGHTS: number[] = [
  30, 28, 26, 24, 20, 18, 10, 8, 5, 3,
];

/** Paytable: [symbolId][count] => payout multiplier per bet */
export const PAYTABLE: number[][] = [
  [0, 0, 4, 14, 60, 200],   // 0 cherry
  [0, 0, 4, 12, 50, 180],   // 1 lemon
  [0, 0, 3, 10, 40, 160],   // 2 orange
  [0, 0, 3, 8, 35, 140],    // 3 plum
  [0, 0, 2, 6, 30, 120],    // 4 grape
  [0, 0, 2, 5, 25, 100],    // 5 watermelon
  [0, 0, 6, 25, 90, 300],   // 6 mango (high)
  [0, 0, 8, 30, 120, 400],  // 7 strawberry (high)
  [0, 0, 10, 50, 250, 500], // 8 wild (highest-paying symbol)
  [0, 0, 0, 2, 8, 30],      // 9 scatter (paid via SCATTER_PAYTABLE)
];

/**
 * Scatter: pays by total count anywhere on reels (position independent).
 * Payout = SCATTER_PAYTABLE[count] × bet. Min 3 scatters for payout/bonus.
 */
export const SCATTER_PAYTABLE: Record<number, number> = {
  0: 0, 1: 0, 2: 0, 3: 2, 4: 10, 5: 50, 6: 200,
};

/** Scatter count -> free spins awarded (retrigger during bonus uses same table). */
export const FREE_SPINS_AWARDED: Record<number, number> = {
  3: 10, 4: 15, 5: 20, 6: 25,
};

/**
 * Picks a symbol ID using weighted random (respects SYMBOL_WEIGHTS).
 */
export function getWeightedRandomSymbol(): number {
  const totalWeight = SYMBOL_WEIGHTS.reduce((a, b) => a + b, 0);
  const rand = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
    cumulative += SYMBOL_WEIGHTS[i];
    if (rand <= cumulative) return i;
  }
  return SYMBOL_WEIGHTS.length - 1;
}
