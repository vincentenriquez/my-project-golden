import type { SpinConfig, SpinOutcome, WinningPosition } from "../domain/SpinEngine";
import type { IGameSession, ISpinEvaluator, ISpinResultGenerator } from "./ports";
import type { GameEvent, GameEventListener, SpinKind } from "./events";

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

export type SpinRequestSource = "manual" | "auto" | "free";

/**
 * GameController (Application Service)
 *
 * Owns:
 * - Session flow (credits/bet/free spins/auto spins)
 * - Spin eligibility
 * - Sequencing (spin → evaluate → win sequence → cascade → evaluate → continuation)
 * - Evaluation calls (SpinEngine via ISpinEvaluator)
 *
 * Emits:
 * - Commands/events describing what the UI should do next.
 *
 * No PIXI, no concrete UI classes, no timers.
 */
export class GameController {
  private readonly listeners = new Set<GameEventListener>();

  private running = false;
  private winLock = false;
  private winSequenceComplete = true;
  private winDisplayComplete = true;

  /**
   * Free-spin awards coming from scatter that should be applied only *after*
   * the current win resolution flow (wins, animations, cascades) completes.
   */
  private pendingFreeSpinsFromScatter = 0;

  private currentSpinTotalPayout = 0;
  private lastWinningPositions: WinningPosition[] = [];

  constructor(
    private readonly config: GameControllerConfig,
    private readonly session: IGameSession,
    private readonly spinEvaluator: ISpinEvaluator,
    private readonly spinResultGenerator: ISpinResultGenerator
  ) {}

