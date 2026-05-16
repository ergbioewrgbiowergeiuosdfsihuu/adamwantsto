import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Phone, Video, MonitorUp, Settings, Image as ImageIcon,
  Send, Trash2, BellOff, Bell, Users, X, User, Check, Mic, MicOff,
  MessageSquare, Plus, Maximize, Globe, Loader2, Menu, Minimize2, VideoOff, PhoneOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

// Initialize the socket
const socket = io();

const isScreenShareSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getDisplayMedia;

const useAudioLevel = (stream: MediaStream | null) => {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream) {
      setIsSpeaking(false);
      return;
    }
    
    if (stream.getAudioTracks().length === 0) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      let animationFrame: number;
      let silenceCount = 0;
      
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        
        if (average > 10) {
          setIsSpeaking(true);
          silenceCount = 0;
        } else {
          silenceCount++;
          if (silenceCount > 10) {
            setIsSpeaking(false);
          }
        }
        animationFrame = requestAnimationFrame(checkLevel);
      };
      checkLevel();
      
      return () => {
        cancelAnimationFrame(animationFrame);
        source.disconnect();
        if (audioContext.state !== 'closed') audioContext.close().catch(() => {});
      };
    } catch {
      // Ignore
    }
  }, [stream]);

  return isSpeaking;
};

const LocalVideoTile = ({ stream, isVideoOff, isMuted, currentUser, localVideoRef }: { stream: MediaStream | null, isVideoOff: boolean, isMuted: boolean, currentUser: UserProfile | null, localVideoRef: React.RefObject<HTMLVideoElement> }) => {
  const isSpeaking = useAudioLevel(stream);
  
  useEffect(() => {
    if (localVideoRef.current && stream && !isVideoOff) {
      if (localVideoRef.current.srcObject !== stream) {
        localVideoRef.current.srcObject = stream;
      }
    }
  }, [stream, isVideoOff, localVideoRef]);

  return (
    <div className={`relative rounded-3xl overflow-hidden bg-neutral-800 shadow-2xl border border-white/5 ring-1 group transition-all duration-300 w-full h-full ${isSpeaking ? 'ring-4 ring-emerald-500' : 'ring-white/10'}`}>
       {!isVideoOff ? (
         <>
           <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
           <button onClick={() => { if(localVideoRef.current) { if(document.fullscreenElement) document.exitFullscreen(); else localVideoRef.current.requestFullscreen(); } }} className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity" title="Fullscreen">
             <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
           </button>
         </>
       ) : (
         <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-blue-900 to-indigo-950">
           <img src={currentUser?.avatar} alt="me" className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-[4px] shadow-xl object-cover transition-all duration-300 ${isSpeaking ? 'border-emerald-500 scale-105' : 'border-transparent'}`} />
         </div>
       )}
       <div className="absolute bottom-4 left-4 z-20 text-white font-bold bg-black/50 px-3 py-1 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2">
          <User className="w-3 h-3 text-emerald-400" /> You
       </div>
       {isMuted && (
         <div className="absolute top-4 right-4 z-20 bg-red-500 p-1.5 rounded-full shadow-lg">
           <MicOff className="w-4 h-4 text-white" />
         </div>
       )}
    </div>
  );
};

const RemoteVideo = ({ stream, user, audioDeviceId }: { stream: MediaStream, user?: UserProfile, key?: React.Key, audioDeviceId?: string | null }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [videoTrackCount, setVideoTrackCount] = useState(stream.getVideoTracks().length);
  const isSpeaking = useAudioLevel(stream);

  useEffect(() => {
    const updateCount = () => setVideoTrackCount(stream.getVideoTracks().length);
    stream.addEventListener('addtrack', updateCount);
    stream.addEventListener('removetrack', updateCount);
    
    // Fallback polling
    const interval = setInterval(updateCount, 1000);
    return () => {
      stream.removeEventListener('addtrack', updateCount);
      stream.removeEventListener('removetrack', updateCount);
      clearInterval(interval);
    };
  }, [stream]);

  const audioOnly = videoTrackCount === 0;

  useEffect(() => {
    if (ref.current) {
      if (ref.current.srcObject !== stream) {
        ref.current.srcObject = stream;
      }
      
      if (audioDeviceId && typeof (ref.current as any).setSinkId === 'function') {
        (ref.current as any).setSinkId(audioDeviceId).catch(console.error);
      }

      // Ensure audio is unmuted and playing
      ref.current.onloadedmetadata = () => {
        ref.current?.play().catch(console.error);
      };
    }
  }, [stream, audioOnly, audioDeviceId]);

  return (
    <div className={`relative rounded-3xl overflow-hidden bg-neutral-800 shadow-2xl border border-white/5 ring-1 group transition-all duration-300 w-full h-full ${isSpeaking ? 'ring-4 ring-emerald-500' : 'ring-white/10'}`}>
      {audioOnly ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-900 to-purple-950">
           <img src={user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg'} alt="user" className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full border-[4px] shadow-xl object-cover transition-all duration-300 ${isSpeaking ? 'border-emerald-500 scale-105' : 'border-transparent'}`} />
           <video ref={ref} autoPlay playsInline className="hidden" />
        </div>
      ) : (
        <>
          <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          <button onClick={() => { if(ref.current) { if(document.fullscreenElement) document.exitFullscreen(); else ref.current.requestFullscreen(); } }} className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity" title="Fullscreen">
             <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </>
      )}
      <div className="absolute bottom-4 left-4 z-20 text-white font-bold bg-black/50 px-3 py-1 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2">
         {user?.nickname || 'Unknown'}
      </div>
    </div>
  );
};

