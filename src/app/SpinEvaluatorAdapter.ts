/** SpinEvaluatorAdapter.ts
 * Application-layer adapter: implements ISpinEvaluator by delegating to domain SpinEngine.
 */
import { evaluateSpin } from "../domain/SpinEngine";
import type { SpinConfig, SpinOutcome } from "../domain/SpinEngine";
import type { ISpinEvaluator } from "./ports";

export class SpinEvaluatorAdapter implements ISpinEvaluator {
  evaluate(config: SpinConfig, matrix: number[][], betAmount: number): SpinOutcome {
    return evaluateSpin(config, matrix, betAmount);
  }
}
