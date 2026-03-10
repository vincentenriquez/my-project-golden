//tweenTypes.ts
/** Callback to register a tween (object, property, target, time, easing, onComplete). */
export type TweenToFn = (
  object: unknown,
  property: string,
  target: number,
  time: number,
  easing: (t: number) => number,
  onchange?: (t: unknown) => void,
  oncomplete?: (t: unknown) => void
) => void;

