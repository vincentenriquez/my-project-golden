import {
  Application,
  Assets,
  Sprite,
  Container,
  Texture,
  Graphics,
  Text,
  TextStyle,
  BlurFilter,
} from "pixi.js";

/**
 * Full updated main.ts for a 10-symbol slot machine (TypeScript + PIXI)
 * - Deterministic reel strips
 * - generateResult() with Weighted RNG + force options
 * - spinToResult() that animates reels to land on a matrix
 * - evaluatePaylines(), evaluateWays(), evaluateScatters()
 * - Simple UI (credits, spin button, result text)
 * - + and - buttons for bet adjustment
 * - Enhanced sprite highlighting with glow and pulse effects
 *
 * Drop this file in place of your existing main.ts
 */

// ---------- Constants ----------
const REEL_WIDTH = 160;
const SYMBOL_SIZE = 100;
const REELS_COUNT = 5;
const SYMBOLS_PER_REEL = 3;
const REEL_STRIP_LENGTH = 14; // can be tuned (10-20 typical)
const BG_IMAGE =
  "bgg1.jpg";

// ---------- ASSETS (10 symbols assumed) ----------
// Make sure these paths are available in your project / dev server
const ASSETS = [
  "/cherry.png",
  "/lemon.png",
  "/orange.png",
  "/plum.png",
  "/grape.png",
  "/watermelon.png",
  "/mango.png",
  "/strawberry.png",
  "/wild.png",
  "/scatter.png",
];

const TOTAL_SYMBOLS = 10;
const WILD_SYMBOL_ID = 8;
const SCATTER_SYMBOL_ID = 9;

// Symbol weights for weighted RNG (higher = more common)
const SYMBOL_WEIGHTS: number[] = [
  30, // 0
  28, // 1
  26, // 2
  24, // 3
  20, // 4
  18, // 5
  10, // 6 (high value)
  8, // 7 (high value)
  5, // 8 (wild - rare)
  3, // 9 (scatter - very rare)
];

let freeSpinsRemaining = 0;
let inFreeSpins = false;

// ---------- PIXI App ----------
const app = new Application();

await app.init({
  resizeTo: window,
});

document.body.appendChild(app.view);

// --------- Layer containers ---------
const backgroundLayer = new Container();
const machineLayer = new Container();
const reelsLayer = new Container();
const frameLayer = new Container();
const highlightLayer = new Container();
const uiLayer = new Container();

app.stage.addChild(backgroundLayer);
app.stage.addChild(machineLayer);
app.stage.addChild(reelsLayer);
app.stage.addChild(frameLayer);
app.stage.addChild(highlightLayer);
app.stage.addChild(uiLayer);

// ---------- Interfaces ----------
interface Reel {
  container: Container;
  sprites: Sprite[]; // visible sprite instances (SYMBOLS_PER_REEL + 1 buffer)
  strip: number[]; // indices of symbols on this reel
  position: number; // float index (top visible symbol index + fractional)
  previousPosition: number;
  blur: BlurFilter;
}

interface Tween {
  object: any;
  property: string;
  propertyBeginValue: number;
  target: number;
  easing: (t: number) => number;
  time: number;
  change?: (t: Tween) => void;
  complete?: (t: Tween) => void;
  start: number;
}

interface HighlightBox {
  graphics: Graphics;
  reelIndex: number;
  rowIndex: number;
  pulseTime: number;
}

const tweening: Tween[] = [];
const highlightBoxes: HighlightBox[] = [];

// ---------- Globals ----------
let slotTextures: Texture[] = [];
const reels: Reel[] = [];
let running = false;
let credits = 1000;
let bet = 10;
let resultText: Text;
let creditsText: Text;
let betText: Text;
let lastSpinResult: number[][] | null = null;
let reelContainer: Container;
let mask: Graphics;

// Bet limits
const MIN_BET = 1;
const MAX_BET = 100;

