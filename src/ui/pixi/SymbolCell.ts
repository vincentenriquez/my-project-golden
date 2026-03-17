//SymbolCell.ts

import { Container, Sprite, Graphics, Texture, BlurFilter, Assets } from "pixi.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Colour palette — Sweet Harvest frame (amber-gold)
//
//  Source                          Hex        Role
//  ─────────────────────────────── ────────── ──────────────────────────────
//  Shadow side of golden frame     #c47a00    AMBER_DEEP  — outermost fog
//  Mid-tone ornate frame scrollwork#e09400    AMBER_MID   — wide halo band
//  Main frame colour               #f5b800    GOLD_BRIGHT — peak bloom ring
//  Brightest frame highlight       #ffd040    GOLD_HOT    — crisp rim + core
//  Rays vs blue-grey reels         #f0a800    RAY_AMBER   — ray body
//  Ray bright centre               #ffc840    RAY_TIP     — ray core strip
// ─────────────────────────────────────────────────────────────────────────────
const AMBER_DEEP   = 0xc47a00;
const AMBER_MID    = 0xe09400;
const GOLD_BRIGHT  = 0xf5b800;
// const GOLD_HOT     = 0xffd040;
const GOLD_CORE    = 0xffeea0;   // pale gold — subtle inner warmth
const RAY_AMBER    = 0xf0a800;
const RAY_TIP      = 0xffc840;

/**
 * SymbolCell — one Container per visible symbol slot.
 *
 * Win highlight: Circular Symbol Highlight + Outside Ray Burst
 * ─────────────────────────────────────────────────────────────
 * Architecture (same as reference-matched version):
 *   • Circle glow ON the symbol  — amber-gold bloom, tight to symbol edge
 *   • Rays OUTSIDE the circle    — warm amber shafts starting at circle edge
 *
 * Layer stack (bottom → top)
 * ──────────────────────────
 *  1. background      transparent hit rect
 *  2. raysGraphics    amber rays — bases on circle edge, tips at cell corners
 *  3. circleGlow      amber-gold bloom — stacked filled circles
 *  4. sprite          symbol (circular-masked, always sharp)
 *  5. circleMask      masks sprite to disc
 *  6. innerBloom      very subtle warm gold tint above sprite centre
 *  7. rimCircle       crisp gold ring (drawn once, alpha animated)
 *
 * Key tuning vs previous version
 * ────────────────────────────────
 *  GLOW_EXTRA reduced:  16 → 6 px   (circle hugs the symbol tighter)
 *  RAY_GAP    reduced:   3 → 2 px   (rays start almost flush to circle edge)
 *  All pink/purple colours replaced with amber-gold palette above
 */
export class SymbolCell extends Container {
  public  readonly sprite:      Sprite;
  public  readonly background:  Graphics;

  public readonly raysGraphics: Graphics;
  // private readonly circleGlow:   Graphics;
  private readonly innerBloom:   Graphics;
  private readonly rimCircle:    Graphics;
  // private readonly circleMask:   Graphics;

  public  symbolId: number = -1;

  private readonly cellW:   number;
  private readonly cellH:   number;
  private readonly cx:      number;
  private readonly cy:      number;
  private readonly spriteR: number;   // sprite mask radius
  private readonly glowR:   number;   // bloom circle radius (spriteR + GLOW_EXTRA)

  // Animation state
  private rayAngle   = 0;
  private pulsePhase = 0;
  private glowActive = false;

  // ── Tuning ────────────────────────────────────────────────────────────────
  /** Extra radius beyond sprite circle — REDUCED for tighter circle */
  private static readonly GLOW_EXTRA  = 0;
  /** Gap between glow circle edge and ray base (px) — TIGHTENED to contain burst */
  private static readonly RAY_GAP     = 3;
  /** Number of rays — REDUCED for cleaner look */
  private static readonly RAY_COUNT   = 18;
  /** Rotation speed */
  private static readonly RAY_SPEED   = 0.008;
  /** Pulse speed */
  private static readonly PULSE_SPEED = 0.055;

