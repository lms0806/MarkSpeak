import * as piper from "@mintplex-labs/piper-tts-web";

const VOICE_ID = "ko_KR-kss-medium";
const MODEL_PATH = "ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx";
const MIRROR = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main/";
const OFFICIAL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";

export const VOICE_LABEL = "Piper 한국어";

let prepared = false;
let threadLock = null;
let tail = Promise.resolve();
const cache = new Map();
const inflight = new Map();

function enqueue(task) {
  const run = tail.then(task, task);
  tail = run.then(
    () => {},
    () => {}
  );
  return run;
}

function prepare() {
  if (prepared) return;
  prepared = true;
  piper.PATH_MAP[VOICE_ID] = MODEL_PATH;

  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
    if (url.startsWith(MIRROR) && url.includes("ko_KR-kss-medium")) {
      const next = OFFICIAL + url.slice(MIRROR.length);
      if (input instanceof Request) return original(new Request(next, input), init);
      return original(next, init);
    }
    return original(input, init);
  };
}

async function lockThreads() {
  const ort = await import("onnxruntime-web/wasm");
  const wasm = ort.env && ort.env.wasm;
  if (!wasm) return;
  try {
    Object.defineProperty(wasm, "numThreads", {
      configurable: true,
      enumerable: true,
      get() {
        return 1;
      },
      set() {},
    });
  } catch (error) {
    wasm.numThreads = 1;
  }
}

export function synthesize(text, onProgress) {
  prepare();
  const spoken = String(text || "").trim();
  if (!spoken) return Promise.resolve(null);
  if (cache.has(spoken)) return Promise.resolve(cache.get(spoken));
  if (inflight.has(spoken)) return inflight.get(spoken);

  const job = enqueue(async () => {
    if (cache.has(spoken)) return cache.get(spoken);
    if (!threadLock) threadLock = lockThreads();
    await threadLock;
    const blob = await piper.predict({ text: spoken, voiceId: VOICE_ID }, onProgress);
    cache.set(spoken, blob);
    while (cache.size > 48) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    return blob;
  }).then((blob) => {
    inflight.delete(spoken);
    return blob;
  }, (error) => {
    inflight.delete(spoken);
    throw error;
  });

  inflight.set(spoken, job);
  return job;
}