// Paytable example: paytableArr[symbolId][count] => payout multiplier (per bet)
// Index 0..TOTAL_SYMBOLS-1; inner array index = count (0..REELS_COUNT). Use 0..5 for counts.
const paytableArr: number[][] = [
  /* 0 */ [0, 0, 4, 14, 60, 200], // regular
  /* 1 */ [0, 0, 4, 12, 50, 180],
  /* 2 */ [0, 0, 3, 10, 40, 160],
  /* 3 */ [0, 0, 3, 8, 35, 140],
  /* 4 */ [0, 0, 2, 6, 30, 120],
  /* 5 */ [0, 0, 2, 5, 25, 100],
  /* 6 */ [0, 0, 6, 25, 90, 300], // high value
  /* 7 */ [0, 0, 8, 30, 120, 400], // high value
  /* 8 */ [0, 0, 0, 0, 0, 0], // wild (payouts usually don't exist for wild-by-itself here)
  /* 9 */ [0, 0, 0, 2, 8, 30], // scatter (we'll treat scatter separately too)
];

// Scatter paytable (count -> multiplier)
const scatterPaytable: Record<number, number> = {
  0: 0,
  1: 0,
  2: 0,
  3: 2,
  4: 10,
  5: 50,
  6: 200,
};

const FREE_SPINS_AWARDED: Record<number, number> = {
  3: 10,
  4: 15,
  5: 20,
};

// ---------- Load Assets ----------
await Assets.load([...ASSETS, BG_IMAGE, "/spinnerBtn.png"]);

// Get spinner button texture
const spinTexture = Texture.from("/spinnerBtn.png");

