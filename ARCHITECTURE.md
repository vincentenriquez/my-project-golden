## Slot Machine Architecture Overview

### 1. Current High-Level Structure

- **Runtime & Rendering**
  - **Pixi.js** drives all rendering, input and the main ticker.
  - The entrypoint `src/main.ts` bootstraps the Pixi `Application`, loads assets, builds the full scene graph (layers, reels, UI controls), and wires the ticker loop.

- **Core Game Orchestration**
  - **`GameController` (`src/GameController.ts`)** is the central “god object” that currently owns:
    - Game state: credits, bet, free spins, auto spins, per-spin total payout, and several flags (`running`, `winLock`, etc.).
    - Spin flow: generating random symbol matrices, sending reels to target positions, and triggering result evaluation when reels stop.
    - Evaluation: 243-ways and scatter evaluation, free-spin triggering, total payout calculation, and credit updates.
    - Visual orchestration: highlighting winning symbols, dimming non-winning ones, spawning floating clones, cascade animations, and win text/count-up animations.

- **Reel & Symbol Rendering**
  - **`Reel` (`src/Reel.ts`)**
    - Encapsulates a single reel strip (`strip` array of symbol IDs), its visible `SymbolCell`s, and associated Pixi `Container`.
    - Owns the per-frame visual update logic (`updateSprites`) that moves symbols based on reel `position`, applies blur based on velocity, and swaps between static textures and animated sprites (wild/scatter).
    - Exposes helpers used by `GameController`: `getVisibleSymbols`, `getContainerAt`, `getSpriteAt`, and the “suspension” API (`suspendCell`, `restoreCell`, `clearAllSuspensions`) used during win/cascade animations.
  - **`SymbolCell` (`src/SymbolCell.ts`)**
    - Represents a single visible symbol slot as a Pixi `Container`.
    - Manages highlight visuals (glow, rays, inner bloom, rim circle) and animated/static symbol display.

- **Symbol Configuration & Assets**
  - **`symbols` (`src/symbols.ts`)**
    - Defines symbol IDs, total symbol count, and special IDs for wild and scatter.
    - Holds the paytable (`PAYTABLE`), scatter paytable (`SCATTER_PAYTABLE`), and free-spins award table (`FREE_SPINS_AWARDED`).
    - Provides weighted RNG helpers (`getWeightedRandomSymbol`, `getWeightedRandomSymbol_noWild`) for symbol selection.
    - Bridges to animation assets via `getAnimationFrames(symbolId)`, which uses `WildSpriteSheet` and `ScatterSpriteSheet` to return animation `Texture[]` for wild and scatter symbols.

- **UI & UX Elements**
  - **`main.ts` UI construction**
    - Creates visual layers: background, machine, reels, frame, highlight, win-float, UI, and overlay.
    - Builds all controls: spin button, auto-spin buttons, bet +/- buttons, quick bet buttons, and numeric displays for balance, total win, and bet amount.
    - Manages the slot info/status panel via `SlotInfoContainer`.
  - **`SlotInfoContainer` (`src/SlotInfoContainer.ts`)**
    - Owns a Pixi `Container` and `Text` element used to show default hints, auto-spin status, and free-spin status.
    - Uses GSAP typing/looping to animate hint messages.
  - **Numeric counters**
    - `WinCountUp` (`src/WinCountUp.ts`) animates a win value from 0 up to a target with easing.
    - `RangeCountUp` (`src/RangeCountUp.ts`) animates arbitrary numeric ranges (used for BET and TOTAL WIN displays).

- **Sprite Sheets & Animations**
  - **`WildSpriteSheet` and `ScatterSpriteSheet`**
    - Wrap Pixi textures and slice sprite sheets into per-frame `Texture`s.
    - Expose helpers to create animated sprites for wild and scatter symbols.

### 2. Data & Control Flow (Current)

