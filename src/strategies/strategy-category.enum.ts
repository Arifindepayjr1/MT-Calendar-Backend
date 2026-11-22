export const STRATEGY_CATEGORIES = [
  'ictSmc',
  'priceAction',
  'trendFollowing',
  'scalping',
  'breakout',
  'other',
] as const;

export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number];
