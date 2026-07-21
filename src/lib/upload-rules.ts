// ==========================================
// 업로드 규칙 — 순수 함수만
// ==========================================
//
// upload.ts에서 분리한 이유: 그쪽은 firebase/storage를 런타임 import 하는데,
// 그러면 유닛 테스트에서 못 불러온다. 검증 로직은 실수하면 보안 구멍이
// 되는 부분이라(특히 isAllowedStorageUrl) 반드시 테스트가 붙어야 한다.

/** 업로드 용도 — 경로와 검증 규칙이 갈린다 */
export type UploadKind = "receipt" | "audio";

/**
 * 용도별 제한.
 *
 * Storage 보안 규칙에도 25MB 상한이 있다. 여기 값은 그보다 작아야 하며,
 * 여기서 먼저 걸러야 사용자가 다 올린 뒤에 거부당하지 않는다.
 */
export const LIMITS: Record<
  UploadKind,
  { maxBytes: number; accept: string[]; label: string }
> = {
  receipt: {
    maxBytes: 10 * 1024 * 1024,
    accept: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    label: "이미지",
  },
  audio: {
    // OpenAI 전사 API 상한이 25MB다. Storage 규칙도 25MB.
    // 여유를 두고 24MB로 잡는다.
    maxBytes: 24 * 1024 * 1024,
    accept: [
      // 아이폰 음성 메모는 m4a(AAC)다. 브라우저가 보고하는 MIME이 제각각이라
      // 넉넉히 받는다: audio/mp4, audio/x-m4a, audio/m4a 등.
      "audio/mp4",
      "audio/x-m4a",
      "audio/m4a",
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/webm",
      "audio/ogg",
      "video/mp4",
    ],
    label: "오디오",
  },
};

/** 확장자 기반 보조 판정 — 브라우저가 MIME을 비워 보내는 경우가 있다 */
const EXT_FALLBACK: Record<UploadKind, RegExp> = {
  receipt: /\.(jpe?g|png|webp|heic|heif)$/i,
  audio: /\.(m4a|mp3|mp4|wav|webm|ogg|mpga|mpeg)$/i,
};

export interface ValidationError {
  code: "too_large" | "bad_type";
  message: string;
}

/**
 * 업로드 전 검증. 통과하면 null.
 *
 * MIME이 비어 있어도 확장자로 한 번 더 본다 —
 * 아이폰에서 올린 m4a가 빈 type으로 오는 사례가 있다.
 */
export function validateFile(
  file: File,
  kind: UploadKind
): ValidationError | null {
  const { maxBytes, accept, label } = LIMITS[kind];

  if (file.size > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    const actual = (file.size / 1024 / 1024).toFixed(1);
    return {
      code: "too_large",
      message: `파일이 너무 큽니다 (${actual}MB). ${label}는 최대 ${mb}MB까지 올릴 수 있습니다.`,
    };
  }

  const typeOk = file.type ? accept.includes(file.type.toLowerCase()) : false;
  const extOk = EXT_FALLBACK[kind].test(file.name);
  if (!typeOk && !extOk) {
    return {
      code: "bad_type",
      message: `지원하지 않는 형식입니다 (${file.type || file.name}).`,
    };
  }

  return null;
}

/**
 * 클라이언트가 넘긴 URL이 우리 Storage 버킷의 것인지 확인한다.
 *
 * **이 검증이 없으면 SSRF다.** 임의 URL을 넘기면 서버가 대신 요청해 주는
 * 꼴이 되어, 외부에서 닿을 수 없는 내부 주소까지 긁어올 수 있다.
 *
 * 서버 라우트에서 fetch 하기 **전에** 반드시 통과시킬 것.
 */
export function isAllowedStorageUrl(url: string, bucket: string): boolean {
  if (!bucket) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }

  if (u.protocol !== "https:") return false;

  // 호스트는 **정확히** 이것만 허용한다.
  //   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?...
  //
  // 와일드카드(*.firebasestorage.googleapis.com, *-firebasestorage...)를 열어두지
  // 않는다. 실제로 그런 URL이 오는지 확인하지 않은 채 보안 검증을 넓히면,
  // 막으려던 것을 통과시킬 수 있다. 다른 형태가 실제로 관찰되면 그때 추가한다.
  if (u.hostname !== "firebasestorage.googleapis.com") return false;

  // 버킷이 경로에 그대로 박혀 있어야 한다.
  // encodeURIComponent 된 형태도 있으므로 둘 다 본다.
  return (
    u.pathname.startsWith(`/v0/b/${bucket}/o/`) ||
    u.pathname.startsWith(`/v0/b/${encodeURIComponent(bucket)}/o/`)
  );
}
