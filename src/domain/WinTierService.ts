/**
 * WinTierService.ts
 *
 * Pure domain service: determines a celebration tier based on totalWin / bet ratio.
 * No UI or framework dependencies — reusable for any bonus type.
 */

export type WinTier = "none" | "win" | "bigWin" | "megaWin" | "epicWin";

export interface WinTierThresholds {
  bigWin: number;
  megaWin: number;
  epicWin: number;
}

const DEFAULT_THRESHOLDS: WinTierThresholds = {
  bigWin: 10,
  megaWin: 25,
  epicWin: 50,
};

export function determineWinTier(
  totalWin: number,
  bet: number,
  thresholds: WinTierThresholds = DEFAULT_THRESHOLDS,
): WinTier {
  if (totalWin <= 0 || bet <= 0) return "none";

  const ratio = totalWin / bet;

  if (ratio >= thresholds.epicWin) return "epicWin";
  if (ratio >= thresholds.megaWin) return "megaWin";
  if (ratio >= thresholds.bigWin) return "bigWin";
  return "win";
}

export const WIN_TIER_LABELS: Record<WinTier, string> = {
  none: "",
  win: "YOU WIN",
  bigWin: "BIG WIN!",
  megaWin: "MEGA WIN!",
  epicWin: "EPIC WIN!",
};
