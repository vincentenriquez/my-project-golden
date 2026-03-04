//GameController.ts
import { Container, Graphics, Text, Sprite, Rectangle, Texture } from "pixi.js";
import type { Reel } from "./Reel";
import { WinCountUp } from "./WinCountUp";
import type { SymbolCell } from "./SymbolCell";
import {
  TOTAL_SYMBOLS,
  WILD_SYMBOL_ID,
  SCATTER_SYMBOL_ID,
  TOTAL_WAYS,
  getWeightedRandomSymbol,
  getWeightedRandomSymbol_noWild,
  getAnimationFrames,
  PAYTABLE,
  SCATTER_PAYTABLE,
  FREE_SPINS_AWARDED,
} from "./symbols";

/** Options for result generation */
export interface GenerateOptions {
  forceMatrix?: number[][];
  forceSymbols?: Partial<Record<number, Partial<Record<number, number>>>>;
  weighted?: boolean;
}

/** One ways win result */
export interface WaysResult {
  symbol: number;
  hits: number;
  combos: number;
  payout: number;
}

/** Scatter win result */
export interface ScatterResult {
  symbol: number;
  count: number;
  payout: number;
}

/** Callback to register a tween (object, property, target, time, easing, onComplete) */
export type TweenToFn = (
  object: unknown,
  property: string,
  target: number,
  time: number,
  easing: (t: number) => number,
  onchange?: (t: unknown) => void,
  oncomplete?: (t: unknown) => void
) => void;

export interface GameControllerConfig {
  reelsCount: number;
  symbolsPerReel: number;
  reelWidth: number;
  symbolSize: number;
  minBet: number;
  maxBet: number;
  initialCredits: number;
  initialBet: number;
  autoSpinCount: number;
}

export interface GameControllerUI {
  creditsText: Text;
  resultText: Text;
  amountLabel: Text;
  autoSpinText: Text;
  freeSpinText: Text;
  totalWinText: Text;
  dimOverlay: Graphics;
  autoSpinButton: Sprite;
  stopAutoSpinButton: Sprite;
}

// Tracks each winning cell's original parent so we can restore it in clearHighlights
interface WinningCellEntry {
  cell:      SymbolCell;
  reelIndex: number;
  rowIndex:  number;
}

interface HighlightBox {
  sprite: Sprite;          // original sprite (hidden during win)
  clone: Sprite;           // clone rendered on highlightLayer above dimOverlay
  originalScale: number;
  originalAlpha: number;
}

/**
 * Describes one floating symbol clone used for the "fly-up" win animation.
 * The clone is a Sprite added to winFloatLayer, animated from the symbol's
 * world position up to the win-display row above the reel grid.
 */
interface FloatingWinSymbol {
  clone:       Sprite;
  /** Final target Y inside winFloatLayer's local space */
  targetY:     number;
  /** Animation progress [0, 1] */
  progress:    number;
  /** Total animation duration in ms */
  duration:    number;
  startTime:   number;
  /** Start world Y (converted to layer local on spawn) */
  startY:      number;
  startX:      number;
  phase:       "rising" | "holding" | "fading";
  holdEnd:     number;   // timestamp when hold ends
  done:        boolean;
}

/**
 * Game controller: credits, bet, spin flow, evaluation, and highlights.
 * Owns reels and orchestrates spin → result → evaluate → UI.
 */
export class GameController {
  readonly reels: Reel[];
  private readonly config: GameControllerConfig;
  private readonly ui: GameControllerUI;
  private readonly highlightLayer: Container;
  private readonly tweenTo: TweenToFn;
  private readonly winCounter: WinCountUp;

  /**
   * Separate WinCountUp instance that animates the Balance (creditsText)
   * from its current value up to the new value whenever a win is credited.
   *
   * Key difference from winCounter:
   *   • Starts from the PRE-WIN balance, not zero.
   *   • The callback writes `value.toFixed(2)` so the display always shows
   *     two decimal places matching the rest of the credit UI.
   *   • Cancelled immediately at the start of every spin (same as winCounter)
   *     so a fast player never sees a stale roll-up.
   */
  private readonly balanceCounter: WinCountUp;

  /** Tracks the "display start" for the balance count-up (before adding win). */
  private _balanceAtWinStart: number = 0;

  private backout: (amount: number) => (t: number) => number;
  private readonly bounceOut: (t: number) => number = (t) => t;

  /**
   * Dedicated layer for floating win-symbol clones.
   * Injected via the constructor so main.ts controls z-ordering.
   */
  private readonly winFloatLayer: Container;

  private pendingSliceGroups: number = 0;
  private pendingPayoutToShow: number | null = null;
  private pendingBonusText: string = "";
  private winDisplayFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Y coordinate (in gameContainer local space) that defines the TOP of the
   * reel grid.  Symbols float UP to (reelTopY - WIN_DISPLAY_OFFSET).
   * Set by main.ts immediately after construction via setReelBounds().
   */
  private reelTopY: number = 0;
  private reelLeftX: number = 0;

  private credits: number;
  private bet: number;
  private running = false;
  private freeSpinsRemaining = 0;
  private inFreeSpins = false;
  private autoSpinActive = false;
  private autoSpinsRemaining = 0;
  private highlightBoxes: HighlightBox[] = [];
  private winningEntries: WinningCellEntry[] = [];
  private winningCells: Set<SymbolCell> = new Set();
  private pulseTime = 0;
  private glowPhase: "pulsing" | "fading" | "done" = "done";
  private glowFadeStart = 0;
  /** Ensures we resolve win animations (cascade / continuation) only once per win. */
  private winAnimationsAlreadyResolved = false;

