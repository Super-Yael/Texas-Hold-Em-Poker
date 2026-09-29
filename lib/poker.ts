import { UserError } from "./errors";
import { randomUUID, randomInt } from "node:crypto";
import type { RoomSettings } from "@/lib/settings";

export type Stage = "preflop" | "flop" | "turn" | "river" | "complete";
export type ActionKind = "fold" | "check" | "call" | "raise" | "all-in";
export type Card = string;
export type HandScore = { category: number; kickers: number[]; label: string; bestCards: Card[] };
export type Participant = { id: string; name: string; avatar: string | null };
export type CloseRequest = {
  requestedById: string;
  requestedByName: string;
  approvals: string[];
  createdAt: number;
};
export type Player = {
  id: string;
  name: string;
  avatar: string | null;
  seat: number;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  eliminated?: boolean;
  streetBet: number;
  contribution: number;
  position: string;
  handScore?: HandScore;
};
export type PokerState = {
  gameId: string;
  roomId: string;
  handNo: number;
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  blindIncreaseEvery?: number;
  blindLevelStartHand?: number;
  deckCount?: number;
  fourOfAKindMultiplier?: number;
  straightMultiplier?: number;
  jokersEnabled?: boolean;
  jokerMultiplier?: number;
  stage: Stage;
  board: Card[];
  deck: Card[];
  players: Player[];
  highestBet: number;
  minRaise: number;
  actedSinceRaise: string[];
  lastActor: number;
  pot: number;
  history: string[];
  winners: Array<{ id: string; name: string; amount: number; hand?: string }>;
  outcome: string;
  matchWinnerId?: string;
  closeRequest?: CloseRequest | null;
  continueVotes?: string[];
};

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const RANK_NUM: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const LABELS = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺", "五条"];

function cardRank(card: Card) {
  return RANK_NUM[card.slice(1)] ?? 0;
}
function combinations<T>(arr: T[], choose: number): T[][] {
  if (choose === 0) return [[]];
  if (arr.length < choose) return [];
  const [head, ...tail] = arr;
  return [
    ...combinations(tail, choose - 1).map((x) => [head, ...x]),
    ...combinations(tail, choose),
  ];
}
function compareScore(
  a: Pick<HandScore, "category" | "kickers">,
  b: Pick<HandScore, "category" | "kickers">,
) {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < length; i++)
    if ((a.kickers[i] ?? 0) !== (b.kickers[i] ?? 0))
      return (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
  return 0;
}

function clampPercent(value: number) {
  return Math.max(1, Math.min(99, Math.round(value)));
}

const strengthCache = new Map<string, number>();

