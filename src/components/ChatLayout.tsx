import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import CallModal from './CallModal';
import { CallSignal, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { api, websocketUrl } from '../lib/api';

export default function ChatLayout() {
  const { user: currentUser } = useAuth();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);
  const [callerUser, setCallerUser] = useState<User | null>(null);

  useEffect(() => {
    if (!currentUser) return;

    const resolveCaller = async (call: CallSignal) => {
      const users = await api.users();
      const caller = users.users.find((item) => item.uid === call.callerId);
      if (caller) {
        setCallerUser(caller);
        setIncomingCall(call);
      }
    };

    api.incomingCalls()
      .then((result) => {
        const call = result.calls[0];
        if (call) resolveCaller(call);
      })
      .catch((error) => console.error('Error loading incoming calls:', error));

    const ws = new WebSocket(websocketUrl('/api/ws/user'));
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'incoming_call' && payload.call.receiverId === currentUser.uid) {
        resolveCaller(payload.call).catch((error) => console.error('Error resolving caller:', error));
      }
      if (payload.type === 'call_hangup') {
        setIncomingCall(null);
        setCallerUser(null);
      }
    };
    ws.onerror = (error) => console.error('User websocket error:', error);

    return () => ws.close();
  }, [currentUser]);

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      <Sidebar selectedUser={selectedUser} onSelectUser={setSelectedUser} />
      {selectedUser ? (
        <ChatArea selectedUser={selectedUser} onBack={() => setSelectedUser(null)} />
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-[#a9c0a6] bg-opacity-20">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-700 mb-2">Welcome to LINE Clone</h2>
            <p className="text-gray-500">Select a chat to start messaging</p>
          </div>
        </div>
      )}

      {incomingCall && callerUser && currentUser && (
        <CallModal
          isOpen={true}
          onClose={() => setIncomingCall(null)}
          targetUser={callerUser}
          currentUser={currentUser}
          callType={incomingCall.type}
          chatId={incomingCall.chatId}
          incomingCall={incomingCall}
        />
      )}
    </div>
  );
}
