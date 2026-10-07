/**
 * 낭독 큐를 한 구간씩 읽는다.
 * 브라우저 음성은 한 번에 길게 말하면 중간에 끊기므로 문장 단위로 나누고,
 * 그 사이에 쉼을 넣어 책을 읽듯 호흡을 만든다.
 * 재생은 사용자 클릭 안에서 바로 시작해야 브라우저가 막지 않는다.
 */
(function () {
  "use strict";

  function create(options) {
    var onState = options.onState;
    var onHighlight = options.onHighlight;
    var cues = [];
    var index = 0;
    var state = "idle";
    var generation = 0;
    var voice = null;
    var rate = 0.9;
    var pauseScale = 1;
    var timer = null;
    var watch = null;

    function emit(extra) {
      onState({
        state: extra && extra.state ? extra.state : state,
        index: extra && typeof extra.index === "number" ? extra.index : index,
        total: cues.length,
        cue: cues[index] || null,
      });
    }

    function clearTimers() {
      clearTimeout(timer);
      clearTimeout(watch);
      timer = null;
      watch = null;
    }

    function haltSpeech() {
      generation += 1;
      clearTimers();
      var synth = window.speechSynthesis;
      if (!synth) return false;
      var active = Boolean(synth.speaking || synth.pending || synth.paused);
      if (active) synth.cancel();
      return active;
    }

    function highlightAt(cue) {
      if (!cue) {
        onHighlight(null);
        return;
      }
      onHighlight(cue.spanId || cue.id);
    }

    function unsupported() {
      state = "unsupported";
      emit();
    }

    function finish() {
      generation += 1;
      clearTimers();
      state = "idle";
      var total = cues.length;
      index = 0;
      onHighlight(null);
      onState({ state: "done", index: Math.max(total - 1, 0), total: total, cue: null });
    }

    function speak(afterCancel) {
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
        unsupported();
        return;
      }

      var cue = cues[index];
      if (!cue) {
        finish();
        return;
      }

      var gen = (generation += 1);
      clearTimers();
      state = "playing";
      highlightAt(cue);
      emit();

      var started = false;
      var ended = false;

      function buildUtterance() {
        var utter = new SpeechSynthesisUtterance(cue.text);
        utter.rate = rate;
        utter.pitch = 1;
        utter.volume = 1;
        utter.lang = voice && voice.lang ? voice.lang : "ko-KR";
        if (voice) utter.voice = voice;
        utter.onstart = function () {
          started = true;
        };
        utter.onend = function () {
          goNext();
        };
        utter.onerror = function (event) {
          if (gen !== generation || ended) return;
          var reason = event && event.error ? event.error : "";
          if (reason === "interrupted" || reason === "canceled" || reason === "cancelled") return;
          if (reason === "not-allowed") {
            state = "idle";
            emit({ state: "blocked" });
            return;
          }
          goNext();
        };
        return utter;
      }

      function goNext() {
        if (gen !== generation || ended) return;
        ended = true;
        clearTimeout(watch);
        var wait = Math.max(0, Math.round((cue.pauseAfter || 0) * pauseScale));
        timer = setTimeout(function () {
          if (gen !== generation) return;
          if (index >= cues.length - 1) {
            finish();
            return;
          }
          index += 1;
          speak(false);
        }, wait);
      }

      function armWatch(delay, onSilent) {
        var synth = window.speechSynthesis;
        watch = setTimeout(function () {
          if (gen !== generation || ended) return;
          if (!started && !(synth.speaking || synth.pending)) onSilent();
        }, delay);
      }

      function start() {
        if (gen !== generation) return;
        var synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        synth.speak(buildUtterance());
        armWatch(350, function () {
          if (gen !== generation || ended || started) return;
          synth.resume();
          synth.speak(buildUtterance());
          armWatch(800, function () {
            if (gen !== generation || ended || started) return;
            goNext();
          });
        });
        var limit = Math.min(20000, Math.max(5000, (cue.text.length / Math.max(rate, 0.5)) * 320 + 2500));
        setTimeout(function () {
          if (gen !== generation || ended) return;
          if (started && synth.speaking) {
            synth.cancel();
            goNext();
          }
        }, limit);
      }

      if (afterCancel) timer = setTimeout(start, 120);
      else start();
    }

    function play() {
      if (!cues.length) {
        emit({ state: "empty" });
        return;
      }
      if (state === "paused") {
        resume();
        return;
      }
      if (state === "playing") return;
      if (index >= cues.length) index = 0;
      speak(false);
    }

    function pause() {
      if (state !== "playing") return;
      state = "paused";
      haltSpeech();
      emit();
    }

    function resume() {
      if (!cues.length) {
        emit({ state: "empty" });
        return;
      }
      if (state === "playing") return;
      speak(false);
    }

    function stop() {
      haltSpeech();
      state = "idle";
      index = 0;
      onHighlight(null);
      emit();
    }

    function seek(nextIndex, autoplay) {
      if (!cues.length) {
        emit({ state: "empty" });
        return;
      }
      var interrupted = haltSpeech();
      index = Math.max(0, Math.min(cues.length - 1, nextIndex | 0));
      if (autoplay) {
        speak(interrupted);
        return;
      }
      state = "idle";
      highlightAt(cues[index]);
      emit();
    }

    function seekId(id, autoplay) {
      var found = -1;
      for (var i = 0; i < cues.length; i += 1) {
        if (cues[i].id === id || cues[i].spanId === id) {
          found = i;
          break;
        }
      }
      if (found === -1) return;
      seek(found, autoplay);
    }

    return {
      setCues: function (next) {
        haltSpeech();
        cues = Array.isArray(next) ? next.slice() : [];
        index = 0;
        state = "idle";
        onHighlight(null);
        emit();
      },
      play: play,
      pause: pause,
      resume: resume,
      stop: stop,
      seek: seek,
      seekId: seekId,
      repeat: function () {
        if (!cues.length) {
          emit({ state: "empty" });
          return;
        }
        seek(index, true);
      },
      next: function () {
        if (index >= cues.length - 1) return;
        seek(index + 1, state === "playing" || state === "paused");
      },
      prev: function () {
        seek(Math.max(0, index - 1), state === "playing" || state === "paused");
      },
      setRate: function (next) {
        var value = Number(next);
        rate = Number.isFinite(value) ? Math.min(1.3, Math.max(0.6, value)) : 0.9;
        if (state === "playing") {
          var interrupted = haltSpeech();
          speak(interrupted);
        }
      },
      setVoice: function (next) {
        voice = next || null;
        if (state === "playing") {
          var interrupted = haltSpeech();
          speak(interrupted);
        }
      },
      setPauseScale: function (next) {
        var value = Number(next);
        pauseScale = Number.isFinite(value) ? value : 1;
      },
      getRate: function () {
        return rate;
      },
      getPauseScale: function () {
        return pauseScale;
      },
      getState: function () {
        return state;
      },
      getIndex: function () {
        return index;
      },
      getLength: function () {
        return cues.length;
      },
    };
  }

  globalThis.MarkSpeakReader = { create: create };
})();
