/** ports.ts
 * Domain ports (interfaces) for DDD.
 * The domain defines what it needs; infrastructure or app provides implementations.
 */

import type { SymbolId } from "./SpinEngine";

/**
 * Port: symbol selection for spin/cascade.
 * Allows swapping weighted RNG for tests or alternate logic.
 */
export interface ISymbolPicker {
  /** Pick a symbol using the configured strategy (e.g. weighted random). */
  pick(): SymbolId;
  /** Pick a symbol that is never the given symbol (e.g. exclude wild on certain reels). */
  pickExcluding(symbolId: SymbolId): SymbolId;
}
