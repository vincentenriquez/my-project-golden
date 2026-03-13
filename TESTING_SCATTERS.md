# Testing Scatter Symbols

This guide explains how to test scatter symbols and their free-spin behavior in the slot machine.

## Quick Start: Force Scatter Mode (Recommended for Testing)

To make every spin contain 3–6 scatters for deterministic testing:

1. Open `src/domain/symbolConfig.ts`
2. Set `FORCE_SCATTER_DEBUG = true`
3. Run the game and click SPIN (or use Auto Spin)
4. Every spin will now trigger scatter behavior and free spins
5. When done testing, set `FORCE_SCATTER_DEBUG = false` again

## Manual Test Workflow (No Debug Mode)

If you prefer to test with normal random weights:

1. Start the game (run your dev server and open the PIXI game in the browser)
2. Click the SPIN button repeatedly, or use the Auto Spin button for 10 spins
3. Watch for scatter symbols (scatter sprite) on the reels
4. When 3 or more scatters appear anywhere, free spins should be awarded
5. The slot-info area will show "FREE SPINS AWARDED" and the remaining count
6. Free spins run automatically until the count reaches zero

## Test Scenarios

### Base Game: 3 Scatters

- **Expected:** 10 free spins awarded
- **Verify:** Slot-info shows bonus message, game enters free-spin mode, remaining counter shows 10

### Base Game: 4 Scatters

- **Expected:** 15 free spins awarded
- **Verify:** UI message shows correct count (15)

### Base Game: 5 or 6 Scatters

- **Expected:** 20 or 25 free spins respectively
- **Verify:** Remaining counter matches the awarded amount

### Free Spins: Retrigger Behavior

While in free spins:

- **1 scatter:** +1 free spin
- **2 scatters:** +2 free spins
- **3+ scatters:** +N free spins (N = scatter count)

### Mixed Outcome (Wins + Scatters)

When a spin has both line wins and scatters:

- Win animations and payouts occur first
- After win flow completes, free spins are awarded and begin
- Scatter positions are highlighted in the win sequence

## Step-by-Step Checklist

1. Run the dev build and open the game in the browser
2. (Optional) Set `FORCE_SCATTER_DEBUG = true` in `src/domain/symbolConfig.ts`
3. Click SPIN or use Auto Spin repeatedly
4. Observe scatter symbols and free-spin entry
5. When free spins start, confirm the counter decrements each spin
6. Confirm that new scatters add additional free spins (retrigger)
7. After free spins finish, confirm the game returns to normal paid spins
8. Turn off `FORCE_SCATTER_DEBUG` when done testing

## Configuration Reference

- **Scatter symbol ID:** 9 (`SCATTER_SYMBOL_ID`)
- **Free spins awarded:** 3 scatters → 10, 4 → 15, 5 → 20, 6 → 25
- **Scatter weight:** Controlled by `SYMBOL_WEIGHTS[9]` in `symbolConfig.ts` (higher = more common)
