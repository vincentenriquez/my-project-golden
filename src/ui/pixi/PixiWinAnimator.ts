//PixiWinAnimator.ts
import { Container, Sprite, AnimatedSprite, Rectangle, Texture } from "pixi.js";
import type { IWinAnimator } from "../../app/ports";
import type { WinningPosition } from "../../domain/SpinEngine";
import type { TweenToFn } from "./tweenTypes";
import type { Reel } from "./Reel";
import type { SymbolCell } from "./SymbolCell";
import { AnimatedSymbolSheet } from "./assets/AnimatedSymbolSheet";

interface WinningCellEntry {
  cell: SymbolCell;
  reelIndex: number;
  rowIndex: number;
}

export class PixiWinAnimator implements IWinAnimator {
  // ── Win display layout constants ──────────────────────────────────────────
  private static readonly ANIMATE_IN_PLACE_DURATION = 2000; // ms symbol animates before rising
  private static readonly RISE_DURATION = 420;
  private static readonly HOLD_DURATION = 900;
  private static readonly FADE_DURATION = 320;
  private static readonly GLOW_SHOW_DURATION = 1000;
  private static readonly GLOW_FADE_DURATION = 280;

  private reelTopY = 0;
  private reelLeftX = 0;

  private winningEntries: WinningCellEntry[] = [];
  private winningCells: Set<SymbolCell> = new Set();

  private glowPhase: "pulsing" | "fading" | "done" = "done";
  private glowFadeStart = 0;
  private pulseTime = 0;

  private pendingSliceGroups = 0;
  private winDisplayFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private onSequenceComplete: (() => void) | null = null;
  private onFloatStart: (() => void) | null = null;

  private currentSymbolSize = 0;

  constructor(
    private readonly reels: Reel[],
    private readonly highlightLayer: Container,
    private readonly winFloatLayer: Container,
    private readonly tweenTo: TweenToFn,
    private readonly setDimOverlayVisible: (visible: boolean) => void
  ) { }

  setReelBounds(reelTopY: number, reelLeftX: number): void {
    this.reelTopY = reelTopY;
    this.reelLeftX = reelLeftX;
  }

  clear(): void {
    this.glowPhase = "done";
    this._clearFloatingSprites();

    this.pendingSliceGroups = 0;
    this.onSequenceComplete = null;
    this.onFloatStart = null;

    if (this.winDisplayFallbackTimer !== null) {
      clearTimeout(this.winDisplayFallbackTimer);
      this.winDisplayFallbackTimer = null;
    }

    // Restore all suspended cells so reels update them normally again
    this.reels.forEach((reel) => {
      reel.clearAllSuspensions();
      reel.symbolCells.forEach((cell) => {
        cell.alpha = 1;
      });
    });

    this.winningCells.forEach((cell) => {
      cell.detachRaysFromExternalLayer();
      cell.hideGlow();
    });

    this.winningEntries = [];
    this.winningCells.clear();
    this.pulseTime = 0;
    this.setDimOverlayVisible(false);
  }

  update(deltaTime: number): void {
    if (this.glowPhase === "fading") {
      const elapsed = Date.now() - this.glowFadeStart;
      const t = Math.min(1, elapsed / PixiWinAnimator.GLOW_FADE_DURATION);
      const fadeAlpha = 1 - t;
      this.winningCells.forEach((cell) => cell.showGlow(fadeAlpha, 0));
      if (t >= 1) {
        this.glowPhase = "done";
        this.winningCells.forEach((cell) => {
          cell.hideGlow();
          cell.detachRaysFromExternalLayer();
        });

        if (this.onFloatStart) {
          const cb = this.onFloatStart;
          this.onFloatStart = null;
          cb();
        }

        this._spawnFloatingWinSymbols();
      }
      return;
    }

    if (this.glowPhase === "pulsing" && this.winningCells.size > 0) {
      this.pulseTime += deltaTime * 0.05;
      const ringAlpha = 0.75 + Math.sin(this.pulseTime) * 0.25;
      this.winningCells.forEach((cell) => cell.showGlow(ringAlpha, deltaTime));
    }
  }

