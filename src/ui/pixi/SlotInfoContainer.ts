/**
 * SlotInfoContainer.ts
 *
 * Unified text information display for the slot machine UI.
 * Shows different messages based on game state with GSAP typing animation in default mode.
 */
import { Container, Text, TextStyle } from "pixi.js";
import { gsap } from "gsap";

export type SlotInfoState = "default" | "autoSpin" | "freeSpin";

const DEFAULT_MESSAGES = [
  "Wilds substitute for any symbol except the Scatter!",
  "Get 3 Scatters on different reels to trigger Free Spins!",
];

const TYPING_CHARS_PER_SEC = 35;
const PAUSE_BETWEEN_MESSAGES_MS = 3000;

export interface SlotInfoContainerConfig {
  textStyle?: Partial<TextStyle>;
  x?: number;
  y?: number;
}

export class SlotInfoContainer {
  readonly container: Container;
  private readonly text: Text;
  private state: SlotInfoState = "default";
  private messageIndex = 0;
  private typingTween: gsap.core.Tween | null = null;
  private cycleTween: gsap.core.Tween | null = null;

  constructor(config: SlotInfoContainerConfig = {}) {
    const style = new TextStyle({
      fontSize: 20,
      fontWeight: "bold",
      fill: 0xfdf1c0,
      fontFamily: "Arial",
      wordWrap: true,
      wordWrapWidth: 400,
      align: "center",
      ...config.textStyle,
    });

    this.container = new Container();
    this.container.x = config.x ?? 0;
    this.container.y = config.y ?? 0;

    this.text = new Text("", style);
    this.text.anchor.set(0.5);
    this.text.x = 0;
    this.text.y = 0;
    this.container.addChild(this.text);

    this._startDefaultCycle();
  }

  /** Switch to default state with typing animation cycling through hint messages. */
  setDefault(): void {
    if (this.state === "default") return;
    this._killTweens();
    this.state = "default";
    this.messageIndex = 0;
    this._startDefaultCycle();
  }

  /** Switch to auto spin state. */
  setAutoSpin(count: number): void {
    if (this.state === "autoSpin" && this.text.text === `AUTO SPINS: ${count}`) return;
    this._killTweens();
    this.state = "autoSpin";
    this.text.text = `AUTO SPINS: ${count}`;
    this.text.visible = true;
  }

  /** Switch to free spin state. */
  setFreeSpin(count: number): void {
    if (this.state === "freeSpin" && this.text.text.includes(`${count}`)) return;
    this._killTweens();
    this.state = "freeSpin";
    this.text.text = `FREE SPINS LEFT: ${count}`;
    this.text.visible = true;
  }

  /** Update free spin count (e.g. "Free spins: X" during play). */
  setFreeSpinCount(count: number): void {
    if (this.state !== "freeSpin") return;
    this.text.text = `Free spins: ${count}`;
  }

  /** Hide the info display entirely. */
  hide(): void {
    this._killTweens();
    this.text.visible = false;
    this.state = "default";
  }

  /**
   * Show the scatter bonus message (e.g. "BONUS! 10 Free Spins!") in this container.
   * Used when 3+ Scatter symbols trigger the feature; do not display this in resultText.
   */
  showBonusFreeSpinsAwarded(count: number): void {
    this._killTweens();
    this.state = "freeSpin";
    this.text.text = `BONUS! ${count} Free Spins!`;
    this.text.visible = true;
  }

  private _killTweens(): void {
    if (this.typingTween) {
      this.typingTween.kill();
      this.typingTween = null;
    }
    if (this.cycleTween) {
      this.cycleTween.kill();
      this.cycleTween = null;
    }
  }

  private _startDefaultCycle(): void {
    this.text.visible = true;
    this._typeNextMessage();
  }

  private _typeNextMessage(): void {
    const msg = DEFAULT_MESSAGES[this.messageIndex];
    const duration = msg.length / TYPING_CHARS_PER_SEC;

    const proxy = { charCount: 0 };
    this.typingTween = gsap.to(proxy, {
      charCount: msg.length,
      duration,
      ease: "none",
      onUpdate: () => {
        this.text.text = msg.slice(0, Math.floor(proxy.charCount));
      },
      onComplete: () => {
        this.typingTween = null;
        this._scheduleNextMessage();
      },
    });
  }

  private _scheduleNextMessage(): void {
    if (this.state !== "default") return;
    this.cycleTween = gsap.delayedCall(PAUSE_BETWEEN_MESSAGES_MS / 1000, () => {
      this.cycleTween = null;
      this.messageIndex = (this.messageIndex + 1) % DEFAULT_MESSAGES.length;
      this._typeNextMessage();
    });
  }
}
