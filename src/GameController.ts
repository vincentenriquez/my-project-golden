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

  /**
   * Dedicated layer for floating win-symbol clones.
   * Injected via the constructor so main.ts controls z-ordering.
   */
  private readonly winFloatLayer: Container;

  private pendingSliceGroups: number = 0;
  private pendingPayoutToShow: number | null = null;

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

  constructor(
    reels: Reel[],
    config: GameControllerConfig,
    ui: GameControllerUI,
    highlightLayer: Container,
    winFloatLayer: Container,
    tweenTo: TweenToFn,
    backoutEasing: (amount: number) => (t: number) => number
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

    // ── Total Win count-up ────────────────────────────────────────────────
    // Drives the "WIN: x.xx" result text and totalWinText simultaneously.
    this.winCounter = new WinCountUp((displayValue, isDone) => {
      const formatted = displayValue.toFixed(2);
      this.ui.totalWinText.text = formatted;
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
      const delta = ((targetTopIndex - baseMod) + len) % len;
      const minSpins = 3;
      const spins = minSpins + i;
      const target = reel.position + spins * len + delta;
      const time = 1100 + i * 360 + Math.floor(Math.random() * 300);

      this.tweenTo(
        reel,
        "position",
        target,
        time,
        this.backout(0.6),
        undefined,
        () => {
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
   * Main animation ticker — drives glow pulses, float-up win animation,
   * the Total Win count-up, AND the Balance count-up.
   */
  updateHighlightAnimation(deltaTime: number, deltaMS: number = 16.67): void {
    // Glow pulse
    if (this.winningCells.size > 0) {
      this.pulseTime += deltaTime * 0.05;
      const ringAlpha = 0.75 + Math.sin(this.pulseTime) * 0.25;
      this.winningCells.forEach((cell) => {
        cell.showGlow(ringAlpha, deltaTime);
      });
    }

    // Both count-up animators share the same deltaMS tick.
    // WinCountUp.update() is a no-op when not active, so there is zero
    // overhead when nothing is animating.
    this.winCounter.update(deltaMS);
    this.balanceCounter.update(deltaMS);

    // Float-up animation
    this._updateFloatingSymbols();
  }

    private _onSliceGroupComplete(): void {
    if (this.pendingSliceGroups > 0) this.pendingSliceGroups--;
    // when last group finished, display the pending payout (if any)
    if (this.pendingSliceGroups === 0 && this.pendingPayoutToShow !== null) {
      const amount = this.pendingPayoutToShow;
      this.pendingPayoutToShow = null;
      this._showWinAmount(amount);
    }
  }

  /** Animate and reveal the Win: [amount] UI once slicing finished. */
  private _showWinAmount(amount: number): void {
    // Prepare text
    this.ui.resultText.text = `WIN: ${amount.toFixed(2)}`;
    this.ui.resultText.alpha = 0;
    this.ui.resultText.scale.set(0.65, 0.65);
    this.ui.resultText.visible = true;

    // pop + fade in using your tweenTo system
    // scale.x -> 1, scale.y mirrored via onchange
    this.tweenTo(
      this.ui.resultText.scale,
      "x",
      1,
      420,
      this.backout(1.7),
      (t) => { this.ui.resultText.scale.y = this.ui.resultText.scale.x; }
    );
    // alpha
    this.tweenTo(this.ui.resultText, "alpha", 1, 300, (t) => t);
    // optional: after fully visible, apply a gentle glow pulse (done in ticker by win highlights)
  }

    /**
   * Slice an intact clone sprite into 4 quadrant pieces at its current position,
   * animate pieces outward / rotate / fade, then cleanup.
   */
  private _sliceCloneIntoQuadrants(clone: Sprite, entry: WinningCellEntry): void {
    // remove the intact clone immediately (no intact symbol should remain)
    if (clone.parent) {
      this.winFloatLayer.removeChild(clone);
    }
    const texture = clone.texture;
    // Determine the original texture pixel size (use .orig which is stable)
    const texW = texture.orig?.width ?? texture.width;
    const texH = texture.orig?.height ?? texture.height;

    // screen display size after scale
    const dispW = texW * clone.scale.x;
    const dispH = texH * clone.scale.y;

    // Quadrant center offsets from the clone center (display-space)
    const offsets = [
      { dx: -dispW * 0.25, dy: -dispH * 0.25 }, // top-left
      { dx:  dispW * 0.25, dy: -dispH * 0.25 }, // top-right
      { dx: -dispW * 0.25, dy:  dispH * 0.25 }, // bottom-left
      { dx:  dispW * 0.25, dy:  dispH * 0.25 }, // bottom-right
    ];

    // Create four textures that crop the original into quadrants
    const base = texture.baseTexture;
    const halfW = Math.floor(texW / 2);
    const halfH = Math.floor(texH / 2);

    const rects = [
      new Rectangle(0,         0,         halfW, halfH), // TL
      new Rectangle(halfW,     0,         texW - halfW, halfH), // TR
      new Rectangle(0,         halfH,     halfW, texH - halfH), // BL
      new Rectangle(halfW,     halfH,     texW - halfW, texH - halfH), // BR
    ];

    const pieces: Sprite[] = [];

    for (let i = 0; i < 4; i++) {
      const tex = new Texture(base);
      const piece = new Sprite(tex);
      piece.anchor.set(0.5);
      // place at clone center plus quadrant offset
      piece.x = clone.x + offsets[i].dx;
      piece.y = clone.y + offsets[i].dy;
      // match scale so the pieces line-up visually
      piece.scale.set(clone.scale.x, clone.scale.y);
      this.winFloatLayer.addChild(piece);
      pieces.push(piece);
    }

    // Animate the 4 pieces outward + rotate + fade
    // We'll track piece completion and cleanup once all finished.
    let piecesCompleted = 0;
    const pieceAnimTime = 520; // ms
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      // outward displacement vector (based on offset's sign)
      const dirX = Math.sign(offsets[i].dx) || (i % 2 === 0 ? -1 : 1);
      const dirY = Math.sign(offsets[i].dy) || (i < 2 ? -1 : 1);

      const targetX = p.x + dirX * (dispW * 0.45 + Math.random() * 18);
      const targetY = p.y + dirY * (dispH * 0.35 + Math.random() * 18);
      const targetRotation = (Math.random() * 0.6 - 0.3) * (Math.PI); // rotate between -0.3π .. 0.3π
      const targetAlpha = 0;

      // animate x
      this.tweenTo(p, "x", targetX, pieceAnimTime, this._easeOutCubic);
      // animate y
      this.tweenTo(p, "y", targetY, pieceAnimTime, this._easeOutCubic);
      // animate rotation
      this.tweenTo(p, "rotation", targetRotation, pieceAnimTime, this._easeOutCubic);
      // animate alpha and call completion when alpha finishes
      this.tweenTo(
        p,
        "alpha",
        targetAlpha,
        pieceAnimTime,
        this._easeOutCubic,
        undefined,
        () => {
          // piece done
          if (p.parent) p.parent.removeChild(p);
          p.destroy({ texture: true, baseTexture: false });
          piecesCompleted++;
          if (piecesCompleted === pieces.length) {
            // restore the original reel cell now that the slice group finished
            const reel = this.reels[entry.reelIndex];
            const cell = entry.cell;
            reel.restoreCell(cell);
            // ensure the original cell is visible again (if you prefer blank leave it hidden)
            cell.alpha = 1;

            // Signal that one slice group finished
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
    if (this.winningEntries.length === 0) return;

    const { reelWidth, symbolSize } = this.config;
    const now = Date.now();

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
      const clone = new Sprite(cell.sprite.texture);
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

      let consecutiveReels = 0;
      let combos = 1;

      for (let reel = 0; reel < reelsCount; reel++) {
        let matchesOnThisReel = 0;
        for (let row = 0; row < symbolsPerReel; row++) {
          const cell = matrix[row][reel];
          if (symbol === WILD_SYMBOL_ID) {
            if (cell === WILD_SYMBOL_ID) matchesOnThisReel++;
          } else {
            if (cell === symbol || cell === WILD_SYMBOL_ID) matchesOnThisReel++;
          }
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
    const expanded = matrix.map((row) => [...row]);
    for (let reel = 0; reel < this.config.reelsCount; reel++) {
      let hasWild = false;
      for (let row = 0; row < matrix.length; row++) {
        if (matrix[row][reel] === WILD_SYMBOL_ID) { hasWild = true; break; }
      }
      if (hasWild) {
        for (let row = 0; row < matrix.length; row++) {
          if (expanded[row][reel] !== SCATTER_SYMBOL_ID) {
            expanded[row][reel] = WILD_SYMBOL_ID;
          }
        }
      }
    }
    return expanded;
  }

  clearHighlights(): void {
    this._clearFloatingSymbols();

    this.reels.forEach((reel) => {
      reel.symbolCells.forEach((cell) => {
        cell.alpha = 1;
      });
    });

    this.winningCells.forEach((cell) => cell.hideGlow());

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
    this.reels.forEach((r) => r.clearVisualOverrides());
    for (let reel = 0; reel < reelsCount; reel++) {
      for (let row = 0; row < symbolsPerReel; row++) {
        if (expandedMatrix[row][reel] !== matrix[row][reel]) {
          this.reels[reel].setVisualOverride(row, expandedMatrix[row][reel]);
        }
      }
    }
    this.updateReelsVisuals();

    // STEP 3: Evaluate 243-ways on EXPANDED matrix
    const waysResults = this.evaluateWays(expandedMatrix, this.bet);

    // STEP 4: Register expanding-wild sprites for highlight
    for (let reel = 0; reel < reelsCount; reel++) {
      let hasWild = false;
      for (let row = 0; row < symbolsPerReel; row++) {
        if (expandedMatrix[row][reel] === WILD_SYMBOL_ID) { hasWild = true; break; }
      }
      if (hasWild) {
        for (let row = 0; row < symbolsPerReel; row++) {
          this._markCellAt(reel, row);
        }
      }
    }

    // STEP 5: Sum all ways wins + register winning symbol sprites
    let totalPayout = 0;
    waysResults.forEach((win) => {
      totalPayout += win.payout;
      for (let r = 0; r < win.hits; r++) {
        for (let row = 0; row < symbolsPerReel; row++) {
          const cell = expandedMatrix[row][r];
          if (cell === win.symbol || cell === WILD_SYMBOL_ID) {
            this._markCellAt(r, row);
          }
        }
      }
    });

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

    // STEP 8: Credit update + animated displays
    if (totalPayout > 0) {
      // Snapshot the balance BEFORE adding the win — this is the count-up start.
      this._balanceAtWinStart = this.credits;

      // addCredits() updates this.credits internally but does NOT touch the UI.
      this.addCredits(totalPayout);

      // totalWinText + resultText: count up from 0 → totalPayout
      this.winCounter.start(totalPayout);

      // creditsText: count up from pre-win balance → post-win balance.
      this.balanceCounter.start(totalPayout);

      // Defer showing the final rewarded "WIN: amount" until after slicing.
      // Save payout; when pending slice groups reach 0 we will reveal it.
      this.pendingPayoutToShow = totalPayout;

      // Set a placeholder so UI doesn't show the wrong final number
      this.ui.resultText.text = spinsWonThisSpin > 0
        ? `WIN: 0.00 | BONUS! ${spinsWonThisSpin} Free Spins!`
        : "WIN: 0.00";
      this.ui.totalWinText.text = "0.00";
    }

    // STEP 9: Result text
    if (totalPayout > 0) {
      this.ui.resultText.text   = spinsWonThisSpin > 0
        ? `WIN: 0.00 | BONUS! ${spinsWonThisSpin} Free Spins!`
        : "WIN: 0.00";
      this.ui.totalWinText.text = "0.00";
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

    // STEP 10: Spawn floating win symbols after a brief delay
    if (this.winningCells.size > 0) {
      setTimeout(() => {
        this._spawnFloatingWinSymbols();
      }, 180);

      this.reels.forEach((reel) => {
        reel.symbolCells.forEach((cell) => {
          if (!this.winningCells.has(cell)) {
            cell.alpha = 0.25;
          }
        });
      });
    }

    // ── Free spins continuation ─────────────────────────────────────────────
    if (this.inFreeSpins) {
      if (this.freeSpinsRemaining > 0) {
        this.freeSpinsRemaining--;
        this.ui.freeSpinText.text = `Free spins: ${this.freeSpinsRemaining}`;
        setTimeout(() => {
          const result = this.generateResult({ weighted: true });
          this.spinToResult(result);
        }, 1500);
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

    // Auto spin continuation
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