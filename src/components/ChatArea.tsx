import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, Message } from '../types';
import { ArrowLeft, Image as ImageIcon, Phone, Video, Send } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import CallModal from './CallModal';
import { api, websocketUrl } from '../lib/api';
import { makeChatId } from '../shared/chat';

interface ChatAreaProps {
  selectedUser: User;
  onBack: () => void;
}

export default function ChatArea({ selectedUser, onBack }: ChatAreaProps) {
  const { user: currentUser } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const chatId = currentUser ? makeChatId(currentUser.uid, selectedUser.uid) : '';

  useEffect(() => {
    if (!chatId) return;

    let alive = true;

    api.messages(chatId)
      .then((result) => {
        if (!alive) return;
        setMessages(result.messages);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .catch((error) => console.error('Error loading messages:', error));

    const ws = new WebSocket(websocketUrl(`/api/ws/chat/${encodeURIComponent(chatId)}`));
    wsRef.current = ws;
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'message') {
        setMessages((current) => {
          if (current.some((message) => message.id === payload.message.id)) return current;
          return [...current, payload.message];
        });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
      if (payload.type === 'typing' && payload.userId === selectedUser.uid) {
        setOtherUserTyping(Boolean(payload.typing));
      }
      if (payload.type === 'call_hangup') {
        setIsCallModalOpen(false);
      }
    };
    ws.onerror = (error) => console.error('Chat websocket error:', error);

    return () => {
      alive = false;
      ws.close();
      wsRef.current = null;
    };
  }, [chatId, selectedUser.uid]);

  const sendRealtime = (payload: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const updateTypingStatus = (typing: boolean) => {
    if (!currentUser || !chatId) return;
    sendRealtime({ type: 'typing', typing });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!isTyping) {
      setIsTyping(true);
      updateTypingStatus(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      updateTypingStatus(false);
    }, 2000);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newMessage.trim() || !currentUser) return;

    const text = newMessage;
    setNewMessage('');
    
    setIsTyping(false);
    updateTypingStatus(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    const sent = sendRealtime({ type: 'send_message', text });
    if (!sent) {
      setNewMessage(text);
      console.error('Chat websocket is not connected');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be smaller than 5MB');
      return;
    }

    try {
      const { message } = await api.uploadAttachment(chatId, file);
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Image upload failed');
    } finally {
      e.target.value = '';
    }
  };

  const startCall = (type: 'audio' | 'video') => {
    setCallType(type);
    setIsCallModalOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#82a498]">
      {/* Header */}
      <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-gray-800">{selectedUser.displayName}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => startCall('audio')} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <Phone className="w-5 h-5" />
          </button>
          <button onClick={() => startCall('video')} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <Video className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isMine = msg.senderId === currentUser?.uid;
          return (
            <div key={msg.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2 shadow-sm relative",
                isMine ? "bg-[#06C755] text-white rounded-tr-sm" : "bg-white text-gray-800 rounded-tl-sm"
              )}>
                {msg.imageUrl ? (
                  <img src={msg.imageUrl} alt="Attachment" className="max-w-full rounded-lg mt-1 mb-1" />
                ) : (
                  <p className="break-words">{msg.text}</p>
                )}
                <span className={cn(
                  "text-[10px] absolute bottom-1",
                  isMine ? "-left-10 text-gray-600" : "-right-10 text-gray-600"
                )}>
                  {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}
                </span>
              </div>
            </div>
          );
        })}
        {otherUserTyping && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-500 rounded-2xl rounded-tl-sm px-4 py-2 shadow-sm text-sm italic">
              typing...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white p-3 border-t border-gray-200">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ImageIcon className="w-6 h-6" />
          </button>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleImageUpload}
          />
          <input
            type="text"
            value={newMessage}
            onChange={handleTyping}
            placeholder="Aa"
            className="flex-1 bg-gray-100 rounded-full py-2 px-4 focus:outline-none focus:ring-2 focus:ring-[#06C755]"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="p-2 text-[#06C755] hover:bg-green-50 rounded-full transition-colors disabled:opacity-50"
          >
            <Send className="w-6 h-6" />
          </button>
        </form>
      </div>

      {isCallModalOpen && currentUser && (
        <CallModal
          isOpen={isCallModalOpen}
          onClose={() => setIsCallModalOpen(false)}
          targetUser={selectedUser}
          currentUser={currentUser}
          callType={callType}
          chatId={chatId}
        />
      )}
    </div>
  );
}
