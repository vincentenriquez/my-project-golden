//GameController.ts

import { Container, Graphics, Text } from "pixi.js";
import type { Reel } from "./Reel";
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
  betText: Text;
  totalSpinText: Text;
  autoSpinButton: Graphics;
  stopAutoSpinButton: Graphics;
}

interface HighlightBox {
  graphics: Graphics;
  reelIndex: number;
  rowIndex: number;
  pulseTime: number;
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
  private backout: (amount: number) => (t: number) => number;

  private credits: number;
  private bet: number;
  private running = false;
  private freeSpinsRemaining = 0;
  private inFreeSpins = false;
  private autoSpinActive = false;
  private autoSpinsRemaining = 0;
  private highlightBoxes: HighlightBox[] = [];

  constructor(
    reels: Reel[],
    config: GameControllerConfig,
    ui: GameControllerUI,
    highlightLayer: Container,
    tweenTo: TweenToFn,
    backoutEasing: (amount: number) => (t: number) => number
  ) {
    this.reels = reels;
    this.config = config;
    this.ui = ui;
    this.highlightLayer = highlightLayer;
    this.tweenTo = tweenTo;
    this.backout = backoutEasing;

    this.credits = config.initialCredits;
    this.bet = config.initialBet;
    this.ui.creditsText.text = `Balance: ${this.credits}`;
    this.ui.betText.text = `Bet: ${this.bet}`;
  }

  getCredits(): number {
    return this.credits;
  }
  getBet(): number {
    return this.bet;
  }
  getRunning(): boolean {
    return this.running;
  }
  getInFreeSpins(): boolean {
    return this.inFreeSpins;
  }
  getAutoSpinActive(): boolean {
    return this.autoSpinActive;
  }
  getAutoSpinsRemaining(): number {
    return this.autoSpinsRemaining;
  }

  canSpin(): boolean {
    return !this.running && !this.autoSpinActive;
  }

  canStartAutoSpin(): boolean {
    return !this.running && !this.autoSpinActive && !this.inFreeSpins;
  }

  setBet(amount: number): void {
    this.bet = Math.max(this.config.minBet, Math.min(this.config.maxBet, amount));
  }

  deductBet(): void {
    if (!this.inFreeSpins) {
      this.credits -= this.bet;
      this.ui.creditsText.text = `Balance: ${this.credits}`;
    }
  }

  addCredits(amount: number): void {
    this.credits += amount;
    this.ui.creditsText.text = `Balance: ${this.credits}`;
  }

  hasEnoughCredits(): boolean {
    return this.credits >= this.bet;
  }

  updateBetDisplay(): void {
    this.ui.betText.text = `Bet: ${this.bet}`;
  }

