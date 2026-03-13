//uiPorts.ts
/**
 * UI ports used by the Application layer.
 *
 * These are intentionally framework-agnostic (no PIXI imports).
 * The UI layer (e.g. PIXI) provides adapters that implement these interfaces.
 */

export interface TextView {
  text: string;
  visible: boolean;
  alpha: number;
  scale: { x: number; y: number };

  setText(text: string): void;
  setVisible(visible: boolean): void;
  setAlpha(alpha: number): void;
  setScale(x: number, y: number): void;
}

export interface SlotInfoView {
  setDefault(): void;
  setAutoSpin(remaining: number): void;
  setFreeSpin(count: number): void;
  setFreeSpinCount(count: number): void;
  /**
   * Show a one-shot "bonus free spins awarded" message (e.g. after 3 scatters).
   * The UI layer decides exact wording and animation.
   */
  showBonusFreeSpinsAwarded(count: number): void;
}

export interface DimOverlayView {
  visible: boolean;
  setVisible(visible: boolean): void;
}

export interface AutoSpinButtonsView {
  showStart(): void;
  showStop(): void;
}

export interface GameControllerUI {
  creditsText: TextView;
  resultText: TextView;
  amountLabel: TextView;
  slotInfo: SlotInfoView;
  totalWinText: TextView;
  dimOverlay: DimOverlayView;
  autoSpinButtons: AutoSpinButtonsView;
}

