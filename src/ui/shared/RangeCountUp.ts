/**
 * RangeCountUp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A small, ticker-driven numeric tween for UI values that need to animate
 * smoothly from a current value → a target value (supports both up and down).
 *
 * Designed for:
 *   - BET amount changes (10 → 20, 50 → 40, etc.)
 *   - TOTAL WIN accumulation across cascades (0 → 12.50 → 27.50 ...)
 */

export type RangeCountUpCallback = (
  /** Current display value */
  displayValue: number,
  /** true only on the very last frame */
  isDone: boolean,
) => void;

const MIN_DURATION_MS = 250;
const MAX_DURATION_MS = 900;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function durationForDelta(deltaAbs: number): number {
  // Fast for tiny changes, gently longer for big jumps.
  //  10  → ~260ms
  //  100 → ~420ms
  //  1k  → ~650ms
  //  10k → ~900ms (cap)
  const t = Math.max(0, Math.min(1, Math.log10(Math.max(1, deltaAbs)) / 4));
  return MIN_DURATION_MS + t * (MAX_DURATION_MS - MIN_DURATION_MS);
}

function roundTo(value: number, decimals: number): number {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

export class RangeCountUp {
  private readonly _cb: RangeCountUpCallback;
  private readonly _decimals: number;

  private _from: number = 0;
  private _to: number = 0;
  private _duration: number = 0;
  private _elapsed: number = 0;
  private _active: boolean = false;
  private _lastDisplay: number = Number.NaN;

  constructor(callback: RangeCountUpCallback, decimals: number = 2) {
    this._cb = callback;
    this._decimals = decimals;
  }

  start(from: number, to: number, durationMS?: number): void {
    this._active = false;

    this._from = from;
    this._to = to;
    this._elapsed = 0;
    this._duration = typeof durationMS === "number"
      ? Math.max(1, durationMS)
      : durationForDelta(Math.abs(to - from));
    this._lastDisplay = Number.NaN;
    this._active = true;

    // First render immediately
    this._emit(from, false);
  }

  cancel(): void {
    this._active = false;
    this._elapsed = 0;
    this._lastDisplay = Number.NaN;
  }

  update(deltaMS: number): void {
    if (!this._active) return;

    this._elapsed += deltaMS;
    const progress = Math.min(1, this._elapsed / this._duration);
    const eased = easeOutCubic(progress);

    const value = this._from + (this._to - this._from) * eased;
    this._emit(value, progress >= 1);

    if (progress >= 1) {
      this._active = false;
      // snap to exact target
      this._emit(this._to, true);
    }
  }

  private _emit(value: number, isDone: boolean): void {
    const rounded = roundTo(value, this._decimals);
    if (!isDone && Object.is(rounded, this._lastDisplay)) return;
    this._lastDisplay = rounded;
    this._cb(rounded, isDone);
  }

  get isActive(): boolean { return this._active; }
}

