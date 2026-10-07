let context = null;
let active = null;

export function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!context) context = new AudioCtx();
  if (context.state === "suspended") context.resume();
  return context;
}

function consumed(ctx, state) {
  return state.markOffset + Math.max(0, ctx.currentTime - state.markTime) * state.markRate;
}

export function playBuffer(buffer, { rate, offset }) {
  const ctx = unlockAudio();
  if (!ctx) return Promise.reject(new Error("unsupported"));

  if (active) active.halt();

  const startOffset = Math.min(Math.max(offset || 0, 0), Math.max(buffer.duration - 0.03, 0));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(ctx.destination);

  const state = {
    markTime: ctx.currentTime,
    markOffset: startOffset,
    markRate: rate,
    source,
    settled: false,
  };

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  function finish(reason) {
    if (state.settled) return;
    state.settled = true;
    if (active && active.source === source) active = null;
    resolveDone({
      reason,
      offset: reason === "ended" ? buffer.duration : consumed(ctx, state),
    });
  }

  const handle = {
    source,
    done,
    setRate(next) {
      if (state.settled) return;
      state.markOffset = consumed(ctx, state);
      state.markTime = ctx.currentTime;
      state.markRate = next;
      source.playbackRate.value = next;
    },
    halt() {
      if (state.settled) return consumed(ctx, state);
      const offsetNow = consumed(ctx, state);
      try {
        source.stop();
      } catch (error) {
        /* 이미 끝난 재생은 멈출 필요가 없다. */
      }
      finish("stopped");
      return offsetNow;
    },
  };

  source.onended = () => finish("ended");
  active = handle;
  source.start(0, startOffset);
  return handle;
}

export function setLiveRate(rate) {
  if (active) active.setRate(rate);
}

export function haltPlayback() {
  if (!active) return 0;
  return active.halt(true);
}
