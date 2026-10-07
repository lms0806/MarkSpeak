import { useEffect, useRef, useState } from "react";
import { parse } from "./markdown.js";
import { SAMPLE } from "./sample.js";
import { VOICE_LABEL } from "./tts.js";
import { useReader } from "./useReader.js";

const DRAFT_KEY = "markspeak.draft";
const RATE_KEY = "markspeak.rate";
const BREATH_KEY = "markspeak.breath";
const EMPTY_HTML =
  '<div class="empty"><p>왼쪽 원고에 마크다운을 넣으면<br>이곳에 책처럼 펼쳐집니다.</p></div>';

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
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return "약 " + sec + "초";
  const min = Math.max(1, Math.round(sec / 60));
  return "약 " + min + "분";
}

function estimateMs(cues, rate, breath) {
  let chars = 0;
  let pauses = 0;
  cues.forEach((cue) => {
    chars += cue.text.length;
    pauses += cue.pauseAfter * breath;
  });
  return (chars / (6.2 * rate)) * 1000 + pauses;
}

function readInitialSource() {
  const draft = storageGet(DRAFT_KEY);
  return draft === null ? SAMPLE : draft;
}

function renderSource(value) {
  const parsed = parse(value);
  const hasBook = Boolean(parsed.html.trim());
  return {
    html: hasBook ? parsed.html : EMPTY_HTML,
    empty: !hasBook,
    cues: parsed.cues,
  };
}

function describe(snapshot) {
  if (snapshot.preparing && snapshot.progress) return snapshot.progress.label;
  if (snapshot.state === "error") return snapshot.error;
  if (snapshot.state === "empty" || snapshot.total === 0) {
    return "읽을 문장이 없습니다. 본문, 제목, 인용, 목록을 입력해 주세요.";
  }
  if (snapshot.state === "playing") return "읽는 중 · " + (snapshot.index + 1) + " / " + snapshot.total;
  if (snapshot.state === "paused") return "일시정지 · " + (snapshot.index + 1) + " / " + snapshot.total;
  if (snapshot.state === "done") return "끝까지 읽었습니다.";
  return "준비됨 · " + snapshot.total + "구간";
}

