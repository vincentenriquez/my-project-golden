// src/ui/pixi/assets/FireSpriteSheet.ts
import { Assets, Texture, Rectangle, AnimatedSprite } from "pixi.js";

export class FireSpriteSheet {
    public static readonly IMAGE_KEY = "fire-0.png";
    public static readonly JSON_KEY = "fire.json";   // your JSON file name

    private static _instance: FireSpriteSheet | null = null;

    private readonly frames = new Map<string, Texture>();
    private readonly animations = new Map<string, Texture[]>();

    private static readonly FRAME_W = 202;
    private static readonly FRAME_H = 358;
    private static readonly COLS = 20;   // 20 frames per row based on your JSON

    private constructor(sheetTexture: Texture) {
        const source =
            (sheetTexture as unknown as { source?: unknown }).source ??
            (sheetTexture as unknown as { baseTexture?: unknown }).baseTexture;

        if (!source) {
            throw new Error("FireSpriteSheet: missing base texture source.");
        }

        const { FRAME_W, FRAME_H, COLS } = FireSpriteSheet;
        const totalFrames = 201;

        for (let i = 0; i < totalFrames; i++) {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const frameNum = String(i + 1).padStart(3, "0");
            const name = `ezgif-frame-${frameNum}.png`;

            const rect = new Rectangle(
                col * FRAME_W,
                row * FRAME_H,
                FRAME_W,
                FRAME_H
            );

            const tex = new Texture({
                source,
                frame: rect,
            } as ConstructorParameters<typeof Texture>[0]);

            this.frames.set(name, tex);
        }

        // Build animation array in order
        const frameOrder: Texture[] = [];
        for (let i = 1; i <= totalFrames; i++) {
            const frameNum = String(i).padStart(3, "0");
            const tex = this.frames.get(`ezgif-frame-${frameNum}.png`);
            if (!tex) throw new Error(`FireSpriteSheet: missing frame ${frameNum}`);
            frameOrder.push(tex);
        }

        this.animations.set("fire", frameOrder);
    }

    public static getInstance(): FireSpriteSheet {
        if (!this._instance) {
            const tex =
                (Assets.get("/" + this.IMAGE_KEY) as Texture | undefined) ??
                (Assets.get(this.IMAGE_KEY) as Texture | undefined) ??
                Texture.from("/" + this.IMAGE_KEY) ??
                Texture.from(this.IMAGE_KEY);
            if (!tex) {
                throw new Error(
                    "FireSpriteSheet: base texture not loaded. Make sure fire-0.png is in Assets.load(...)."
                );
            }
            this._instance = new FireSpriteSheet(tex);
        }
        return this._instance;
    }

    public getAnimation(name: string): Texture[] {
        const anim = this.animations.get(name);
        if (!anim) throw new Error(`FireSpriteSheet: unknown animation "${name}"`);
        return anim;
    }

    public createAnimatedSprite(
        animationSpeed = 0.5,
        loop = true
    ): AnimatedSprite {
        const frames = this.getAnimation("fire");
        const sprite = new AnimatedSprite(frames);
        sprite.anchor.set(0.5);
        sprite.animationSpeed = animationSpeed;
        sprite.loop = loop;
        sprite.blendMode = "add";
        sprite.play();
        return sprite;
    }
}