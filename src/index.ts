//index.ts
// Root entry for Vite: delegate to the Pixi UI composition root.
// The actual game wiring (Pixi scene, GameController, domain services)
// lives in `src/ui/pixi/main.ts` to keep the UI layer separate.
import "./ui/pixi/main";