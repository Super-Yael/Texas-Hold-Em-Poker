type RoomChange = { roomId: string; actorId?: string };
type Listener = (change: RoomChange) => void;

// Next.js bundles route handlers separately from the custom server. Both use this
// process-wide registry so domain mutations, HTTP and WS share one event stream.
const processState = globalThis as typeof globalThis & { pokerRoomListeners?: Set<Listener> };
const listeners = (processState.pokerRoomListeners ??= new Set<Listener>());

export function roomChanged(roomId: string, actorId?: string) {
  for (const listener of listeners) {
    try {
      listener({ roomId, actorId });
    } catch (error) {
      console.error("Room notification failed after commit", error);
    }
  }
}

export function onRoomChanged(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
