/**
 * WinCountUp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Smooth, time-based win count-up animator.
 *
 * Features:
 *   • Zero external dependencies — drives off the existing PIXI ticker.
 *   • Duration scales logarithmically with win size (small wins = snappy,
 *     jackpots = satisfying long roll).
 *   • Cubic ease-out — fast rush up, gentle deceleration at the end.
 *   • Calling start() while an animation is running cancels it first (no overlap).
 *   • No SetInterval / RAF — just a stateful object whose update() you call.
 *   • Math.floor every frame so the number always "counts up" to the exact target.
 *   • Frame-skip: callback only fires when the display integer changes, preventing
 *     redundant PIXI Text redraws.
 */

export type CountUpCallback = (
  /** Current display value — always an integer floored toward target */
  displayValue: number,
  /** true only on the very last frame — use to apply "win settled" styling */
  isDone: boolean,
) => void;

// ── Duration curve ────────────────────────────────────────────────────────────
//   win  ≤    50  →   600 ms
//   win  =   500  →  ~950 ms
//   win  =  5 000 → ~1 600 ms
//   win  ≥ 10 000 →  2 200 ms  (capped)
const MIN_DURATION_MS = 600;
const MAX_DURATION_MS = 2200;
const LOG_LOW         = Math.log10(50);
const LOG_HIGH        = Math.log10(10_000);

function durationForWin(amount: number): number {
  const t = Math.max(0, Math.min(1,
    (Math.log10(Math.max(1, amount)) - LOG_LOW) / (LOG_HIGH - LOG_LOW),
  ));
  return MIN_DURATION_MS + t * (MAX_DURATION_MS - MIN_DURATION_MS);
}

// ── Easing ────────────────────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─────────────────────────────────────────────────────────────────────────────

export class WinCountUp {
  private readonly _cb: CountUpCallback;

  private _target:      number  = 0;
  private _duration:    number  = 0;
  private _elapsed:     number  = 0;
  private _active:      boolean = false;
  /** Last integer we sent to the callback — avoids redundant Text redraws. */
  private _lastDisplay: number  = -1;

  constructor(callback: CountUpCallback) {
    this._cb = callback;
  }

  /**
   * Start counting from 0 → target.
   * Cancels any in-progress animation automatically.
   */
  start(target: number): void {
    this._active = false;           // cancel previous immediately

    if (target <= 0) {
      this._cb(0, true);
      return;
    }

    this._target      = target;
    this._duration    = durationForWin(target);
    this._elapsed     = 0;
    this._lastDisplay = -1;         // force first-frame render
    this._active      = true;

    this._cb(0, false);             // show "0" before first tick
  }

  /**
   * Stop without firing the completion callback.
   * Call this at the start of every new spin so a stale animation never
   * overwrites the freshly-reset "0.00" display.
   */
  cancel(): void {
    this._active      = false;
    this._elapsed     = 0;
    this._lastDisplay = -1;
  }

  /**
   * Advance the animation by deltaMS real milliseconds.
   *
   * Call from the existing PIXI ticker — no extra ticker needed:
   *   app.ticker.add((t) => winCounter.update(t.deltaMS));
   *
   * Safe to call when inactive (no-op).
   */
  update(deltaMS: number): void {
    if (!this._active) return;

    this._elapsed += deltaMS;

    const progress = Math.min(1, this._elapsed / this._duration);
    const eased    = easeOutCubic(progress);
    const display  = Math.floor(eased * this._target);

    // Skip unchanged frames to avoid hammering PIXI Text unnecessarily
    if (display === this._lastDisplay && progress < 1) return;
    this._lastDisplay = display;

    if (progress >= 1) {
      this._active = false;
      this._cb(this._target, true);   // snap to exact value on last frame
    } else {
      this._cb(display, false);
    }
  }

  get isActive(): boolean { return this._active; }
}