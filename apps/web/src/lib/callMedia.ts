import { Room } from "livekit-client";

export type CallMedia = {
  audio: MediaStreamTrack;
  video?: MediaStreamTrack;
};

const audioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// 720p opens the camera sooner than 1080p. The sensor can still go higher when that mode is the closest one.
const videoConstraints: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

export function stopCallMedia(media: CallMedia | null | undefined) {
  media?.audio.stop();
  media?.video?.stop();
}

export function requestUserMedia(constraints: MediaStreamConstraints, code: "mic" | "camera") {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error(code));
  }
  const pending = navigator.mediaDevices.getUserMedia(constraints);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<MediaStream>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), 20000);
  });
  return Promise.race([pending, timed]).then(
    (stream) => {
      if (timer) clearTimeout(timer);
      return stream;
    },
    (err: unknown) => {
      if (timer) clearTimeout(timer);
      void pending.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
      if (err instanceof Error && (err.message === "mic" || err.message === "camera")) throw err;
      throw new Error(code);
    },
  );
}

export async function captureAudio() {
  const stream = await requestUserMedia({ audio: audioConstraints, video: false }, "mic");
  const audio = stream.getAudioTracks()[0];
  if (!audio) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("mic");
  }
  return audio;
}

export async function captureVideo() {
  const stream = await requestUserMedia({ audio: false, video: videoConstraints }, "camera");
  const video = stream.getVideoTracks()[0];
  if (!video) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("camera");
  }
  return video;
}

// One device open is faster than opening the mic and then the camera.
export async function captureCall(kind: "audio" | "video"): Promise<CallMedia> {
  if (kind !== "video") return { audio: await captureAudio() };
  try {
    const stream = await requestUserMedia({ audio: audioConstraints, video: videoConstraints }, "camera");
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    if (!audio || !video) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(audio ? "camera" : "mic");
    }
    return { audio, video };
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "camera") throw err;
    const audio = await captureAudio();
    try {
      return { audio, video: await captureVideo() };
    } catch (videoErr) {
      audio.stop();
      throw videoErr;
    }
  }
}

const permKey = { mic: "salam.perm.mic", camera: "salam.perm.camera" };

export function mediaRemembered(kind: "mic" | "camera") {
  try {
    return localStorage.getItem(permKey[kind]) === "1";
  } catch {
    return false;
  }
}

export function rememberMedia(kind: "mic" | "camera") {
  try {
    localStorage.setItem(permKey[kind], "1");
  } catch {
    /* private mode */
  }
}

export function forgetMedia(kind: "mic" | "camera") {
  try {
    localStorage.removeItem(permKey[kind]);
  } catch {
    /* ignore */
  }
}

export function warmCallConnection(url: string, token: string) {
  if (!url || token.startsWith("stub-")) return Promise.resolve();
  return new Room().prepareConnection(url, token);
}
