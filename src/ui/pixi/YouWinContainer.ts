import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { WinCountUp } from "../shared/WinCountUp";
import { formatPesoAmount } from "../shared/currency";

const SHOW_DURATION_MS = 1300;

const formatAmount = formatPesoAmount;

export class YouWinContainer {
  private readonly container: Container;
  private readonly bgSprite: Sprite;
  private readonly amountShadowText: Text;
  private readonly amountText: Text;
  private readonly viewportW: number;
  private readonly viewportH: number;

  private cancelToken = 0;

  constructor(parent: Container, width: number, height: number) {
    this.viewportW = width;
    this.viewportH = height;
    this.container = new Container();
    this.container.visible = false;
    parent.addChild(this.container);

    const bg = new Graphics();
    bg.beginFill(0x000000, 0.8);
    bg.drawRect(0, 0, width, height);
    bg.endFill();
    this.container.addChild(bg);

    const centerX = width / 2;
    const centerY = height / 2;

    this.bgSprite = new Sprite(Texture.from("/you_win_con.png"));
    this.bgSprite.anchor.set(0.5);
    this.bgSprite.x = centerX;
    this.bgSprite.y = centerY;
    this.container.addChild(this.bgSprite);

    this.layout();

    this.amountText = new Text(
      "0.00",
      new TextStyle({
        fontSize: 88,
        fontWeight: "bold",
        fill: 0xFDF1C0,
        stroke: 0x3b1404,
        fontFamily: "Arial",
        align: "center",
      }),
    );
    this.amountText.anchor.set(0.5);
    this.amountText.x = centerX;
    this.amountText.y = centerY;

    // Cheap, type-safe shadow: duplicate text behind with offset + darker fill.
    this.amountShadowText = new Text(
      "0.00",
      new TextStyle({
        fontSize: 88,
        fontWeight: "bold",
        fill: 0x000000,
        fontFamily: "Arial",
        align: "center",
      }),
    );
    this.amountShadowText.anchor.set(0.5);
    this.amountShadowText.x = centerX + 3;
    this.amountShadowText.y = centerY + 3;
    this.container.addChild(this.amountShadowText);
    this.container.addChild(this.amountText);

    this.fitAmountText();
  }

  async show(totalWin: number): Promise<void> {
    const token = ++this.cancelToken;
    this.container.alpha = 0;
    this.container.visible = true;
    this.amountText.text = formatAmount(0);
    this.amountShadowText.text = this.amountText.text;
    this.fitAmountText();

    await this.fade(0, 1, 220, token);
    if (token !== this.cancelToken) return;

    await this.countUpTo(totalWin, token);
    if (token !== this.cancelToken) return;

    // Small settle delay so the player can read the final number.
    await this.wait(SHOW_DURATION_MS, token);
    if (token !== this.cancelToken) return;

    await this.fade(1, 0, 220, token);
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
      window.setTimeout(() => {
        if (token === this.cancelToken) resolve();
        else resolve();
      }, ms);
    });
  }

  private fade(from: number, to: number, durationMs: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        if (token !== this.cancelToken) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / durationMs);
        this.container.alpha = from + (to - from) * t;
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
        this.amountShadowText.text = this.amountText.text;
        this.fitAmountText();
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

  private layout(): void {
    // Scale the container art to fit nicely inside the viewport.
    // We avoid hardcoding pixel sizes; instead we scale to a % of screen.
    const texW = this.bgSprite.texture.width || 1;
    const texH = this.bgSprite.texture.height || 1;
    const maxW = this.viewportW * 0.92;
    const maxH = this.viewportH * 0.55;
    const scale = Math.min(maxW / texW, maxH / texH, 1);
    this.bgSprite.scale.set(scale);
  }

  private fitAmountText(): void {
    // Fit win text inside the visible bounds of the container art.
    // Use a conservative safe area so long values stay readable.
    const maxW = this.bgSprite.width * 0.62;
    const maxH = this.bgSprite.height * 0.18;
    if (maxW <= 0 || maxH <= 0) return;

    // Reset scale then shrink-to-fit.
    this.amountText.scale.set(1);
    this.amountShadowText.scale.set(1);
    const sx = maxW / Math.max(1, this.amountText.width);
    const sy = maxH / Math.max(1, this.amountText.height);
    const s = Math.min(1, sx, sy);
    this.amountText.scale.set(s);
    this.amountShadowText.scale.set(s);
  }
}

