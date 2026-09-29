import type { Game, Player, RoomView } from "@/lib/table-types";
import type { RoomAction } from "@/lib/room-command";

export const REALTIME_PATH = "/realtime";
export const PROTOCOL_VERSION = 1;
export type SharedView = Omit<RoomView, "invitations">;
export type PersonalView = {
  invitations: RoomView["invitations"];
  game:
    (Pick<Game, "toCall" | "canAct" | "canRaise" | "canAllIn"> & { player: Player | null }) | null;
};
export type PublicState = { epoch: string; roomId: string; revision: number; view: SharedView };
export type SignedState = { type: "state"; payload: string; signature: string };
export type Peer = { id: string; userId: string };
export type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
export type ServerMessage =
  | {
      type: "welcome";
      protocol: number;
      id: string;
      epoch: string;
      publicKey: string;
      iceServers: RTCIceServer[];
    }
  | { type: "peers"; peers: Peer[] }
  | { type: "signal"; from: string; signal: Signal }
  | { type: "private"; epoch: string; revision: number; personal: PersonalView }
  | SignedState
  | { type: "relay"; state: SignedState; targets: string[] }
  | { type: "result"; id: string; ok: boolean; error?: string }
  | { type: "room-gone" }
  | { type: "error"; error: string }
  | { type: "pong" };
export type ClientMessage =
  | { type: "join"; roomId: string; protocol: number }
  | { type: "signal"; to: string; signal: Signal }
  | { type: "link"; to: string; ready: boolean }
  | { type: "received"; revision: number }
  | { type: "relay-failed"; revision: number; targets: string[] }
  | { type: "action"; id: string; epoch: string; revision: number; body: RoomAction }
  | { type: "ping" };

// Only this projection is signed and allowed onto a peer connection.
// The deck never enters roomView; hidden cards and private scores are removed here.
export function splitView(
  view: RoomView,
  viewerId: string,
): { shared: SharedView; personal: PersonalView } {
  const { invitations, game, ...room } = view;
  const reveal = game?.stage === "complete" && game.board.length === 5;
  return {
    shared: {
      ...room,
      game: game
        ? {
            ...game,
            toCall: 0,
            canAct: false,
            canRaise: false,
            canAllIn: false,
            players: game.players.map((player) => ({
              ...player,
              hole: reveal && !player.folded ? player.hole : [],
              handScore: reveal && !player.folded ? player.handScore : undefined,
              revealed: !!reveal && !player.folded,
            })),
          }
        : null,
    },
    personal: {
      invitations,
      game: game
        ? {
            toCall: game.toCall,
            canAct: game.canAct,
            canRaise: game.canRaise,
            canAllIn: game.canAllIn,
            player: game.players.find((player) => player.id === viewerId) ?? null,
          }
        : null,
    },
  };
}

export function mergeView(shared: SharedView, personal: PersonalView): RoomView {
  const { player, ...permissions } = personal.game ?? {};
  return {
    ...shared,
    invitations: personal.invitations,
    game: shared.game
      ? {
          ...shared.game,
          ...permissions,
          players: shared.game.players.map((item) => (item.id === player?.id ? player : item)),
        }
      : null,
  };
}
