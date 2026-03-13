import { Assets, Texture, Rectangle, AnimatedSprite } from "pixi.js";
//WildSpriteSheet.ts
/**
 * WildSpriteSheet
 *
 * Encapsulates the wild 3x3 spritesheet (try_wild.png) in a
 * small OOP wrapper so the JSON config is no longer required.
 */
export class WildSpriteSheet {
  /** File name of the underlying sheet image. */
  public static readonly IMAGE_KEY = "try_wild.png";

  private static _instance: WildSpriteSheet | null = null;

  private readonly frames = new Map<string, Texture>();
  private readonly animations = new Map<string, Texture[]>();

  private constructor(sheetTexture: Texture) {
    const source =
      (sheetTexture as unknown as { source?: unknown }).source ??
      (sheetTexture as unknown as { baseTexture?: unknown }).baseTexture;

    if (!source) {
      throw new Error("WildSpriteSheet: missing base texture source.");
    }

    const frameDefs: Record<string, Rectangle> = {
      "wild_00.png": new Rectangle(4, 4, 336, 336),
      "wild_01.png": new Rectangle(344, 4, 336, 336),
      "wild_02.png": new Rectangle(684, 4, 336, 336),
      "wild_03.png": new Rectangle(4, 344, 336, 336),
      "wild_04.png": new Rectangle(344, 344, 336, 336),
      "wild_05.png": new Rectangle(684, 344, 336, 336),
      "wild_06.png": new Rectangle(4, 684, 336, 336),
      "wild_07.png": new Rectangle(344, 684, 336, 336),
      "wild_08.png": new Rectangle(684, 684, 336, 336),
    };

    for (const [name, rect] of Object.entries(frameDefs)) {
      const tex = new Texture({
        source,
        frame: rect,
      } as ConstructorParameters<typeof Texture>[0]);
      this.frames.set(name, tex);
    }

    const enemyOrder = [
      "wild_00.png",
      "wild_01.png",
      "wild_02.png",
      "wild_03.png",
      "wild_04.png",
      "wild_05.png",
      "wild_06.png",
      "wild_07.png",
      "wild_08.png",
    ];

    this.animations.set(
      "enemy",
      enemyOrder.map((key) => {
        const tex = this.frames.get(key);
        if (!tex) {
          throw new Error(`WildSpriteSheet: missing frame texture for ${key}`);
        }
        return tex;
      })
    );
  }

  /**
   * Returns the singleton instance. Assumes /try_wild.png has been
   * preloaded via Assets.load(...) in main.ts.
   */
  public static getInstance(): WildSpriteSheet {
    if (!this._instance) {
      const tex =
        (Assets.get("/" + this.IMAGE_KEY) as Texture | undefined) ??
        (Assets.get(this.IMAGE_KEY) as Texture | undefined) ??
        Texture.from("/" + this.IMAGE_KEY) ??
        Texture.from(this.IMAGE_KEY);
      if (!tex) {
        throw new Error(
          "WildSpriteSheet: base texture not loaded. Make sure /try_wild.png is included in Assets.load(...)."
        );
      }
      this._instance = new WildSpriteSheet(tex);
    }
    return this._instance;
  }

  public getFrame(name: string): Texture {
    const tex = this.frames.get(name);
    if (!tex) {
      throw new Error(`WildSpriteSheet: unknown frame "${name}"`);
    }
    return tex;
  }

  public getAnimation(name: string): Texture[] {
    const anim = this.animations.get(name);
    if (!anim) {
      throw new Error(`WildSpriteSheet: unknown animation "${name}"`);
    }
    return anim;
  }

  public createAnimatedSprite(
    animationName = "enemy",
    animationSpeed = 0.15,
    loop = true
  ): AnimatedSprite {
    const frames = this.getAnimation(animationName);
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5);
    sprite.animationSpeed = animationSpeed;
    sprite.loop = loop;
    sprite.play();
    return sprite;
  }
}

