import { parse } from "../src/markdown.js";
let failed = 0;

function assert(name, condition) {
  if (!condition) {
    failed += 1;
    console.error("실패: " + name);
  }
}

function texts(markdown) {
  return parse(markdown).cues.map((cue) => cue.text).join(" | ");
}

let result = parse("# 조용한 서재");
assert("제목 말만 읽는다", result.cues.length === 1 && result.cues[0].text === "조용한 서재");
assert("제목은 문단보다 길게 쉰다", result.cues[0].pauseAfter > parse("짧은 문장이다.").cues[0].pauseAfter);
assert("제목 html", result.html.startsWith("<h1>"));

result = parse("## 제목 ##");
assert("닫는 해시 제거", result.cues[0].text === "제목" && result.html.startsWith("<h2>"));

result = parse("안녕. 반가워.");
assert("두 문장", result.cues.length === 2);
assert("앞 문장 쉼이 더 짧다", result.cues[0].pauseAfter < result.cues[1].pauseAfter);
assert("마침표 유지", result.cues[0].text === "안녕." && result.cues[1].text === "반가워.");

result = parse("원주율은 3.14이다. 다음 문장.");
assert("소수점은 문장이 아니다", result.cues.length === 2 && result.cues[0].text.includes("3.14"));

result = parse("그는 **천천히** 읽었다.");
assert("굵은 글씨 기호 제거", result.cues[0].text === "그는 천천히 읽었다.");
assert("굵게 표시", result.html.includes("<strong>천천히</strong>"));

result = parse("그는 *서두르지* 않았다.");
assert("기울임", result.cues[0].text === "그는 서두르지 않았다." && result.html.includes("<em>서두르지</em>"));

result = parse("snake_case는 그대로 둔다.");
assert("단어 속 밑줄", result.cues[0].text.includes("snake_case") && !result.html.includes("<em>"));

result = parse("이름은 [표시된 이름](https://example.com)이다.");
assert("링크 글자", result.cues[0].text.includes("표시된 이름"));
assert("주소는 읽지 않음", !result.cues[0].text.includes("example.com"));
assert("링크 태그", result.html.includes('href="https://example.com"'));

