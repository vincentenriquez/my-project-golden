import type { FireFrameEffect } from "./FireFrameEffect";
import type { ScatterIntroEffect } from "./ScatterIntroEffect";
import type { PixiSlotInfoView } from "./GameViews";

export type PostBonusTransitionDeps = {
  scatterIntroEffect: ScatterIntroEffect;
  slotInfoView: PixiSlotInfoView;
  changeFrame: (img: string) => void;
  setScatterModeUi: (active: boolean) => void;
  setStarfieldWarp: (active: boolean) => void;
  fireFrameEffect?: FireFrameEffect;
};

export class PostBonusTransitionController {
  constructor(
    private readonly deps: PostBonusTransitionDeps,
    private readonly durationMs: number = 2000,
  ) {}

  start(onComplete: () => void): void {
    this.deps.scatterIntroEffect.showFor(this.durationMs, () => {
      this.deps.slotInfoView.setDefault();
      this.deps.changeFrame("/BASIC_GAME.png");
      this.deps.setScatterModeUi(false);
      this.deps.setStarfieldWarp(false);
      this.deps.fireFrameEffect?.hide();
      onComplete();
    });
  }
}