export default function App() {
  const reader = useReader();
  const { snapshot } = reader;
  const bookRef = useRef(null);
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const sourceRef = useRef("");
  const [source, setSource] = useState(readInitialSource);
  const [html, setHtml] = useState(() => renderSource(readInitialSource()).html);
  const [empty, setEmpty] = useState(() => renderSource(readInitialSource()).empty);
  const [cues, setCues] = useState(() => renderSource(readInitialSource()).cues);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [fileNote, setFileNote] = useState("");

  const firstRender = useRef(true);

  useEffect(() => {
    sourceRef.current = source;
    const apply = () => {
      const next = renderSource(source);
      setHtml(next.html);
      setEmpty(next.empty);
      setCues(next.cues);
      reader.setCues(next.cues);
      storageSet(DRAFT_KEY, source);
    };
    if (firstRender.current) {
      firstRender.current = false;
      apply();
      return;
    }
    const timer = setTimeout(apply, 80);
    return () => clearTimeout(timer);
  }, [source, reader.setCues]);

  useEffect(() => {
    const book = bookRef.current;
    const pane = scrollRef.current;
    if (!book || !pane) return;
    book.querySelectorAll(".cue.is-current").forEach((el) => el.classList.remove("is-current"));
    if (!snapshot.spanId) return;
    const safeId = window.CSS && CSS.escape ? CSS.escape(snapshot.spanId) : snapshot.spanId;
    const el = book.querySelector('.cue[data-id="' + safeId + '"]');
    if (!el) return;
    el.classList.add("is-current");
    const paneRect = pane.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= paneRect.top + 28 && elRect.bottom <= paneRect.bottom - 28) return;
    const delta = elRect.top - paneRect.top - paneRect.height / 2 + elRect.height / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pane.scrollTo({ top: pane.scrollTop + delta, behavior: reduce ? "auto" : "smooth" });
  }, [snapshot.spanId, html]);

  useEffect(() => {
    function onKey(event) {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        toggle();
        return;
      }
      if (typing) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape") {
        reader.stop();
      }
    }
    function toggle() {
      if (reader.snapshot.state === "playing") reader.pause();
      else reader.play();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reader.pause, reader.play, reader.stop, reader.snapshot.state]);

  useEffect(() => {
    function onHide() {
      storageSet(DRAFT_KEY, sourceRef.current);
      reader.stop();
    }
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [reader.stop]);

  function onSource(value) {
    if (snapshot.state === "playing" || snapshot.state === "paused") reader.stop();
    setFileNote("");
    setSource(value);
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 1000000) {
      setFileNote("1MB보다 작은 텍스트 파일만 열 수 있습니다.");
      return;
    }
    const named = /\.(md|markdown|txt|text)$/i.test(file.name);
    if (file.type && !/text|markdown|json|xml/.test(file.type) && !named) {
      setFileNote("텍스트 파일만 열 수 있습니다.");
      return;
    }
    const loader = new FileReader();
    loader.onload = () => {
      setFileNote("");
      if (snapshot.state === "playing" || snapshot.state === "paused") reader.stop();
      setSource(String(loader.result || ""));
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };
    loader.readAsText(file, "utf-8");
  }

  function onBookClick(event) {
    const book = bookRef.current;
    if (!book) return;
    if (event.target.closest("a")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && book.contains(selection.anchorNode)) return;

    let cue = event.target.closest(".cue");
    if (!cue && document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY);
      const node = range && (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement);
      if (node && book.contains(node)) cue = node.closest(".cue");
    }
    if (!cue) {
      const block = event.target.closest("p, li, h1, h2, h3, h4, h5, h6, td, th");
      if (block) cue = block.querySelector(".cue");
    }
    if (!cue) return;
    reader.seekId(cue.getAttribute("data-id"), true);
  }

  const total = snapshot.total || 0;
  const index = snapshot.index || 0;
  const max = Math.max(total - 1, 0);
  const playing = snapshot.state === "playing";
  const paused = snapshot.state === "paused";
  const active = playing || paused;
  const playLabel = playing ? "일시정지" : paused ? "이어 읽기" : "읽기";
  const seekLabel = total === 0 ? "0 / 0" : snapshot.state === "done" ? total + " / " + total : index + 1 + " / " + total;
  const meta = cues.length ? cues.length + "구간 · " + formatDuration(estimateMs(cues, snapshot.rate, snapshot.breath)) : "읽을 문장 없음";
  const status = fileNote || describe(snapshot);
  const percent = snapshot.preparing && snapshot.progress ? snapshot.progress.percent : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
            <rect x="6" y="8" width="26" height="32" rx="2" fill="#f6f1e7" />
            <path d="M14 18h12M14 24h12M14 30h8" stroke="#8d3f2b" strokeWidth="2" />
            <path d="M30 14h8v22a6 6 0 0 1-6 6H16" fill="none" stroke="#e7c27a" strokeWidth="2" />
          </svg>
          <div>
            <h1>MarkSpeak</h1>
            <p>마크다운을 책 읽듯이 들려줍니다</p>
          </div>
        </div>
        <p className="privacy">원고는 이 브라우저 안에서만 읽히고, 서버로 보내지 않습니다.</p>
      </header>

      <main className="workspace">
        <section
          className={dragOver ? "pane editor-pane is-dragover" : "pane editor-pane"}
          ref={editorRef}
          aria-label="원고"
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (editorRef.current && editorRef.current.contains(event.relatedTarget)) return;
            setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            readFile(file);
          }}
        >
          <div className="pane-bar">
            <h2>원고</h2>
            <span className="spacer" />
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (active) reader.stop();
                setFileNote("");
                setSource(SAMPLE);
                if (scrollRef.current) scrollRef.current.scrollTop = 0;
              }}
            >
              예시 글
            </button>
            <button type="button" className="ghost" onClick={() => fileRef.current && fileRef.current.click()}>
              파일 열기
            </button>
          </div>
          <label className="visually-hidden" htmlFor="source">마크다운 원고</label>
          <textarea
            id="source"
            spellCheck="true"
            lang="ko"
            placeholder="마크다운을 붙여 넣거나 .md 파일을 끌어다 놓으세요."
            value={source}
            onChange={(event) => onSource(event.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            hidden
            onChange={(event) => {
              readFile(event.target.files && event.target.files[0]);
              event.target.value = "";
            }}
          />
        </section>

        <section className="pane book-pane" aria-label="책">
          <div className="pane-bar">
            <h2>책</h2>
            <span className="meta">{meta}</span>
          </div>
          <p className="pane-note">문장을 누르면 그 위치부터 읽습니다. 코드 블록과 주소는 소리로 읽지 않습니다.</p>
          <div className="book-scroll" ref={scrollRef}>
            <article
              ref={bookRef}
              className={empty ? "book-sheet is-empty" : "book-sheet"}
              aria-label="읽는 본문"
              dangerouslySetInnerHTML={{ __html: html }}
              onClick={onBookClick}
            />
          </div>
        </section>
      </main>

      <footer className="transport" aria-label="낭독 제어">
        <div className="transport-row">
          <button type="button" aria-label="이전 문장" disabled={total === 0 || index <= 0} onClick={reader.prev}>이전</button>
          <button
            type="button"
            className="primary"
            aria-pressed={playing}
            onClick={() => {
              if (playing) reader.pause();
              else reader.play();
            }}
          >
            {playLabel}
          </button>
          <button type="button" disabled={total === 0} onClick={reader.repeat}>문장 반복</button>
          <button type="button" aria-label="다음 문장" disabled={total === 0 || index >= total - 1} onClick={reader.next}>다음</button>
          <button type="button" disabled={!active && snapshot.state !== "done"} onClick={reader.stop}>정지</button>
          <label className="seek-wrap">
            <span>{seeking ? (total ? Number(seekValue) + 1 + " / " + total : "0 / 0") : seekLabel}</span>
            <input
              type="range"
              min="0"
              max={max}
              step="1"
              value={seeking ? seekValue : Math.min(index, max)}
              disabled={total === 0}
              aria-label="읽는 위치"
              onInput={(event) => {
                setSeeking(true);
                setSeekValue(Number(event.target.value));
              }}
              onChange={(event) => {
                setSeeking(false);
                const at = Number(event.target.value);
                reader.seek(at, playing || paused);
              }}
            />
          </label>
        </div>
        <div className="transport-row secondary">
          <label>
            속도
            <input
              type="range"
              min="0.6"
              max="1.3"
              step="0.05"
              value={snapshot.rate}
              aria-label="읽기 속도"
              onChange={(event) => {
                reader.setRate(event.target.value);
                storageSet(RATE_KEY, event.target.value);
              }}
            />
            <span>{Number(snapshot.rate).toFixed(2)}배</span>
          </label>
          <label>
            호흡
            <select
              aria-label="문장 사이 쉼"
              value={String(snapshot.breath)}
              onChange={(event) => {
                reader.setBreath(event.target.value);
                storageSet(BREATH_KEY, event.target.value);
              }}
            >
              <option value="0.7">짧게</option>
              <option value="1">책처럼</option>
              <option value="1.5">천천히</option>
            </select>
          </label>
          <span className="voice-name">목소리 {VOICE_LABEL}</span>
        </div>
        <div className="status-line">
          <span className="status-dot" hidden={!playing || snapshot.preparing} />
          <p className="status" role="status" aria-live="polite">{status}</p>
        </div>
        {snapshot.preparing ? (
          <div className="model-progress" aria-hidden="true">
            <span style={{ width: percent == null ? "18%" : percent + "%" }} />
          </div>
        ) : null}
        <p className="voice-note">처음 읽을 때 한국어 음성 모델을 이 브라우저로 받습니다. 이후에는 같은 기기에서 다시 받지 않습니다.</p>
        <p className="hints">Space 읽기/일시정지 · Esc 정지 · Ctrl+Enter 읽기. 원고를 고치면 읽기는 멈춥니다.</p>
      </footer>
    </div>
  );
}
