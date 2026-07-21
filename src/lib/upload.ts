// ==========================================
// 업로드 공용 계층 (영수증 사진 · 음성 녹음)
// ==========================================
//
// 왜 Storage를 거치는가:
//
// Vercel 서버리스 함수는 **요청 본문 4.5MB**에서 잘린다. 돈을 더 내도 안 올라간다.
// 게다가 파일을 API로 통과시키면 base64로 4/3 부풀고, 그 대역폭과 함수 실행시간이
// 전부 과금된다.
//
// 그래서 파일은 브라우저 → Firebase Storage로 **직접** 올린다. Vercel을 안 거친다.
// 우리 API에는 다운로드 URL 문자열만 넘긴다(몇백 바이트). 서버는 그 URL에서
// 파일을 받아 OpenAI로 넘긴다 — 이건 요청 본문이 아니라 아웃바운드 fetch라
// 4.5MB 제한과 무관하다.
//
//   [브라우저] ──파일──> [Firebase Storage]
//        │                      │
//        └──URL 문자열──> [Vercel API] ──받아옴──┘ ──> [OpenAI]
//
// firebase-admin을 쓰지 않는 이유:
// 서버가 Storage를 직접 읽으려면 서비스 계정 키를 서버에 둬야 한다.
// 다운로드 URL을 넘기는 방식이면 그 키 없이 된다. 의존성도, 키 관리도 줄어든다.

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { getClientStorage } from "./firebase";
import { validateFile, LIMITS, type UploadKind } from "./upload-rules";

// 검증 규칙은 upload-rules.ts에 있다 (테스트 가능하게 분리).
export { validateFile, LIMITS, isAllowedStorageUrl } from "./upload-rules";
export type { UploadKind, ValidationError } from "./upload-rules";

export interface UploadResult {
  /** 서버에 넘길 다운로드 URL */
  url: string;
  /** 나중에 지울 때 쓰는 Storage 경로 */
  path: string;
  contentType: string;
  bytes: number;
}

export interface UploadHandle {
  /** 완료를 기다린다 */
  done: Promise<UploadResult>;
  /** 사용자가 취소했을 때 */
  cancel: () => void;
}

/** 파일명에서 안전한 확장자만 뽑는다 (경로 조작 방지) */
function safeExt(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

/**
 * Storage로 업로드한다.
 *
 * 재개 가능(resumable) 업로드를 쓴다 — 모바일 네트워크에서 20MB 업로드는
 * 자주 끊기는데, 일반 업로드면 처음부터 다시 해야 한다.
 *
 * @param onProgress 0~100
 */
export function uploadToStorage(
  file: File,
  kind: UploadKind,
  uid: string,
  onProgress?: (percent: number) => void
): UploadHandle {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `users/${uid}/uploads/${kind}-${id}.${safeExt(file.name)}`;

  const storageRef = ref(getClientStorage(), path);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
  });

  const done = new Promise<UploadResult>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (!onProgress) return;
        const pct = snap.totalBytes
          ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
          : 0;
        onProgress(pct);
      },
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({
            url,
            path,
            contentType: task.snapshot.metadata.contentType ?? file.type,
            bytes: task.snapshot.totalBytes,
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });

  return { done, cancel: () => task.cancel() };
}

/**
 * 업로드한 파일을 지운다.
 *
 * **분석이 성공하든 실패하든 반드시 부른다.**
 * 안 지우면 고아 파일이 Storage에 영원히 남아 요금이 붙는다.
 * 이미 없거나 권한이 없어도 조용히 넘어간다 — 정리 실패로 사용자 흐름을
 * 막을 이유가 없다.
 */
export async function deleteUpload(path: string): Promise<void> {
  try {
    await deleteObject(ref(getClientStorage(), path));
  } catch (err) {
    console.warn("[upload] 정리 실패 (무시):", path, err);
  }
}