function onAssetsLoaded() {
  console.log("Assets loaded!");
  slotTextures = ASSETS.map((url) => Texture.from(url));
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
  const topMargin = Math.round((app.screen.height - frameHeight) / 2);
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

  const padding = 20;

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

  // Create reels (strip-based)
  for (let i = 0; i < REELS_COUNT; i++) {
    const container = new Container();
    container.x = i * REEL_WIDTH;
    reelContainer.addChild(container);

    // Create random strip (array of indices)
    const strip = new Array(REEL_STRIP_LENGTH).fill(0).map(() =>
      Math.floor(Math.random() * TOTAL_SYMBOLS)
    );

    const reel: Reel = {
      container,
      sprites: [],
      strip,
      position: 0,
      previousPosition: 0,
      blur: new BlurFilter(),
    };

    // Apply blur filter
    // container.filters = [reel.blur];

    // Create SYMBOLS_PER_REEL + 1 sprites as buffer for smooth scrolling
    for (let j = 0; j < SYMBOLS_PER_REEL + 1; j++) {
      const sprite = new Sprite(slotTextures[strip[j % strip.length]]);
      const scale = Math.min(SYMBOL_SIZE / sprite.width, SYMBOL_SIZE / sprite.height);
      sprite.scale.set(scale);
      sprite.x = Math.round((REEL_WIDTH - sprite.width) / 2);
      sprite.y = j * SYMBOL_SIZE;
      reel.sprites.push(sprite);
      container.addChild(sprite);
    }

    // initialize position randomly so visible symbols vary
    reel.position = Math.floor(Math.random() * strip.length);
    reels.push(reel);
  }

  // UI: credits and result
  const style = new TextStyle({
    fontSize: 24,
    fontWeight: "bold",
    fill: 0xffffff,
  });

  creditsText = new Text(`Credits: ${credits}`, style);
  creditsText.anchor.set(1, 0.5); // Right-align
  creditsText.x = app.screen.width / 2 - 100;
  creditsText.y = mask.y + frameHeight + 50;
  uiLayer.addChild(creditsText);

  resultText = new Text("", style);
  resultText.anchor.set(0, 0.5); // Left-align
  resultText.x = app.screen.width / 2 + 100;
  resultText.y = mask.y + frameHeight + 50;
  uiLayer.addChild(resultText);

  // Bet text (centered below spin button)
  betText = new Text(`Bet: ${bet}`, style);
  betText.anchor.set(0.5);
  betText.x = app.screen.width / 2;
  betText.y = mask.y + frameHeight + 50;
  uiLayer.addChild(betText);

  // ---------- Spin button using spinner button image ----------
  console.log("Creating spin button with texture:", spinTexture);
  
  const spinButton = new Sprite(spinTexture);

  spinButton.anchor.set(0.5);
  spinButton.x = app.screen.width / 2;
  spinButton.y = mask.y + frameHeight + 150;
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
    if (running) return;

    if (!inFreeSpins) {
      if (credits < bet) {
        resultText.text = "Not enough credits!";
        return;
      }

      credits -= bet;
      creditsText.text = `Credits: ${credits}`;
    }

    tweenTo(
      spinButton,
      "rotation",
      spinButton.rotation + Math.PI * 2,
      700,
      (t: number) => t
    );

    const result = generateResult({ weighted: true });
    spinToResult(result);
  });

  // ---------- Minus Button (decrease bet) ----------
  const minusButton = new Graphics();
  minusButton.beginFill(0xd4af37);
  minusButton.drawRoundedRect(0, 0, 60, 60, 10);
  minusButton.endFill();
  minusButton.x = spinButton.x - 130;
  minusButton.y = spinButton.y - 30;
  minusButton.eventMode = "static";
  minusButton.cursor = "pointer";

  const minusText = new Text("-", new TextStyle({
    fontSize: 48,
    fontWeight: "bold",
    fill: 0x000000,
  }));
  minusText.anchor.set(0.5);
  minusText.x = 30;
  minusText.y = 30;
  minusButton.addChild(minusText);

  minusButton.addEventListener("pointerdown", () => {
    if (running) return;
    if (bet > MIN_BET) {
      bet = Math.max(MIN_BET, bet - 1);
      betText.text = `Bet: ${bet}`;
    }
  });

  minusButton.addEventListener("pointerover", () => {
    minusButton.alpha = 0.8;
  });

  minusButton.addEventListener("pointerout", () => {
    minusButton.alpha = 1;
  });

  uiLayer.addChild(minusButton);

  // ---------- Plus Button (increase bet) ----------
  const plusButton = new Graphics();
  plusButton.beginFill(0xd4af37);
  plusButton.drawRoundedRect(0, 0, 60, 60, 10);
  plusButton.endFill();
  plusButton.x = spinButton.x + 70;
  plusButton.y = spinButton.y - 30;
  plusButton.eventMode = "static";
  plusButton.cursor = "pointer";

  const plusText = new Text("+", new TextStyle({
    fontSize: 48,
    fontWeight: "bold",
    fill: 0x000000,
  }));
  plusText.anchor.set(0.5);
  plusText.x = 30;
  plusText.y = 30;
  plusButton.addChild(plusText);

  plusButton.addEventListener("pointerdown", () => {
    if (running) return;
    if (bet < MAX_BET) {
      bet = Math.min(MAX_BET, bet + 1);
      betText.text = `Bet: ${bet}`;
    }
  });

  plusButton.addEventListener("pointerover", () => {
    plusButton.alpha = 0.8;
  });

  plusButton.addEventListener("pointerout", () => {
    plusButton.alpha = 1;
  });

  uiLayer.addChild(plusButton);

  // initial render of sprites based on their initial positions
  updateReelSprites();

  // ---------- Animation Loop ----------
  app.ticker.add((ticker) => {
    // apply tweening
    const now = Date.now();
    for (let i = tweening.length - 1; i >= 0; i--) {
      const t = tweening[i];
      const phase = Math.min(1, (now - t.start) / t.time);
      t.object[t.property] =
        t.propertyBeginValue + (t.target - t.propertyBeginValue) * t.easing(phase);
      if (phase === 1) {
        t.object[t.property] = t.target;
        if (t.complete) t.complete(t);
        tweening.splice(i, 1);
      }
    }

    // update reels visuals
    updateReelSprites();

    // update highlight boxes pulse animation
    updateHighlightBoxes(ticker.deltaTime);
  });

  console.log("Slot machine built.");
}

