/** SpinResultGeneratorAdapter.ts
 * Application-layer adapter: implements ISpinResultGenerator by delegating to domain.
 */
import { generateSpinResult } from "../domain/SpinResultGenerator";
import type { SpinResultGeneratorConfig } from "../domain/SpinResultGenerator";
import type { ISymbolPicker } from "../domain/ports";
import type { ISpinResultGenerator } from "./ports";

export class SpinResultGeneratorAdapter implements ISpinResultGenerator {
  constructor(
    private readonly config: SpinResultGeneratorConfig,
    private readonly picker: ISymbolPicker
  ) {}

  generate(options?: Parameters<ISpinResultGenerator["generate"]>[0]): number[][] {
    return generateSpinResult(this.config, this.picker, options);
  }
}
