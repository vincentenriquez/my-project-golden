// GameSession.ts
// Pure domain model for credits, bet, free spins, and auto-spin state.

export interface GameSessionConfig {
  initialCredits: number;
  initialBet: number;
  minBet: number;
  maxBet: number;
}

export class GameSession {
  private credits: number;
  private bet: number;
  private readonly minBet: number;
  private readonly maxBet: number;

  /** Mirrors backend + onepiece: total stake = bet_size × bet_level × base_multiplier. */
  private betLevel = 1;
  private baseBetMultiplier = 1;

  private freeSpinsRemaining = 0;
  private inFreeSpins = false;

  private autoSpinActive = false;
  private autoSpinsRemaining = 0;

  constructor(config: GameSessionConfig) {
    this.credits = config.initialCredits;
    this.bet = this.clampBet(config.initialBet, config.minBet, config.maxBet);
    this.minBet = config.minBet;
    this.maxBet = config.maxBet;
  }

  // ── Credits & Bet ─────────────────────────────────────────────────────────

  getCredits(): number {
    return this.credits;
  }

  setCredits(amount: number): void {
    this.credits = Number.isFinite(amount) ? amount : this.credits;
  }

  getBet(): number {
    return this.bet;
  }

  getBetLevel(): number {
    return this.betLevel;
  }

  getBaseBetMultiplier(): number {
    return this.baseBetMultiplier;
  }

  /**
   * Total monetary stake for one paid spin (what to show as "Bet" and deduct from credits).
   * Same formula as onepiece `GameState.currentBetAmount`.
   */
  getTotalBetAmount(): number {
    const size = this.bet;
    const level = Math.max(1, this.betLevel);
    const mult = Math.max(0, this.baseBetMultiplier);
    const product = size * level * mult;
    return product || size * level;
  }

  applyMachineBetConfig(config: { betLevel?: number; baseBetMultiplier?: number }): void {
    if (typeof config.betLevel === "number" && config.betLevel >= 1) {
      this.betLevel = Math.floor(config.betLevel);
    }
    if (typeof config.baseBetMultiplier === "number" && config.baseBetMultiplier > 0) {
      this.baseBetMultiplier = config.baseBetMultiplier;
    }
  }

  setBet(amount: number): void {
    this.bet = this.clampBet(amount, this.minBet, this.maxBet);
  }

  addCredits(amount: number): void {
    this.credits += amount;
  }

  /**
   * Deducts bet from credits for a paid spin. Free spins do not cost credits.
   */
  deductBetForSpin(): void {
    //if (this.inFreeSpins) return;
    this.credits -= this.getTotalBetAmount();
  }

  hasEnoughCreditsForBet(): boolean {
    return this.credits >= this.getTotalBetAmount();
  }

  // ── Free Spins ────────────────────────────────────────────────────────────

  isInFreeSpins(): boolean {
    return this.inFreeSpins;
  }

  getFreeSpinsRemaining(): number {
    return this.freeSpinsRemaining;
  }

  setFreeSpinsRemaining(count: number): void {
    const next = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    this.freeSpinsRemaining = next;
    this.inFreeSpins = next > 0;
  }

  /**
   * Adds free spins and enters free-spin mode if any are awarded.
   */
  awardFreeSpins(count: number): void {
    if (count <= 0) return;
    this.freeSpinsRemaining += count;
    this.inFreeSpins = true;
  }

  /**
   * Consumes a single free spin, returning the remaining count.
   * When the count reaches zero, leaves free-spin mode.
   */
  consumeFreeSpin(): number {
    if (!this.inFreeSpins || this.freeSpinsRemaining <= 0) {
      return this.freeSpinsRemaining;
    }
    this.freeSpinsRemaining -= 1;
    if (this.freeSpinsRemaining <= 0) {
      this.freeSpinsRemaining = 0;
      this.inFreeSpins = false;
    }
    return this.freeSpinsRemaining;
  }

  /**
   * Explicitly ends the free-spin series, clearing any remaining spins.
   */
  endFreeSpinSeries(): void {
    this.freeSpinsRemaining = 0;
    this.inFreeSpins = false;
  }

  // ── Auto Spin ─────────────────────────────────────────────────────────────

  isAutoSpinActive(): boolean {
    return this.autoSpinActive;
  }

  getAutoSpinsRemaining(): number {
    return this.autoSpinsRemaining;
  }

  startAutoSpin(count: number): void {
    if (count <= 0) return;
    this.autoSpinActive = true;
    this.autoSpinsRemaining = count;
  }

  /**
   * Decrements the remaining auto spins and updates the active flag.
   * Returns the new remaining count.
   */
  consumeAutoSpin(): number {
    if (!this.autoSpinActive || this.autoSpinsRemaining <= 0) {
      return this.autoSpinsRemaining;
    }
    this.autoSpinsRemaining -= 1;
    if (this.autoSpinsRemaining <= 0) {
      this.autoSpinsRemaining = 0;
      this.autoSpinActive = false;
    }
    return this.autoSpinsRemaining;
  }

  cancelAutoSpin(): void {
    this.autoSpinActive = false;
    this.autoSpinsRemaining = 0;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private clampBet(amount: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, amount));
  }
}

