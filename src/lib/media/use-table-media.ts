"use client";

/**
 * Table voice/video via LiveKit. Opt-in: nothing connects (and no mic/camera
 * permission is requested) until the player taps "Join voice". Remote video
 * tracks are keyed by the seat token so the table view can drop each tile onto
 * the right seat (turning that player's avatar into a square video). Remote
 * audio is attached to hidden <audio> elements so players just hear each other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/auth/privy-token";
// Types only (erased at build) — the ~heavy runtime is dynamically imported in
// join() so it never lands in the table page's initial bundle.
import type {
  Room,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
} from "livekit-client";

export type MediaStatus = "off" | "connecting" | "on" | "error";

export interface TableMedia {
  status: MediaStatus;
  micOn: boolean;
  camOn: boolean;
  error: string | null;
  /** seatToken -> live video MediaStreamTrack (local + remote). */
  videoBySeat: Map<string, MediaStreamTrack>;
  join: () => void;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
}

/** Strip the "seat:" identity prefix the token route adds. */
function seatKey(identity: string): string {
  return identity.startsWith("seat:") ? identity.slice(5) : identity;
}

// Load the LiveKit client runtime on demand (once), so it stays out of the
// table page's initial bundle until someone joins voice.
let lkPromise: Promise<typeof import("livekit-client")> | null = null;
function loadLiveKit() {
  return (lkPromise ??= import("livekit-client"));
}

export function useTableMedia(opts: {
  tableId: string;
  /** This client's opaque seat token (state.playerToken); null until known. */
  seatToken: string | null;
  /** Gate the whole feature off when LiveKit isn't configured. */
  enabled: boolean;
}): TableMedia {
  const [status, setStatus] = useState<MediaStatus>("off");
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoBySeat, setVideoBySeat] = useState<Map<string, MediaStreamTrack>>(
    new Map(),
  );

  const roomRef = useRef<Room | null>(null);
  const lkRef = useRef<typeof import("livekit-client") | null>(null);
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map());

  const refreshVideo = useCallback(() => {
    const room = roomRef.current;
    const lk = lkRef.current;
    if (!room || !lk) return;
    const next = new Map<string, MediaStreamTrack>();
    // Local camera.
    const localCam = room.localParticipant
      .getTrackPublications()
      .find((p) => p.kind === lk.Track.Kind.Video && p.track);
    if (localCam?.track?.mediaStreamTrack) {
      next.set(seatKey(room.localParticipant.identity), localCam.track.mediaStreamTrack);
    }
    // Remote cameras.
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.getTrackPublications()) {
        if (pub.kind === lk.Track.Kind.Video && pub.track?.mediaStreamTrack) {
          next.set(seatKey(p.identity), pub.track.mediaStreamTrack);
        }
      }
    }
    setVideoBySeat(next);
  }, []);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    for (const el of audioEls.current.values()) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    audioEls.current.clear();
    if (room) void room.disconnect();
    setStatus("off");
    setMicOn(false);
    setCamOn(false);
    setVideoBySeat(new Map());
  }, []);

  const join = useCallback(async () => {
    if (!opts.enabled || roomRef.current) return;
    setStatus("connecting");
    setError(null);
    try {
      const res = await authedFetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: opts.tableId,
          ...(opts.seatToken ? { seatToken: opts.seatToken } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not join voice");

      const lk = await loadLiveKit();
      lkRef.current = lk;
      const { Room, RoomEvent, Track } = lk;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.style.display = "none";
            document.body.appendChild(el);
            audioEls.current.set(track.sid ?? Math.random().toString(36), el);
          }
          refreshVideo();
        })
        .on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
            track.detach().forEach((el) => {
              el.remove();
            });
            refreshVideo();
          },
        )
        .on(RoomEvent.LocalTrackPublished, refreshVideo)
        .on(RoomEvent.LocalTrackUnpublished, refreshVideo)
        .on(RoomEvent.ParticipantDisconnected, refreshVideo)
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current === room) leave();
        });

      await room.connect(json.url, json.token);
      setStatus("on");
      refreshVideo();
    } catch (e) {
      roomRef.current = null;
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not join voice");
    }
  }, [opts.enabled, opts.tableId, opts.seatToken, refreshVideo, leave]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone unavailable");
    }
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      refreshVideo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Camera unavailable");
    }
  }, [camOn, refreshVideo]);

  // Tear down on unmount / table change.
  useEffect(() => () => leave(), [leave, opts.tableId]);

  return { status, micOn, camOn, error, videoBySeat, join, leave, toggleMic, toggleCam };
}
