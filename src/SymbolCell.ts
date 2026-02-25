import { Container, Sprite, Graphics, Texture } from "pixi.js";

/**
 * SymbolCell — one Container per visible symbol slot.
 *
 * Win highlight is a TWO-LAYER glow system:
 *   1. glowRing    (Graphics) — static soft outer halo + inner ring, drawn once.
 *                               Alpha is driven externally via showGlow(alpha).
 *   2. raysGraphics (Graphics) — 8 tapered light-ray spokes that rotate.
 *                               Redrawn each frame ONLY when win is active.
 *                               Kept separate so glowRing has zero per-frame GC cost.
 *
 * Symbol sprite uses a circular Graphics mask so the glow appears to emanate
 * from a disc, giving a premium "halo around a coin" look.
 *
 * Scale bounce is DISABLED — layout never changes during animation.
 */
export class SymbolCell extends Container {
  public readonly sprite:      Sprite;
  public readonly background:  Graphics;

  /** Outer static halo ring — alpha driven by showGlow() */
  private readonly glowRing:   Graphics;

  /** Rotating ray spokes — redrawn each frame while win is active */
  private readonly raysGraphics: Graphics;

  /** Circular mask for the symbol sprite */
  private readonly circleMask: Graphics;

  public symbolId: number = -1;

  private readonly cellW:   number;
  private readonly cellH:   number;
  private readonly cx:      number;   // cell centre X
  private readonly cy:      number;   // cell centre Y
  private readonly radius:  number;   // symbol circle radius

  /** Current rotation angle of the ray layer (radians) */
  private rayAngle = 0;

  /** Whether the glow / rays are currently active */
  private glowActive = false;