  /** Active floating clones for the current win */
  private floatingSymbols: FloatingWinSymbol[] = [];

  // ── Win display layout constants ──────────────────────────────────────────
  /** Vertical offset ABOVE the reel-grid top where symbols land */
  private static readonly WIN_DISPLAY_OFFSET = 10;
  /** Rise animation duration (ms) */
  private static readonly RISE_DURATION = 420;
  /** Hold duration at the top (ms) — symbols rest here before fading */
  private static readonly HOLD_DURATION = 900;
  /** Fade-out duration (ms) */
  private static readonly FADE_DURATION = 320;
  /** How long the glow pulses before fading (ms) */
  private static readonly GLOW_SHOW_DURATION = 1000;
  /** Duration of the glow fade-out (ms) */
  private static readonly GLOW_FADE_DURATION = 280;
  /** Delay after win display before cascade starts (ms) */
  private static readonly CASCADE_WIN_DELAY = 0;

  constructor(
    reels: Reel[],
    config: GameControllerConfig,
    ui: GameControllerUI,
    highlightLayer: Container,
    winFloatLayer: Container,
    tweenTo: TweenToFn,
    backoutEasing: (amount: number) => (t: number) => number,
    bounceOutEasing: (t: number) => number
  ) {
    this.reels = reels;
    this.config = config;
    this.ui = ui;
    this.highlightLayer = highlightLayer;
    this.winFloatLayer  = winFloatLayer;
    this.tweenTo = tweenTo;
    this.backout = backoutEasing;

    this.credits = config.initialCredits;
    this.bet = config.initialBet;
    this.ui.creditsText.text = this.credits.toFixed(2);
    this.ui.amountLabel.text = this.bet.toFixed(2);
    this.ui.totalWinText.text = "0.00";
    this.ui.dimOverlay.visible = false;
    this.bounceOut = bounceOutEasing;

    // ── Total Win count-up ────────────────────────────────────────────────
    // Drives the "WIN: x.xx" result text (center). totalWinText is set directly in _showWinAmount.
    this.winCounter = new WinCountUp((displayValue, isDone) => {
      const formatted = displayValue.toFixed(2);
      if (this.ui.resultText.text.startsWith("WIN: ")) {
        const hasBonus = this.ui.resultText.text.includes("|");
        const suffix   = hasBonus
          ? " | " + this.ui.resultText.text.split("|")[1].trim()
          : "";
        this.ui.resultText.text = `WIN: ${formatted}${suffix}`;
      }
    });

    // ── Balance count-up ──────────────────────────────────────────────────
    // Animates creditsText from the pre-win balance to the post-win balance.
    // The WinCountUp callback receives values in the range [0 … target] where
    // target = the WIN AMOUNT (not the final balance). We add _balanceAtWinStart
    // inside the callback to reconstruct the rolling balance.
    this.balanceCounter = new WinCountUp((displayValue, isDone) => {
      // displayValue counts 0 → totalPayout; we offset by the pre-win balance
      const rollingBalance = this._balanceAtWinStart + displayValue;
      this.ui.creditsText.text = rollingBalance.toFixed(2);
    });
  }

  /**
   * Call once from main.ts after the reel mask / reelContainer is positioned.
   * @param reelTopY   The Y position of the TOP EDGE of the reel grid in gameContainer coords.
   * @param reelLeftX  The X position of the LEFT EDGE of the reel grid in gameContainer coords.
   */
  setReelBounds(reelTopY: number, reelLeftX: number): void {
    this.reelTopY  = reelTopY;
    this.reelLeftX = reelLeftX;
  }

  getCredits(): number { return this.credits; }
  getBet(): number { return this.bet; }
  getRunning(): boolean { return this.running; }
  getInFreeSpins(): boolean { return this.inFreeSpins; }
  getAutoSpinActive(): boolean { return this.autoSpinActive; }
  getAutoSpinsRemaining(): number { return this.autoSpinsRemaining; }

  canSpin(): boolean { return !this.running && !this.autoSpinActive; }
  canStartAutoSpin(): boolean { return !this.running && !this.autoSpinActive && !this.inFreeSpins; }

  setBet(amount: number): void {
    this.bet = Math.max(this.config.minBet, Math.min(this.config.maxBet, amount));
  }

  deductBet(): void {
    if (!this.inFreeSpins) {
      const from = this.credits;
      this.credits -= this.bet;
      // Update instantly on deduct — no animation, keeps it snappy
      this.ui.creditsText.text = this.credits.toFixed(2);
    }
  }

  /**
   * addCredits — stores the new balance internally but does NOT write to the
   * UI immediately. The balance count-up animation (started in
   * evaluateAndShowResults) will drive creditsText from the old value up to
   * the new value over time.
   *
   * Falls back to instant display if called outside of a win context
   * (e.g., bonus / edge-case paths that bypass evaluateAndShowResults).
   */
  addCredits(amount: number): void {
    this.credits += amount;
    // Do NOT update creditsText here — balanceCounter handles it.
    // The final exact value is snapped in the balanceCounter callback when
    // isDone === true via the count-up reaching its target.
  }

  hasEnoughCredits(): boolean { return this.credits >= this.bet; }
  updateBetDisplay(): void { this.ui.amountLabel.text = this.bet.toFixed(2); }

