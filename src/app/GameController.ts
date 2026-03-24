//GameController.ts
import type { SpinConfig, SpinOutcome, WinningPosition } from "../domain/SpinEngine";
import { SCATTER_SYMBOL_ID } from "../domain/symbolConfig";
import { GamePhase } from "../domain/GamePhase";
import type { IGameSession, ISpinEvaluator, ISpinResultGenerator, IScatterService } from "./ports";
import type { GameEvent, GameEventListener, SpinKind } from "./events";
import * as slotApi from "../infrastructure/api/slotApi";

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
  buyFreeSpinsCount: number;
  buyFreeSpinsCostMultiplier: number;
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

  private phase: GamePhase = GamePhase.Normal;
  private running = false;
  private winLock = false;
  private winSequenceComplete = true;
  private winDisplayComplete = true;
  private lastStartedSpinKind: SpinKind | null = null;

  /** True while the scatter bonus animation (highlight → float → slice) is running. */
  private scatterSequenceActive = false;

  /**
   * Special-case flow for `buyFreeSpins()`:
   * show a forced "exactly 3 scatters" visual spin first, then run the normal
   * scatter-mode transition (highlight → intro → greetings).
   *
   * During this prelude spin we do NOT evaluate wins/scatters.
   */
  private buyPreludeScatterActive = false;
  private buyPreludeFreeSpinsAwarded = 0;

  /**
   * After scatter sequence completes: run win sequence, award free spins, or resolve.
   */
  private pendingAfterScatter: {
    winningPositions: WinningPosition[];
    scatterPositions: WinningPosition[];
    spinsWonThisStep: number;
    hadLineWins: boolean;
  } | null = null;

  /**
   * Free-spin awards coming from scatter that should be applied only *after*
   * the current win resolution flow (wins, animations, cascades) completes.
   */
  private pendingFreeSpinsFromScatter = 0;
  private pendingScatterPositions: WinningPosition[] = [];
  private postScatterCascadePositions: WinningPosition[] = [];
  private scatterOnlyTrigger = false;

  private currentSpinTotalPayout = 0;
  /** Accumulates winnings across the whole free-spin bonus series. */
  private bonusTotalPayout = 0;
  /** Cascade payout multiplier within the current spin sequence (starts at 1). */
  private cascadeMultiplier = 1;
  private lastWinningPositions: WinningPosition[] = [];

  /**
   * Tracks the maximum number of scatters awarded *during the current spin sequence*
   * (initial spin + cascades). This prevents awarding the same scatters multiple times
   * if they persist during cascades.
   */
  private lastAwardedScatterCount = 0;

  private readonly useBackend: boolean;
  private pendingBackendResult: slotApi.BackendPlayData | null = null;
  private backendCascadeSteps: slotApi.BackendCascadeStep[] = [];
  private backendStepIndex = 0;
  private backendAccumulatedWin = 0;
  /** Bonus total before the current backend free-spin round (HUD = this + per-spin cascade sum). */
  private backendFreeSpinHudBase = 0;
  /** True while processing a play_free response with cascades / win sequence. */
  private activeBackendFreeSpinRound = false;
  private backendPendingScatterAward: { add: number; positions: WinningPosition[]; isRetrigger: boolean } | null = null;
  private backendBuyFreeTriggered = false;

  constructor(
    private readonly config: GameControllerConfig,
    private readonly session: IGameSession,
    private readonly spinEvaluator: ISpinEvaluator,
    private readonly spinResultGenerator: ISpinResultGenerator,
    private readonly scatterService: IScatterService,
    opts?: { useBackend?: boolean }
  ) {
    this.useBackend = opts?.useBackend === true;
  }

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
  /** Total stake: bet_size × bet_level × base_multiplier (same as onepiece display bet). */
  getTotalBetAmount(): number { return this.session.getTotalBetAmount(); }
  getRunning(): boolean { return this.running; }
  getPhase(): GamePhase { return this.phase; }
  getInFreeSpins(): boolean { return this.session.isInFreeSpins(); }
  getAutoSpinActive(): boolean { return this.session.isAutoSpinActive(); }
  getAutoSpinsRemaining(): number { return this.session.getAutoSpinsRemaining(); }

  private isInPostBonusPhase(): boolean {
    return this.phase === GamePhase.PostBonusSummary || this.phase === GamePhase.PostBonusTransition;
  }

  canSpin(): boolean {
    return (
      !this.running &&
      !this.session.isAutoSpinActive() &&
      !this.winLock &&
      !this.scatterSequenceActive &&
      !this.isInPostBonusPhase()
    );
  }

  canStartAutoSpin(): boolean {
    return !this.running && !this.session.isAutoSpinActive() && !this.session.isInFreeSpins() && !this.isInPostBonusPhase();
  }

  canBuyFreeSpins(): boolean {
    return (
      !this.running &&
      !this.winLock &&
      !this.scatterSequenceActive &&
      !this.session.isInFreeSpins() &&
      !this.session.isAutoSpinActive() &&
      !this.isInPostBonusPhase() &&
      this.session.getCredits() >= this.getBuyFreeSpinsCost()
    );
  }

  getBuyFreeSpinsCost(): number {
    return this.session.getTotalBetAmount() * this.config.buyFreeSpinsCostMultiplier;
  }

  /**
   * Apply `/load` payload (balance, machine multiplier/levels, default bet). Emits HUD updates.
   */
  applyLoadData(data: slotApi.BackendLoadData): void {
    const machine = data.machine;
    const baseMult = data.info?.base_multiplier ?? machine?.multiplier;
    const defaultLevel = machine?.default?.bet_level;
    const cfg: { betLevel?: number; baseBetMultiplier?: number } = {};
    if (typeof baseMult === "number" && baseMult > 0) {
      cfg.baseBetMultiplier = baseMult;
    }
    if (typeof defaultLevel === "number" && defaultLevel >= 1) {
      cfg.betLevel = defaultLevel;
    }
    if (Object.keys(cfg).length > 0) {
      this.session.applyMachineBetConfig(cfg);
    }

    const defaultSize = machine?.default?.bet_size;
    if (typeof defaultSize === "number") {
      this.session.setBet(defaultSize);
    }

    if (typeof data.player?.balance === "number") {
      const before = this.session.getCredits();
      this.session.setCredits(data.player.balance);
      this.emit({
        type: "CreditsChanged",
        from: before,
        to: data.player.balance,
        animate: false,
      });
    }

    if (data.free_spin && typeof data.free_spin.count === "number") {
      this.session.setFreeSpinsRemaining(data.free_spin.count);
    }

    this.emit({
      type: "BetChanged",
      from: this.session.getBet(),
      to: this.session.getBet(),
      animate: false,
    });
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

  buyFreeSpins(): void {
    if (this.useBackend) {
      void this.buyFreeSpinsBackend();
      return;
    }
    if (this.running) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "running" });
      return;
    }
    if (this.winLock) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "winLock" });
      return;
    }
    if (this.session.isInFreeSpins()) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "inFreeSpins" });
      return;
    }
    if (this.session.isAutoSpinActive()) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "autoSpinActive" });
      return;
    }

    const cost = this.getBuyFreeSpinsCost();
    if (this.session.getCredits() < cost) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "insufficientCredits" });
      return;
    }

    const creditsBefore = this.session.getCredits();
    this.session.addCredits(-cost);
    const creditsAfter = this.session.getCredits();
    this.emit({ type: "CreditsChanged", from: creditsBefore, to: creditsAfter, animate: false });

    const count = this.config.buyFreeSpinsCount;
    this.buyPreludeFreeSpinsAwarded = count;
    this.awardFreeSpinsWithPresentation(count, false);

    // Prelude spin first; onSpinStopped() will intercept and then start scatter mode.
    this.startBuyPreludeScatterSpin();
  }

  requestSpin(source: SpinRequestSource): void {
    if (this.useBackend) {
      void this.startSpinBackend(source);
      return;
    }
    this.startSpinInternal(source);
  }

  // ── UI callbacks (driving the state machine) ────────────────────────────
  onSpinStopped(visibleMatrix: number[][]): void {
    this.running = false;
    this.emit({ type: "SpinStopped", visibleMatrix });

    if (this.useBackend && this.pendingBackendResult) {
      const data = this.pendingBackendResult;
      this.pendingBackendResult = null;

      // Trust backend for credits and free spins.
      const creditsBefore = this.session.getCredits();
      this.session.setCredits(data.balance);
      const creditsAfter = this.session.getCredits();
      if (creditsAfter !== creditsBefore) {
        this.emit({ type: "CreditsChanged", from: creditsBefore, to: creditsAfter, animate: false });
      }

      const prevFree = this.session.getFreeSpinsRemaining();
      const nextFree = data.free_spin?.count ?? 0;
      this.session.setFreeSpinsRemaining(nextFree);
      if (prevFree === 0 && nextFree > 0) {
        this.emit({ type: "FreeSpinsChanged", remaining: nextFree, mode: "entered" });
      } else if (prevFree > 0 && nextFree > 0) {
        this.emit({ type: "FreeSpinsChanged", remaining: nextFree, mode: "updated" });
      } else if (prevFree > 0 && nextFree === 0) {
        // Ended after this result sequence
        this.emit({ type: "FreeSpinsChanged", remaining: 0, mode: "ended" });
      }

      // Post-bonus panel uses bonusTotalPayout; local mode fills it in evaluateStep().
      // Backend play_free returns cumulative session total_win (see GamePlayService::executePlayFree).
      if (data.is_free_spin === true) {
        this.backendFreeSpinHudBase = this.bonusTotalPayout;
        this.activeBackendFreeSpinRound = true;
        this.bonusTotalPayout = data.total_win;
      } else {
        this.activeBackendFreeSpinRound = false;
      }

      // Prepare cascade steps from backend.
      const cascaded = data.slot.cascaded ?? [];
      this.backendCascadeSteps = Array.isArray(cascaded) ? cascaded.filter((s) => (s?.cascades?.length ?? 0) > 0 && (s?.win ?? 0) > 0) : [];
      this.backendStepIndex = 0;
      this.backendAccumulatedWin = 0;

      // Queue scatter bonus presentation (if backend awarded).
      const add = data.free_spin?.add ?? 0;
      if (add && add > 0) {
        const isRetrigger = prevFree > 0;
        const scatterPositions: WinningPosition[] = [];
        for (let rowIndex = 0; rowIndex < visibleMatrix.length; rowIndex++) {
          for (let reelIndex = 0; reelIndex < visibleMatrix[rowIndex].length; reelIndex++) {
            if (visibleMatrix[rowIndex][reelIndex] === SCATTER_SYMBOL_ID) {
              scatterPositions.push({ reelIndex, rowIndex });
            }
          }
        }
        this.backendPendingScatterAward = { add, positions: scatterPositions, isRetrigger };
      } else if (this.backendBuyFreeTriggered && prevFree === 0 && nextFree > 0) {
        // buy-free-game returns the full `count` and does not set `add`.
        const scatterPositions: WinningPosition[] = [];
        for (let rowIndex = 0; rowIndex < visibleMatrix.length; rowIndex++) {
          for (let reelIndex = 0; reelIndex < visibleMatrix[rowIndex].length; reelIndex++) {
            if (visibleMatrix[rowIndex][reelIndex] === SCATTER_SYMBOL_ID) {
              scatterPositions.push({ reelIndex, rowIndex });
            }
          }
        }
        this.backendPendingScatterAward = { add: nextFree, positions: scatterPositions, isRetrigger: false };
        this.backendBuyFreeTriggered = false;
      } else {
        this.backendPendingScatterAward = null;
        this.backendBuyFreeTriggered = false;
      }

      // Start backend-driven win/cascade sequence.
      if (this.backendCascadeSteps.length > 0) {
        this.startBackendStep();
        return;
      }

      // Fallback: if backend returned winnings with explicit positions but no cascades, still show a win sequence.
      const positions: WinningPosition[] = [];
      const winnings = data.slot.winnings ?? [];
      for (const w of winnings) {
        const pos = w.positions ?? [];
        for (const p of pos) positions.push({ reelIndex: p.col, rowIndex: p.row });
      }
      if (positions.length > 0 && data.total_win > 0) {
        if (data.is_free_spin === true) {
          this.backendAccumulatedWin = data.win ?? 0;
          this.emit({ type: "TotalWinChanged", totalSoFar: data.total_win, animate: true });
          this.emit({
            type: "WinAmountAwarded",
            hitAmount: data.win ?? data.total_win,
            totalSoFar: data.total_win,
            bonusText: "",
          });
        } else {
          this.backendAccumulatedWin = data.total_win;
          this.emit({ type: "TotalWinChanged", totalSoFar: this.backendAccumulatedWin, animate: true });
          this.emit({
            type: "WinAmountAwarded",
            hitAmount: data.total_win,
            totalSoFar: this.backendAccumulatedWin,
            bonusText: "",
          });
        }
        this.lastWinningPositions = positions;
        this.winLock = true;
        this.winSequenceComplete = false;
        this.winDisplayComplete = false;
        this.emit({ type: "WinSequenceRequested", winningPositions: positions, scatterPositions: [] });
        return;
      }

      if (data.is_free_spin === true) {
        this.emit({ type: "TotalWinChanged", totalSoFar: this.bonusTotalPayout, animate: false });
      }

      this.resolveContinuation();
      return;
    }

    if (this.buyPreludeScatterActive) {
      this.buyPreludeScatterActive = false;

      // Collect the forced scatter positions from the prelude result.
      const scatterPositions: WinningPosition[] = [];
      for (let rowIndex = 0; rowIndex < visibleMatrix.length; rowIndex++) {
        const row = visibleMatrix[rowIndex];
        for (let reelIndex = 0; reelIndex < row.length; reelIndex++) {
          if (row[reelIndex] === SCATTER_SYMBOL_ID) {
            scatterPositions.push({ reelIndex, rowIndex });
          }
        }
      }

      this.scatterSequenceActive = true;
      this.emit({
        type: "ScatterBonusSequenceRequested",
        scatterPositions,
        freeSpinsAwarded: this.buyPreludeFreeSpinsAwarded,
        isRetrigger: false,
      });
      return;
    }

    this.evaluateStep(visibleMatrix);
  }

  onWinSequenceFinished(): void {

    if (this.lastWinningPositions.length === 0) {
      this.resolveContinuation();
      return;
    }

    if (this.useBackend) {
      const step = this.backendCascadeSteps[this.backendStepIndex];
      if (step) {
        const nextGrid = slotApi.backendReelToGrid(step.rng);
        this.emit({
          type: "CascadeRequested",
          winningPositions: this.lastWinningPositions,
          nextGridPerReel: nextGrid,
        });
        return;
      }
      this.emitBackendFreeSpinTotalWinSnapIfNeeded();
      this.resolveContinuation();
      return;
    }

    // Local-mode cascade.
    this.cascadeMultiplier += 1;
    this.emit({ type: "CascadeRequested", winningPositions: this.lastWinningPositions });
  }

  /** Called by UI when the scatter bonus animation (highlight → float → slice) has finished. */
  onScatterSequenceFinished(): void {
    this.scatterSequenceActive = false;

    const positions = this.postScatterCascadePositions;
    this.postScatterCascadePositions = [];

    if (positions.length > 0) {
      // Emit the cascade — onScatterCascadeFinished() continues the flow.
      this.emit({
        type: "ScatterCascadeRequested",
        scatterPositions: positions,
      });
      return;
    }

    // No positions to cascade — continue directly.
    this.resolveContinuation();
  }

  /** Called by UI when the scatter cascade (symbol drop-in after scatter removal) finishes. */
  onScatterCascadeFinished(visibleMatrix: number[][]): void {
    // Re-evaluate the new board — the cascade may produce a new win.
    // This mirrors onCascadeFinished() exactly.
    this.evaluateStep(visibleMatrix);
  }

  onCascadeFinished(visibleMatrix: number[][]): void {
    if (this.useBackend) {
      // After a backend-authoritative cascade drop, continue to next backend step (if any).
      this.backendStepIndex += 1;
      if (this.backendStepIndex < this.backendCascadeSteps.length) {
        this.startBackendStep();
      } else {
        this.lastWinningPositions = [];
        this.emitBackendFreeSpinTotalWinSnapIfNeeded();
        this.resolveContinuation();
      }
      return;
    }

    this.evaluateStep(visibleMatrix);
  }

  /** Align HUD with API cumulative total after free-spin cascade steps (fixes step-sum vs total_win drift). */
  private emitBackendFreeSpinTotalWinSnapIfNeeded(): void {
    if (!this.activeBackendFreeSpinRound) return;
    this.emit({ type: "TotalWinChanged", totalSoFar: this.bonusTotalPayout, animate: false });
  }

  onWinDisplayFinished(): void {
    this.winDisplayComplete = true;
    this.tryReleaseWinLock();
  }

  /**
   * Called by UI after the player dismisses the bonus result screen.
   * Enters PostBonusTransition phase — UI must call onPostBonusTransitionComplete()
   * once the visual transition (scatter outro, theme reset) finishes.
   */
  onBonusResultDismissed(): void {
    this.setPhase(GamePhase.PostBonusTransition);
    this.emit({ type: "BonusResultDismissed" });
    this.emit({ type: "PostBonusTransitionStarted" });
  }

  /**
   * Called by UI after the post-bonus visual transition (scatter outro, theme swap)
   * completes. Cleans up bonus state and returns to Normal mode.
   */
  onPostBonusTransitionComplete(): void {
    this.session.endFreeSpinSeries();
    this.bonusTotalPayout = 0;
    this.currentSpinTotalPayout = 0;

    this.setPhase(GamePhase.Normal);
    this.emit({ type: "FreeSpinsChanged", remaining: 0, mode: "ended" });
    this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
    this.emit({ type: "PostBonusTransitionComplete" });
    this.emit({ type: "SpinFinished" });

    this.winLock = false;
    this.winSequenceComplete = true;
    this.winDisplayComplete = true;
  }

  // ── Internal flow ───────────────────────────────────────────────────────
  private startSpinInternal(source: SpinRequestSource): void {
    if (this.isInPostBonusPhase()) {
      this.emit({ type: "SpinBlocked", reason: "postBonus" });
      return;
    }
    if (this.running) {
      this.emit({ type: "SpinBlocked", reason: "running" });
      return;
    }
    // winLock prevents *manual* spins during win presentation.
    // It should not block controller-scheduled continuation spins (free/auto).
    if (this.winLock && source === "manual") {
      this.emit({ type: "SpinBlocked", reason: "winLock" });
      return;
    }
    if (source === "manual" && this.session.isAutoSpinActive()) {
      this.emit({ type: "SpinBlocked", reason: "autoSpinActive" });
      return;
    }

    const isFreeSpin = this.session.isInFreeSpins();
    const kind: SpinKind = isFreeSpin ? "free" : "paid";
    const bet = this.session.getTotalBetAmount();

    const creditsBefore = this.session.getCredits();

    // Paid spins require enough credits and deduct the bet; free spins are always allowed.
    if (!isFreeSpin) {
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

    // Every spin resets the per-spin total and scatter tracking.
    if (source === "manual" || source === "auto" || source === "free") {
      this.currentSpinTotalPayout = 0;
      this.cascadeMultiplier = 1;
      this.pendingFreeSpinsFromScatter = 0;
      this.pendingScatterPositions = [];
      this.postScatterCascadePositions = [];
      this.scatterOnlyTrigger = false;
      this.lastAwardedScatterCount = 0;
      // Total win display behavior:
      // - Paid spin: reset TOTAL WIN at start of the paid spin.
      // - Free-spin series: do NOT reset TOTAL WIN per free spin; it represents the bonus total.
      if (!isFreeSpin) {
        this.bonusTotalPayout = 0;
        this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
      }
    }

    this.running = true;
    this.winSequenceComplete = false;
    this.lastWinningPositions = [];
    this.lastStartedSpinKind = kind;

    this.emit({ type: "SpinStarted", kind, bet, creditsBefore, creditsAfter });
    const resultPerReel = this.spinResultGenerator.generate({ weighted: true });
    this.emit({ type: "SpinToResultRequested", resultPerReel });
  }

  private async startSpinBackend(source: SpinRequestSource): Promise<void> {
    if (this.isInPostBonusPhase()) {
      this.emit({ type: "SpinBlocked", reason: "postBonus" });
      return;
    }
    if (this.running) {
      this.emit({ type: "SpinBlocked", reason: "running" });
      return;
    }
    if (this.winLock && source === "manual") {
      this.emit({ type: "SpinBlocked", reason: "winLock" });
      return;
    }
    if (source === "manual" && this.session.isAutoSpinActive()) {
      this.emit({ type: "SpinBlocked", reason: "autoSpinActive" });
      return;
    }

    const isFreeSpin = this.session.isInFreeSpins();
    const kind: SpinKind = isFreeSpin ? "free" : "paid";
    const betSize = this.session.getBet();
    const betLevel = this.session.getBetLevel();

    if (!isFreeSpin && !this.session.hasEnoughCreditsForBet()) {
      this.emit({ type: "SpinBlocked", reason: "insufficientCredits" });
      return;
    }

    // Reset per-spin bookkeeping (mirror local reset).
    this.currentSpinTotalPayout = 0;
    this.cascadeMultiplier = 1;
    this.pendingFreeSpinsFromScatter = 0;
    this.pendingScatterPositions = [];
    this.postScatterCascadePositions = [];
    this.scatterOnlyTrigger = false;
    this.lastAwardedScatterCount = 0;
    if (!isFreeSpin) {
      this.bonusTotalPayout = 0;
      this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
    }

    this.running = true;
    this.winSequenceComplete = false;
    this.lastWinningPositions = [];
    this.lastStartedSpinKind = kind;

    const creditsBefore = this.session.getCredits();
    const creditsAfter = creditsBefore;
    this.emit({
      type: "SpinStarted",
      kind,
      bet: this.session.getTotalBetAmount(),
      creditsBefore,
      creditsAfter,
    });

    try {
      const data = isFreeSpin ? await slotApi.playFreeGame() : await slotApi.play(betSize, betLevel);
      this.pendingBackendResult = data;
      const grid = slotApi.backendReelToGrid(data.slot.reel);
      this.emit({ type: "SpinToResultRequested", resultPerReel: grid });
    } catch (e) {
      this.running = false;
      this.emit({ type: "ResultTextChanged", text: (e as Error)?.message || "Spin failed" });
      this.emit({ type: "SpinFinished" });
      this.tryReleaseWinLock();
    }
  }

  private startBackendStep(): void {
    const step = this.backendCascadeSteps[this.backendStepIndex];
    if (!step) {
      this.resolveContinuation();
      return;
    }

    const positions: WinningPosition[] = [];
    for (const c of step.cascades ?? []) {
      positions.push({ reelIndex: c.column, rowIndex: c.row });
    }

    this.lastWinningPositions = positions;

    this.winLock = true;
    this.winSequenceComplete = false;
    this.winDisplayComplete = false;

    this.backendAccumulatedWin += step.win ?? 0;
    const totalWinHud = this.activeBackendFreeSpinRound
      ? this.backendFreeSpinHudBase + this.backendAccumulatedWin
      : this.backendAccumulatedWin;
    this.emit({ type: "TotalWinChanged", totalSoFar: totalWinHud, animate: true });
    this.emit({
      type: "WinAmountAwarded",
      hitAmount: step.win ?? 0,
      totalSoFar: totalWinHud,
      bonusText: "",
    });

    this.emit({
      type: "WinSequenceRequested",
      winningPositions: positions,
      scatterPositions: [],
    });
  }

  private async buyFreeSpinsBackend(): Promise<void> {
    if (this.running) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "running" });
      return;
    }
    if (this.winLock) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "winLock" });
      return;
    }
    if (this.session.isInFreeSpins()) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "inFreeSpins" });
      return;
    }
    if (this.session.isAutoSpinActive()) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "autoSpinActive" });
      return;
    }
    if (this.isInPostBonusPhase()) {
      this.emit({ type: "BuyFreeSpinsBlocked", reason: "running" });
      return;
    }

    this.running = true;
    this.winSequenceComplete = false;
    this.lastWinningPositions = [];
    this.lastStartedSpinKind = "paid";

    const betSize = this.session.getBet();
    const creditsBefore = this.session.getCredits();
    const creditsAfter = creditsBefore;
    this.emit({
      type: "SpinStarted",
      kind: "paid",
      bet: this.session.getTotalBetAmount(),
      creditsBefore,
      creditsAfter,
    });

    try {
      this.backendBuyFreeTriggered = true;
      const data = await slotApi.buyFreeGame(betSize, this.session.getBetLevel());
      this.pendingBackendResult = data;
      const grid = slotApi.backendReelToGrid(data.slot.reel);
      this.emit({ type: "SpinToResultRequested", resultPerReel: grid });
    } catch (e) {
      this.backendBuyFreeTriggered = false;
      this.running = false;
      this.emit({ type: "ResultTextChanged", text: (e as Error)?.message || "Buy free spins failed" });
      this.emit({ type: "SpinFinished" });
      this.tryReleaseWinLock();
    }
  }

  /**
   * Starts a bet-free visual prelude spin for `buyFreeSpins()`:
   * - lands with exactly 3 scatters (reels 0..2, rowIndex 0)
   * - avoids line wins by using unique per-reel symbols for non-scatter cells
   * - `onSpinStopped()` will intercept this spin and skip win/scatter evaluation
   */
  private startBuyPreludeScatterSpin(): void {
    if (this.running) {
      this.emit({ type: "SpinBlocked", reason: "running" });
      return;
    }
    if (!this.session.isInFreeSpins()) {
      // Defensive: buyFreeSpins() awards free spins first, so this should never happen.
      this.session.awardFreeSpins(this.buyPreludeFreeSpinsAwarded);
    }

    const isFreeSpin = this.session.isInFreeSpins();
    const kind: SpinKind = isFreeSpin ? "free" : "paid";
    const bet = this.session.getTotalBetAmount();

    const creditsBefore = this.session.getCredits();
    const creditsAfter = creditsBefore; // visual-only prelude spin

    // Reset per-spin bookkeeping (mirror startSpinInternal's reset behavior).
    this.currentSpinTotalPayout = 0;
    this.cascadeMultiplier = 1;
    this.pendingFreeSpinsFromScatter = 0;
    this.pendingScatterPositions = [];
    this.postScatterCascadePositions = [];
    this.scatterOnlyTrigger = false;
    this.lastAwardedScatterCount = 0;

    this.running = true;
    this.winSequenceComplete = false;
    this.winDisplayComplete = true;
    this.lastWinningPositions = [];
    this.lastStartedSpinKind = kind;

    this.emit({ type: "SpinStarted", kind, bet, creditsBefore, creditsAfter });

    const reelsCount = this.config.reelsCount;
    const symbolsPerReel = this.config.symbolsPerReel;
    const scatterReelCount = Math.min(3, reelsCount);

    // [reelIndex][rowIndex]
    const forceMatrix: number[][] = Array.from({ length: reelsCount }, (_, reelIndex) => {
      const column: number[] = [];
      for (let rowIndex = 0; rowIndex < symbolsPerReel; rowIndex++) {
        const isScatterCell = rowIndex === 0 && reelIndex < scatterReelCount;
        const nonScatterSymbol = reelIndex % 8; // 0..7 (avoid wild=8 and scatter=9)
        column.push(isScatterCell ? SCATTER_SYMBOL_ID : nonScatterSymbol);
      }
      return column;
    });

    this.buyPreludeScatterActive = true;

    const resultPerReel = this.spinResultGenerator.generate({
      forceMatrix,
    });

    this.emit({ type: "SpinToResultRequested", resultPerReel });
  }

  private evaluateStep(visibleMatrix: number[][]): void {
    const spinConfig: SpinConfig = {
      reelsCount: this.config.reelsCount,
      symbolsPerReel: this.config.symbolsPerReel,
    };
    const outcome: SpinOutcome = this.spinEvaluator.evaluate(
      spinConfig,
      visibleMatrix,
      this.session.getTotalBetAmount(),
    );
    this.emit({ type: "OutcomeEvaluated", outcome });

    // ── 1. Collect scatter award (centralized logic) ────────────────────────
    const scatterResult = this.scatterService.evaluate(visibleMatrix);
    const count = scatterResult.count;
    let spinsAwardedThisStep = 0;

    // Rule: Award if count threshold met (3+) AND it's more than we've already handled in this sequence.
    if (count >= 3 && count > this.lastAwardedScatterCount) {
      // Logic for "upgrades": if we already awarded 10 for 3 scatters, and now have 4, we award +2 more (total 12).
      const currentConfigAward = scatterResult.freeSpinsAwarded;
      const previouslyClaimedInSequence = this.lastAwardedScatterCount >= 3
        ? (this.pendingFreeSpinsFromScatter) // Total already queued in this sequence
        : 0;

      const delta = currentConfigAward - previouslyClaimedInSequence;

      if (delta > 0) {
        spinsAwardedThisStep = delta;
        this.pendingFreeSpinsFromScatter += delta;
        this.pendingScatterPositions = scatterResult.positions;

        // If this is the FIRST trigger in the sequence, mark scatter-only if no line wins
        if (this.lastAwardedScatterCount === 0 && outcome.winningPositions.length === 0) {
          this.scatterOnlyTrigger = true;
        }
      }
      this.lastAwardedScatterCount = count;
    }

    // Attach scatter info back to outcome for UI/Event transparency
    // We show the FULL award for the current count in the outcome event.
    outcome.scatterWin = (count >= 3) ? {
      symbol: scatterResult.symbol,
      count: count,
      payout: 0,
      freeSpinsAwarded: scatterResult.freeSpinsAwarded
    } : null;
    outcome.scatterPositions = scatterResult.positions;

    // ── 2. Award line win payout ─────────────────────────────────────────────
    if (outcome.totalPayout > 0) {
      const effectivePayout = outcome.totalPayout * this.cascadeMultiplier;
      const creditsBefore = this.session.getCredits();
      this.session.addCredits(effectivePayout);
      const creditsAfter = this.session.getCredits();
      this.winLock = true;
      this.winSequenceComplete = false;
      this.winDisplayComplete = false;
      this.currentSpinTotalPayout += effectivePayout;
      if (this.session.isInFreeSpins()) this.bonusTotalPayout += effectivePayout;
      this.emit({ type: "CreditsChanged", from: creditsBefore, to: creditsAfter, animate: true });
      const totalSoFar = this.session.isInFreeSpins() ? this.bonusTotalPayout : this.currentSpinTotalPayout;
      this.emit({ type: "TotalWinChanged", totalSoFar, animate: true });
      this.emit({ type: "WinAmountAwarded", hitAmount: effectivePayout, totalSoFar, bonusText: "" });
    } else if (spinsAwardedThisStep === 0) {
      this.emit({ type: "ResultTextChanged", text: "" });
    }

    // ── 3. Trigger win sequence (cascades will follow) ───────────────────────
    if (outcome.winningPositions.length > 0) {
      this.lastWinningPositions = outcome.winningPositions;
      this.emit({
        type: "WinSequenceRequested",
        winningPositions: outcome.winningPositions,
        scatterPositions: outcome.scatterPositions,
      });
      return;
    }

    // ── 4. No line wins — go straight to continuation (scatter fires there) ──
    this.resolveContinuation();
  }

  private resolveContinuation(): void {
    this.winSequenceComplete = true;

    if (this.useBackend && this.backendPendingScatterAward) {
      const { add, positions, isRetrigger } = this.backendPendingScatterAward;
      this.backendPendingScatterAward = null;

      // Backend already updated the free-spin count in session; keep state but mirror the presentation behavior.
      if (!isRetrigger) {
        this.setPhase(GamePhase.ScatterIntro);
        this.bonusTotalPayout = 0;
        this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
        this.emit({ type: "FreeSpinsChanged", remaining: this.session.getFreeSpinsRemaining(), mode: "entered" });
      } else {
        this.emit({ type: "FreeSpinsChanged", remaining: this.session.getFreeSpinsRemaining(), mode: "updated" });
      }

      if (positions.length > 0) {
        if (isRetrigger) {
          this.postScatterCascadePositions = positions;
        }
        this.scatterSequenceActive = true;
        this.emit({
          type: "ScatterBonusSequenceRequested",
          scatterPositions: positions,
          freeSpinsAwarded: add,
          isRetrigger,
        });
        return;
      }
    }

    // If scatter bonus was queued, fire it now — board is fully settled.
    if (this.pendingFreeSpinsFromScatter > 0) {
      const queued = this.pendingFreeSpinsFromScatter;
      const positions = this.pendingScatterPositions;
      const scatterOnly = this.scatterOnlyTrigger;

      this.pendingFreeSpinsFromScatter = 0;
      this.pendingScatterPositions = [];
      this.scatterOnlyTrigger = false;

      const isRetrigger = this.session.isInFreeSpins();

      this.awardFreeSpinsWithPresentation(queued, isRetrigger);

      // Fire the scatter visual sequence. onScatterSequenceFinished() will
      // call resolveContinuation() again once the animation completes.
      if (positions.length > 0) {
        // ONLY trigger a "scatter removal cascade" (dropping new symbols to fill holes)
        // if we are ALREADY in free spins (i.e. this is a re-trigger).
        // For the INITIAL trigger from Normal Mode, we skip the cascade to ensure
        // a completely fresh board for the first Free Spin.
        if (isRetrigger) {
          this.postScatterCascadePositions = positions;
        }
        this.scatterSequenceActive = true;
        this.emit({
          type: "ScatterBonusSequenceRequested",
          scatterPositions: positions,
          freeSpinsAwarded: queued,
          isRetrigger,
        });
        return;
      }
      // No positions to animate — fall through to normal continuation.
    }

    // Free-spin continuation after a spin that has fully resolved (wins/cascades/scatter done).
    //
    // Backend mode: `onSpinStopped` already applied `data.free_spin.count` (remaining after this
    // round). Do NOT call `consumeFreeSpin()` — that would double-decrement vs the server.
    //
    // Local mode: remaining count is only tracked here via `consumeFreeSpin()`.
    if (this.lastStartedSpinKind === "free") {
      if (this.useBackend) {
        const remaining = this.session.getFreeSpinsRemaining();
        if (remaining > 0) {
          this.emit({ type: "FreeSpinsChanged", remaining, mode: "updated" });
          this.emit({ type: "RequestNextSpin", afterMs: 1200, reason: "freeSpin" });
        } else {
          this.setPhase(GamePhase.PostBonusSummary);
          this.emit({
            type: "BonusCompleted",
            totalWin: this.bonusTotalPayout,
            bet: this.session.getTotalBetAmount(),
          });
        }
      } else if (this.session.isInFreeSpins()) {
        const remaining = this.session.consumeFreeSpin();
        if (remaining > 0) {
          this.emit({ type: "FreeSpinsChanged", remaining, mode: "updated" });
          this.emit({ type: "RequestNextSpin", afterMs: 1200, reason: "freeSpin" });
        } else {
          this.setPhase(GamePhase.PostBonusSummary);
          this.emit({
            type: "BonusCompleted",
            totalWin: this.bonusTotalPayout,
            bet: this.session.getTotalBetAmount(),
          });
        }
      }
      return;
    }

    if (this.session.isInFreeSpins()) {
      // Entered/retriggered free spins: kick off the first free spin (no consumption yet).
      this.setPhase(GamePhase.FreeSpins);
      this.emit({ type: "RequestNextSpin", afterMs: 0, reason: "freeSpin" });
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

  private awardFreeSpinsWithPresentation(count: number, isRetrigger: boolean): void {
    if (count <= 0) return;

    if (this.session.isAutoSpinActive()) {
      this.session.cancelAutoSpin();
      this.emit({ type: "AutoSpinChanged", active: false, remaining: 0 });
    }

    this.session.awardFreeSpins(count);
    if (!isRetrigger) {
      this.setPhase(GamePhase.ScatterIntro);
      this.bonusTotalPayout = 0;
      this.emit({ type: "TotalWinChanged", totalSoFar: 0, animate: false });
    }
    this.emit({
      type: "FreeSpinsChanged",
      remaining: this.session.getFreeSpinsRemaining(),
      mode: isRetrigger ? "updated" : "entered",
    });
  }

  private setPhase(next: GamePhase): void {
    if (this.phase === next) return;
    const from = this.phase;
    this.phase = next;
    this.emit({ type: "GamePhaseChanged", from, to: next });
  }
}