result = parse("[클릭](javascript:alert(1))");
assert("자바스크립트 주소 차단", result.html.includes('href="#"') && !/href="javascript/i.test(result.html));

result = parse("사이트 https://example.com 참고.");
assert("맨 주소는 읽지 않음", !texts("사이트 https://example.com 참고.").includes("example.com"));
assert("주변 말은 읽음", texts("사이트 https://example.com 참고.").includes("사이트") && texts("사이트 https://example.com 참고.").includes("참고"));

result = parse("![오래된 책상](photo.png)");
assert("그림 설명", result.cues[0].text.includes("오래된 책상"));
assert("그림 주소", result.html.includes('src="photo.png"'));

result = parse("함수 `parse`를 부른다.");
assert("인라인 코드", result.cues[0].text.includes("parse") && result.html.includes("<code>parse</code>"));

result = parse("```js\nconst secret = 1\n```\n\n다음 문장이다.");
assert("코드 블록은 읽지 않음", result.cues.length === 1 && result.cues[0].text === "다음 문장이다.");
assert("코드는 화면에 남음", result.html.includes("const secret = 1") && !result.html.includes("<script"));

result = parse("```\n<script>alert(1)</script>\n```");
assert("코드 이스케이프", !result.html.includes("<script>") && result.cues.length === 0);

result = parse("- 사과\n- 배");
assert("목록 기호 제거", texts("- 사과\n- 배") === "사과 | 배");

result = parse("1. 하나\n2. 둘");
assert("번호는 읽지 않음", texts("1. 하나\n2. 둘") === "하나 | 둘");
assert("순서 목록", result.html.includes("<ol>"));

result = parse("- [x] 끝낸 일\n- [ ] 남은 일");
assert("체크박스 기호 제거", texts("- [x] 끝낸 일\n- [ ] 남은 일") === "끝낸 일 | 남은 일");
assert("체크 표시", result.html.includes("is-done") && result.html.includes('class="box"'));

result = parse("> 인용이다.");
assert("인용", result.html.includes("<blockquote>") && result.cues[0].text === "인용이다.");

result = parse("제목입니다\n=========");
assert("셋텍스트 제목", result.html.startsWith("<h1>") && result.cues[0].text === "제목입니다" && !result.cues[0].text.includes("="));

result = parse("본문이다.\n\n- 항목");
assert("문단과 목록", texts("본문이다.\n\n- 항목") === "본문이다. | 항목");

result = parse("본문이다.\n- 항목");
assert("빈 줄 없어도 목록", texts("본문이다.\n- 항목") === "본문이다. | 항목");

const long = "1,000명이 모인 넓은 광장에서 그는 한참을 서 있었고, 아무도 먼저 입을 열지 않았다.";
result = parse(long);
assert("천 단위 쉼표는 자르지 않음", result.cues[0].text.includes("1,000"));
assert("쉼표에서 숨을 나눈다", result.cues.length >= 2);
assert("뒷절이 남는다", result.cues.map((cue) => cue.text).join("").includes("입을 열지 않았다"));

const breath = "창가에 앉아 빗물이 유리를 타고 내리는 모양을 바라보다가, 그는 접어 둔 모서리를 펴고, 어제 멈춘 문단을 처음부터 다시 읽기 시작했다.";
result = parse(breath);
assert("긴 문장은 여러 호흡", result.cues.length >= 3);
assert("첫 호흡이 더 짧다", result.cues[0].pauseAfter < result.cues[result.cues.length - 1].pauseAfter);

result = parse("| 이름 | 역할 |\n| --- | --- |\n| 리더 | 낭독 |");
assert("표", result.html.includes("<table>") && result.html.includes("<th>") && result.html.includes("<td>"));
assert("표 말", texts("| 이름 | 역할 |\n| --- | --- |\n| 리더 | 낭독 |").includes("이름") && texts("| 이름 | 역할 |\n| --- | --- |\n| 리더 | 낭독 |").includes("낭독"));
assert("구분선은 읽지 않음", !texts("| 이름 | 역할 |\n| --- | --- |\n| 리더 | 낭독 |").includes("---"));

result = parse("위 문장이다.\n\n---\n\n아래 문장이다.");
assert("가로줄", result.html.includes("<hr>"));
assert("가로줄 앞은 더 쉰다", parse("위 문장이다.\n\n---\n\n아래 문장이다.").cues[0].pauseAfter > parse("위 문장이다.").cues[0].pauseAfter);

result = parse("");
assert("빈 원고", result.cues.length === 0 && result.html === "");

result = parse('<script>alert(1)</script> 문장이다.');
assert("본문 스크립트 이스케이프", !result.html.includes("<script>") && result.html.includes("&lt;script&gt;"));

result = parse("첫 줄  \n둘째 줄이다.");
assert("강제 줄바꿈", result.html.includes("<br>") && result.cues.length === 2);

result = parse("그는 말을 흐렸다… 그리고 웃었다.");
assert("말줄임", result.cues.length === 2 && result.cues[0].text.includes("…"));

const sample = [
  "# 조용한 서재",
  "",
  "창밖으로 비가 내리기 시작했다. 책장은 오래전부터 같은 자리에 있었고, 종이 냄새는 방 안을 천천히 채웠다.",
  "",
  "```text",
  "이 블록은 화면에만 남고, 목소리로는 건너뜁니다.",
  "```",
  "",
  "본문의 **굵은 말**과 [표시된 이름](https://example.com)만 소리로 읽고, 주소는 읽지 않는다.",
].join("\n");
result = parse(sample);
const joined = result.cues.map((cue) => cue.text).join(" ");
assert("예시에서 코드 블록 제외", !joined.includes("건너뜁니다"));
assert("예시에서 주소 제외", !joined.includes("example.com"));
assert("예시에서 굵은 말", joined.includes("굵은 말"));
assert("예시 제목", joined.includes("조용한 서재"));
assert("큐마다 화면 위치가 있다", result.cues.every((cue) => result.html.includes('data-id="' + cue.spanId + '"')));

if (failed) {
  console.error(failed + "개 실패");
  process.exit(1);
}
console.log("마크다운 낭독 변환 " + (failed === 0 ? "통과" : "실패"));
console.log("예시 구간 수: " + result.cues.length);
