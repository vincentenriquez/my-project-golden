/** SpinResultGenerator.ts
 * Domain service: generates a spin result matrix (symbols per reel).
 * Encapsulates game rules (wild-allowed reels, weighted vs uniform) and delegates
 * actual symbol choice to ISymbolPicker (Dependency Inversion).
 */
import { TOTAL_SYMBOLS, WILD_SYMBOL_ID, SCATTER_SYMBOL_ID } from "./symbolConfig";
import type { ISymbolPicker } from "./ports";

export interface SpinResultGeneratorConfig {
  reelsCount: number;
  symbolsPerReel: number;
  /** Reel indices where wild is allowed; others use pickExcluding(wild). */
  wildAllowedReelIndices: Set<number>;
}

export interface GenerateSpinResultOptions {
  weighted?: boolean;
  forceMatrix?: number[][];
  forceSymbols?: Partial<Record<number, Partial<Record<number, number>>>>;
}

/**
 * Returns a matrix [reelIndex][row] of SymbolIds (same shape as used by reels).
 */
export function generateSpinResult(
  config: SpinResultGeneratorConfig,
  picker: ISymbolPicker,
  options?: GenerateSpinResultOptions
): number[][] {
  const { reelsCount, symbolsPerReel, wildAllowedReelIndices } = config;

  if (options?.forceMatrix) return options.forceMatrix;

  const matrixPerReel: number[][] = [];
  for (let reelIndex = 0; reelIndex < reelsCount; reelIndex++) {
    const column: number[] = [];
    for (let row = 0; row < symbolsPerReel; row++) {
      let symbolId: number;
      if (
        options?.forceSymbols &&
        options.forceSymbols[reelIndex] &&
        options.forceSymbols[reelIndex]![row] !== undefined
      ) {
        symbolId = options.forceSymbols[reelIndex]![row]!;
      } else {
        symbolId = options?.weighted ? picker.pick() : Math.floor(Math.random() * TOTAL_SYMBOLS);
      }
      if (!wildAllowedReelIndices.has(reelIndex) && symbolId === WILD_SYMBOL_ID) {
        symbolId = picker.pickExcluding(WILD_SYMBOL_ID);
      }
      column.push(symbolId);
    }
    matrixPerReel.push(column);
  }
  return matrixPerReel;
}
