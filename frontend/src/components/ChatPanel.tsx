import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  connected: boolean;
  onSend: (text: string) => void;
}

export default function ChatPanel({ messages, connected, onSend }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={m.system ? 'sys' : ''}>
            {m.system ? m.text : <><b>{m.name}</b>: {m.text}</>}
          </div>
        ))}
      </div>
      <input
        value={text}
        placeholder={connected ? '팀 채팅 (Enter)' : '연결 중...'}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            onSend(text.trim());
            setText('');
          }
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
