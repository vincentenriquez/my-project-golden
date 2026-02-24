//main.ts
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

// ---------- Layout constants ----------
const REEL_WIDTH = 155;
const SYMBOL_SIZE = 99;
const REELS_COUNT = 5;
const SYMBOLS_PER_REEL = 3;
const REEL_STRIP_LENGTH = 15;
const BG_IMAGE = "bgg1.jpg";
const MIN_BET = 10;
const MAX_BET = 1000;
const AUTO_SPIN_COUNT = 10;

// ---------- PIXI App ----------
const app = new Application();

await app.init({
  resizeTo: window,
  backgroundAlpha: 0,
});

document.body.appendChild(app.canvas);

// ---------- Game Container (root, centered on screen) ----------
const gameContainer = new Container();
app.stage.addChild(gameContainer);

const frameTexture = await Assets.load("/Frame_2.png");
const frameSprite = new Sprite(frameTexture);
frameSprite.anchor.set(0.5);
gameContainer.addChild(frameSprite);

function resizeFrame() {
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const frameW = frameSprite.texture.width;
  const frameH = frameSprite.texture.height;
  const scale = Math.min(screenW / frameW, screenH / frameH);
  gameContainer.scale.set(scale);
  gameContainer.zIndex = 10;
  gameContainer.x = screenW / 2;
  gameContainer.y = screenH / 2;
}
resizeFrame();
app.renderer.on("resize", resizeFrame);

// --------- Layer containers ---------
const backgroundLayer = new Container();
const machineLayer    = new Container();
const reelsLayer      = new Container();
const frameLayer      = new Container();
const highlightLayer  = new Container();
const uiLayer         = new Container();
const overlayLayer    = new Container();

app.stage.addChild(backgroundLayer);
gameContainer.addChild(machineLayer);
gameContainer.addChild(reelsLayer);
gameContainer.addChild(frameLayer);
gameContainer.addChild(highlightLayer);
gameContainer.addChild(uiLayer);
gameContainer.addChild(overlayLayer);

gameContainer.sortableChildren = true;
app.stage.sortableChildren = true;

backgroundLayer.zIndex = 0;
machineLayer.zIndex    = 5;
reelsLayer.zIndex      = 10;
frameLayer.zIndex      = 20;
highlightLayer.zIndex  = 30;
uiLayer.zIndex         = 40;
overlayLayer.zIndex    = 50;
overlayLayer.sortableChildren = true;

// ---------- Tween system ----------
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

// ---------- Globals ----------
let slotTextures: Texture[] = [];
let reelContainer: Container;
let mask: Graphics;
let gameController: GameController;

// ---------- Load Assets ----------
await Assets.load([...SYMBOL_ASSETS, BG_IMAGE, "/Frame_13.png", "/playBtnn.png", "/stopBtnn.png"]);
const spinTexture = Texture.from("/Frame_13.png");
const autoSpinPlay = Texture.from("/playBtnn.png");
const autoSpinStop = Texture.from("/stopBtnn.png");

function onAssetsLoaded() {
  slotTextures = SYMBOL_ASSETS.map((url) => Texture.from(url));
  buildSlotMachine();
}
onAssetsLoaded();

