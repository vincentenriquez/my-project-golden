import * as PIXI from "pixi.js";

interface PhysicsSymbol {
  sprite: PIXI.Sprite;
  targetY: number;
  velocity: number;
  isLanded: boolean;
  baseScale: number;
  squash: number; // Deformation amount
}

export class ScatterIntroEffect {
  private readonly container: PIXI.Container;
  private physicsSymbols: PhysicsSymbol[] = [];
  private tickerCallback: ((ticker: { deltaMS: number }) => void) | null = null;
  private completionCallback: (() => void) | null = null;
  
  private spawnedRows = 0;
  private spawnTimer = 0;
  private totalRows = 0;
  private totalCols = 0;
  
  private readonly visualSize = 150; // Visual size for scaling
  private readonly gridSpacing = 50; // Tighter spacing for "compressed" look
  private readonly rowSpawnInterval = 300; 
  private readonly gravity = 0.8;

  private static readonly SYMBOL_FRAMES = [
    "/cherry.png",
    "/orangeSlice.png",
    "/lemonSlice.png",
    "/plums.png",
    "/grapes.png",
    "/watermelonSlice.png",
    "/strawberrySlice.png",
    "/mangoSlice.png",
  ];

  constructor(
    private readonly app: PIXI.Application,
    private readonly layer: PIXI.Container,
  ) {
    this.container = new PIXI.Container();
    this.container.visible = false;
    this.layer.addChild(this.container);
  }

  static async preload(): Promise<void> {
    // Explicitly preload all fruits used in the intro
    await PIXI.Assets.load(ScatterIntroEffect.SYMBOL_FRAMES);
  }

  showFor(durationMs: number, onComplete: () => void): void {
    this.completionCallback = onComplete;
    this.show();
  }

  private show(): void {
    this.container.visible = true;
    this.container.removeChildren();
    this.physicsSymbols = [];
    this.spawnTimer = 0;

    const screenW = this.app.renderer.screen.width;
    const screenH = this.app.renderer.screen.height;

    // Calculate grid dimensions based on tighter spacing
    this.totalCols = Math.ceil(screenW / this.gridSpacing) + 1;
    this.totalRows = Math.ceil(screenH / this.gridSpacing) + 1;
    
    // Start from the bottom row and spawn upwards
    this.spawnedRows = this.totalRows - 1;

    this._startTicker();
  }

  private hide(): void {
    this._stopTicker();
    this.container.visible = false;
    this.container.removeChildren();
    this.physicsSymbols = [];
  }

  onResize(): void {
    // transient
  }

  private _spawnRow(rowIndex: number): void {
    const frames = ScatterIntroEffect.SYMBOL_FRAMES;
    for (let col = 0; col < this.totalCols; col++) {
      const frameName = frames[Math.floor(Math.random() * frames.length)];
      const sprite = PIXI.Sprite.from(frameName);

      const targetY = rowIndex * this.gridSpacing + this.gridSpacing / 2;
      
      sprite.x = col * this.gridSpacing + this.gridSpacing / 2;
      sprite.y = -300 - (rowIndex * 150); // Start higher up
      sprite.anchor.set(0.5);
      
      let baseScale = 1;
      const maxDim = Math.max(sprite.texture.width, sprite.texture.height);
      if (maxDim > 0) {
        baseScale = this.visualSize / maxDim;
      }
      sprite.scale.set(baseScale);
      sprite.rotation = Math.random() * Math.PI * 2;

      this.physicsSymbols.push({
        sprite,
        targetY,
        velocity: 5 + Math.random() * 15,
        isLanded: false,
        baseScale,
        squash: 0
      });
      this.container.addChild(sprite);
    }
  }

  private _startTicker(): void {
    this.tickerCallback = (t: { deltaMS: number }) => {
      // 1. Spawning logic
      if (this.spawnedRows >= 0) {
        this.spawnTimer += t.deltaMS;
        if (this.spawnTimer >= this.rowSpawnInterval) {
          this._spawnRow(this.spawnedRows);
          this.spawnedRows--;
          this.spawnTimer = 0;
        }
      }

      // 2. Physics / Animation logic
      for (const p of this.physicsSymbols) {
        if (!p.isLanded) {
          p.velocity += this.gravity;
          p.sprite.y += p.velocity;

          if (p.sprite.y >= p.targetY) {
            const impactForce = p.velocity;
            p.sprite.y = p.targetY;
            p.isLanded = true;
            p.velocity = 0;
            // Intensified squash based on impact force
            p.squash = Math.min(0.7, impactForce * 0.05);
          }
        }

        // Apply and recover squash (vertical compression, horizontal expansion)
        if (p.isLanded && p.squash > 0) {
          p.squash *= Math.pow(0.94, t.deltaMS / 16); // Decay independent of frame rate
          if (p.squash < 0.005) p.squash = 0;
          
          p.sprite.scale.y = p.baseScale * (1 - p.squash);
          p.sprite.scale.x = p.baseScale * (1 + p.squash);
        } else if (p.isLanded) {
          p.sprite.scale.set(p.baseScale);
        }

        // Always rotate slowly for life
        p.sprite.rotation += 0.02;
      }

      // 3. Completion check
      if (this.spawnedRows < 0 && this.physicsSymbols.length > 0) {
        const allLanded = this.physicsSymbols.every(p => p.isLanded && p.squash === 0);
        if (allLanded && this.completionCallback) {
          const callback = this.completionCallback;
          this.completionCallback = null;
          // Hold the grid for a moment before clearing
          setTimeout(() => {
            this.hide();
            callback();
          }, 50);
        }
      }
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