  startWinSequence(
    config: { symbolSize: number },
    winningPositions: WinningPosition[],
    scatterPositions: WinningPosition[],
    onComplete: () => void
  ): void {
    this._startHighlightFloatSliceSequence(config, winningPositions, [], onComplete);
  }

  startScatterBonusSequence(
    config: { symbolSize: number },
    scatterPositions: WinningPosition[],
    onComplete: () => void,
    onFloatStart?: () => void
  ): void {
    this.clear();
    this.onFloatStart = onFloatStart ?? null;
    this.currentSymbolSize = config.symbolSize;
    this.onSequenceComplete = onComplete;
    this.winningEntries = [];
    this.winningCells.clear();
    this.pendingSliceGroups = 0;

    // Step 1 — highlight scatter cells
    for (const pos of scatterPositions) {
      this._markCellAt(pos.reelIndex, pos.rowIndex);
    }

    if (this.winningCells.size === 0) {
      this._completeOnce();
      return;
    }

    // Dim non-scatter cells
    this.setDimOverlayVisible(true);
    this.glowPhase = "pulsing";
    this.reels.forEach((reel) => {
      reel.symbolCells.forEach((cell) => {
        if (!this.winningCells.has(cell)) cell.alpha = 0.25;
      });
    });

    // Step 2 — hold the highlight for a deliberate beat
    const SCATTER_HIGHLIGHT_HOLD_MS = 800;

    setTimeout(() => {
      if (this.glowPhase !== "pulsing") return;

      // Step 3 — fade glow, then float + slice happens inside update()
      this.glowPhase = "fading";
      this.glowFadeStart = Date.now();
      // _spawnFloatingWinSymbols() is called at end of fading phase in update()
      // which leads to slice → _completeOnce() → onComplete — unchanged
    }, SCATTER_HIGHLIGHT_HOLD_MS);
  }

  private _startHighlightFloatSliceSequence(
    config: { symbolSize: number },
    positions: WinningPosition[],
    excludePositions: WinningPosition[],
    onComplete: () => void
  ): void {
    this.currentSymbolSize = config.symbolSize;
    this.onSequenceComplete = onComplete;
    this.winningEntries = [];
    this.winningCells.clear();
    this.pendingSliceGroups = 0;

    for (const pos of positions) {
      this._markCellAt(pos.reelIndex, pos.rowIndex);
    }

    if (this.winningCells.size === 0) {
      this._completeOnce();
      return;
    }

    // Build a set of cells that must NOT be dimmed.
    // These are scatter cells that co-triggered a bonus on the same spin as a line win.
    const excludeCells = new Set<SymbolCell>();
    for (const pos of excludePositions) {
      const cell = this.reels[pos.reelIndex]?.getContainerAt(pos.rowIndex);
      if (cell && !this.winningCells.has(cell)) excludeCells.add(cell);
    }

    this.setDimOverlayVisible(true);
    this.glowPhase = "pulsing";

    this.reels.forEach((reel) => {
      reel.symbolCells.forEach((cell) => {
        // Dim only cells that are neither a line-win winner nor a bonus-triggering scatter.
        if (!this.winningCells.has(cell) && !excludeCells.has(cell)) cell.alpha = 0.25;
      });
    });

    setTimeout(() => {
      if (this.glowPhase !== "pulsing") return;
      this.glowPhase = "fading";
      this.glowFadeStart = Date.now();
    }, PixiWinAnimator.GLOW_SHOW_DURATION);
  }

  private _markCellAt(reelIndex: number, rowIndex: number): void {
    const reel = this.reels[reelIndex];
    const cell = reel?.getContainerAt(rowIndex);
    if (!cell || this.winningCells.has(cell)) return;
    this.winningEntries.push({ cell, reelIndex, rowIndex });
    this.winningCells.add(cell);
    cell.attachRaysToExternalLayer(this.highlightLayer);
    cell.showGlow(1.0, 0);
  }

