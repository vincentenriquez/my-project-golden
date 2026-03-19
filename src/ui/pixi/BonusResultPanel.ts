import { Application, Container, Rectangle } from "pixi.js";
import {
  PostBonusPresentationCoordinator,
  type BonusResultData,
} from "./PostBonusPresentationCoordinator";
import { YouWinContainer } from "./YouWinContainer";
import { WinTierSequenceContainer } from "./WinTierSequenceContainer";

export class BonusResultPanel {
  private readonly root: Container;
  private readonly coordinator: PostBonusPresentationCoordinator;
  private presenting = false;
  private presentationDone = false;
  private clickHandler: (() => void) | null = null;
  private autoCloseTimer: number | null = null;
  private onDismissRef: (() => void) | null = null;
  private dismissing = false;

  private readonly AUTO_CLOSE_MS = 5000;

  constructor(app: Application, layer: Container) {
    this.app = app;
    this.root = new Container();
    this.root.visible = false;
    this.root.zIndex = 200;
    layer.addChild(this.root);

    const youWinContainer = new YouWinContainer(
      this.root,
      app.screen.width,
      app.screen.height,
    );
    const tierSequenceContainer = new WinTierSequenceContainer(
      this.root,
      app.screen.width,
      app.screen.height,
    );
    this.coordinator = new PostBonusPresentationCoordinator(
      youWinContainer,
      tierSequenceContainer,
    );
  }

  private app!: Application;

  show(data: BonusResultData, onDismiss: () => void): void {
    if (this.presenting) return;
    this.presenting = true;
    this.dismissing = false;
    this.onDismissRef = onDismiss;
    this.presentationDone = false;

    this.root.visible = true;

    // Restore original interaction semantics: tap/click anywhere dismisses.
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);

    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    // Presentation sequence should not auto-dismiss the panel.
    // We keep the overlay visible until click or auto-close (original behavior).
    void this.coordinator.present(data, () => {
      this.presentationDone = true;
      // Start auto-close only after presentation completes (prevents mid-sequence dismiss).
      if (this.autoCloseTimer !== null) clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = window.setTimeout(() => this.dismiss(), this.AUTO_CLOSE_MS);
    });

    // Avoid immediate-dismiss on the same pointer event that triggered BonusCompleted.
    // Register the click handler on the next frame, and gate dismissal until presentationDone.
    requestAnimationFrame(() => {
      if (!this.presenting) return;
      if (this.clickHandler) {
        this.app.stage.off("pointerdown", this.clickHandler);
        this.clickHandler = null;
      }
      this.clickHandler = () => {
        if (!this.presentationDone) return;
        this.dismiss();
      };
      this.app.stage.on("pointerdown", this.clickHandler);
    });
  }

  private dismiss(): void {
    if (!this.presenting || this.dismissing) return;
    this.dismissing = true;

    this.root.visible = false;
    this.presenting = false;

    if (this.clickHandler) {
      this.app.stage.off("pointerdown", this.clickHandler);
      this.clickHandler = null;
    }
    if (this.autoCloseTimer !== null) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }

    this.coordinator.cancel();
    this.onDismissRef?.();
    this.onDismissRef = null;
    this.dismissing = false;
  }

  destroy(): void {
    this.coordinator.destroy();
    this.root.removeChildren();
    this.root.destroy();
  }
}
