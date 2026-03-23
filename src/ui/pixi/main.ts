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
import { SYMBOL_ASSETS, WILD_SYMBOL_ID, SCATTER_SYMBOL_ID } from "../../domain/symbolConfig";
import { Reel } from "./Reel";
import { GameController } from "../../app/GameController";
import type { IGameSession, ISpinEvaluator, ISpinResultGenerator, IScatterService } from "../../app/ports";
import type { GameEvent } from "../../app/events";
import { ScatterService } from "../../domain/ScatterService";
import { ScatterServiceAdapter } from "../../app/ScatterServiceAdapter";
import { GameSession } from "../../domain/GameSession";
import { DefaultSymbolPicker } from "../../domain/DefaultSymbolPicker";
import type { ISymbolPicker } from "../../domain/ports";
import { SpinResultGeneratorAdapter } from "../../app/SpinResultGeneratorAdapter";
import { SpinEvaluatorAdapter } from "../../app/SpinEvaluatorAdapter";
import { PixiReelsPort } from "./PixiReelsPort";
import { PixiWinAnimator } from "./PixiWinAnimator";
import { RangeCountUp } from "../shared/RangeCountUp";
import { ScatterIntroEffect } from "./ScatterIntroEffect";
import {
  PixiAutoSpinButtonsView,
  PixiDimOverlayView,
  PixiSlotInfoView,
  PixiTextView,
} from "./GameViews";
import { FireflyEffect } from "./FireflyEffect";
import { FireFrameEffect } from "./FireFrameEffect";
import { WinCountUp } from "../shared/WinCountUp";
import { SlotInfoContainer } from "./SlotInfoContainer";
import { GreetingsScatterPanel } from "./GreetingsScatterPanel";
import { BonusResultPanel } from "./BonusResultPanel";
import { PostBonusTransitionController } from "./PostBonusTransitionController";
import { gsap } from "gsap";

// ---------- Layout constants ----------
const REEL_WIDTH = 160;
const SYMBOL_SIZE = 125;
const REELS_COUNT = 5;
const SYMBOLS_PER_REEL = 3;
const REEL_STRIP_LENGTH = 30;
const BG_IMAGE = "try_again.png";
const SCATTER_BG_IMAGE = "SCATTER_BG.png";
const MIN_BET = 10;
const MAX_BET = 1000000;
const AUTO_SPIN_COUNT = 10;
const ROW_PADDING = 0;

// ---------- PIXI App ----------
const app = new Application();

await app.init({
  resizeTo: window,
  backgroundAlpha: 0,
});

app.stage.sortableChildren = true;
document.body.appendChild(app.canvas);

// ---------- Game Container (root, centered on screen) ----------
const gameContainer = new Container();
app.stage.addChild(gameContainer);

const frameTexture = await Assets.load("/BASIC_GAME.png");
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

// After your existing Assets.load([...]) call
await ScatterIntroEffect.preload();
await FireFrameEffect.preload();
await GreetingsScatterPanel.preload();

// --------- Layer containers ---------
const backgroundLayer = new Container();
const machineLayer = new Container();
const reelsLayer = new Container();
const frameLayer = new Container();
const fireLayer = new Container();
const greetingsLayer = new Container();
const highlightLayer = new Container();
const uiLayer = new Container();
const overlayLayer = new Container();

const stageOverLayer = new Container();
stageOverLayer.zIndex = 100;
app.stage.addChild(stageOverLayer);

const scatterIntroEffect = new ScatterIntroEffect(app, stageOverLayer);

app.renderer.on("resize", () => {
  scatterIntroEffect.onResize();
})

/**
 * winFloatLayer — sits ABOVE highlightLayer (zIndex 35) so floating clones
 * render on top of glow effects but below the UI.
 * It lives as a direct child of gameContainer, so its local coordinate space
 * matches gameContainer exactly (no extra offset needed).
 */
const winFloatLayer = new Container();

app.stage.addChild(backgroundLayer);
gameContainer.addChild(machineLayer);
gameContainer.addChild(reelsLayer);
gameContainer.addChild(frameLayer);
gameContainer.addChild(fireLayer);      // fire overlay — above frame, below highlights
gameContainer.addChild(highlightLayer);
gameContainer.addChild(winFloatLayer);   // ← NEW
gameContainer.addChild(uiLayer);
gameContainer.addChild(overlayLayer);
gameContainer.addChild(greetingsLayer);  // greetings panel overlay — highest in gameContainer

gameContainer.sortableChildren = true;
app.stage.sortableChildren = true;

backgroundLayer.zIndex = 0;
machineLayer.zIndex = 5;
reelsLayer.zIndex = 10;
frameLayer.zIndex = 20;
fireLayer.zIndex = 22;         // above reel frame, below win highlights
highlightLayer.zIndex = 30;
winFloatLayer.zIndex = 35;             // ← above highlights, below UI
uiLayer.zIndex = 40;
overlayLayer.zIndex = 50;
greetingsLayer.zIndex = 110;           // highest so it covers everything including UI if needed
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

// Add this alongside your existing backout() function
function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
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
let reelsPort: PixiReelsPort;
let winAnimator: PixiWinAnimator;
let fireflyEffect: FireflyEffect;
let fireFrameEffect: FireFrameEffect;
let greetingsScatterPanel: GreetingsScatterPanel;
let bonusResultPanel: BonusResultPanel;
let uiTick: ((deltaTime: number, deltaMS: number) => void) | null = null;