  /** Generate a result matrix (per-reel columns). */
  generateResult(options?: GenerateOptions): number[][] {
    const { reelsCount, symbolsPerReel } = this.config;

    if (options?.forceMatrix) return options.forceMatrix;

    const WILD_ALLOWED_REELS = new Set([1, 2, 3]); // Only allow wilds on the first 3 reels for better balance

    const matrixPerReel: number[][] = [];
    for (let reelIndex = 0; reelIndex < reelsCount; reelIndex++) {
      const column: number[] = [];
      for (let row = 0; row < symbolsPerReel; row++) {
        let symbolId: number;
        if (
          options?.forceSymbols &&
          options.forceSymbols[reelIndex] &&
          options.forceSymbols[reelIndex]![row] !== undefined
        ) {
          symbolId = options.forceSymbols[reelIndex]![row]!;
        } else {
          symbolId = options?.weighted
            ? getWeightedRandomSymbol()
            : Math.floor(Math.random() * TOTAL_SYMBOLS);
        }
        if (symbolId === WILD_SYMBOL_ID && !WILD_ALLOWED_REELS.has(reelIndex)) {
          symbolId = getWeightedRandomSymbol_noWild();
        }
        column.push(symbolId);
      }
      matrixPerReel.push(column);
    }
    return matrixPerReel;
  }

  /** Animate reels to land on the given result matrix, then evaluate. */
  spinToResult(resultPerReel: number[][]): void {
    const { reelsCount, symbolsPerReel } = this.config;

    // Cancel both counters at the start of every spin to prevent any
    // stale animation from a previous win overwriting fresh "0.00" displays.
    this.winCounter.cancel();
    this.balanceCounter.cancel();

    this.ui.totalWinText.text = "0.00";
    if (this.running) return;
    this.running = true;
    this.clearHighlights();

    this.reels.forEach((r) => r.clearVisualOverrides());

    if (!Array.isArray(resultPerReel) || resultPerReel.length !== reelsCount) {
      this.running = false;
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
      // Ensure the reel always stops on an exact symbol boundary (integer position)
      // so that exactly three symbols are fully visible when the spin ends.
      const target = base - spins * len - delta;
      const time = 1150 + i * 360 + Math.floor(Math.random() * 100);

      this.tweenTo(
        reel,
        "position",
        target,
        time,
        // Strictly downward spin with no bounce / rebound:
        // use a simple linear easing for the reel motion itself.
        (t: number) => t,
        undefined,
        () => {
          // Per‑reel settle bounce: each reel squashes when *it* stops,
          // using its own timing, independent of other reels.
          this._playSettleBounceOnReel(reel);

          completed++;
          if (completed === reelsCount) {
            this.running = false;
            this.reels.forEach((r) => (r.position = Math.floor(r.position)));
            this.updateReelsVisuals();
            const visible = this.getVisibleMatrix();
            this.evaluateAndShowResults(visible);
          }
        }
      );
    }
  }

  /**
   * Subtle squash-and-stretch for a single reel's visible symbols when that
   * reel settles. Each reel calls this independently in its own tween
   * completion callback so timing stays per‑reel.
   */
  private _playSettleBounceOnReel(reel: Reel): void {
    const rows = this.config.symbolsPerReel;
    const bottomRowIndex = rows - 1;
    const squashY = 0.96;
    const durationDown = 110;
    const durationUp = 230;

    const cell = reel.getContainerAt(bottomRowIndex);
    if (!cell) return;

    // start from neutral scale
    cell.scale.set(1, 1);

    // first, a quick squash on Y only (no X stretch)
    this.tweenTo(
      cell.scale,
      "y",
      squashY,
      durationDown,
      (t) => t,
      undefined,
      () => {
        // then ease back towards 1 with a soft bounce, only on the bottom symbol
        this.tweenTo(
          cell.scale,
          "y",
          1,
          durationUp,
          (t) => this.bounceOut(t),
          undefined
        );
      }
    );
  }

  getVisibleMatrix(): number[][] {
    const { symbolsPerReel } = this.config;
    const matrix: number[][] = Array.from({ length: symbolsPerReel }, () => []);
    this.reels.forEach((r, reelIndex) => {
      const visible = r.getVisibleSymbols();
      visible.forEach((sym, row) => {
        matrix[row][reelIndex] = sym;
      });
    });
    return matrix;
  }

  updateReelsVisuals(): void { this.reels.forEach((r) => r.updateSprites()); }

  /**
   * Main animation ticker — drives glow pulses (with fade phase),
   * float-up win animation, the Total Win count-up, AND the Balance count-up.
   */
  updateHighlightAnimation(deltaTime: number, deltaMS: number = 16.67): void {
    if (this.glowPhase === "fading") {
      const elapsed = Date.now() - this.glowFadeStart;
      const t = Math.min(1, elapsed / GameController.GLOW_FADE_DURATION);
      const fadeAlpha = 1 - t;
      this.winningCells.forEach((cell) => cell.showGlow(fadeAlpha, 0));
      if (t >= 1) {
        this.glowPhase = "done";
        this.winningCells.forEach((cell) => {
          cell.hideGlow();
          cell.detachRaysFromExternalLayer();
        });
        this._spawnFloatingWinSymbols();
      }
    } else if (this.glowPhase === "pulsing" && this.winningCells.size > 0) {
      this.pulseTime += deltaTime * 0.05;
      const ringAlpha = 0.75 + Math.sin(this.pulseTime) * 0.25;
      this.winningCells.forEach((cell) => cell.showGlow(ringAlpha, deltaTime));
    }

    this.winCounter.update(deltaMS);
    this.balanceCounter.update(deltaMS);
    this._updateFloatingSymbols();
  }

