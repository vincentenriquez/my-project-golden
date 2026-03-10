import { Container, Sprite, Rectangle, Texture } from "pixi.js";
import type { IWinAnimator } from "../../app/ports";
import type { WinningPosition } from "../../domain/SpinEngine";
import type { TweenToFn } from "./tweenTypes";
import type { Reel } from "./Reel";
import type { SymbolCell } from "./SymbolCell";

interface WinningCellEntry {
  cell: SymbolCell;
  reelIndex: number;
  rowIndex: number;
}

export class PixiWinAnimator implements IWinAnimator {
  // ── Win display layout constants (copied from legacy GameController) ──────
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

  private currentSymbolSize = 0;

  constructor(
    private readonly reels: Reel[],
    private readonly highlightLayer: Container,
    private readonly winFloatLayer: Container,
    private readonly tweenTo: TweenToFn,
    private readonly setDimOverlayVisible: (visible: boolean) => void
  ) {}

  setReelBounds(reelTopY: number, reelLeftX: number): void {
    this.reelTopY = reelTopY;
    this.reelLeftX = reelLeftX;
  }

  clear(): void {
    this.glowPhase = "done";
    this._clearFloatingSprites();

    this.pendingSliceGroups = 0;
    this.onSequenceComplete = null;

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
    onComplete: () => void
  ): void {
    this.clear();
    this.currentSymbolSize = config.symbolSize;
    this.onSequenceComplete = onComplete;

    for (const pos of winningPositions) {
      this._markCellAt(pos.reelIndex, pos.rowIndex);
    }

    if (this.winningCells.size === 0) {
      this._completeOnce();
      return;
    }

    this.setDimOverlayVisible(true);
    this.glowPhase = "pulsing";

    this.reels.forEach((reel) => {
      reel.symbolCells.forEach((cell) => {
        if (!this.winningCells.has(cell)) cell.alpha = 0.25;
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

  private _spawnFloatingWinSymbols(): void {
    if (this.winningEntries.length === 0) {
      this._completeOnce();
      return;
    }

    const symbolSize = this.currentSymbolSize;
    const seen = new Set<string>();
    const spawned: { entry: WinningCellEntry; clone: Sprite }[] = [];

    for (const entry of this.winningEntries) {
      const key = `${entry.reelIndex}_${entry.rowIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const cell = entry.cell;
      const reel = this.reels[entry.reelIndex];

      reel.suspendCell(cell);
      cell.alpha = 0;

      const globalPos = cell.sprite.getGlobalPosition();
      const layerLocal = this.winFloatLayer.toLocal(globalPos);
      const startX = layerLocal.x;
      const startY = layerLocal.y;

      const targetY = startY - symbolSize * 0.5;

      const cloneTexture = cell.sprite.visible
        ? cell.sprite.texture
        : (cell as any)._animatedSprite?.texture ?? cell.sprite.texture;

      const clone = new Sprite(cloneTexture);
      clone.anchor.set(0.5);
      clone.x = startX;
      clone.y = startY;

      const src = cell.sprite.visible ? cell.sprite : (cell as any)._animatedSprite;
      clone.scale.copyFrom(src.scale);
      clone.alpha = 1;
      this.winFloatLayer.addChild(clone);
      spawned.push({ entry, clone });

      this.tweenTo(
        clone,
        "y",
        targetY,
        PixiWinAnimator.RISE_DURATION,
        (t) => this._easeOutCubic(t),
        undefined,
        () => {
          this._sliceCloneIntoQuadrants(clone);
        }
      );
    }

    this.pendingSliceGroups = spawned.length;

    const pieceAnimTime = 520;
    const maxWait = PixiWinAnimator.RISE_DURATION + pieceAnimTime + 400;
    this.winDisplayFallbackTimer = setTimeout(() => {
      this.winDisplayFallbackTimer = null;
      this._completeOnce();
    }, maxWait);
  }

  private _sliceCloneIntoQuadrants(clone: Sprite): void {
    if (clone.parent) {
      this.winFloatLayer.removeChild(clone);
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
      this.winFloatLayer.removeChild(child);
      child.destroy();
    }
  }

  private _easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }
}