// ---------- Helper: update sprite textures/positions based on reel.position ----------
function updateReelSprites() {
  reels.forEach((r) => {
    // blur intensity based on velocity
    const velocity = r.position - r.previousPosition;
    r.blur.blurY = Math.abs(velocity) * 8;
    r.previousPosition = r.position;

    // fractional part for smooth pixel offset
    const len = r.strip.length;
    const topIndex = Math.floor(r.position) % len;
    const frac = r.position - Math.floor(r.position);

    // ensure positive topIndex
    const normalizedTop = ((topIndex % len) + len) % len;

    // we have SYMBOLS_PER_REEL + 1 sprites (0..SYMBOLS_PER_REEL)
    for (let sIdx = 0; sIdx < r.sprites.length; sIdx++) {
      const sprite = r.sprites[sIdx];
      // which symbol in strip should this sprite show?
      const stripIndex = (normalizedTop + sIdx) % len;
      const symbolId = r.strip[stripIndex];
      // update texture if needed
      if (sprite.texture !== slotTextures[symbolId]) {
        sprite.texture = slotTextures[symbolId];
        const scale = Math.min(SYMBOL_SIZE / sprite.texture.width, SYMBOL_SIZE / sprite.texture.height);
        sprite.scale.set(scale);
        sprite.x = Math.round((REEL_WIDTH - sprite.width) / 2);
      }
      // y position: sprite index offset minus fractional progress
      sprite.y = sIdx * SYMBOL_SIZE - frac * SYMBOL_SIZE;
    }
  });
}

// ---------- Update Highlight Boxes Animation ----------
function updateHighlightBoxes(deltaTime: number) {
  highlightBoxes.forEach((box) => {
    box.pulseTime += deltaTime * 0.05;
    
    // Pulse effect using sine wave
    const pulse = Math.sin(box.pulseTime) * 0.5 + 0.5; // 0 to 1
    const alpha = 0.6 + pulse * 0.4; // 0.6 to 1.0
    const scale = 1.0 + pulse * 0.08; // 1.0 to 1.08
    
    box.graphics.alpha = alpha;
    box.graphics.scale.set(scale);
  });
}

// ---------- Tween Utilities ----------
function tweenTo(
  object: any,
  property: string,
  target: number,
  time: number,
  easing: (t: number) => number,
  onchange?: (t: Tween) => void,
  oncomplete?: (t: Tween) => void
) {
  tweening.push({
    object,
    property,
    propertyBeginValue: object[property],
    target,
    easing,
    time,
    change: onchange,
    complete: oncomplete,
    start: Date.now(),
  });
}

// ---------- Easing ----------
function backout(amount: number) {
  return (t: number) => --t * t * ((amount + 1) * t + amount) + 1;
}

// ---------- Weighted Random Helper ----------
function getWeightedRandomSymbol(): number {
  const totalWeight = SYMBOL_WEIGHTS.reduce((a, b) => a + b, 0);
  const rand = Math.random() * totalWeight;

  let cumulative = 0;
  for (let i = 0; i < SYMBOL_WEIGHTS.length; i++) {
    cumulative += SYMBOL_WEIGHTS[i];
    if (rand <= cumulative) return i;
  }

  return SYMBOL_WEIGHTS.length - 1; // fallback
}

// ---------- GenerateResult with options ----------
interface GenerateOptions {
  forceMatrix?: number[][]; // fully forced result per reel (array length REELS_COUNT, each inner length SYMBOLS_PER_REEL)
  forceSymbols?: Partial<Record<number, Partial<Record<number, number>>>>;
  // format: { reelIndex: { rowIndex: symbolId } }
  weighted?: boolean;
}

