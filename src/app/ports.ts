/**
 * Application layer ports (interfaces).
 * GameController depends on these abstractions; the composition root injects domain implementations.
 */
import type { SpinConfig, SpinOutcome, WinningPosition } from "../domain/SpinEngine";
import type { GenerateSpinResultOptions } from "../domain/SpinResultGenerator";

/** Session/wallet: credits, bet, free spins, auto-spin state. */
export interface IGameSession {
  getCredits(): number;
  getBet(): number;
  setBet(amount: number): void;
  addCredits(amount: number): void;
  deductBetForSpin(): void;
  hasEnoughCreditsForBet(): boolean;
  isInFreeSpins(): boolean;
  getFreeSpinsRemaining(): number;
  awardFreeSpins(count: number): void;
  consumeFreeSpin(): number;
  endFreeSpinSeries(): void;
  isAutoSpinActive(): boolean;
  getAutoSpinsRemaining(): number;
  startAutoSpin(count: number): void;
  consumeAutoSpin(): number;
  cancelAutoSpin(): void;
}

/** Evaluates a visible symbol matrix and returns payout + winning positions. */
export interface ISpinEvaluator {
  evaluate(config: SpinConfig, matrix: number[][], betAmount: number): SpinOutcome;
}

/** Generates a new spin result matrix (symbols per reel). */
export interface ISpinResultGenerator {
  generate(options?: GenerateSpinResultOptions): number[][];
}

/**
 * Board/reels port (UI/Infrastructure implements this).
 * Application orchestrates the flow but never touches PIXI types.
 */
export interface IReelsPort {
  /** Render/update visible symbols (UI layer decides how). */
  updateReelsVisuals(): void;
  /** Read the visible matrix [row][reel]. */
  getVisibleMatrix(symbolsPerReel: number): number[][];
  /** Clear any UI-specific overrides (dimming, temp sprites, etc.). */
  clearVisualOverrides(): void;

  /**
   * Animate reels to land on the given result matrix, then call onComplete.
   * The implementation owns tweening and reel math.
   */
  spinToResult(
    resultPerReel: number[][],
    onComplete: () => void
  ): void;

  /**
   * Runs the cascade (remove winners, drop survivors, spawn new symbols).
   * Resolves when all symbol drops are finished and the board is stable again.
   */
  cascade(
    config: { reelsCount: number; symbolsPerReel: number; symbolSize: number },
    winningPositions: WinningPosition[],
    onComplete: () => void
  ): void;
}

/**
 * Win presentation port (UI/Infrastructure implements this).
 * Owns highlight/glow/float/slice timing and returns control when ready to cascade.
 */
export interface IWinAnimator {
  /** Called once after layout is known so win animations can position correctly. */
  setReelBounds(reelTopY: number, reelLeftX: number): void;
  /** Clear all win visuals (highlights, floating clones, timers). */
  clear(): void;
  /** Per-frame update for glow pulses/fades and floating symbol phases. */
  update(deltaTime: number): void;

  /**
   * Start the win symbol sequence:
   * glow → fade → float-up → slice.
   * Calls onComplete when slicing is done (i.e. ready to cascade).
   */
  startWinSequence(
    config: { symbolSize: number },
    winningPositions: WinningPosition[],
    onComplete: () => void
  ): void;
}
