/**
 * 마크다운 원고를 화면과 낭독으로 나눈다.
 *
 * html  — 책 페이지. 읽는 위치마다 .cue 가 붙는다.
 * cues  — 음성으로 읽을 순서. 기호·주소·코드 블록은 빠지고,
 *         쉼표·문장·문단 끝에는 서로 다른 쉼(ms)이 붙는다.
 */

  var PAUSE = {
    phrase: 220,
    sentence: 460,
    list: 360,
    quote: 620,
    paragraph: 780,
  };

  var PHRASE_MIN_LENGTH = 36;
  var PHRASE_MIN_PART = 12;
  var LONG_CUE_LIMIT = 90;

  function headingPause(level) {
    return 980 - (level - 1) * 90;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    var value = String(url || "").trim();
    if (/^(https?:|mailto:)/i.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "#";
    if (value.indexOf("//") === 0) return "#";
    return value;
  }

  function cleanSpeech(value) {
    return String(value || "")
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\uFE0F/g, "")
      .replace(/[–—]/g, ", ")
      .replace(/([가-힣])~+/g, "$1")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:…，])/g, "$1")
      .replace(/(,\s*){2,}/g, ", ")
      .replace(/\(\s*\)/g, "")
      .trim();
  }

  function isSpeakable(value) {
    return /[0-9A-Za-z가-힣]/.test(value);
  }

  function isWordChar(ch) {
    return /[0-9A-Za-z가-힣]/.test(ch || "");
  }

  function isSentenceEnder(ch) {
    return ".!?…。！？".indexOf(ch) !== -1;
  }

  function readWrapped(src, i, bang) {
    var start = bang ? i + 1 : i;
    if (bang && src.slice(i, i + 2) !== "![") return null;
    if (!bang && src[i] !== "[") return null;
    var matched = /^\[([^\]]*)\]\(([^)]+)\)/.exec(src.slice(start));
    if (!matched) return null;
    if (!bang && !matched[1]) return null;
    var href = matched[2].trim().replace(/^<|>$/g, "");
    var titled = href.match(/^(\S+)\s+(?:"[^"]*"|'[^']*')$/);
    if (titled) href = titled[1];
    if (!href || /\s/.test(href)) return null;
    return {
      text: matched[1],
      href: href,
      end: start + matched[0].length,
    };
  }

  function readImage(src, i) {
    return readWrapped(src, i, true);
  }

  function readLink(src, i) {
    return readWrapped(src, i, false);
  }

  function tryWrap(src, i, marker, tag) {
    if (src.slice(i, i + marker.length) !== marker) return null;
    if (marker === "*" && src[i + 1] === "*") return null;
    if (marker === "_" && src[i + 1] === "_") return null;
    var startInner = i + marker.length;
    var end = src.indexOf(marker, startInner);
    if (end === -1) return null;
    var innerRaw = src.slice(startInner, end);
    if (!innerRaw.trim() || /^\s|\s$/.test(innerRaw)) return null;
    if (marker === "_" || marker === "__") {
      var prev = src[i - 1] || "";
      var after = src[end + marker.length] || "";
      if (isWordChar(prev) || isWordChar(after)) return null;
    }
    var inner = parseInline(innerRaw);
    return {
      html: "<" + tag + ">" + inner.html + "</" + tag + ">",
      speech: inner.speech,
      end: end + marker.length,
    };
  }

  function parseInline(src) {
    var html = "";
    var speech = "";
    var i = 0;

    while (i < src.length) {
      var ch = src[i];

      if (ch === "\\" && i + 1 < src.length) {
        html += escapeHtml(src[i + 1]);
        speech += src[i + 1];
        i += 2;
        continue;
      }

      if (ch === "`") {
        var codeEnd = src.indexOf("`", i + 1);
        if (codeEnd !== -1 && src.slice(i + 1, codeEnd).indexOf("\n") === -1) {
          var code = src.slice(i + 1, codeEnd);
          html += "<code>" + escapeHtml(code) + "</code>";
          speech += code;
          i = codeEnd + 1;
          continue;
        }
      }

      if (ch === "!" && src[i + 1] === "[") {
        var image = readImage(src, i);
        if (image) {
          var alt = image.text.trim();
          html +=
            '<img src="' +
            escapeAttr(safeUrl(image.href)) +
            '" alt="' +
            escapeAttr(alt) +
            '">';
          if (alt) speech += alt;
          i = image.end;
          continue;
        }
      }

      if (ch === "[") {
        var link = readLink(src, i);
        if (link) {
          var linked = parseInline(link.text);
          html +=
            '<a href="' +
            escapeAttr(safeUrl(link.href)) +
            '" target="_blank" rel="noopener noreferrer">' +
            linked.html +
            "</a>";
          speech += linked.speech;
          i = link.end;
          continue;
        }
      }

      if (src.slice(i, i + 7).toLowerCase() === "http://" || src.slice(i, i + 8).toLowerCase() === "https://") {
        var urlMatch = /^https?:\/\/[^\s<>)]+/i.exec(src.slice(i));
        if (urlMatch) {
          var url = urlMatch[0].replace(/[.,;:!?)]+$/g, "");
          html +=
            '<a href="' +
            escapeAttr(safeUrl(url)) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(url) +
            "</a>";
          i += url.length;
          continue;
        }
      }

      var wrapped =
        tryWrap(src, i, "~~", "del") ||
        tryWrap(src, i, "**", "strong") ||
        tryWrap(src, i, "__", "strong") ||
        tryWrap(src, i, "*", "em") ||
        tryWrap(src, i, "_", "em");
      if (wrapped) {
        html += wrapped.html;
        speech += wrapped.speech;
        i = wrapped.end;
        continue;
      }

      html += escapeHtml(ch);
      speech += ch;
      i += 1;
    }

    return { html: html, speech: speech };
  }

  function splitMarkdownSentences(src) {
    var parts = [];
    var buf = "";
    var inCode = false;
    var i = 0;

    while (i < src.length) {
      var ch = src[i];

      if (ch === "`") {
        inCode = !inCode;
        buf += ch;
        i += 1;
        continue;
      }

      if (!inCode && ch === "!" && src[i + 1] === "[") {
        var image = readImage(src, i);
        if (image) {
          buf += src.slice(i, image.end);
          i = image.end;
          continue;
        }
      }

      if (!inCode && ch === "[") {
        var link = readLink(src, i);
        if (link) {
          buf += src.slice(i, link.end);
          i = link.end;
          continue;
        }
      }

      buf += ch;
      var prev = i > 0 ? src[i - 1] : "";
      var next = i + 1 < src.length ? src[i + 1] : "";
      var decimal = ch === "." && /\d/.test(prev) && /\d/.test(next);

      if (!inCode && !decimal && isSentenceEnder(ch)) {
        var j = i;
        while (j + 1 < src.length && isSentenceEnder(src[j + 1])) {
          j += 1;
          buf += src[j];
        }
        var after = j + 1 < src.length ? src[j + 1] : "";
        if (after === "" || /\s/.test(after)) {
          var trimmed = buf.trim();
          if (trimmed) parts.push(trimmed);
          buf = "";
          i = j + 1;
          while (i < src.length && src[i] === " ") i += 1;
          continue;
        }
        i = j + 1;
        continue;
      }

      i += 1;
    }

    var tail = buf.trim();
    if (tail) parts.push(tail);
    return parts;
  }

  function splitMarkdownPhrases(sentence) {
    if (sentence.length <= PHRASE_MIN_LENGTH) return [sentence];

    var parts = [];
    var buf = "";
    var inCode = false;
    var i = 0;

    while (i < sentence.length) {
      var ch = sentence[i];

      if (ch === "`") {
        inCode = !inCode;
        buf += ch;
        i += 1;
        continue;
      }

      if (!inCode && (ch === "[" || (ch === "!" && sentence[i + 1] === "["))) {
        var token = ch === "!" ? readImage(sentence, i) : readLink(sentence, i);
        if (token) {
          buf += sentence.slice(i, token.end);
          i = token.end;
          continue;
        }
      }

      buf += ch;
      var prev = i > 0 ? sentence[i - 1] : "";
      var next = i + 1 < sentence.length ? sentence[i + 1] : "";
      var comma = !inCode && ",，;；:：".indexOf(ch) !== -1;
      var inNumber = /\d/.test(prev) && /\d/.test(next);
      if (comma && !inNumber) {
        var rest = sentence.slice(i + 1).trim();
        if (buf.trim().length >= PHRASE_MIN_PART && rest.length >= PHRASE_MIN_PART) {
          parts.push(buf.trim());
          buf = "";
          i += 1;
          if (sentence[i] === " ") i += 1;
          continue;
        }
      }

      i += 1;
    }

    if (buf.trim()) parts.push(buf.trim());
    return parts.length ? parts : [sentence];
  }

  function breakLongPlain(text, limit) {
    if (text.length <= limit) return [text];
    var parts = [];
    var rest = text.trim();
    while (rest.length > limit) {
      var cut = rest.lastIndexOf(" ", limit);
      if (cut < Math.floor(limit * 0.4)) cut = limit;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts.filter(Boolean);
  }

  function isBlank(line) {
    return line.trim() === "";
  }

  function isFence(line) {
    return /^(`{3,}|~{3,})/.test(line.trim());
  }

  function fenceMarker(line) {
    var matched = /^(`{3,}|~{3,})/.exec(line.trim());
    return matched ? matched[1][0] : "`";
  }

  function isHeading(line) {
    return /^#{1,6}\s+\S/.test(line);
  }

  function isQuote(line) {
    return /^>\s?/.test(line);
  }

  function isList(line) {
    return /^(\s*[-*+]|\s*\d+[.)])\s+\S/.test(line);
  }

  function isHr(line) {
    return /^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim());
  }

  function isTableSep(line) {
    var core = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    if (!core.trim()) return false;
    var cells = core.split("|");
    return cells.length > 0 && cells.every(function (cell) {
      return /^\s*:?-{3,}:?\s*$/.test(cell);
    });
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    if (lines[index].indexOf("|") === -1) return false;
    return isTableSep(lines[index + 1]);
  }

  function splitRow(line) {
    var source = line.trim();
    if (source[0] === "|") source = source.slice(1);
    if (source[source.length - 1] === "|") source = source.slice(0, -1);
    return source.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function joinParagraph(lines) {
    if (!lines.length) return "";
    var text = lines[0].replace(/[ ]{2}$/, "").replace(/\\$/, "");
    var hard = /[ ]{2}$/.test(lines[0]) || /\\$/.test(lines[0]);
    for (var k = 1; k < lines.length; k += 1) {
      var piece = lines[k].replace(/[ ]{2}$/, "").replace(/\\$/, "");
      text += (hard ? "\n" : " ") + piece;
      hard = /[ ]{2}$/.test(lines[k]) || /\\$/.test(lines[k]);
    }
    return text;
  }

  function parse(markdown) {
    var lines = String(markdown || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

    var cues = [];
    var html = [];
    var seq = 0;

    function addCue(text, pauseAfter) {
      var cleaned = cleanSpeech(text);
      if (!isSpeakable(cleaned)) return null;
      var bits = breakLongPlain(cleaned, LONG_CUE_LIMIT);
      var spanId = null;
      bits.forEach(function (bit, index) {
        var id = "c" + (seq += 1);
        if (!spanId) spanId = id;
        cues.push({
          id: id,
          spanId: spanId,
          text: bit,
          pauseAfter: index === bits.length - 1 ? pauseAfter : PAUSE.phrase,
        });
      });
      return spanId;
    }

    function renderSpoken(markdownText, endPause) {
      var rows = String(markdownText || "").split("\n");
      var htmlParts = [];

      rows.forEach(function (row, rowIndex) {
        var sentences = splitMarkdownSentences(row.trim());
        sentences.forEach(function (sentence, sentenceIndex) {
          var pieces = splitMarkdownPhrases(sentence);
          pieces.forEach(function (piece, pieceIndex) {
            var inline = parseInline(piece);
            var last =
              rowIndex === rows.length - 1 &&
              sentenceIndex === sentences.length - 1 &&
              pieceIndex === pieces.length - 1;
            var pause = PAUSE.phrase;
            if (last) pause = endPause;
            else if (pieceIndex === pieces.length - 1) pause = PAUSE.sentence;
            var id = addCue(inline.speech, pause);
            if (!id) {
              if (inline.html) htmlParts.push(inline.html);
              return;
            }
            htmlParts.push('<span class="cue" data-id="' + id + '">' + inline.html + "</span>");
          });
        });
        if (rowIndex < rows.length - 1) htmlParts.push("<br>");
      });

      return htmlParts.join(" ");
    }

    function bumpLastPause(extra) {
      var last = cues[cues.length - 1];
      if (last) last.pauseAfter += extra;
    }

    function setLastPause(pause) {
      var last = cues[cues.length - 1];
      if (last && last.pauseAfter < pause) last.pauseAfter = pause;
    }

    var i = 0;
    while (i < lines.length) {
      if (isBlank(lines[i])) {
        i += 1;
        continue;
      }

      if (isFence(lines[i])) {
        var marker = fenceMarker(lines[i]);
        var codeLines = [];
        i += 1;
        while (i < lines.length && !(isFence(lines[i]) && fenceMarker(lines[i]) === marker)) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        html.push(
          '<pre class="codeblock" title="낭독에서는 코드 블록을 건너뜁니다"><code>' +
            escapeHtml(codeLines.join("\n")) +
            "</code></pre>"
        );
        continue;
      }

      if (isHeading(lines[i])) {
        var heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
        var level = heading[1].length;
        var headingText = heading[2].trim();
        html.push(
          "<h" + level + ">" + renderSpoken(headingText, headingPause(level)) + "</h" + level + ">"
        );
        i += 1;
        continue;
      }

      if (isQuote(lines[i])) {
        var quoteLines = [];
        while (i < lines.length && isQuote(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        var quoteParagraphs = [];
        var quoteBuf = [];
        quoteLines.forEach(function (line) {
          if (line.trim() === "") {
            if (quoteBuf.length) quoteParagraphs.push(joinParagraph(quoteBuf));
            quoteBuf = [];
          } else {
            quoteBuf.push(line);
          }
        });
        if (quoteBuf.length) quoteParagraphs.push(joinParagraph(quoteBuf));
        var quoteHtml = quoteParagraphs
          .map(function (paragraph) {
            return "<p>" + renderSpoken(paragraph, PAUSE.quote) + "</p>";
          })
          .join("");
        html.push("<blockquote>" + quoteHtml + "</blockquote>");
        continue;
      }

      if (isList(lines[i])) {
        var ordered = /^\s*\d+[.)]\s+/.test(lines[i]);
        var items = [];
        while (i < lines.length && isList(lines[i])) {
          var raw = lines[i].replace(/^(\s*[-*+]|\s*\d+[.)])\s+/, "");
          var task = /^\[( |x|X)\]\s+/.exec(raw);
          items.push({
            text: raw.replace(/^\[( |x|X)\]\s+/, ""),
            task: Boolean(task),
            done: Boolean(task && task[1].toLowerCase() === "x"),
          });
          i += 1;
        }
        var tag = ordered ? "ol" : "ul";
        var body = items
          .map(function (item, index) {
            var pause = index === items.length - 1 ? PAUSE.paragraph : PAUSE.list;
            var inner = renderSpoken(item.text, pause);
            if (item.task) {
              return (
                '<li class="task' +
                (item.done ? " is-done" : "") +
                '"><span class="box" aria-hidden="true"></span>' +
                inner +
                "</li>"
              );
            }
            return "<li>" + inner + "</li>";
          })
          .join("");
        html.push("<" + tag + ">" + body + "</" + tag + ">");
        continue;
      }

      if (isTableStart(lines, i)) {
        var rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && !isBlank(lines[i])) {
          if (!isTableSep(lines[i])) rows.push(splitRow(lines[i]));
          i += 1;
        }
        if (rows.length) {
          var head = rows[0]
            .map(function (cell, index, array) {
              var pause = index === array.length - 1 ? PAUSE.sentence : PAUSE.phrase;
              return "<th>" + (renderSpoken(cell, pause) || "") + "</th>";
            })
            .join("");
          var bodyRows = rows
            .slice(1)
            .map(function (row) {
              return (
                "<tr>" +
                row
                  .map(function (cell, index, array) {
                    var pause = index === array.length - 1 ? PAUSE.list : PAUSE.phrase;
                    return "<td>" + (renderSpoken(cell, pause) || "") + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("");
          if (rows.length > 1) setLastPause(PAUSE.paragraph);
          html.push("<table><thead><tr>" + head + "</tr></thead><tbody>" + bodyRows + "</tbody></table>");
        }
        continue;
      }

      if (isHr(lines[i])) {
        html.push("<hr>");
        bumpLastPause(400);
        i += 1;
        continue;
      }

      var para = [];
      while (i < lines.length && !isBlank(lines[i])) {
        if (para.length > 0 && (isFence(lines[i]) || isHeading(lines[i]) || isQuote(lines[i]) || isList(lines[i]) || isTableStart(lines, i))) {
          break;
        }
        if (para.length === 1 && /^(=+|-+)\s*$/.test(lines[i].trim()) && lines[i].trim().length >= 3) {
          break;
        }
        if (para.length > 0 && isHr(lines[i])) break;
        para.push(lines[i]);
        i += 1;
      }

      if (para.length === 1 && i < lines.length && /^=+\s*$/.test(lines[i].trim())) {
        html.push("<h1>" + renderSpoken(para[0].trim(), headingPause(1)) + "</h1>");
        i += 1;
        continue;
      }
      if (para.length === 1 && i < lines.length && /^-{3,}\s*$/.test(lines[i].trim())) {
        html.push("<h2>" + renderSpoken(para[0].trim(), headingPause(2)) + "</h2>");
        i += 1;
        continue;
      }

      var paragraphHtml = renderSpoken(joinParagraph(para), PAUSE.paragraph);
      if (paragraphHtml) html.push("<p>" + paragraphHtml + "</p>");
    }

    return { html: html.join("\n"), cues: cues };
  }

  export { parse };
