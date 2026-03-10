//symbolAnimations.ts
import type { Texture } from "pixi.js";
import { WildSpriteSheet } from "./assets/WildSpriteSheet";
import { ScatterSpriteSheet } from "./assets/ScatterSpriteSheet";
import { SCATTER_SYMBOL_ID, WILD_SYMBOL_ID } from "../../domain/symbolConfig";

/**
 * PIXI-only helper: returns animation frames for special symbols.
 * Kept in the UI layer so Domain/Application never depend on PIXI assets.
 */
export function getAnimationFrames(symbolId: number): Texture[] {
  if (symbolId === WILD_SYMBOL_ID) {
    try {
      const sheet = WildSpriteSheet.getInstance();
      return sheet.getAnimation("enemy");
    } catch (err) {
      console.warn("[getAnimationFrames] Wild sheet not ready:", err);
      return [];
    }
  }

  if (symbolId === SCATTER_SYMBOL_ID) {
    try {
      const sheet = ScatterSpriteSheet.getInstance();
      return sheet.getAnimation("scatter");
    } catch (err) {
      console.warn("[getAnimationFrames] Scatter sheet not ready:", err);
      return [];
    }
  }

  return [];
}