function generateResult(options?: GenerateOptions): number[][] {
  // 1️⃣ FULL MATRIX FORCED (for testing / server result)
  if (options?.forceMatrix) {
    console.log("Forced FULL matrix:", options.forceMatrix);
    lastSpinResult = options.forceMatrix;
    return options.forceMatrix;
  }

  const matrixPerReel: number[][] = [];

  for (let reelIndex = 0; reelIndex < REELS_COUNT; reelIndex++) {
    const column: number[] = [];

    for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
      let symbolId: number;

      // 2️⃣ FORCE SPECIFIC POSITION
      if (
        options?.forceSymbols &&
        options.forceSymbols[reelIndex] &&
        options.forceSymbols[reelIndex]![row] !== undefined
      ) {
        symbolId = options.forceSymbols[reelIndex]![row]!;
      } else {
        // 3️⃣ Weighted or uniform random
        if (options?.weighted) {
          symbolId = getWeightedRandomSymbol();
        } else {
          symbolId = Math.floor(Math.random() * TOTAL_SYMBOLS);
        }
      }

      column.push(symbolId);
    }

    matrixPerReel.push(column);
  }

  lastSpinResult = matrixPerReel;
  console.log("Generated Result:", matrixPerReel);
  return matrixPerReel;
}

// ---------- Spin toward a result ----------
function spinToResult(resultPerReel: number[][]) {
  // resultPerReel: outer array length = REELS_COUNT, each inner array length = SYMBOLS_PER_REEL
  if (running) return;
  running = true;

  // Clear previous highlights
  clearHighlights();

  // Validate format
  if (!Array.isArray(resultPerReel) || resultPerReel.length !== REELS_COUNT) {
    console.error("Invalid result matrix passed to spinToResult");
    running = false;
    return;
  }

  let completed = 0;
  for (let i = 0; i < REELS_COUNT; i++) {
    const r = reels[i];
    const targetTopIndex = findOrInjectSequenceInStrip(r, resultPerReel[i]);
    const len = r.strip.length;

    // compute current top index normalized
    const base = Math.floor(r.position);
    const baseMod = ((base % len) + len) % len;

    // compute delta to land on targetTopIndex (0..len-1)
    const delta = ((targetTopIndex - baseMod) + len) % len;

    // choose number of full spins (more for earlier reels)
    const minSpins = 3;
    const spins = minSpins + i; // stagger spins (each later reel spins slightly longer)
    const target = r.position + spins * len + delta;

    const time = 1100 + i * 360 + Math.floor(Math.random() * 300); // ms per reel

    tweenTo(
      r,
      "position",
      target,
      time,
      backout(0.6),
      undefined,
      () => {
        completed++;
        // if last reel done => evaluate
        if (completed === REELS_COUNT) {
          running = false;
          // snap positions to integers
          reels.forEach((rr) => (rr.position = Math.floor(rr.position)));
          // update visuals final
          updateReelSprites();
          // Evaluate wins now
          const visible = getVisibleMatrix();
          evaluateAndShowResults(visible);
        }
      }
    );
  }
}