  constructor(texture: Texture, symbolId: number, width: number, height: number) {
    super();
    this.cellW    = width;
    this.cellH    = height;
    this.cx       = width  / 2;
    this.cy       = height / 2;
    this.radius   = Math.min(width, height) / 2 - 2;   // tight fit
    this.symbolId = symbolId;

    // ── 1. Background ─────────────────────────────────────────────────────────
    this.background = new Graphics();
    this.background.beginFill(0x111111);
    this.background.drawRect(0, 0, width, height);
    this.background.endFill();
    this.addChild(this.background);

    // ── 2. Rays layer (below sprite, redrawn each frame during win) ───────────
    this.raysGraphics         = new Graphics();
    this.raysGraphics.visible = false;
    this.addChild(this.raysGraphics);

    // ── 3. Symbol sprite (centered, circular-masked) ──────────────────────────
    this.sprite        = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.x      = this.cx;
    this.sprite.y      = this.cy;
    this._fitSprite();
    this.addChild(this.sprite);

    // Circular mask — same Graphics node lives as a child so it transforms with the cell
    this.circleMask = new Graphics();
    this.circleMask.beginFill(0xffffff);
    this.circleMask.drawCircle(this.cx, this.cy, this.radius);
    this.circleMask.endFill();
    this.addChild(this.circleMask);
    this.sprite.mask = this.circleMask;

    // ── 4. Static glow ring (above sprite, drawn once) ────────────────────────
    this.glowRing         = new Graphics();
    this.glowRing.visible = false;
    this._drawGlowRing(1.0);          // draw once — alpha changed via .alpha property
    this.addChild(this.glowRing);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  setTexture(texture: Texture, symbolId: number): void {
    this.symbolId       = symbolId;
    this.sprite.texture = texture;
    this._fitSprite();
  }

  /**
   * Show glow ring + rays at the given alpha (0–1).
   * Called every tick while a win sequence is active.
   *
   * @param alpha   0–1 ring + ray opacity
   * @param delta   ticker.deltaTime — used to advance ray rotation
   */
  showGlow(alpha = 1.0, delta = 0): void {
    const a = Math.max(0, Math.min(1, alpha));

    this.glowActive           = true;
    this.glowRing.visible     = true;
    this.glowRing.alpha       = a;
    this.raysGraphics.visible = true;

    // Advance rotation
    this.rayAngle += delta * 0.018;   // ~1 full turn every ~350 frames ≈ 6 s at 60fps

    this._drawRays(a);
  }

  /** Instantly hide all glow effects and stop animation */
  hideGlow(): void {
    this.glowActive           = false;
    this.glowRing.visible     = false;
    this.raysGraphics.visible = false;
    this.raysGraphics.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private _fitSprite(): void {
    const padding = 8;
    const maxR    = this.radius * 2 - padding;
    const scale   = Math.min(
      maxR / this.sprite.texture.width,
      maxR / this.sprite.texture.height
    );
    this.sprite.scale.set(scale);
  }

  /**
   * Drawn ONCE at construction.  Alpha is mutated via glowRing.alpha — zero redraws.
   *
   * Layer stack (outward → inward):
   *   • Very wide, near-transparent halo (atmosphere)
   *   • Medium soft ring
   *   • Thin crisp inner ring
   */
  private _drawGlowRing(alpha: number): void {
    const r  = this.radius;
    const cx = this.cx;
    const cy = this.cy;

    this.glowRing.clear();

    // Atmosphere — very wide, very soft golden fog
    this.glowRing.lineStyle(22, 0xffd966, alpha * 0.18);
    this.glowRing.drawCircle(cx, cy, r + 14);

    // Medium soft halo
    this.glowRing.lineStyle(10, 0xffe680, alpha * 0.35);
    this.glowRing.drawCircle(cx, cy, r + 6);

    // Bright inner ring
    this.glowRing.lineStyle(3, 0xffffff, alpha * 0.90);
    this.glowRing.drawCircle(cx, cy, r + 1);

    // Subtle second ring just outside
    this.glowRing.lineStyle(2, 0xffd700, alpha * 0.55);
    this.glowRing.drawCircle(cx, cy, r + 5);
  }

  /**
   * Redrawn each frame while glow is active.
   * Draws 8 tapered spokes that rotate slowly clockwise.
   *
   * Each spoke is a filled quadrilateral:
   *   inner point  → near edge of circle
   *   outer tip    → some distance beyond circle edge
   *   width tapers from a few px at inner to 0 at the tip
   */
  private _drawRays(alpha: number): void {
    const g        = this.raysGraphics;
    g.clear();

    const RAY_COUNT    = 8;
    const INNER_R      = this.radius + 4;   // start just outside the ring
    const OUTER_R      = this.radius + 28;  // tip of the ray
    const HALF_ANGLE   = 0.10;              // half angular width of the ray base (radians)

    for (let i = 0; i < RAY_COUNT; i++) {
      const baseAngle = this.rayAngle + (i / RAY_COUNT) * Math.PI * 2;

      // The four corners of the tapered spoke
      const x0 = this.cx + Math.cos(baseAngle - HALF_ANGLE) * INNER_R;
      const y0 = this.cy + Math.sin(baseAngle - HALF_ANGLE) * INNER_R;

      const x1 = this.cx + Math.cos(baseAngle + HALF_ANGLE) * INNER_R;
      const y1 = this.cy + Math.sin(baseAngle + HALF_ANGLE) * INNER_R;

      const xtip = this.cx + Math.cos(baseAngle) * OUTER_R;
      const ytip = this.cy + Math.sin(baseAngle) * OUTER_R;

      // Alternate long/short rays for a starburst variation
      const isLong  = i % 2 === 0;
      const tipX    = isLong ? xtip : this.cx + Math.cos(baseAngle) * (INNER_R + 10);
      const tipY    = isLong ? ytip : this.cy + Math.sin(baseAngle) * (INNER_R + 10);
      const rayAlpha = isLong ? alpha * 0.55 : alpha * 0.30;

      g.beginFill(0xfff0a0, rayAlpha);
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.lineTo(tipX, tipY);
      g.closePath();
      g.endFill();
    }
  }
}