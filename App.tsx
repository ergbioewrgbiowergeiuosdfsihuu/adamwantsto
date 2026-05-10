import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Phone, Video, MonitorUp, Settings, Image as ImageIcon,
  Send, Trash2, BellOff, Bell, Users, X, User, Check, Mic, 
  MessageSquare, Plus, Maximize, Globe, Loader2, Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

// Initialize the socket
const socket = io();

const RemoteVideo = ({ stream, user }: { stream: MediaStream, user?: UserProfile }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const audioOnly = stream.getVideoTracks().length === 0;

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="absolute inset-0 w-full h-full">
      {audioOnly ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-900 to-purple-950">
           <img src={user?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg'} alt="user" className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-[4px] border-emerald-500 shadow-xl object-cover" />
           <audio ref={ref} autoPlay />
        </div>
      ) : (
        <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
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

    return () => {
      socket.off('state_update');
      socket.off('messages_update');
      socket.off('new_message');
    };
  }, []);

  useEffect(() => {
    if (activeChatId) {
      socket.emit('join_chat', activeChatId);
    }
  }, [activeChatId]);

  const checkKownerAccess = (name: string) => {
    if (name.trim().toLowerCase() === 'kowner') {
      alert("Kowner name is reserved. If you are admin, append !admin to the name (e.g. kowner!admin).");
      return false;
    }
    return true;
  };

  const getProcessedName = (name: string) => {
    if (name.trim().toLowerCase() === 'kowner!admin') return 'Kowner';
    return name.trim();
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => handleSendMessage('', reader.result as string, undefined);
        reader.readAsDataURL(blob);
        audioChunksRef.current = [];
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
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

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        peer.addTrack(track, mediaStreamRef.current!);
      });
    }

    if (isInitiator) {
      peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit("webrtc_signal", { targetId: targetUserId, signal: offer });
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
        if (data.signal.type === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit("webrtc_signal", { targetId: data.fromId, signal: answer });
        } else if (data.signal.type === 'answer') {
          await peer.setRemoteDescription(new RTCSessionDescription(data.signal));
        } else if (data.signal.type === 'ice') {
          await peer.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
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

  const startCall = async (type: 'audio' | 'video' | 'screen') => {
    try {
      let stream;
      if (type === 'screen') {
        if (!navigator.mediaDevices.getDisplayMedia) {
          throw new Error("Screen sharing is not supported in this browser view. Please open the app in a new tab.");
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
      }
      
      setCallState('active');
      setCallType(type);
      mediaStreamRef.current = applyVoiceFilter(stream, voiceEffect);
      if (localVideoRef.current) localVideoRef.current.srcObject = mediaStreamRef.current;
      socket.emit('join_call', activeChatId);
    } catch (e: any) {
      console.error(e);
      endCall();
    }
  };

  const endCall = () => {
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    setCallState('idle'); setCallType(null);
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
  const isAdmin = currentUser?.nickname?.trim().toLowerCase() === 'kowner';

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

  const activeChat = chats.find(c => c.id === activeChatId) || GLOBAL_CHAT;
  const typists = users.filter(u => u.typingIn === activeChatIdRef.current && u.id !== currentUser.id && (isAdmin || u.nickname?.trim().toLowerCase() !== 'kowner'));
  const displayUsers = users.filter(u => u.id !== currentUser.id && (isAdmin || u.nickname?.trim().toLowerCase() !== 'kowner'));

  const getDisplayName = (user: UserProfile) => (!isAdmin && user.nickname?.trim().toLowerCase() === 'kowner') ? 'System Admin' : user.nickname;

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
            {chats.map(chat => (
              <button
                key={chat.id} onClick={() => setActiveChatId(chat.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors ${activeChatId === chat.id ? 'bg-neutral-800 text-white' : 'hover:bg-neutral-800/50 text-neutral-400'}`}
              >
                <img src={chat.avatar} alt="PFP" className="w-10 h-10 rounded-full bg-neutral-900 flex-shrink-0" />
                <div className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate">{chat.name}</div>
                  <div className="text-xs text-neutral-500 truncate mt-0.5">{chat.isGroup ? 'Group / Global' : 'Direct Message'}</div>
                </div>
              </button>
            ))}
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
              <h2 className="font-bold text-lg leading-tight truncate">{activeChat.name}</h2>
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
            <button title="Screen Share" onClick={() => startCall('screen')} className="p-2 rounded-lg bg-neutral-800 hover:bg-emerald-500 hover:text-white text-emerald-400 transition-colors">
              <MonitorUp className="w-4 h-4 md:w-5 md:h-5" />
            </button>
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
              if (!isAdmin && users.find(u => u.id === msg.senderId)?.nickname?.toLowerCase() === 'kowner' && !msg.text?.includes('kowner') && Math.random() > -1) {
                 // optionally skip rendering if we want totally invisible kowner messages, but
                 // we will just anonymize them using getDisplayName
              }
              const isMine = msg.senderId === currentUser.id;
              const sender = users.find(u => u.id === msg.senderId);
              
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

      {/* CALL OVERLAY (Fullscreen support) */}
      <AnimatePresence>
        {callState !== 'idle' && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-neutral-950/95 backdrop-blur-xl flex flex-col items-center justify-center"
          >
            <div className="absolute top-8 text-center sm:static sm:mb-8">
              <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                {callType === 'screen' ? 'Screen Sharing' : callType === 'video' ? 'FaceTime Call' : 'Voice Call'}
              </h2>
              <p className="text-neutral-400 text-sm font-medium animate-pulse">{callState === 'calling' ? 'Connecting securely...' : 'Call active in sandbox mode'}</p>
              {callType !== 'screen' && voiceEffect !== 'none' && (
                <div className="mt-2 inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest border border-emerald-500/30">
                  Filter Active: {voiceEffect}
                </div>
              )}
            </div>
            
            <div className="w-full max-w-7xl p-4 sm:p-6 flex flex-col items-center relative">
              <div className={`w-full grid gap-4 mb-8 ${Array.from(remoteStreams.entries()).length > 0 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                 {/* Current User Box */}
                 <div className="aspect-[3/4] sm:aspect-video rounded-3xl bg-blue-950 overflow-hidden relative border border-white/10 shadow-2xl group">
                   {callType !== 'audio' ? (
                     <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                   ) : (
                     <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-blue-900 to-indigo-950">
                       <img src={currentUser.avatar} alt="me" className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-[4px] border-emerald-500 shadow-xl object-cover" />
                     </div>
                   )}
                   <div className="absolute bottom-4 left-4 z-20 text-white font-bold bg-black/50 px-3 py-1 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> {currentUser.nickname}
                   </div>
                   
                   {callType !== 'audio' && (
                     <button onClick={toggleFullscreen} className="absolute top-4 right-4 p-3 bg-black/50 hover:bg-black/80 rounded-xl text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all z-10">
                       <Maximize className="w-5 h-5" />
                     </button>
                   )}

                   {callState === 'calling' && (
                     <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/90 backdrop-blur-sm">
                        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
                     </div>
                   )}
                 </div>

                 {/* Remote Users */}
                 {Array.from(remoteStreams.entries()).map(([userId, stream]) => {
                    const u = users.find(x => x.id === userId);
                    return (
                       <div key={userId} className="aspect-[3/4] sm:aspect-video rounded-3xl bg-indigo-950 overflow-hidden relative border border-white/10 shadow-2xl">
                          <RemoteVideo stream={stream} user={u} />
                       </div>
                    );
                 })}

                 {/* Placeholder if no remote users */}
                 {remoteStreams.size === 0 && (
                   <div className={`aspect-[3/4] sm:aspect-video rounded-3xl bg-indigo-950 overflow-hidden relative border border-white/10 shadow-2xl ${callState === 'calling' ? 'animate-pulse' : ''}`}>
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-900 to-purple-950">
                        <Loader2 className="w-12 h-12 text-white/20 animate-spin mb-4" />
                        <span className="text-white/40 font-medium">Waiting for others...</span>
                      </div>
                      <div className="absolute bottom-4 left-4 z-20 text-white font-bold bg-black/50 px-3 py-1 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2">
                         {callState === 'calling' ? 'Connecting...' : (activeChat.name || 'Chat')}
                      </div>
                   </div>
                 )}
              </div>

              <button onClick={endCall} className="px-10 py-5 bg-red-500 hover:bg-red-600 rounded-2xl text-white font-bold tracking-wide flex items-center gap-3 transition-all transform hover:scale-105 shadow-xl shadow-red-500/20">
                <Phone className="w-6 h-6 rotate-135" /> End Call
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
