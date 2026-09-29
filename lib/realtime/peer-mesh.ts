import type { ClientMessage, Peer, Signal, SignedState } from "./protocol";

type PeerLink = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  candidates: RTCIceCandidateInit[];
  queue: Promise<void>;
  retry?: ReturnType<typeof setTimeout>;
};

export class PeerMesh {
  private closed = false;
  private peers = new Map<string, PeerLink>();

  constructor(
    private id: string,
    private iceServers: RTCIceServer[],
    private sendSignal: (message: ClientMessage) => void,
    private onState: (state: SignedState) => Promise<unknown>,
  ) {}

  update(peers: Peer[]) {
    const ids = new Set(peers.map((peer) => peer.id));
    for (const id of this.peers.keys()) if (!ids.has(id)) this.closePeer(id);
    for (const id of ids) this.getPeer(id);
  }

  signal(from: string, signal: Signal) {
    const peer = this.getPeer(from);
    if (!peer) return;
    peer.queue = peer.queue
      .then(() => this.handleSignal(from, peer, signal))
      .catch(() => this.peerFailed(from, peer));
  }

  relay(state: SignedState, targets: string[]) {
    const serialized = JSON.stringify(state);
    const failed: string[] = [];
    for (const target of targets) {
      const channel = this.peers.get(target)?.channel;
      try {
        if (!channel || channel.readyState !== "open" || channel.bufferedAmount > 256 * 1024)
          failed.push(target);
        else channel.send(serialized);
      } catch {
        failed.push(target);
      }
    }
    return failed;
  }

  close() {
    this.closed = true;
    for (const id of this.peers.keys()) this.closePeer(id);
  }
  private getPeer(id: string): PeerLink | undefined {
    if (!this.id || id === this.id || typeof RTCPeerConnection === "undefined") return;
    const existing = this.peers.get(id);
    if (existing) return existing;
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: this.iceServers });
    } catch {
      return;
    }
    const peer: PeerLink = { pc, candidates: [], queue: Promise.resolve() };
    this.peers.set(id, peer);
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.sendSignal({
          type: "signal",
          to: id,
          signal: { candidate: event.candidate.toJSON() },
        });
    };
    pc.ondatachannel = (event) => this.bindChannel(id, peer, event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected" && peer.channel?.readyState === "open") {
        clearTimeout(peer.retry);
        peer.retry = undefined;
        this.sendSignal({ type: "link", to: id, ready: true });
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected")
        this.peerFailed(id, peer);
    };
    if (this.id < id) {
      this.bindChannel(id, peer, pc.createDataChannel("poker-public", { ordered: true }));
      peer.queue = peer.queue
        .then(async () => {
          await pc.setLocalDescription(await pc.createOffer());
          this.sendSignal({
            type: "signal",
            to: id,
            signal: { description: pc.localDescription!.toJSON() },
          });
        })
        .catch(() => this.peerFailed(id, peer));
    }
    return peer;
  }

  private bindChannel(id: string, peer: PeerLink, channel: RTCDataChannel) {
    peer.channel = channel;
    channel.onopen = () => {
      this.sendSignal({ type: "link", to: id, ready: true });
      clearTimeout(peer.retry);
      peer.retry = undefined;
    };
    channel.onclose = () => this.peerFailed(id, peer);
    channel.onerror = () => this.peerFailed(id, peer);
    let queue = Promise.resolve();
    let queued = 0;
    channel.onmessage = (event) => {
      if (queued >= 16 || typeof event.data !== "string" || event.data.length > 256 * 1024) return;
      queued += 1;
      queue = queue
        .then(async () => {
          if (this.closed || this.peers.get(id) !== peer) return;
          const message = JSON.parse(event.data) as SignedState;
          if (message.type === "state") await this.onState(message);
        })
        .catch(() => {})
        .finally(() => {
          queued -= 1;
        }); // Invalid peer messages are discarded.
    };
  }

  private async handleSignal(id: string, peer: PeerLink, signal: Signal) {
    if (this.peers.get(id) !== peer || this.closed) return;
    if (signal.description) {
      await peer.pc.setRemoteDescription(signal.description);
      for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.sendSignal({
          type: "signal",
          to: id,
          signal: { description: peer.pc.localDescription!.toJSON() },
        });
      }
    } else if (signal.candidate) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
      else if (peer.candidates.length < 64) peer.candidates.push(signal.candidate);
    }
  }

  private peerFailed(id: string, peer: PeerLink) {
    if (this.peers.get(id) !== peer || this.closed) return;
    this.sendSignal({ type: "link", to: id, ready: false });
    if (peer.retry || this.id > id) return;
    peer.retry = setTimeout(() => {
      peer.retry = undefined;
      if (this.peers.get(id) !== peer || this.closed || peer.pc.signalingState === "closed") return;
      peer.pc.restartIce();
      peer.queue = peer.queue
        .then(async () => {
          await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: true }));
          this.sendSignal({
            type: "signal",
            to: id,
            signal: { description: peer.pc.localDescription!.toJSON() },
          });
        })
        .catch(() => {});
    }, 5000);
  }

  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    clearTimeout(peer.retry);
    peer.pc.onconnectionstatechange = null;
    if (peer.channel) {
      peer.channel.onclose = null;
      peer.channel.close();
    }
    peer.pc.close();
  }
}
