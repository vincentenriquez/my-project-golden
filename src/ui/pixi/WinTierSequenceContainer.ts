import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { determineWinTier, type WinTier } from "../../domain/WinTierService";
import { WinCountUp } from "../shared/WinCountUp";
import { formatPesoAmount } from "../shared/currency";

const STEP_SHOW_DURATION_MS = 1000;

const TIER_ASSETS: Partial<Record<WinTier, string>> = {
  bigWin: "/big_win.png",
  megaWin: "/mega_win.png",
  epicWin: "/epic_win.png",
};

const formatAmount = formatPesoAmount;

function buildTierSequence(highest: WinTier): WinTier[] {
  if (highest === "epicWin") return ["bigWin", "megaWin", "epicWin"];
  if (highest === "megaWin") return ["bigWin", "megaWin"];
  if (highest === "bigWin") return ["bigWin"];
  return [];
}

export class WinTierSequenceContainer {
  private readonly container: Container;
  private readonly tierSprite: Sprite;
  private readonly amountText: Text;
  private readonly width: number;
  private readonly height: number;

  private cancelToken = 0;

  constructor(parent: Container, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.container = new Container();
    this.container.visible = false;
    this.container.sortableChildren = true;
    parent.addChild(this.container);

    const bg = new Graphics();
    bg.beginFill(0x000000, 0.8);
    bg.drawRect(0, 0, width, height);
    bg.endFill();
    this.container.addChild(bg);

    const centerX = width / 2;
    const centerY = height / 2;

    this.tierSprite = new Sprite(Texture.EMPTY);
    this.tierSprite.anchor.set(0.5);
    this.tierSprite.x = centerX;
    this.tierSprite.y = centerY - 80;
    this.tierSprite.alpha = 0;
    this.tierSprite.zIndex = 2;
    this.container.addChild(this.tierSprite);

    this.amountText = new Text(
      "0.00",
      new TextStyle({
        fontSize: 50,
        fontWeight: "bold",
        fill: 0xffd700,
        fontFamily: "Arial",
        align: "center",
      }),
    );
    this.amountText.anchor.set(0.5);
    this.amountText.x = centerX;
    this.amountText.y = centerY + 50;
    this.amountText.zIndex = 2;
    this.container.addChild(this.amountText);
  }

  async show(totalWin: number, bet: number): Promise<void> {
    const token = ++this.cancelToken;
    const highestTier = determineWinTier(totalWin, bet);
    const sequence = buildTierSequence(highestTier);

    this.amountText.text = formatAmount(0);
    this.container.visible = true;
    this.container.alpha = 1;
    this.tierSprite.alpha = 0;

    // Start total win count-up immediately.
    const countUpPromise = this.countUpTo(totalWin, token);

    // Tier progression (sequential) — only if applicable.
    if (sequence.length > 0) {
      for (let i = 0; i < sequence.length; i++) {
        const tier = sequence[i];
        const isLast = i === sequence.length - 1;
        if (token !== this.cancelToken) return;

        this.setTierSprite(tier);
        this.fitTierSprite();

        await this.fadeNode(this.tierSprite, 0, 1, 220, token);
        if (token !== this.cancelToken) return;
        await this.wait(STEP_SHOW_DURATION_MS, token);
        if (token !== this.cancelToken) return;
        if (!isLast) {
          await this.fadeNode(this.tierSprite, 1, 0, 220, token);
          if (token !== this.cancelToken) return;
        }
      }
    }

    // Ensure total-win count-up always completes before we finish.
    await countUpPromise;
    if (token !== this.cancelToken) return;

    // Small settle delay so the player can read the final number
    // even when no tier sequence applies.
    await this.wait(3000, token);
    if (token !== this.cancelToken) return;

    this.container.visible = false;
  }

  cancel(): void {
    this.cancelToken++;
    this.container.visible = false;
    this.container.alpha = 0;
  }

  destroy(): void {
    this.container.removeChildren();
    this.container.destroy();
  }

  private wait(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(), ms);
    });
  }

  private fadeNode(
    node: Container | Text | Sprite,
    from: number,
    to: number,
    durationMs: number,
    token: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        if (token !== this.cancelToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / durationMs);
        node.alpha = from + (to - from) * t;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  private countUpTo(totalWin: number, token: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const countUp = new WinCountUp((displayValue, isDone) => {
        if (token !== this.cancelToken) return;
        // WinCountUp counts integers only; convert win amount to cents for correct 2-dec formatting.
        this.amountText.text = formatAmount(displayValue / 100);
        if (isDone) resolve();
      });

      let last = performance.now();
      countUp.start(Math.round(totalWin * 100));

      const tick = (now: number) => {
        if (token !== this.cancelToken) {
          countUp.cancel();
          resolve();
          return;
        }
        const delta = now - last;
        last = now;
        countUp.update(delta);

        if (countUp.isActive) requestAnimationFrame(tick);
      };

      requestAnimationFrame(tick);
    });
  }

  private setTierSprite(tier: WinTier): void {
    const asset = TIER_ASSETS[tier];
    if (!asset) {
      this.tierSprite.texture = Texture.EMPTY;
      this.tierSprite.visible = false;
      return;
    }
    this.tierSprite.visible = true;
    this.tierSprite.texture = Texture.from(asset);
    // Reset scale to avoid carrying previous tier scaling.
    this.tierSprite.scale.set(1);
  }

  private fitTierSprite(): void {
    // Fit the tier art within a safe area so it looks good on different screens.
    const maxW = this.width * 0.65;
    const maxH = this.height * 0.22;
    const w = Math.max(1, this.tierSprite.texture.width);
    const h = Math.max(1, this.tierSprite.texture.height);
    const scale = Math.min(maxW / w, maxH / h, 1);
    this.tierSprite.scale.set(scale);
  }
}

