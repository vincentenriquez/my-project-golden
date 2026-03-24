//PixiReelsPort.ts
import type { IReelsPort } from "../../app/ports";
import type { WinningPosition } from "../../domain/SpinEngine";
import type { TweenToFn } from "./tweenTypes";
import type { Reel } from "./Reel";
import { WinAnimationController, type WinningCellEntry } from "./WinAnimationController";

export class PixiReelsPort implements IReelsPort {
  private readonly cascadeController: WinAnimationController;

  constructor(
    private readonly reels: Reel[],
    private readonly symbolsPerReel: number,
    private readonly tweenTo: TweenToFn,
    private readonly bounceOut: (t: number) => number,
    symbolPicker: () => number,
    wildAllowedReelIndices: Set<number>,          // ← ADD
    symbolPickerExcludingWild: () => number       // ← ADD
  ) {
    this.cascadeController = new WinAnimationController(this.tweenTo, this.bounceOut, symbolPicker, wildAllowedReelIndices, symbolPickerExcludingWild);
  }

  updateReelsVisuals(): void {
    this.reels.forEach((r) => r.updateSprites());
  }

  getVisibleMatrix(symbolsPerReel: number): number[][] {
    const matrix: number[][] = Array.from({ length: symbolsPerReel }, () => []);
    this.reels.forEach((r, reelIndex) => {
      const visible = r.getVisibleSymbols();
      visible.forEach((sym, row) => {
        matrix[row][reelIndex] = sym;
      });
    });
    return matrix;
  }

  clearVisualOverrides(): void {
    this.reels.forEach((r) => r.clearVisualOverrides());
  }

  spinToResult(resultPerReel: number[][], onComplete: () => void): void {
    const reelsCount = this.reels.length;
    if (!Array.isArray(resultPerReel) || resultPerReel.length !== reelsCount) {
      onComplete();
      return;
    }

    let completed = 0;
    for (let i = 0; i < reelsCount; i++) {
      const reel = this.reels[i];
      const targetTopIndex = reel.findOrInjectSequence(resultPerReel[i]);
      const len = reel.strip.length;
      const base = Math.floor(reel.position);
      const baseMod = ((base % len) + len) % len;
      const delta = ((baseMod - targetTopIndex) + len) % len;
      const minSpins = 3;
      const spins = minSpins + i;
      const target = base - spins * len - delta;
      const time = 1150 + i * 360 + Math.floor(Math.random() * 100);

      this.tweenTo(
        reel,
        "position",
        target,
        time,
        (t: number) => t,
        undefined,
        () => {
          this.playSettleBounceOnReel(reel);
          completed++;
          if (completed === reelsCount) {
            this.reels.forEach((r) => (r.position = Math.floor(r.position)));
            this.updateReelsVisuals();
            onComplete();
          }
        }
      );
    }
  }

  cascade(
    config: { reelsCount: number; symbolsPerReel: number; symbolSize: number; rowPadding: number },
    winningPositions: WinningPosition[],
    onComplete: () => void,
    nextGridPerReel?: number[][]
  ): void {
    const entries = this.toWinningEntries(winningPositions);
    this.cascadeController.cascadeSymbols(
      this.reels,
      config,
      entries,
      () => {
        // dim overlay handled by app/win animator; keep cascade UI-only
      },
      onComplete,
      nextGridPerReel
    );
  }

  private toWinningEntries(winningPositions: WinningPosition[]): WinningCellEntry[] {
    const entries: WinningCellEntry[] = [];
    const seen = new Set<string>();
    for (const pos of winningPositions) {
      const key = `${pos.reelIndex}_${pos.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reel = this.reels[pos.reelIndex];
      const cell = reel?.getContainerAt(pos.rowIndex);
      if (!cell) continue;
      entries.push({ reelIndex: pos.reelIndex, rowIndex: pos.rowIndex, cell });
    }
    return entries;
  }

  private playSettleBounceOnReel(reel: Reel): void {
    const bottomRowIndex = Math.max(0, this.symbolsPerReel - 1);
    const squashY = 0.96;
    const durationDown = 110;
    const durationUp = 230;

    const cell = reel.getContainerAt(bottomRowIndex);
    if (!cell) return;

    cell.scale.set(1, 1);

    this.tweenTo(
      cell.scale,
      "y",
      squashY,
      durationDown,
      (t) => t,
      undefined,
      () => {
        this.tweenTo(cell.scale, "y", 1, durationUp, (t) => this.bounceOut(t), undefined);
      }
    );
  }
}