function estimateHandStrength(state: PokerState, player: Player) {
  if (
    state.stage === "complete" ||
    player.folded ||
    player.hole.length !== 2
  )
    return undefined;
  const opponents = state.players.filter(
    (candidate) =>
      candidate.id !== player.id && !candidate.folded && !candidate.eliminated && candidate.stack > 0,
  );
  if (!opponents.length) return 99;
  const key = [
    state.gameId,
    state.handNo,
    player.id,
    state.board.join(","),
    player.hole.join(","),
    opponents.length,
    state.deckCount ?? 1,
    state.jokersEnabled ? 1 : 0,
  ].join("|");
  const cached = strengthCache.get(key);
  if (cached !== undefined) return cached;

  const known = new Map<string, number>();
  for (const card of [...player.hole, ...state.board]) known.set(card, (known.get(card) ?? 0) + 1);
  const samples = 128;
  let equity = 0;
  for (let sample = 0; sample < samples; sample++) {
    const blocked = new Map(known);
    const available = newDeck(state.deckCount ?? 1, state.jokersEnabled ?? false).filter((card) => {
      const count = blocked.get(card) ?? 0;
      if (!count) return true;
      blocked.set(card, count - 1);
      return false;
    });
    let cursor = 0;
    const opponentHoles = opponents.map(() => [available[cursor++], available[cursor++]]);
    const board = [...state.board];
    while (board.length < 5) board.push(available[cursor++]);
    const mine = evaluateHand([...player.hole, ...board]);
    if (!mine) continue;
    let best = mine;
    let tied = 1;
    for (const hole of opponentHoles) {
      const score = evaluateHand([...hole, ...board]);
      if (!score) continue;
      const comparison = compareScore(score, best);
      if (comparison > 0) {
        best = score;
        tied = 0;
      } else if (comparison === 0) {
        tied++;
      }
    }
    if (compareScore(mine, best) === 0) equity += 1 / tied;
  }
  const result = clampPercent((equity / samples) * 100);
  strengthCache.set(key, result);
  if (strengthCache.size > 512) strengthCache.delete(strengthCache.keys().next().value!);
  return result;
}
function evaluateFive(cards: Card[]): HandScore {
  const values = cards.map(cardRank).sort((a, b) => b - a);
  const groups = new Map<number, number>();
  values.forEach((n) => groups.set(n, (groups.get(n) ?? 0) + 1));
  const grouped = [...groups.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c[0] === cards[0][0]);
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;
  }
  let category = 0;
  let kickers = values;
  if (grouped[0][1] === 5) {
    category = 9;
    kickers = [grouped[0][0]];
  } else if (flush && straightHigh) {
    category = 8;
    kickers = [straightHigh];
  } else if (grouped[0][1] === 4) {
    category = 7;
    kickers = [grouped[0][0], grouped[1][0]];
  } else if (grouped[0][1] === 3 && grouped[1][1] === 2) {
    category = 6;
    kickers = [grouped[0][0], grouped[1][0]];
  } else if (flush) {
    category = 5;
    kickers = values;
  } else if (straightHigh) {
    category = 4;
    kickers = [straightHigh];
  } else if (grouped[0][1] === 3) {
    category = 3;
    kickers = [
      grouped[0][0],
      ...grouped
        .slice(1)
        .map((x) => x[0])
        .sort((a, b) => b - a),
    ];
  } else if (grouped[0][1] === 2 && grouped[1][1] === 2) {
    category = 2;
    kickers = [grouped[0][0], grouped[1][0], grouped[2][0]];
  } else if (grouped[0][1] === 2) {
    category = 1;
    kickers = [
      grouped[0][0],
      ...grouped
        .slice(1)
        .map((x) => x[0])
        .sort((a, b) => b - a),
    ];
  }
  return {
    category,
    kickers,
    label: category === 8 && straightHigh === 14 ? "皇家同花顺" : LABELS[category],
    bestCards: [...cards],
  };
}
function evaluateFiveWithJokers(cards: Card[]): HandScore {
  const jokerIndexes = cards.flatMap((card, index) => (card.startsWith("JOKER-") ? [index] : []));
  if (!jokerIndexes.length) return evaluateFive(cards);
  let best: HandScore | undefined;
  // Only rank multiplicities and whether all real cards share a suit affect
  // a five-card score. Enumerate rank multisets, not 52^j ordered card choices.
  const realCards = cards.filter((card) => !card.startsWith("JOKER-"));
  const suit = realCards[0]?.[0] ?? "S";
  const replacements = RANKS.map((rank) => `${suit}${rank}`);
  if (jokerIndexes.length >= 4) {
    const rank = realCards.length ? cardRank(realCards[0]) : 14;
    return { category: 9, kickers: [rank], label: LABELS[9], bestCards: [...cards] };
  }
  const visit = (depth: number, substituted: Card[], firstRank = 0) => {
    if (depth === jokerIndexes.length) {
      const score = evaluateFive(substituted);
      if (!best || compareScore(score, best) > 0) best = { ...score, bestCards: [...cards] };
      return;
    }
    const index = jokerIndexes[depth];
    for (let rank = firstRank; rank < replacements.length; rank++) {
      const next = [...substituted];
      next[index] = replacements[rank];
      visit(depth + 1, next, rank);
    }
  };
  visit(0, [...cards]);
  return best!;
}
export function evaluateHand(cards: Card[]): HandScore | undefined {
  if (cards.length < 5) return undefined;
  let best: HandScore | undefined;
  for (const five of combinations(cards, 5)) {
    const score = evaluateFiveWithJokers(five);
    if (!best || compareScore(score, best) > 0) best = score;
  }
  return best;
}
function newDeck(count: number, jokersEnabled = false): Card[] {
  const oneDeck = SUITS.flatMap((s) => RANKS.map((r) => `${s}${r}`));
  const deck = Array.from({ length: count }, () => oneDeck).flat();
  if (jokersEnabled) deck.push("JOKER-B", "JOKER-R");
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function addEvent(state: PokerState, text: string) {
  state.history.unshift(text);
  state.history = state.history.slice(0, 16);
}
function money(n: number) {
  return n.toLocaleString("en-US");
}
function modulo(n: number, count: number) {
  return ((n % count) + count) % count;
}
function refreshPot(state: PokerState) {
  state.pot = state.players.reduce((sum, p) => sum + p.contribution, 0);
}
function commit(player: Player, amount: number) {
  const paid = Math.max(0, Math.min(amount, player.stack));
  player.stack -= paid;
  player.streetBet += paid;
  player.contribution += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}
function postAnte(player: Player, amount: number) {
  const paid = Math.max(0, Math.min(amount, player.stack));
  player.stack -= paid;
  player.contribution += paid;
  if (player.stack === 0) player.allIn = true;
}
function activePlayers(state: PokerState) {
  return state.players.filter((p) => !p.folded);
}
function actorNeeded(state: PokerState, player: Player) {
  return (
    !player.folded &&
    !player.allIn &&
    (!state.actedSinceRaise.includes(player.id) || player.streetBet < state.highestBet)
  );
}
function nextActor(state: PokerState, startSeat: number) {
  const count = state.players.length;
  for (let offset = 1; offset <= count; offset++) {
    const seat = modulo(startSeat + offset, count);
    const player = state.players.find((p) => p.seat === seat)!;
    if (actorNeeded(state, player)) return player;
  }
  return undefined;
}
function handName(score: HandScore) {
  return score.label;
}
function declareMatchWinner(state: PokerState) {
  for (const player of state.players) player.eliminated = player.stack <= 0;
  const contenders = state.players.filter((p) => p.stack > 0);
  if (contenders.length !== 1) return;
  const winner = contenders[0];
  state.matchWinnerId = winner.id;
  state.outcome = `${winner.name} 赢得整场对局`;
  addEvent(state, `整场对局结束 · ${winner.name} 获胜，最终筹码 ${money(winner.stack)}`);
}
function settleUncontested(state: PokerState, winner: Player) {
  const amount = state.players.reduce((sum, p) => sum + p.contribution, 0);
  winner.stack += amount;
  state.winners = [{ id: winner.id, name: winner.name, amount }];
  state.outcome = `${winner.name} 赢下底池 ${money(amount)}`;
  state.stage = "complete";
  state.pot = 0;
  addEvent(state, `${winner.name} 赢得 ${money(amount)} 筹码 · 其他玩家弃牌`);
  declareMatchWinner(state);
}
function settleShowdown(state: PokerState) {
  const survivors = activePlayers(state);
  if (survivors.length === 1) {
    settleUncontested(state, survivors[0]);
    return;
  }
  for (const player of survivors) player.handScore = evaluateHand([...player.hole, ...state.board]);
  const levels = [...new Set(state.players.map((p) => p.contribution).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  let previous = 0;
  let deadAmount = 0;
  const pots: Array<{ amount: number; eligible: Player[] }> = [];
  for (const level of levels) {
    const contributors = state.players.filter((p) => p.contribution >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (amount <= 0) continue;
    const eligible = contributors.filter((p) => !p.folded);
    if (!eligible.length) deadAmount += amount;
    else {
      pots.push({ amount: amount + deadAmount, eligible });
      deadAmount = 0;
    }
  }
  if (deadAmount && pots.length) pots[pots.length - 1].amount += deadAmount;
  const winnings = new Map<string, number>();
  for (const pot of pots) {
    const { amount, eligible } = pot;
    let best = eligible[0];
    for (const p of eligible.slice(1))
      if (compareScore(p.handScore!, best.handScore!) > 0) best = p;
    const tied = eligible.filter((p) => compareScore(p.handScore!, best.handScore!) === 0);
    const share = Math.floor(amount / tied.length);
    let remainder = amount - share * tied.length;
    const ordered = tied.sort(
      (a, b) =>
        modulo(a.seat - state.buttonSeat - 1, state.players.length) -
        modulo(b.seat - state.buttonSeat - 1, state.players.length),
    );
    for (const p of ordered) {
      const award = share + (remainder-- > 0 ? 1 : 0);
      p.stack += award;
      winnings.set(p.id, (winnings.get(p.id) ?? 0) + award);
    }
  }
  const bonusClaims = [...winnings.entries()]
    .map(([id, amount]) => {
      const player = state.players.find((entry) => entry.id === id)!;
      const handMultiplier =
        player.handScore?.category === 7
          ? (state.fourOfAKindMultiplier ?? 1)
          : player.handScore?.category === 4
            ? (state.straightMultiplier ?? 1)
            : 1;
      const jokerMultiplier =
        state.jokersEnabled && player.hole.some((card) => card.startsWith("JOKER-"))
          ? (state.jokerMultiplier ?? 2)
          : 1;
      return { id, extra: amount * (handMultiplier * jokerMultiplier - 1) };
    })
    .filter((claim) => claim.extra > 0);
  const requestedBonus = bonusClaims.reduce((sum, claim) => sum + claim.extra, 0);
  const bonusPayers = state.players.filter(
    (player) => !winnings.has(player.id) && player.contribution > 0 && player.stack > 0,
  );
  const payerTotal = bonusPayers.reduce((sum, player) => sum + player.stack, 0);
  const payableBonus = Math.min(requestedBonus, payerTotal);
  if (payableBonus > 0) {
    let paid = 0;
    bonusPayers.forEach((player) => {
      const amount = Math.min(player.stack, Math.floor((payableBonus * player.stack) / payerTotal));
      player.stack -= amount;
      paid += amount;
    });
    let remainder = payableBonus - paid;
    for (let index = 0; remainder > 0 && index < bonusPayers.length; index++) {
      const amount = Math.min(remainder, bonusPayers[index].stack);
      bonusPayers[index].stack -= amount;
      remainder -= amount;
    }
    let distributed = 0;
    bonusClaims.forEach((claim, index) => {
      const amount =
        index === bonusClaims.length - 1
          ? payableBonus - distributed
          : Math.floor((payableBonus * claim.extra) / requestedBonus);
      const player = state.players.find((entry) => entry.id === claim.id)!;
      player.stack += amount;
      winnings.set(claim.id, (winnings.get(claim.id) ?? 0) + amount);
      distributed += amount;
    });
    addEvent(state, `加倍奖励 ${money(payableBonus)} · 由输家按剩余筹码比例支付`);
  }
  state.winners = [...winnings.entries()].map(([id, amount]) => {
    const player = state.players.find((p) => p.id === id)!;
    return { id, name: player.name, amount, hand: player.handScore?.label };
  });
  state.outcome =
    state.winners.length > 1
      ? `摊牌结算 · ${state.winners.map((w) => `${w.name} +${money(w.amount)}`).join(" / ")}`
      : `${state.winners.map((w) => w.name).join("、")} 赢得底池`;
  state.stage = "complete";
  state.pot = 0;
  for (const p of survivors) addEvent(state, `${p.name} 摊牌 · ${handName(p.handScore!)}`);
  addEvent(state, `摊牌结算 · ${state.outcome}`);
  declareMatchWinner(state);
}
function closeStreet(state: PokerState) {
  if (state.stage === "preflop") {
    state.stage = "flop";
    state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
  } else if (state.stage === "flop") {
    state.stage = "turn";
    state.board.push(state.deck.pop()!);
  } else if (state.stage === "turn") {
    state.stage = "river";
    state.board.push(state.deck.pop()!);
  } else {
    settleShowdown(state);
    return;
  }
  for (const p of state.players) p.streetBet = 0;
  state.highestBet = 0;
  state.minRaise = state.bigBlind;
  state.actedSinceRaise = [];
  state.lastActor = state.buttonSeat;
  addEvent(
    state,
    `${state.stage === "flop" ? "翻牌 Flop" : state.stage === "turn" ? "转牌 Turn" : "河牌 River"} · 公共牌发出`,
  );
}
function advance(state: PokerState) {
  let safety = 0;
  while (state.stage !== "complete" && safety++ < 40) {
    const survivors = activePlayers(state);
    if (survivors.length === 1) {
      settleUncontested(state, survivors[0]);
      break;
    }
    if (survivors.filter((p) => !p.allIn).length === 0) {
      closeStreet(state);
      continue;
    }
    if (!nextActor(state, state.lastActor)) {
      closeStreet(state);
      continue;
    }
    break;
  }
  if (state.stage === "complete") state.pot = 0;
  else refreshPot(state);
}

export function createGame(
  roomId: string,
  participants: Participant[],
  settings: RoomSettings,
): PokerState {
  if (participants.length < 2 || participants.length > settings.maxPlayers)
    throw new UserError(`牌桌需要 2 到 ${settings.maxPlayers} 位玩家`);
  return {
    gameId: randomUUID(),
    roomId,
    handNo: 0,
    buttonSeat: 0,
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    ante: settings.ante,
    blindIncreaseEvery: settings.blindIncreaseEvery,
    blindLevelStartHand: 1,
    deckCount: settings.deckCount,
    fourOfAKindMultiplier: settings.fourOfAKindMultiplier,
    straightMultiplier: settings.straightMultiplier,
    jokersEnabled: settings.jokersEnabled,
    jokerMultiplier: settings.jokerMultiplier,
    stage: "complete",
    board: [],
    deck: [],
    players: participants.map((p, seat) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat,
      stack: settings.startingStack,
      hole: [],
      folded: false,
      allIn: false,
      eliminated: false,
      streetBet: 0,
      contribution: 0,
      position: "",
    })),
    highestBet: 0,
    minRaise: settings.bigBlind,
    actedSinceRaise: [],
    lastActor: -1,
    pot: 0,
    history: [],
    winners: [],
    outcome: "",
    continueVotes: [],
  };
}
function requireHandComplete(state: PokerState) {
  if (state.stage !== "complete") throw new UserError("请等这一手结束后再修改牌桌");
  if (state.closeRequest) throw new UserError("牌桌正在等待关闭确认");
}
function reopenMatch(state: PokerState) {
  if (!state.matchWinnerId || state.players.filter((player) => player.stack > 0).length < 2) return;
  state.matchWinnerId = undefined;
  state.history = state.history.filter((entry) => !entry.startsWith("整场对局结束"));
  state.outcome =
    state.winners.length === 1 ? `${state.winners[0].name} 赢下上一手` : "上一手已结束";
}
export function configureNextHand(
  state: PokerState,
  settings: RoomSettings,
  previous: RoomSettings,
  resetBlinds = false,
) {
  requireHandComplete(state);
  if (
    resetBlinds ||
    previous.smallBlind !== settings.smallBlind ||
    previous.bigBlind !== settings.bigBlind
  ) {
    state.smallBlind = settings.smallBlind;
    state.bigBlind = settings.bigBlind;
    state.blindLevelStartHand = state.handNo + 1;
  } else if (previous.blindIncreaseEvery !== settings.blindIncreaseEvery) {
    state.blindLevelStartHand = state.handNo + 1;
  }
  state.ante = settings.ante;
  state.blindIncreaseEvery = settings.blindIncreaseEvery;
  state.deckCount = settings.deckCount;
  state.fourOfAKindMultiplier = settings.fourOfAKindMultiplier;
  state.straightMultiplier = settings.straightMultiplier;
  state.jokersEnabled = settings.jokersEnabled;
  state.jokerMultiplier = settings.jokerMultiplier;
  state.continueVotes = [];
  addEvent(state, "房主更新牌桌规则 · 下一手生效");
}
export function addPlayerBetweenHands(state: PokerState, participant: Participant, stack: number) {
  requireHandComplete(state);
  if (state.players.some((player) => player.id === participant.id))
    throw new UserError("玩家已经在牌桌中");
  state.players.push({
    ...participant,
    seat: state.players.length,
    stack,
    hole: [],
    folded: true,
    allIn: false,
    eliminated: false,
    streetBet: 0,
    contribution: 0,
    position: "WAIT",
  });
  state.continueVotes = [];
  reopenMatch(state);
  addEvent(state, `${participant.name} 加入牌桌 · 下一手发牌`);
}
export function removePlayerBetweenHands(state: PokerState, userId: string) {
  requireHandComplete(state);
  const removed = state.players.find((player) => player.id === userId);
  if (!removed) throw new UserError("玩家不在牌桌中");
  state.players = state.players.filter((player) => player.id !== userId);
  state.players.forEach((player, seat) => {
    player.seat = seat;
  });
  if (state.buttonSeat > removed.seat) state.buttonSeat -= 1;
  else if (state.buttonSeat === removed.seat)
    state.buttonSeat = (removed.seat - 1 + state.players.length) % state.players.length;
  state.continueVotes = [];
  addEvent(state, `${removed.name} 离开牌桌`);
}
export function addChipsBetweenHands(state: PokerState, userId: string, amount: number) {
  requireHandComplete(state);
  const player = state.players.find((entry) => entry.id === userId);
  if (!player) throw new UserError("玩家不在牌桌中");
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 10_000_000 ||
    player.stack + amount > 1_000_000_000
  )
    throw new UserError("补充筹码须为 1 到 10,000,000，且总筹码不能超过 1,000,000,000");
  player.stack += amount;
  player.eliminated = false;
  player.position = "WAIT";
  state.continueVotes = [];
  reopenMatch(state);
  addEvent(state, `${player.name} 补充 ${money(amount)} 筹码`);
}
export function startHand(state: PokerState, rotate = false) {
  if (state.matchWinnerId) throw new UserError("整场对局已经结束");
  state.continueVotes = [];
  const count = state.players.length;
  const eligible = state.players.filter((p) => p.stack > 0);
  if (eligible.length < 2) {
    state.stage = "complete";
    state.pot = 0;
    declareMatchWinner(state);
    return;
  }
  const nextHandNo = state.handNo + 1;
  const interval = state.blindIncreaseEvery ?? 0;
  const blindLevelStartHand = state.blindLevelStartHand ?? 1;
  if (
    interval > 0 &&
    nextHandNo > blindLevelStartHand &&
    (nextHandNo - blindLevelStartHand) % interval === 0 &&
    state.bigBlind <= 500_000 &&
    state.smallBlind <= 250_000
  ) {
    state.smallBlind *= 2;
    state.bigBlind *= 2;
    addEvent(state, `盲注升级至 ${money(state.smallBlind)}/${money(state.bigBlind)}`);
  }
  const previousButton = state.buttonSeat;
  const clockwise = () =>
    [...eligible].sort(
      (a, b) => modulo(a.seat - state.buttonSeat, count) - modulo(b.seat - state.buttonSeat, count),
    );
  const nextButton = rotate
    ? (clockwise().find((p) => p.seat !== previousButton) ?? eligible[0])
    : (eligible.find((p) => p.seat === previousButton) ?? clockwise()[0]);
  state.buttonSeat = nextButton.seat;
  const handPlayers = clockwise();
  const handCount = handPlayers.length;
  state.handNo += 1;
  state.board = [];
  state.deck = newDeck(state.deckCount ?? 1, state.jokersEnabled ?? false);
  state.stage = "preflop";
  state.highestBet = 0;
  state.minRaise = state.bigBlind;
  state.actedSinceRaise = [];
  state.winners = [];
  state.outcome = "";
  for (const p of state.players) {
    p.hole = [];
    p.folded = p.stack <= 0;
    p.allIn = false;
    p.eliminated = p.stack <= 0;
    p.streetBet = 0;
    p.contribution = 0;
    p.handScore = undefined;
    p.position = p.eliminated ? "OUT" : "";
  }
  const positionLabels: Record<number, string[]> = {
    3: ["BTN", "SB", "BB"],
    4: ["BTN", "SB", "BB", "UTG"],
    5: ["BTN", "SB", "BB", "UTG", "CO"],
    6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  };
  for (let offset = 0; offset < handCount; offset++) {
    const p = handPlayers[offset];
    p.position =
      handCount === 2
        ? offset === 0
          ? "BTN/SB"
          : "BB"
        : (positionLabels[handCount]?.[offset] ?? `P${offset + 1}`);
  }
  for (let n = 0; n < 2; n++) for (const player of handPlayers) player.hole.push(state.deck.pop()!);
  if ((state.ante ?? 0) > 0) {
    for (const player of handPlayers) postAnte(player, state.ante!);
    addEvent(state, `每人前注 ${money(state.ante!)} 已放入底池`);
  }
  const sb = state.players.find((p) => p.position === "SB" || p.position === "BTN/SB")!;
  const bb = state.players.find((p) => p.position === "BB")!;
  commit(sb, state.smallBlind);
  commit(bb, state.bigBlind);
  state.highestBet = Math.max(...state.players.map((p) => p.streetBet));
  state.lastActor = bb.seat;
  refreshPot(state);
  addEvent(
    state,
    `第 ${state.handNo} 手 · ${state.players.find((p) => p.seat === state.buttonSeat)?.name} 持有庄家按钮`,
  );
  addEvent(state, `盲注 ${state.smallBlind}/${state.bigBlind} 已放入底池`);
}
function canRaise(state: PokerState, player: Player) {
  const live = activePlayers(state).filter((p) => !p.allIn);
  return (
    live.length > 1 &&
    !state.actedSinceRaise.includes(player.id) &&
    player.stack > Math.max(0, state.highestBet - player.streetBet)
  );
}
function applyAction(state: PokerState, player: Player, kind: ActionKind, raiseTo?: number) {
  const toCall = Math.max(0, state.highestBet - player.streetBet);
  if (kind === "fold") {
    player.folded = true;
    state.actedSinceRaise.push(player.id);
    addEvent(state, `${player.name} 弃牌`);
  } else if (kind === "check") {
    if (toCall > 0) throw new UserError("当前有未跟注的下注，不能过牌");
    state.actedSinceRaise.push(player.id);
    addEvent(state, `${player.name} 过牌`);
  } else if (kind === "call") {
    if (toCall <= 0) throw new UserError("目前没有下注可跟");
    const paid = commit(player, toCall);
    state.actedSinceRaise.push(player.id);
    addEvent(state, `${player.name} ${player.allIn ? "全下跟注" : "跟注"} ${money(paid)}`);
  } else if (kind === "raise" || kind === "all-in") {
    const mayRaise = canRaise(state, player);
    if (kind === "raise" && (typeof raiseTo !== "number" || !Number.isFinite(raiseTo)))
      throw new UserError("请输入有效的加注金额");
    const target = kind === "all-in" ? player.streetBet + player.stack : Math.floor(raiseTo ?? 0);
    const maximum = player.streetBet + player.stack;
    if (target <= state.highestBet) {
      if (kind !== "all-in") throw new UserError("加注金额必须高于当前下注");
      const paid = commit(player, Math.max(0, state.highestBet - player.streetBet));
      state.actedSinceRaise.push(player.id);
      addEvent(state, `${player.name} 全下跟注 ${money(paid)}`);
    } else {
      if (!mayRaise) throw new UserError("当前不能再次加注");
      if (target > maximum) throw new UserError("筹码不足以达到这个加注金额");
      const minimum = state.highestBet === 0 ? state.bigBlind : state.highestBet + state.minRaise;
      const isAllIn = target === maximum;
      if (target < minimum && !isAllIn) throw new UserError(`最小加注为 ${money(minimum)}`);
      const oldBet = state.highestBet;
      const paid = commit(player, target - player.streetBet);
      state.highestBet = player.streetBet;
      const raiseSize = state.highestBet - oldBet;
      if (raiseSize >= state.minRaise) {
        state.minRaise = raiseSize;
        state.actedSinceRaise = [player.id];
      } else state.actedSinceRaise.push(player.id);
      addEvent(
        state,
        `${player.name} ${oldBet === 0 ? "下注" : "加注至"} ${money(state.highestBet)}${player.allIn ? " · 全下" : ""}`,
      );
      if (!paid) throw new UserError("没有可投入的筹码");
    }
  }
  state.lastActor = player.seat;
  refreshPot(state);
}
export function startGameHand(state: PokerState, rotate = false) {
  startHand(state, rotate);
  advance(state);
}
export function takeAction(state: PokerState, userId: string, kind: ActionKind, raiseTo?: number) {
  if (state.stage === "complete") throw new UserError("本手牌已经结束");
  const player = state.players.find((p) => p.id === userId);
  if (!player) throw new UserError("你不在这张牌桌里");
  if (nextActor(state, state.lastActor)?.id !== userId) throw new UserError("现在还没轮到你行动");
  applyAction(state, player, kind, raiseTo);
  advance(state);
}
function potLayers(state: PokerState) {
  if (!state.players.some((p) => p.allIn)) return [] as Array<{ label: string; amount: number }>;
  const levels = [...new Set(state.players.map((p) => p.contribution).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  let previous = 0;
  let deadAmount = 0;
  const pots: Array<{ label: string; amount: number }> = [];
  for (const level of levels) {
    const contributors = state.players.filter((p) => p.contribution >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (amount <= 0) continue;
    if (!contributors.some((p) => !p.folded)) deadAmount += amount;
    else {
      const index = pots.length;
      pots.push({ label: index === 0 ? "主池" : `边池 ${index}`, amount: amount + deadAmount });
      deadAmount = 0;
    }
  }
  if (deadAmount && pots.length) pots[pots.length - 1].amount += deadAmount;
  return pots;
}
export function publicGame(state: PokerState, viewerId: string) {
  const viewer = state.players.find((p) => p.id === viewerId);
  if (!viewer) throw new UserError("你不在这张牌桌里");
  const actor = state.stage === "complete" ? undefined : nextActor(state, state.lastActor);
  const canAct = actor?.id === viewerId;
  const toCall = canAct ? Math.max(0, state.highestBet - viewer.streetBet) : 0;
  const raisePossible = canAct && canRaise(state, viewer);
  const minRaiseTo = state.highestBet === 0 ? state.bigBlind : state.highestBet + state.minRaise;
  const maxRaiseTo = viewer.streetBet + viewer.stack;
  const canRaiseAction = raisePossible && maxRaiseTo >= minRaiseTo;
  const revealAll = state.stage === "complete" && state.board.length === 5;
  const matchWinner = state.matchWinnerId
    ? state.players.find((p) => p.id === state.matchWinnerId)
    : undefined;
  return {
    roomId: state.roomId,
    handNo: state.handNo,
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    ante: state.ante ?? 0,
    deckCount: state.deckCount ?? 1,
    stage: state.stage,
    strengthPercentile: estimateHandStrength(state, viewer),
    fourOfAKindMultiplier: state.fourOfAKindMultiplier ?? 1,
    straightMultiplier: state.straightMultiplier ?? 1,
    jokersEnabled: state.jokersEnabled ?? false,
    jokerMultiplier: state.jokerMultiplier ?? 2,
    board: state.board,
    pot: state.pot,
    highestBet: state.highestBet,
    minRaise: state.minRaise,
    toCall,
    canAct,
    canRaise: canRaiseAction,
    canAllIn: canAct && (maxRaiseTo <= state.highestBet || raisePossible),
    minRaiseTo,
    currentPlayerId: actor?.id,
    history: state.history,
    winners: state.winners,
    outcome: state.outcome,
    pots: potLayers(state),
    closeRequest: state.closeRequest ?? null,
    continueVotes: state.continueVotes ?? [],
    matchComplete: !!state.matchWinnerId,
    matchWinner: matchWinner
      ? { id: matchWinner.id, name: matchWinner.name, chips: matchWinner.stack }
      : null,
    players: state.players.map((player) => {
      const revealed = player.id === viewerId || (revealAll && !player.folded);
      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        seat: player.seat,
        stack: player.stack,
        folded: player.folded,
        allIn: player.allIn,
        eliminated: player.eliminated,
        streetBet: player.streetBet,
        contribution: player.contribution,
        position: player.position,
        hole: revealed ? player.hole : [],
        revealed,
        handScore: revealed
          ? (player.handScore ?? evaluateHand([...player.hole, ...state.board]))
          : undefined,
      };
    }),
  };
}
