/**
 * FireFrameEffect.ts
 *
 * Displays a looping fire animation over the reels during Scatter (free spin) mode.
 * The animation is sourced from `/fire_frame.json` and `/fire_frame.png`.
 *
 * Architecture
 * ────────────
 * Follows the same pattern as `FireflyEffect` and `ScatterIntroEffect`:
 *   • `static preload()` — call once in main.ts alongside other preloads
 *   • Constructor takes the host layer and reel bounds
 *   • `show()` / `hide()` called from the `FreeSpinsChanged` event handler
 *
 * Layer placement
 * ───────────────
 * Lives on `fireLayer` at zIndex 22 — above the reel frame decoration (20)
 * but below win highlights (30), ensuring fire never covers glow/ray effects.
 */
import { Assets, Spritesheet, AnimatedSprite, Container, type Texture } from "pixi.js";

interface ReelBounds {
  /** Reel viewport width  in gameContainer local px (REEL_WIDTH × REELS_COUNT). */
  frameWidth: number;
  /** Reel viewport height in gameContainer local px ((SYMBOL_SIZE + ROW_PADDING) × SYMBOLS_PER_REEL). */
  frameHeight: number;
  /** mask.x — reel viewport left edge in gameContainer local coords. */
  originX: number;
  /** mask.y — reel viewport top  edge in gameContainer local coords. */
  originY: number;
}

const FIRE_JSON_KEY = "/fire_frame.json";
const ANIM_KEY     = "ezgif-frame";
const FRAME_W      = 964.2;   // native frame width  from fire_frame.json
const FRAME_H      = 505;   // native frame height from fire_frame.json

export class FireFrameEffect {
  private readonly layer: Container;
  private readonly bounds: ReelBounds;
  private sprite: AnimatedSprite | null = null;
  private hiding = false;

  static async preload(): Promise<void> {
    await Assets.load(FIRE_JSON_KEY);
  }

  constructor(layer: Container, bounds: ReelBounds) {
    this.layer  = layer;
    this.bounds = bounds;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Show the fire overlay. Safe to call even if already showing. */
  show(): void {
    this.hiding = false;

    if (this.sprite) return; // Already visible — nothing to do.

    const sheet = Assets.get(FIRE_JSON_KEY) as Spritesheet | undefined;
    if (!sheet || !sheet.animations[ANIM_KEY]) {
      console.warn("FireFrameEffect: sheet not loaded or animation key missing.");
      return;
    }

    const sprite = new AnimatedSprite(sheet.animations[ANIM_KEY] as Texture[]);
    sprite.animationSpeed = 0.4;    // ~24 fps feel at 60-tick renderer
    sprite.loop            = true;
    sprite.blendMode = "add";

    // ── Position: centred on the reel viewport ──────────────────────────────
    // The fire frames are (FRAME_W × FRAME_H). We scale them to fill the reel
    // area exactly, then anchor at centre so the sprite's origin matches the
    // reel viewport centre.
    const { frameWidth, frameHeight, originX, originY } = this.bounds;
    const scaleX = frameWidth  / FRAME_W;
    const scaleY = frameHeight / FRAME_H;

    sprite.anchor.set(0.5);
    sprite.scale.set(scaleX, scaleY);

    // Centre of the reel viewport in gameContainer local coordinates
    sprite.x = originX + frameWidth  / 2;
    sprite.y = originY + frameHeight / 2 + 11.5;

    sprite.alpha = 0;
    this.layer.addChild(sprite);
    sprite.play();

    // Fade in
    this._fadeAlpha(sprite, 0, 0.75, 500);

    this.sprite = sprite;
  }

  /** Hide the fire overlay with a fade-out. Safe to call if not showing. */
  hide(): void {
    if (!this.sprite || this.hiding) return;
    this.hiding = true;

    const target = this.sprite;
    this._fadeAlpha(target, target.alpha, 0, 400, () => {
      target.stop();
      if (target.parent) target.parent.removeChild(target);
      target.destroy();
      if (this.sprite === target) {
        this.sprite = null;
      }
      this.hiding = false;
    });
  }

  /** Immediately remove without fading (e.g. on hard reset). */
  destroy(): void {
    if (this.sprite) {
      this.sprite.stop();
      if (this.sprite.parent) this.sprite.parent.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Simple requestAnimationFrame-based alpha fade — no dependency on the
   * tween system, keeping this class fully self-contained.
   */
  private _fadeAlpha(
    sprite: AnimatedSprite,
    from: number,
    to: number,
    durationMs: number,
    onDone?: () => void
  ): void {
    const start = performance.now();
    const tick = (now: number) => {
      if (!sprite.parent) { onDone?.(); return; } // sprite was already removed
      const t = Math.min(1, (now - start) / durationMs);
      sprite.alpha = from + (to - from) * t;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        sprite.alpha = to;
        onDone?.();
      }
    };
    requestAnimationFrame(tick);
  }
}