// ---------- Helper: GameController factory (composition root: DDD + SOLID) ----------
function createGameControllerInstance(
  reels: Reel[],
  controllerConfig: {
    reelsCount: number;
    symbolsPerReel: number;
    reelWidth: number;
    symbolSize: number;
    minBet: number;
    maxBet: number;
    initialCredits: number;
    initialBet: number;
    autoSpinCount: number;
    buyFreeSpinsCount: number;
    buyFreeSpinsCostMultiplier: number;
  },
  uiDeps: {
    creditsText: Text;
    resultText: Text;
    multiplierText: Text;
    amountLabel: Text;
    slotInfo: SlotInfoContainer;
    totalWinText: Text;
    dimOverlay: Graphics;
    autoSpinButton: Sprite;
    stopAutoSpinButton: Sprite;
    changeFrame: (img: string) => void;
    setScatterModeUi: (active: boolean) => void;
    setStarfieldWarp: (active: boolean) => void;
  },
  highlightLayer: Container,
  winFloatLayer: Container
): GameController {
  const session: IGameSession = new GameSession({
    initialCredits: controllerConfig.initialCredits,
    initialBet: controllerConfig.initialBet,
    minBet: controllerConfig.minBet,
    maxBet: controllerConfig.maxBet,
  });
  const symbolPicker: ISymbolPicker = new DefaultSymbolPicker();
  const spinEvaluator: ISpinEvaluator = new SpinEvaluatorAdapter();
  const spinResultGenerator: ISpinResultGenerator = new SpinResultGeneratorAdapter(
    {
      reelsCount: controllerConfig.reelsCount,
      symbolsPerReel: controllerConfig.symbolsPerReel,
      wildAllowedReelIndices: new Set([1, 2, 3]),
    },
    symbolPicker
  );
  const scatterService: IScatterService = new ScatterServiceAdapter(new ScatterService());
  const wildAllowedReelIndices = new Set([1, 2, 3]);
  const dimOverlayView = new PixiDimOverlayView(uiDeps.dimOverlay);
  reelsPort = new PixiReelsPort(
    reels,
    controllerConfig.symbolsPerReel,
    tweenTo,
    bounceOut,
    () => symbolPicker.pick(),
    wildAllowedReelIndices,
    () => symbolPicker.pickExcluding(WILD_SYMBOL_ID)
  );
  winAnimator = new PixiWinAnimator(
    reels,
    highlightLayer,
    winFloatLayer,
    tweenTo,
    (visible) => dimOverlayView.setVisible(visible)
  );
  const controller = new GameController(
    controllerConfig,
    session,
    spinEvaluator,
    spinResultGenerator,
    scatterService
  );

  // HUD views/adapters (UI-owned)
  const creditsView = new PixiTextView(uiDeps.creditsText);
  const resultView = new PixiTextView(uiDeps.resultText);
  const betView = new PixiTextView(uiDeps.amountLabel);
  const slotInfoView = new PixiSlotInfoView(uiDeps.slotInfo);
  const totalWinView = new PixiTextView(uiDeps.totalWinText);
  const autoSpinButtonsView = new PixiAutoSpinButtonsView(
    uiDeps.autoSpinButton,
    uiDeps.stopAutoSpinButton
  );

  // Formatting helper (UI-owned)
  const formatAmount = (value: number): string => {
    const [intPart, decPart] = value.toFixed(2).split(".");
    const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `₱${withSeparators}.${decPart}`;
  };

  // HUD animators (UI-owned)
  let pendingBonusText = "";
  let balanceAtWinStart = controller.getCredits();
  let totalWinDisplayValue = 0;
  let betDisplayValue = controller.getBet();
  let cascadeStepCount = 0;
  let winSequenceTimers: number[] = [];
  let winDisplayMode: "normal" | "cascadeBase" = "normal";
  let cascadeFinalHitAmount = 0;
  let cascadeMultiplierForDisplay = 1;

  const clearWinSequenceTimers = () => {
    for (const id of winSequenceTimers) clearTimeout(id);
    winSequenceTimers = [];
  };

  const winCountUp = new WinCountUp((displayValue, isDone) => {
    if (winDisplayMode === "cascadeBase") {
      resultView.setText(`${formatAmount(displayValue)}${pendingBonusText}`);
      if (isDone) {
        // Wait 400ms, show xN, then show "= final", then release win lock.
        const t1 = window.setTimeout(() => {
          uiDeps.multiplierText.text = `x${cascadeMultiplierForDisplay}`;
          uiDeps.multiplierText.visible = true;

          const t2 = window.setTimeout(() => {
            resultView.setText(`${formatAmount(cascadeFinalHitAmount)}${pendingBonusText}`);

            const t3 = window.setTimeout(() => {
              winDisplayMode = "normal";
              controller.onWinDisplayFinished();
            }, 400);
            winSequenceTimers.push(t3);
          }, 400);
          winSequenceTimers.push(t2);
        }, 400);
        winSequenceTimers.push(t1);
      }
      return;
    }

    resultView.setText(`${formatAmount(displayValue)}${pendingBonusText}`);
    if (isDone) controller.onWinDisplayFinished();
  });
  const balanceCountUp = new WinCountUp((displayValue) => {
    creditsView.setText(formatAmount(balanceAtWinStart + displayValue));
  });
  const totalWinCountUp = new RangeCountUp((displayValue) => {
    totalWinDisplayValue = displayValue;
    totalWinView.setText(formatAmount(displayValue));
  });
  const betCountUp = new RangeCountUp((displayValue) => {
    betDisplayValue = displayValue;
    betView.setText(formatAmount(displayValue));
  });

  const postBonusTransition = new PostBonusTransitionController({
    scatterIntroEffect,
    slotInfoView,
    changeFrame: uiDeps.changeFrame,
    setScatterModeUi: uiDeps.setScatterModeUi,
    setStarfieldWarp: uiDeps.setStarfieldWarp,
    fireFrameEffect,
  });

  // Subscribe to app events and drive PIXI/UI.
  controller.subscribe((event: GameEvent) => {
    switch (event.type) {
      case "SpinStarted": {
        cascadeStepCount = 0;
        clearWinSequenceTimers();
        winDisplayMode = "normal";
        uiDeps.multiplierText.visible = false;
        uiDeps.multiplierText.text = "";
        break;
      }
      case "SpinBlocked": {
        if (event.reason === "insufficientCredits") {
          resultView.setText("Not enough credits!");
        }
        break;
      }
      case "CreditsChanged": {
        if (event.animate) {
          balanceAtWinStart = event.from;
          balanceCountUp.start(event.to - event.from);
        } else {
          creditsView.setText(formatAmount(event.to));
        }
        break;
      }
      case "BetChanged": {
        betCountUp.start(betDisplayValue, event.to);
        break;
      }
      case "TotalWinChanged": {
        if (event.animate) {
          totalWinCountUp.start(totalWinDisplayValue, event.totalSoFar);
        } else {
          totalWinDisplayValue = event.totalSoFar;
          totalWinView.setText(formatAmount(event.totalSoFar));
        }
        break;
      }
      case "ResultTextChanged": {
        pendingBonusText = "";
        clearWinSequenceTimers();
        winDisplayMode = "normal";
        winCountUp.cancel();
        resultView.setText(event.text);
        break;
      }
      case "WinAmountAwarded": {
        pendingBonusText = event.bonusText;
        clearWinSequenceTimers();
        resultView.alpha = 0;
        resultView.scale = { x: 0.65, y: 0.65 };
        resultView.visible = true;
        tweenTo(
          resultView.scale,
          "x",
          1,
          450,
          backout(1.4),
          () => { resultView.scale.y = resultView.scale.x; }
        );
        tweenTo(resultView, "alpha", 1, 320, (t) => 1 - Math.pow(1 - t, 2));

        // Cascade-only multiplier breakdown (x2+).
        // Only cascades increment cascadeStepCount, so multiplier is (cascadeStepCount + 1).
        const multiplier = cascadeStepCount + 1;
        if (multiplier >= 2 && event.hitAmount > 0) {
          winDisplayMode = "cascadeBase";
          cascadeMultiplierForDisplay = multiplier;
          cascadeFinalHitAmount = event.hitAmount;

          // Hide multiplier until after the base win count-up finishes.
          uiDeps.multiplierText.visible = false;

          const baseHit = event.hitAmount / multiplier;
          winCountUp.start(baseHit);
        } else {
          winDisplayMode = "normal";
          resultView.setText(`${formatAmount(0)}${pendingBonusText}`);
          winCountUp.start(event.hitAmount);
        }
        break;
      }
      case "AutoSpinChanged": {
        if (event.active) {
          autoSpinButtonsView.showStop();
          slotInfoView.setAutoSpin(event.remaining);
        } else {
          autoSpinButtonsView.showStart();
          if (!controller.getInFreeSpins()) slotInfoView.setDefault();
        }
        break;
      }
      case "BonusCompleted": {
        bonusResultPanel.show(
          { totalWin: event.totalWin, bet: event.bet },
          () => controller.onBonusResultDismissed(),
        );
        break;
      }
      case "FreeSpinsChanged": {
        if (event.mode === "entered") {
          slotInfoView.setFreeSpin(event.remaining);
        } else if (event.mode === "updated") {
          slotInfoView.setFreeSpinCount(event.remaining);
        } else if (event.mode === "ended") {
          slotInfoView.setDefault();
        }
        break;
      }
      case "PostBonusTransitionStarted": {
        postBonusTransition.start(() => controller.onPostBonusTransitionComplete());
        break;
      }
      case "PostBonusTransitionComplete": {
        break;
      }
      case "SpinToResultRequested": {
        // Visual-only: rotate the spin button (if present elsewhere in scope).
        reelsPort.clearVisualOverrides();
        winAnimator.clear();
        reelsPort.spinToResult(event.resultPerReel, () => {
          const matrix = reelsPort.getVisibleMatrix(controllerConfig.symbolsPerReel);
          controller.onSpinStopped(matrix);
        });
        break;
      }
      case "WinSequenceRequested": {
        winAnimator.startWinSequence(
          { symbolSize: controllerConfig.symbolSize },
          event.winningPositions,
          event.scatterPositions,
          () => controller.onWinSequenceFinished()
        );
        break;
      }
      case "ScatterBonusSequenceRequested": {
        slotInfoView.showBonusFreeSpinsAwarded(event.freeSpinsAwarded);

        winAnimator.startScatterBonusSequence(
          { symbolSize: controllerConfig.symbolSize },
          event.scatterPositions,
          () => {
            // Slice is done — if already in free spins, skip the intro and UI theme swap
            if (event.isRetrigger) {
              controller.onScatterSequenceFinished();
              return;
            }

            // Show fruit rain effect for 2000ms
            scatterIntroEffect.showFor(2000, () => {
              // Swap UI and background to scatter mode FIRST
              uiDeps.changeFrame("/SCATTER_1MODE.png");
              uiDeps.setScatterModeUi(true);

              uiDeps.setStarfieldWarp(true);

              // Now show the final greeting panel and WAIT for user click
              greetingsScatterPanel.show(() => {
                // User tapped — continue flow to start free spins
                controller.onScatterSequenceFinished();
              }, event.freeSpinsAwarded);

              fireFrameEffect?.show();
            });
          }
        );
        break;
      }
      case "CascadeRequested": {
        cascadeStepCount += 1;
        // Only after the first cascade happens: first cascade shows x2.
        // Set the text now, but reveal it later only if the cascade produces a win.
        uiDeps.multiplierText.text = `x${cascadeStepCount + 1}`;
        uiDeps.multiplierText.visible = false;
        reelsPort.cascade(
          {
            reelsCount: controllerConfig.reelsCount,
            symbolsPerReel: controllerConfig.symbolsPerReel,
            symbolSize: controllerConfig.symbolSize,
            rowPadding: ROW_PADDING,
          },
          event.winningPositions,
          () => {
            const matrix = reelsPort.getVisibleMatrix(controllerConfig.symbolsPerReel);
            controller.onCascadeFinished(matrix);
          }
        );
        break;
      }
      case "RequestNextSpin": {
        setTimeout(() => {
          controller.requestSpin(event.reason === "freeSpin" ? "free" : "auto");
        }, event.afterMs);
        break;
      }
      case "SpinFinished": {
        winAnimator.clear();
        uiDeps.multiplierText.visible = false;
        break;
      }
      case "ScatterCascadeRequested": {
        reelsPort.cascade(
          {
            reelsCount: controllerConfig.reelsCount,
            symbolsPerReel: controllerConfig.symbolsPerReel,
            symbolSize: controllerConfig.symbolSize,
            rowPadding: ROW_PADDING,
          },
          event.scatterPositions,
          () => {
            const matrix = reelsPort.getVisibleMatrix(controllerConfig.symbolsPerReel);
            controller.onScatterCascadeFinished(matrix);
          }
        );
        break;
      }
    }
  });

  // Initial HUD render
  creditsView.setText(formatAmount(controller.getCredits()));
  betView.setText(formatAmount(controller.getBet()));
  totalWinView.setText("₱0.00");
  dimOverlayView.setVisible(false);
  resultView.setText("");

  // Expose ticker updates via closure for main ticker.
  uiTick = (deltaTime: number, deltaMS: number) => {
    winAnimator.update(deltaTime);
    if (fireflyEffect) fireflyEffect.update(app.ticker);
    winCountUp.update(deltaMS);
    balanceCountUp.update(deltaMS);
    totalWinCountUp.update(deltaMS);
    betCountUp.update(deltaMS);

    // Keep multiplier aligned beside the win container text.
    if (uiDeps.multiplierText.visible) {
      uiDeps.multiplierText.x = 0;
      uiDeps.multiplierText.y = uiDeps.resultText.y + 60;
    }
  };

  return controller;
}