  // ─── Phase 3: Spawn animated clones IN PLACE ─────────────────────────────
  //
  // Called once glow finishes fading.  We create an AnimatedSprite clone at
  // the cell's exact world position and let it play in place for
  // ANIMATE_IN_PLACE_DURATION ms BEFORE starting the rise tween.
  //
  private _spawnFloatingWinSymbols(): void {
    if (this.winningEntries.length === 0) {
      this._completeOnce();
      return;
    }

    const symbolSize = this.currentSymbolSize;
    const seen = new Set<string>();
    const clones: { clone: Sprite | AnimatedSprite; targetY: number }[] = [];

    // ── Step 3a: spawn each clone at its reel position (no movement yet) ──
    for (const entry of this.winningEntries) {
      const key = `${entry.reelIndex}_${entry.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cell = entry.cell;
      const reel = this.reels[entry.reelIndex];

      // Hide the original cell so only our clone is visible.
      reel.suspendCell(cell);
      cell.alpha = 0;

      const globalPos = cell.sprite.getGlobalPosition();
      const layerLocal = this.winFloatLayer.toLocal(globalPos);
      const startX = layerLocal.x;
      const startY = layerLocal.y;
      const targetY = startY - symbolSize * 0.5;

      // Animated sprite for this symbol; static fallback if none exists.
      const clone: Sprite | AnimatedSprite =
        AnimatedSymbolSheet.getInstance().createAnimatedSprite(cell.symbolId) ??
        new Sprite(cell.sprite.texture);

      clone.anchor.set(0.5);
      clone.x = startX;
      clone.y = startY;          // stays HERE during Phase 3

      // ── Correct scale calculation ─────────────────────────────────────────
      // cell.sprite.scale was computed to fit a specific texture size. The
      // AnimatedSprite frames may be a different resolution (190×186 from the
      // sheet). Simply copying the scale number would render the clone at the
      // wrong display size (the "scaling-out" bug).
      //
      // Instead, measure the actual rendered pixel size of the original sprite
      // and scale the clone to match that same size.
      const displayW = cell.sprite.width;   // rendered px width  (scale already applied)
      const displayH = cell.sprite.height;  // rendered px height (scale already applied)

      // clone.width/height at default scale 1 = frame pixel dimensions
      const nativeW = clone.width;
      const nativeH = clone.height;
      if (nativeW > 0 && nativeH > 0) {
        clone.scale.set(displayW / nativeW, displayH / nativeH);
      } else {
        // Fallback if frame size is unknown
        clone.scale.copyFrom(cell.sprite.scale);
      }

      clone.alpha = 1;
      this.winFloatLayer.addChild(clone);
      clones.push({ clone, targetY });
    }

    if (clones.length === 0) {
      this._completeOnce();
      return;
    }

    this.pendingSliceGroups = clones.length;

    // ── Step 3b: after the in-place animation plays, begin the rise+slice ──
    const pieceAnimTime = 520;
    const maxWait =
      PixiWinAnimator.ANIMATE_IN_PLACE_DURATION +
      PixiWinAnimator.RISE_DURATION +
      pieceAnimTime + 400;

    this.winDisplayFallbackTimer = setTimeout(() => {
      this.winDisplayFallbackTimer = null;
      this._completeOnce();
    }, maxWait);

    setTimeout(() => {
      this._riseAndSliceAll(clones);
    }, PixiWinAnimator.ANIMATE_IN_PLACE_DURATION);
  }

  // ─── Phase 4+5: Rise then Slice ──────────────────────────────────────────
  private _riseAndSliceAll(
    clones: { clone: Sprite | AnimatedSprite; targetY: number }[]
  ): void {
    for (const { clone, targetY } of clones) {
      this.tweenTo(
        clone as Sprite,  // tweenTo only touches y — safe for AnimatedSprite too
        "y",
        targetY,
        PixiWinAnimator.RISE_DURATION,
        (t) => this._easeOutCubic(t),
        undefined,
        () => { this._sliceCloneIntoQuadrants(clone); }
      );
    }
  }

  private _sliceCloneIntoQuadrants(clone: Sprite | AnimatedSprite): void {
    if (clone.parent) {
      this.winFloatLayer.removeChild(clone);
    }

    // If the clone is an AnimatedSprite, stop it and capture its current frame
    // texture so slicing operates on a stable, non-animating image.
    if (clone instanceof AnimatedSprite) {
      clone.stop();
    }

    const texture = clone.texture;
    const texW = texture.width;
    const texH = texture.height;

    const dispW = texW * clone.scale.x;
    const dispH = texH * clone.scale.y;

    const SLICE_COLS = 5;
    const SLICE_ROWS = 5;
    const SLICE_COUNT = SLICE_COLS * SLICE_ROWS;

    const sliceW = Math.floor(texW / SLICE_COLS);
    const sliceH = Math.floor(texH / SLICE_ROWS);

    const frame = (texture as any).frame ?? { x: 0, y: 0 };
    const fx = typeof frame.x === "number" ? frame.x : 0;
    const fy = typeof frame.y === "number" ? frame.y : 0;

    const rects: Rectangle[] = [];
    const offsets: { dx: number; dy: number }[] = [];

    for (let row = 0; row < SLICE_ROWS; row++) {
      for (let col = 0; col < SLICE_COLS; col++) {
        const isLastCol = col === SLICE_COLS - 1;
        const isLastRow = row === SLICE_ROWS - 1;
        const w = isLastCol ? texW - sliceW * (SLICE_COLS - 1) : sliceW;
        const h = isLastRow ? texH - sliceH * (SLICE_ROWS - 1) : sliceH;
        rects.push(new Rectangle(fx + col * sliceW, fy + row * sliceH, w, h));

        const centerCol = (SLICE_COLS - 1) / 2;
        const centerRow = (SLICE_ROWS - 1) / 2;
        offsets.push({
          dx: (col - centerCol) * (dispW / SLICE_COLS),
          dy: (row - centerRow) * (dispH / SLICE_ROWS),
        });
      }
    }

    const pieces: Sprite[] = [];
    const source = (texture as any).source ?? (texture as any).baseTexture;

    try {
      for (let i = 0; i < SLICE_COUNT; i++) {
        const tex = source
          ? new Texture({ source, frame: rects[i] } as ConstructorParameters<typeof Texture>[0])
          : new Texture(texture);
        const piece = new Sprite(tex);
        piece.anchor.set(0.5);
        piece.x = clone.x + offsets[i].dx;
        piece.y = clone.y + offsets[i].dy;
        piece.scale.set(clone.scale.x, clone.scale.y);
        this.winFloatLayer.addChild(piece);
        pieces.push(piece);
      }
    } catch {
      clone.destroy();
      this._onSliceGroupComplete();
      return;
    }

    clone.destroy();

    let piecesCompleted = 0;
    const pieceAnimTime = 520;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const dirX = offsets[i].dx !== 0 ? Math.sign(offsets[i].dx) : Math.random() > 0.5 ? 1 : -1;
      const dirY = offsets[i].dy !== 0 ? Math.sign(offsets[i].dy) : Math.random() > 0.5 ? 1 : -1;

      const targetX = p.x + dirX * (dispW * 0.45 + Math.random() * 18);
      const targetY = p.y + dirY * (dispH * 0.35 + Math.random() * 18);
      const targetRotation = (Math.random() * 0.6 - 0.3) * Math.PI;

      this.tweenTo(p, "x", targetX, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(p, "y", targetY, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(p, "rotation", targetRotation, pieceAnimTime, this._easeOutCubic);
      this.tweenTo(
        p,
        "alpha",
        0,
        pieceAnimTime,
        this._easeOutCubic,
        undefined,
        () => {
          if (p.parent) p.parent.removeChild(p);
          p.destroy({ texture: true, textureSource: false });
          piecesCompleted++;
          if (piecesCompleted === pieces.length) {
            this._onSliceGroupComplete();
          }
        }
      );
    }
  }

  private _onSliceGroupComplete(): void {
    if (this.pendingSliceGroups > 0) this.pendingSliceGroups--;
    if (this.pendingSliceGroups === 0) {
      this._completeOnce();
    }
  }

  private _completeOnce(): void {
    if (!this.onSequenceComplete) return;
    const cb = this.onSequenceComplete;
    this.onSequenceComplete = null;
    cb();
  }

  private _clearFloatingSprites(): void {
    while (this.winFloatLayer.children.length > 0) {
      const child = this.winFloatLayer.children[0];
      // Stop animation before destroying to avoid PIXI ticker warnings.
      if (child instanceof AnimatedSprite) child.stop();
      this.winFloatLayer.removeChild(child);
      child.destroy();
    }
  }

  private _easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }
}

