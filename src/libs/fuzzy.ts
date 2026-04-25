export { match, search, type Match, type SearchOptions };

import { type Maybe, Just, Nothing, mapMaybe } from "@/libs/maybe";

type Match = {
  score: number;
  positions: ReadonlyArray<number>;
};

type SearchOptions = {
  caseSensitive?: boolean;
  separators?: RegExp;
};

const SEPARATORS = /[\s\-_./]+/;
const SEPARATOR_CHAR = /[\s\-_./]/;

const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 8;
const BONUS_CONSECUTIVE = 4;
const PENALTY_GAP_START = -3;
const PENALTY_GAP_EXTEND = -1;

const applyCase = (s: string, caseSensitive: boolean): string => (caseSensitive ? s : s.toLowerCase());

const isBoundary = (target: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = target[i - 1];
  return prev !== undefined && SEPARATOR_CHAR.test(prev);
};

type TokenScore = { score: number; end: number; positions: ReadonlyArray<number> };
type GapScan = { matchIndex: number; gapPenalty: number };

const scanForChar = (target: string, from: number, ch: string): Maybe<GapScan> => {
  let ti = from;
  let gapPenalty = 0;
  let inGap = false;
  while (ti < target.length && target[ti] !== ch) {
    gapPenalty += inGap ? PENALTY_GAP_EXTEND : PENALTY_GAP_START;
    inGap = true;
    ti++;
  }
  return ti >= target.length ? Nothing() : Just({ matchIndex: ti, gapPenalty });
};

const scoreMatchAt = (target: string, ti: number, prevMatchIndex: number): number => {
  let score = SCORE_MATCH;
  if (isBoundary(target, ti)) score += BONUS_BOUNDARY;
  if (prevMatchIndex === ti - 1) score += BONUS_CONSECUTIVE;
  return score;
};

const scoreToken = (token: string, target: string, from: number): Maybe<TokenScore> => {
  const positions: number[] = [];
  let score = 0;
  let prevMatchIndex = -1;
  let ti = from;

  for (const ch of token) {
    const found = scanForChar(target, ti, ch);
    if (found.isNothing()) return Nothing();
    const inner = found.expect("checked above");
    score += inner.gapPenalty + scoreMatchAt(target, inner.matchIndex, prevMatchIndex);
    positions.push(inner.matchIndex);
    prevMatchIndex = inner.matchIndex;
    ti = inner.matchIndex + 1;
  }
  return Just({ score, end: ti, positions });
};

const scoreAllTokens = (tokens: ReadonlyArray<string>, target: string): Maybe<Match> => {
  let cursor = 0;
  let total = 0;
  const allPositions: number[] = [];
  for (const tok of tokens) {
    const r = scoreToken(tok, target, cursor);
    if (r.isNothing()) return Nothing();
    const inner = r.expect("checked above");
    total += inner.score;
    allPositions.push(...inner.positions);
    cursor = inner.end;
  }
  return Just({ score: total, positions: allPositions });
};

const match = (query: string, target: string, options?: SearchOptions): Maybe<Match> => {
  const caseSensitive = options?.caseSensitive ?? /[A-Z]/.test(query);
  const sep = options?.separators ?? SEPARATORS;
  const tokens = applyCase(query, caseSensitive).split(sep).filter(Boolean);
  if (tokens.length === 0) return Just({ score: 0, positions: [] });
  return scoreAllTokens(tokens, applyCase(target, caseSensitive));
};

const search = <T>(
  query: string,
  items: ReadonlyArray<T>,
  selectors: ReadonlyArray<(item: T) => string>,
  options?: SearchOptions
): ReadonlyArray<{ item: T; match: Match }> => {
  if (query.trim().length === 0) {
    return items.map((item) => ({ item, match: { score: 0, positions: [] } }));
  }
  const scored = mapMaybe([...items], (item) => {
    const matches = mapMaybe([...selectors], (sel) => match(query, sel(item), options));
    if (matches.length === 0) return Nothing<{ item: T; match: Match }>();
    const best = matches.reduce((a, b) => (b.score > a.score ? b : a));
    return Just({ item, match: best });
  });
  return [...scored].sort((a, b) => b.match.score - a.match.score);
};
