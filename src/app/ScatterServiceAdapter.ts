// ScatterServiceAdapter.ts
import { IScatterService, ScatterEvaluationResult } from "./ports";
import { ScatterService } from "../domain/ScatterService";

export class ScatterServiceAdapter implements IScatterService {
  constructor(private readonly service: ScatterService) {}

  evaluate(matrix: number[][]): ScatterEvaluationResult {
    const result = this.service.evaluate(matrix);
    return {
      symbol: result.symbol,
      count: result.count,
      freeSpinsAwarded: result.freeSpinsAwarded,
      positions: result.positions,
    };
  }
}
