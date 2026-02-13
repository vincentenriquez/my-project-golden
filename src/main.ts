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

// ---------- Constants ----------
const REEL_WIDTH = 160;
const SYMBOL_SIZE = 100;
const REELS_COUNT = 5;
const SYMBOLS_PER_REEL = 3;
const BG_IMAGE = "https://png.pngtree.com/thumb_back/fh260/background/20220313/pngtree-high-altitude-plain-of-qinghai-province-image_998799.jpg";

const ASSETS = [
  "/cherry.png",
  "/lemon.png",
  "/orange.png",
  "/plum.png",
  "/grape.png",
  "/watermelon.png",
];

// ---------- PIXI App ----------
const app = new Application();

await app.init({
  backgroundColor: 0x1099bb,
  resizeTo: window,
});

document.body.appendChild(app.canvas);

// ---------- Interfaces ----------
interface Reel {
  container: Container;
  symbols: Sprite[];
  position: number;
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

const tweening: Tween[] = [];

// ---------- Load Assets ----------
Assets.load([...ASSETS, BG_IMAGE]).then(onAssetsLoaded);

function onAssetsLoaded() {
  console.log("Assets loaded!");
  buildSlotMachine();
}

// ---------- Build Slot Machine ----------
function buildSlotMachine() {
  // Textures
  const slotTextures: Texture[] = ASSETS.map((url) => Texture.from(url));

  // Reels
  const reels: Reel[] = [];
  const reelContainer = new Container();
  app.stage.addChild(reelContainer);
  
  const mask = new Graphics();
  mask.beginFill(0xffffff);
  mask.drawRoundedRect(0, 0, framewidth, frameHeight, 20);
  mask.endFill();
  reelContainer.mask = mask;
  app.stage.addChild(mask);

  for (let i = 0; i < REELS_COUNT; i++) {
    const container = new Container();
    container.x = i * REEL_WIDTH;
    reelContainer.addChild(container);

    const reel: Reel = {
      container,
      symbols: [],
      position: 0,
      previousPosition: 0,
      blur: new BlurFilter(),
    };

    for (let j = 0; j < SYMBOLS_PER_REEL; j++) {
      const symbol = new Sprite(
        slotTextures[Math.floor(Math.random() * slotTextures.length)]
      );
      const scale = Math.min(SYMBOL_SIZE / symbol.width, SYMBOL_SIZE / symbol.height);
      symbol.scale.set(scale);
      symbol.y = j * SYMBOL_SIZE;
      symbol.x = Math.round((SYMBOL_SIZE - symbol.width) / 2);
      reel.symbols.push(symbol);
      container.addChild(symbol);
    }
    reels.push(reel);
  }

  const bg = new Sprite(Texture.from(BG_IMAGE));
  bg.width = app.screen.width;
  bg.height = app.screen.height;
  app.stage.addChild(bg);
  app.stage.setChildIndex(bg, 0); // Ensure background is at the bottom

  // Position reels
  const margin = (app.screen.height - SYMBOL_SIZE * 3) / 2;
  reelContainer.y = margin;
  reelContainer.x = Math.round((app.screen.width - REEL_WIDTH * REELS_COUNT) / 2);

  // Top cover
  // const top = new Graphics();
  // top.beginFill(0x000000);
  // top.drawRect(0, 0, app.screen.width, margin);
  // top.endFill();
  
  // Container for top cover + header
  // const topContainer = new Container();
  // topContainer.addChild(top);
  // app.stage.addChild(topContainer);

  const bottomContainer = new Container();
  bottomContainer.y = SYMBOL_SIZE * 3 + margin; // move container to bottom
  app.stage.addChild(bottomContainer);

  // Bottom cover
  // const bottom = new Graphics();
  // bottom.beginFill(0x000000);
  // bottom.drawRect(0, 0, app.screen.width, margin); // start at 0,0 inside container
  // bottom.endFill();
  // bottomContainer.addChild(bottom);

  // Text styles
  const style = new TextStyle({
    fontSize: 30,
    // fill: [0x000000, 0xffffff],
    fontWeight: "bold",
  });

  // Play text
  // const playText = new Text("Spin the wheels!", style);
  // playText.x = Math.round((bottom.width - playText.width) / 2);
  // playText.y = app.screen.height - margin + Math.round((margin - playText.height) / 2);
  // bottom.addChild(playText);   

  // bottomContainer.addChild(playText);

  // Header text
  // const headerText = new Text("PIXI MONSTER SLOTS!", style);
  // headerText.x = Math.round((top.width - headerText.width) / 2);
  // headerText.y = Math.round((margin - headerText.height) / 2);
  // top.addChild(headerText);

  const buttonWidth = 100;
  const buttonHeight = 100;
  const buttonX = (app.screen.width - buttonWidth) / 2;
  const buttonY = margin + SYMBOL_SIZE * 3 + 20;

  const spinButton = new Graphics();
  spinButton.x = buttonX;
  spinButton.y = buttonY;

  const btnBg =  new Graphics();
  btnBg.beginFill(0x0b8457);
  btnBg.drawRoundedRect(0, 0, buttonWidth, buttonHeight, 10);
  btnBg.endFill();
  spinButton.addChild(btnBg);

  const btnText = new Text("SPIN", style);
  btnText.x = Math.round((buttonWidth - btnText.width) / 2);
  btnText.y = (buttonHeight - btnText.height) / 2;
  spinButton.addChild(btnText);

  app.stage.addChild(spinButton);

  btnText.eventMode = "static";
  btnText.cursor = "pointer";
  btnText.addEventListener("pointerdown", () => {
    startPlay();
  });

  console.log("Button created:", btnText);
  console.log("Screen height:", app.screen.height);
  console.log("Button Y:", spinButton.y);


  // Interactivity
  // playText.eventMode = "static";
  // playText.cursor = "pointer";
  let running = false;

  // playText.addEventListener("pointerdown", () => {
  //   startPlay();
  // });

  // ---------- Spin Function ----------
  function startPlay() {
    if (running) return;
    running = true;

    reels.forEach((r, i) => {
      const extra = Math.floor(Math.random() * 3);
      const target = r.position + 10 + i * 5 + extra;
      const time = 2500 + i * 600 + extra * 600;

      tweenTo(
        r,
        "position",
        target,
        time,
        backout(0.5),
        undefined,
        i === reels.length - 1 ? () => (running = false) : undefined
      );
    });
  }

  // ---------- Animation Loop ----------
  app.ticker.add(() => {
    reels.forEach((r) => {
      r.blur.blurY = (r.position - r.previousPosition) * 10;
      r.previousPosition = r.position;

      r.symbols.forEach((s, j) => {
        const prevY = s.y;
        s.y =
          ((r.position + j) % SYMBOLS_PER_REEL + SYMBOLS_PER_REEL) %
            SYMBOLS_PER_REEL *
            SYMBOL_SIZE -
          SYMBOL_SIZE;

        if (s.y < 0 && prevY > SYMBOL_SIZE) {
          s.texture = slotTextures[Math.floor(Math.random() * slotTextures.length)];
          const scale = Math.min(SYMBOL_SIZE / s.texture.width, SYMBOL_SIZE / s.texture.height);
          s.scale.set(scale);
          s.x = Math.round((SYMBOL_SIZE - s.width) / 2);
        }
      });
    });
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

app.ticker.add(() => {
  const now = Date.now();
  for (let i = tweening.length - 1; i >= 0; i--) {
    const t = tweening[i];
    const phase = Math.min(1, (now - t.start) / t.time);
    t.object[t.property] = t.propertyBeginValue + (t.target - t.propertyBeginValue) * t.easing(phase);
    if (phase === 1) {
      t.object[t.property] = t.target;
      if (t.complete) t.complete(t);
      tweening.splice(i, 1);
    }
  }
});

// ---------- Lerp & Backout ----------
function backout(amount: number) {
  return (t: number) => --t * t * ((amount + 1) * t + amount) + 1;
}
