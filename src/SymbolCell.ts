import { Container, Sprite, Graphics, Texture } from "pixi.js";

export class SymbolCell extends Container {
  public sprite: Sprite;
  public background: Graphics;

  constructor(texture: Texture, width: number, height: number) {
    super();

    // Draw cell background (fits frame cell)
    this.background = new Graphics();
    this.background.beginFill(0x111111);
    this.background.drawRect(0, 0, width, height);
    this.background.endFill();
    this.addChild(this.background);

    // Create symbol sprite
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);

    // Fit sprite inside cell
    const padding = 10;

    const scale = Math.min(
      (width - padding) / this.sprite.width,
      (height - padding) / this.sprite.height
    );

    this.sprite.scale.set(scale);
    this.sprite.x = width / 2;
    this.sprite.y = height / 2;

    this.addChild(this.sprite);
  }
}