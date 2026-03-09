import type { SupportedAlgorithmId } from "./types";

export const ALGORITHM_ORDER: SupportedAlgorithmId[] = [
  "jtk_cycle",
  "ejtk",
  "lomb_scargle",
  "arser",
  "rain",
  "metacycle",
];

export const ALGORITHM_META: Record<
  SupportedAlgorithmId,
  { label: string; shortLabel: string }
> = {
  jtk_cycle: {
    label: "JTK_CYCLE",
    shortLabel: "JTK",
  },
  ejtk: {
    label: "eJTK",
    shortLabel: "eJTK",
  },
  lomb_scargle: {
    label: "Lomb-Scargle",
    shortLabel: "LS",
  },
  arser: {
    label: "ARSER",
    shortLabel: "ARSER",
  },
  rain: {
    label: "RAIN",
    shortLabel: "RAIN",
  },
  metacycle: {
    label: "MetaCycle",
    shortLabel: "MetaCycle",
  },
};