1. **Spin initiation**
   - User clicks the spin button (or auto-spin triggers) in `main.ts`.
   - `main.ts` checks `gameController.canSpin()` and (for paid spins) `gameController.hasEnoughCredits()`.
   - If allowed, `main.ts` calls `gameController.deductBet()`, then generates a result via `gameController.generateResult({ weighted: true })`, and finally `gameController.spinToResult(result)`.

2. **Reel motion**
   - `spinToResult` computes target reel positions so that each `Reel` lands on the requested column of symbol IDs.
   - A tween is started per reel using the custom `tweenTo` helper from `main.ts`; when each reel stops, `_playSettleBounceOnReel` runs a small squash animation on the bottom symbol.
   - When all reels have finished, `GameController`:
     - Snaps reel positions to integer boundaries.
     - Calls `updateReelsVisuals()` to redraw sprites.
     - Builds a visible symbol matrix via `getVisibleMatrix()` and passes it into `evaluateAndShowResults`.

3. **Evaluation & Game State Updates**
   - `evaluateAndShowResults` (inside `GameController`) orchestrates the full result pipeline:
     - Runs `evaluateScatters` on the original matrix to compute scatter payout and free spins.
     - Runs `applyExpandingWilds` (currently a no-op) and then `evaluateWays` on the expanded matrix using paytables and 243-ways rules.
     - Sums all payouts, marks winning symbol positions with `_markCellAt`, and sets `dimOverlay` visibility based on winning cells.
     - Updates game state:
       - Adds the total payout to `credits` via `addCredits`.
       - Tracks per-spin total payout across cascades (`currentSpinTotalPayout`).
       - Updates free-spin counters and auto-spin state.
   - Numeric displays are animated via:
     - `WinCountUp` for the central win text.
     - `RangeCountUp` for TOTAL WIN and BET.
     - An additional `WinCountUp` instance (`balanceCounter`) that rolls the balance from pre-win to post-win credits.

4. **Win Presentation & Cascades**
   - Winning symbol cells are:
     - Highlighted with glow/rays via `SymbolCell.showGlow` and `attachRaysToExternalLayer` (using the shared `highlightLayer`).
     - Non-winning cells are dimmed by lowering `alpha`.
   - `updateHighlightAnimation` (called every frame from `main.ts`) advances:
     - Glow phases (pulsing → fading), including timed fade-out and cleanup.
     - Floating win-symbols and their slice animations in the `winFloatLayer`.
     - All numeric counters (win, balance, total win, bet).
   - After glow completes, `_spawnFloatingWinSymbols`:
     - Suspends affected `SymbolCell`s on their reels and hides them.
     - Creates floating clones for each winning cell in `winFloatLayer`.
     - Animates clones upward and, at the apex, slices them into pieces with `_sliceCloneIntoQuadrants`.
   - Once all slice animations are done, `_cascadeSymbols`:
     - Computes which symbol positions are “empty” (where winners were).
     - Drops surviving symbols to fill gaps and generates new symbols at the top via `getWeightedRandomSymbol`.
     - Rewrites the underlying reel strips and animates the visual fall with tweened `y` positions and bounce easings.
     - Calls `evaluateAndShowResults` again on the new visible matrix to detect further wins.

5. **Spin Continuation (Free Spins & Auto Spins)**
   - `_resolveSpinContinuation` decides how the spin sequence continues after wins/cascades:
     - If in a free-spin series, it decrements `freeSpinsRemaining`, updates the info panel, and automatically triggers another weighted spin until free spins are exhausted.
     - If in auto-spin, it decrements `autoSpinsRemaining`, updates the status, and calls `onAutoSpinContinue` (wired from `main.ts`) to trigger the next spin.
     - When no more bonus/auto spins remain and the win display has finished, it releases `winLock` so the player can spin again.

### 3. Main Domain Concepts (As of Today)

- **Symbol & Paytable Domain**
  - `SymbolId` (number) with special IDs for `WILD_SYMBOL_ID` and `SCATTER_SYMBOL_ID`.
  - `PAYTABLE` and `SCATTER_PAYTABLE` define payouts per symbol and per scatter count.
  - `FREE_SPINS_AWARDED` maps scatter counts to free-spin awards.
  - `TOTAL_WAYS = 243` encodes a 3×5, all-ways configuration.

