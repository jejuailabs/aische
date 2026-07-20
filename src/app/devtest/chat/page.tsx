'use client';
// 개발용 검증 페이지 — 검증 후 삭제.
import { ChatPanel } from '@/components/chat/chat-panel';
export default function ChatDevtest() {
  return (
    <div className="h-dvh bg-neutral-100 p-4">
      <p className="text-xs">floating chat devtest</p>
      <ChatPanel variant="floating" />
    </div>
  );
}
