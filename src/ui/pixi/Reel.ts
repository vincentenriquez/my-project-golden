//Reel.ts
import { Container, Sprite, Texture, BlurFilter } from "pixi.js";
import { SymbolCell } from "./SymbolCell";
import { WILD_SYMBOL_ID, SCATTER_SYMBOL_ID } from "../../domain/symbolConfig";
import { getAnimationFrames } from "./symbolAnimations";

export interface ReelConfig {
  reelWidth:      number;
  symbolSize:     number;
  symbolsPerReel: number;
  stripLength:    number;
  totalSymbols:   number;
  rowPadding:     number;
}

/**
 * Reel — uses SymbolCell containers so GameController can call
 * getContainerAt(row) to access showGlow() / hideGlow() directly.
 *
 * Suspension API
 * ──────────────
 * When GameController reparents a SymbolCell into winFloatLayer for the
 * fly-up animation it calls suspendCell(cell).  While suspended the cell is
 * skipped inside updateSprites() so the reel ticker cannot overwrite the
 * animation's x/y/alpha.  restoreCell(cell) re-enables normal updates once
 * the animation returns the cell to its original parent.
 */
export class Reel {
  readonly container: Container;
  public readonly symbolCells: SymbolCell[] = [];
  readonly strip: number[];
  readonly sprites: Sprite[] = [];
  position: number = 0;
  previousPosition: number = 0;
  readonly blur: BlurFilter;

  private readonly config: ReelConfig;
  private textures: Texture[] = [];
  private visualOverrides: Map<number, number> = new Map();

  /**
   * Cells currently reparented into winFloatLayer.
   * updateSprites() skips any cell found in this set.
   */
  private suspendedCells: Set<SymbolCell> = new Set();

  constructor(config: ReelConfig, textures: Texture[]) {
    this.config   = config;
    this.textures = textures;
    this.container = new Container();
    this.blur = new BlurFilter();
     
    this.strip = Array.from(
      { length: config.stripLength },
      () => Math.floor(Math.random() * config.totalSymbols)
    );

    const count = config.symbolsPerReel + 1;
    for (let j = 0; j < count; j++) {
      const symbolId = this.strip[j % this.strip.length];
      const cell = new SymbolCell(textures[symbolId], symbolId, config.symbolSize, config.symbolSize);
      cell.x = Math.round((config.reelWidth - config.symbolSize) / 2);
      cell.y = j * (config.symbolSize + config.rowPadding);

      // ✅ Apply animation for wild/scatter on initial construction
      if (symbolId === WILD_SYMBOL_ID || symbolId === SCATTER_SYMBOL_ID) {
        const frames = getAnimationFrames(symbolId);
        if (frames.length > 0) cell.setAnimated(frames);
      }

      this.symbolCells.push(cell);
      this.container.addChild(cell);
    }
  }

  // ── Suspension API ────────────────────────────────────────────────────────

  /**
   * Mark a cell as floating — updateSprites() will skip it until restored.
   * Call this BEFORE reparenting the cell out of this reel's container.
   */
  suspendCell(cell: SymbolCell): void {
    this.suspendedCells.add(cell);
  }

  /**
   * Re-enable normal reel updates for a cell after it has been returned to
   * its original parent.  The next updateSprites() call will sync it again.
   */
  restoreCell(cell: SymbolCell): void {
    this.suspendedCells.delete(cell);
  }

  /** Restore ALL suspended cells at once (used when clearing win highlights mid-animation). */
  clearAllSuspensions(): void {
    this.suspendedCells.clear();
  }

  // ── Existing API (unchanged) ──────────────────────────────────────────────

  /** Returns the SymbolCell container at a visible row. Used by GameController for glow. */
  getContainerAt(row: number): SymbolCell | null {
    return this.symbolCells[row] ?? null;
  }

  /** Backward-compat: returns the inner Sprite only. */
  getSpriteAt(row: number): Sprite | null {
    return this.symbolCells[row]?.sprite ?? null;
  }

  setTextures(textures: Texture[]): void { this.textures = textures; }
  getTexture(symbolId: number): Texture { return this.textures[symbolId]; }
  setVisualOverride(row: number, symbolId: number): void { this.visualOverrides.set(row, symbolId); }
  clearVisualOverrides(): void { this.visualOverrides.clear(); }

  updateSprites(): void {
    const { symbolSize, reelWidth, symbolsPerReel, rowPadding } = this.config;
    const len = this.strip.length;
    const velocity = this.position - this.previousPosition;
    this.blur.blurY = Math.abs(velocity) * 8;
    this.previousPosition = this.position;
    const topIndex = Math.floor(this.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    const frac = this.position - Math.floor(this.position);

    for (let sIdx = 0; sIdx < this.symbolCells.length; sIdx++) {
      const cell = this.symbolCells[sIdx];

      // ── Skip suspended (floating) cells entirely ──────────────────────────
      // The cell has been reparented into winFloatLayer; writing y here would
      // fight the animation and cause flickering.
      if (this.suspendedCells.has(cell)) continue;

      const stripIndex = (normalizedTop + sIdx) % len;
      const baseId = this.strip[stripIndex];
      const symbolId = this.visualOverrides.get(sIdx) ?? baseId;
      const isAnimated = symbolId === WILD_SYMBOL_ID || symbolId === SCATTER_SYMBOL_ID;

      if (isAnimated) {
        // Ensure the cell is actually animated. On first load/refresh it's possible
        // to have the right symbolId but still be showing the static texture.
        if (cell.symbolId !== symbolId || !cell.hasAnimated()) {
          const frames = getAnimationFrames(symbolId);
          if (frames.length > 0) {
            cell.setAnimated(frames);
            cell.symbolId = symbolId;
          }
        }
      } else {
        // Switching away from an animated symbol — restore static
        if (
          (cell.symbolId === WILD_SYMBOL_ID || cell.symbolId === SCATTER_SYMBOL_ID) &&
          symbolId !== WILD_SYMBOL_ID && symbolId !== SCATTER_SYMBOL_ID
        ) {
          cell.clearAnimated();
        }
        if (this.textures[symbolId] && cell.sprite.texture !== this.textures[symbolId]) {
          cell.setTexture(this.textures[symbolId], symbolId);
        }
      }
      cell.y = sIdx * (symbolSize + rowPadding) - frac * (symbolSize + rowPadding);
    }
  }

  findOrInjectSequence(desiredColumn: number[]): number {
    const { symbolsPerReel } = this.config;
    const len = this.strip.length;
    if (!Array.isArray(desiredColumn) || desiredColumn.length !== symbolsPerReel) return Math.floor(Math.random() * len);
    for (let i = 0; i < len; i++) {
      let ok = true;
      for (let r = 0; r < symbolsPerReel; r++) { if (this.strip[(i + r) % len] !== desiredColumn[r]) { ok = false; break; } }
      if (ok) return i;
    }
    const injectPos = Math.floor(Math.random() * len);
    for (let r = 0; r < symbolsPerReel; r++) this.strip[(injectPos + r) % len] = desiredColumn[r];
    return injectPos;
  }

  getVisibleSymbols(): number[] {
    const { symbolsPerReel } = this.config;
    const len = this.strip.length;
    const topIndex = Math.floor(this.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    const out: number[] = [];
    for (let row = 0; row < symbolsPerReel; row++) out.push(this.strip[(normalizedTop + row) % len]);
    return out;
  }
}