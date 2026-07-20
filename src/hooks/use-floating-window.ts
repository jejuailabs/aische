// ==========================================
// 플로팅 창 — 드래그 이동 + 8방향 리사이즈
// ==========================================
//
// 외부 라이브러리 없이 Pointer Events로 구현한다.
// 위치/크기는 localStorage에 저장되어 새로고침 후에도 유지된다.

import { useCallback, useEffect, useRef, useState } from "react";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 리사이즈 손잡이 방향 */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Options {
  storageKey: string;
  /** 저장된 값이 없을 때 쓸 초기 위치·크기 */
  defaultRect: (viewport: { w: number; h: number }) => Rect;
  minW?: number;
  minH?: number;
}

const MARGIN = 8;

function clampToViewport(r: Rect, minW: number, minH: number): Rect {
  if (typeof window === "undefined") return r;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 뷰포트가 아직 측정되지 않았으면(0) 클램프하지 않는다.
  // 이때 클램프하면 창이 최소 크기로 뭉개지고, 이후 복구되지 않는다.
  if (vw <= 0 || vh <= 0) return r;

  const w = Math.max(minW, Math.min(r.w, vw - MARGIN * 2));
  const h = Math.max(minH, Math.min(r.h, vh - MARGIN * 2));
  // 창이 화면 밖으로 완전히 나가지 않도록
  const x = Math.max(MARGIN, Math.min(r.x, vw - w - MARGIN));
  const y = Math.max(MARGIN, Math.min(r.y, vh - h - MARGIN));
  return { x, y, w, h };
}

export function useFloatingWindow({
  storageKey,
  defaultRect,
  minW = 320,
  minH = 220,
}: Options) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [interacting, setInteracting] = useState(false);

  // 최초 1회: 저장값 복원 또는 기본값 계산 (SSR 회피 위해 effect에서)
  // 뷰포트가 아직 0이면 실제 크기가 잡힐 때까지 프레임을 미룬다.
  useEffect(() => {
    let raf = 0;
    const init = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw <= 0 || vh <= 0) {
        raf = requestAnimationFrame(init);
        return;
      }
      let saved: Rect | null = null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const p = JSON.parse(raw);
          if (
            typeof p?.x === "number" &&
            typeof p?.y === "number" &&
            typeof p?.w === "number" &&
            typeof p?.h === "number"
          ) {
            saved = p;
          }
        }
      } catch {
        /* 저장값이 깨졌으면 무시하고 기본값 사용 */
      }
      setRect(
        clampToViewport(saved ?? defaultRect({ w: vw, h: vh }), minW, minH)
      );
    };
    init();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 변경 시 저장
  useEffect(() => {
    if (!rect) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(rect));
    } catch {
      /* 저장 실패는 무시 (시크릿 모드 등) */
    }
  }, [rect, storageKey]);

  // 창 크기가 바뀌면 화면 안으로 되돌림
  useEffect(() => {
    const onResize = () =>
      setRect((r) => (r ? clampToViewport(r, minW, minH) : r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minW, minH]);

  /** 드래그/리사이즈 공용 제스처 처리 */
  const gesture = useRef<{
    mode: "move" | ResizeDir;
    startX: number;
    startY: number;
    start: Rect;
  } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      const s = g.start;

      let next: Rect;
      if (g.mode === "move") {
        next = { ...s, x: s.x + dx, y: s.y + dy };
      } else {
        let { x, y, w, h } = s;
        const dir = g.mode;
        if (dir.includes("e")) w = s.w + dx;
        if (dir.includes("s")) h = s.h + dy;
        if (dir.includes("w")) {
          // 왼쪽으로 늘리면 x가 따라 움직인다. 최소폭에서 멈추도록 보정.
          const newW = Math.max(minW, s.w - dx);
          x = s.x + (s.w - newW);
          w = newW;
        }
        if (dir.includes("n")) {
          const newH = Math.max(minH, s.h - dy);
          y = s.y + (s.h - newH);
          h = newH;
        }
        next = { x, y, w, h };
      }
      setRect(clampToViewport(next, minW, minH));
    },
    [minW, minH]
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
    setInteracting(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endGesture);
    window.removeEventListener("pointercancel", endGesture);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, [onPointerMove]);

  const startGesture = useCallback(
    (mode: "move" | ResizeDir, e: React.PointerEvent) => {
      if (!rect) return;
      // 좌클릭/터치만
      if (e.button !== 0) return;
      e.preventDefault();
      gesture.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        start: rect,
      };
      setInteracting(true);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endGesture);
      window.addEventListener("pointercancel", endGesture);
      // 드래그 중 텍스트 선택 방지
      document.body.style.userSelect = "none";
      if (mode !== "move") document.body.style.cursor = `${mode}-resize`;
    },
    [rect, onPointerMove, endGesture]
  );

  // 언마운트 시 리스너 정리
  useEffect(() => endGesture, [endGesture]);

  /** 화면 기본 위치로 되돌리기 */
  const reset = useCallback(() => {
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    setRect(clampToViewport(defaultRect(viewport), minW, minH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minW, minH]);

  return {
    rect,
    interacting,
    /** 헤더에 붙임: onPointerDown={dragProps.onPointerDown} */
    dragProps: {
      onPointerDown: (e: React.PointerEvent) => startGesture("move", e),
    },
    /** 리사이즈 손잡이에 붙임 */
    resizeProps: (dir: ResizeDir) => ({
      onPointerDown: (e: React.PointerEvent) => startGesture(dir, e),
    }),
    setRect,
    reset,
  };
}

/** 8방향 리사이즈 손잡이의 위치/커서 CSS */
export const RESIZE_HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: "n", className: "top-0 left-3 right-3 h-1.5 cursor-n-resize" },
  { dir: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-s-resize" },
  { dir: "w", className: "left-0 top-3 bottom-3 w-1.5 cursor-w-resize" },
  { dir: "e", className: "right-0 top-3 bottom-3 w-1.5 cursor-e-resize" },
  { dir: "nw", className: "top-0 left-0 size-3 cursor-nw-resize" },
  { dir: "ne", className: "top-0 right-0 size-3 cursor-ne-resize" },
  { dir: "sw", className: "bottom-0 left-0 size-3 cursor-sw-resize" },
  { dir: "se", className: "bottom-0 right-0 size-3 cursor-se-resize" },
];