  /** Generate a result matrix (per-reel columns). */
  generateResult(options?: GenerateOptions): number[][] {
    const { reelsCount, symbolsPerReel } = this.config;

    if (options?.forceMatrix) {
      return options.forceMatrix;
    }

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

  updateReelsVisuals(): void {
    this.reels.forEach((r) => r.updateSprites());
  }

  updateHighlightAnimation(deltaTime: number): void {
    this.highlightBoxes.forEach((box) => {
      box.pulseTime += deltaTime * 0.05;
      const pulse = Math.sin(box.pulseTime) * 0.5 + 0.5;
      box.graphics.alpha = 0.6 + pulse * 0.4;
      box.graphics.scale.set(1.0 + pulse * 0.08);
    });
  }

  /**
   * 243-Ways evaluation (left-to-right, all symbols independently).
   *
   * Payout formula used here:
   *   payout = combos × PAYTABLE[symbol][reelCount] × betAmount
   *
   * Industry-standard alternative (per-way costing):
   *   payout = combos × PAYTABLE[symbol][reelCount] × (betAmount / TOTAL_WAYS)
   * If you switch to per-way, scale PAYTABLE values up by ~243× to keep similar payouts.
   *
   * Wild-as-base: Wild IS evaluated as its own symbol. When wild is the base,
   * only actual wilds on each reel count (no reverse substitution).
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
            // Wild-as-base: only actual wilds match (no substitution)
            if (cell === WILD_SYMBOL_ID) matchesOnThisReel++;
          } else {
            // Regular symbol: matches itself or wild substitute
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

  /**
   * Scatter: count anywhere on the grid (reel-position independent).
   * Payout = SCATTER_PAYTABLE[count] × betAmount. Free spins from FREE_SPINS_AWARDED[count].
   * Evaluated on ORIGINAL matrix (wild does not substitute for scatter).
   */
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
        if (matrix[row][reel] === WILD_SYMBOL_ID) {
          hasWild = true;
          break;
        }
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

  private highlightSpriteAt(
    reelIndex: number,
    rowIndex: number,
    color: number = 0xffd700
  ): void {
    const { reelWidth, symbolSize } = this.config;
    const box = new Graphics();
    box.lineStyle(6, color, 0.6);
    box.drawRoundedRect(
      reelIndex * reelWidth + 3,
      rowIndex * symbolSize + 3,
      reelWidth - 6,
      symbolSize - 6,
      10
    );
    box.lineStyle(4, color, 0.8);
    box.drawRoundedRect(
      reelIndex * reelWidth + 5,
      rowIndex * symbolSize + 5,
      reelWidth - 10,
      symbolSize - 10,
      8
    );
    box.lineStyle(2, 0xffffff, 1);
    box.beginFill(color, 0.1);
    box.drawRoundedRect(
      reelIndex * reelWidth + 8,
      rowIndex * symbolSize + 8,
      reelWidth - 16,
      symbolSize - 16,
      6
    );
    box.endFill();
    box.pivot.set(
      reelIndex * reelWidth + reelWidth / 2,
      rowIndex * symbolSize + symbolSize / 2
    );
    box.position.set(
      reelIndex * reelWidth + reelWidth / 2,
      rowIndex * symbolSize + symbolSize / 2
    );
    this.highlightLayer.addChild(box);
    this.highlightBoxes.push({
      graphics: box,
      reelIndex,
      rowIndex,
      pulseTime: Math.random() * Math.PI * 2,
    });
  }

  clearHighlights(): void {
    this.highlightBoxes.forEach((box) => {
      this.highlightLayer.removeChild(box.graphics);
      box.graphics.destroy();
    });
    this.highlightBoxes.length = 0;
  }

  private evaluateAndShowResults(matrix: number[][]): void {
    const { reelsCount, symbolsPerReel } = this.config;
    this.clearHighlights();

    // ---- STEP 1: Evaluate scatters on the ORIGINAL matrix (before wild expansion) ----
    const scatterResult = this.evaluateScatters(matrix, this.bet);

    // ---- STEP 2: Expand wilds (preserves scatters thanks to applyExpandingWilds fix) ----
    const expandedMatrix = this.applyExpandingWilds(matrix);

    // ---- STEP 2b: Visually update reel sprites for expanded positions ----
    this.reels.forEach((r) => r.clearVisualOverrides());
    for (let reel = 0; reel < reelsCount; reel++) {
      for (let row = 0; row < symbolsPerReel; row++) {
        if (expandedMatrix[row][reel] !== matrix[row][reel]) {
          this.reels[reel].setVisualOverride(row, expandedMatrix[row][reel]);
        }
      }
    }
    this.updateReelsVisuals();

    // ---- STEP 3: Evaluate 243-ways on the EXPANDED matrix ----
    const waysResults = this.evaluateWays(expandedMatrix, this.bet);

    // ---- STEP 4: Highlight expanding-wild reels (cyan) ----
    for (let reel = 0; reel < reelsCount; reel++) {
      let hasWild = false;
      for (let row = 0; row < symbolsPerReel; row++) {
        if (expandedMatrix[row][reel] === WILD_SYMBOL_ID) {
          hasWild = true;
          break;
        }
      }
      if (hasWild) {
        for (let row = 0; row < symbolsPerReel; row++) {
          this.highlightSpriteAt(reel, row, 0x00ffff);
        }
      }
    }

    // ---- STEP 5: Sum ALL ways wins (industry standard: every symbol pays independently) ----
    let totalPayout = 0;

    waysResults.forEach((win) => {
      totalPayout += win.payout;
      for (let r = 0; r < win.hits; r++) {
        for (let row = 0; row < symbolsPerReel; row++) {
          const cell = expandedMatrix[row][r];
          if (cell === win.symbol || cell === WILD_SYMBOL_ID) {
            this.highlightSpriteAt(r, row, 0xffd700);
          }
        }
      }
    });

    // ---- STEP 6: Scatter payout + free spins trigger ----
    let spinsWonThisSpin = 0;
    if (scatterResult) {
      totalPayout += scatterResult.payout;
      // Highlight scatters on the ORIGINAL matrix (they may be hidden on expanded)
      for (let r = 0; r < reelsCount; r++) {
        for (let row = 0; row < symbolsPerReel; row++) {
          if (matrix[row][r] === SCATTER_SYMBOL_ID) {
            this.highlightSpriteAt(r, row, 0xff00ff);
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
          this.ui.totalSpinText.text = "Free spins: 0";
        }
        this.freeSpinsRemaining += spinsWon;
        this.inFreeSpins = true;
      }
    }

    // ---- STEP 7: Credit update ----
    if (totalPayout > 0) {
      this.addCredits(totalPayout);
    }
    this.ui.creditsText.text = `Balance: ${this.credits}`;

    // ---- STEP 8: Display total payout (dynamic from paytable + winning combinations) ----
    if (totalPayout > 0 && spinsWonThisSpin > 0) {
      this.ui.resultText.text = `WIN: ${totalPayout} | BONUS! ${spinsWonThisSpin} Free Spins!`;
    } else if (totalPayout > 0) {
      this.ui.resultText.text = `WIN: ${totalPayout}`;
    } else if (spinsWonThisSpin > 0) {
      this.ui.resultText.text = `BONUS! ${spinsWonThisSpin} Free Spins!`;
    } else {
      this.ui.resultText.text = "No win. Try again!";
    }

    // ---- Free spins continuation ----
    if (this.inFreeSpins) {
      if (this.freeSpinsRemaining > 0) {
        this.freeSpinsRemaining--;
        setTimeout(() => {
          const result = this.generateResult({ weighted: true });
          this.spinToResult(result);
        }, 1500);
      } else {
        this.inFreeSpins = false;
        this.ui.resultText.text = "Bonus finished!";
        if (this.autoSpinsRemaining > 0) {
          this.endAutoSpin();
          this.ui.resultText.text = "Bonus finished! Auto spin stopped.";
        }
      }
      return;
    }

    // ---- Auto spin continuation ----
    if (this.autoSpinActive) {
      this.autoSpinsRemaining--;
      this.ui.totalSpinText.text = `Free spins: ${this.autoSpinsRemaining}`;
      if (this.autoSpinsRemaining <= 0) {
        this.endAutoSpin();
        return;
      }
      if (this.onAutoSpinContinue) {
        this.onAutoSpinContinue();
      }
    }
  }

  /** Set by main: called when a spin finishes and auto spin should run again (e.g. to tween button and run next). */
  onAutoSpinContinue: (() => void) | null = null;

  getShouldContinueAutoSpin(): boolean {
    return this.autoSpinActive && this.autoSpinsRemaining > 0;
  }

  startAutoSpin(count: number): void {
    this.autoSpinActive = true;
    this.autoSpinsRemaining = count;
    this.ui.autoSpinButton.visible = false;
    this.ui.stopAutoSpinButton.visible = true;
    this.ui.totalSpinText.text = `Free spins: ${this.autoSpinsRemaining}`;
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
    this.ui.totalSpinText.text = "Free spins: 0";
  }

  /** Run one auto spin (deduct bet, generate result, spin). Call from main with spinButton for tween. */
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
