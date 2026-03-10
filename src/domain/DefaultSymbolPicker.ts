/**
 * Default implementation of ISymbolPicker using domain symbolConfig.
 */
import { getWeightedRandomSymbol, getWeightedRandomSymbol_noWild } from "./symbolConfig";
import type { ISymbolPicker } from "./ports";
import type { SymbolId } from "./SpinEngine";

export class DefaultSymbolPicker implements ISymbolPicker {
  pick(): SymbolId {
    return getWeightedRandomSymbol();
  }

  pickExcluding(symbolId: SymbolId): SymbolId {
    if (symbolId === 8) return getWeightedRandomSymbol_noWild();
    return getWeightedRandomSymbol();
  }
}
