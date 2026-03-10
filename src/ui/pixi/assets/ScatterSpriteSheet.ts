import { Assets, Texture, Rectangle, AnimatedSprite } from "pixi.js";

/**
 * ScatterSpriteSheet.ts
 *
 * Encapsulates the scatter 3x3 spritesheet (scatter_spritesheet.png) in a
 * small OOP wrapper. Sheet is 500x500 with 9 frames of 166x156 each.
 */
export class ScatterSpriteSheet {
  /** File name of the underlying sheet image. */
  public static readonly IMAGE_KEY = "scatter_spritesheet.png";

  private static _instance: ScatterSpriteSheet | null = null;

  private readonly frames = new Map<string, Texture>();
  private readonly animations = new Map<string, Texture[]>();

  /** Frame size and grid: 3x3 in 500x500, each frame 166x156 with centered padding. */
  private static readonly FRAME_W = 166;
  private static readonly FRAME_H = 156;
  private static readonly PAD_X = (500 - 166 * 3) / 2;  // 1
  private static readonly PAD_Y = (500 - 158 * 3) / 2;  // 16

  private constructor(sheetTexture: Texture) {
    const source =
      (sheetTexture as unknown as { source?: unknown }).source ??
      (sheetTexture as unknown as { baseTexture?: unknown }).baseTexture;

    if (!source) {
      throw new Error("ScatterSpriteSheet: missing base texture source.");
    }

    const { PAD_X, PAD_Y, FRAME_W, FRAME_H } = ScatterSpriteSheet;
    const frameDefs: Record<string, Rectangle> = {
      "scatter_00.png": new Rectangle(PAD_X, PAD_Y, FRAME_W, FRAME_H),
      "scatter_01.png": new Rectangle(PAD_X + FRAME_W, PAD_Y, FRAME_W, FRAME_H),
      "scatter_02.png": new Rectangle(PAD_X + 2 * FRAME_W, PAD_Y, FRAME_W, FRAME_H),
      "scatter_03.png": new Rectangle(PAD_X, PAD_Y + FRAME_H, FRAME_W, FRAME_H),
      "scatter_04.png": new Rectangle(PAD_X + FRAME_W, PAD_Y + FRAME_H, FRAME_W, FRAME_H),
      "scatter_05.png": new Rectangle(PAD_X + 2 * FRAME_W, PAD_Y + FRAME_H, FRAME_W, FRAME_H),
      "scatter_06.png": new Rectangle(PAD_X, PAD_Y + 2 * FRAME_H, FRAME_W, FRAME_H),
      "scatter_07.png": new Rectangle(PAD_X + FRAME_W, PAD_Y + 2 * FRAME_H, FRAME_W, FRAME_H),
      "scatter_08.png": new Rectangle(PAD_X + 2 * FRAME_W, PAD_Y + 2 * FRAME_H, FRAME_W, FRAME_H),
    };

    for (const [name, rect] of Object.entries(frameDefs)) {
      const tex = new Texture({
        source,
        frame: rect,
      } as ConstructorParameters<typeof Texture>[0]);
      this.frames.set(name, tex);
    }

    const scatterOrder = [
      "scatter_00.png",
      "scatter_01.png",
      "scatter_02.png",
      "scatter_03.png",
      "scatter_04.png",
      "scatter_05.png",
      "scatter_06.png",
      "scatter_07.png",
      "scatter_08.png",
    ];

    this.animations.set(
      "scatter",
      scatterOrder.map((key) => {
        const tex = this.frames.get(key);
        if (!tex) {
          throw new Error(`ScatterSpriteSheet: missing frame texture for ${key}`);
        }
        return tex;
      })
    );
  }

  /**
   * Returns the singleton instance. Assumes /scatter_spritesheet.png has been
   * preloaded via Assets.load(...) in main.ts.
   */
  public static getInstance(): ScatterSpriteSheet {
    if (!this._instance) {
      const tex =
        (Assets.get("/" + this.IMAGE_KEY) as Texture | undefined) ??
        (Assets.get(this.IMAGE_KEY) as Texture | undefined) ??
        Texture.from("/" + this.IMAGE_KEY) ??
        Texture.from(this.IMAGE_KEY);
      if (!tex) {
        throw new Error(
          "ScatterSpriteSheet: base texture not loaded. Make sure /scatter_spritesheet.png is included in Assets.load(...)."
        );
      }
      this._instance = new ScatterSpriteSheet(tex);
    }
    return this._instance;
  }

  public getFrame(name: string): Texture {
    const tex = this.frames.get(name);
    if (!tex) {
      throw new Error(`ScatterSpriteSheet: unknown frame "${name}"`);
    }
    return tex;
  }

  public getAnimation(name: string): Texture[] {
    const anim = this.animations.get(name);
    if (!anim) {
      throw new Error(`ScatterSpriteSheet: unknown animation "${name}"`);
    }
    return anim;
  }

  public createAnimatedSprite(
    animationName = "scatter",
    animationSpeed = 0.15,
    delaySeconds = 0,
    loop = true
  ): AnimatedSprite {
    const frames = this.getAnimation(animationName);
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5);
    sprite.animationSpeed = animationSpeed;
    sprite.loop = loop;
    if (delaySeconds > 0) {
      sprite.stop();
      setTimeout(() => sprite.play(), delaySeconds * 1000);
    } else {
      sprite.play();
    }
    return sprite;
  }
}