await Assets.load([
  ...SYMBOL_ASSETS,
  "/win_container.png",
  "/you_win_con.png",
  "/big_win.png",
  "/mega_win.png",
  "/epic_win.png",
  "/bgQuickBtn.png",
  "/buy_spin.png",
  BG_IMAGE,
  SCATTER_BG_IMAGE,
  "/Frame_13.png",
  "/playBtnn.png",
  "/stopBtnn.png",
  "/SCATTER_1MODE.png",
  "/animated_symbol.json"
]);
const bgQuickBtn = Texture.from("/bgQuickBtn.png");
const winContainerTexture = Texture.from("/win_container.png");
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

  // Initialize FireflyEffect
  FireflyEffect.loadTexture().then(texture => {
    fireflyEffect = new FireflyEffect(app, stageOverLayer, texture);
    fireflyEffect.hide(); // Start hidden
  });


  // ── Reel container + mask ───────────────────────────────────────────────────
  reelContainer = new Container();
  reelsLayer.addChild(reelContainer);

  const frameWidth = REEL_WIDTH * REELS_COUNT;
  const frameHeight = (SYMBOL_SIZE + ROW_PADDING) * SYMBOLS_PER_REEL - ROW_PADDING;

  mask = new Graphics();
  mask.drawRoundedRect(0, 0, frameWidth, frameHeight, 14);
  mask.endFill();
  mask.x = -frameWidth / 2;
  mask.y = -frameHeight / 1.25;
  gameContainer.addChild(mask);
  reelContainer.mask = mask;
  reelContainer.x = mask.x;
  reelContainer.y = mask.y;

  highlightLayer.x = 0;
  highlightLayer.y = 0;

  // winFloatLayer shares the same origin as gameContainer (no offset needed)
  winFloatLayer.x = 0;
  winFloatLayer.y = 0;

  // ── Fire frame and Greetings overlays (scatter mode) ──────────────────────
  // Instantiate AFTER mask is positioned so reel bounds are final.

  const reelBounds = {
    frameWidth: frameWidth,
    frameHeight: frameHeight,
    originX: mask.x,
    originY: mask.y,
  };

  fireLayer.x = 0;
  fireLayer.y = 0;
  fireFrameEffect = new FireFrameEffect(fireLayer, reelBounds);

  greetingsLayer.x = 0;
  greetingsLayer.y = 0;
  greetingsScatterPanel = new GreetingsScatterPanel(app, greetingsLayer, reelBounds);
  bonusResultPanel = new BonusResultPanel(app, stageOverLayer);

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
    rowPadding: ROW_PADDING,

  };
  const reels: Reel[] = [];
  for (let i = 0; i < REELS_COUNT; i++) {
    const reel = new Reel(reelConfig, slotTextures);
    reel.container.x = i * REEL_WIDTH;
    reelContainer.addChild(reel.container);
    reels.push(reel);
  }

  // ── Dim overlay (covers reels when there's a win or spin) ───────────────────
  const dimOverlay = new Graphics();
  dimOverlay.beginFill(0x000000, 0); // Semi-transparent black
  dimOverlay.drawRect(
    -frameSprite.width / 2,
    -frameSprite.height / 2,
    frameSprite.width,
    frameSprite.height
  );
  dimOverlay.endFill();
  dimOverlay.x = 0;
  dimOverlay.y = -75;
  dimOverlay.zIndex = 25;
  dimOverlay.visible = false;
  dimOverlay.height = 400;
  gameContainer.addChild(dimOverlay);

  // ── Result text ─────────────────────────────────────────────────────────────
  const resultTextContainer = new Container();
  resultTextContainer.x = 0;
  resultTextContainer.y = mask.y + frameHeight / 2 - 200;
  resultTextContainer.zIndex = 10;
  overlayLayer.addChild(resultTextContainer);

  // Background image for resultText (auto-sizes to text)
  const resultBg = new Sprite(winContainerTexture);
  resultBg.anchor.set(0.5);
  resultBg.x = 0;
  resultBg.y = 0;
  resultBg.width = 0;
  resultBg.height = 50;
  resultTextContainer.addChild(resultBg);

  const resultText = new Text("", new TextStyle({
    fontSize: 20,
    fontWeight: "bold",
    fill: 0xffd700,
    stroke: 0x000000,
    fontFamily: "Roboto Serif",
  }));
  resultText.anchor.set(0.5);
  resultText.x = 0;
  resultText.y = 0;
  resultTextContainer.addChild(resultText);

  // Cascade multiplier indicator (appears after first cascade)
  const multiplierText = new Text("", new TextStyle({
    fontSize: 20,
    fontWeight: "bold",
    fill: 0xFDF1C0,
    stroke: 0x000000,
    fontFamily: "Roboto Serif Bold",
  }));
  multiplierText.anchor.set(0.5);
  multiplierText.visible = false;
  resultTextContainer.addChild(multiplierText);

  // ── Spin button ─────────────────────────────────────────────────────────────
  const SPIN_BTN_SIZE = 150;
  const SPIN_BTN_HALF = SPIN_BTN_SIZE / 2;

  const spinButton = new Sprite(spinTexture);
  spinButton.anchor.set(0.5);
  spinButton.width = SPIN_BTN_SIZE;
  spinButton.height = SPIN_BTN_SIZE;
  spinButton.x = 0;
  spinButton.y = mask.y + frameHeight + 385;
  spinButton.eventMode = "static";
  spinButton.cursor = "pointer";
  spinButton.zIndex = 100;

  app.ticker.add((delta) => {
    spinButton.rotation += 0.01;
  })

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

  const spinLabel = new Text("SPIN", new TextStyle({
    fontSize: 20,
    fontWeight: "bolder",
    fill: 0xFDF1C0,
    fontFamily: "Roboto Serif",
  }));
  spinLabel.anchor.set(0.5);
  spinLabel.x = spinButton.x;
  spinLabel.y = spinButton.y;
  spinLabel.zIndex = 101;
  overlayLayer.addChild(spinLabel);

  spinButton.mask = spinButtonMask;

  // ── Buy Free Spins button (left of spin button) ────────────────────────────
  const BUY_BTN_W = 130;
  const BUY_BTN_H = 130;
  const buyBtnContainer = new Container();
  buyBtnContainer.x = spinButton.x - SPIN_BTN_SIZE / 2 - BUY_BTN_W / 2 - 170;
  buyBtnContainer.y = spinButton.y;
  buyBtnContainer.zIndex = 100;

  const buyBtnBg = new Graphics();
  buyBtnBg.beginFill(0xd4af37, 0);
  buyBtnBg.drawRoundedRect(-BUY_BTN_W / 2, -BUY_BTN_H / 2, BUY_BTN_W, BUY_BTN_H, 10);
  buyBtnBg.endFill();
  buyBtnContainer.addChild(buyBtnBg);

  const buyBtnLabelSprite = new Sprite(Texture.from("/buy_spin.png"));
  buyBtnLabelSprite.anchor.set(0.5);
  buyBtnLabelSprite.x = 0;
  buyBtnLabelSprite.y = 0;
  // Scale to fit within button bounds (preserve aspect).
  const labelPad = 8;
  const maxW = BUY_BTN_W - labelPad * 2;
  const maxH = BUY_BTN_H - labelPad * 2;
  const sx = maxW / buyBtnLabelSprite.texture.width;
  const sy = maxH / buyBtnLabelSprite.texture.height;
  const s = Math.min(sx, sy);
  buyBtnLabelSprite.scale.set(s);
  buyBtnContainer.addChild(buyBtnLabelSprite);
  buyBtnContainer.eventMode = "static";
  buyBtnContainer.cursor = "pointer";
  overlayLayer.addChild(buyBtnContainer);

  // ── Buy Free Spins confirmation modal (full-screen overlay) ────────────────
  const buyModalContainer = new Container();
  buyModalContainer.zIndex = 200;
  buyModalContainer.visible = false;
  app.stage.addChild(buyModalContainer);

  const buyModalBg = new Graphics();
  function resizeBuyModal() {
    buyModalBg.clear();
    buyModalBg.beginFill(0x000000, 0.75);
    buyModalBg.drawRect(0, 0, app.screen.width, app.screen.height);
    buyModalBg.endFill();
    buyModalBg.eventMode = "static";
    buyModalPanel.x = app.screen.width / 2;
    buyModalPanel.y = app.screen.height / 2;
  }
  buyModalContainer.addChild(buyModalBg);

  const buyModalPanel = new Container();
  buyModalContainer.addChild(buyModalPanel);

  const panelBg = new Graphics();
  const PANEL_W = 360;
  const PANEL_H = 260;
  panelBg.beginFill(0x1a1a2e);
  panelBg.lineStyle(2, 0xd4af37);
  panelBg.drawRoundedRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 16);
  panelBg.endFill();
  buyModalPanel.addChild(panelBg);

  const modalTitle = new Text("BUY FREE SPINS", new TextStyle({
    fontSize: 22, fontWeight: "bold", fill: 0xd4af37, fontFamily: "Arial",
  }));
  modalTitle.anchor.set(0.5);
  modalTitle.y = -PANEL_H / 2 + 40;
  buyModalPanel.addChild(modalTitle);

  const modalDesc = new Text("", new TextStyle({
    fontSize: 16, fill: 0xFDF1C0, fontFamily: "Arial", align: "center", wordWrap: true, wordWrapWidth: PANEL_W - 40,
  }));
  modalDesc.anchor.set(0.5);
  modalDesc.y = -10;
  buyModalPanel.addChild(modalDesc);

  const MODAL_BTN_W = 120;
  const MODAL_BTN_H = 40;

  const confirmBtn = new Graphics();
  confirmBtn.beginFill(0x2ecc71);
  confirmBtn.drawRoundedRect(-MODAL_BTN_W / 2, -MODAL_BTN_H / 2, MODAL_BTN_W, MODAL_BTN_H, 8);
  confirmBtn.endFill();
  confirmBtn.x = -80;
  confirmBtn.y = PANEL_H / 2 - 50;
  confirmBtn.eventMode = "static";
  confirmBtn.cursor = "pointer";
  buyModalPanel.addChild(confirmBtn);

  const confirmLabel = new Text("CONFIRM", new TextStyle({
    fontSize: 16, fontWeight: "bold", fill: 0xffffff, fontFamily: "Arial",
  }));
  confirmLabel.anchor.set(0.5);
  confirmBtn.addChild(confirmLabel);

  const cancelBtn = new Graphics();
  cancelBtn.beginFill(0xe74c3c);
  cancelBtn.drawRoundedRect(-MODAL_BTN_W / 2, -MODAL_BTN_H / 2, MODAL_BTN_W, MODAL_BTN_H, 8);
  cancelBtn.endFill();
  cancelBtn.x = 80;
  cancelBtn.y = PANEL_H / 2 - 50;
  cancelBtn.eventMode = "static";
  cancelBtn.cursor = "pointer";
  buyModalPanel.addChild(cancelBtn);

  const cancelLabel = new Text("CANCEL", new TextStyle({
    fontSize: 16, fontWeight: "bold", fill: 0xffffff, fontFamily: "Arial",
  }));
  cancelLabel.anchor.set(0.5);
  cancelBtn.addChild(cancelLabel);

  resizeBuyModal();
  app.renderer.on("resize", resizeBuyModal);

  function showBuyModal() {
    if (!gameController) return;
    const cost = gameController.getBuyFreeSpinsCost();
    const spins = controllerConfig.buyFreeSpinsCount;
    modalDesc.text = `Purchase ${spins} Free Spins\nCost: ${cost.toFixed(2)} credits\n\nYour balance: ${gameController.getCredits().toFixed(2)}`;
    buyModalContainer.visible = true;
  }

  function hideBuyModal() {
    buyModalContainer.visible = false;
  }

  buyBtnContainer.on("pointerdown", () => {
    if (!gameController || !gameController.canBuyFreeSpins()) return;
    showBuyModal();
  });

  confirmBtn.on("pointerdown", () => {
    hideBuyModal();
    if (gameController) gameController.buyFreeSpins();
  });

  cancelBtn.on("pointerdown", () => {
    hideBuyModal();
  });

  buyModalBg.on("pointerdown", () => {
    hideBuyModal();
  });

  // ── Controls ─────────────────────────────────────────────────────────────────
  const controlsContainer = new Container();
  controlsContainer.x = 0;
  controlsContainer.y = mask.y + frameHeight + 20;
  uiLayer.addChild(controlsContainer);

  const style = new TextStyle({ fontSize: 20, fontWeight: "bold", fill: 0xFDF1C0, fontFamily: "Arial" });
  const ROW_GAP = 55;

  // Balance
  const balanceContainer = new Container();
  balanceContainer.x = -215;
  balanceContainer.y = 87;
  controlsContainer.addChild(balanceContainer);

  const balanceLabel = new Text("BALANCE", new TextStyle({
    fontSize: 16, fontWeight: "bold", fill: 0xFFFFFF, fontFamily: "Arial", align: "left", letterSpacing: 2,
  }));
  balanceLabel.anchor.set(0.5);
  balanceContainer.addChild(balanceLabel);

  const creditsText = new Text("1,000.00", new TextStyle({
    fontSize: 30, fontWeight: "bolder", align: "center", fill: 0xFDF1C0, fontFamily: "Roboto Serif",
  }));
  creditsText.anchor.set(0.5);
  creditsText.x = 0;
  creditsText.y = 30;
  balanceContainer.addChild(creditsText);

  // Total win
  const totalWinContainer = new Container();
  totalWinContainer.x = 215;
  totalWinContainer.y = 87;
  controlsContainer.addChild(totalWinContainer);

  const totalWinLabel = new Text("TOTAL WIN", new TextStyle({
    fontSize: 16, fontWeight: "bold", fill: 0xFFFFFF, fontFamily: "Arial", align: "left", letterSpacing: 2,
  }));
  totalWinLabel.anchor.set(0.5);
  totalWinContainer.addChild(totalWinLabel);

  const totalWinText = new Text("0.00", new TextStyle({
    fontSize: 30, fontWeight: "bolder", fill: 0xFDF1C0, fontFamily: "Roboto Serif",
  }));
  totalWinText.anchor.set(0.5);
  totalWinText.x = 0;
  totalWinText.y = 30;
  totalWinContainer.addChild(totalWinText);

  // Auto spin buttons
  const spinRowContainer = new Container();
  spinRowContainer.x = 0;
  spinRowContainer.y = ROW_GAP;
  controlsContainer.addChild(spinRowContainer);

  const autoSpinButton = new Sprite(autoSpinPlay);
  autoSpinButton.eventMode = "static";
  autoSpinButton.cursor = "pointer";
  autoSpinButton.x = 274;
  autoSpinButton.y = 261;
  spinRowContainer.addChild(autoSpinButton);

  const stopAutoSpinButton = new Sprite(autoSpinStop);
  stopAutoSpinButton.eventMode = "static";
  stopAutoSpinButton.cursor = "pointer";
  stopAutoSpinButton.visible = false;
  stopAutoSpinButton.x = autoSpinButton.x;
  stopAutoSpinButton.y = autoSpinButton.y;
  spinRowContainer.addChild(stopAutoSpinButton);

  // Bet controls
  const betControlsContainer = new Container();
  betControlsContainer.x = 0;
  betControlsContainer.y = 95;
  controlsContainer.addChild(betControlsContainer);

  const betContainer = new Container();
  betContainer.x = 0;
  betContainer.y = 200;
  controlsContainer.addChild(betContainer);

  const betText = new Text("BET", new TextStyle({
    fontSize: 16, fontWeight: "bold", fill: 0xFFFFFF, fontFamily: "Arial", align: "center", letterSpacing: 2,
  }));
  betText.anchor.set(0.5);
  betContainer.addChild(betText);

  const amountLabel = new Text("10.00", new TextStyle({
    fontSize: 30, fontWeight: "bolder", align: "center", fontFamily: "Roboto Serif", fill: 0xFDF1C0,
  }));
  amountLabel.anchor.set(0.5);
  amountLabel.x = 0;
  amountLabel.y = 30;
  betContainer.addChild(amountLabel);

  const totalBetContainer = new Container();
  totalBetContainer.x = 0;
  totalBetContainer.y = -70;
  betControlsContainer.addChild(totalBetContainer);

  const betBtnContainer = new Container();
  betBtnContainer.x = 0;
  betBtnContainer.y = 30;
  betControlsContainer.addChild(betBtnContainer);

  const BTN_SIZE = 40;
  const BTN_SPACING = 250;

  const minusButton = new Graphics();
  minusButton.eventMode = "static";
  minusButton.cursor = "pointer";
  minusButton.beginFill(0xd4af37, 0);
  minusButton.drawRoundedRect(0, 0, BTN_SIZE, BTN_SIZE, 100);
  minusButton.endFill();
  minusButton.width = 75;
  minusButton.height = 75;
  minusButton.x = -254;
  minusButton.y = 59;
  betBtnContainer.addChild(minusButton);

  const minusText = new Text("-", new TextStyle({ fontSize: 30, fontWeight: "bolder", fill: 0xFDF1C0, align: "center" }));
  minusText.anchor.set(0.5);
  minusText.x = BTN_SIZE / 2;
  minusText.y = BTN_SIZE / 2.4;
  minusButton.addChild(minusText);

  const plusButton = new Graphics();
  plusButton.eventMode = "static";
  plusButton.cursor = "pointer";
  plusButton.beginFill(0xd4af37, 0);
  plusButton.drawRoundedRect(0, 0, BTN_SIZE, BTN_SIZE, 100);
  plusButton.endFill();
  plusButton.width = 75;
  plusButton.height = 75;
  plusButton.x = 175;
  plusButton.y = 59;
  betBtnContainer.addChild(plusButton);

  const plusText = new Text("+", new TextStyle({ fontSize: 30, fontWeight: "bolder", fill: 0xFDF1C0, align: "center" }));
  plusText.anchor.set(0.5);
  plusText.x = BTN_SIZE / 1.9;
  plusText.y = BTN_SIZE / 2;
  plusButton.addChild(plusText);

  // Spin status / info container (unified display with typing animation in default state)
  const spinStatusContainer = new Container();
  spinStatusContainer.x = 0;
  spinStatusContainer.y = -280;
  controlsContainer.addChild(spinStatusContainer);

  const slotInfo = new SlotInfoContainer({
    x: 0,
    y: -181,
    textStyle: { fontSize: 25, fontWeight: "bold", fill: 0xFDF1C0, fontFamily: "Arial", wordWrap: true, wordWrapWidth: 700 },
  });
  spinStatusContainer.addChild(slotInfo.container as Container);

  // Quick bet buttons
  const bgQuickBtnSprite = new Sprite(bgQuickBtn);
  bgQuickBtnSprite.anchor.set(0.5);
  bgQuickBtnSprite.x = 0;
  bgQuickBtnSprite.y = ROW_GAP * 5 + 220;
  controlsContainer.addChild(bgQuickBtnSprite);

  const quickBetContainer = new Container();
  quickBetContainer.x = 0;
  quickBetContainer.y = ROW_GAP * 5 + 220;
  controlsContainer.addChild(quickBetContainer);

  const quickBets = [10, 50, 100];
  const QBTN_WIDTH = 100;
  const QBTN_HEIGHT = 44;
  const QBTN_GAP = 9;
  const qTotalWidth = quickBets.length * QBTN_WIDTH + (quickBets.length - 1) * QBTN_GAP;
  const qStartX = -qTotalWidth / 2;

  quickBets.forEach((amount, idx) => {
    const btn = new Graphics();
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.x = qStartX + idx * (QBTN_WIDTH + QBTN_GAP);
    btn.y = -QBTN_HEIGHT / 2;
    const label = new Text(`${amount}`, { fontSize: 20, fontFamily: "Roboto Serif", fontWeight: "bolder", fill: 0xFDF1C0 });
    label.anchor.set(0.5);
    label.x = QBTN_WIDTH / 2;
    label.y = QBTN_HEIGHT / 2;
    btn.addChild(label);
    btn.on("pointerdown", () => {
      if (gameController.getRunning()) return;
      let newBet = amount;
      if (newBet > MAX_BET) newBet = MAX_BET;
      if (newBet < MIN_BET) newBet = MIN_BET;
      gameController.setBet(newBet);
    });
    quickBetContainer.addChild(btn);
  });

  // ── Event Listeners ──────────────────────────────────────────────────────────
  minusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() > MIN_BET) {
      gameController.setBet(gameController.getBet() - 10);
    }
  });

  plusButton.addEventListener("pointerdown", () => {
    if (gameController.getRunning()) return;
    if (gameController.getBet() < MAX_BET) {
      gameController.setBet(gameController.getBet() + 10);
    }
  });

  spinButton.addEventListener("pointerdown", () => {
    gameController.requestSpin("manual");
  });

  autoSpinButton.addEventListener("pointerdown", () => {
    gameController.startAutoSpin(AUTO_SPIN_COUNT);
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
    initialCredits: 10000000,
    initialBet: 10,
    autoSpinCount: AUTO_SPIN_COUNT,
    buyFreeSpinsCount: 10,
    buyFreeSpinsCostMultiplier: 100,
  };

  gameController = createGameControllerInstance(
    reels,
    controllerConfig,
    {
      creditsText,
      resultText,
      multiplierText,
      amountLabel,
      slotInfo,
      totalWinText,
      dimOverlay,
      autoSpinButton,
      stopAutoSpinButton,
      changeFrame: (img: string) => {
        frameSprite.texture = Texture.from(img);
        resizeFrame();
      },
      setScatterModeUi: (active: boolean) => {
        bg.texture = Texture.from(active ? SCATTER_BG_IMAGE : BG_IMAGE);
        resizeBackground();

        spinRowContainer.visible = !active;
        bgQuickBtnSprite.visible = !active;
        quickBetContainer.visible = !active;
        buyBtnContainer.visible = !active;
        minusButton.eventMode = active ? "none" : "static";
        minusButton.alpha = active ? 0.5 : 1;
        plusButton.eventMode = active ? "none" : "static";
        plusButton.alpha = active ? 0.5 : 1;
      },
      setStarfieldWarp: (active: boolean) => {
        if (!fireflyEffect) return;
        if (active) {
          fireflyEffect.show();
        }
        fireflyEffect.setWarp(active);
        if (!active) {
          fireflyEffect.hide();
        }
      }
    },
    highlightLayer,
    winFloatLayer
  );

  // Tell win animator where the reel grid top-edge is.
  winAnimator.setReelBounds(mask.y, mask.x);

  // UI-only: rotate spin button on any spin request coming from the app.
  gameController.subscribe((event) => {
    if (event.type === "SpinToResultRequested") {
      tweenTo(spinButton, "rotation", spinButton.rotation + Math.PI * 4, 700, (t: number) => t);
      // Dim reels during spin
      dimOverlay.visible = true;
    }
    if (event.type === "SpinStopped") {
      // Restore reels after spin stops
      dimOverlay.visible = false;
    }
  });

  // Initial render
  reelsPort.updateReelsVisuals();

  // ── Animation Loop ───────────────────────────────────────────────────────────
  app.ticker.add((ticker) => {
    const now = Date.now();
    for (let i = tweening.length - 1; i >= 0; i--) {
      const t = tweening[i];
      const obj = t.object as Record<string, number> | null | undefined;
      const destroyed = (obj as unknown as { destroyed?: boolean }).destroyed;
      if (obj == null || (typeof destroyed === "boolean" && destroyed)) {
        tweening.splice(i, 1);
        continue;
      }
      const phase = Math.min(1, (now - t.start) / t.time);
      try {
        obj[t.property] = t.propertyBeginValue + (t.target - t.propertyBeginValue) * t.easing(phase);
      } catch {
        tweening.splice(i, 1);
        continue;
      }
      if (t.change) t.change(t);
      if (phase === 1) {
        try {
          obj[t.property] = t.target;
          if (t.complete) t.complete(t);
        } catch {
          // object may have been destroyed in change callback
        }
        tweening.splice(i, 1);
      }
    }
    if (fireflyEffect) fireflyEffect.update(ticker);
    reelsPort.updateReelsVisuals();
    if (uiTick) uiTick(ticker.deltaTime, ticker.deltaMS);
    const canSpin = gameController.canSpin();
    spinButton.eventMode = canSpin ? "static" : "none";
    spinButton.alpha = canSpin ? 1 : 0.6;
    spinButton.cursor = canSpin ? "pointer" : "not-allowed";
    if (spinLabel) {
      spinLabel.alpha = canSpin ? 1 : 0.6;
    }

    const canBuy = gameController.canBuyFreeSpins();
    buyBtnContainer.eventMode = canBuy ? "static" : "none";
    buyBtnContainer.alpha = canBuy ? 1 : 0.4;

    // Result text background: show/hide together and fit to current text size.
    const showResult = resultText.visible && resultText.text.trim().length > 0;
    resultTextContainer.visible = showResult;
    resultBg.alpha = resultText.alpha;
    if (showResult) {
      const PAD_X = 10;
      const PAD_Y = 10;
      const minW = 150;
      const minH = 100;
      resultBg.width = Math.max(minW, resultText.width + PAD_X * 2);
      resultBg.height = Math.max(minH, resultText.height + PAD_Y * 2);
    }
  });

  console.log("Slot machine built.");
}