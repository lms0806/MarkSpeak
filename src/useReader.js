import { useCallback, useRef, useState } from "react";
import { haltPlayback, playBuffer, setLiveRate, unlockAudio } from "./playback.js";
import { synthesize } from "./tts.js";

const MODEL_BYTES = 63221984;
const BREATHS = [0.7, 1, 1.5];

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function initialRate() {
  const raw = storageGet("markspeak.rate");
  const value = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(value)) return 0.9;
  return Math.min(1.3, Math.max(0.6, value));
}

function initialBreath() {
  const value = Number(storageGet("markspeak.breath"));
  return BREATHS.includes(value) ? value : 1;
}

function explain(error) {
  const message = String((error && error.message) || error || "");
  if (/fetch|network|Failed to fetch|NetworkError/i.test(message)) {
    return "음성 모델을 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
  }
  if (message === "unsupported") return "이 브라우저는 음성 재생을 지원하지 않습니다.";
  return "목소리를 만들지 못했습니다. 다시 눌러 주세요.";
}

function readProgress(progress) {
  if (!progress) return { percent: null, label: "목소리를 준비하는 중" };
  const url = progress.url || "";
  if (url === "tts://inference-progress") {
    return { percent: null, label: "문장을 소리로 만드는 중" };
  }
  const total = progress.total || (String(url).includes(".onnx") ? MODEL_BYTES : 0);
  if (!total) return { percent: null, label: "목소리를 준비하는 중" };
  const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / total) * 100)));
  const label = String(url).includes(".onnx")
    ? "음성 모델을 받는 중 " + percent + "%"
    : "목소리를 준비하는 중 " + percent + "%";
  return { percent, label };
}

