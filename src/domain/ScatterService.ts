// ScatterService.ts
import { SCATTER_SYMBOL_ID, FREE_SPINS_AWARDED } from "./symbolConfig";
import { SymbolId, WinningPosition } from "./SpinEngine";

export interface ScatterResult {
  symbol: SymbolId;
  count: number;
  freeSpinsAwarded: number;
  positions: WinningPosition[];
}

export class ScatterService {
  /**
   * Evaluates the matrix for scatter symbols and returns the result.
   */
  evaluate(matrix: SymbolId[][]): ScatterResult {
    const positions: WinningPosition[] = [];
    const rows = matrix.length;
    const cols = rows > 0 ? matrix[0].length : 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (matrix[row][col] === SCATTER_SYMBOL_ID) {
          positions.push({ reelIndex: col, rowIndex: row });
        }
      }
    }

    const count = positions.length;
    const freeSpinsAwarded = FREE_SPINS_AWARDED[count] ?? 0;

    return {
      symbol: SCATTER_SYMBOL_ID,
      count,
      freeSpinsAwarded,
      positions,
    };
  }
}
