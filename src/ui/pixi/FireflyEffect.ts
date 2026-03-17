//FireflyEffect.ts
import * as PIXI from "pixi.js";

interface Firefly {
  sprite: PIXI.Sprite;
  baseX: number; // For drift calculation
  x: number;
  y: number;
  speedY: number;
  driftSpeed: number;
  driftOffset: number;
  alphaSpeed: number;
  alphaOffset: number;
}

export class FireflyEffect {
  private readonly container: PIXI.Container;
  private readonly fireflies: Firefly[] = [];
  
  private readonly fireflyCount = 60;
  private isVisible = false;

  constructor(
    private readonly app: PIXI.Application,
    private readonly parentLayer: PIXI.Container,
    private readonly fireflyTexture: PIXI.Texture
  ) {
    this.container = new PIXI.Container();
    this.container.visible = false;
    this.parentLayer.addChild(this.container);

    this._initFireflies();
  }

  static async loadTexture(): Promise<PIXI.Texture> {
    // Reusing star texture for fireflies as it's a soft glow
    return await PIXI.Assets.load('https://pixijs.com/assets/star.png');
  }

  private _initFireflies(): void {
    for (let i = 0; i < this.fireflyCount; i++) {
        const firefly: Firefly = {
            sprite: new PIXI.Sprite(this.fireflyTexture),
            baseX: 0,
            x: 0,
            y: 0,
            speedY: 0,
            driftSpeed: 0,
            driftOffset: 0,
            alphaSpeed: 0,
            alphaOffset: 0
        };

        firefly.sprite.anchor.set(0.5);
        // Soft warm yellow for firefly
        firefly.sprite.tint = "0xFFE082"; 
        firefly.sprite.scale.set(0.04 + Math.random() * 0.04);
        
        this._randomizeFirefly(firefly, true);
        this.container.addChild(firefly.sprite);
        this.fireflies.push(firefly);
    }
  }

  private _randomizeFirefly(firefly: Firefly, initial = false): void {
    const screenW = this.app.renderer.screen.width;
    const screenH = this.app.renderer.screen.height;

    // Spawn across the entire bottom width
    firefly.baseX = Math.random() * screenW;

    if (initial) {
        firefly.y = Math.random() * screenH;
    } else {
        firefly.y = screenH + 50;
    }

    // Slower vertical speed
    firefly.speedY = 0.3 + Math.random() * 0.7;
    // Slower horizontal drift
    firefly.driftSpeed = 0.0005 + Math.random() * 0.001;
    firefly.driftOffset = Math.random() * Math.PI * 2;
    // Slower alpha pulsing for calm effect
    firefly.alphaSpeed = 0.01 + Math.random() * 0.02;
    firefly.alphaOffset = Math.random() * Math.PI * 2;
  }

  public setWarp(active: boolean): void {
    // Warp speed isn't used for fireflies, but we keep the method for consistency with GameController deps
    // Maybe increase speed slightly if "warp" is active?
  }

  public show(): void {
    this.isVisible = true;
    this.container.visible = true;
    this.container.zIndex = 10000;
  }

  public hide(): void {
    this.isVisible = false;
    this.container.visible = false;
  }

  public update(ticker: PIXI.Ticker): void {
    if (!this.isVisible) return;

    const delta = ticker.deltaTime;
    const time = performance.now();

    for (const f of this.fireflies) {
        // Upward movement
        f.y -= f.speedY * delta;

        // Horizontal drift (sine wave)
        const drift = Math.sin(time * f.driftSpeed + f.driftOffset) * 40;
        f.sprite.x = f.baseX + drift;
        f.sprite.y = f.y;

        // Alpha pulsing (bioluminescence)
        f.sprite.alpha = 0.4 + Math.sin(time * f.alphaSpeed + f.alphaOffset) * 0.4;

        // Reset if off-screen top
        if (f.y < -50) {
            this._randomizeFirefly(f);
        }
    }
  }
}