// ---------- Build Slot Machine ----------
function buildSlotMachine() {

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = new Sprite(Texture.from(BG_IMAGE));
  function resizeBackground() {
    const scaleX = app.screen.width / bg.texture.width;
    const scaleY = app.screen.height / bg.texture.height;
    bg.scale.set(Math.max(scaleX, scaleY));
    bg.x = 0;
    bg.y = 0;
    bg.zIndex = 0;
  }
  resizeBackground();
  app.renderer.on("resize", resizeBackground);
  backgroundLayer.addChild(bg);

  // ── Reel container + mask ───────────────────────────────────────────────────
  reelContainer = new Container();
  reelsLayer.addChild(reelContainer);

  const frameWidth  = REEL_WIDTH * REELS_COUNT;
  const frameHeight = SYMBOL_SIZE * SYMBOLS_PER_REEL;

  mask = new Graphics();
  mask.drawRoundedRect(0, 0, frameWidth, frameHeight, 14);
  mask.endFill();
  mask.x = -frameWidth / 2;
  mask.y = -frameHeight / 1.3;
  gameContainer.addChild(mask);
  reelContainer.mask = mask;
  reelContainer.x   = mask.x;
  reelContainer.y   = mask.y;

  highlightLayer.x = 0;
  highlightLayer.y = 0;

  // ── Frame decoration ────────────────────────────────────────────────────────
  const padding = 10;
  const frame = new Graphics();
  frame.beginFill(0x1a1a1a, 0);
  frame.drawRoundedRect(
    mask.x - padding, mask.y - padding,
    frameWidth + padding * 2, frameHeight + padding * 2,
    16
  );
  frame.endFill();
  frameLayer.addChild(frame);

  const innerGlow = new Graphics();
  innerGlow.lineStyle(3, 0xffff66, 0.8);
  innerGlow.drawRoundedRect(
    mask.x - 5, mask.y - 5,
    frameWidth + 10, frameHeight + 10,
    16
  );
  frameLayer.addChild(innerGlow);

  // ── Reels ───────────────────────────────────────────────────────────────────
  const reelConfig = {
    reelWidth: REEL_WIDTH,
    symbolSize: SYMBOL_SIZE,
    symbolsPerReel: SYMBOLS_PER_REEL,
    stripLength: REEL_STRIP_LENGTH,
    totalSymbols: 10,
  };
  const reels: Reel[] = [];
  for (let i = 0; i < REELS_COUNT; i++) {
    const reel = new Reel(reelConfig, slotTextures);
    reel.container.x = i * REEL_WIDTH;
    reelContainer.addChild(reel.container);
    reels.push(reel);
  }

  // ── Dim overlay (covers reels when there's a win) ──────────────────────────
  // Sits between reelsLayer (zIndex 10) and highlightLayer (zIndex 30)
  const dimOverlay = new Graphics();
  dimOverlay.beginFill(0x000000, 0.55);
  dimOverlay.drawRect(
    -frameSprite.width / 2,  // full frame left edge
    -frameSprite.height / 2, // full frame top edge
    frameSprite.width,
    frameSprite.height
  );
  dimOverlay.endFill();
  dimOverlay.x = 0;
  dimOverlay.y = -75;
  dimOverlay.zIndex = 25;    // above frameLayer (20), below highlightLayer (30)
  dimOverlay.visible = false;
  dimOverlay.height = 400; // extend below reels to cover spin button
  gameContainer.addChild(dimOverlay);

  // ── Result text (on overlayLayer, zIndex 10 so spin button stays on top) ───
  const resultText = new Text("", new TextStyle({
    fontSize: 48,
    fontWeight: "bold",
    fill: 0xffd700,
    stroke: 0x000000,
    fontFamily: "Arial",
  }));
  resultText.anchor.set(0.5);
  resultText.x = 0;
  resultText.y = mask.y + frameHeight / 2;
  resultText.zIndex = 10;
  overlayLayer.addChild(resultText);

  // ┌─────────────────────────────────────────────────────────┐
  // │ SPIN BUTTON → overlayLayer (topmost layer)              │
  // │ zIndex = 100 so it always renders above resultText      │
  // └─────────────────────────────────────────────────────────┘

  const SPIN_BTN_SIZE = 150;
  const SPIN_BTN_HALF = SPIN_BTN_SIZE / 2; // 75

  const spinButton = new Sprite(spinTexture);
  spinButton.anchor.set(0.5);
  spinButton.width  = SPIN_BTN_SIZE;
  spinButton.height = SPIN_BTN_SIZE;
  spinButton.x = 0;                         // centered (gameContainer coords)
  spinButton.y = mask.y + frameHeight + 310; // below reels
  spinButton.eventMode = "static";
  spinButton.cursor = "pointer";
  spinButton.zIndex = 100;

  // Rounded mask for spin button
  const spinButtonMask = new Graphics();
  spinButtonMask.beginFill(0xffffff);
  spinButtonMask.drawRoundedRect(
    -SPIN_BTN_HALF, -SPIN_BTN_HALF,
    SPIN_BTN_SIZE, SPIN_BTN_SIZE,
    20
  );
  spinButtonMask.endFill();
  spinButtonMask.x = spinButton.x;
  spinButtonMask.y = spinButton.y;
  spinButtonMask.zIndex = 99;

  overlayLayer.addChild(spinButtonMask);
  overlayLayer.addChild(spinButton);
  spinButton.mask = spinButtonMask;

  // "SPIN" label centered on spin button
  const spinLabel = new Text("SPIN", new TextStyle({
    fontSize: 20,
    fontWeight: "bolder",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
  }));
  spinLabel.anchor.set(0.5);
  spinLabel.x = spinButton.x;
  spinLabel.y = spinButton.y;
  spinLabel.zIndex = 101; // above spinButton (zIndex 100)
  overlayLayer.addChild(spinLabel);

  spinButton.mask = spinButtonMask;

  // ============================================================
  //  CONTROLS CONTAINER
  //  x = 0 → centered because gameContainer.x = screenW / 2
  // ============================================================
  const controlsContainer = new Container();
  controlsContainer.x = 0;
  controlsContainer.y = mask.y + frameHeight + 20;
  uiLayer.addChild(controlsContainer);

  const style   = new TextStyle({ fontSize: 20, fontWeight: "bold", fill: 0xFDF1C0, fontFamily: "Arial" });
  const ROW_GAP = 55;

  // ┌─────────────────────────────────────────────────────────┐
  // │ SUB-CONTAINER 1 : Balance                               │
  // └─────────────────────────────────────────────────────────┘
  const balanceContainer = new Container();
  balanceContainer.x = -230;
  balanceContainer.y = 484;
  controlsContainer.addChild(balanceContainer);

  // "BALANCE" label — smaller, dimmer
  const balanceLabel = new Text("BALANCE", new TextStyle({
    fontSize: 14,
    fontWeight: "bold",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
    align: "left",
  }));
  balanceLabel.anchor.set(0.5);
  balanceLabel.x = 0;
  balanceLabel.y = 0;
  balanceContainer.addChild(balanceLabel);

  // Amount — larger, prominent
  const creditsText = new Text("1000.00", new TextStyle({
    fontSize: 20,
    fontWeight: "bold",
    align: "left",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
  }));
  creditsText.anchor.set(0.5);
  creditsText.x = 0;
  creditsText.y = 22; // below the label
  balanceContainer.addChild(creditsText);

  // SUB-CONTAINER 1A : TOTAL WIN

  const totalWinContainer = new Container();
  totalWinContainer.x = 230;   // right side — mirror of balanceContainer.x (-230)
  totalWinContainer.y = 484;   // same y as balanceContainer
  controlsContainer.addChild(totalWinContainer);

  const totalWinLabel = new Text("TOTAL WIN", new TextStyle({
    fontSize: 14,
    fontWeight: "bold",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
    align: "left",
  }));
  totalWinLabel.anchor.set(0.5);
  totalWinLabel.x = 0;
  totalWinLabel.y = 0;
  totalWinContainer.addChild(totalWinLabel);

  const totalWinText = new Text("0.00", new TextStyle({
    fontSize: 20,
    fontWeight: "bold",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
  }));
  totalWinText.anchor.set(0.5);
  totalWinText.x = 0;
  totalWinText.y = 22;
  totalWinContainer.addChild(totalWinText);

  // ┌─────────────────────────────────────────────────────────┐
  // │ SUB-CONTAINER 2 : Auto Spin + Stop Auto                 │
  // └─────────────────────────────────────────────────────────┘
  const spinRowContainer = new Container();
  spinRowContainer.x = 0;
  spinRowContainer.y = ROW_GAP;
  controlsContainer.addChild(spinRowContainer);

  // Auto Spin button
  const autoSpinButton = new Sprite(autoSpinPlay);
  autoSpinButton.eventMode = "static";
  autoSpinButton.cursor = "pointer";
  autoSpinButton.x = 273;
  autoSpinButton.y = 97;
  spinRowContainer.addChild(autoSpinButton);

  // Stop Auto Spin button (toggles with Auto Spin)
  const stopAutoSpinButton = new Sprite(autoSpinStop);
  stopAutoSpinButton.eventMode = "static";
  stopAutoSpinButton.cursor = "pointer";
  stopAutoSpinButton.visible = false;
  stopAutoSpinButton.x = autoSpinButton.x;
  stopAutoSpinButton.y = autoSpinButton.y;
  spinRowContainer.addChild(stopAutoSpinButton);

  // ┌─────────────────────────────────────────────────────────┐
  // │ SUB-CONTAINER 3 : Bet controls                          │
  // │   ├── betText           →  Bet: 10                      │
  // │   └── betBtnContainer                                   │
  // │         ├── minusButton →  −                            │
  // │         └── plusButton  →  +                            │
  // └─────────────────────────────────────────────────────────┘
  const betControlsContainer = new Container();
  betControlsContainer.x = 0;
  betControlsContainer.y = ROW_GAP * 3;
  controlsContainer.addChild(betControlsContainer);

  //Bet Container
  const betContainer = new Container();
  betContainer.x = 0;
  betContainer.y = 155;
  controlsContainer.addChild(betContainer);

  // Bet text (centered at x=0
  const betText = new Text("BET", new TextStyle({
    fontSize: 14,
    fontWeight: "bold",
    fill: 0xFDF1C0,
    fontFamily: "Arial",
    align: "center",
  })
  );
  betText.anchor.set(0.5);
  betText.x = 0;
  betText.y = 0;
  betContainer.addChild(betText);

  const amountLabel = new Text("10", new TextStyle({
    fontSize: 20,
    fontWeight: "bold",
    align: "center",
    fontFamily: "Arial",
    fill: 0xFDF1C0,
  }));
  amountLabel.anchor.set(0.5);
  amountLabel.x = 0;
  amountLabel.y = 22;
  betContainer.addChild(amountLabel);

  const totalBetContainer = new Container();
  totalBetContainer.x = 0;
  totalBetContainer.y = -70;
  betControlsContainer.addChild(totalBetContainer);

  // betBtnContainer holds − and + together, centered below betText
  const betBtnContainer = new Container();
  betBtnContainer.x = 0;
  betBtnContainer.y = 30;
  betControlsContainer.addChild(betBtnContainer);

  const BTN_SIZE    = 40;
  const BTN_SPACING = 250;
  const btnTotalWidth = BTN_SIZE * 2 + BTN_SPACING;

  // Minus button (left side)
  const minusButton = new Graphics();
  minusButton.eventMode = "static";
  minusButton.cursor = "pointer";
  minusButton.beginFill(0xd4af37, 0); // black at 20% opacity
  minusButton.drawRoundedRect(0, 0, BTN_SIZE, BTN_SIZE, 100);
  minusButton.endFill();
  minusButton.width = 75;
  minusButton.height = 75;
  minusButton.x = -189;
  minusButton.y = 59;
  betBtnContainer.addChild(minusButton);

  const minusText = new Text("-", new TextStyle({ fontSize: 30, fontWeight: "bolder", fill: 0xFDF1C0, align: "center" }));
  minusText.anchor.set(0.5);
  minusText.x = BTN_SIZE / 2;
  minusText.y = BTN_SIZE / 2.4;
  minusButton.addChild(minusText);

  // Plus button (right side)
  const plusButton = new Graphics();
  plusButton.eventMode = "static";
  plusButton.cursor = "pointer";
  plusButton.beginFill(0xd4af37, 0);
  plusButton.drawRoundedRect(0, 0, BTN_SIZE, BTN_SIZE, 100); // radius 20 = diameter 40
  plusButton.endFill();
  plusButton.width  = 75;            // explicit 40
  plusButton.height = 75;            // explicit 40
  plusButton.x = 110;
  plusButton.y = 59;
  betBtnContainer.addChild(plusButton);

  const plusText = new Text("+", new TextStyle({ fontSize: 30, fontWeight: "bolder", fill: 0xFDF1C0, align: "center" }));
  plusText.anchor.set(0.5);
  plusText.x = BTN_SIZE / 1.9;
  plusText.y = BTN_SIZE / 2;
  plusButton.addChild(plusText);

  // ┌─────────────────────────────────────────────────────────┐
  // │ SUB-CONTAINER 4 : Auto spins counter                    │
  // └─────────────────────────────────────────────────────────┘
  const freeSpinsContainer = new Container();
  freeSpinsContainer.x = 0;
  freeSpinsContainer.y = ROW_GAP * 4 + 30;
  controlsContainer.addChild(freeSpinsContainer);

  const totalSpinText = new Text("Auto spins: 0", style);
  totalSpinText.anchor.set(0.5);
  totalSpinText.x = 0;
  totalSpinText.y = -155;
  freeSpinsContainer.addChild(totalSpinText);

  // ┌─────────────────────────────────────────────────────────┐
  // │ SUB-CONTAINER 5 : Quick bet buttons  10 / 50 / 100      │
  // └─────────────────────────────────────────────────────────┘
  const quickBetContainer = new Container();
  quickBetContainer.x = 0;
  quickBetContainer.y = ROW_GAP * 5 + 135;
  controlsContainer.addChild(quickBetContainer);

  const quickBets   = [10, 50, 100];
  const QBTN_WIDTH  = 65;
  const QBTN_HEIGHT = 50;
  const QBTN_GAP    = 40;
  const qTotalWidth = quickBets.length * QBTN_WIDTH + (quickBets.length - 1) * QBTN_GAP;
  const qStartX     = -qTotalWidth / 2;

  quickBets.forEach((amount, idx) => {
    const btn = new Graphics();
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.x = qStartX + idx * (QBTN_WIDTH + QBTN_GAP);
    btn.y = -QBTN_HEIGHT / 2;

    // btn.beginFill(0xd4af37);
    // btn.drawRoundedRect(0, 0, QBTN_WIDTH, QBTN_HEIGHT, 8);
    // btn.endFill();

    const label = new Text(`${amount}`, { fontSize: 25, fontFamily: "Arial", fontWeight: "bold", fill: 0xFDF1C0 });
    label.anchor.set(0.5);
    label.x = QBTN_WIDTH / 2;
    label.y = QBTN_HEIGHT / 2;
    btn.addChild(label);

    btn.on("pointerdown", () => {
      if (gameController.getRunning()) return;

      const currentBet = gameController.getBet(); // get current bet
      let newBet = currentBet + amount;

      // Clamp bet to maxBet
      if (newBet > MAX_BET) newBet = MAX_BET;

      gameController.setBet(newBet);
      gameController.updateBetDisplay();
    });
    quickBetContainer.addChild(btn);
  });

  // ── Event Listeners ──────────────────────────────────────────────────────────
  minusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() > MIN_BET) {
      gameController.setBet(gameController.getBet() - 10);
      gameController.updateBetDisplay();
    }
  });

  plusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() < MAX_BET) {
      gameController.setBet(gameController.getBet() + 10);
      gameController.updateBetDisplay();
    }
  });

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

  autoSpinButton.addEventListener("pointerdown", () => {
    if (!gameController.canStartAutoSpin()) return;
    gameController.startAutoSpin(AUTO_SPIN_COUNT);
    tweenTo(spinButton, "rotation", spinButton.rotation + Math.PI * 2, 700, (t: number) => t);
    gameController.runNextAutoSpin();
  });

  stopAutoSpinButton.addEventListener("pointerdown", () => {
    gameController.cancelAutoSpin();
  });

  // ── Game Controller ──────────────────────────────────────────────────────────
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

  let currentBet = controllerConfig.initialBet;

  function setBet(value: number) {
    currentBet = Math.max(MIN_BET, Math.min(MAX_BET, value));
    gameController.setBet(currentBet);
    gameController.updateBetDisplay();
  }

  function addToBet(value: number) {
    setBet(currentBet + value);
  }

  gameController = new GameController(
    reels,
    controllerConfig,
    { creditsText, resultText, amountLabel, totalSpinText, totalWinText, autoSpinButton, stopAutoSpinButton, dimOverlay },
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

  // Initial render
  gameController.updateReelsVisuals();

  // ── Animation Loop ───────────────────────────────────────────────────────────
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