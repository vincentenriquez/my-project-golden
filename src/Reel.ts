//Reels.ts
import { Container, Sprite, Texture, BlurFilter } from "pixi.js";
import { SymbolCell } from "./SymbolCell";

export interface ReelConfig {
  reelWidth: number;
  symbolSize: number;
  symbolsPerReel: number;
  stripLength: number;
  totalSymbols: number;
}

/**
 * A single reel: strip of symbols, position, and visible sprites.
 * Encapsulates strip logic and sprite updates.
 */
export class Reel {
  readonly container: Container;
  readonly sprites: Sprite[] = [];
  readonly strip: number[];
  position: number = 0;
  previousPosition: number = 0;
  readonly blur: BlurFilter;

  private readonly config: ReelConfig;
  private textures: Texture[] = [];
  private visualOverrides: Map<number, number> = new Map();

  constructor(config: ReelConfig, textures: Texture[]) {
    this.config = config;
    this.textures = textures;

    this.container = new Container();
    this.blur = new BlurFilter();

    // Build random strip
    this.strip = Array.from(
      { length: config.stripLength },
      () => Math.floor(Math.random() * config.totalSymbols)
    );

    // Create visible sprites (symbolsPerReel + 1 for smooth scroll)
    const count = config.symbolsPerReel + 1;
    for (let j = 0; j < count; j++) {
      const symbolId = this.strip[j % this.strip.length];
      const sprite = new Sprite(this.textures[symbolId]);
      const scale = Math.min(
        config.symbolSize / sprite.width,
        config.symbolSize / sprite.height
      );
      sprite.scale.set(scale);
      sprite.x = Math.round((config.reelWidth - sprite.width) / 2);
      sprite.y = j * config.symbolSize;
      this.sprites.push(sprite);
      this.container.addChild(sprite);
    }

    this.position = Math.floor(Math.random() * this.strip.length);
    this.previousPosition = this.position;
  }

  /** Call when textures are loaded/changed (e.g. after Assets.load). */
  setTextures(textures: Texture[]) {
    this.textures = textures;
  }

  /**
   * Returns the Sprite at a given visible row index (0 = top).
   * Returns null if out of range.
   */
  getSpriteAt(row: number): Sprite | null {
    return this.sprites[row] ?? null;
  }

  /**
   * Override the visible texture at a given row (e.g. for expanding wilds).
   * Persists until clearVisualOverrides() is called or a new spin starts.
   */
  setVisualOverride(row: number, symbolId: number): void {
    this.visualOverrides.set(row, symbolId);
  }

  clearVisualOverrides(): void {
    this.visualOverrides.clear();
  }

  /**
   * Update sprite textures and positions from current reel position.
   * Call every frame during spin and once when stopped.
   */
  updateSprites(): void {
    const { symbolSize, reelWidth, symbolsPerReel } = this.config;
    const len = this.strip.length;

    const velocity = this.position - this.previousPosition;
    this.blur.blurY = Math.abs(velocity) * 8;
    this.previousPosition = this.position;

    const topIndex = Math.floor(this.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    const frac = this.position - Math.floor(this.position);

    for (let sIdx = 0; sIdx < this.sprites.length; sIdx++) {
      const sprite = this.sprites[sIdx];
      const stripIndex = (normalizedTop + sIdx) % len;
      const baseId = this.strip[stripIndex];
      const symbolId = this.visualOverrides.get(sIdx) ?? baseId;

      if (this.textures[symbolId] && sprite.texture !== this.textures[symbolId]) {
        sprite.texture = this.textures[symbolId];
        const scale = Math.min(
          symbolSize / sprite.texture.width,
          symbolSize / sprite.texture.height
        );
        sprite.scale.set(scale);
        sprite.x = Math.round((reelWidth - sprite.width) / 2);
      }
      sprite.y = sIdx * symbolSize - frac * symbolSize;
    }
  }

  /**
   * Find a strip index where the next symbolsPerReel symbols match desiredColumn.
   * If not found, inject the sequence and return that index.
   */
  findOrInjectSequence(desiredColumn: number[]): number {
    const { symbolsPerReel } = this.config;
    const len = this.strip.length;

    if (
      !Array.isArray(desiredColumn) ||
      desiredColumn.length !== symbolsPerReel
    ) {
      return Math.floor(Math.random() * len);
    }

    for (let i = 0; i < len; i++) {
      let ok = true;
      for (let r = 0; r < symbolsPerReel; r++) {
        if (this.strip[(i + r) % len] !== desiredColumn[r]) {
          ok = false;
          break;
        }
      }
      if (ok) return i;
    }

    const injectPos = Math.floor(Math.random() * len);
    for (let r = 0; r < symbolsPerReel; r++) {
      this.strip[(injectPos + r) % len] = desiredColumn[r];
    }
    return injectPos;
  }

  /**
   * Get the visible symbol IDs for this reel (top symbolsPerReel rows).
   */
  getVisibleSymbols(): number[] {
    const { symbolsPerReel } = this.config;
    const len = this.strip.length;
    const topIndex = Math.floor(this.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    const out: number[] = [];
    for (let row = 0; row < symbolsPerReel; row++) {
      out.push(this.strip[(normalizedTop + row) % len]);
    }
    return out;
  }
}