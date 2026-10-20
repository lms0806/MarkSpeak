const SINO = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const LARGE = ["", "만", "억", "조"];
const DEFAULT_WORDS = { MarkSpeak: "마크스피크", SSML: "에스에스엠엘", API: "에이피아이", AI: "에이아이", TTS: "티티에스", URL: "유알엘" };

function sinoNumber(raw) {
  const digits = raw.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (!/^\d{1,16}$/.test(digits)) return null;
  if (digits === "0") return SINO[0];
  const groups = [];
  for (let end = digits.length, group = 0; end > 0; end -= 4, group += 1) {
    const chunk = digits.slice(Math.max(0, end - 4), end);
    let spoken = "";
    for (let i = 0; i < chunk.length; i += 1) {
      const digit = Number(chunk[i]);
      const place = chunk.length - i - 1;
      if (digit) spoken += (digit === 1 && place > 0 ? "" : SINO[digit]) + SMALL[place];
    }
    if (spoken) groups.unshift(spoken + LARGE[group]);
  }
  return groups.join(" ");
}

function nativeNumber(number) {
  const ones = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
  const tens = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
  if (number < 1 || number > 99 || !Number.isInteger(number)) return null;
  return tens[Math.floor(number / 10)] + ones[number % 10];
}

function spokenNumber(raw) {
  const parts = raw.replace(/,/g, "").split(".");
  const whole = sinoNumber(parts[0]);
  if (!whole) return null;
  return whole + (parts[1] ? " 점 " + [...parts[1]].map((digit) => SINO[Number(digit)]).join(" ") : "");
}

export function parsePronunciations(value) {
  return String(value || "").split(/\r?\n/).reduce((entries, line) => {
    const at = line.indexOf("=");
    if (at < 0) return entries;
    const word = line.slice(0, at).trim();
    const reading = line.slice(at + 1).trim();
    if (word && reading) entries[word] = reading;
    return entries;
  }, Object.create(null));
}

export function normalizeKoreanSpeech(text, customWords = {}) {
  const words = { ...DEFAULT_WORDS, ...customWords };
  const keys = Object.keys(words).filter((key) => key && words[key]).sort((a, b) => b.length - a.length);
  let result = String(text);
  if (keys.length) {
    const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp("(?<![A-Za-z0-9_])(?:" + escaped.join("|") + ")(?![A-Za-z0-9_])", "g");
    result = result.replace(pattern, (match) => words[match]);
  }
  const number = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)";
  const boundary = "(?<![\\w가-힣.,])";
  // Explicit units provide context; leave bare numbers, dates with separators and identifiers untouched.
  result = result.replace(new RegExp("(?<![\\w가-힣.,-])(" + number + ")(시간|시|개(?!월)|명|마리|권|잔|대|살)", "g"), (match, raw, unit) => {
    const value = Number(raw.replace(/,/g, ""));
    if (value === 0) return match;
    if ((unit === "시" || unit === "시간") && value > 24) return match;
    const spoken = nativeNumber(value) || sinoNumber(raw);
    return spoken ? spoken + " " + unit : match;
  });
  result = result.replace(new RegExp(boundary + "(-?)((?:" + number + ")(?:\\.\\d+)?)(개월|년|월|일|분|초|원|퍼센트|%|kg|km|cm|mm|도)(?![A-Za-z])", "g"), (match, sign, raw, unit) => {
    const spoken = unit === "월" && raw === "6" ? "유" : unit === "월" && raw === "10" ? "시" : spokenNumber(raw);
    const units = { "%": "퍼센트", kg: "킬로그램", km: "킬로미터", cm: "센티미터", mm: "밀리미터" };
    return spoken ? (sign ? "마이너스 " : "") + spoken + " " + (units[unit] || unit) : match;
  });
  return result;
}