// Attempt to find a contiguous sequence in the reel's strip that matches the desired visible column
// If not found, inject the sequence at a random position (mutates the strip) and return that top index.
function findOrInjectSequenceInStrip(reel: Reel, desiredColumn: number[]): number {
  const len = reel.strip.length;

  // normalize inputs
  if (!Array.isArray(desiredColumn) || desiredColumn.length !== SYMBOLS_PER_REEL) {
    // fallback: choose random top index
    return Math.floor(Math.random() * len);
  }

  // search
  for (let i = 0; i < len; i++) {
    let ok = true;
    for (let r = 0; r < SYMBOLS_PER_REEL; r++) {
      if (reel.strip[(i + r) % len] !== desiredColumn[r]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }

  // not found — inject sequence at a random position p
  const injectPos = Math.floor(Math.random() * len);
  for (let r = 0; r < SYMBOLS_PER_REEL; r++) {
    reel.strip[(injectPos + r) % len] = desiredColumn[r];
  }

  return injectPos;
}

// ---------- Visible matrix (row-major) ----------
// returns matrix[row][reelIndex] ; rows: 0..SYMBOLS_PER_REEL-1 ; outer length = SYMBOLS_PER_REEL
function getVisibleMatrix(): number[][] {
  const matrix: number[][] = Array.from({ length: SYMBOLS_PER_REEL }, () => []);

  reels.forEach((r, reelIndex) => {
    const len = r.strip.length;
    const topIndex = Math.floor(r.position) % len;
    const normalizedTop = ((topIndex % len) + len) % len;
    for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
      matrix[row][reelIndex] = r.strip[(normalizedTop + row) % len];
    }
  });

  return matrix;
}

// ---------- Evaluate Ways (combinatorial, count per reel in visible rows) ----------
interface WaysResult {
  symbol: number;
  hits: number; // number of reels used (3..REELS_COUNT)
  combos: number; // number of ways combinations
  payout: number;
}
function evaluateWays(matrix: number[][], betAmount: number): WaysResult[] {
  const results: WaysResult[] = [];
  const symbolCount = slotTextures.length;

  for (let symbol = 0; symbol < symbolCount; symbol++) {
    // counts per reel
    const countsPerReel: number[] = [];
    for (let r = 0; r < REELS_COUNT; r++) {
      let count = 0;
      for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
        // wilds count as matching for ways
        if (matrix[row][r] === symbol || matrix[row][r] === WILD_SYMBOL_ID) count++;
      }
      countsPerReel.push(count);
    }

    // combos for 3..REELS_COUNT (multiply counts across first N reels)
    for (let n = 3; n <= REELS_COUNT; n++) {
      // product of countsPerReel[0..n-1]
      let product = 1;
      for (let idx = 0; idx < n; idx++) {
        product *= countsPerReel[idx];
      }
      if (product > 0) {
        // payout multiplier lookup (using n as count)
        const payoutMultiplier = (paytableArr[symbol] && paytableArr[symbol][n]) || 0;
        const payout = product * payoutMultiplier * betAmount;
        if (payout > 0) {
          results.push({
            symbol,
            hits: n,
            combos: product,
            payout,
          });
        }
      }
    }
  }

  return results;
}

// ---------- Evaluate Scatters ----------
interface ScatterResult {
  symbol: number;
  count: number;
  payout: number;
}
function evaluateScatters(matrix: number[][], betAmount: number): ScatterResult | null {
  const scatterId = SCATTER_SYMBOL_ID;
  let count = 0;
  for (let r = 0; r < REELS_COUNT; r++) {
    for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
      if (matrix[row][r] === scatterId) count++;
    }
  }
  const multiplier = scatterPaytable[count] || 0;
  const payout = multiplier * betAmount;
  if (payout > 0) {
    return { symbol: scatterId, count, payout };
  }
  return null;
}

// ---------- Clear Highlights ----------
function clearHighlights() {
  // Remove all highlight boxes
  highlightBoxes.forEach((box) => {
    highlightLayer.removeChild(box.graphics);
    box.graphics.destroy();
  });
  highlightBoxes.length = 0;
}

