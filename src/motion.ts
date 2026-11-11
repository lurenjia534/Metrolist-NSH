import { reduceMotion, type ViewStyle } from "nsh";

// Shared timings for NSH's UI-thread animation graph and style transitions.
export const motion = {
  instant: 120,
  fast: 160,
  base: 240,
  enter: 260,
  exit: 160,
  progress: 240,
  shift: 8,
  pressScale: 0.97,
  iconPressScale: 0.95,
} as const;

export const motionDuration = (milliseconds: number) => reduceMotion() ? 0 : milliseconds;

export function transition(properties = "colors,opacity,transform", milliseconds: number = motion.fast): ViewStyle {
  return {
    transitionProperty: properties,
    transitionDuration: motionDuration(milliseconds),
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
  };
}
