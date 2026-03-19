import { type YouWinContainer } from "./YouWinContainer";
import { type WinTierSequenceContainer } from "./WinTierSequenceContainer";

export interface BonusResultData {
  totalWin: number;
  bet: number;
}

/**
 * UI-level state coordinator for post-bonus presentation.
 * Flow:
 * BonusEnd -> ShowYouWin -> ShowWinTierSequence -> Complete
 */
export class PostBonusPresentationCoordinator {
  private running = false;
  private presentationToken = 0;

  constructor(
    private readonly youWinContainer: YouWinContainer,
    private readonly tierSequenceContainer: WinTierSequenceContainer,
  ) {}

  async present(data: BonusResultData, onComplete: () => void): Promise<void> {
    if (this.running) return;
    this.running = true;
    const token = ++this.presentationToken;

    try {
      await this.youWinContainer.show(data.totalWin);
      if (token !== this.presentationToken) return;

      await this.tierSequenceContainer.show(data.totalWin, data.bet);
      if (token !== this.presentationToken) return;

      onComplete();
    } finally {
      if (token === this.presentationToken) {
        this.running = false;
      }
    }
  }

  destroy(): void {
    this.presentationToken++;
    this.running = false;
    this.youWinContainer.destroy();
    this.tierSequenceContainer.destroy();
  }

  cancel(): void {
    this.presentationToken++;
    this.running = false;
    this.youWinContainer.cancel();
    this.tierSequenceContainer.cancel();
  }
}