- **Spin & Evaluation Domain**
  - A **spin result** is currently represented as a matrix of symbol IDs:
    - `number[rows][reels]` for visible symbols (built via `getVisibleMatrix`).
    - `number[reels][rows]` for generated target strips (`generateResult`).
  - `WaysResult` and `ScatterResult` interfaces model individual 243-ways and scatter wins.
  - Evaluation logic is implemented in private `GameController` methods:
    - `evaluateWays(matrix, bet)` computes ways wins using paytables.
    - `evaluateScatters(matrix, bet)` computes scatter payouts and free-spin triggers.
    - `applyExpandingWilds(matrix)` is a placeholder for future wild behavior.

- **Game Session Domain**
  - Game session state (credits, current bet, free spins, auto-spin counters) is stored directly in `GameController` fields.
  - Spin eligibility and sequencing logic is implemented via:
    - `canSpin`, `canStartAutoSpin`, `hasEnoughCredits`, `deductBet`, `addCredits`.
    - `startAutoSpin`, `runNextAutoSpin`, `cancelAutoSpin`, `endAutoSpin`.
    - `_resolveSpinContinuation` and `_tryReleaseWinLock`.

- **Presentation & Animation Domain**
  - Visual representation of the board and wins is mixed into `GameController`:
    - Highlight registration and glow (`_markCellAt`, `clearHighlights`, `updateHighlightAnimation`).
    - Floating clones and slice effects (`_spawnFloatingWinSymbols`, `_sliceCloneIntoQuadrants`, `_updateFloatingSymbols`, `_clearFloatingSymbols`).
    - Cascade animations (`_cascadeSymbols`, `_finishCascade`).
  - `main.ts` acts as both composition root and detailed UI layout script, creating and positioning all Pixi objects and passing raw `Text`, `Sprite`, `Graphics`, and `Container` instances into `GameController`.

### 4. Implemented Architecture (DDD + SOLID)

The codebase now follows a **Domain-Driven Design** and **SOLID** structure with clear layer boundaries and dependency inversion.

#### 4.1 Domain layer (`src/domain/`)

- **Pure TypeScript, no PIXI or UI dependencies.** Defines the core game rules and types.
- **`symbolConfig.ts`** — Symbol IDs, paytables, weights, and free-spin tables. Exposes `getWeightedRandomSymbol` and `getWeightedRandomSymbol_noWild` for default RNG.
- **`SpinEngine.ts`** — Spin evaluation: `evaluateSpin(config, matrix, bet)` returns `SpinOutcome` (ways wins, scatter win, total payout, winning positions). Types: `SpinConfig`, `SpinOutcome`, `WaysWin`, `ScatterWin`, `WinningPosition`.
- **`GameSession.ts`** — Session aggregate: credits, bet, free spins, auto-spin state. Methods: `getCredits`, `setBet`, `deductBetForSpin`, `addCredits`, `awardFreeSpins`, `consumeFreeSpin`, `startAutoSpin`, `consumeAutoSpin`, etc.
- **`ports.ts`** — Domain ports (interfaces the domain needs):
  - **`ISymbolPicker`** — `pick(): SymbolId` and `pickExcluding(symbolId): SymbolId`. Used for spin and cascade symbol selection; allows swapping RNG for tests or alternate logic.
- **`DefaultSymbolPicker.ts`** — Implements `ISymbolPicker` using `symbolConfig` weighted RNG.
- **`SpinResultGenerator.ts`** — Domain service: `generateSpinResult(config, picker, options)` builds the per-reel symbol matrix. Encapsulates wild-allowed reels and delegates symbol choice to `ISymbolPicker` (Dependency Inversion). Config: `SpinResultGeneratorConfig`; options: `GenerateSpinResultOptions` (weighted, forceMatrix, forceSymbols).

