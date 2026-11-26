import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatWindow({ messages, onEdit, onRegenerate, onPermissionDecision }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
      <div className="max-w-3xl mx-auto space-y-2">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onEdit={msg.role === 'user' ? onEdit : undefined}
            onRegenerate={msg.role === 'assistant' && !msg.isTyping && !msg.permissionPrompt ? onRegenerate : undefined}
            onPermissionDecision={msg.permissionPrompt ? onPermissionDecision : undefined}
          />
        ))}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}
