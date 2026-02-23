// BetPanel.ts
import { Container, Graphics, Text, TextStyle } from "pixi.js";

export interface BetPanelConfig {
  minBet: number;
  maxBet: number;
  initialBet: number;
}

export class BetPanel {
  public container: Container;

  private bet: number;
  private readonly minBet: number;
  private readonly maxBet: number;

  private betText!: Text;
  private freeSpinText!: Text;

  public onBetChange?: (bet: number) => void;

  constructor(config: BetPanelConfig) {
    this.container = new Container();

    this.minBet = config.minBet;
    this.maxBet = config.maxBet;
    this.bet = config.initialBet;

    this.createUI();
  }

  private createUI() {
    const style = new TextStyle({
      fill: 0xffffff,
      fontSize: 24,
      fontWeight: "bold",
    });

    // Bet Display
    this.betText = new Text(`BET: ${this.bet}`, style);
    this.betText.y = 0;
    this.container.addChild(this.betText);

    // Free Spin Text
    this.freeSpinText = new Text(`FREE SPINS: 0`, style);
    this.freeSpinText.y = 40;
    this.container.addChild(this.freeSpinText);

    // +/- Buttons
    const minusBtn = this.createButton("-", 0);
    const plusBtn = this.createButton("+", 60);

    minusBtn.on("pointerdown", () => this.changeBet(-1));
    plusBtn.on("pointerdown", () => this.changeBet(1));

    // Quick Bet Buttons
    const quick10 = this.createQuickBetButton(10, 140);
    const quick50 = this.createQuickBetButton(50, 200);
    const quick100 = this.createQuickBetButton(100, 260);

    this.container.addChild(minusBtn, plusBtn, quick10, quick50, quick100);
  }

  private createButton(label: string, x: number): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = 80;

    const bg = new Graphics()
      .beginFill(0x333333)
      .drawRoundedRect(0, 0, 50, 40, 8)
      .endFill();

    const txt = new Text(label, { fill: 0xffffff, fontSize: 20 });
    txt.anchor.set(0.5);
    txt.x = 25;
    txt.y = 20;

    btn.addChild(bg, txt);
    btn.eventMode = "static";
    btn.cursor = "pointer";

    return btn;
  }

  private createQuickBetButton(value: number, x: number): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = 80;

    const bg = new Graphics()
      .beginFill(0x555555)
      .drawRoundedRect(0, 0, 70, 40, 8)
      .endFill();

    const txt = new Text(value.toString(), {
      fill: 0xffffff,
      fontSize: 18,
    });

    txt.anchor.set(0.5);
    txt.x = 35;
    txt.y = 20;

    btn.addChild(bg, txt);
    btn.eventMode = "static";
    btn.cursor = "pointer";

    btn.on("pointerdown", () => this.setBet(value));

    return btn;
  }

  private changeBet(delta: number) {
    this.setBet(this.bet + delta);
  }

  private setBet(newBet: number) {
    const clamped = Math.max(this.minBet, Math.min(this.maxBet, newBet));
    this.bet = clamped;
    this.betText.text = `BET: ${this.bet}`;

    this.onBetChange?.(this.bet);
  }

  public setFreeSpins(count: number) {
    this.freeSpinText.text = `FREE SPINS: ${count}`;
  }

  public getBet(): number {
    return this.bet;
  }
}