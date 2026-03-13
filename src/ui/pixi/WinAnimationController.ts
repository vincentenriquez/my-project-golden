//WinAnimationController.ts
import type { Reel } from "./Reel";
import type { SymbolCell } from "./SymbolCell";
import { WILD_SYMBOL_ID, SCATTER_SYMBOL_ID } from "../../domain/symbolConfig";
import type { TweenToFn } from "./tweenTypes";
import { getAnimationFrames } from "./symbolAnimations";

export interface WinningCellEntry {
  cell: SymbolCell;
  reelIndex: number;
  rowIndex: number;
}

export interface CascadeConfig {
  reelsCount: number;
  symbolsPerReel: number;
  symbolSize: number;
  rowPadding: number;
}

/**
 * Easing: basketball-style drop — smooth fall (gravity-like), subtle bounce
 * on landing, then natural settle. t in [0,1] → progress in [0,1].
 */
function easeDropWithBounce(t: number): number {
  const fallPhase = 0.78; // share of time spent in the fall
  if (t < fallPhase) {
    // Fall: ease-in cubic (accelerate like gravity).
    const u = t / fallPhase;
    return 0.88 * u * u * u;
  }
  const u = (t - fallPhase) / (1 - fallPhase); // 0..1 over the landing phase
  // Land: small overshoot then settle at 1 (one soft bounce).
  return 0.88 + 0.12 * u + 0.1 * Math.sin(u * Math.PI);
}

export class WinAnimationController {
  /** Base duration for each symbol drop (ms). Same for all for visual consistency. */
  private static readonly CASCADE_DROP_DURATION_MS = 400;
  /** Delay before starting each row's drop (ms). Creates a top-to-bottom wave. */
  private static readonly CASCADE_ROW_STAGGER_MS = 48;
  /** Delay before starting each reel's drops (ms). Creates left-to-right wave. */
  private static readonly CASCADE_REEL_STAGGER_MS = 35;
  /** Extra pixels above reel so new symbols enter from just out of view. */
  private static readonly CASCADE_NEW_SYMBOL_OFFSET = 8;

  constructor(
    private readonly tweenTo: TweenToFn,
    private readonly bounceOut: (t: number) => number,
    private readonly symbolPicker: () => number
  ) {}

  /**
   * Runs the cascade: winning positions are cleared, survivors drop into empty
   * slots, and new symbols enter from the top. Uses staggered start times
   * (reel then row) and a single smooth easing for consistent, polished drops.
   */
  cascadeSymbols(
    reels: Reel[],
    config: CascadeConfig,
    winningEntries: WinningCellEntry[],
    setDimOverlayVisible: (visible: boolean) => void,
    onCascadeFinished: () => void
  ): void {
    const { reelsCount, symbolsPerReel, symbolSize, rowPadding } = config;

    setDimOverlayVisible(false);

    const emptyMap = new Map<number, Set<number>>();
    const seen = new Set<string>();
    for (const entry of winningEntries) {
      const key = `${entry.reelIndex}_${entry.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!emptyMap.has(entry.reelIndex)) emptyMap.set(entry.reelIndex, new Set());
      emptyMap.get(entry.reelIndex)!.add(entry.rowIndex);
    }

    let totalTweens = 0;
    let doneTweens = 0;
    const onDone = () => {
      doneTweens++;
      if (doneTweens >= totalTweens) onCascadeFinished();
    };

    for (let ri = 0; ri < reelsCount; ri++) {
      const reel = reels[ri];
      // VISUAL CLEANUP: Always clear old highlights from all symbols before cascading.
      reel.symbolCells.forEach((cell) => {
        cell.alpha = 1;
        cell.hideGlow();
        cell.detachRaysFromExternalLayer();
      });

      const empty = emptyMap.get(ri);
      if (!empty || empty.size === 0) {
        continue;
      }

      const currentSymbols = reel.getVisibleSymbols();

      const survivors: { sym: number; fromRow: number }[] = [];
      for (let row = 0; row < symbolsPerReel; row++) {
        if (!empty.has(row)) survivors.push({ sym: currentSymbols[row], fromRow: row });
      }

      const numEmpty = empty.size;
      const newSyms: number[] = [];
      for (let i = 0; i < numEmpty; i++) newSyms.push(this.symbolPicker());

      const newColumn = [...newSyms, ...survivors.map((s) => s.sym)];

      const len = reel.strip.length;
      const top = Math.floor(reel.position) % len;
      const normTop = ((top % len) + len) % len;
      for (let row = 0; row < symbolsPerReel; row++) {
        reel.strip[(normTop + row) % len] = newColumn[row];
      }
      reel.clearVisualOverrides();

      for (let row = 0; row < symbolsPerReel; row++) {
        const cell = reel.symbolCells[row];
        reel.suspendCell(cell);

        const newSym = newColumn[row];

        if (newSym === WILD_SYMBOL_ID || newSym === SCATTER_SYMBOL_ID) {
          cell.clearAnimated();
          const frames = getAnimationFrames(newSym);
          if (frames.length > 0) {
            cell.setAnimated(frames);
          } else {
            const tex = reel.getTexture(newSym);
            if (tex) cell.setTexture(tex, newSym);
          }
        } else {
          cell.clearAnimated();
          const tex = reel.getTexture(newSym);
          if (tex) cell.setTexture(tex, newSym);
        }

        cell.alpha = 1;
        cell.hideGlow();
        cell.detachRaysFromExternalLayer();

        let fromY: number;
        if (row < numEmpty) {
          // New symbols enter from above the visible area (one slot above per row for clean stack).
          fromY = -(numEmpty - row) * (symbolSize + rowPadding) - WinAnimationController.CASCADE_NEW_SYMBOL_OFFSET;
        } else {
          fromY = survivors[row - numEmpty].fromRow * (symbolSize + rowPadding);
        }

        const toY = row * (symbolSize + rowPadding);

        if (Math.abs(fromY - toY) < 1) {
          cell.y = toY;
          reel.restoreCell(cell);
          continue;
        }

        cell.y = fromY;
        totalTweens++;

        const durationMs = WinAnimationController.CASCADE_DROP_DURATION_MS;
        const startDelayMs =
          ri * WinAnimationController.CASCADE_REEL_STAGGER_MS +
          row * WinAnimationController.CASCADE_ROW_STAGGER_MS;

        const runTween = () => {
          this.tweenTo(
            cell,
            "y",
            toY,
            durationMs,
            easeDropWithBounce,
            undefined,
            () => {
              reel.restoreCell(cell);
              onDone();
            }
          );
        };

        if (startDelayMs <= 0) {
          runTween();
        } else {
          setTimeout(runTween, startDelayMs);
        }
      }
    }

    if (totalTweens === 0) onCascadeFinished();
  }
}