  constructor(texture: Texture, symbolId: number, width: number, height: number) {
    super();
    this.cellW   = width;
    this.cellH   = height;
    this.cx      = width  / 2;
    this.cy      = height / 2;
    this.spriteR = Math.min(width, height) / 2 - 2;
    this.glowR   = this.spriteR + SymbolCell.GLOW_EXTRA;
    this.symbolId = symbolId;

    // ── 1. Background ─────────────────────────────────────────────────────
    this.background = new Graphics();
    this.background.beginFill(0x111111, 0);
    this.background.drawRect(0, 0, width, height);
    this.background.endFill();
    this.addChild(this.background);

    // ── 2. Rays (behind circle) ───────────────────────────────────────────
    this.raysGraphics         = new Graphics();
    this.raysGraphics.visible = false;
    this.raysGraphics.zIndex = 100;
    this.addChild(this.raysGraphics);

    // ── 3. Circle glow bloom (behind sprite) ──────────────────────────────
    // this.circleGlow         = new Graphics();
    // this.circleGlow.visible = false;
    // this.addChild(this.circleGlow);

    // ── 4. Symbol sprite, clipped to spriteR ──────────────────────────────
    this.sprite        = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.x      = this.cx;
    this.sprite.y      = this.cy;
    this._fitSprite();
    this.addChild(this.sprite);

    // this.circleMask = new Graphics();
    // this.circleMask.beginFill(0xffffff);
    // this.circleMask.drawCircle(this.cx, this.cy, this.spriteR);
    // this.circleMask.endFill();
    // this.addChild(this.circleMask);
    // this.sprite.mask = this.circleMask;

    // ── 5. Inner bloom (above sprite — very subtle warm tint) ─────────────
    this.innerBloom         = new Graphics();
    this.innerBloom.visible = false;
    this.addChild(this.innerBloom);

    // ── 6. Crisp rim circle (drawn once, alpha animated) ──────────────────
    this.rimCircle         = new Graphics();
    this.rimCircle.visible = false;
    this._buildRimCircle();
    this.addChild(this.rimCircle);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  setTexture(texture: Texture, symbolId: number): void {
    this.symbolId = symbolId;
    this.sprite.texture = texture;
    this._fitSprite();
  }

  /** Whether this cell is currently showing an AnimatedSprite. */
  hasAnimated(): boolean {
    return false;
  }

  // SymbolCell.ts — update showGlow()
  showGlow(alpha = 1.0, delta = 0): void {
    const a = Math.max(0, Math.min(1, alpha));
    this.glowActive = true;

    this.rayAngle   += delta * SymbolCell.RAY_SPEED;
    this.pulsePhase += delta * SymbolCell.PULSE_SPEED;

    const pulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(this.pulsePhase));
    const pa    = a * pulse;

    this.raysGraphics.visible = false;
    this.innerBloom.visible   = false;
    this.rimCircle.visible    = false;
    this.rimCircle.alpha      = pa;

    // ── Sync ray layer world position ──────────────────────────────────────
    // raysGraphics may live on highlightLayer; reposition it to match this
    // cell's world position so rays appear exactly over the symbol.
    if (this.raysGraphics.parent && this.raysGraphics.parent !== this) {
      const worldPos = this.getGlobalPosition();
      const localPos = this.raysGraphics.parent.toLocal(worldPos);
      this.raysGraphics.x = localPos.x;
      this.raysGraphics.y = localPos.y;
    }

    this._drawRays(pa);
    this._drawCircleGlow(pa);
    this._drawInnerBloom(pa);
  }

  hideGlow(): void {
    this.glowActive           = false;
    this.raysGraphics.visible = false;
    // this.circleGlow.visible   = false;
    this.innerBloom.visible   = false;
    this.rimCircle.visible    = false;
    this.raysGraphics.clear();
    // this.circleGlow.clear();
    this.innerBloom.clear();
    this.pulsePhase = 0;
    this.rayAngle   = 0;
  }