export function useReader() {
  const bag = useRef(null);
  if (!bag.current) {
    bag.current = {
      gen: 0,
      busy: false,
      pendingStart: false,
      state: "idle",
      cues: [],
      index: 0,
      offset: 0,
      rate: initialRate(),
      breath: initialBreath(),
      preparing: false,
      progress: null,
      error: "",
      playback: null,
      cancelWait: null,
      buffers: new Map(),
      lastProgressAt: 0,
    };
  }

  const [snapshot, setSnapshot] = useState(() => ({
    state: "idle",
    index: 0,
    total: 0,
    spanId: null,
    preparing: false,
    progress: null,
    error: "",
    rate: bag.current.rate,
    breath: bag.current.breath,
  }));

  const publish = useCallback(() => {
    const current = bag.current;
    const cue = current.cues[current.index];
    const showMark = current.state === "playing" || current.state === "paused";
    setSnapshot({
      state: current.state,
      index: current.index,
      total: current.cues.length,
      spanId: showMark && cue ? cue.spanId : null,
      preparing: current.preparing,
      progress: current.progress,
      error: current.error,
      rate: current.rate,
      breath: current.breath,
    });
  }, []);

  const wait = useCallback((ms) => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        bag.current.cancelWait = null;
        resolve("done");
      }, ms);
      bag.current.cancelWait = () => {
        clearTimeout(timer);
        bag.current.cancelWait = null;
        resolve("cancelled");
      };
    });
  }, []);

  const bufferFor = useCallback(async (text, onProgress) => {
    const current = bag.current;
    if (current.buffers.has(text)) return current.buffers.get(text);
    const blob = await synthesize(text, onProgress);
    const ctx = unlockAudio();
    if (!ctx) throw new Error("unsupported");
    const audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    current.buffers.set(text, audioBuffer);
    while (current.buffers.size > 40) {
      const first = current.buffers.keys().next().value;
      current.buffers.delete(first);
    }
    return audioBuffer;
  }, []);

  const run = useCallback(async () => {
    const current = bag.current;
    if (current.busy) {
      current.pendingStart = true;
      return;
    }
    current.busy = true;
    const gen = current.gen;
    try {
      while (current.state === "playing" && gen === current.gen) {
        const cue = current.cues[current.index];
        if (!cue) {
          current.state = current.cues.length ? "done" : "empty";
          current.preparing = false;
          publish();
          return;
        }
        publish();
        const cached = current.buffers.has(cue.text);
        current.preparing = !cached;
        current.progress = cached ? null : { percent: null, label: "목소리를 준비하는 중" };
        if (!cached) publish();

        const buffer = await bufferFor(cue.text, (progress) => {
          if (gen !== bag.current.gen || bag.current.state !== "playing") return;
          const now = performance.now();
          if (now - bag.current.lastProgressAt < 120) return;
          bag.current.lastProgressAt = now;
          bag.current.preparing = true;
          bag.current.progress = readProgress(progress);
          publish();
        });

        if (gen !== current.gen || current.state !== "playing") return;
        current.preparing = false;
        current.progress = null;
        publish();

        const next = current.cues[current.index + 1];
        if (next && !current.buffers.has(next.text)) {
          bufferFor(next.text).catch(() => {});
        }

        const handle = playBuffer(buffer, { rate: current.rate, offset: current.offset });
        current.playback = handle;
        const result = await handle.done;
        if (current.playback === handle) current.playback = null;
        if (gen !== current.gen) return;
        if (current.state !== "playing") {
          if (result.reason === "stopped") current.offset = result.offset;
          return;
        }
        current.offset = 0;
        const gap = await wait(cue.pauseAfter * current.breath);
        if (gen !== current.gen) return;
        if (gap === "cancelled" || current.state !== "playing") {
          if (current.state === "paused") {
            current.index += 1;
            if (current.index >= current.cues.length) {
              current.state = "done";
              current.index = Math.max(current.cues.length - 1, 0);
            }
            publish();
          }
          return;
        }
        current.index += 1;
        if (current.index >= current.cues.length) {
          current.state = "done";
          current.index = Math.max(current.cues.length - 1, 0);
          publish();
          return;
        }
      }
    } catch (error) {
      console.error(error);
      if (gen === bag.current.gen) {
        bag.current.state = "error";
        bag.current.preparing = false;
        bag.current.progress = null;
        bag.current.error = explain(error);
        publish();
      }
    } finally {
      current.busy = false;
      if (current.pendingStart && current.state === "playing") {
        current.pendingStart = false;
        void run();
      } else {
        current.pendingStart = false;
      }
    }
  }, [bufferFor, publish, wait]);

  const seek = useCallback((index, autoplay) => {
    const current = bag.current;
    if (!current.cues.length) return;
    const nextIndex = Math.min(Math.max(index, 0), current.cues.length - 1);
    current.gen += 1;
    if (current.playback) {
      current.playback.halt();
      current.playback = null;
    } else {
      haltPlayback();
    }
    if (current.cancelWait) current.cancelWait();
    current.index = nextIndex;
    current.offset = 0;
    current.error = "";
    current.preparing = false;
    current.progress = null;
    current.state = autoplay ? "playing" : "idle";
    publish();
    if (autoplay) {
      if (current.busy) current.pendingStart = true;
      else void run();
    }
  }, [publish, run]);

  const play = useCallback(() => {
    const current = bag.current;
    unlockAudio();
    if (!current.cues.length) {
      current.state = "empty";
      current.error = "";
      publish();
      return;
    }
    if (current.state === "playing") return;
    if (current.state === "done") {
      current.index = 0;
      current.offset = 0;
    }
    current.error = "";
    current.state = "playing";
    publish();
    void run();
  }, [publish, run]);

  const pause = useCallback(() => {
    const current = bag.current;
    if (current.state !== "playing") return;
    const duringGap = !current.playback && current.cancelWait;
    current.gen += 1;
    if (current.playback) {
      current.offset = current.playback.halt();
      current.playback = null;
    } else if (duringGap) {
      current.offset = 0;
      current.index += 1;
      if (current.index >= current.cues.length) {
        current.state = "done";
        current.index = Math.max(current.cues.length - 1, 0);
        current.preparing = false;
        if (current.cancelWait) current.cancelWait();
        publish();
        return;
      }
    }
    current.state = "paused";
    current.preparing = false;
    current.progress = null;
    if (current.cancelWait) current.cancelWait();
    publish();
  }, [publish]);

  const stop = useCallback(() => {
    const current = bag.current;
    current.gen += 1;
    current.pendingStart = false;
    current.state = current.cues.length ? "idle" : "empty";
    current.index = 0;
    current.offset = 0;
    current.error = "";
    current.preparing = false;
    current.progress = null;
    if (current.playback) {
      current.playback.halt();
      current.playback = null;
    } else {
      haltPlayback();
    }
    if (current.cancelWait) current.cancelWait();
    publish();
  }, [publish]);

  const setCues = useCallback((next) => {
    const current = bag.current;
    const cues = next || [];
    const same =
      cues.length === current.cues.length &&
      cues.every((cue, index) => cue.id === current.cues[index].id && cue.text === current.cues[index].text);
    current.cues = cues;
    if (!same) {
      current.gen += 1;
      current.pendingStart = false;
      current.index = 0;
      current.offset = 0;
      current.preparing = false;
      current.progress = null;
      current.error = "";
      current.state = cues.length ? "idle" : "empty";
      if (current.playback) {
        current.playback.halt();
        current.playback = null;
      } else {
        haltPlayback();
      }
      if (current.cancelWait) current.cancelWait();
    }
    publish();
  }, [publish]);

  const setRate = useCallback((value) => {
    const rate = Math.min(1.3, Math.max(0.6, Number(value) || 0.9));
    bag.current.rate = rate;
    if (bag.current.playback) bag.current.playback.setRate(rate);
    else setLiveRate(rate);
    publish();
  }, [publish]);

  const setBreath = useCallback((value) => {
    const breath = Number(value);
    bag.current.breath = BREATHS.includes(breath) ? breath : 1;
    publish();
  }, [publish]);

  const repeat = useCallback(() => {
    if (!bag.current.cues.length) return;
    seek(bag.current.index, true);
  }, [seek]);

  const prev = useCallback(() => {
    const current = bag.current;
    const autoplay = current.state === "playing" || current.state === "paused";
    seek(current.index - 1, autoplay);
  }, [seek]);

  const next = useCallback(() => {
    const current = bag.current;
    const autoplay = current.state === "playing" || current.state === "paused";
    seek(current.index + 1, autoplay);
  }, [seek]);

  const seekId = useCallback((id, autoplay) => {
    const index = bag.current.cues.findIndex((cue) => cue.spanId === id || cue.id === id);
    if (index < 0) return;
    seek(index, autoplay);
  }, [seek]);

  return {
    snapshot,
    play,
    pause,
    stop,
    repeat,
    prev,
    next,
    seek,
    seekId,
    setCues,
    setRate,
    setBreath,
  };
}
