// 업로드 규칙 테스트
//
// isAllowedStorageUrl이 핵심이다. 이게 뚫리면 SSRF —
// 임의 URL을 넘겨 서버가 대신 요청하게 만들 수 있다.
// 그래서 통과 케이스보다 **거부 케이스를 더 촘촘히** 본다.

import {
  validateFile,
  isAllowedStorageUrl,
  LIMITS,
} from "../src/lib/upload-rules.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

// File 대역 — 런타임에 필요한 건 size/type/name 뿐이다
const f = (name, type, size) => ({ name, type, size });

// ── validateFile: 크기 ──
{
  const big = f("a.jpg", "image/jpeg", LIMITS.receipt.maxBytes + 1);
  const e = validateFile(big, "receipt");
  check("한도 초과는 거부", e?.code === "too_large");
  check("실제 크기를 알려준다", /MB/.test(e?.message ?? ""), e?.message);

  const ok = f("a.jpg", "image/jpeg", 1024);
  check("한도 이내는 통과", validateFile(ok, "receipt") === null);

  const edge = f("a.jpg", "image/jpeg", LIMITS.receipt.maxBytes);
  check("정확히 한도면 통과", validateFile(edge, "receipt") === null);
}

// ── validateFile: 형식 ──
{
  check(
    "jpeg 통과",
    validateFile(f("a.jpg", "image/jpeg", 100), "receipt") === null
  );
  check(
    "pdf는 영수증으로 거부",
    validateFile(f("a.pdf", "application/pdf", 100), "receipt")?.code === "bad_type"
  );
  check(
    "이미지를 오디오로 올리면 거부",
    validateFile(f("a.jpg", "image/jpeg", 100), "audio")?.code === "bad_type"
  );
}

// ── 아이폰 m4a ──
{
  check(
    "m4a (audio/mp4) 통과",
    validateFile(f("녹음.m4a", "audio/mp4", 1e6), "audio") === null
  );
  check(
    "m4a (audio/x-m4a) 통과",
    validateFile(f("녹음.m4a", "audio/x-m4a", 1e6), "audio") === null
  );
  // 아이폰/사파리가 type을 비워 보내는 경우가 실제로 있다.
  // 확장자 폴백이 없으면 정상 파일이 거부된다.
  check(
    "MIME이 비어도 확장자로 통과",
    validateFile(f("녹음.m4a", "", 1e6), "audio") === null
  );
  check(
    "MIME도 확장자도 아니면 거부",
    validateFile(f("문서", "", 1e6), "audio")?.code === "bad_type"
  );
  check(
    "오디오 상한은 25MB 미만 (OpenAI 한도)",
    LIMITS.audio.maxBytes < 25 * 1024 * 1024
  );
}

// ── isAllowedStorageUrl: 통과해야 하는 것 ──
const BUCKET = "myapp.firebasestorage.app";
{
  const good = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/users%2Fabc%2Fuploads%2Fx.m4a?alt=media&token=t`;
  check("정상 URL 통과", isAllowedStorageUrl(good, BUCKET), good);
}

// ── isAllowedStorageUrl: 반드시 막아야 하는 것 ──
{
  const blocked = [
    ["http (평문)", `http://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x`],
    ["내부 주소", "https://169.254.169.254/latest/meta-data/"],
    ["로컬호스트", "https://localhost/v0/b/x/o/y"],
    ["남의 버킷", `https://firebasestorage.googleapis.com/v0/b/other-bucket/o/x`],
    [
      "호스트 위장 (접미사)",
      `https://firebasestorage.googleapis.com.evil.com/v0/b/${BUCKET}/o/x`,
    ],
    [
      "호스트 위장 (접두사)",
      `https://evil-firebasestorage.googleapis.com.attacker.net/v0/b/${BUCKET}/o/x`,
    ],
    [
      "버킷명을 쿼리로 위장",
      `https://firebasestorage.googleapis.com/v0/b/evil/o/x?b=${BUCKET}`,
    ],
    [
      "경로 앞에 다른 세그먼트",
      `https://firebasestorage.googleapis.com/evil/v0/b/${BUCKET}/o/x`,
    ],
    ["URL 아님", "not-a-url"],
    ["빈 문자열", ""],
    ["file 스킴", "file:///etc/passwd"],
    // 호스트는 정확히 일치해야 한다. 서브도메인·접두사 변형은 전부 거부.
    [
      "리전 접두사 변형",
      `https://asia-northeast3-firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x`,
    ],
    [
      "서브도메인 변형",
      `https://a.firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x`,
    ],
  ];

  for (const [name, url] of blocked) {
    check(`거부: ${name}`, !isAllowedStorageUrl(url, BUCKET), url.slice(0, 70));
  }

  // 버킷 설정이 비어 있으면 전부 거부해야 한다.
  // 안 그러면 env 누락 시 검증이 통째로 무력화된다.
  const good = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x`;
  check("버킷 미설정이면 전부 거부", !isAllowedStorageUrl(good, ""));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
