// src/ui/pixi/ScatterIntroEffect.ts
import { Application, Assets, Container, Sprite } from "pixi.js";

export class ScatterIntroEffect {
  private readonly alienContainer: Container;
  private aliens: Sprite[] = [];
  private count = 0;
  private tickerCallback: ((ticker: { deltaTime: number }) => void) | null = null;

  private static readonly ALIEN_FRAMES = [
    "/cherry.png",
  "/strawberry.png",
  "/watermelonSlice.png",
  "/plums.png",
  "/grapes.png",
  "/lemonSlice.png",
  "/mangoSlice.png",
  "/orangeSlice.png",
  ];
  private static readonly ALIEN_COUNT = 1000;

  /**
   * @param app     - Your existing PIXI Application instance
   * @param layer   - The Container layer to attach to (use overlayLayer for top z-index)
   */
  constructor(
    private readonly app: Application,
    private readonly layer: Container,
  ) {
    this.alienContainer = new Container();
    this.alienContainer.visible = false;
    this.layer.addChild(this.alienContainer);
  }

  static async preload(): Promise<void> {
    await Assets.load("https://pixijs.com/assets/spritesheet/monsters.json");
  }

    showFor(durationMs: number, onComplete: () => void): void {
      this.show();

      setTimeout(() => {
        this.hide();
        onComplete();
      }, durationMs);
    }

    private show(): void {
      this.alienContainer.x = this.app.screen.width / 2;
      this.alienContainer.y = this.app.screen.height / 2;
      this.alienContainer.scale.set(1);
      this.alienContainer.rotation = 0;
      this.alienContainer.visible = true;
      this.count = 0;
      this._spawnAliens();
      this._startTicker();
    }

    private hide(): void {
      this._stopTicker();
      this.alienContainer.visible = false;
      this.alienContainer.removeChildren();
      this.aliens = [];
    }

    /** Call when the renderer resizes to keep the container centered on screen. */
    onResize(): void {
    if (!this.alienContainer.visible) return;
    this.alienContainer.x = this.app.screen.width / 2;
    this.alienContainer.y = this.app.screen.height / 2;
    }

  private _spawnAliens(): void {
    this.alienContainer.removeChildren();
    this.aliens = [];

    for (let i = 0; i < ScatterIntroEffect.ALIEN_COUNT; i++) {
      const frameName = ScatterIntroEffect.ALIEN_FRAMES[i % 8];
      const alien = Sprite.from(frameName);

      alien.x = (Math.random() - 0.5) * this.app.screen.width * 2;
      alien.y = (Math.random() - 0.5) * this.app.screen.height * 2;
      alien.anchor.set(0.5);

      this.aliens.push(alien);
      this.alienContainer.addChild(alien);
    }
  }

  private _startTicker(): void {
    this.tickerCallback = () => {
      for (const alien of this.aliens) {
        alien.rotation += 0.9;
      }
      this.count += 0.1;
      this.alienContainer.scale.x = Math.sin(this.count);
      this.alienContainer.scale.y = Math.sin(this.count);
      this.alienContainer.rotation += 0.19;
    };
    this.app.ticker.add(this.tickerCallback);
  }

  private _stopTicker(): void {
    if (this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
  }
}