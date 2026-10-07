(function () {
  "use strict";

  var DRAFT_KEY = "markspeak.draft";
  var RATE_KEY = "markspeak.rate";
  var BREATH_KEY = "markspeak.breath";
  var VOICE_KEY = "markspeak.voice";

  var SAMPLE = [
    "# 조용한 서재",
    "",
    "창밖으로 비가 내리기 시작했다. 책장은 오래전부터 같은 자리에 있었고, 종이 냄새는 방 안을 천천히 채웠다.",
    "",
    "그는 *서두르지* 않았다. 문장이 끝나면 페이지 위에서 눈을 떼지 않은 채, 의미가 자리에 앉을 때까지 잠시 기다렸다.",
    "",
    "## 읽는 순서",
    "",
    "오늘은 아래 세 가지만 기억하면 된다.",
    "",
    "1. 마크다운을 왼쪽 원고에 붙여 넣는다.",
    "2. 아래의 읽기 버튼을 누른다.",
    "3. 듣고 싶은 문장을 클릭하면, 그 위치부터 다시 읽는다.",
    "",
    "> 좋은 낭독은 빠른 소리가 아니라, 의미가 도착할 시간을 남기는 일이다.",
    "",
    "본문의 **굵은 말**과 [표시된 이름](https://example.com)만 소리로 읽고, 주소는 읽지 않는다.",
    "",
    "```text",
    "이 블록은 화면에만 남고, 목소리로는 건너뜁니다.",
    "```",
    "",
    "창가에 앉아 빗물이 유리를 타고 내리는 모양을 바라보다가, 그는 접어 둔 모서리를 펴고, 어제 멈춘 문단을 처음부터 다시 읽기 시작했다.",
  ].join("\n");

  var source = document.getElementById("source");
  var book = document.getElementById("book");
  var bookScroll = document.getElementById("book-scroll");
  var editorPane = document.getElementById("editor-pane");
  var meta = document.getElementById("meta");
  var playButton = document.getElementById("play");
  var pauseHint = document.getElementById("status");
  var statusDot = document.getElementById("status-dot");
  var seek = document.getElementById("seek");
  var seekLabel = document.getElementById("seek-label");
  var rateInput = document.getElementById("rate");
  var rateLabel = document.getElementById("rate-label");
  var breathInput = document.getElementById("breath");
  var voiceInput = document.getElementById("voice");
  var voiceNote = document.getElementById("voice-note");
  var fileInput = document.getElementById("file");
  var prevButton = document.getElementById("prev");
  var nextButton = document.getElementById("next");
  var repeatButton = document.getElementById("repeat");
  var stopButton = document.getElementById("stop");

  var renderedText = null;
  var renderTimer = null;
  var seeking = false;
  var lastCues = [];
  var currentEl = null;
  var voices = [];

  function emptyHtml() {
    return '<div class="empty"><p>왼쪽 원고에 마크다운을 넣으면<br>이곳에 책처럼 펼쳐집니다.</p></div>';
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* 저장 공간이 가득 차도 읽기는 계속된다. */
    }
  }

  function formatDuration(ms) {
    var sec = Math.max(1, Math.round(ms / 1000));
    if (sec < 60) return "약 " + sec + "초";
    var min = Math.max(1, Math.round(sec / 60));
    return "약 " + min + "분";
  }

  function estimateMs(cues) {
    var rate = reader.getRate();
    var scale = reader.getPauseScale();
    var chars = 0;
    var pauses = 0;
    cues.forEach(function (cue) {
      chars += cue.text.length;
      pauses += cue.pauseAfter * scale;
    });
    return (chars / (6.2 * rate)) * 1000 + pauses;
  }

  function updateMeta() {
    if (!lastCues.length) {
      meta.textContent = "읽을 문장 없음";
      return;
    }
    meta.textContent = lastCues.length + "구간 · " + formatDuration(estimateMs(lastCues));
  }

  function reveal(el) {
    var paneRect = bookScroll.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    if (elRect.top >= paneRect.top + 28 && elRect.bottom <= paneRect.bottom - 28) return;
    var delta = elRect.top - paneRect.top - paneRect.height / 2 + elRect.height / 2;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bookScroll.scrollTo({
      top: bookScroll.scrollTop + delta,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  function highlight(id) {
    if (currentEl) currentEl.classList.remove("is-current");
    currentEl = null;
    if (!id) return;
    var safeId = window.CSS && CSS.escape ? CSS.escape(id) : id;
    var el = book.querySelector('.cue[data-id="' + safeId + '"]');
    if (!el) return;
    el.classList.add("is-current");
    currentEl = el;
    reveal(el);
  }

  function describe(snapshot) {
    if (snapshot.state === "unsupported") return "이 브라우저는 음성 읽기를 지원하지 않습니다.";
    if (snapshot.state === "blocked") return "브라우저가 음성 재생을 막았습니다. 읽기 버튼을 다시 눌러 주세요.";
    if (snapshot.state === "empty" || snapshot.total === 0) return "읽을 문장이 없습니다. 본문, 제목, 인용, 목록을 입력해 주세요.";
    if (snapshot.state === "playing") return "읽는 중 · " + (snapshot.index + 1) + " / " + snapshot.total;
    if (snapshot.state === "paused") return "일시정지 · " + (snapshot.index + 1) + " / " + snapshot.total;
    if (snapshot.state === "done") return "끝까지 읽었습니다.";
    return "준비됨 · " + snapshot.total + "구간";
  }

  function updateTransport(snapshot) {
    var total = snapshot.total || 0;
    var index = snapshot.index || 0;
    var mode = snapshot.state;

    playButton.textContent = mode === "playing" ? "일시정지" : mode === "paused" ? "이어 읽기" : "읽기";
    playButton.setAttribute("aria-pressed", mode === "playing" ? "true" : "false");
    playButton.disabled = mode === "unsupported";
    statusDot.hidden = mode !== "playing";
    pauseHint.textContent = describe(snapshot);

    var max = Math.max(total - 1, 0);
    seek.max = String(max);
    seek.disabled = total === 0;
    if (!seeking) seek.value = String(Math.min(index, max));
    if (total === 0) seekLabel.textContent = "0 / 0";
    else if (mode === "done") seekLabel.textContent = total + " / " + total;
    else seekLabel.textContent = index + 1 + " / " + total;

    var idleEdge = mode !== "playing" && mode !== "paused";
    prevButton.disabled = total === 0 || index <= 0;
    nextButton.disabled = total === 0 || index >= total - 1;
    repeatButton.disabled = total === 0;
    stopButton.disabled = idleEdge && mode !== "done" ? mode === "idle" || mode === "empty" || mode === "unsupported" || mode === "blocked" : false;
    if (mode === "idle" || mode === "empty" || mode === "unsupported" || mode === "blocked") stopButton.disabled = true;
    if (mode === "playing" || mode === "paused") stopButton.disabled = false;
  }

  var reader = MarkSpeakReader.create({
    onHighlight: highlight,
    onState: updateTransport,
  });

  function saveDraft(value) {
    storageSet(DRAFT_KEY, value);
  }

  function flushRender() {
    clearTimeout(renderTimer);
    var value = source.value;
    if (value === renderedText) return;
    renderedText = value;
    var parsed = MarkSpeakMarkdown.parse(value);
    lastCues = parsed.cues;
    book.innerHTML = parsed.html.trim() ? parsed.html : emptyHtml();
    book.classList.toggle("is-empty", !parsed.html.trim());
    reader.setCues(parsed.cues);
    saveDraft(value);
    updateMeta();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(flushRender, 80);
  }

  function togglePlay() {
    flushRender();
    var mode = reader.getState();
    if (mode === "playing") reader.pause();
    else if (mode === "paused") reader.resume();
    else reader.play();
  }

  function rankVoice(voice) {
    var ko = /^ko([-_]|$)/i.test(voice.lang) || /korean|한국어/i.test(voice.name);
    if (!ko) return 0;
    var score = 10 + (voice.localService ? 2 : 0);
    if (/Natural|Neural|Premium|Online/i.test(voice.name)) score += 6;
    if (/SunHi|InJoon|Hyunsu|Heami/i.test(voice.name)) score += 3;
    return score;
  }

  function selectedVoice() {
    var name = voiceInput.value;
    if (!name) return null;
    for (var i = 0; i < voices.length; i += 1) {
      if (voices[i].name === name) return voices[i];
    }
    return null;
  }

  function fillVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    var saved = storageGet(VOICE_KEY);
    var sorted = voices.slice().sort(function (a, b) {
      return rankVoice(b) - rankVoice(a) || a.name.localeCompare(b.name, "ko");
    });
    var options = '<option value="">브라우저 기본값</option>';
    sorted.forEach(function (voice) {
      options +=
        '<option value="' +
        escapeOption(voice.name) +
        '">' +
        escapeOption(voice.name + " · " + voice.lang) +
        "</option>";
    });
    voiceInput.innerHTML = options;
    var preferred = sorted.filter(function (voice) {
      return rankVoice(voice) > 0;
    })[0];
    var initial = saved && sorted.some(function (voice) { return voice.name === saved; })
      ? saved
      : preferred
        ? preferred.name
        : "";
    voiceInput.value = initial;
    reader.setVoice(selectedVoice());
    var hasKorean = sorted.some(function (voice) {
      return rankVoice(voice) > 0;
    });
    voiceNote.hidden = hasKorean || !voices.length;
  }

  function escapeOption(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 1000000) {
      pauseHint.textContent = "1MB보다 작은 텍스트 파일만 열 수 있습니다.";
      return;
    }
    if (file.type && !/text|markdown|json|xml/.test(file.type) && !/\.(md|markdown|txt|text)$/i.test(file.name)) {
      pauseHint.textContent = "텍스트 파일만 열 수 있습니다.";
      return;
    }
    var loader = new FileReader();
    loader.onload = function () {
      source.value = String(loader.result || "");
      renderedText = null;
      flushRender();
      bookScroll.scrollTop = 0;
    };
    loader.readAsText(file, "utf-8");
  }

  function restore() {
    var draft = storageGet(DRAFT_KEY);
    source.value = draft === null ? SAMPLE : draft;
    var rate = storageGet(RATE_KEY);
    if (rate) {
      rateInput.value = rate;
      reader.setRate(rate);
    }
    rateLabel.textContent = Number(rateInput.value).toFixed(2) + "배";
    var breath = storageGet(BREATH_KEY);
    if (breath && breathInput.querySelector('option[value="' + breath + '"]')) {
      breathInput.value = breath;
      reader.setPauseScale(breath);
    }
  }

  playButton.addEventListener("click", togglePlay);
  prevButton.addEventListener("click", function () {
    reader.prev();
  });
  nextButton.addEventListener("click", function () {
    reader.next();
  });
  repeatButton.addEventListener("click", function () {
    reader.repeat();
  });
  stopButton.addEventListener("click", function () {
    reader.stop();
  });

  source.addEventListener("input", function () {
    var mode = reader.getState();
    if (mode === "playing" || mode === "paused") reader.stop();
    scheduleRender();
  });

  document.getElementById("open-file").addEventListener("click", function () {
    fileInput.click();
  });
  document.getElementById("load-sample").addEventListener("click", function () {
    source.value = SAMPLE;
    renderedText = null;
    flushRender();
    bookScroll.scrollTop = 0;
  });
  fileInput.addEventListener("change", function () {
    readFile(fileInput.files && fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (name) {
    editorPane.addEventListener(name, function (event) {
      event.preventDefault();
      editorPane.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (name) {
    editorPane.addEventListener(name, function (event) {
      event.preventDefault();
      if (name === "dragleave" && editorPane.contains(event.relatedTarget)) return;
      editorPane.classList.remove("is-dragover");
    });
  });
  editorPane.addEventListener("drop", function (event) {
    event.preventDefault();
    editorPane.classList.remove("is-dragover");
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    readFile(file);
  });

  book.addEventListener("click", function (event) {
    if (event.target.closest("a")) return;
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed && book.contains(selection.anchorNode)) return;

    var cue = event.target.closest(".cue");
    if (!cue && document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(event.clientX, event.clientY);
      var node = range && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
      if (node && book.contains(node)) cue = node.closest(".cue");
    }
    if (!cue) {
      var block = event.target.closest("p, li, h1, h2, h3, h4, h5, h6, td, th");
      if (block) cue = block.querySelector(".cue");
    }
    if (!cue) return;
    reader.seekId(cue.getAttribute("data-id"), true);
  });

  seek.addEventListener("input", function () {
    seeking = true;
    var total = reader.getLength();
    seekLabel.textContent = total ? Number(seek.value) + 1 + " / " + total : "0 / 0";
  });
  seek.addEventListener("change", function () {
    seeking = false;
    var mode = reader.getState();
    reader.seek(Number(seek.value), mode === "playing" || mode === "paused");
  });

  rateInput.addEventListener("input", function () {
    reader.setRate(rateInput.value);
    rateLabel.textContent = Number(rateInput.value).toFixed(2) + "배";
    storageSet(RATE_KEY, rateInput.value);
    updateMeta();
  });
  breathInput.addEventListener("change", function () {
    reader.setPauseScale(breathInput.value);
    storageSet(BREATH_KEY, breathInput.value);
    updateMeta();
  });
  voiceInput.addEventListener("change", function () {
    reader.setVoice(selectedVoice());
    storageSet(VOICE_KEY, voiceInput.value);
  });

  document.addEventListener("keydown", function (event) {
    var tag = document.activeElement && document.activeElement.tagName;
    var typing = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (typing) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "Escape") {
      reader.stop();
    }
  });

  window.addEventListener("pagehide", function () {
    saveDraft(source.value);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", fillVoices);
    fillVoices();
  } else {
    voiceNote.hidden = false;
    voiceNote.textContent = "이 브라우저는 음성 읽기를 지원하지 않습니다.";
  }

  restore();
  flushRender();
})();