  private _onSliceGroupComplete(): void {
    if (this.pendingSliceGroups > 0) this.pendingSliceGroups--;
    // When the last slice group finishes, resolve the rest of the win flow
    // (cascade symbols or continue the spin) exactly once.
    if (this.pendingSliceGroups === 0) {
      this._onAllWinAnimationsComplete();
    }
  }

  /**
   * Final step after all win symbol animations (rise + slice) are done.
   * Either starts the cascade (for standard wins) or directly resolves spin continuation.
   */
  private _onAllWinAnimationsComplete(): void {
    if (this.winAnimationsAlreadyResolved) return;
    this.winAnimationsAlreadyResolved = true;

    // If there are winning entries, we still need to cascade them out.
    if (this.winningEntries.length > 0) {
      setTimeout(() => {
        // It's possible the win was cleared mid-way; in that case just continue the spin.
        if (this.winningEntries.length === 0) {
          this._resolveSpinContinuation();
          return;
        }
        this._cascadeSymbols();
      }, GameController.CASCADE_WIN_DELAY);
    } else {
      // No cascade needed (e.g. fallback / edge-case paths) — just continue the spin.
      this._resolveSpinContinuation();
    }
  }

  /** Animate and reveal the Win: [amount] UI. */
  private _showWinAmount(amount: number): void {
    if (this.winDisplayFallbackTimer !== null) {
      clearTimeout(this.winDisplayFallbackTimer);
      this.winDisplayFallbackTimer = null;
    }

    // TOTAL WIN (right panel): show amount immediately so it always displays
    this.ui.totalWinText.text = amount.toFixed(2);
    this.ui.totalWinText.alpha = 1;
    this.ui.totalWinText.visible = true;

    this.ui.resultText.text = `WIN: 0.00${this.pendingBonusText}`;
    console.log("pendingBonusText: " + this.pendingBonusText);
    this.ui.resultText.alpha = 0;
    this.ui.resultText.scale.set(0.65, 0.65);
    this.ui.resultText.visible = true;

    this.winCounter.start(amount);
    this.balanceCounter.start(amount);

    this.tweenTo(
      this.ui.resultText.scale,
      "x",
      1,
      450,
      this.backout(1.4),
      () => { this.ui.resultText.scale.y = this.ui.resultText.scale.x; }
    );
    this.tweenTo(
      this.ui.resultText,
      "alpha",
      1,
      320,
      (t) => 1 - Math.pow(1 - t, 2) // easeOutQuad for smoother fade-in
    );
  }

