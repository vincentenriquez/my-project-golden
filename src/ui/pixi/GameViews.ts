import type { Graphics, Sprite, Text } from "pixi.js";
import type { SlotInfoContainer } from "./SlotInfoContainer";
import type {
  AutoSpinButtonsView,
  DimOverlayView,
  SlotInfoView,
  TextView,
} from "../../app/uiPorts";
export type {
  AutoSpinButtonsView,
  DimOverlayView,
  SlotInfoView,
  TextView,
} from "../../app/uiPorts";

export class PixiTextView implements TextView {
  constructor(private readonly inner: Text) {}

  get text(): string {
    return this.inner.text;
  }
  set text(value: string) {
    this.inner.text = value;
  }

  get visible(): boolean {
    return this.inner.visible;
  }
  set visible(value: boolean) {
    this.inner.visible = value;
  }

  get alpha(): number {
    return this.inner.alpha;
  }
  set alpha(value: number) {
    this.inner.alpha = value;
  }

  get scale(): { x: number; y: number } {
    return this.inner.scale;
  }
  set scale(value: { x: number; y: number }) {
    this.inner.scale.set(value.x, value.y);
  }

  setText(text: string): void {
    this.inner.text = text;
  }

  setVisible(visible: boolean): void {
    this.inner.visible = visible;
  }

  setAlpha(alpha: number): void {
    this.inner.alpha = alpha;
  }

  setScale(x: number, y: number): void {
    this.inner.scale.set(x, y);
  }
}

export class PixiSlotInfoView implements SlotInfoView {
  constructor(private readonly slotInfo: SlotInfoContainer) {}

  setDefault(): void {
    this.slotInfo.setDefault();
  }

  setAutoSpin(remaining: number): void {
    this.slotInfo.setAutoSpin(remaining);
  }

  setFreeSpin(count: number): void {
    this.slotInfo.setFreeSpin(count);
  }

  setFreeSpinCount(count: number): void {
    this.slotInfo.setFreeSpinCount(count);
  }
}

export class PixiDimOverlayView implements DimOverlayView {
  constructor(private readonly overlay: Graphics) {}

  get visible(): boolean {
    return this.overlay.visible;
  }
  set visible(value: boolean) {
    this.overlay.visible = value;
  }

  setVisible(visible: boolean): void {
    this.overlay.visible = visible;
  }
}

export class PixiAutoSpinButtonsView implements AutoSpinButtonsView {
  constructor(
    private readonly startButton: Sprite,
    private readonly stopButton: Sprite
  ) {}

  showStart(): void {
    this.startButton.visible = true;
    this.stopButton.visible = false;
  }

  showStop(): void {
    this.startButton.visible = false;
    this.stopButton.visible = true;
  }
}