  // ─── Private: sprite sizing ───────────────────────────────────────────────

  private _fitSprite(): void {
    const maxR = this.spriteR * 2 - 8;
    const scale = Math.min(
      maxR / this.sprite.texture.width,
      maxR / this.sprite.texture.height
    );
    this.sprite.scale.set(scale);
  }

  // ─── Private: amber rays starting at glowR edge ───────────────────────────

  /**
   * Triangle rays where each base sits ON glowR (the glow circle edge).
   * Tips reach beyond the cell diagonal — rays cover the full background.
   *
   * Two layers per main ray:
   *   BODY  — warm amber fill, semi-transparent
   *   CORE  — brighter gold strip down the centre
   * Short alternate rays add depth without clutter.
   */
private _drawRays(pa: number): void {
  const g = this.raysGraphics;
  g.clear();
  g.lineStyle(0);

  const cx      = this.cx;
  const cy      = this.cy;
  const N       = SymbolCell.RAY_COUNT;
  const BASE_R  = this.glowR + SymbolCell.RAY_GAP;
  /** TIP_R reduced from 0.59 to 0.48 to prevent rays from bleeding into adjacent cells */
  const TIP_R   = Math.sqrt(this.cellW * this.cellW + this.cellH * this.cellH) * 0.48;

  for (let i = 0; i < N; i++) {
    const angle  = this.rayAngle + (i / N) * Math.PI * 2;
    const isMain = i % 2 === 0;

    const rayLength = isMain ? TIP_R - BASE_R : (TIP_R - BASE_R) * 0.50;
    const rayWidth  = isMain ? 10 : 5;  // ← control thickness here

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Rectangle center point (midpoint along the ray direction)
    const midDist = BASE_R + rayLength / 2;
    const midX = cx + cos * midDist;
    const midY = cy + sin * midDist;

    // Perpendicular axis (for rectangle width)
    const perpX = -sin;
    const perpY =  cos;

    // 4 corners of the rectangle
    const hw = rayWidth / 2;      // half width
    const hl = rayLength / 2;     // half length

    const x0 = midX + perpX * hw + cos * (-hl);
    const y0 = midY + perpY * hw + sin * (-hl);

    const x1 = midX + perpX * (-hw) + cos * (-hl);
    const y1 = midY + perpY * (-hw) + sin * (-hl);

    const x2 = midX + perpX * (-hw) + cos * hl;
    const y2 = midY + perpY * (-hw) + sin * hl;

    const x3 = midX + perpX * hw + cos * hl;
    const y3 = midY + perpY * hw + sin * hl;

    // ── Outer soft body ──────────────────────────────────────────────────
    g.beginFill(RAY_AMBER, pa * (isMain ? 0.45 : 0.20));
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineTo(x3, y3);
    g.closePath();
    g.endFill();

    // ── Bright core strip (main rays only) — narrower inner rectangle ────
    if (isMain) {
      const cw = rayWidth * 0.30;  // core is 30% of full width
      const cx0 = midX + perpX * cw  + cos * (-hl);
      const cy0 = midY + perpY * cw  + sin * (-hl);
      const cx1 = midX + perpX * (-cw) + cos * (-hl);
      const cy1 = midY + perpY * (-cw) + sin * (-hl);
      const cx2 = midX + perpX * (-cw) + cos * hl;
      const cy2 = midY + perpY * (-cw) + sin * hl;
      const cx3 = midX + perpX * cw  + cos * hl;
      const cy3 = midY + perpY * cw  + sin * hl;

      g.beginFill(RAY_TIP, pa * 0.75);
      g.moveTo(cx0, cy0);
      g.lineTo(cx1, cy1);
      g.lineTo(cx2, cy2);
      g.lineTo(cx3, cy3);
      g.closePath();
      g.endFill();
    }
  }
}


