// 팀 채팅. 게임 중 Enter 로 입력을 시작하면 마우스 고정을 유지한 채 쓸 수 있다.
// 입력 중이 아닐 때는 새 메시지만 잠깐 진하게 보였다가 흐려진다.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ChatMessage } from '../types';

interface Props {
  messages: ChatMessage[];
  connected: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onSend: (text: string) => void;
  onDone: () => void; // 보내거나 취소했을 때 → 게임으로 복귀
}

export default function ChatPanel({ messages, connected, inputRef, onSend, onDone }: Props) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [fresh, setFresh] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
    if (messages.length === 0) return;
    setFresh(true);
    const id = window.setTimeout(() => setFresh(false), 6000);
    return () => window.clearTimeout(id);
  }, [messages]);

  return (
    <div className={`chat ${focused ? 'typing' : fresh ? '' : 'idle'}`}>
      <div className="chat-list" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={m.system ? 'sys' : ''}>
            {m.system ? m.text : <><b>{m.name}</b>: {m.text}</>}
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        value={text}
        placeholder={connected ? (focused ? '메시지 입력 후 Enter · ESC 취소' : 'Enter 로 팀 채팅') : '연결 중...'}
        maxLength={300}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // 채팅 중 E·M·I 등 단축키가 동작하지 않게
          if (e.key === 'Enter') {
            if (text.trim()) onSend(text.trim());
            setText('');
            e.currentTarget.blur();
            onDone();
          }
          if (e.key === 'Escape') {
            setText('');
            e.currentTarget.blur();
            onDone();
          }
        }}
      />
    </div>
  );
}