const MessageAudioPlayer = ({ src, effect }: { src: string, effect: string }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current) {
      // @ts-ignore
      audioRef.current.preservesPitch = false; 
      if (effect === 'chipmunk') audioRef.current.playbackRate = 1.6;
      else if (effect === 'deep') audioRef.current.playbackRate = 0.6;
      else audioRef.current.playbackRate = 1.0;
    }
  }, [effect]);
  return (
    <div className="mt-2 bg-neutral-900 rounded-lg p-2 max-w-full">
      <div className="text-[10px] text-emerald-400 mb-1 uppercase font-bold tracking-wider">
        {effect !== 'none' ? `${effect} filter` : 'Voice Message'}
      </div>
      <audio ref={audioRef} controls src={src} className="h-8 w-full outline-none" />
    </div>
  );
};

type UserProfile = { id: string; nickname: string; avatar: string; isOnline: boolean; typingIn?: string; };
type ChatSession = { id: string; isGroup: boolean; name: string; avatar: string; members: string[]; createdAt: number; };
type Message = { id: string; senderId: string; text?: string; imageUrl?: string; audioUrl?: string; voiceEffect?: string; timestamp: number; };

const GLOBAL_CHAT: ChatSession = { id: 'global', isGroup: true, name: 'Nexus Global', avatar: 'https://api.dicebear.com/7.x/shapes/svg?seed=nexus', members: [], createdAt: 0 };

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([GLOBAL_CHAT]);
  const [activeChatId, setActiveChatId] = useState('global');
  const activeChatIdRef = useRef('global');

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const [messages, setMessages] = useState<Message[]>([]);
  
  const [authName, setAuthName] = useState('');
  const [inputText, setInputText] = useState('');
  
  // New Chat
  const [showNewChat, setShowNewChat] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  // Sidebar controls
  const [showSidebar, setShowSidebar] = useState(window.innerWidth > 768);
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState('');

  // Voice & Call
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEffect, setVoiceEffect] = useState<'none' | 'chipmunk' | 'deep'>('none');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [callState, setCallState] = useState<'idle' | 'calling' | 'active'>('idle');
  const [callType, setCallType] = useState<'audio' | 'video' | 'screen' | null>(null);
  const [callParticipants, setCallParticipants] = useState<string[]>([]);
  const [isPip, setIsPip] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);
  const [availableAudioDevices, setAvailableAudioDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      // Some browsers require permissions first; this works best if permissions were already granted
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        setAvailableAudioDevices(audioOutputs);
      }).catch(console.error);

      const onDeviceChange = () => {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
          setAvailableAudioDevices(audioOutputs);
        }).catch(console.error);
      };
      
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    }
  }, []);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  const typingTimeoutRef = useRef<NodeJS.Timeout>();

  // Socket communication
  useEffect(() => {
    const stored = localStorage.getItem('nexus_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCurrentUser(parsed);
        socket.emit("register_user", parsed);
      } catch (e) {}
    }
    
    const onConnect = () => {
      const stored = localStorage.getItem('nexus_user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          socket.emit("register_user", parsed);
          if (activeChatIdRef.current) {
            socket.emit("join_chat", activeChatIdRef.current);
          }
        } catch (e) {}
      }
    };
    
    socket.on('connect', onConnect);

    socket.on('state_update', (state) => {
      setUsers(state.users);
      setChats([GLOBAL_CHAT, ...state.chats.filter((c: any) => c.id !== 'global').sort((a: any, b: any) => b.createdAt - a.createdAt)]);
    });

    socket.on('messages_update', (data) => {
      if (data.chatId === activeChatIdRef.current) {
        setMessages(data.messages);
      }
    });

    socket.on('new_message', (msg) => {
      if (msg.chatId === activeChatIdRef.current) {
        setMessages(prev => [...prev, msg]);
      }
    });

    socket.on('call_state_update', (data) => {
      if (data.chatId === activeChatIdRef.current) {
        setCallParticipants(data.participants);
        if (data.participants.length === 0) {
          endCall();
        }
      }
    });

    socket.on('register_error', (msg) => {
      alert(msg);
      localStorage.removeItem('nexus_user');
      setCurrentUser(null);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('state_update');
      socket.off('messages_update');
      socket.off('new_message');
      socket.off('call_state_update');
      socket.off('register_error');
    };
  }, []);

  useEffect(() => {
    if (activeChatId) {
      socket.emit('join_chat', activeChatId);
    }
  }, [activeChatId]);

  const checkKownerAccess = (name: string) => {
    if (name?.trim()?.toLowerCase() === 'kowner') {
      alert("Kowner name is reserved. If you are admin, append !admin to the name (e.g. kowner!admin).");
      return false;
    }
    return true;
  };

  const getProcessedName = (name: string) => {
    if (name?.trim()?.toLowerCase() === 'kowner!admin') return 'Kowner';
    return name?.trim() || '';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authName.trim()) return;
    if (!checkKownerAccess(authName)) return;

    try {
      const uid = uuidv4();
      const me = {
        id: uid,
        nickname: getProcessedName(authName),
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}`,
        isOnline: true,
        typingIn: ''
      };
      localStorage.setItem('nexus_user', JSON.stringify(me));
      setCurrentUser(me);
      socket.emit("register_user", me);
    } catch (e) {
      console.error("Error joining: " + e);
    }
  };

  // --- RECORDING & IMAGE ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => handleSendMessage('', undefined, reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const requestStopRecordingRef = useRef(false);

  const startRecording = async () => {
    requestStopRecordingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestStopRecordingRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = () => handleSendMessage('', reader.result as string, undefined);
          reader.readAsDataURL(blob);
          audioChunksRef.current = [];
        }
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    requestStopRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // --- MESSAGING ---
  const handleSendMessage = async (text: string, audioUrl?: string, imageUrl?: string) => {
    if (!currentUser || (!text.trim() && !audioUrl && !imageUrl)) return;
    
    socket.emit('send_message', {
      chatId: activeChatId,
      senderId: currentUser.id,
      text: text.trim(),
      audioUrl,
      imageUrl,
      voiceEffect: audioUrl ? voiceEffect : undefined
    });
    setInputText('');
    
    // Clear typing indicator
    socket.emit('typing', null);
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!currentUser) return;
    socket.emit('typing', activeChatId);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing', null);
    }, 2000);
  };

  // --- CALL LOGIC & WEBRTC MESH ---
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const createPeerConnection = (targetUserId: string, isInitiator: boolean) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    (peer as any).makingOffer = false;
    (peer as any).ignoreOffer = false;
    (peer as any).isPolite = currentUser?.id ? currentUser.id > targetUserId : !isInitiator;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc_signal", { targetId: targetUserId, signal: { type: 'ice', candidate: event.candidate } });
      }
    };

    peer.ontrack = (event) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.set(targetUserId, event.streams[0]);
        return next;
      });
    };

    peer.onnegotiationneeded = async () => {
      try {
        (peer as any).makingOffer = true;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (peer.localDescription) {
          socket.emit("webrtc_signal", { targetId: targetUserId, signal: peer.localDescription });
        }
      } catch (err) {
        console.error("Renegotiation failed", err);
      } finally {
        (peer as any).makingOffer = false;
      }
    };

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        peer.addTrack(track, mediaStreamRef.current!);
      });
    }

    peersRef.current.set(targetUserId, peer);
    return peer;
  };

  useEffect(() => {
    const handleUserJoined = (userId: string) => {
      if (callState === 'active' || callState === 'calling') {
        createPeerConnection(userId, true);
      }
    };

    const handleUserLeft = (userId: string) => {
      const peer = peersRef.current.get(userId);
      if (peer) {
        peer.close();
        peersRef.current.delete(userId);
      }
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    };

    const handleSignal = async (data: { signal: any, fromId: string }) => {
      if (data.fromId === currentUser?.id) return;
      if (!peersRef.current.has(data.fromId) && data.signal.type === 'offer') {
        createPeerConnection(data.fromId, false);
      }
      
      const peer = peersRef.current.get(data.fromId);
      if (!peer) return;

      try {
        const description = data.signal.type === 'offer' || data.signal.type === 'answer' ? data.signal : null;
        if (description) {
          const offerCollision = (description.type === 'offer') && ((peer as any).makingOffer || peer.signalingState !== 'stable');
          (peer as any).ignoreOffer = !(peer as any).isPolite && offerCollision;
          
          if ((peer as any).ignoreOffer) {
            return;
          }
          
          await peer.setRemoteDescription(new RTCSessionDescription(description)); 
          
          if ((peer as any).iceQueue) {
            for (const cand of (peer as any).iceQueue) {
              await peer.addIceCandidate(cand).catch(err => console.error('Queued ICE err', err));
            }
            (peer as any).iceQueue = [];
          }

          if (description.type === 'offer') {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit("webrtc_signal", { targetId: data.fromId, signal: peer.localDescription });
          }
        } else if (data.signal.type === 'ice') {
          try {
            if (peer.remoteDescription) {
              await peer.addIceCandidate(data.signal.candidate);
            } else {
              if (!(peer as any).iceQueue) (peer as any).iceQueue = [];
              (peer as any).iceQueue.push(data.signal.candidate);
            }
          } catch(err) {
            if (!(peer as any).ignoreOffer) console.error("ICE candidate error", err);
          }
        }
      } catch (err) {
        console.error("WebRTC Error:", err);
      }
    };

    socket.on("user_joined_call", handleUserJoined);
    socket.on("user_left_call", handleUserLeft);
    socket.on("webrtc_signal", handleSignal);

    return () => {
      socket.off("user_joined_call", handleUserJoined);
      socket.off("user_left_call", handleUserLeft);
      socket.off("webrtc_signal", handleSignal);
    };
  }, [callState, currentUser]);

  const applyVoiceFilter = (stream: MediaStream, effect: string) => {
    if (effect === 'none') return stream;
    try {
      const ctx = new window.AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const filter = ctx.createBiquadFilter();
      
      if (effect === 'deep') { filter.type = 'lowpass'; filter.frequency.value = 400; } 
      else if (effect === 'chipmunk') { filter.type = 'highpass'; filter.frequency.value = 1500; }
      
      const dest = ctx.createMediaStreamDestination();
      source.connect(filter);
      filter.connect(dest);
      
      return new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch {
      return stream; // Fallback if AudioContext fails
    }
  };

  const replaceVideoTrack = async (type: 'video' | 'screen') => {
    if (!mediaStreamRef.current) return;
    try {
      let newStream;
      if (type === 'screen') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          alert("Screen sharing is not supported on this device/browser (mobile browsers do not support this feature). If you are on desktop, please open the app in a new tab.");
          return;
        }
        newStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } else {
        newStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      if (newVideoTrack) {
        let oldVideoTrack = mediaStreamRef.current.getVideoTracks()[0];
        if (oldVideoTrack) {
          oldVideoTrack.stop();
          mediaStreamRef.current.removeTrack(oldVideoTrack);
        }
        mediaStreamRef.current.addTrack(newVideoTrack);
        
        peersRef.current.forEach(peer => {
          const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(newVideoTrack).catch(console.error);
          } else {
            peer.addTrack(newVideoTrack, mediaStreamRef.current!);
          }
        });
        
        setIsVideoOff(false);
        setCallType(type);
        
        // When user stops screen sharing from browser UI
        if (type === 'screen') {
          newVideoTrack.onended = () => {
             replaceVideoTrack('video').catch(console.error);
          };
        }
      }
    } catch (e) {
      console.error("Failed to replace video track", e);
    }
  };

  const startCall = async (type: 'audio' | 'video' | 'screen') => {
    // If already in a call, just update settings/join existing
    if (callState !== 'idle') {
      if (type === 'video' || type === 'screen') {
        await replaceVideoTrack(type);
      }
      return;
    }

    try {
      let stream;
      if (type === 'screen') {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          alert("Screen sharing is not supported on this device/browser (mobile browsers do not support this feature). If you are on desktop, please open the app in a new tab.");
          throw new Error("Screen sharing structurally unsupported");
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
      }
      
      setCallState('active');
      setCallType(type);
      setIsMuted(false);
      setIsVideoOff(type === 'audio');
      setIsPip(false);
      
      mediaStreamRef.current = applyVoiceFilter(stream, voiceEffect);
      socket.emit('join_call', activeChatId);
      
      // Only send notification if no one else is currently in a call
      if (callParticipants.length === 0) {
        socket.emit('send_message', {
          chatId: activeChatId,
          senderId: currentUser?.id,
          text: `[SYSTEM_CALL_START:${type}]`,
        });
      }
    } catch (e: any) {
      console.error(e);
      setCallState('idle'); setCallType(null);
    }
  };

  const toggleMute = () => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = async () => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      } else {
        // We probably started as audio-only, so add camera track now
        await replaceVideoTrack('video');
      }
    }
  };

  const endCall = () => {
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setCallState('idle'); setCallType(null);
    setIsPip(false);
    socket.emit('leave_call', activeChatId);
    peersRef.current.forEach(peer => peer.close());
    peersRef.current.clear();
    setRemoteStreams(new Map());
  };

  const toggleFullscreen = () => {
    if (localVideoRef.current) {
      if (document.fullscreenElement) document.exitFullscreen();
      else localVideoRef.current.requestFullscreen();
    }
  };

  // --- NEW CHAT ---
  const handleCreateChat = async () => {
    if (selectedUsers.size === 0 || !currentUser) return;
    const members = [currentUser.id, ...Array.from(selectedUsers)];
    const isGroup = members.length > 2;
    const usernames = members.map(uid => users.find(u => u.id === uid)?.nickname || 'User');
    const name = isGroup ? `Group: ${usernames.slice(0,3).join(', ')}...` : users.find(u => u.id === Array.from(selectedUsers)[0])?.nickname || 'Private Chat';
    
    socket.emit('create_chat', {
      id: uuidv4(),
      name, isGroup, members, createdAt: Date.now()
    });
    setShowNewChat(false);
    setSelectedUsers(new Set());
  };

  // --- ADMIN FUNCTIONS ---
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const isAdmin = currentUser?.nickname?.trim()?.toLowerCase() === 'kowner';

  const handleAdminClearChat = async () => {
    if (!isAdmin) return;
    socket.emit('admin_clear_chat', activeChatIdRef.current);
  };

  const handleAdminDeleteCurrentChat = async () => {
    if (!isAdmin || activeChatIdRef.current === 'global') return;
    socket.emit('admin_delete_chat', activeChatIdRef.current);
    setActiveChatId('global');
  };

  const handleAdminKickUser = async (userId: string) => {
    if (!isAdmin) return;
    socket.emit('admin_kick_user', userId);
  };

  const lastCallMsgId = useMemo(() => {
    const callMsgs = messages.filter(m => m.text?.startsWith('[SYSTEM_CALL_START:'));
    return callMsgs.length > 0 ? callMsgs[callMsgs.length - 1].id : null;
  }, [messages]);

  // --- UI RENDER ---
  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 font-sans text-white relative">
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-20 flex flex-wrap gap-4 p-8">
           {[...Array(20)].map((_, i) => <Globe key={i} className="w-24 h-24 text-emerald-500 animate-pulse" style={{ animationDelay: `${i * 0.2}s`}}/>)}
        </div>
        <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm z-10 shadow-2xl">
          <h1 className="text-3xl font-bold text-center text-emerald-500 mb-2 tracking-tight">Nexus Social</h1>
          <p className="text-center text-neutral-400 mb-8 text-sm">Join the global network</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 mb-1 uppercase tracking-wider">Choose a Nickname</label>
              <input 
                autoFocus required type="text" maxLength={20} value={authName} onChange={e => setAuthName(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 px-4 py-3 rounded-xl text-white outline-none focus:border-emerald-500"
                placeholder="e.g. StarLord99"
              />
            </div>
            <button type="submit" className="w-full bg-emerald-500 hover:bg-emerald-600 font-bold py-3 rounded-xl transition-colors">Enter Server</button>
          </form>
        </div>
      </div>
    );
  }

  const getChatDisplayInfo = (chat: ChatSession) => {
    if (chat.id === 'global') return { name: chat.name, avatar: chat.avatar };
    if (!chat.isGroup) {
      const otherUserId = chat.members.find(id => id !== currentUser?.id);
      const otherUser = users.find(u => u.id === otherUserId);
      return {
        name: otherUser?.nickname || 'Unknown User',
        avatar: otherUser?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg'
      };
    }
    return {
      name: chat.name || 'Group Chat',
      avatar: chat.avatar || 'https://api.dicebear.com/7.x/shapes/svg?seed=' + chat.id
    };
  };

  const activeChat = chats.find(c => c.id === activeChatId) || GLOBAL_CHAT;
  const activeChatDisplay = getChatDisplayInfo(activeChat);
  const typists = users.filter(u => u.typingIn === activeChatIdRef.current && u.id !== currentUser.id && (isAdmin || u.nickname?.trim()?.toLowerCase() !== 'kowner'));
  const displayUsers = users.filter(u => u.id !== currentUser.id && (isAdmin || u.nickname?.trim()?.toLowerCase() !== 'kowner'));

  const getDisplayName = (user: UserProfile) => (!isAdmin && user.nickname?.trim()?.toLowerCase() === 'kowner') ? 'System Admin' : user.nickname;

  return (
    <div className="flex h-[100dvh] w-full bg-neutral-900 text-neutral-100 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <div className={`${showSidebar ? 'w-72 md:w-80' : 'w-0 hidden md:flex'} bg-neutral-950 border-r border-neutral-800 flex-col flex-shrink-0 relative z-20 transition-all duration-300 overflow-hidden`}>
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between whitespace-nowrap">
          <div>
            <h1 className="font-bold text-xl tracking-tight text-emerald-500 flex items-center gap-2">
              <Globe className="w-5 h-5"/> Nexus
            </h1>
            <p className="text-xs text-neutral-500 mt-1">Logged in as {currentUser.nickname}</p>
          </div>
          {isAdmin && (
            <button 
              title="Secret Admin Panel"
              onClick={() => setShowAdminPanel(!showAdminPanel)} 
              className="w-8 h-8 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          
          {/* CHATS LIST */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2">
              <div className="text-xs font-bold tracking-wider text-neutral-500 uppercase">Conversations</div>
              <button title="New Chat" onClick={() => setShowNewChat(!showNewChat)} className="p-1 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {chats.map(chat => {
              const displayInfo = getChatDisplayInfo(chat);
              return (
              <button
                key={chat.id} onClick={() => setActiveChatId(chat.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors ${activeChatId === chat.id ? 'bg-neutral-800 text-white' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
              >
                <img src={displayInfo.avatar} alt="PFP" className="w-10 h-10 rounded-full bg-neutral-900 flex-shrink-0 object-cover" />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate">{displayInfo.name}</div>
                  <div className="text-xs text-neutral-500 truncate mt-0.5">{chat.isGroup ? 'Group / Global' : 'Direct Message'}</div>
                </div>
              </button>
            )})}
          </div>

          {/* ONLINE USERS (For easy DM) */}
          <div className="pt-2 border-t border-neutral-800/50">
             <div className="text-xs font-bold tracking-wider text-neutral-500 uppercase px-2 mb-2 flex items-center gap-2">
               <Users className="w-3 h-3"/> Active Users
             </div>
             {displayUsers.map(user => (
               <div key={user.id} className="w-full flex items-center justify-between p-2 rounded-xl text-neutral-400">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative">
                      <img src={user.avatar} className="w-8 h-8 rounded-full bg-neutral-800" alt="PFP"/>
                      {user.isOnline && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-neutral-950"></div>}
                    </div>
                    <span className="text-sm truncate max-w-[120px]">{getDisplayName(user)}</span>
                  </div>
                    <div className="flex gap-2">
                  {showNewChat && (
                    <button 
                      onClick={() => setSelectedUsers(prev => {
                        const next = new Set(prev);
                        if (next.has(user.id)) next.delete(user.id); else next.add(user.id);
                        return next;
                      })}
                      className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${selectedUsers.has(user.id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-neutral-700 text-transparent hover:border-emerald-500'}`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  )}
                  {showAdminPanel && isAdmin && (
                    <button
                      title="Kick User"
                      onClick={(e) => { e.stopPropagation(); handleAdminKickUser(user.id); }}
                      className="w-5 h-5 rounded flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  </div>
               </div>
             ))}
             {showNewChat && selectedUsers.size > 0 && (
               <button onClick={handleCreateChat} className="w-full mt-3 bg-emerald-500 text-white text-sm font-bold py-2 rounded-lg hover:bg-emerald-600 transition-colors">
                 Start Chat ({selectedUsers.size})
               </button>
             )}
          </div>
        </div>

        {/* CURRENT USER FOOTER */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800 flex items-center gap-3">
          <img src={currentUser.avatar} alt="Me" className="w-10 h-10 rounded-full bg-neutral-800 border-2 border-emerald-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm leading-tight truncate">{currentUser.nickname}</div>
            <div className="text-[10px] uppercase font-bold text-emerald-500">Online</div>
          </div>
          <button 
            onClick={() => { setEditName(currentUser.nickname); setShowSettings(true); }}
            className="p-2 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Edit Profile"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col bg-neutral-900 relative min-w-0">
        
        {/* Chat Header */}
        <div className="h-16 border-b border-neutral-800 flex items-center justify-between px-4 md:px-6 bg-neutral-900 z-10 flex-shrink-0 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setShowSidebar(p => !p)} className="p-2 -ml-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors flex-shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex flex-col min-w-0">
              <h2 className="font-bold text-lg leading-tight truncate">{activeChatDisplay.name}</h2>
              <div className="text-xs text-neutral-400">
                {activeChat.id === 'global' ? 'Everyone is here.' : `${activeChat.members.length} members`}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            <select 
              title="Global Voice Filter"
              value={voiceEffect} onChange={(e) => setVoiceEffect(e.target.value as any)}
              className="bg-neutral-800 text-[10px] uppercase font-bold tracking-wider rounded-lg border border-neutral-700 text-neutral-300 px-2 py-1.5 outline-none hidden sm:block disabled:opacity-50"
              disabled={callState !== 'idle'}
            >
              <option value="none">Normal Voice</option>
              <option value="chipmunk">Chipmunk</option>
              <option value="deep">Deep Voice</option>
            </select>
            <div className="w-px h-6 bg-neutral-800 mx-1 hidden sm:block"></div>
            <button title="Voice Call" onClick={() => startCall('audio')} className="p-2 rounded-lg bg-neutral-800 hover:bg-emerald-500 hover:text-white text-emerald-400 transition-colors">
              <Phone className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            <button title="Video Call" onClick={() => startCall('video')} className="p-2 rounded-lg bg-neutral-800 hover:bg-emerald-500 hover:text-white text-emerald-400 transition-colors">
              <Video className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            {isScreenShareSupported && (
            <button title="Screen Share" onClick={() => startCall('screen')} className="p-2 rounded-lg bg-neutral-800 hover:bg-emerald-500 hover:text-white text-emerald-400 transition-colors">
              <MonitorUp className="w-4 h-4 md:w-5 md:h-5" />
            </button>
            )}
          </div>
        </div>

        {/* Admin Secret Panel Overlay */}
        {showAdminPanel && isAdmin && (
          <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-2 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2 text-neutral-500 text-[10px] sm:text-xs tracking-widest uppercase">
              <Settings className="w-3 h-3" /> System Diagnostics
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleAdminClearChat}
                className="text-[10px] text-neutral-500 hover:text-white transition-colors uppercase font-medium border border-neutral-800 px-2 py-1 rounded"
              >
                Clear Cache
              </button>
              {activeChatId !== 'global' && (
                <button 
                  onClick={handleAdminDeleteCurrentChat}
                  className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors uppercase font-medium border border-neutral-800 px-2 py-1 rounded"
                >
                  Delete Room
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 flex flex-col">
          {messages.length === 0 ? (
            <div className="m-auto text-center text-neutral-500">
              <MessageSquare className="w-12 h-12 mb-4 opacity-30 mx-auto" />
              <p>No messages here yet.</p>
            </div>
          ) : (
            messages.map(msg => {
              const isMine = msg.senderId === currentUser.id;
              const sender = users.find(u => u.id === msg.senderId);

              if (msg.text?.startsWith('[SYSTEM_CALL_START:')) {
                // Only show the latest call notification and only if call is active
                if (msg.id !== lastCallMsgId || callParticipants.length === 0) return null;
                
                const callType = msg.text.split(':')[1].replace(']', '') as 'audio'|'video'|'screen';
                return (
                  <div key={msg.id} className="w-full flex justify-center my-4">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 px-6 py-4 rounded-2xl flex flex-col items-center text-center gap-3 max-w-sm w-full">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                        {callType === 'audio' ? <Phone className="w-5 h-5"/> : (callType === 'video' ? <Video className="w-5 h-5"/> : <MonitorUp className="w-5 h-5"/>)}
                      </div>
                      <div>
                        <span className="font-bold text-emerald-400">{sender ? getDisplayName(sender) : 'Someone'}</span>
                        <span className="text-neutral-400"> started a {callType} call.</span>
                      </div>
                      <button 
                        onClick={() => startCall(callType)}
                        className="w-full bg-emerald-500 text-white font-bold py-2 px-4 rounded-xl hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/20 active:scale-95"
                      >
                        Join Call
                      </button>
                    </div>
                  </div>
                );
              }
              
              return (
                <div key={msg.id} className={`flex gap-3 max-w-full md:max-w-[85%] group ${isMine ? 'ml-auto flex-row-reverse' : ''}`}>
                  <img src={sender?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg'} alt="avatar" className="w-8 h-8 rounded-full bg-neutral-800 flex-shrink-0 mt-1 object-cover" />
                  <div className={`flex flex-col min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-baseline gap-2 mb-1 mx-1">
                      <span className="text-sm font-semibold text-neutral-300">{sender ? getDisplayName(sender) : 'System Admin'}</span>
                      <span className="text-[10px] text-neutral-600">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      {isAdmin && showAdminPanel && (
                        <button 
                          onClick={() => socket.emit('admin_delete_message', { chatId: activeChatId, id: msg.id })}
                          className="text-red-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    
                    <div className={`px-4 py-2.5 text-sm md:text-base rounded-2xl break-words shadow-sm ${isMine ? 'bg-emerald-600 text-white rounded-tr-sm' : 'bg-neutral-800 text-neutral-100 rounded-tl-sm border border-neutral-700/30'}`}>
                      {msg.text && <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>}
                      {msg.imageUrl && <img src={msg.imageUrl} alt="attachment" className="mt-2 max-w-full max-h-[300px] object-cover rounded-lg border border-black/20" />}
                      {msg.audioUrl && <MessageAudioPlayer src={msg.audioUrl} effect={msg.voiceEffect || 'none'} />}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Typing Indicator */}
          {typists.length > 0 && (
            <div className="flex items-center gap-2 text-neutral-500 text-xs italic px-2">
              <Loader2 className="w-3 h-3 animate-spin"/> {typists.map(t => getDisplayName(t)).join(', ')} {typists.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800 flex-shrink-0">
          <div className="flex items-center gap-2 w-full max-w-5xl mx-auto">
            <label className="w-10 h-10 flex items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 cursor-pointer object-cover flex-shrink-0 transition-colors" title="Upload Image">
              <ImageIcon className="w-5 h-5" />
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            <button 
              title="Hold to Record Voice"
              onMouseDown={startRecording} onMouseUp={stopRecording} onMouseLeave={stopRecording}
              onTouchStart={startRecording} onTouchEnd={stopRecording}
              className={`w-10 h-10 flex items-center justify-center rounded-2xl flex-shrink-0 transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/20' : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'}`}
            >
              <Mic className="w-5 h-5" />
            </button>

            <div className="flex-1 flex bg-neutral-800/80 rounded-2xl border border-neutral-700 focus-within:border-emerald-500/50 focus-within:bg-neutral-800 transition-colors min-w-0 shadow-inner">
              <input
                type="text" placeholder="Message..." value={inputText}
                onChange={handleTyping}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage(inputText)}
                className="w-full bg-transparent border-none text-neutral-100 px-5 py-3.5 outline-none placeholder:text-neutral-500 min-w-0"
              />
            </div>
            
            <button 
              disabled={!inputText.trim()}
              onClick={() => handleSendMessage(inputText)} 
              className="w-12 h-12 flex items-center justify-center bg-emerald-500 text-white rounded-2xl hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:hover:bg-emerald-500 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20 flex-shrink-0"
            >
              <Send className="w-5 h-5 ml-1" />
            </button>
          </div>
        </div>
      </div>

      {/* CALL OVERLAY */}
      <AnimatePresence>
        {callState !== 'idle' && !isPip && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-neutral-950 flex flex-col items-center justify-center p-4 sm:p-8"
          >
            {/* Top Bar */}
            <div className="absolute top-0 inset-x-0 h-16 px-6 flex items-center justify-between z-50 bg-gradient-to-b from-black/50 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white font-bold tracking-tight">{activeChatDisplay.name}</span>
                <span className="text-neutral-400 text-xs px-2 py-0.5 bg-white/10 rounded-full">{callParticipants.length} in call</span>
              </div>
              <button 
                onClick={() => setIsPip(true)}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Minimize Call"
              >
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>

            {/* Participants Grid */}
            <div className={`w-full max-w-6xl grid gap-4 flex-1 h-full py-20 ${
              (remoteStreams.size + 1) <= 1 ? 'grid-cols-1' : 
              (remoteStreams.size + 1) === 2 ? 'grid-cols-1 sm:grid-cols-2' : 
              'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            }`}>
              
                {/* Local Participant */}
                <LocalVideoTile stream={mediaStreamRef.current} isVideoOff={isVideoOff} isMuted={isMuted} currentUser={currentUser} localVideoRef={localVideoRef} />

                {/* Remote Participants */}
                {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
                   <RemoteVideo key={userId} stream={stream} user={users.find(u => u.id === userId)} audioDeviceId={audioDeviceId} />
                ))}
            </div>

            {/* Controls Bar */}
            <div className="flex flex-col items-center gap-4 z-50">
               <div className="flex items-center justify-center gap-4 sm:gap-6">
                <button 
                  onClick={toggleMute}
                  title={isMuted ? "Unmute" : "Mute"}
                  className={`w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center rounded-2xl transition-all shadow-xl ${isMuted ? 'bg-red-500 text-white' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                >
                  {isMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>

                <button 
                  onClick={toggleVideo}
                  title={isVideoOff ? "Turn Video On" : "Turn Video Off"}
                  className={`w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center rounded-2xl transition-all shadow-xl ${isVideoOff ? 'bg-red-500 text-white' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Video className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>

                {isScreenShareSupported && (
                <button 
                  onClick={() => startCall('screen')}
                  title="Share Screen"
                  className={`w-12 h-12 sm:w-16 sm:h-16 flex items-center justify-center rounded-2xl transition-all shadow-xl ${callType === 'screen' ? 'bg-emerald-500 text-white' : 'bg-neutral-800 text-white hover:bg-neutral-700'}`}
                >
                  <MonitorUp className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
                )}
              </div>

              <button 
                onClick={endCall}
                className="w-16 h-16 sm:w-20 sm:h-20 bg-red-600 hover:bg-red-500 text-white flex items-center justify-center rounded-2xl transition-all shadow-2xl shadow-red-600/40 hover:scale-105 active:scale-95 group"
              >
                <PhoneOff className="w-6 h-6 sm:w-8 sm:h-8 group-hover:scale-110" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PiP FLOATING WINDOW */}
      <AnimatePresence>
        {callState !== 'idle' && isPip && (
          <motion.div 
            drag dragConstraints={{ left: -1000, right: 1000, top: -1000, bottom: 1000 }}
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
            className="fixed bottom-8 right-8 z-[200] w-48 h-64 sm:w-56 sm:h-72 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden cursor-pointer group"
            onClick={() => setIsPip(false)}
          >
            <div className="absolute inset-0 pointer-events-none">
              {!isVideoOff ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-600 to-purple-800 flex items-center justify-center">
                  <img src={currentUser.avatar} alt="avatar" className="w-16 h-16 rounded-full border-2 border-white/20" />
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-black/80 to-transparent flex items-center px-3">
                <span className="text-[10px] sm:text-xs font-bold text-white truncate">{activeChatDisplay.name}</span>
              </div>
            </div>
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
               <button onClick={(e) => { e.stopPropagation(); setIsPip(false); }} className="w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/80">
                 <Maximize className="w-3 h-3" />
               </button>
               <button onClick={(e) => { e.stopPropagation(); endCall(); }} className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600">
                 <X className="w-3 h-3" />
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl relative">
            <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-neutral-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold mb-4">Edit Profile</h2>
            <div>
               <label className="block text-xs uppercase font-bold text-neutral-500 mb-1">Nickname</label>
               <input 
                 value={editName} onChange={e => setEditName(e.target.value)}
                 className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-emerald-500 mb-4 text-white"
               />

               {availableAudioDevices.length > 0 && (
                 <>
                   <label className="block text-xs uppercase font-bold text-neutral-500 mb-1">Audio Output</label>
                   <select 
                     value={audioDeviceId || ''}
                     onChange={(e) => setAudioDeviceId(e.target.value)}
                     className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-emerald-500 mb-4 text-white"
                   >
                     <option value="">Default Speaker</option>
                     {availableAudioDevices.map(device => (
                       <option key={device.deviceId} value={device.deviceId}>
                         {device.label || `Device ${device.deviceId.slice(0, 5)}...`}
                       </option>
                     ))}
                   </select>
                 </>
               )}

               <button 
                 onClick={() => {
                   if(editName.trim()) {
                     if (!checkKownerAccess(editName)) {
                        return;
                     }
                     const updated = { ...currentUser, nickname: getProcessedName(editName) };
                     setCurrentUser(updated);
                     localStorage.setItem('nexus_user', JSON.stringify(updated));
                     socket.emit('update_user', updated);
                   }
                   setShowSettings(false);
                 }}
                 className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2.5 rounded-xl transition-colors"
               >
                 Save Changes
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