// ---------- Evaluate & Show Results ----------
function evaluateAndShowResults(matrix: number[][]) {
  console.log("Visible matrix (row-major):", matrix);

  const waysResults = evaluateWays(matrix, bet);
  const scatterResult = evaluateScatters(matrix, bet);

  let totalPayout = 0;

  // Clear previous highlights
  clearHighlights();

  // ----- WAYS -----
  waysResults.forEach((res) => {
    totalPayout += res.payout;

    for (let r = 0; r < res.hits; r++) {
      for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
        if (
          matrix[row][r] === res.symbol ||
          matrix[row][r] === WILD_SYMBOL_ID
        ) {
          highlightSpriteAt(r, row, 0xffd700); // Gold color for regular wins
        }
      }
    }
  });

  // ----- SCATTER -----
  if (scatterResult) {
    totalPayout += scatterResult.payout;

    for (let r = 0; r < REELS_COUNT; r++) {
      for (let row = 0; row < SYMBOLS_PER_REEL; row++) {
        if (matrix[row][r] === SCATTER_SYMBOL_ID) {
          highlightSpriteAt(r, row, 0xff00ff); // Magenta for scatters
        }
      }
    }

    // 🎁 FREE SPINS TRIGGER
    const spinsWon = FREE_SPINS_AWARDED[scatterResult.count] || 0;
    if (spinsWon > 0) {
      freeSpinsRemaining += spinsWon;
      inFreeSpins = true;
      resultText.text = `BONUS! ${spinsWon} Free Spins!`;
    }
  }

  // ----- CREDIT UPDATE -----
  if (totalPayout > 0) {
    credits += totalPayout;
  }

  if (!inFreeSpins) {
    resultText.text =
      totalPayout > 0
        ? `WIN: ${totalPayout} credits!`
        : "No win. Try again!";
  }

  creditsText.text = `Credits: ${credits}`;

  console.log("Ways results:", waysResults);
  console.log("Scatter result:", scatterResult);

  // ----- HANDLE FREE SPINS -----
  if (inFreeSpins) {
    if (freeSpinsRemaining > 0) {
      freeSpinsRemaining--;

      setTimeout(() => {
        const result = generateResult({ weighted: true });
        spinToResult(result);
      }, 1500); // Increased delay to see winning animations
    } else {
      inFreeSpins = false;
      resultText.text = "Bonus finished!";
    }
  }
}

// ---------- Highlight sprite at position ----------
function highlightSpriteAt(reelIndex: number, rowIndex: number, color: number = 0xffd700) {
  // Create a glowing border box around the winning symbol
  const box = new Graphics();
  
  // Outer glow layer (thicker, more transparent)
  box.lineStyle(6, color, 0.6);
  box.drawRoundedRect(
    reelIndex * REEL_WIDTH + 3,
    rowIndex * SYMBOL_SIZE + 3,
    REEL_WIDTH - 6,
    SYMBOL_SIZE - 6,
    10
  );
  
  // Middle layer
  box.lineStyle(4, color, 0.8);
  box.drawRoundedRect(
    reelIndex * REEL_WIDTH + 5,
    rowIndex * SYMBOL_SIZE + 5,
    REEL_WIDTH - 10,
    SYMBOL_SIZE - 10,
    8
  );
  
  // Inner bright border with subtle fill
  box.lineStyle(2, 0xffffff, 1);
  box.beginFill(color, 0.1);
  box.drawRoundedRect(
    reelIndex * REEL_WIDTH + 8,
    rowIndex * SYMBOL_SIZE + 8,
    REEL_WIDTH - 16,
    SYMBOL_SIZE - 16,
    6
  );
  box.endFill();
  
  // Set pivot for scaling animation
  box.pivot.set(
    reelIndex * REEL_WIDTH + REEL_WIDTH / 2,
    rowIndex * SYMBOL_SIZE + SYMBOL_SIZE / 2
  );
  box.position.set(
    reelIndex * REEL_WIDTH + REEL_WIDTH / 2,
    rowIndex * SYMBOL_SIZE + SYMBOL_SIZE / 2
  );
  
  highlightLayer.addChild(box);
  
  // Add to tracking array for animation
  highlightBoxes.push({
    graphics: box,
    reelIndex,
    rowIndex,
    pulseTime: Math.random() * Math.PI * 2, // Random start phase for variety
  });
}

// ---------- Debug utilities (optional) ----------
// Force a specific test spin from console:
// spinToResult(generateResult({ forceMatrix: [ [0,0,0], [1,1,1], ... ] }));
// Or force some positions:
// spinToResult(generateResult({ forceSymbols: { 0: {1: 8}, 2: {0:9} }, weighted: true }));

// End of file