const SINO = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const LARGE = ["", "만", "억", "조"];

function sinoNumber(raw) {
  const digits = raw.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (digits.length > 16) return null;
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
  if (number < 1 || number > 99) return null;
  return tens[Math.floor(number / 10)] + ones[number % 10];
}

// Only convert unambiguous common forms. Leave identifiers and unknown units to the voice model.
export function normalizeKoreanSpeech(text) {
  const number = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)";
  const boundary = "(?<![\\w가-힣.,])";
  return String(text)
    .replace(new RegExp(boundary + "(" + number + ")(개(?!월)|명|마리|권|잔|대|살)", "g"), (match, raw, unit) => {
      const value = Number(raw.replace(/,/g, ""));
      const spoken = nativeNumber(value);
      return spoken ? spoken + " " + unit : match;
    })
    .replace(new RegExp(boundary + "(" + number + ")(년|월|일|분|초|원|퍼센트|%)", "g"), (match, raw, unit) => {
      const spoken = sinoNumber(raw);
      return spoken ? spoken + (unit === "%" ? " 퍼센트" : " " + unit) : match;
    });
}
