import {
  Application,
  Assets,
  Sprite,
  Container,
  Texture,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import { SYMBOL_ASSETS } from "./symbols";
import { Reel } from "./Reel";
import { GameController } from "./GameController";

/**
 * Slot machine entry point (OOP refactor).
 * Responsibilities: PIXI app, layers, assets, UI layout, tween loop, and wiring the game controller.
 */

// ---------- Layout constants ----------
const REEL_WIDTH = 130;
const SYMBOL_SIZE = 90;
const REELS_COUNT = 5;
const SYMBOLS_PER_REEL = 3;
const REEL_STRIP_LENGTH = 15;
const BG_IMAGE = "bgg1.jpg";
const MIN_BET = 1;
const MAX_BET = 100;
const AUTO_SPIN_COUNT = 10;

// ---------- PIXI App ----------
const app = new Application();

await app.init({
  resizeTo: window,
});

document.body.appendChild(app.canvas);

// --------- Layer containers ---------
const backgroundLayer = new Container();
const machineLayer = new Container();
const reelsLayer = new Container();
const frameLayer = new Container();
const highlightLayer = new Container();
const uiLayer = new Container();
const overlayLayer =  new Container(); // for popups, big win effects, etc.

app.stage.addChild(backgroundLayer);
app.stage.addChild(machineLayer);
app.stage.addChild(reelsLayer);
app.stage.addChild(frameLayer);
app.stage.addChild(highlightLayer);
app.stage.addChild(uiLayer);
app.stage.addChild(overlayLayer);

app.stage.sortableChildren = true;
backgroundLayer.zIndex = 0;
machineLayer.zIndex = 5;
reelsLayer.zIndex = 10;
frameLayer.zIndex = 20;
highlightLayer.zIndex = 30;
uiLayer.zIndex = 40;
overlayLayer.zIndex = 50;

// ---------- Tween state (used by main loop) ----------
interface Tween {
  object: unknown;
  property: string;
  propertyBeginValue: number;
  target: number;
  easing: (t: number) => number;
  time: number;
  change?: (t: Tween) => void;
  complete?: (t: Tween) => void;
  start: number;
}
const tweening: Tween[] = [];

function backout(amount: number): (t: number) => number {
  return (t: number) => --t * t * ((amount + 1) * t + amount) + 1;
}

function tweenTo(
  object: unknown,
  property: string,
  target: number,
  time: number,
  easing: (t: number) => number,
  onchange?: (t: Tween) => void,
  oncomplete?: (t: Tween) => void
): void {
  tweening.push({
    object,
    property,
    propertyBeginValue: (object as Record<string, number>)[property],
    target,
    easing,
    time,
    change: onchange,
    complete: oncomplete,
    start: Date.now(),
  });
}

// ---------- Globals (set in buildSlotMachine) ----------
let slotTextures: Texture[] = [];
let reelContainer: Container;
let mask: Graphics;
let gameController: GameController;

// ---------- Load Assets ----------
await Assets.load([...SYMBOL_ASSETS, BG_IMAGE, "/spinnerBtn.png"]);
const spinTexture = Texture.from("/spinnerBtn.png");

function onAssetsLoaded() {
  console.log("Assets loaded!");
  slotTextures = SYMBOL_ASSETS.map((url) => Texture.from(url));
  buildSlotMachine();
}
onAssetsLoaded();

// ---------- Build Slot Machine ----------
function buildSlotMachine() {
  // Background
  const bg = new Sprite(Texture.from(BG_IMAGE));
  bg.width = app.screen.width;
  bg.height = app.screen.height;
  backgroundLayer.addChild(bg);

  // Reel container
  reelContainer = new Container();
  reelsLayer.addChild(reelContainer);

  // Create mask so symbols outside frame are clipped
  const frameWidth = REEL_WIDTH * REELS_COUNT;
  const frameHeight = SYMBOL_SIZE * SYMBOLS_PER_REEL;
  mask = new Graphics();
  mask.beginFill(0xffffff);
  mask.drawRoundedRect(0, 0, frameWidth, frameHeight, 14);
  mask.endFill();
  mask.x = Math.round((app.screen.width - frameWidth) / 2);
  const topMargin = Math.round((app.screen.height - frameHeight) / 2.5);
  mask.y = topMargin;
  app.stage.addChild(mask);
  reelContainer.mask = mask;
  reelContainer.x = mask.x;
  reelContainer.y = mask.y;

  // Position highlight layer to match reel container
  highlightLayer.x = mask.x;
  highlightLayer.y = mask.y;

  // ---------- SLOT FRAME ---------
  const frame = new Graphics();

  const padding = 10;

  frame.lineStyle(8, 0xd4af37);
  frame.beginFill(0x1a1a1a, 0);
  frame.drawRoundedRect(
    mask.x - padding,
    mask.y - padding,
    frameWidth + padding * 2,
    frameHeight + padding * 2,
    16
  );
  frame.endFill();
  frameLayer.addChild(frame);

  const innerGlow = new Graphics();
  innerGlow.lineStyle(3, 0xffff66, 0.8);
  innerGlow.drawRoundedRect(
    mask.x - 5,
    mask.y - 5,
    frameWidth + 10,
    frameHeight + 10,
    16
  );
  frameLayer.addChild(innerGlow);

  // Create reels (OOP: each Reel owns its strip and sprites)
  const reelConfig = {
    reelWidth: REEL_WIDTH,
    symbolSize: SYMBOL_SIZE,
    symbolsPerReel: SYMBOLS_PER_REEL,
    stripLength: REEL_STRIP_LENGTH,
    totalSymbols: 10, // TOTAL_SYMBOLS from symbols.ts
  };
  const reels: Reel[] = [];
  for (let i = 0; i < REELS_COUNT; i++) {
    const reel = new Reel(reelConfig, slotTextures);
    reel.container.x = i * REEL_WIDTH;
    reelContainer.addChild(reel.container);
    reels.push(reel);
  }

  // UI: credits and result
  const style = new TextStyle({
    fontSize: 18,
    fontWeight: "bold",
    fill: 0xffffff,
  });

  const creditsText = new Text(`Balance: 1000`, style);
  creditsText.anchor.set(1, 0.5); // Right-align
  creditsText.x = app.screen.width / 2 - 150;
  creditsText.y = mask.y + frameHeight + 50;
  uiLayer.addChild(creditsText);

  const resultText = new Text("", new TextStyle({
  fontSize: 48,
  fontWeight: "bold",
  fill: 0xffd700,
  stroke: 0x000000,
  fontFamily: "Arial",
}));

resultText.anchor.set(0.5);

// center on slot machine
resultText.x = app.screen.width / 2;
resultText.y = mask.y + frameHeight / 2;

overlayLayer.addChild(resultText);

  // BET CONTAINER (holds bet text and +/- buttons, centered below spin button)
  const betContainer = new Container();
  uiLayer.addChild(betContainer);
  // Position bet container centered below spin button
  betContainer.x = app.screen.width / 2;
  betContainer.y = mask.y + frameHeight + 50;

  // MINUS BUTTON
  const minusButton = new Graphics();

  minusButton.beginFill(0xd4af37);
  minusButton.drawRoundedRect(0, 0, 40, 40, 100);
  minusButton.endFill();
  
  // minusButton.pivot.set(25, 25);
  // minusButton.x = -80;
  // minusButton.cursor = "pointer";
  // betContainer.addChild(minusButton);
  minusButton.eventMode = "static";
  minusButton.cursor = "pointer";

  const minusText = new Text("-", new TextStyle({
    fontSize: 18,
    fontWeight: "bold",
    fill: 0x1a1a1a,
  }));
  minusText.anchor.set(0.5);
  minusText.x = 20;
  minusText.y = 20;
  minusButton.addChild(minusText);
  betContainer.addChild(minusButton);

  const betText = new Text(`Bet: 10`, style);
  betText.anchor.set(0.5);
  betContainer.addChild(betText);

  // PLUS BUTTON
  const plusButton = new Graphics();

  plusButton.beginFill(0xd4af37);
  plusButton.drawRoundedRect(0, 0, 40, 40, 100);
  plusButton.endFill();

  plusButton.eventMode = "static";
  plusButton.cursor = "pointer";

  const plusText = new Text("+", new TextStyle({
    fontSize: 18,
    fontWeight: "bold",
    fill: 0x1a1a1a,
  }));
  plusText.anchor.set(0.5);
  plusText.x = 20;
  plusText.y = 20;
  plusButton.addChild(plusText);
  betContainer.addChild(plusButton);

  // ---------- QUICK BET BUTTONS ----------
const quickBets = [10, 50, 100];
const quickBetButtons: Graphics[] = [];

quickBets.forEach((amount, idx) => {
  const btn = new Graphics();
  btn.beginFill(0xd4af37);
  btn.drawRoundedRect(0, 0, 60, 50, 10);
  btn.endFill();
  btn.eventMode = "static";
  btn.cursor = "pointer";

  const label = new Text(`${amount}`, {
    fontSize: 22,
    fontWeight: "bold",
    fill: 0x1a1a1a,
  });
  label.anchor.set(0.5);
  label.x = 30;
  label.y = 25;
  btn.addChild(label);

  // Position horizontally after plusButton with spacing
  btn.x = plusButton.x + 0 + idx * 70; // adjust spacing
  btn.y = 120;
  betContainer.addChild(btn);

  btn.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    gameController.setBet(amount);
    gameController.updateBetDisplay();
    minusButton.x = -betText.width / 2 - minusButton.width - spacing;
    plusButton.x = betText.width / 2 + spacing;
  });

  quickBetButtons.push(btn);
});


  const spacing = 20;

  minusButton.x = -betText.width / 2 - minusButton.width - spacing; // position to the left of bet text
  minusButton.y = -minusButton.height / 2; // center vertically

  // Event listeners for buttons
  betText.x = 0;
  betText.y = 0;

  plusButton.x = betText.width / 2 + spacing;
  plusButton.y = -plusButton.height / 2;

  // ---------- REMAINING SPINS TEXT (beside bet) ----------
  const totalSpinText = new Text("Free spins: 0", style);
  totalSpinText.anchor.set(0, 0.5);
  totalSpinText.x = plusButton.x + plusButton.width + 30;
  totalSpinText.y = 0;
  betContainer.addChild(totalSpinText);

  minusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() > MIN_BET) {
      gameController.setBet(gameController.getBet() - 1);
      gameController.updateBetDisplay();
      minusButton.x = -betText.width / 2 - minusButton.width - spacing;
      plusButton.x = betText.width / 2 + spacing;
    }
  });

  plusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() < MAX_BET) {
      gameController.setBet(gameController.getBet() + 1);
      gameController.updateBetDisplay();
      minusButton.x = -betText.width / 2 - minusButton.width - spacing;
      plusButton.x = betText.width / 2 + spacing;
    }
  });

  // Bet text (centered below spin button)
  // betText = new Text(`Bet: ${bet}`, style);
  // betText.anchor.set(0.5);
  // betText.x = app.screen.width / 2;
  // betText.y = mask.y + frameHeight + 50;
  // uiLayer.addChild(betText);

  // ---------- Spin button using spinner button image ----------
  console.log("Creating spin button with texture:", spinTexture);
  
  const spinButton = new Sprite(spinTexture);

  spinButton.anchor.set(0.5);
  spinButton.x = app.screen.width / 2;
  spinButton.y = mask.y + frameHeight + 130;
  spinButton.width = 100;
  spinButton.height = 100;
  spinButton.eventMode = "static";
  spinButton.cursor = "pointer";

  console.log("Spin button created at position:", spinButton.x, spinButton.y);

  // Add rounded corners to spinner button using mask
  const spinButtonMask = new Graphics();
  spinButtonMask.beginFill(0xffffff);
  spinButtonMask.drawRoundedRect(
    spinButton.x - 50, // x position (center - half width)
    spinButton.y - 50, // y position (center - half height)
    100, // width
    100, // height
    20 // border radius
  );
  spinButtonMask.endFill();
  uiLayer.addChild(spinButtonMask);
  spinButton.mask = spinButtonMask;

  uiLayer.addChild(spinButton);

  spinButton.addEventListener("pointerdown", () => {
    if (!gameController.canSpin()) return;
    if (!gameController.getInFreeSpins() && !gameController.hasEnoughCredits()) {
      resultText.text = "Not enough credits!";
      return;
    }
    gameController.deductBet();
    tweenTo(spinButton, "rotation", spinButton.rotation + Math.PI * 2, 700, (t: number) => t);
    const result = gameController.generateResult({ weighted: true });
    gameController.spinToResult(result);
  });

  // ---------- AUTO SPIN BUTTON ----------
  const autoSpinButton = new Graphics();
  autoSpinButton.beginFill(0x2255cc);
  autoSpinButton.drawRoundedRect(0, 0, 130, 50, 14);
  autoSpinButton.endFill();
  autoSpinButton.eventMode = "static";
  autoSpinButton.cursor = "pointer";

  const autoSpinLabel = new Text("AUTO SPIN", new TextStyle({ fontSize: 16, fontWeight: "bold", fill: 0xffffff }));
  autoSpinLabel.anchor.set(0.5);
  autoSpinLabel.x = 65;
  autoSpinLabel.y = 25;
  autoSpinButton.addChild(autoSpinLabel);

  autoSpinButton.x = spinButton.x + 70;
  autoSpinButton.y = spinButton.y - 25;
  uiLayer.addChild(autoSpinButton);

  autoSpinButton.addEventListener("pointerdown", () => {
    if (!gameController.canStartAutoSpin()) return;
    gameController.startAutoSpin(AUTO_SPIN_COUNT);
    tweenTo(spinButton, "rotation", spinButton.rotation + Math.PI * 2, 700, (t: number) => t);
    gameController.runNextAutoSpin();
  });

  // ---------- STOP AUTO SPIN BUTTON ----------
  const stopAutoSpinButton = new Graphics();
  stopAutoSpinButton.beginFill(0xcc2222);
  stopAutoSpinButton.drawRoundedRect(0, 0, 130, 50, 14);
  stopAutoSpinButton.endFill();
  stopAutoSpinButton.eventMode = "static";
  stopAutoSpinButton.cursor = "pointer";
  stopAutoSpinButton.visible = false;

  const stopLabel = new Text("STOP AUTO", new TextStyle({ fontSize: 15, fontWeight: "bold", fill: 0xffffff }));
  stopLabel.anchor.set(0.5);
  stopLabel.x = 65;
  stopLabel.y = 25;
  stopAutoSpinButton.addChild(stopLabel);

  stopAutoSpinButton.x = autoSpinButton.x;
  stopAutoSpinButton.y = autoSpinButton.y;
  uiLayer.addChild(stopAutoSpinButton);

  // ---------- Game controller (reels + state + evaluation) ----------
  const controllerConfig = {
    reelsCount: REELS_COUNT,
    symbolsPerReel: SYMBOLS_PER_REEL,
    reelWidth: REEL_WIDTH,
    symbolSize: SYMBOL_SIZE,
    minBet: MIN_BET,
    maxBet: MAX_BET,
    initialCredits: 1000,
    initialBet: 10,
    autoSpinCount: AUTO_SPIN_COUNT,
  };
  gameController = new GameController(
    reels,
    controllerConfig,
    { creditsText, resultText, betText, totalSpinText, autoSpinButton, stopAutoSpinButton },
    highlightLayer,
    tweenTo,
    backout
  );
  gameController.onAutoSpinContinue = () => {
    setTimeout(() => {
      tweenTo(spinButton, "rotation", spinButton.rotation + Math.PI * 2, 700, (t: number) => t);
      gameController.runNextAutoSpin();
    }, 1200);
  };

  stopAutoSpinButton.addEventListener("pointerdown", () => {
    gameController.cancelAutoSpin();
  });

  // Initial render of reels
  gameController.updateReelsVisuals();

  // ---------- Animation Loop ----------
  app.ticker.add((ticker) => {
    const now = Date.now();
    for (let i = tweening.length - 1; i >= 0; i--) {
      const t = tweening[i];
      const phase = Math.min(1, (now - t.start) / t.time);
      (t.object as Record<string, number>)[t.property] =
        t.propertyBeginValue + (t.target - t.propertyBeginValue) * t.easing(phase);
      if (phase === 1) {
        (t.object as Record<string, number>)[t.property] = t.target;
        if (t.complete) t.complete(t);
        tweening.splice(i, 1);
      }
    }
    gameController.updateReelsVisuals();
    gameController.updateHighlightAnimation(ticker.deltaTime);
  });

  console.log("Slot machine built.");
}

// Debug (from console): gameController.spinToResult(gameController.generateResult({ forceMatrix: [[0,0,0],[1,1,1],...] }))