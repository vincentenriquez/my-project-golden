import { Container, Sprite, Texture, BlurFilter } from "pixi.js";
import { SymbolCell } from "./SymbolCell";

export interface ReelConfig {
  reelWidth:      number;
  symbolSize:     number;
  symbolsPerReel: number;
  stripLength:    number;
  totalSymbols:   number;
}

/**
 * Reel — uses SymbolCell containers so GameController can call
 * getContainerAt(row) to access showGlow() / hideGlow() directly.
 */
export class Reel {
  readonly container: Container;
  readonly symbolCells: SymbolCell[] = [];
  readonly strip: number[];
  readonly sprites: Sprite[] = [];
  position: number = 0;
  previousPosition: number = 0;
  readonly blur: BlurFilter;

  private readonly config: ReelConfig;
  private textures: Texture[] = [];
  private visualOverrides: Map<number, number> = new Map();

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
      cell.y = j * config.symbolSize;
      this.symbolCells.push(cell);
      this.container.addChild(cell);
    }

    this.position         = Math.floor(Math.random() * this.strip.length);
    this.previousPosition = this.position;
  }

  /** Returns the SymbolCell container at a visible row. Used by GameController for glow. */
  getContainerAt(row: number): SymbolCell | null {
    return this.symbolCells[row] ?? null;
  }

  /** Backward-compat: returns the inner Sprite only. */
  getSpriteAt(row: number): Sprite | null {
    return this.symbolCells[row]?.sprite ?? null;
  }

  setTextures(textures: Texture[]): void { this.textures = textures; }
  setVisualOverride(row: number, symbolId: number): void { this.visualOverrides.set(row, symbolId); }
  clearVisualOverrides(): void { this.visualOverrides.clear(); }

  updateSprites(): void {
    const { symbolSize, reelWidth, symbolsPerReel } = this.config;
    const len = this.strip.length;
    const velocity = this.position - this.previousPosition;
    this.blur.blurY = Math.abs(velocity) * 8;
    this.previousPosition = this.position;
    const topIndex = Math.floor(this.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    const frac = this.position - Math.floor(this.position);

    for (let sIdx = 0; sIdx < this.symbolCells.length; sIdx++) {
      const cell = this.symbolCells[sIdx];
      const stripIndex = (normalizedTop + sIdx) % len;
      const baseId = this.strip[stripIndex];
      const symbolId = this.visualOverrides.get(sIdx) ?? baseId;
      if (this.textures[symbolId] && cell.sprite.texture !== this.textures[symbolId]) {
        cell.setTexture(this.textures[symbolId], symbolId);
      }
      cell.y = sIdx * symbolSize - frac * symbolSize;
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