    /**
   * Slice an intact clone sprite into 4 quadrant pieces at its current position,
   * animate pieces outward / rotate / fade, then cleanup.
   */
  private _sliceCloneIntoQuadrants(clone: Sprite, entry: WinningCellEntry): void {
    if (clone.parent) {
      this.winFloatLayer.removeChild(clone);
    }
    const texture = clone.texture;
    const texW = texture.width;
    const texH = texture.height;

    const dispW = texW * clone.scale.x;
    const dispH = texH * clone.scale.y;

    const SLICE_COLS = 5;
    const SLICE_ROWS = 5;
    const SLICE_COUNT = SLICE_COLS * SLICE_ROWS; // 10 slices

    const sliceW = Math.floor(texW / SLICE_COLS);
    const sliceH = Math.floor(texH / SLICE_ROWS);

    const frame = texture.frame ?? { x: 0, y: 0 };
    const fx = typeof frame.x === "number" ? frame.x : 0;
    const fy = typeof frame.y === "number" ? frame.y : 0;

    const rects: Rectangle[] = [];
    const offsets: { dx: number; dy: number }[] = [];

    for (let row = 0; row < SLICE_ROWS; row++) {
      for (let col = 0; col < SLICE_COLS; col++) {
        const isLastCol = col === SLICE_COLS - 1;
        const isLastRow = row === SLICE_ROWS - 1;
        const w = isLastCol ? texW - sliceW * (SLICE_COLS - 1) : sliceW;
        const h = isLastRow ? texH - sliceH * (SLICE_ROWS - 1) : sliceH;
        rects.push(new Rectangle(fx + col * sliceW, fy + row * sliceH, w, h));

        // Offset each piece from clone center so they spread from their original position
        const centerCol = (SLICE_COLS - 1) / 2;
        const centerRow = (SLICE_ROWS - 1) / 2;
        offsets.push({
          dx: (col - centerCol) * (dispW / SLICE_COLS),
          dy: (row - centerRow) * (dispH / SLICE_ROWS),
        });
      }
    }

    const pieces: Sprite[] = [];
    const source = (texture as { source?: unknown }).source ?? (texture as { baseTexture?: unknown }).baseTexture;

    try {
      for (let i = 0; i < SLICE_COUNT; i++) {
        const tex = source
          ? new Texture({ source, frame: rects[i] } as ConstructorParameters<typeof Texture>[0])
          : new Texture(texture);
        const piece = new Sprite(tex);
        piece.anchor.set(0.5);
        piece.x = clone.x + offsets[i].dx;
        piece.y = clone.y + offsets[i].dy;
        piece.scale.set(clone.scale.x, clone.scale.y);
        this.winFloatLayer.addChild(piece);
        pieces.push(piece);
      }
    } catch (_e) {
      clone.destroy();
      this._onSliceGroupComplete();
      return;
    }

    clone.destroy();

    let piecesCompleted = 0;
    const pieceAnimTime = 520;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const dirX = offsets[i].dx !== 0 ? Math.sign(offsets[i].dx) : (Math.random() > 0.5 ? 1 : -1);
      const dirY = offsets[i].dy !== 0 ? Math.sign(offsets[i].dy) : (Math.random() > 0.5 ? 1 : -1);

      const targetX = p.x + dirX * (dispW * 0.45 + Math.random() * 18);
      const targetY = p.y + dirY * (dispH * 0.35 + Math.random() * 18);
      const targetRotation = (Math.random() * 0.6 - 0.3) * Math.PI;

      this.tweenTo(p, "x", targetX, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(p, "y", targetY, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(p, "rotation", targetRotation, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(
        p,
        "alpha",
        0,
        pieceAnimTime,
        this._easeOutCubic,
        undefined,
        () => {
          if (p.parent) p.parent.removeChild(p);
          p.destroy({ texture: true, textureSource: false });
          piecesCompleted++;
          if (piecesCompleted === pieces.length) {
            this._onSliceGroupComplete();
          }
        }
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Float-up animation helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Spawn floating clones for every winning cell.
   * One clone per unique (reelIndex, rowIndex) winning position.
   */
  private _spawnFloatingWinSymbols(): void {
    if (this.winningEntries.length === 0) {
      // No symbols to animate — just resolve the rest of the win flow.
      this._onAllWinAnimationsComplete();
      return;
    }

    const { symbolSize } = this.config;

    // Deduplicate: one clone per (reelIndex, rowIndex) pair
    const seen = new Set<string>();

    // We'll animate each winning entry and then slice each clone.
    const spawned: { entry: WinningCellEntry; clone: Sprite }[] = [];

    for (const entry of this.winningEntries) {
      const key = `${entry.reelIndex}_${entry.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cell = entry.cell;
      const reel = this.reels[entry.reelIndex];

      // Mark the cell suspended so the reel won't overwrite it,
      // and clear the original position immediately (no twins)
      reel.suspendCell(cell);
      cell.alpha = 0;

      // world position of the cell's sprite (center)
      const globalPos = cell.sprite.getGlobalPosition();
      const layerLocal = this.winFloatLayer.toLocal(globalPos);
      const startX = layerLocal.x;
      const startY = layerLocal.y;

      // target Y (exactly where you specified)
      const targetY = startY - this.config.symbolSize * 0.9;

      // Clone the visible sprite (we only need the texture)
      const cloneTexture = cell.sprite.visible
        ? cell.sprite.texture
        : (cell as any)._animatedSprite?.texture ?? cell.sprite.texture;
      const clone = new Sprite(cloneTexture);
      clone.anchor.set(0.5);
      clone.x = startX;
      clone.y = startY;
      // keep same visual scale as source sprite
      clone.scale.set(cell.sprite.scale.x, cell.sprite.scale.y);
      clone.alpha = 1;
      this.winFloatLayer.addChild(clone);

      spawned.push({ entry, clone });

      // animate the clone to targetY — when it arrives, slice it
      this.tweenTo(
        clone,
        "y",
        targetY,
        GameController.RISE_DURATION,
        (t) => this._easeOutCubic(t),
        undefined,
        () => {
          // At the exact time the clone reaches targetY, slice it
          this._sliceCloneIntoQuadrants(clone, entry);
        }
      );
    }

    // track how many slice groups we expect — used to show win after all done
    this.pendingSliceGroups = spawned.length;

    // Fallback: if slice completion callbacks never fire, still resolve the win flow
    // (cascade / continuation) after the maximum expected animation time.
    const pieceAnimTime = 520;
    const maxWait = GameController.RISE_DURATION + pieceAnimTime + 400;
    this.winDisplayFallbackTimer = setTimeout(() => {
      this.winDisplayFallbackTimer = null;
      this._onAllWinAnimationsComplete();
    }, maxWait);
  }

  private _gameYToLayerY(gameY: number): number {
    return gameY;
  }

  private _easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private _updateFloatingSymbols(): void {
    if (this.floatingSymbols.length === 0) return;

    const now = Date.now();
    let anyActive = false;

    for (const fs of this.floatingSymbols) {
      if (fs.done) continue;
      anyActive = true;

      switch (fs.phase) {
        case "rising": {
          const elapsed = now - fs.startTime;
          const t = Math.min(1, elapsed / fs.duration);
          const eased = this._easeOutCubic(t);
          fs.clone.y = fs.startY + (fs.targetY - fs.startY) * eased;
          fs.clone.alpha = 0.85 + 0.15 * eased;

          if (t >= 1) {
            fs.phase   = "holding";
            fs.holdEnd = now + GameController.HOLD_DURATION;
          }
          break;
        }
        case "holding": {
          fs.clone.y     = fs.targetY;
          fs.clone.alpha = 1.0;
          if (now >= fs.holdEnd) {
            fs.phase     = "fading";
            fs.startTime = now;
          }
          break;
        }
        case "fading": {
          const elapsed = now - fs.startTime;
          const t = Math.min(1, elapsed / GameController.FADE_DURATION);
          fs.clone.alpha = 1 - t;
          fs.clone.y = fs.targetY - t * 18;
          if (t >= 1) {
            fs.done = true;
            this.winFloatLayer.removeChild(fs.clone);
            fs.clone.destroy();
          }
          break;
        }
      }
    }

    if (!anyActive) {
      this.floatingSymbols = [];
    }
  }

  private _clearFloatingSymbols(): void {
    for (const fs of this.floatingSymbols) {
      if (!fs.done) {
        this.winFloatLayer.removeChild(fs.clone);
        fs.clone.destroy();
      }
    }
    this.floatingSymbols = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Win marking
  // ─────────────────────────────────────────────────────────────────────────

  private _markCellAt(reelIndex: number, rowIndex: number): void {
    const cell = this.reels[reelIndex].getContainerAt(rowIndex);
    if (!cell || this.winningCells.has(cell)) return;
    this.winningEntries.push({ cell, reelIndex, rowIndex });
    this.winningCells.add(cell);
    cell.attachRaysToExternalLayer(this.highlightLayer);
    cell.showGlow(1.0, 0);
  }

  /**
   * 243-Ways evaluation (left-to-right, all symbols independently).
   */
  private evaluateWays(matrix: number[][], betAmount: number): WaysResult[] {
    const { reelsCount, symbolsPerReel } = this.config;
    const results: WaysResult[] = [];

    for (let symbol = 0; symbol < TOTAL_SYMBOLS; symbol++) {
      if (symbol === SCATTER_SYMBOL_ID) continue;
      if (symbol === WILD_SYMBOL_ID) continue;

      let consecutiveReels = 0;
      let combos = 1;

      for (let reel = 0; reel < reelsCount; reel++) {
        let matchesOnThisReel = 0;
        for (let row = 0; row < symbolsPerReel; row++) {
          const cell = matrix[row][reel];
          if (cell === symbol || cell === WILD_SYMBOL_ID) matchesOnThisReel++;
        }
        if (matchesOnThisReel === 0) break;
        consecutiveReels++;
        combos *= matchesOnThisReel;
      }

      if (consecutiveReels >= 3) {
        const payoutMultiplier = (PAYTABLE[symbol]?.[consecutiveReels]) ?? 0;
        const payout = combos * payoutMultiplier * betAmount;
        if (payout > 0) {
          results.push({ symbol, hits: consecutiveReels, combos, payout });
        }
      }
    }
    return results;
  }

  private evaluateScatters(matrix: number[][], betAmount: number): ScatterResult | null {
    const { reelsCount, symbolsPerReel } = this.config;
    let count = 0;
    for (let r = 0; r < reelsCount; r++) {
      for (let row = 0; row < symbolsPerReel; row++) {
        if (matrix[row]?.[r] === SCATTER_SYMBOL_ID) count++;
      }
    }
    const multiplier = SCATTER_PAYTABLE[count] ?? 0;
    const payout = multiplier * betAmount;
    if (payout > 0) return { symbol: SCATTER_SYMBOL_ID, count, payout };
    return null;
  }

  private applyExpandingWilds(matrix: number[][]): number[][] {
    return matrix.map((row) => [...row]);
  }

  clearHighlights(): void {
    this.glowPhase = "done";
    this.winAnimationsAlreadyResolved = false;
    this._clearFloatingSymbols();

    // Remove any in-flight clone / piece sprites from the float layer
    while (this.winFloatLayer.children.length > 0) {
      const child = this.winFloatLayer.children[0];
      this.winFloatLayer.removeChild(child);
      child.destroy();
    }

    // Reset pending slice / payout state so stale callbacks are ignored
    this.pendingSliceGroups   = 0;
    this.pendingPayoutToShow  = null;
    this.pendingBonusText     = "";
    if (this.winDisplayFallbackTimer !== null) {
      clearTimeout(this.winDisplayFallbackTimer);
      this.winDisplayFallbackTimer = null;
    }

    // Restore all suspended cells so reels update them normally again
    this.reels.forEach((reel) => {
      reel.clearAllSuspensions();
      reel.symbolCells.forEach((cell) => {
        cell.alpha = 1;
      });
    });

    this.winningCells.forEach((cell) => {
      cell.detachRaysFromExternalLayer();
      cell.hideGlow();
    });

    this.winningEntries        = [];
    this.winningCells.clear();
    this.pulseTime             = 0;
    this.ui.dimOverlay.visible = false;
  }

  private evaluateAndShowResults(matrix: number[][]): void {
    const { reelsCount, symbolsPerReel } = this.config;
    this.clearHighlights();

    // STEP 1: Evaluate scatters on ORIGINAL matrix
    const scatterResult = this.evaluateScatters(matrix, this.bet);

    // STEP 2: Expand wilds
    const expandedMatrix = this.applyExpandingWilds(matrix);

    // STEP 2b: Visually update reel sprites for expanded positions
    // this.reels.forEach((r) => r.clearVisualOverrides());
    // for (let reel = 0; reel < reelsCount; reel++) {
    //   for (let row = 0; row < symbolsPerReel; row++) {
    //     if (expandedMatrix[row][reel] !== matrix[row][reel]) {
    //       this.reels[reel].setVisualOverride(row, expandedMatrix[row][reel]);
    //     }
    //   }
    // }
    // this.updateReelsVisuals();

    // STEP 3: Evaluate 243-ways on EXPANDED matrix
    const waysResults = this.evaluateWays(expandedMatrix, this.bet);

    // STEP 4: Register expanding-wild sprites for highlight
    // for (let reel = 0; reel < reelsCount; reel++) {
    //   let hasWild = false;
    //   for (let row = 0; row < symbolsPerReel; row++) {
    //     if (expandedMatrix[row][reel] === WILD_SYMBOL_ID) { hasWild = true; break; }
    //   }
    //   if (hasWild) {
    //     for (let row = 0; row < symbolsPerReel; row++) {
    //       this._markCellAt(reel, row);
    //     }
    //   }
    // }

    // STEP 5: Sum all ways wins + register winning symbol sprites.
    // Wild cells in a winning chain resolve visually to the highest-paying
    // base symbol they substitute for (one override per cell position).
    let totalPayout = 0;
    const wildOverrides = new Map<string, { symbol: number; payout: number }>();
    waysResults.forEach((win) => {
      totalPayout += win.payout;
      for (let r = 0; r < win.hits; r++) {
        for (let row = 0; row < symbolsPerReel; row++) {
          const cell = expandedMatrix[row][r];
          if (cell === win.symbol || cell === WILD_SYMBOL_ID) {
            this._markCellAt(r, row);
            // if (cell === WILD_SYMBOL_ID) {
            //   const key = `${r}_${row}`;
            //   const prev = wildOverrides.get(key);
            //   if (!prev || win.payout > prev.payout) {
            //     wildOverrides.set(key, { symbol: win.symbol, payout: win.payout });
            //   }
            // }
          }
        }
      }
    });

    // for (const [key, { symbol: resolvedSym }] of wildOverrides) {
    //   const [ri, ro] = key.split("_");
    //   this.reels[parseInt(ri)].setVisualOverride(parseInt(ro), resolvedSym);
    // }
    // if (wildOverrides.size > 0) this.updateReelsVisuals();

    // STEP 6: Scatter payout + free spins trigger
    let spinsWonThisSpin = 0;
    if (scatterResult) {
      totalPayout += scatterResult.payout;
      for (let r = 0; r < reelsCount; r++) {
        for (let row = 0; row < symbolsPerReel; row++) {
          if (matrix[row][r] === SCATTER_SYMBOL_ID) {
            this._markCellAt(r, row);
          }
          if (this.winningCells.size > 0) {
            this.reels.forEach((reel) => {
              reel.symbolCells.forEach((cell) => {
                if (!this.winningCells.has(cell)) {
                  cell.alpha = 0.25;
                }
              });
            });
          }
        }
      }
      const spinsWon = FREE_SPINS_AWARDED[scatterResult.count] ?? 0;
      if (spinsWon > 0) {
        spinsWonThisSpin = spinsWon;
        if (this.autoSpinActive) {
          this.autoSpinActive = false;
          this.ui.autoSpinButton.visible = true;
          this.ui.stopAutoSpinButton.visible = false;
          this.ui.autoSpinText.text = "AUTO SPINS: 0";
        }
        this.ui.freeSpinText.text = `FREE SPINS LEFT: ${spinsWon}`;
        this.ui.freeSpinText.visible = true;
        this.freeSpinsRemaining += spinsWon;
        this.inFreeSpins = true;
      }
    }

    // STEP 7: Show/hide dimOverlay based on whether there are winning symbols
    this.ui.dimOverlay.visible = this.winningCells.size > 0;

    // STEP 8: Credit update (counters deferred until slice animation completes)
    if (totalPayout > 0) {
      this._balanceAtWinStart = this.credits;
      this.addCredits(totalPayout);

      this.pendingPayoutToShow = totalPayout;
      this.pendingBonusText = spinsWonThisSpin > 0
        ? ` | BONUS! ${spinsWonThisSpin} Free Spins!`
        : "";

      this.ui.resultText.text = "";
      this.ui.totalWinText.text = "0.00";

      // Show WIN text and start counters immediately when a win is detected,
      // before any winning-symbol upward movement begins.
      if (this.pendingPayoutToShow !== null) {
        const amount = this.pendingPayoutToShow;
        this.pendingPayoutToShow = null;
        this._showWinAmount(amount);
      }
    }

    // STEP 9: Result text (win text deferred to _showWinAmount after slicing)
    if (totalPayout > 0) {
      // handled by _showWinAmount after slice animation completes
    } else if (spinsWonThisSpin > 0) {
      this.ui.resultText.text   = `BONUS! ${spinsWonThisSpin} Free Spins!`;
      this.ui.totalWinText.text = "0.00";
      this.winCounter.cancel();
      this.balanceCounter.cancel();
    } else {
      this.ui.resultText.text   = "";
      this.ui.totalWinText.text = "0.00";
      this.winCounter.cancel();
      this.balanceCounter.cancel();
    }

    // STEP 10: Start phased win animation (glow → fade → rise → slice → win → cascade)
    if (this.winningCells.size > 0) {
      this.glowPhase = "pulsing";

      this.reels.forEach((reel) => {
        reel.symbolCells.forEach((cell) => {
          if (!this.winningCells.has(cell)) cell.alpha = 0.25;
        });
      });

      setTimeout(() => {
        if (this.glowPhase !== "pulsing") return;
        this.glowPhase = "fading";
        this.glowFadeStart = Date.now();
      }, GameController.GLOW_SHOW_DURATION);

      return;
    }

    this._resolveSpinContinuation();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Spin continuation (free spins / auto spins)
  // ─────────────────────────────────────────────────────────────────────────

  private _resolveSpinContinuation(): void {
    if (this.inFreeSpins) {
      if (this.freeSpinsRemaining > 0) {
        this.freeSpinsRemaining--;
        this.ui.freeSpinText.text = `Free spins: ${this.freeSpinsRemaining}`;
        setTimeout(() => {
          const result = this.generateResult({ weighted: true });
          this.spinToResult(result);
        }, 400);
      } else {
        this.inFreeSpins = false;
        this.ui.freeSpinText.visible = false;
        this.ui.resultText.text = "Bonus finished!";
        if (this.autoSpinsRemaining > 0) {
          this.endAutoSpin();
          this.ui.resultText.text = "Bonus finished! Auto spin stopped.";
        }
      }
      return;
    }

    if (this.autoSpinActive) {
      this.autoSpinsRemaining--;
      this.ui.autoSpinText.text = `AUTO SPINS: ${this.autoSpinsRemaining}`;
      if (this.autoSpinsRemaining <= 0) {
        this.endAutoSpin();
        return;
      }
      if (this.onAutoSpinContinue) this.onAutoSpinContinue();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cascade: remaining symbols drop to fill gaps left by removed winners
  // ─────────────────────────────────────────────────────────────────────────

  private _cascadeSymbols(): void {
    const { reelsCount, symbolsPerReel, symbolSize } = this.config;

    this.ui.dimOverlay.visible = false;

    const emptyMap = new Map<number, Set<number>>();
    const seen = new Set<string>();
    for (const entry of this.winningEntries) {
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
      if (doneTweens >= totalTweens) this._finishCascade();
    };

    for (let ri = 0; ri < reelsCount; ri++) {
      const empty = emptyMap.get(ri);
      if (!empty || empty.size === 0) {
        this.reels[ri].symbolCells.forEach((c) => { c.alpha = 1; });
        continue;
      }

      const reel = this.reels[ri];
      const currentSymbols = reel.getVisibleSymbols();

      const survivors: { sym: number; fromRow: number }[] = [];
      for (let row = 0; row < symbolsPerReel; row++) {
        if (!empty.has(row)) survivors.push({ sym: currentSymbols[row], fromRow: row });
      }

      const numEmpty = empty.size;
      const newSyms: number[] = [];
      for (let i = 0; i < numEmpty; i++) newSyms.push(getWeightedRandomSymbol());

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

        // ── Animate Wild/Scatter; static for everything else ──────────────────
        if (newSym === WILD_SYMBOL_ID || newSym === SCATTER_SYMBOL_ID) {
          cell.clearAnimated();                        // reset any stale anim first
          const frames = getAnimationFrames(newSym);
          if (frames.length > 0) {
            cell.setAnimated(frames);                  // ← plays the Wild/Scatter anim
          } else {
            const tex = reel.getTexture(newSym);
            if (tex) cell.setTexture(tex, newSym);     // fallback if sheet not loaded
          }
        } else {
          cell.clearAnimated();                        // stop any lingering Wild anim
          const tex = reel.getTexture(newSym);
          if (tex) cell.setTexture(tex, newSym);
        }

        cell.alpha = 1;
        cell.hideGlow();
        cell.detachRaysFromExternalLayer();

        let fromY: number;
        if (row < numEmpty) {
          fromY = -(numEmpty - row) * symbolSize;
        } else {
          fromY = survivors[row - numEmpty].fromRow * symbolSize;
        }

        const toY = row * symbolSize;

        if (Math.abs(fromY - toY) < 1) {
          cell.y = toY;
          reel.restoreCell(cell);
          continue;
        }

        cell.y = fromY;
        totalTweens++;

        this.tweenTo(
          cell, "y", toY,
          380 + row * 60 + ri * 40,
          this.bounceOut,
          undefined,
          () => {
            reel.restoreCell(cell);
            onDone();
          }
        );
      }
    }

    if (totalTweens === 0) this._finishCascade();
  }

  private _finishCascade(): void {
    this.reels.forEach((reel) => {
      reel.clearAllSuspensions();
      reel.clearVisualOverrides();
      reel.symbolCells.forEach((cell) => {
        cell.alpha = 1;
        cell.hideGlow();
        cell.detachRaysFromExternalLayer();
      });
    });

    this.winningEntries = [];
    this.winningCells.clear();
    this.pulseTime = 0;
    this.glowPhase = "done";
    this.ui.dimOverlay.visible = false;

    // After symbols have fallen and new ones have been drawn, re‑evaluate
    // the visible matrix to see if another win has been created by the cascade.
    const nextMatrix = this.getVisibleMatrix();
    this.evaluateAndShowResults(nextMatrix);
  }

  /** Set by main: called when a spin finishes and auto spin should run again. */
  onAutoSpinContinue: (() => void) | null = null;

  getShouldContinueAutoSpin(): boolean {
    return this.autoSpinActive && this.autoSpinsRemaining > 0;
  }

  startAutoSpin(count: number): void {
    this.autoSpinActive = true;
    this.autoSpinsRemaining = count;
    this.ui.autoSpinButton.visible = false;
    this.ui.stopAutoSpinButton.visible = true;
    this.ui.autoSpinText.text = `AUTO SPINS: ${this.autoSpinsRemaining}`;
    this.ui.autoSpinText.visible = true;
    this.ui.freeSpinText.visible = false;
  }

  cancelAutoSpin(): void {
    this.autoSpinActive = false;
    this.autoSpinsRemaining = 0;
    this.endAutoSpin();
  }

  endAutoSpin(): void {
    this.autoSpinActive = false;
    this.autoSpinsRemaining = 0;
    this.ui.autoSpinButton.visible = true;
    this.ui.stopAutoSpinButton.visible = false;
    this.ui.autoSpinText.visible = false;
  }

  runNextAutoSpin(): void {
    if (!this.autoSpinActive || this.autoSpinsRemaining <= 0) {
      this.endAutoSpin();
      return;
    }
    if (!this.hasEnoughCredits()) {
      this.ui.resultText.text = "Not enough credits!";
      this.endAutoSpin();
      return;
    }
    this.deductBet();
    const result = this.generateResult({ weighted: true });
    this.spinToResult(result);
  }
}