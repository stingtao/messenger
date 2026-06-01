import React, { useEffect, useRef, useState } from 'react';
import { User, CallSignal } from '../types';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from 'lucide-react';
import { websocketUrl } from '../lib/api';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: User;
  currentUser: User;
  callType: 'audio' | 'video';
  chatId: string;
  incomingCall?: CallSignal;
}

const servers: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

export default function CallModal({ isOpen, onClose, targetUser, currentUser, callType, chatId, incomingCall }: CallModalProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(callType === 'audio');
  const [callStatus, setCallStatus] = useState<'calling' | 'ringing' | 'connected' | 'ended'>(incomingCall ? 'ringing' : 'calling');
  const [isReceiving, setIsReceiving] = useState(Boolean(incomingCall));
  const [isSignalReady, setIsSignalReady] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const callIdRef = useRef<string | null>(incomingCall?.id ?? null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const remoteCandidateQueue = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch((error) => {
        console.warn('Remote audio playback was blocked:', error);
      });
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!isOpen) return;

    const ws = new WebSocket(websocketUrl(`/api/ws/chat/${encodeURIComponent(chatId)}`));
    wsRef.current = ws;

    ws.onopen = () => {
      setIsSignalReady(true);
      if (!incomingCall) {
        setupCaller().catch((error) => {
          console.error('Error starting call:', error);
          handleClose(false);
        });
      }
    };

    ws.onmessage = async (event) => {
      const payload = JSON.parse(event.data);

      if (payload.type === 'incoming_call' && payload.call.callerId === currentUser.uid) {
        callIdRef.current = payload.call.id;
        flushPendingCandidates();
      }

      if (payload.type === 'call_answer' && payload.from !== currentUser.uid && payload.answer) {
        await pc.current?.setRemoteDescription(new RTCSessionDescription(payload.answer));
        await flushRemoteCandidateQueue();
        setCallStatus('connected');
      }

      if (payload.type === 'ice_candidate' && payload.from !== currentUser.uid && payload.candidate) {
        await addRemoteCandidate(payload.candidate);
      }

      if (payload.type === 'call_hangup' && payload.from !== currentUser.uid) {
        handleClose(false);
      }
    };

    ws.onerror = (error) => console.error('Call websocket error:', error);

    return () => {
      setIsSignalReady(false);
      ws.close();
      cleanupMedia();
    };
  }, [isOpen, chatId]);

  const sendSignal = (payload: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const flushPendingCandidates = () => {
    const callId = callIdRef.current;
    if (!callId) return;
    for (const candidate of pendingCandidates.current) {
      sendSignal({ type: 'ice_candidate', callId, candidate });
    }
    pendingCandidates.current = [];
  };

  const addRemoteCandidate = async (candidate: RTCIceCandidateInit) => {
    const connection = pc.current;
    if (!connection?.remoteDescription) {
      remoteCandidateQueue.current.push(candidate);
      return;
    }

    try {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('Remote ICE candidate could not be added:', error);
    }
  };

  const flushRemoteCandidateQueue = async () => {
    const queued = remoteCandidateQueue.current;
    remoteCandidateQueue.current = [];
    for (const candidate of queued) {
      await addRemoteCandidate(candidate);
    }
  };

  const createPeer = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: callType === 'video',
      audio: true,
    });
    setLocalStream(stream);

    const connection = new RTCPeerConnection(servers);
    pc.current = connection;
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') setCallStatus('connected');
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        console.warn('WebRTC connection state:', connection.connectionState);
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'failed' || connection.iceConnectionState === 'disconnected') {
        console.warn('ICE connection state:', connection.iceConnectionState);
      }
    };

    connection.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      setCallStatus('connected');
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      const callId = callIdRef.current;
      if (callId) {
        sendSignal({ type: 'ice_candidate', callId, candidate });
      } else {
        pendingCandidates.current.push(candidate);
      }
    };

    return connection;
  };

  const setupCaller = async () => {
    const connection = await createPeer();
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    sendSignal({ type: 'call_start', callType, offer });
  };

  const handleAnswer = async () => {
    if (!incomingCall?.offer || !isSignalReady) return;
    setIsReceiving(false);

    const connection = await createPeer();
    await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    await flushRemoteCandidateQueue();
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    sendSignal({ type: 'call_answer', callId: incomingCall.id, answer });
    setCallStatus('connected');
  };

  const cleanupMedia = () => {
    localStream?.getTracks().forEach((track) => track.stop());
    pc.current?.close();
  };

  const handleClose = (notifyPeer = true) => {
    if (notifyPeer && callIdRef.current) {
      sendSignal({ type: 'call_hangup', callId: callIdRef.current });
    }
    setCallStatus('ended');
    cleanupMedia();
    onClose();
  };

  const toggleMute = () => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = isMuted;
    setIsMuted(!isMuted);
  };

  const toggleVideo = () => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (!videoTrack || callType !== 'video') return;
    videoTrack.enabled = isVideoOff;
    setIsVideoOff(!isVideoOff);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center">
      <div className="absolute top-8 text-center text-white">
        <h2 className="text-2xl font-semibold mb-2">{targetUser.displayName}</h2>
        <p className="text-gray-400 capitalize">{callStatus}...</p>
      </div>

      <div className="relative w-full max-w-4xl aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {callType === 'video' ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <div className="w-32 h-32 bg-gray-800 rounded-full flex items-center justify-center">
              <span className="text-5xl text-white">{targetUser.displayName?.charAt(0) || '?'}</span>
            </div>
          </div>
        )}

        {callType === 'video' && (
          <div className="absolute bottom-4 right-4 w-48 aspect-video bg-gray-800 rounded-xl overflow-hidden border-2 border-gray-700 shadow-lg">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      <div className="absolute bottom-12 flex items-center gap-6">
        {isReceiving ? (
          <>
            <button
              onClick={handleAnswer}
              disabled={!isSignalReady}
              className="p-4 rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Phone className="w-8 h-8" />
            </button>
            <button onClick={() => handleClose()} className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors">
              <PhoneOff className="w-8 h-8" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-500 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {callType === 'video' && (
              <button
                onClick={toggleVideo}
                className={`p-4 rounded-full transition-colors ${isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
              >
                {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
              </button>
            )}

            <button onClick={() => handleClose()} className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors">
              <PhoneOff className="w-8 h-8" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