  // ─── Private: amber-gold circular bloom ───────────────────────────────────

  /**
   * Stacked filled circles simulating a warm amber radial gradient.
   * Ordered largest → smallest so inner layers paint over outer ones.
   *
   * The bloom peaks just outside spriteR and fades inward — symbol is
   * never covered strongly (inner layers stay below 15% opacity).
   */
  private _drawCircleGlow(pa: number): void {
    // const g  = this.circleGlow;
    // g.clear();
    // g.lineStyle(0);

    const cx = this.cx;
    const cy = this.cy;
    const gr = this.glowR;
    const sr = this.spriteR;

    // [radius, colour, max-opacity × pa]  — largest first
    const layers: [number, number, number][] = [
      [gr + 14, AMBER_DEEP,  0.13],   // wide deep amber fog
      [gr +  8, AMBER_DEEP,  0.20],   // outer atmosphere
      [gr +  3, AMBER_MID,   0.32],   // warm amber band
      [gr,      GOLD_BRIGHT, 0.50],   // peak — bright gold right on circle edge
      [gr -  3, GOLD_BRIGHT, 0.40],   // just inside edge
      // [sr +  3, GOLD_HOT,    0.24],   // golden warmth near sprite boundary
      [sr -  2, GOLD_CORE,   0.12],   // very subtle pale gold inside sprite
    ];

    for (const [r, color, opacity] of layers) {
      if (r <= 0) continue;
      // g.beginFill(color, opacity * pa);
      // g.drawCircle(cx, cy, r);
      // g.endFill();
    }
  }

  // ─── Private: subtle inner bloom above sprite ─────────────────────────────

  /**
   * Soft warm gold tint painted ABOVE the sprite — max ~12% opacity.
   * Adds the "lit from within" warmth without obscuring the fruit.
   */
  private _drawInnerBloom(pa: number): void {
    const g = this.innerBloom;
    g.clear();
    g.lineStyle(0);

    // g.beginFill(GOLD_HOT, pa * 0.08);
    // g.drawCircle(this.cx, this.cy, this.spriteR - 2);
    // g.endFill();

    g.beginFill(GOLD_CORE, pa * 0.12);
    g.drawCircle(this.cx, this.cy, this.spriteR * 0.45);
    g.endFill();
  }

  // ─── Private: crisp rim circle (drawn once) ───────────────────────────────

  /**
   * Three concentric rings drawn ONCE at construction — zero per-frame cost.
   * Colours echo the antique-gold ornate frame of the machine directly.
   *
   *   Outer soft halo  — deep amber, wide line
   *   Main crisp ring  — bright gold GOLD_HOT, sits right on glowR
   *   Inner accent     — pale gold GOLD_CORE
   */
  private _buildRimCircle(): void {
    const g  = this.rimCircle;
    const cx = this.cx;
    const cy = this.cy;
    const gr = this.glowR;

    g.clear();

    // Outer soft halo
    g.lineStyle(6, AMBER_MID, 0.45);
    g.drawCircle(cx, cy, gr + 5);

    // Crisp main ring — bright gold matching frame highlight
    // g.lineStyle(2.5, GOLD_HOT, 1.00);
    // g.drawCircle(cx, cy, gr);

    // Inner accent
    g.lineStyle(1.5, GOLD_CORE, 0.65);
    g.drawCircle(cx, cy, gr - 4);

    g.lineStyle(0);
  }

  attachRaysToExternalLayer(layer: Container): void {
    if (this.raysGraphics.parent) {
      this.raysGraphics.parent.removeChild(this.raysGraphics);
    }
    layer.addChild(this.raysGraphics);
  }
  
  /** Restores raysGraphics back into this cell (called on clearHighlights). */
  detachRaysFromExternalLayer(): void {
    if (this.raysGraphics.parent) {
      this.raysGraphics.parent.removeChild(this.raysGraphics);
    }
    this.addChildAt(this.raysGraphics, 1); // slot 1 = behind sprite
  }
}