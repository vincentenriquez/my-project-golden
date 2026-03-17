/**
 * AnimatedSymbolSheet.ts
 *
 * Manages the `animated_symbol.json` spritesheet and provides
 * a mapping from domain symbol IDs to their animation keys.
 *
 * Trigger context
 * ───────────────
 * This class is used exclusively by `PixiWinAnimator._spawnFloatingWinSymbols`.
 * It is called AFTER the glow highlight phase ends, so it will only create
 * animated sprites for symbols that belong to a winning combination.
 */
import { Assets, Spritesheet, AnimatedSprite } from "pixi.js";

/**
 * Maps domain symbolId (0-9, from symbolConfig.ts) to the animation
 * key defined in `animated_symbol.json > "animations"`.
 *
 * Symbol ID → JSON key mapping:
 *   0  apple   → "apple"
 *   1  banana  → "banana"
 *   2  lemon   → "lemon"
 *   3  mangga  → "mangga"
 *   4  a       → null (no animation in spritesheet — falls back to static sprite)
 *   5  k       → "k"
 *   6  q       → "q"
 *   7  j       → "j"
 *   8  wild    → "wild"
 *   9  scatter → "scatter"
 */
const SYMBOL_ID_TO_ANIMATION_KEY: Partial<Record<number, string>> = {
  0: "apple",
  1: "banana",
  2: "lemon",
  3: "mangga",
  4: "a",
  5: "k",
  6: "q",
  7: "j",
  8: "wild",
  9: "scatter",
};

export class AnimatedSymbolSheet {
  public static readonly JSON_KEY = "/animated_symbol.json";

  private static _instance: AnimatedSymbolSheet | null = null;

  private constructor() {}

  /** Returns the singleton. Lazy — safe to call at any time after Assets.load(). */
  public static getInstance(): AnimatedSymbolSheet {
    if (!this._instance) {
      this._instance = new AnimatedSymbolSheet();
    }
    return this._instance;
  }

  /** Resolves the sheet from the PIXI asset cache. Returns null if not loaded yet. */
  private getSheet(): Spritesheet | null {
    return (
      (Assets.get(AnimatedSymbolSheet.JSON_KEY) as Spritesheet | undefined) ??
      (Assets.get("animated_symbol.json") as Spritesheet | undefined) ??
      null
    );
  }

  /**
   * Creates a looping `AnimatedSprite` for the given symbolId.
   *
   * Returns `null` when:
   *  - The spritesheet hasn't been loaded yet.
   *  - The symbolId has no animation entry (e.g. symbolId 4, "A").
   *
   * In both cases `PixiWinAnimator` will fall back to a static `Sprite` clone.
   *
   * @param symbolId   Domain symbol ID (0-9).
   * @param speed      Animation playback speed (frames per ticker tick). Default 0.15.
   */
  public createAnimatedSprite(symbolId: number, speed = 0.15): AnimatedSprite | null {
    const sheet = this.getSheet();
    if (!sheet) {
      console.warn("AnimatedSymbolSheet: Spritesheet not loaded. Include /animated_symbol.json in Assets.load().");
      return null;
    }

    const animKey = SYMBOL_ID_TO_ANIMATION_KEY[symbolId];
    if (!animKey) {
      // Symbol has no animation in the sheet — caller will use static sprite.
      return null;
    }

    const frames = sheet.animations[animKey];
    if (!frames || frames.length === 0) {
      console.warn(`AnimatedSymbolSheet: Animation key "${animKey}" not found in sheet.`);
      return null;
    }

    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = speed;
    sprite.loop = true;
    sprite.play();
    return sprite;
  }
}
