/*
 * A direct link made over a link that already works: the two pages trade their WebRTC offer
 * and answer through the relay, so no signalling server is needed. Two devices on one home
 * network find each other at once; through NATs it takes STUN, and when no way is found the
 * game simply stays on the relay.
 */

/** What one side tells the other to set the link up. */
export interface Signal {
  sdp: RTCSessionDescriptionInit;
}

export interface DirectHandlers {
  onOpen(): void;
  onData(d: unknown): void;
  /** The link failed to open or was lost. */
  onClose(): void;
}

export interface Direct {
  /** A signal from the other side. */
  take(s: Signal): void;
  send(msg: unknown): void;
  /** Bytes queued on the channel and not yet sent. */
  buffered(): number;
  close(): void;
}

/** Characters per data channel message: browsers differ in how big a message they take. */
const CHUNK = 16000;
/** How long the addresses are gathered before the offer or answer goes anyway. */
const GATHER_MS = 2500;
/** A link that hasn't opened by then won't. */
const OPEN_MS = 20000;

export function rtcAllowed(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && new URLSearchParams(location.search).get('rtc') !== 'off';
}

/** Starts a direct link; the side with `offer` makes the first move, the other answers it. */
export function directLink(iceServers: RTCIceServer[], offer: boolean, signal: (s: Signal) => void, h: DirectHandlers): Direct {
  let ended = false;
  const pc = new RTCPeerConnection({ iceServers });
  // Both sides make the same channel, so neither has to wait to be told of it.
  const dc = pc.createDataChannel('game', { negotiated: true, id: 0, ordered: true });
  let parts: string[] = [];
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    pc.close();
    h.onClose();
  };
  const timer = setTimeout(() => {
    if (dc.readyState !== 'open') end();
  }, OPEN_MS);
  dc.onopen = () => {
    clearTimeout(timer);
    if (!ended) h.onOpen();
  };
  dc.onclose = end;
  dc.onmessage = (e) => {
    if (ended || typeof e.data !== 'string') return;
    // Each part starts with '+', the last one with '.'.
    parts.push(e.data.slice(1));
    if (e.data[0] !== '.') return;
    const s = parts.join('');
    parts = [];
    let msg: unknown;
    try {
      msg = JSON.parse(s);
    } catch {
      return;
    }
    h.onData(msg);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end();
  };

  /** Sends the description once its addresses are in, or after a while with what there is. */
  const describe = async () => {
    await new Promise<void>((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, GATHER_MS);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState !== 'complete') return;
        clearTimeout(t);
        res();
      });
    });
    if (!ended && pc.localDescription) signal({ sdp: pc.localDescription.toJSON() });
  };
  if (offer) {
    pc.setLocalDescription()
      .then(describe)
      .catch(end);
  }

  return {
    take(s) {
      if (ended || !s.sdp) return;
      pc.setRemoteDescription(s.sdp)
        .then(async () => {
          if (s.sdp.type !== 'offer') return;
          await pc.setLocalDescription();
          await describe();
        })
        .catch(end);
    },
    send(msg) {
      if (ended || dc.readyState !== 'open') return;
      const s = JSON.stringify(msg);
      for (let i = 0; i < s.length || i === 0; i += CHUNK) dc.send((i + CHUNK >= s.length ? '.' : '+') + s.slice(i, i + CHUNK));
    },
    buffered() {
      return dc.readyState === 'open' ? dc.bufferedAmount : 0;
    },
    close() {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      pc.close();
    },
  };
}