  // ── Events ──────────────────────────────────────────────────────────────
  subscribe(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GameEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  // ── Queries ─────────────────────────────────────────────────────────────
  getCredits(): number { return this.session.getCredits(); }
  getBet(): number { return this.session.getBet(); }
  getRunning(): boolean { return this.running; }
  getInFreeSpins(): boolean { return this.session.isInFreeSpins(); }
  getAutoSpinActive(): boolean { return this.session.isAutoSpinActive(); }
  getAutoSpinsRemaining(): number { return this.session.getAutoSpinsRemaining(); }

  canSpin(): boolean {
    return !this.running && !this.session.isAutoSpinActive() && !this.winLock;
  }

  canStartAutoSpin(): boolean {
    return !this.running && !this.session.isAutoSpinActive() && !this.session.isInFreeSpins();
  }

  // ── Use cases ───────────────────────────────────────────────────────────
  setBet(amount: number): void {
    const before = this.session.getBet();
    this.session.setBet(amount);
    const after = this.session.getBet();
    if (after !== before) {
      this.emit({ type: "BetChanged", from: before, to: after, animate: true });
    }
  }

  startAutoSpin(count: number): void {
    if (!this.canStartAutoSpin()) {
      this.emit({ type: "SpinBlocked", reason: this.running ? "running" : this.winLock ? "winLock" : "autoSpinActive" });
      return;
    }
    this.session.startAutoSpin(count);
    this.emit({ type: "AutoSpinChanged", active: true, remaining: this.session.getAutoSpinsRemaining() });
    this.emit({ type: "RequestNextSpin", afterMs: 0, reason: "autoSpin" });
  }

  cancelAutoSpin(): void {
    this.session.cancelAutoSpin();
    this.emit({ type: "AutoSpinChanged", active: false, remaining: 0 });
  }

  requestSpin(source: SpinRequestSource): void {
    this.startSpinInternal(source);
  }

  // ── UI callbacks (driving the state machine) ────────────────────────────
  onSpinStopped(visibleMatrix: number[][]): void {
    this.running = false;
    this.emit({ type: "SpinStopped", visibleMatrix });
    this.evaluateStep(visibleMatrix);
  }

  onWinSequenceFinished(): void {
    if (this.lastWinningPositions.length === 0) {
      this.resolveContinuation();
      return;
    }
    this.emit({ type: "CascadeRequested", winningPositions: this.lastWinningPositions });
  }

  onCascadeFinished(visibleMatrix: number[][]): void {
    this.evaluateStep(visibleMatrix);
  }

  onWinDisplayFinished(): void {
    this.winDisplayComplete = true;
    this.tryReleaseWinLock();
  }

  // ── Internal flow ───────────────────────────────────────────────────────
  private startSpinInternal(source: SpinRequestSource): void {
    if (this.running) {
      this.emit({ type: "SpinBlocked", reason: "running" });
      return;
    }
    if (this.winLock) {
      this.emit({ type: "SpinBlocked", reason: "winLock" });
      return;
    }
    if (source === "manual" && this.session.isAutoSpinActive()) {
      this.emit({ type: "SpinBlocked", reason: "autoSpinActive" });
      return;
    }

    const kind: SpinKind = this.session.isInFreeSpins() ? "free" : "paid";
    const bet = this.session.getBet();

    const creditsBefore = this.session.getCredits();
    if (kind === "paid") {
      if (!this.session.hasEnoughCreditsForBet()) {
        this.emit({ type: "SpinBlocked", reason: "insufficientCredits" });
        return;
      }
      this.session.deductBetForSpin();
    }
    const creditsAfter = this.session.getCredits();
    if (creditsAfter !== creditsBefore) {
      this.emit({ type: "CreditsChanged", from: creditsBefore, to: creditsAfter, animate: false });
    }

    // New paid spin resets the per-spin total. Free-spin cascades keep accumulating within their own spin.
    if (source === "manual" || source === "auto") {
      this.currentSpinTotalPayout = 0;
      this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
      // Also clear any queued scatter awards carried over from the previous spin.
      this.pendingFreeSpinsFromScatter = 0;
    }

    this.running = true;
    this.winSequenceComplete = false;
    this.lastWinningPositions = [];

    this.emit({ type: "SpinStarted", kind, bet, creditsBefore, creditsAfter });
    const resultPerReel = this.spinResultGenerator.generate({ weighted: true });
    this.emit({ type: "SpinToResultRequested", resultPerReel });
  }

  private evaluateStep(visibleMatrix: number[][]): void {
    const spinConfig: SpinConfig = {
      reelsCount: this.config.reelsCount,
      symbolsPerReel: this.config.symbolsPerReel,
    };
    const outcome: SpinOutcome = this.spinEvaluator.evaluate(spinConfig, visibleMatrix, this.session.getBet());
    this.emit({ type: "OutcomeEvaluated", outcome });

    // Scatter -> free spins (mode-dependent)
    let spinsWonThisStep = 0;
    const scatterCount = outcome.scatterWin?.count ?? 0;

    if (!this.session.isInFreeSpins()) {
      // Base game: require 3+ scatters (uses existing FREE_SPINS_AWARDED table via domain).
      if (outcome.scatterWin?.freeSpinsAwarded && outcome.scatterWin.freeSpinsAwarded > 0) {
        spinsWonThisStep = outcome.scatterWin.freeSpinsAwarded;
      }
    } else {
      // Free Spins mode: ANY scatter symbol retriggers additional free spins.
      if (scatterCount > 0) {
        // Assumption: 1 extra free spin per scatter symbol.
        spinsWonThisStep = scatterCount;
      }
    }

    if (spinsWonThisStep > 0) {
      const hasWinsThisStep =
        outcome.totalPayout > 0 || outcome.winningPositions.length > 0;

      if (hasWinsThisStep) {
        // Queue bonus: will be formally awarded after all win animations/cascades finish.
        this.pendingFreeSpinsFromScatter += spinsWonThisStep;
      } else {
        // No wins to resolve this step — safe to enter/extend free spins immediately.
        this.awardFreeSpinsWithPresentation(spinsWonThisStep);
      }
    }

    // Payout
    if (outcome.totalPayout > 0) {
      const creditsBefore = this.session.getCredits();
      this.session.addCredits(outcome.totalPayout);
      const creditsAfter = this.session.getCredits();

      this.winLock = true;
      this.winSequenceComplete = false;
      this.winDisplayComplete = false;

      this.currentSpinTotalPayout += outcome.totalPayout;
      const bonusText = spinsWonThisStep > 0 ? ` | BONUS! ${spinsWonThisStep} Free Spins!` : "";

      this.emit({ type: "CreditsChanged", from: creditsBefore, to: creditsAfter, animate: true });
      this.emit({ type: "TotalWinChanged", totalSoFar: this.currentSpinTotalPayout, animate: true });
      this.emit({ type: "WinAmountAwarded", hitAmount: outcome.totalPayout, totalSoFar: this.currentSpinTotalPayout, bonusText });
    } else if (spinsWonThisStep === 0) {
      this.emit({ type: "ResultTextChanged", text: "" });
    }

    if (outcome.winningPositions.length > 0) {
      this.lastWinningPositions = outcome.winningPositions;
      this.emit({ type: "WinSequenceRequested", winningPositions: outcome.winningPositions });
      return;
    }

    this.resolveContinuation();
  }

  private resolveContinuation(): void {
    this.winSequenceComplete = true;

    // If any scatter bonuses were queued behind the win flow, apply them now.
    if (this.pendingFreeSpinsFromScatter > 0) {
      const queued = this.pendingFreeSpinsFromScatter;
      this.pendingFreeSpinsFromScatter = 0;
      this.awardFreeSpinsWithPresentation(queued);
    }

    if (this.session.isInFreeSpins()) {
      if (this.session.getFreeSpinsRemaining() > 0) {
        const remaining = this.session.consumeFreeSpin();
        this.emit({ type: "FreeSpinsChanged", remaining, mode: "updated" });
        this.emit({ type: "RequestNextSpin", afterMs: 400, reason: "freeSpin" });
      } else {
        this.session.endFreeSpinSeries();
        this.emit({ type: "FreeSpinsChanged", remaining: 0, mode: "ended" });
        this.emit({ type: "ResultTextChanged", text: "Bonus finished!" });
        this.emit({ type: "SpinFinished" });
        this.tryReleaseWinLock();
      }
      return;
    }

    if (this.session.isAutoSpinActive()) {
      const remaining = this.session.consumeAutoSpin();
      this.emit({ type: "AutoSpinChanged", active: remaining > 0, remaining });
      if (remaining <= 0) {
        this.emit({ type: "SpinFinished" });
        this.tryReleaseWinLock();
        return;
      }
      this.emit({ type: "RequestNextSpin", afterMs: 1200, reason: "autoSpin" });
      return;
    }

    this.emit({ type: "SpinFinished" });
    this.tryReleaseWinLock();
  }

  private tryReleaseWinLock(): void {
    if (this.winLock && this.winSequenceComplete && this.winDisplayComplete) {
      this.winLock = false;
    }
  }

  private awardFreeSpinsWithPresentation(count: number): void {
    if (count <= 0) return;

    if (this.session.isAutoSpinActive()) {
      this.session.cancelAutoSpin();
      this.emit({ type: "AutoSpinChanged", active: false, remaining: 0 });
    }

    this.session.awardFreeSpins(count);
    this.emit({
      type: "FreeSpinsChanged",
      remaining: this.session.getFreeSpinsRemaining(),
      mode: "entered",
    });
    this.emit({
      type: "ResultTextChanged",
      text: `BONUS! ${count} Free Spins!`,
    });
  }
}

