export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  status: string;
  lastSeen: string;
}

export interface Message {
  id: string;
  chatId: string;
  text: string;
  imageUrl?: string;
  senderId: string;
  receiverId: string;
  timestamp: string;
}

export interface CallSignal {
  id: string;
  chatId: string;
  callerId: string;
  receiverId: string;
  type: 'audio' | 'video';
  status: 'calling' | 'connected' | 'ended';
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  updatedAt?: string;
}
