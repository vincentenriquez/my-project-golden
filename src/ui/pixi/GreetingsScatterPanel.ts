/**
 * GreetingsScatterPanel.ts
 *
 * Displays the GREETINGS_SCATTER.png screen after the Scatter intro effect.
 * It waits for the player to tap/click anywhere before proceeding, ensuring
 * that free spins do not start automatically without user interaction.
 */
import { Application, Container, Sprite, Assets, Rectangle } from "pixi.js";

export interface ReelBounds {
  /** Reel viewport width  in gameContainer local px (REEL_WIDTH × REELS_COUNT). */
  frameWidth: number;
  /** Reel viewport height in gameContainer local px ((SYMBOL_SIZE + ROW_PADDING) × SYMBOLS_PER_REEL). */
  frameHeight: number;
  /** mask.x — reel viewport left edge in gameContainer local coords. */
  originX: number;
  /** mask.y — reel viewport top  edge in gameContainer local coords. */
  originY: number;
}

const GREETINGS_ASSET = "/GREETINGS_SCATTER.png";

export class GreetingsScatterPanel {
  private readonly app: Application;
  private readonly layer: Container;
  private readonly bounds: ReelBounds;
  
  private container: Container;
  private sprite: Sprite | null = null;
  private clickHandler: (() => void) | null = null;
  private hiding = false;

  static async preload(): Promise<void> {
    await Assets.load(GREETINGS_ASSET);
  }

  constructor(app: Application, layer: Container, bounds: ReelBounds) {
    this.app = app;
    this.layer = layer;
    this.bounds = bounds;
    
    this.container = new Container();
    this.container.visible = false;
    this.container.zIndex = 110; // ensure it sits on top of stageOverLayer
    this.layer.addChild(this.container);
  }

  /**
   * Shows the panel and waits for a click/tap.
   * Ensures duplicate clicks aren't registered.
   * 
   * @param onTap Callback fired exactly once when the user clicks/taps.
   */
  show(onTap: () => void): void {
    if (this.hiding || this.container.visible) return;

    this.container.removeChildren();
    
    const texture = Assets.get(GREETINGS_ASSET);
    if (!texture) {
      console.warn("GreetingsScatterPanel: Asset not loaded!");
      onTap(); // fail-safe: just proceed if asset is missing
      return;
    }

    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    
    // Position exactly in the center of the reel mask viewport
    const { frameWidth, frameHeight, originX, originY } = this.bounds;
    this.sprite.x = originX + frameWidth / 2;
    this.sprite.y = originY + frameHeight / 1.90;
    
    // Fit precisely to the reel width (keeping aspect ratio)
    const scale = frameWidth / this.sprite.texture.width;
    this.sprite.scale.set(scale);

    this.container.addChild(this.sprite);
    this.container.alpha = 0;
    this.container.visible = true;

    // Fade in
    this._fadeAlpha(0, 1, 300, () => {
      // Register click/tap listener ONLY after faded in
      this._registerClickListener(onTap);
    });
  }

  private _registerClickListener(onTap: () => void): void {
    // 1. Make the stage interactive if it isn't strictly already
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    
    // 2. Define the single-use handler
    this.clickHandler = () => {
      // Remove listener immediately to prevent double-taps
      this.app.stage.off("pointerdown", this.clickHandler!);
      this.clickHandler = null;
      
      // Hide visually, then trigger callback
      this.hide(onTap);
    };

    // 3. Attach listener
    this.app.stage.on("pointerdown", this.clickHandler);
  }

  private hide(onComplete?: () => void): void {
    if (this.hiding) return;
    this.hiding = true;

    // Safety cleanup just in case hide was called manually before click
    if (this.clickHandler) {
      this.app.stage.off("pointerdown", this.clickHandler);
      this.clickHandler = null;
    }

    this._fadeAlpha(1, 0, 300, () => {
      this.container.visible = false;
      this.container.removeChildren();
      this.sprite?.destroy();
      this.sprite = null;
      this.hiding = false;
      
      onComplete?.();
    });
  }

  /** Same simple requestAnimationFrame fader as FireFrameEffect */
  private _fadeAlpha(from: number, to: number, durationMs: number, onDone?: () => void): void {
    const start = performance.now();
    const tick = (now: number) => {
      if (!this.container) return; // safety
      const t = Math.min(1, (now - start) / durationMs);
      this.container.alpha = from + (to - from) * t;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.container.alpha = to;
        onDone?.();
      }
    };
    requestAnimationFrame(tick);
  }
}
