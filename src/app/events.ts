import type { SpinOutcome, WinningPosition } from "../domain/SpinEngine";

export type SpinKind = "paid" | "free";

export type GameEvent =
  | { type: "SpinBlocked"; reason: "running" | "winLock" | "autoSpinActive" | "insufficientCredits" }
  | { type: "SpinStarted"; kind: SpinKind; bet: number; creditsBefore: number; creditsAfter: number }
  | { type: "SpinToResultRequested"; resultPerReel: number[][] }
  | { type: "SpinStopped"; visibleMatrix: number[][] }
  | { type: "OutcomeEvaluated"; outcome: SpinOutcome }
  | { type: "WinAmountAwarded"; hitAmount: number; totalSoFar: number; bonusText: string }
  | { type: "CreditsChanged"; from: number; to: number; animate: boolean }
  | { type: "BetChanged"; from: number; to: number; animate: boolean }
  | { type: "TotalWinChanged"; totalSoFar: number; animate: boolean }
  | { type: "ResultTextChanged"; text: string }
  | { type: "FreeSpinsChanged"; remaining: number; mode: "entered" | "updated" | "ended" }
  | { type: "AutoSpinChanged"; active: boolean; remaining: number }
  | { type: "WinSequenceRequested"; winningPositions: WinningPosition[] }
  | { type: "CascadeRequested"; winningPositions: WinningPosition[] }
  | { type: "RequestNextSpin"; afterMs: number; reason: "freeSpin" | "autoSpin" }
  | { type: "SpinFinished" };

export type GameEventListener = (event: GameEvent) => void;

