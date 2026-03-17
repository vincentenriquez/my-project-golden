//symbolAnimations.ts
import type { Texture } from "pixi.js";

/**
 * PIXI-only helper: returns animation frames for special symbols.
 * Kept in the UI layer so Domain/Application never depend on PIXI assets.
 */
export function getAnimationFrames(symbolId: number): Texture[] {
  return [];
}

