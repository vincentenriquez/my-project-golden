//events.ts
import type { SpinOutcome, WinningPosition } from "../domain/SpinEngine";
import type { GamePhase } from "../domain/GamePhase";

export type SpinKind = "paid" | "free";

export type GameEvent =
  | { type: "SpinBlocked"; reason: "running" | "winLock" | "autoSpinActive" | "insufficientCredits" | "postBonus" }
  | { type: "SpinStarted"; kind: SpinKind; bet: number; creditsBefore: number; creditsAfter: number }
  | { type: "SpinToResultRequested"; resultPerReel: number[][] }
  | { type: "SpinStopped"; visibleMatrix: number[][] }
  | { type: "OutcomeEvaluated"; outcome: SpinOutcome }
  | { type: "WinAmountAwarded"; hitAmount: number; totalSoFar: number; bonusText: string }
  | { type: "CreditsChanged"; from: number; to: number; animate: boolean }
  | { type: "BetChanged"; from: number; to: number; animate: boolean }
  | { type: "TotalWinChanged"; totalSoFar: number; animate: boolean }
  | { type: "ResultTextChanged"; text: string }
  | { type: "FreeSpinsChanged"; remaining: number; mode: "entered" | "updated" | "ended"; awarded?: number }
  | { type: "AutoSpinChanged"; active: boolean; remaining: number }
  | { type: "WinSequenceRequested"; winningPositions: WinningPosition[]; scatterPositions: WinningPosition[] }
  | { type: "ScatterBonusSequenceRequested"; scatterPositions: WinningPosition[]; freeSpinsAwarded: number; isRetrigger: boolean }
  | { type: "CascadeRequested"; winningPositions: WinningPosition[]; nextGridPerReel?: number[][] }
  | { type: "ScatterCascadeRequested"; scatterPositions: WinningPosition[] }
  | { type: "RequestNextSpin"; afterMs: number; reason: "freeSpin" | "autoSpin" }
  | { type: "SpinFinished" }
  | { type: "BonusCompleted"; totalWin: number; bet: number }
  | { type: "BonusResultDismissed" }
  | { type: "PostBonusTransitionStarted" }
  | { type: "PostBonusTransitionComplete" }
  | { type: "GamePhaseChanged"; from: GamePhase; to: GamePhase }
  | { type: "BuyFreeSpinsBlocked"; reason: "running" | "winLock" | "inFreeSpins" | "autoSpinActive" | "insufficientCredits" };

export type GameEventListener = (event: GameEvent) => void;