#### 4.2 Application layer (`src/app/`)

- **Orchestrates use cases** and depends on **abstractions** (ports), not concrete domain or UI types.
- **`ports.ts`** — Application ports:
  - **`IGameSession`** — Session/wallet contract (credits, bet, free spins, auto-spin).
  - **`ISpinEvaluator`** — `evaluate(config, matrix, betAmount): SpinOutcome`.
  - **`ISpinResultGenerator`** — `generate(options?): number[][]` (spin result matrix).
- **`GameController.ts`** — Application service. Depends on:
  - `IGameSession`, `ISpinEvaluator`, `ISpinResultGenerator` (injected).
  - `GameControllerUI` (view interfaces from `GameViews.ts`).
  - `WinAnimationController` (created with injected `symbolPicker: () => number` for cascade).
  - Delegates: `generateResult(options)` → `spinResultGenerator.generate(options)`; evaluation → `spinEvaluator.evaluate(...)`.
- **`SpinEvaluatorAdapter.ts`** — Implements `ISpinEvaluator` by calling `evaluateSpin` from the domain.
- **`SpinResultGeneratorAdapter.ts`** — Implements `ISpinResultGenerator` by holding `SpinResultGeneratorConfig` and `ISymbolPicker`, and calling `generateSpinResult` from the domain.

#### 4.3 UI / Infrastructure layer (`src/ui/pixi/`)

- **PIXI-based views and animation.** Depends on app and domain only via interfaces or narrow APIs.
- **`main.ts`** — **Composition root**: builds the PIXI app, creates domain and app adapters, and wires them into `GameController`:
  - `GameSession` (concrete) → `IGameSession`.
  - `DefaultSymbolPicker` → `ISymbolPicker`; same instance used for `SpinResultGeneratorAdapter` and for `symbolPicker` callback passed to `WinAnimationController`.
  - `SpinEvaluatorAdapter` → `ISpinEvaluator`.
  - `SpinResultGeneratorAdapter(config, symbolPicker)` → `ISpinResultGenerator`.
- **`GameViews.ts`** — View interfaces (`TextView`, `SlotInfoView`, `DimOverlayView`, `AutoSpinButtonsView`, `GameControllerUI`) and PIXI adapters (`PixiTextView`, etc.).
- **`WinAnimationController.ts`** — Win highlights, floating symbols, and cascade. Receives `symbolPicker: () => number` from the composition root (same strategy as spin/cascade) and no longer imports RNG from `symbols`.
- **`Reel.ts`**, **`SymbolCell.ts`**, **`SlotInfoContainer.ts`** — PIXI reel/symbol and UI components.

#### 4.4 Dependency rules

- **Domain** → no dependencies on app or UI; only domain types and `symbolConfig`.
- **App** → depends on domain types and **app/domain ports** (interfaces); never on PIXI or `main`.
- **UI** → depends on app (e.g. `GameController`), domain types where needed, and PIXI; **composition root** in `main.ts` instantiates domain and app adapters and injects them into `GameController`.

#### 4.5 SOLID alignment

- **S (Single Responsibility)** — Spin evaluation (`SpinEngine`), session state (`GameSession`), result generation (`SpinResultGenerator`), win/cascade animation (`WinAnimationController`), orchestration (`GameController`).
- **O (Open/Closed)** — New symbol pickers or evaluators can be added by implementing domain/app ports without changing existing code.
- **L (Liskov)** — Any `IGameSession`/`ISpinEvaluator`/`ISpinResultGenerator` implementation is substitutable where the interface is used.
- **I (Interface Segregation)** — Small, focused ports: `ISymbolPicker`, `IGameSession`, `ISpinEvaluator`, `ISpinResultGenerator`, and view interfaces in `GameViews`.
- **D (Dependency Inversion)** — `GameController` and domain result generator depend on `ISymbolPicker`, `IGameSession`, `ISpinEvaluator`, `ISpinResultGenerator`; the composition root supplies concrete implementations.

