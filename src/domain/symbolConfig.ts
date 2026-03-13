// symbolConfig.ts
// Pure symbol configuration, paytables, and weighted RNG helpers (no Pixi imports).

export const SYMBOL_ASSETS = [
  "/apple.png",
  "/banana.png",
  "/lemonade.png",
  "/mangga.png",
  "/a.png",
  "/k.png",
  "/q.png",
  "/j.png",
  "/finalWild.png",
  "/finalScatter.png",
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
  [0, 0, 2, 3, 5, 8],   // 0 apple
  [0, 0, 3, 6, 9, 12],   // 1 banana
  [0, 0, 4, 10, 16, 20],   // 2 lemonade 
  [0, 0, 5, 15, 20, 30],    // 3 mango
  [0, 0, 10, 25, 40, 75],    // 4 a
  [0, 0, 15, 40, 60, 100],    // 5 k
  [0, 0, 20, 60, 95, 140],   // 6 q (high)
  [0, 0, 30, 100, 150, 250],  // 7 j (high)
  [0, 0, 0, 0, 0, 0], // 8 wild (highest-paying symbol)
  [0, 0, 0, 0, 0, 0],       // 9 scatter (no line payout)
];

/**
 * Scatter: pays by total count anywhere on reels (position independent).
 * Payout = SCATTER_PAYTABLE[count] × bet. Min 3 scatters for payout/bonus.
 */
// NOTE: Scatter symbols no longer produce a direct payout.
// SCATTER_PAYTABLE is kept commented-out for reference only.
// export const SCATTER_PAYTABLE: Record<number, number> = {
//   0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
// };

/** Scatter count -> free spins awarded (retrigger during bonus uses same table). */
export const FREE_SPINS_AWARDED: Record<number, number> = {
  3: 10, 4: 12, 5: 14, 6: 16, 7: 18
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

/**
 * Weighted random symbol picker that never returns the wild symbol.
 * Useful for balancing reels that should not contain wilds.
 */
export function getWeightedRandomSymbol_noWild(): number {
  const weights = [...SYMBOL_WEIGHTS];
  weights[WILD_SYMBOL_ID] = 0;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rand = Math.random() * totalWeight;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (rand <= cumulative) return i;
  }
  return 0;
}

