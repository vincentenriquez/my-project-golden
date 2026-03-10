//SpinEngine.ts
import {
  TOTAL_SYMBOLS,
  WILD_SYMBOL_ID,
  SCATTER_SYMBOL_ID,
  PAYTABLE,
  FREE_SPINS_AWARDED,
} from "./symbolConfig";
// SpinEngine.ts
// Pure spin evaluation types and API surface (no Pixi dependencies).

export type SymbolId = number;

export interface SpinConfig {
  reelsCount: number;
  symbolsPerReel: number;
}

export interface WinningPosition {
  reelIndex: number;
  rowIndex: number;
}

export interface WaysWin {
  symbol: SymbolId;
  hits: number;
  combos: number;
  payout: number;
}

export interface ScatterWin {
  symbol: SymbolId;
  count: number;
  payout: number;
  freeSpinsAwarded: number;
}

/**
 * Result of evaluating a single spin (including ways and scatter).
 * Does not contain any Pixi-specific types; suitable for unit testing.
 */
export interface SpinOutcome {
  /** Structural configuration for sanity-checking matrix shape. */
  config: SpinConfig;

  /** Original visible matrix [row][reel] as seen by the player. */
  matrix: SymbolId[][];

  /**
   * Matrix after applying any domain rules that alter symbols
   * (e.g., expanding wilds). For now this may be identical to `matrix`
   * but is separated to make future rules explicit.
   */
  expandedMatrix: SymbolId[][];

  /** All 243-ways wins derived from the expanded matrix. */
  waysWins: WaysWin[];

  /** Optional scatter win (position-independent). */
  scatterWin: ScatterWin | null;

  /** Total payout from ways and scatter combined. */
  totalPayout: number;

  /** Subtotal from ways only (useful for debugging/breakdown). */
  totalWaysPayout: number;

  /** Subtotal from scatter only. */
  totalScatterPayout: number;

  /**
   * All positions (row, reel) that participate in any win (ways or scatter).
   * The UI layer can use this to drive highlights and animations.
   */
  winningPositions: WinningPosition[];

  /**
   * Positions where Scatter symbols appear (for scatter bonus animation).
   * Populated when scatterWin is present; used by UI for highlight/float/slice sequence.
   */
  scatterPositions: WinningPosition[];
}

/**
 * Evaluate a visible symbol matrix for a single spin.
 *
 * - `config` describes the logical reel/row configuration.
 * - `matrix` is the raw visible board (rows × reels).
 * - `betAmount` is the bet per spin used to scale payouts.
 *
 * Implementation (ways, scatter, expanding wilds) will be provided in the
 * extraction step; for now this declares the stable API surface.
 */
export function evaluateSpin(
  config: SpinConfig,
  matrix: SymbolId[][],
  betAmount: number
): SpinOutcome {
  const { reelsCount, symbolsPerReel } = config;

  // Defensive clone so callers cannot mutate the internal representation.
  const baseMatrix: SymbolId[][] = matrix.map((row) => [...row]);

  // Hook for future rules like expanding wilds. For now, just clone.
  const expandedMatrix: SymbolId[][] = baseMatrix.map((row) => [...row]);

  const waysWins: WaysWin[] = [];
  const winningPositionsSet = new Set<string>();

  // ── 243‑ways evaluation on expanded matrix ────────────────────────────────
  for (let symbol = 0; symbol < TOTAL_SYMBOLS; symbol++) {
    if (symbol === SCATTER_SYMBOL_ID) continue;
    if (symbol === WILD_SYMBOL_ID) continue;

    let consecutiveReels = 0;
    let combos = 1;

    for (let reel = 0; reel < reelsCount; reel++) {
      let matchesOnThisReel = 0;
      for (let row = 0; row < symbolsPerReel; row++) {
        const cell = expandedMatrix[row]?.[reel];
        if (cell === symbol || cell === WILD_SYMBOL_ID) matchesOnThisReel++;
      }
      if (matchesOnThisReel === 0) break;
      consecutiveReels++;
      combos *= matchesOnThisReel;
    }

    if (consecutiveReels >= 3) {
      const payoutMultiplier = PAYTABLE[symbol]?.[consecutiveReels] ?? 0;
      const payout = combos * payoutMultiplier * betAmount;
      if (payout > 0) {
        waysWins.push({ symbol, hits: consecutiveReels, combos, payout });
      }
    }
  }

  // ── Scatter evaluation on ORIGINAL matrix ─────────────────────────────────
  let scatterCount = 0;
  const rows = baseMatrix.length;
  const cols = rows > 0 ? baseMatrix[0].length : 0;

  for (let row = 0; row < rows; row++) {
    for (let reel = 0; reel < cols; reel++) {
      if (baseMatrix[row]?.[reel] === SCATTER_SYMBOL_ID) {
        scatterCount++;
      }
    }
  }

  const freeSpinsAwarded = FREE_SPINS_AWARDED[scatterCount] ?? 0;

  const scatterWin: ScatterWin | null =
    freeSpinsAwarded > 0
      ? {
          symbol: SCATTER_SYMBOL_ID,
          count: scatterCount,
          payout: 0,
          freeSpinsAwarded,
        }
      : null;

  const scatterPositions: WinningPosition[] = [];
  if (freeSpinsAwarded > 0) {
    for (let row = 0; row < rows; row++) {
      for (let reel = 0; reel < cols; reel++) {
        if (baseMatrix[row]?.[reel] === SCATTER_SYMBOL_ID) {
          scatterPositions.push({ reelIndex: reel, rowIndex: row });
        }
      }
    }
  }

  // ── Aggregate winnings and mark winning positions ────────────────────────
  let totalWaysPayout = 0;
  for (const win of waysWins) {
    totalWaysPayout += win.payout;

    // For each ways win, mark all contributing positions:
    // up to `hits` reels from the left, and all rows where base or wild matches.
    for (let reel = 0; reel < win.hits; reel++) {
      for (let row = 0; row < symbolsPerReel; row++) {
        const cell = expandedMatrix[row]?.[reel];
        if (cell === win.symbol || cell === WILD_SYMBOL_ID) {
          winningPositionsSet.add(`${reel}:${row}`);
        }
      }
    }
  }

  let totalScatterPayout = 0;
  // Scatter symbols do not contribute to direct payouts or winning positions.
  const totalPayout = totalWaysPayout + totalScatterPayout;

  const winningPositions: WinningPosition[] = [];
  winningPositionsSet.forEach((key) => {
    const [reelStr, rowStr] = key.split(":");
    const reelIndex = parseInt(reelStr, 10);
    const rowIndex = parseInt(rowStr, 10);
    if (!Number.isNaN(reelIndex) && !Number.isNaN(rowIndex)) {
      winningPositions.push({ reelIndex, rowIndex });
    }
  });

  return {
    config,
    matrix: baseMatrix,
    expandedMatrix,
    waysWins,
    scatterWin,
    totalPayout,
    totalWaysPayout,
    totalScatterPayout,
    winningPositions,
    scatterPositions,
  };
}


