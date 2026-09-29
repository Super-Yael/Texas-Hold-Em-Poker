const version = "cards-1";
const suits: Record<string, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const ranks: Record<string, string> = { J: "jack", Q: "queen", K: "king", A: "ace" };

export function cardImageUrl(card: string) {
  let filename: string;
  if (card === "JOKER-B") filename = "black_joker";
  else if (card === "JOKER-R") filename = "red_joker";
  else filename = `${ranks[card.slice(1)] ?? card.slice(1)}_of_${suits[card[0]]}`;
  return `/cards/svg/${filename}.svg?v=${version}`;
}
