import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, User, Room, Profile, UserSettings } from './types';
import { translations } from './translations';
import { cn, getRoomId } from './utils';
import { 
  Send, 
  Phone, 
  Video, 
  Users, 
  User as UserIcon, 
  LogOut, 
  Plus, 
  X, 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff,
  PhoneOff,
  Star,
  Bookmark,
  Monitor,
  Minus,
  Square,
  Settings,
  Bell,
  Lock,
  Database,
  Globe,
  HelpCircle,
  Crown,
  ChevronRight,
  ChevronLeft,
  Search,
  Camera,
  Edit2,
  Shield,
  Smartphone,
  Info,
  VolumeX,
  Image as ImageIcon,
  Paperclip,
  File,
  UserMinus,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { generateChatResponse } from './services/geminiService';

const socket: Socket = io();

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2371717a'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

const isMediaSupported = (url: string, type: 'video' | 'audio') => {
  if (!url.startsWith('data:')) return true; // Assume external URLs are supported or handled by browser
  const mimeType = url.substring(5, url.indexOf(';'));
  if (!mimeType) return true;
  const element = document.createElement(type);
  return element.canPlayType(mimeType) !== '';
};

const VideoMessage = ({ src, circular = true }: { src: string, circular?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    setIsSupported(isMediaSupported(src, 'video'));
  }, [src]);

  const togglePlay = () => {
    if (videoRef.current && isSupported) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(e => console.error("Video play failed:", e));
      }
      setIsPlaying(!isPlaying);
    }
  };

  if (!isSupported) {
    return (
      <div className={cn(
        "bg-zinc-800 relative flex items-center justify-center",
        circular ? "w-64 h-64 rounded-full border-2 border-emerald-500/30 shadow-2xl mx-auto" : "rounded-xl overflow-hidden max-w-sm h-48"
      )}>
        <div className="text-center p-4">
          <VideoIcon className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
          <p className="text-xs text-zinc-400">Unsupported video format</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "relative cursor-pointer group",
        circular ? "w-64 h-64 rounded-full overflow-hidden border-2 border-emerald-500/30 shadow-2xl mx-auto" : "rounded-xl overflow-hidden max-w-sm"
      )}
      onClick={togglePlay}
    >
      <video 
        ref={videoRef}
        src={src} 
        playsInline
        controls={!circular}
        className={cn(
          "w-full h-full object-cover",
          !circular && "h-auto"
        )}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />
      {circular && !isPlaying && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/40 transition-colors">
          <div className="w-12 h-12 bg-emerald-500/80 rounded-full flex items-center justify-center backdrop-blur-sm">
            <Play className="w-6 h-6 text-white ml-1" />
          </div>
        </div>
      )}
    </div>
  );
};

const AudioMessage = ({ src }: { src: string }) => {
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    setIsSupported(isMediaSupported(src, 'audio'));
  }, [src]);

  if (!isSupported) {
    return (
      <div className="min-w-[200px] p-3 bg-zinc-800 rounded-xl flex items-center gap-3 border border-white/5">
        <MicOff className="w-5 h-5 text-zinc-500" />
        <span className="text-xs text-zinc-400">Unsupported audio format</span>
      </div>
    );
  }

  return (
    <div className="min-w-[200px]">
      <audio src={src} controls className="w-full h-10" />
    </div>
  );
};

const VideoPlayer = ({ stream, className, muted = false }: { stream: MediaStream | null, className?: string, muted?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={className}
    />
  );
};

export default function App() {
  const [username, setUsername] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [role, setRole] = useState<string>('user');
  const [isPremium, setIsPremium] = useState(false);
  const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userList, setUserList] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [stories, setStories] = useState<any[]>([]);
  const [activeStory, setActiveStory] = useState<any | null>(null);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [groupList, setGroupList] = useState<Room[]>([]);
  const [favoriteMessages, setFavoriteMessages] = useState<Message[]>([]);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [activeRoomName, setActiveRoomName] = useState<string>('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState<string | undefined>(undefined);
  const [newGroupHandle, setNewGroupHandle] = useState<string | undefined>(undefined);
  const [newGroupPassword, setNewGroupPassword] = useState<string | undefined>(undefined);
  const [isNewGroupPrivate, setIsNewGroupPrivate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomPasswordPrompt, setRoomPasswordPrompt] = useState<{ roomId: string; name: string } | null>(null);
  const [joinGroupPrompt, setJoinGroupPrompt] = useState<{ roomId: string; name: string } | null>(null);
  const [reportGroupPrompt, setReportGroupPrompt] = useState<{ roomId: string; name: string } | null>(null);
  const [banUserPrompt, setBanUserPrompt] = useState<{ roomId: string; targetUser: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState<Room | null>(null);

  const messageSound = useRef<HTMLAudioElement | null>(null);
  const callSound = useRef<HTMLAudioElement | null>(null);
  const joinSound = useRef<HTMLAudioElement | null>(null);
  const leaveSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    messageSound.current = new Audio('https://cdn.jsdelivr.net/gh/IonDen/ion.sound@master/sounds/button_tiny.mp3');
    callSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
    joinSound.current = new Audio('https://cdn.jsdelivr.net/gh/IonDen/ion.sound@master/sounds/pop_cork.mp3');
    leaveSound.current = new Audio('https://cdn.jsdelivr.net/gh/IonDen/ion.sound@master/sounds/water_droplet.mp3');
    if (callSound.current) {
      callSound.current.loop = true;
    }
  }, []);

  const playMessageSound = () => {
    if (userSettings?.notifications_private || userSettings?.notifications_groups) {
      messageSound.current?.play().catch(() => {});
    }
  };

  const playCallSound = () => {
    if (userSettings?.notifications_calls) {
      callSound.current?.play().catch(() => {});
    }
  };

  const playJoinSound = () => {
    if (userSettings?.notifications_groups && userSettings?.call_join_leave_sounds !== 0) {
      joinSound.current?.play().catch(() => {});
    }
  };

  const playLeaveSound = () => {
    if (userSettings?.notifications_groups && userSettings?.call_join_leave_sounds !== 0) {
      leaveSound.current?.play().catch(() => {});
    }
  };

  const stopCallSound = () => {
    callSound.current?.pause();
    if (callSound.current) callSound.current.currentTime = 0;
  };
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [tempBio, setTempBio] = useState('');
  const [activeSettingsTab, setActiveSettingsTab] = useState<'main' | 'notifications' | 'privacy' | 'data' | 'devices' | 'language' | 'faq' | 'ask' | 'policy' | 'media' | 'premium'>('main');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [mutedChats, setMutedChats] = useState<string[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [premiumKeyInput, setPremiumKeyInput] = useState('');
  const [generatedPremiumKey, setGeneratedPremiumKey] = useState('');
  const [premiumMessage, setPremiumMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<{ url: string; type: string; name: string } | null>(null);
  
  // Media Devices State
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<string>(() => localStorage.getItem('selectedAudioId') || 'default');
  const [selectedVideoId, setSelectedVideoId] = useState<string>(() => localStorage.getItem('selectedVideoId') || 'default');

  useEffect(() => {
    localStorage.setItem('selectedAudioId', selectedAudioId);
  }, [selectedAudioId]);

  useEffect(() => {
    const updateActiveDevices = async () => {
      if (activeCall && localStream.current) {
        console.log("Updating active devices due to selection change");
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: selectedAudioId !== 'default' ? { deviceId: { ideal: selectedAudioId } } : true,
            video: isVideoOn ? (selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true) : false
          });

          const newAudioTrack = newStream.getAudioTracks()[0];
          const newVideoTrack = newStream.getVideoTracks()[0];

          if (newAudioTrack) {
            const oldAudioTrack = localStream.current.getAudioTracks()[0];
            if (oldAudioTrack) {
              oldAudioTrack.stop();
              localStream.current.removeTrack(oldAudioTrack);
            }
            localStream.current.addTrack(newAudioTrack);
            
            if (peerConnection.current) {
              const sender = peerConnection.current.getSenders().find(s => s.track?.kind === 'audio');
              if (sender) sender.replaceTrack(newAudioTrack);
            }
          }

          if (newVideoTrack && isVideoOn) {
            const oldVideoTrack = localStream.current.getVideoTracks()[0];
            if (oldVideoTrack) {
              oldVideoTrack.stop();
              localStream.current.removeTrack(oldVideoTrack);
            }
            localStream.current.addTrack(newVideoTrack);

            if (peerConnection.current) {
              const sender = peerConnection.current.getSenders().find(s => s.track?.kind === 'video');
              if (sender) sender.replaceTrack(newVideoTrack);
            }
          }
          
          // Restart monitoring for the new stream
          // monitorAudioStream(localStream.current, 'local');
        } catch (err) {
          console.error("Failed to update active devices", err);
        }
      }
    };
    updateActiveDevices();
  }, [selectedAudioId, selectedVideoId]);

  // Voice/Video Recording State
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'audio' | 'video' | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const t = translations[userSettings?.language || 'English'] || translations['English'];

  useEffect(() => {
    if (userSettings?.language) {
      // Language change side effects if needed
    }
  }, [userSettings?.language]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
        setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      } catch (err) {
        console.error("Failed to enumerate devices", err);
      }
    };
    getDevices();
    navigator.mediaDevices.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getDevices);
  }, []);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isDesktop, setIsDesktop] = useState(window.innerWidth > 1024);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeCall, setActiveCall] = useState<{
    from: string;
    to?: string;
    type: 'audio' | 'video';
    isIncoming: boolean;
    offer?: any;
    stream?: MediaStream;
    remoteStream?: MediaStream;
    remoteSocketId?: string;
  } | null>(null);
  const activeCallRef = useRef(activeCall);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [socketToUsername, setSocketToUsername] = useState<Map<string, string>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const pendingIceCandidates = useRef<RTCIceCandidateInit[]>([]);

  const processPendingIceCandidates = async () => {
    if (peerConnection.current && peerConnection.current.remoteDescription) {
      console.log(`Processing ${pendingIceCandidates.current.length} pending ICE candidates`);
      while (pendingIceCandidates.current.length > 0) {
        const candidate = pendingIceCandidates.current.shift();
        if (candidate) {
          try {
            await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Error adding queued ICE candidate", e);
          }
        }
      }
    }
  };

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('messenger_user');
    if (savedUser) {
      try {
        const { username: savedUsername, password: savedPassword } = JSON.parse(savedUser);
        if (savedUsername && savedPassword) {
          setUsername(savedUsername);
          setPassword(savedPassword);
          socket.emit('login', { username: savedUsername, password: savedPassword });
        }
      } catch (e) {
        console.error("Failed to parse saved user", e);
      }
    }
    setIsAuthReady(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      socket.emit('join-network', username);
      socket.emit('get-groups');
      socket.emit('get-stories');
      socket.emit('get-recent-chats', username);
      socket.emit('get-favorites', username);
      socket.emit('get-profile', username);
      socket.emit('get-settings', username);
      socket.emit('get-muted-chats', username);
      socket.emit('get-blocked-users', username);
    }
  }, [isLoggedIn, username]);

  const activeRoomRef = useRef<string | null>(null);
  const blockedUsersRef = useRef<string[]>([]);
  const mutedChatsRef = useRef<string[]>([]);
  const usernameRef = useRef<string>('');
  const lastRecentChatsFetch = useRef<number>(0);

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { blockedUsersRef.current = blockedUsers; }, [blockedUsers]);
  useEffect(() => { mutedChatsRef.current = mutedChats; }, [mutedChats]);
  useEffect(() => { usernameRef.current = username; }, [username]);

  const fetchRecentChats = useCallback(() => {
    const now = Date.now();
    if (now - lastRecentChatsFetch.current > 2000) {
      socket.emit('get-recent-chats', usernameRef.current);
      lastRecentChatsFetch.current = now;
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      const handleUserList = (users: (User & { socketId?: string })[]) => {
        setUserList(users.filter(u => u.id !== usernameRef.current));
        setSocketToUsername(prev => {
          const newMap = new Map(prev);
          users.forEach(u => {
            if (u.socketId) newMap.set(u.socketId, u.id);
          });
          return newMap;
        });
        
        // Update profiles cache with online users
        setProfiles(prev => {
          const next = { ...prev };
          users.forEach(u => {
            next[u.id] = {
              username: u.id,
              nickname: u.name,
              bio: u.bio || '',
              avatar_url: u.avatar_url || '',
              is_premium: u.is_premium
            };
          });
          return next;
        });
      };

      const handleGroupList = (groups: Room[]) => {
        setGroupList(groups);
      };

      const handleNewGroup = (group: Room) => {
        setGroupList(prev => [...prev, group]);
      };

      const handleProfileData = (data: Profile) => {
        setProfile(data);
        setTempBio(data.bio);
        setProfiles(prev => ({ ...prev, [data.username]: data }));
      };

      const handleProfileUpdated = (data: Profile) => {
        setProfile(data);
        setIsEditingBio(false);
        setProfiles(prev => ({ ...prev, [data.username]: data }));
      };

      const handleSettingsData = (data: UserSettings) => {
        setUserSettings(data);
      };

      const handleMutedChatsData = (data: string[]) => {
        setMutedChats(data);
      };

      const handleBlockedUsersData = (data: string[]) => {
        setBlockedUsers(data);
      };

      const handleChatCleared = (room: string) => {
        setMessages(prev => prev.filter(m => m.room !== room));
      };

      const handleSettingsUpdated = (data: UserSettings) => {
        setUserSettings(data);
      };

      const handlePremiumKeyGenerated = (data: { key: string }) => {
        setGeneratedPremiumKey(data.key);
        setPremiumMessage('Key generated successfully!');
      };

      const handlePremiumSuccess = (data: { message: string; expiresAt: string }) => {
        setPremiumMessage(data.message);
        setIsPremium(true);
        setPremiumExpiresAt(data.expiresAt);
      };

      const handlePremiumError = (msg: string) => {
        setPremiumMessage(msg);
      };

      const handleSearchResults = (results: User[]) => {
        setSearchResults(results);
      };

      const handleStoriesUpdated = (updatedStories: any[]) => {
        setStories(updatedStories);
      };

      const handleRecentChats = (chats: any[]) => {
        setRecentChats(chats);
        setUnreadCounts(prev => {
          const newUnreadCounts = { ...prev };
          chats.forEach(chat => {
            if (chat.unreadCount !== undefined) {
              newUnreadCounts[chat.room] = chat.unreadCount;
            }
          });
          return newUnreadCounts;
        });

        // Update profiles cache from recent chats
        setProfiles(prev => {
          const next = { ...prev };
          chats.forEach(chat => {
            if (!next[chat.username]) {
              next[chat.username] = {
                username: chat.username,
                nickname: chat.nickname || chat.username,
                bio: chat.bio || '',
                avatar_url: chat.avatar_url || '',
                is_premium: chat.is_premium
              };
            } else {
              // Update existing if we have new info
              next[chat.username] = {
                ...next[chat.username],
                nickname: chat.nickname || next[chat.username].nickname,
                bio: chat.bio || next[chat.username].bio,
                avatar_url: chat.avatar_url || next[chat.username].avatar_url,
                is_premium: chat.is_premium !== undefined ? chat.is_premium : next[chat.username].is_premium
              };
            }
          });
          return next;
        });
      };

      const handleChatHistory = (history: Message[]) => {
        setMessages(history);
      };

      const handleNewMessage = (msg: Message) => {
        if (blockedUsersRef.current.includes(msg.sender)) return;

        if (msg.room === activeRoomRef.current) {
          setMessages(prev => [...prev, msg]);
          socket.emit('mark-read', { room: activeRoomRef.current, username: usernameRef.current });
        } else {
          setUnreadCounts(prev => ({
            ...prev,
            [msg.room]: (prev[msg.room] || 0) + 1
          }));
        }
        if (msg.sender !== usernameRef.current && !mutedChatsRef.current.includes(msg.room)) {
          playMessageSound();
          
          // Show notification
          const senderProfile = profiles[msg.sender];
          const senderName = senderProfile?.nickname || msg.sender;
          showNotification(`Новое сообщение от ${senderName}`, {
            body: msg.content,
            icon: senderProfile?.avatar_url || DEFAULT_AVATAR
          });
        }
        fetchRecentChats();
      };

      const handleMessageUpdated = (data: { id: number; isFavorite: boolean }) => {
        setMessages(prev => prev.map(m => m.id === data.id ? { ...m, isFavorite: data.isFavorite } : m));
        socket.emit('get-favorites', usernameRef.current);
      };

      const handleFavoritesList = (favorites: Message[]) => {
        setFavoriteMessages(favorites);
      };

      const handleGroupUpdated = (group: Room) => {
        setGroupList(prev => prev.map(g => g.id === group.id ? group : g));
      };

      const handleGroupDeleted = (roomId: string) => {
        setGroupList(prev => prev.filter(g => g.id !== roomId));
        setActiveRoom(prev => prev === roomId ? null : prev);
        setActiveRoomName(prev => prev === roomId ? '' : prev);
      };

      const handlePasswordVerified = (data: { roomId: string; success: boolean }) => {
        if (data.success) {
          const room = groupList.find(g => g.id === data.roomId);
          if (room) {
            setActiveRoom(room.id);
            setActiveRoomName(room.name);
            setShowFavorites(false);
            setShowSettings(false);
            setShowChatInfo(false);
            if (!isDesktop) setShowSidebar(false);
            setRoomPasswordPrompt(null);
            setPasswordInput('');
            setPasswordError(false);
            socket.emit('join-room', { room: room.id, username: usernameRef.current });
          }
        } else {
          setPasswordError(true);
        }
      };

      const handleCallMade = async (data: { offer: any; socket: string; from: string; type: 'audio' | 'video' }) => {
        setSocketToUsername(prev => {
          const newMap = new Map(prev);
          newMap.set(data.socket, data.from);
          return newMap;
        });
        
        const currentCall = activeCallRef.current;
        
        if (currentCall && !currentCall.isIncoming && data.offer) {
          const pc = setupPeerConnection(data.from, data.socket);
          if (localStream.current) {
            addTrackToPc(pc, localStream.current);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          await processPendingIceCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(new RTCSessionDescription(answer));
          socket.emit('make-answer', { to: data.socket, answer });
          return;
        }

        if (!currentCall) {
          setActiveCall({ from: data.from, type: data.type, isIncoming: true, remoteSocketId: data.socket, offer: data.offer });
          setIsCallMinimized(false);
          playCallSound();
          (window as any).incomingOffer = data;

          // Show notification
          const callerProfile = profiles[data.from];
          const callerName = callerProfile?.nickname || data.from;
          showNotification(`Входящий ${data.type === 'video' ? 'видеозвонок' : 'звонок'}`, {
            body: `Вам звонит ${callerName}`,
            icon: callerProfile?.avatar_url || DEFAULT_AVATAR
          });
        }
      };

      const handleAnswerMade = async (data: { socket: string; answer: any; from: string }) => {
        if (peerConnection.current) {
          console.log("Setting remote description from answer");
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          await processPendingIceCandidates();
          setActiveCall(prev => prev ? { ...prev, remoteSocketId: data.socket } : null);
        }
      };

      const handleIceCandidate = async (data: { socket: string; candidate: any; from: string }) => {
        if (data.candidate) {
          if (peerConnection.current && peerConnection.current.remoteDescription) {
            try {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              console.error("Error adding ICE candidate", e);
            }
          } else {
            console.log("Queuing ICE candidate");
            pendingIceCandidates.current.push(data.candidate);
          }
        }
      };

      const handleCallEnded = (data: { from: string }) => {
        console.log(`Call ended by ${data.from}`);
        endCall();
      };

      socket.on('user-list', handleUserList);
      socket.on('group-list', handleGroupList);
      socket.on('new-group', handleNewGroup);
      socket.on('profile-data', handleProfileData);
      socket.on('profile-updated', handleProfileUpdated);
      socket.on('settings-data', handleSettingsData);
      socket.on('muted-chats-data', handleMutedChatsData);
      socket.on('blocked-users-data', handleBlockedUsersData);
      socket.on('chat-cleared', handleChatCleared);
      socket.on('settings-updated', handleSettingsUpdated);
      socket.on('premium-key-generated', handlePremiumKeyGenerated);
      socket.on('premium-success', handlePremiumSuccess);
      socket.on('premium-error', handlePremiumError);
      socket.on('search-results', handleSearchResults);
      socket.on('stories-updated', handleStoriesUpdated);
      socket.on('recent-chats', handleRecentChats);
      socket.on('chat-history', handleChatHistory);
      socket.on('new-message', handleNewMessage);
      socket.on('message-updated', handleMessageUpdated);
      socket.on('favorites-list', handleFavoritesList);
      socket.on('group-updated', handleGroupUpdated);
      socket.on('group-deleted', handleGroupDeleted);
      socket.on('password-verified', handlePasswordVerified);
      socket.on('call-made', handleCallMade);
      socket.on('answer-made', handleAnswerMade);
      socket.on('ice-candidate', handleIceCandidate);
      socket.on('call-ended', handleCallEnded);

      return () => {
        socket.off('user-list', handleUserList);
        socket.off('group-list', handleGroupList);
        socket.off('new-group', handleNewGroup);
        socket.off('profile-data', handleProfileData);
        socket.off('profile-updated', handleProfileUpdated);
        socket.off('settings-data', handleSettingsData);
        socket.off('muted-chats-data', handleMutedChatsData);
        socket.off('blocked-users-data', handleBlockedUsersData);
        socket.off('chat-cleared', handleChatCleared);
        socket.off('settings-updated', handleSettingsUpdated);
        socket.off('premium-key-generated', handlePremiumKeyGenerated);
        socket.off('premium-success', handlePremiumSuccess);
        socket.off('premium-error', handlePremiumError);
        socket.off('search-results', handleSearchResults);
        socket.off('stories-updated', handleStoriesUpdated);
        socket.off('recent-chats', handleRecentChats);
        socket.off('chat-history', handleChatHistory);
        socket.off('new-message', handleNewMessage);
        socket.off('message-updated', handleMessageUpdated);
        socket.off('favorites-list', handleFavoritesList);
        socket.off('group-updated', handleGroupUpdated);
        socket.off('group-deleted', handleGroupDeleted);
        socket.off('password-verified', handlePasswordVerified);
        socket.off('call-made', handleCallMade);
        socket.off('answer-made', handleAnswerMade);
        socket.off('ice-candidate', handleIceCandidate);
        socket.off('call-ended', handleCallEnded);
      };
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn && searchQuery.trim()) {
      const timer = setTimeout(() => {
        socket.emit('search-users', searchQuery);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, isLoggedIn]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages, activeRoom, showFavorites]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && password.trim() && (!isRegistering || nickname.trim())) {
      setAuthError('');
      const trimmedUsername = username.trim();
      setUsername(trimmedUsername);
      if (isRegistering) {
        socket.emit('register', { username: trimmedUsername, nickname: nickname.trim(), password: password.trim() });
      } else {
        socket.emit('login', { username: trimmedUsername, password: password.trim() });
      }
    }
  };

  useEffect(() => {
    socket.on('login-success', (data) => {
      if (data.username) {
        setUsername(data.username);
        localStorage.setItem('messenger_user', JSON.stringify({ username: data.username, password }));
        requestNotificationPermission();
      }
      setRole(data.role);
      setIsPremium(data.isPremium);
      setPremiumExpiresAt(data.premiumExpiresAt);
      setIsLoggedIn(true);
    });
    socket.on('login-error', (err) => {
      setAuthError(err);
      localStorage.removeItem('messenger_user');
    });
    socket.on('register-success', (data) => {
      if (data.username) {
        setUsername(data.username);
        localStorage.setItem('messenger_user', JSON.stringify({ username: data.username, password }));
      }
      setRole(data.role);
      setIsPremium(data.isPremium);
      setPremiumExpiresAt(data.premiumExpiresAt);
      setIsLoggedIn(true);
    });
    socket.on('register-error', (err) => setAuthError(err));

    return () => {
      socket.off('login-success');
      socket.off('login-error');
      socket.off('register-success');
      socket.off('register-error');
    };
  }, []);

  const joinRoom = (targetUser: string) => {
    const roomId = getRoomId(username, targetUser);
    setActiveRoom(roomId);
    setActiveRoomName(targetUser);
    setShowFavorites(false);
    setShowSettings(false);
    setShowChatInfo(false);
    if (!isDesktop) setShowSidebar(false);
    socket.emit('join-room', { room: roomId, username });
    setUnreadCounts(prev => ({ ...prev, [roomId]: 0 }));
  };

  const joinGroup = (group: Room) => {
    if (group.is_private && group.owner !== username) {
      setRoomPasswordPrompt({ roomId: group.id, name: group.name });
      return;
    }
    
    if (!group.members?.includes(username)) {
      setJoinGroupPrompt({ roomId: group.id, name: group.name });
      return;
    }

    setActiveRoom(group.id);
    setActiveRoomName(group.name);
    setShowFavorites(false);
    setShowSettings(false);
    setShowChatInfo(false);
    if (!isDesktop) setShowSidebar(false);
    socket.emit('join-room', { room: group.id, username });
    setUnreadCounts(prev => ({ ...prev, [group.id]: 0 }));
  };

  const confirmJoinGroup = () => {
    if (joinGroupPrompt) {
      socket.emit('join-public-group', { roomId: joinGroupPrompt.roomId, username });
      setActiveRoom(joinGroupPrompt.roomId);
      setActiveRoomName(joinGroupPrompt.name);
      setShowFavorites(false);
      setShowSettings(false);
      setShowChatInfo(false);
      if (!isDesktop) setShowSidebar(false);
      socket.emit('join-room', { room: joinGroupPrompt.roomId, username });
      setJoinGroupPrompt(null);
    }
  };

  const verifyPassword = () => {
    if (roomPasswordPrompt) {
      socket.emit('verify-group-password', { roomId: roomPasswordPrompt.roomId, password: passwordInput });
    }
  };

  const toggleFavorite = (messageId: number, currentStatus: boolean) => {
    socket.emit('toggle-favorite', { messageId, isFavorite: !currentStatus, username });
  };

  const showFavoritesView = () => {
    setShowFavorites(true);
    setShowSettings(false);
    setShowChatInfo(false);
    setActiveRoom(null);
    setActiveRoomName('Favorite Messages');
    if (!isDesktop) setShowSidebar(false);
    socket.emit('get-favorites', username);
  };

  const showSettingsView = () => {
    setShowSettings(true);
    setShowFavorites(false);
    setShowChatInfo(false);
    setActiveSettingsTab('main');
    setActiveRoom(null);
    setActiveRoomName('Settings');
    if (!isDesktop) setShowSidebar(false);
  };

  const createGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGroupName && newGroupHandle && newGroupName.trim() && newGroupHandle.trim()) {
      socket.emit('create-group', { 
        name: newGroupName, 
        handle: newGroupHandle, 
        password: newGroupPassword, 
        isPrivate: isNewGroupPrivate,
        owner: username
      });
      setNewGroupName(undefined);
      setNewGroupHandle(undefined);
      setNewGroupPassword(undefined);
      setIsNewGroupPrivate(false);
      setShowCreateGroup(false);
    }
  };

  const updateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (showGroupSettings) {
      socket.emit('update-group', {
        id: showGroupSettings.id,
        name: newGroupName !== undefined ? newGroupName : showGroupSettings.name,
        handle: newGroupHandle !== undefined ? newGroupHandle : showGroupSettings.handle,
        password: newGroupPassword !== undefined ? newGroupPassword : showGroupSettings.password,
        isPrivate: isNewGroupPrivate
      });
      setShowGroupSettings(null);
      setNewGroupName(undefined);
      setNewGroupHandle(undefined);
      setNewGroupPassword(undefined);
    }
  };

  const updateBio = () => {
    socket.emit('update-profile', { username, bio: tempBio });
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        socket.emit('update-profile', { username, avatar_url: base64String });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const limit = isPremium ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > limit) {
        alert(isPremium ? "File size must be less than 20MB" : "File size must be less than 5MB. Upgrade to Premium for 20MB limit!");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        let type = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video_file';
        else if (file.type.startsWith('audio/')) type = 'audio_file';
        
        setAttachment({ url: base64String, type, name: file.name });
      };
      reader.readAsDataURL(file);
    }
  };

  const updateSetting = (key: string, value: any) => {
    socket.emit('update-settings', { username, [key]: value });
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blockedUsers.includes(activeRoomName)) {
      alert('Вы заблокировали этого пользователя. Разблокируйте его, чтобы отправлять сообщения.');
      return;
    }
    if ((inputMessage.trim() || attachment) && activeRoom) {
      const content = inputMessage.trim();
      socket.emit('send-message', {
        room: activeRoom,
        sender: username,
        content: content || (attachment ? `[${attachment.name}]` : ''),
        mediaUrl: attachment?.url,
        mediaType: attachment?.type
      });
      setInputMessage('');
      setAttachment(null);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';

      // AI Trigger
      if (content.startsWith('/ai ')) {
        const prompt = content.replace('/ai ', '');
        const aiResponse = await generateChatResponse(prompt);
        socket.emit('send-message', {
          room: activeRoom,
          sender: 'Nexus AI',
          content: aiResponse
        });
      }
    }
  };

  // WebRTC Logic
  const addTrackToPc = (pc: RTCPeerConnection, stream: MediaStream) => {
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    const transceivers = pc.getTransceivers();

    if (audioTrack) {
      const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio');
      if (audioTransceiver) {
        audioTransceiver.sender.replaceTrack(audioTrack);
      } else {
        pc.addTrack(audioTrack, stream);
      }
    }
    
    if (videoTrack) {
      const videoTransceiver = transceivers.find(t => t.receiver.track.kind === 'video');
      if (videoTransceiver) {
        videoTransceiver.sender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, stream);
      }
    }
  };

  const setupPeerConnection = (targetId: string, remoteSocketId?: string) => {
    if (peerConnection.current) return peerConnection.current;

    console.log(`Setting up PeerConnection for ${targetId} (socket: ${remoteSocketId})`);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:stun.stunprotocol.org:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.voipstunt.com' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.schlund.de' },
        { urls: 'stun:stun.voiparound.com' },
        { urls: 'stun:stun.voipbuster.com' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp'
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const to = remoteSocketId || activeCallRef.current?.remoteSocketId || targetId;
        console.log(`Sending ICE candidate to ${to}`);
        socket.emit('ice-candidate', { to, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log(`Received remote track from ${targetId}`);
      const stream = event.streams[0];
      setActiveCall(prev => {
        if (!prev) return null;
        console.log(`Updating activeCall with remote stream from ${targetId}`);
        const hasVideo = stream.getVideoTracks().length > 0 || prev.type === 'video';
        return { ...prev, type: hasVideo ? 'video' : prev.type, remoteStream: stream };
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection State for ${targetId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.warn("ICE Connection failed, attempting to restart ICE...");
        pc.createOffer({ iceRestart: true }).then(offer => {
          return pc.setLocalDescription(offer);
        }).then(() => {
          const to = remoteSocketId || activeCallRef.current?.remoteSocketId || targetId;
          socket.emit('call-user', { to, offer: pc.localDescription, from: usernameRef.current, type: activeCallRef.current?.type || 'audio' });
        }).catch(err => {
          console.error("ICE restart failed", err);
          endCall();
        });
      } else if (pc.iceConnectionState === 'closed') {
        console.warn(`ICE Connection ${pc.iceConnectionState}, ending call`);
        endCall();
      } else if (pc.iceConnectionState === 'disconnected') {
        console.warn("ICE Connection disconnected, attempting to reconnect...");
        // Don't end call immediately on disconnected, it might recover
      }
    };

    peerConnection.current = pc;
    return pc;
  };

  const startCall = async (targetName: string, type: 'audio' | 'video') => {
    console.log(`Starting ${type} call to ${targetName}`);
    if (!socket.connected) {
      alert("Socket is not connected. Please wait or refresh.");
      return;
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Media devices API not supported in this browser. Please ensure you are using HTTPS.");
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioId !== 'default' ? { deviceId: { ideal: selectedAudioId } } : true,
          video: type === 'video' ? (selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true) : false
        });
      } catch (e) {
        console.warn("Failed with selected devices, falling back to default", e);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
      }
      
      console.log("Local stream acquired");
      localStream.current = stream;
      
      const targetSocketId = Array.from(socketToUsername.entries()).find(([_, name]) => name === targetName)?.[0];
      
      setActiveCall({ 
        from: usernameRef.current, 
        to: targetName,
        type, 
        isIncoming: false, 
        stream,
        remoteSocketId: targetSocketId
      });
      setIsCallMinimized(false);

      console.log("Initiating 1-on-1 call");
      const pc = setupPeerConnection(targetName, targetSocketId || targetName);
      addTrackToPc(pc, stream);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(new RTCSessionDescription(offer));
      await processPendingIceCandidates();
      socket.emit('call-user', { to: targetName, offer, from: usernameRef.current, type });
    } catch (err) {
      console.error("Failed to get local stream", err);
      alert(`Could not start call: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const answerCall = async () => {
    const data = (window as any).incomingOffer;
    if (!data) {
      console.error("No incoming offer found in window.incomingOffer");
      return;
    }
    stopCallSound();
    console.log(`Answering ${data.type} call from ${data.from}`);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Media devices API not supported in this browser. Please ensure you are using HTTPS.");
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioId !== 'default' ? { deviceId: { ideal: selectedAudioId } } : true,
          video: data.type === 'video' ? (selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true) : false
        });
      } catch (e) {
        console.warn("Failed with selected devices, falling back to default", e);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: data.type === 'video'
        });
      }
      console.log("Local stream acquired for answering");
      localStream.current = stream;
      setActiveCall(prev => prev ? { 
        ...prev, 
        isIncoming: false, 
        stream,
        remoteSocketId: data.socket
      } : null);
      setIsCallMinimized(false);

      const pc = setupPeerConnection(data.from, data.socket);
      
      if (data.offer) {
        console.log("Setting remote description");
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        await processPendingIceCandidates();
        
        console.log("Adding local tracks to PeerConnection");
        addTrackToPc(pc, stream);
        
        console.log("Creating answer");
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(new RTCSessionDescription(answer));
        socket.emit('make-answer', { to: data.socket, answer });
        console.log("Answer sent");
      } else {
        console.log("Adding local tracks to PeerConnection (no offer yet)");
        addTrackToPc(pc, stream);
      }
    } catch (err) {
      console.error("Failed to answer call", err);
      alert(`Could not answer call: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const toggleMute = () => {
    if (localStream.current) {
      const audioTracks = localStream.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (localStream.current) {
      const videoTracks = localStream.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach(track => {
          track.enabled = !track.enabled;
          if (!track.enabled) {
            track.stop();
            localStream.current?.removeTrack(track);
          }
        });
        setIsVideoOn(false);
      } else {
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true 
          });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          localStream.current.addTrack(newVideoTrack);
          
          // Add to peer connection
          if (peerConnection.current) {
            const senders = peerConnection.current.getSenders();
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(newVideoTrack);
            } else {
              try {
                peerConnection.current.addTrack(newVideoTrack, localStream.current!);
              } catch (e) {
                console.warn("Error adding video track to PC", e);
              }
            }
          }
          
          setIsVideoOn(true);
          setActiveCall(prev => prev ? { ...prev, type: 'video' } : null);
        } catch (err) {
          console.error("Failed to get video stream", err);
          alert("Не удалось получить доступ к камере");
        }
      }
    }
  };

  const toggleScreenShare = async () => {
    if (localStream.current) {
      if (isScreenSharing) {
        // Stop screen sharing and revert to camera if it was on
        const videoTracks = localStream.current.getVideoTracks();
        videoTracks.forEach(track => {
          track.stop();
          localStream.current?.removeTrack(track);
        });
        setIsScreenSharing(false);
        
        if (isVideoOn) {
          try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ 
              video: selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true 
            });
            const newVideoTrack = videoStream.getVideoTracks()[0];
            localStream.current.addTrack(newVideoTrack);
            if (peerConnection.current) {
              const senders = peerConnection.current.getSenders();
              const videoSender = senders.find(s => s.track?.kind === 'video');
              if (videoSender) {
                videoSender.replaceTrack(newVideoTrack);
              } else {
                try {
                  peerConnection.current.addTrack(newVideoTrack, localStream.current!);
                } catch (e) {
                  console.warn("Error adding video track to PC", e);
                }
              }
            }
          } catch (err) {
            console.error("Failed to restore camera", err);
            setIsVideoOn(false);
          }
        } else {
          // If video was off, just remove the track from peer
          if (peerConnection.current) {
            const senders = peerConnection.current.getSenders();
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              peerConnection.current.removeTrack(videoSender);
            }
          }
        }
      } else {
        try {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const screenTrack = screenStream.getVideoTracks()[0];
          
          screenTrack.onended = () => {
            toggleScreenShare(); // Revert when user stops sharing via browser UI
          };

          const existingVideoTracks = localStream.current.getVideoTracks();
          existingVideoTracks.forEach(track => {
            track.stop();
            localStream.current?.removeTrack(track);
          });

          localStream.current.addTrack(screenTrack);
          
          if (peerConnection.current) {
            const senders = peerConnection.current.getSenders();
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(screenTrack);
            } else {
              peerConnection.current.addTrack(screenTrack, localStream.current!);
            }
          }
          
          setIsScreenSharing(true);
          setActiveCall(prev => prev ? { ...prev, type: 'video' } : null);
        } catch (err) {
          console.error("Failed to get screen stream", err);
          // User might have cancelled
        }
      }
    }
  };

  const startDemoCall = () => {
    setActiveCall({
      from: "Demo User",
      to: "Demo User",
      type: 'video',
      isIncoming: false,
      stream: undefined // In a real demo we might mock this, but for now just showing UI
    });
    setIsCallMinimized(false);
  };

  const endCall = () => {
    stopCallSound();
    if (activeCallRef.current) {
      const to = activeCallRef.current.remoteSocketId || activeCallRef.current.from;
      socket.emit('end-call', { to });
    }
    localStream.current?.getTracks().forEach(track => track.stop());
    localStream.current = null;
    if (peerConnection.current) {
      peerConnection.current.onicecandidate = null;
      peerConnection.current.ontrack = null;
      peerConnection.current.oniceconnectionstatechange = null;
      peerConnection.current.close();
      peerConnection.current = null;
    }
    pendingIceCandidates.current = [];
    setActiveCall(null);
    setIsCallMinimized(false);
    setIsMuted(false);
    setIsVideoOn(true);
    setIsScreenSharing(false);
  };

  const startRecording = async (type: 'audio' | 'video') => {
    if (blockedUsers.includes(activeRoomName)) {
      alert('Вы заблокировали этого пользователя. Разблокируйте его, чтобы отправлять сообщения.');
      return;
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Media devices API not supported in this browser. Please ensure you are using HTTPS.");
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioId !== 'default' ? { deviceId: { ideal: selectedAudioId } } : true,
          video: type === 'video' ? (selectedVideoId !== 'default' ? { deviceId: { ideal: selectedVideoId } } : true) : false
        });
      } catch (e) {
        console.warn("Failed with selected devices, falling back to default", e);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video'
        });
      }
      
      const options = {};
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (type === 'video') {
          if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
            (options as any).mimeType = 'video/webm;codecs=vp8,opus';
          } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            (options as any).mimeType = 'video/mp4';
          }
        } else if (type === 'audio') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            (options as any).mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            (options as any).mimeType = 'audio/mp4';
          }
        }
      }
      
      recordingStreamRef.current = stream;
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        console.warn("Failed to create MediaRecorder with options, trying default", e);
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log("Recording stopped, processing blob...");
        const mimeType = recordedChunksRef.current[0]?.type || mediaRecorder.mimeType || (type === 'audio' ? 'audio/webm' : 'video/webm');
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        console.log("Blob size:", blob.size, "Mime type:", mimeType);
        if (blob.size === 0) {
          console.warn("Recording blob is empty, not sending.");
          stream.getTracks().forEach(track => track.stop());
          setRecordingMode(null);
          setRecordingDuration(0);
          return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64data = reader.result;
          console.log("Base64 data generated, length:", base64data?.toString().length);
          if (activeRoom) {
            console.log("Emitting send-message event...");
            socket.emit('send-message', {
              room: activeRoom,
              sender: username,
              content: type === 'audio' ? '[Voice Message]' : '[Video Message]',
              mediaUrl: base64data,
              mediaType: type
            });
          } else {
            console.error("No active room to send message to");
          }
        };
        stream.getTracks().forEach(track => track.stop());
        setRecordingMode(null);
        setRecordingDuration(0);
      };

      mediaRecorder.start(1000);
      setRecordingMode(type);
      setRecordingDuration(0);
      
      // We need a slight delay to ensure the DOM element is rendered before attaching the stream
      setTimeout(() => {
        if (type === 'video' && recordingPreviewRef.current) {
          recordingPreviewRef.current.srcObject = stream;
        }
      }, 50);
      
      const interval = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
      // Store interval to clear it later if needed, though we can just use a ref or clear on stop
      (mediaRecorderRef as any).interval = interval;
      
    } catch (err) {
      console.error("Failed to start recording:", err);
      alert("Could not start recording. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      clearInterval((mediaRecorderRef as any).interval);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null; // Prevent sending
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      clearInterval((mediaRecorderRef as any).interval);
      setRecordingMode(null);
      setRecordingDuration(0);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('messenger_user');
    setIsLoggedIn(false);
    setUsername('');
    setPassword('');
    setNickname('');
    setProfiles({});
    socket.emit('logout');
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const showNotification = (title: string, options?: NotificationOptions) => {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      try {
        new Notification(title, options);
      } catch (e) {
        console.error("Failed to show notification:", e);
      }
    }
  };

  if (!isAuthReady) return null;

  if (!isLoggedIn) {
    return (
      <div className={cn(
        "min-h-screen flex items-center justify-center p-4 transition-colors duration-700 liquid-bg",
        isDesktop ? "bg-[#050505]" : "bg-[#0a0a0a]"
      )}>
        <div className="blob" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />

        <motion.div 
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className={cn(
            "w-[450px] glass-card rounded-[2.5rem] p-10 shadow-2xl relative overflow-hidden z-10",
            isDesktop && "before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/5 before:to-transparent before:pointer-events-none"
          )}
        >
          {isDesktop && (
            <div className="absolute top-4 right-6 flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-white/5" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/5" />
              <div className="w-2.5 h-2.5 rounded-full bg-white/5" />
            </div>
          )}
          
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <Users className="w-8 h-8 text-emerald-500" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2 tracking-tight">MOZA</h1>
          <p className="text-zinc-400 text-center mb-8 text-sm">
            {isDesktop ? "Desktop Workstation Detected" : "Mobile Device Detected"}
          </p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            {authError && <div className="text-red-500 text-sm text-center">{authError}</div>}
            
            {isRegistering && (
              <div className="space-y-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
                  <h3 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Info className="w-3 h-3" />
                    Инструкция по регистрации
                  </h3>
                  <ul className="text-[10px] text-zinc-400 space-y-1 list-disc list-inside">
                    <li>Используйте уникальный @username для входа</li>
                    <li>Никнейм можно будет изменить позже в профиле</li>
                    <li>Пароль должен быть надежным и запоминающимся</li>
                    <li>Ваш аккаунт будет привязан к этому устройству</li>
                  </ul>
                </div>
                <div className="relative group">
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Display Name (Nickname)"
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
                    required
                  />
                  <div className="absolute inset-0 rounded-xl bg-emerald-500/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity" />
                </div>
              </div>
            )}

            <div className="relative group">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  const val = e.target.value;
                  if (isRegistering && !val.startsWith('@') && val.length > 0) {
                    setUsername('@' + val);
                  } else {
                    setUsername(val);
                  }
                }}
                placeholder={isRegistering ? "@username" : "Your username"}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
                required
              />
              <div className="absolute inset-0 rounded-xl bg-emerald-500/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity" />
            </div>
            <div className="relative group">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
                required
              />
              <div className="absolute inset-0 rounded-xl bg-emerald-500/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity" />
            </div>
            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/20"
            >
              {isRegistering ? 'Create Account' : 'Initialize Session'}
            </button>
            <button
              type="button"
              onClick={() => { setIsRegistering(!isRegistering); setAuthError(''); }}
              className="w-full text-zinc-400 hover:text-white text-sm transition-colors"
            >
              {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
            </button>
          </form>
          
          {isDesktop && (
            <div className="mt-8 pt-6 border-t border-white/5 flex justify-center gap-4">
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                Secure P2P
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                Encrypted
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#050505] text-white font-sans overflow-hidden flex p-0">
      <motion.div 
        layout
        className="flex relative z-10 bg-[#141414] overflow-hidden w-full h-full transition-all duration-500"
      >
        {/* Sidebar */}
        <motion.div 
          layout
          className={cn(
            "flex flex-col transition-all duration-500 shrink-0 overflow-hidden",
            isDesktop ? "w-[340px] glass" : (showSidebar ? "w-full" : "w-0"),
            !isDesktop && !showSidebar && "hidden"
          )}
        >
        <div className="p-4 lg:p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center border",
                  isPremium ? "bg-gradient-to-br from-indigo-500 to-purple-600 border-indigo-400/30 shadow-lg shadow-indigo-500/20" : "bg-emerald-500/20 border-emerald-500/30"
                )}>
                  {isPremium ? <Crown className="w-5 h-5 text-white" /> : <Users className="w-5 h-5 text-emerald-500" />}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-lg">MOZA</span>
                    {isPremium && (
                      <motion.div
                        animate={{ rotate: [0, 10, -10, 0] }}
                        transition={{ duration: 4, repeat: Infinity }}
                      >
                        <Crown className="w-3.5 h-3.5 text-indigo-400 fill-indigo-400" />
                      </motion.div>
                    )}
                  </div>
                  {isPremium && <span className="text-[8px] text-indigo-400 font-bold uppercase tracking-widest">Premium Member</span>}
                </div>
              </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={showSettingsView}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showSettings ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400 hover:text-white"
              )}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-white/5">
          <div className="relative group">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.search_placeholder}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-600"
            />
            <div className="absolute inset-0 rounded-xl bg-emerald-500/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity" />
          </div>
        </div>

        {/* Stories Bar */}
        <div className="px-4 py-3 border-b border-white/5 overflow-x-auto custom-scrollbar flex gap-3 items-center">
          {isPremium && (
            <button 
              onClick={() => {
                const url = prompt("Enter image URL for your story:");
                if (url) {
                  socket.emit("create-story", { username, media_url: url, media_type: "image" });
                }
              }}
              className="flex-shrink-0 flex flex-col items-center gap-1 group"
            >
              <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                <Camera className="w-6 h-6 text-zinc-400 group-hover:text-white transition-colors" />
              </div>
              <span className="text-[10px] text-zinc-400 group-hover:text-white transition-colors">{t.add_story || "Add Story"}</span>
            </button>
          )}
          {stories.map((story, i) => (
            <button
              key={story.id}
              onClick={() => setActiveStory(story)}
              className="flex-shrink-0 flex flex-col items-center gap-1 group"
            >
              <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-tr from-emerald-500 to-emerald-300">
                <div className="w-full h-full rounded-full border-2 border-[#141414] overflow-hidden">
                  <img src={story.avatar_url || DEFAULT_AVATAR} alt={story.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
              </div>
              <span className="text-[10px] text-zinc-400 group-hover:text-white transition-colors truncate w-14 text-center">{story.username}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          {searchQuery.trim() !== '' && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 px-2">{t.search_results}</h3>
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {searchResults.map((user, i) => (
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.05 }}
                      key={`search-${user.id}`}
                      onClick={() => joinRoom(user.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                        activeRoom?.includes(user.id) ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400 hover:text-white"
                      )}
                    >
                      <div className="relative">
                        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform overflow-hidden">
                          {user.avatar_url ? (
                            <img src={user.avatar_url || DEFAULT_AVATAR} alt={user.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <UserIcon className="w-5 h-5" />
                          )}
                        </div>
                        {user.isOnline && (
                          <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0d0d0d] rounded-xl" />
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          <div className="font-medium">{user.name}</div>
                          {user.is_premium === 1 && (
                            <Crown className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500">{user.id}</div>
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
                {searchResults.length === 0 && (
                  <p className="text-sm text-zinc-600 px-2 italic">{t.no_users}</p>
                )}
              </div>
            </div>
          )}

          {searchQuery.trim() === '' && recentChats.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 px-2">{t.recent_chats || "Recent Chats"}</h3>
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {recentChats.map((chat, i) => (
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.05 }}
                      key={chat.username}
                      onClick={() => joinRoom(chat.username)}
                      className={cn(
                        "w-full flex items-center gap-4 p-3 rounded-2xl transition-all group",
                        activeRoom === chat.room
                          ? "bg-emerald-500/10 text-emerald-500"
                          : "hover:bg-white/5 text-zinc-400 hover:text-white"
                      )}
                    >
                        <div className={cn(
                          "relative",
                          (profiles[chat.username]?.is_premium === 1 || userList.find(u => u.id === chat.username)?.is_premium === 1) && "p-[2px] rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 animate-gradient-xy"
                        )}>
                          <img src={chat.avatar_url || profiles[chat.username]?.avatar_url || DEFAULT_AVATAR} alt={chat.username} className="w-12 h-12 rounded-full bg-white/5 border-2 border-[#141414]" referrerPolicy="no-referrer" />
                          {userList.some(u => u.id === chat.username) && (
                            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#141414] rounded-full" />
                          )}
                        </div>
                      <div className="flex-1 text-left truncate">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-medium truncate">{profiles[chat.username]?.nickname || userList.find(u => u.id === chat.username)?.name || chat.username}</span>
                            {(profiles[chat.username]?.is_premium === 1 || userList.find(u => u.id === chat.username)?.is_premium === 1) && (
                              <Crown className="w-3 h-3 text-indigo-400 fill-indigo-400 flex-shrink-0" />
                            )}
                          </div>
                          {unreadCounts[chat.room] > 0 && (
                            <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                              {unreadCounts[chat.room]}
                            </span>
                          )}
                        </div>
                        <span className="text-xs opacity-70 truncate block">{chat.lastMessage}</span>
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {searchQuery.trim() === '' && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 px-2">{t.online_users}</h3>
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {userList.filter(u => u.id !== username && !recentChats.some(chat => chat.username === u.id)).map((user, i) => (
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.05 }}
                      key={user.id}
                      onClick={() => joinRoom(user.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                        activeRoom?.includes(user.id) ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400 hover:text-white"
                      )}
                    >
                      <div className="relative">
                        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform overflow-hidden">
                          {user.avatar_url ? (
                            <img src={user.avatar_url || DEFAULT_AVATAR} alt={user.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <UserIcon className="w-5 h-5" />
                          )}
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#0d0d0d] rounded-xl" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          <div className="font-medium">{user.name}</div>
                          {user.is_premium === 1 && (
                            <Crown className="w-3 h-3 text-indigo-400 fill-indigo-400" />
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500">{user.id}</div>
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
                {userList.length === 0 && (
                  <p className="text-sm text-zinc-600 px-2 italic">{t.no_users}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.collections}</h3>
            </div>
            <div className="space-y-1">
              <button
                onClick={showFavoritesView}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                  showFavorites ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400 hover:text-white"
                )}
              >
                <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center">
                  <Star className="w-5 h-5" />
                </div>
                <span className="font-medium">{t.favorites}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t.group_chats}</h3>
              <button 
                onClick={() => setShowCreateGroup(true)}
                className="p-1 hover:bg-white/5 rounded text-emerald-500 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              <AnimatePresence mode="popLayout">
                {groupList
                  .filter(g => {
                    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                        (g.handle && g.handle.toLowerCase().includes(searchQuery.toLowerCase()));
                    const isMember = g.members?.includes(username) || g.owner === username;
                    if (searchQuery.trim() === '') {
                      return isMember;
                    }
                    return matchesSearch;
                  })
                  .map((group, i) => (
                    <motion.button
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.05 }}
                      key={group.id}
                      onClick={() => joinGroup(group)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                        activeRoom === group.id ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400 hover:text-white"
                      )}
                    >
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="font-medium">{group.name}</div>
                        {group.handle && <div className="text-[10px] text-zinc-500">{group.handle}</div>}
                      </div>
                    </motion.button>
                  ))}
              </AnimatePresence>
              {groupList.length === 0 && (
                <p className="text-sm text-zinc-600 px-2 italic">No groups yet...</p>
              )}
            </div>
          </div>
        </div>

            <div className="p-4 border-t border-white/10 bg-black/20">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center font-bold shadow-lg shadow-emerald-900/20 overflow-hidden">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url || DEFAULT_AVATAR} alt={username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      (profile?.nickname || username)[0].toUpperCase()
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{profile?.nickname || username}</span>
                    {profile?.nickname && <span className="text-[10px] text-zinc-500">{username}</span>}
                  <span className="text-[10px] text-emerald-500 uppercase tracking-tighter font-bold">
                    {isDesktop ? "MOZA Workstation" : "MOZA Mobile"}
                  </span>
                  </div>
                </div>
                {isDesktop && (
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/30" />
                  </div>
                )}
              </div>
            </div>
        </motion.div>

        {/* Main Chat Area */}
        <motion.div 
          layout
          className={cn(
            "flex-1 flex flex-col relative transition-all duration-500",
            isDesktop ? "glass-dark border-y border-r border-white/10" : "bg-[#0a0a0a]",
            !isDesktop && showSidebar && "hidden"
          )}
        >
          {activeRoom || showFavorites || showSettings ? (
            !isDesktop && (
              <div className="absolute top-4 left-4 z-50">
                <button 
                  onClick={() => setShowSidebar(true)}
                  className="p-3 bg-zinc-800/80 backdrop-blur-md rounded-2xl text-white shadow-xl border border-white/10 active:scale-95 transition-all"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>
            )
          ) : null}
          {isDesktop && (
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent opacity-50" />
          )}
          <AnimatePresence mode="wait">
            {showSettings ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 flex flex-col h-full bg-[#0d0d0d]/40 backdrop-blur-md overflow-hidden"
              >
                <div className="h-20 lg:h-24 border-b border-white/10 flex items-center justify-between px-4 lg:px-10 bg-white/5 backdrop-blur-2xl">
                  <div className="flex items-center gap-4">
                    {activeSettingsTab !== 'main' && (
                      <button 
                        onClick={() => setActiveSettingsTab('main')}
                        className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                    )}
                    <h2 className="text-2xl font-bold tracking-tight">
                      {activeSettingsTab === 'main' ? t.settings : 
                       activeSettingsTab === 'notifications' ? t.notifications :
                       activeSettingsTab === 'privacy' ? t.privacy :
                       activeSettingsTab === 'data' ? t.data :
                       activeSettingsTab === 'devices' ? t.devices :
                       activeSettingsTab === 'language' ? t.language :
                       activeSettingsTab === 'faq' ? t.faq :
                       activeSettingsTab === 'ask' ? t.ask :
                       activeSettingsTab === 'premium' ? 'Premium' : t.policy}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={startDemoCall}
                      className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-xs font-bold uppercase tracking-widest rounded-xl border border-emerald-500/20 transition-all mr-2"
                    >
                      Demo Call
                    </button>
                    <button 
                      onClick={() => setShowSettings(false)}
                      className="p-3 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                  <div className="max-w-2xl mx-auto space-y-10">
                    <AnimatePresence mode="wait">
                      {activeSettingsTab === 'main' ? (
                        <motion.div
                          key="main-settings"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          className="space-y-10"
                        >
                          {/* Profile Section */}
                          <section className="space-y-6">
                            <div className="flex items-center gap-8">
                              <div className="relative group">
                                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 p-1 shadow-2xl">
                                  <div className="w-full h-full rounded-full bg-[#0d0d0d] flex items-center justify-center overflow-hidden border-4 border-[#0d0d0d]">
                                    <img 
                                      src={profile?.avatar_url || DEFAULT_AVATAR} 
                                      alt="Profile" 
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                </div>
                                <input 
                                  type="file" 
                                  ref={fileInputRef} 
                                  onChange={handleAvatarUpload} 
                                  accept="image/*" 
                                  className="hidden" 
                                />
                                <button 
                                  onClick={() => fileInputRef.current?.click()}
                                  className="absolute bottom-0 right-0 p-2.5 bg-emerald-500 rounded-full shadow-lg border-4 border-[#0d0d0d] text-white hover:bg-emerald-400 transition-colors"
                                >
                                  <Camera className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h3 className="text-2xl font-bold text-white">{username}</h3>
                                    <p className="text-emerald-500 text-sm font-medium">{t.online}</p>
                                  </div>
                                  <button 
                                    onClick={() => setIsEditingBio(!isEditingBio)}
                                    className="p-2.5 hover:bg-white/5 rounded-xl text-emerald-500 transition-colors"
                                  >
                                    <Edit2 className="w-5 h-5" />
                                  </button>
                                </div>
                                <div className="mt-4">
                                  <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{t.bio}</h4>
                                  {isEditingBio ? (
                                    <div className="space-y-3">
                                      <textarea
                                        value={tempBio}
                                        onChange={(e) => setTempBio(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all resize-none h-24"
                                        placeholder={t.bio_placeholder}
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button 
                                          onClick={() => setIsEditingBio(false)}
                                          className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                                        >
                                          {t.cancel}
                                        </button>
                                        <button 
                                          onClick={updateBio}
                                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all"
                                        >
                                          {t.save}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-zinc-400 text-sm leading-relaxed max-w-md">
                                      {profile?.bio || (userSettings?.language === 'Russian' ? 'Цифровой архитектор и энтузиаст P2P. Строю будущее безопасной связи.' : 'Digital architect and P2P enthusiast. Building the future of secure communication.')}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </section>

                          {/* Premium Banner */}
                          <section>
                            <button 
                              onClick={() => setShowPremiumModal(true)}
                              className="w-full p-8 rounded-[2rem] bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-between group overflow-hidden relative shadow-2xl shadow-indigo-500/20 active:scale-[0.99] transition-all"
                            >
                              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10" />
                              <div className="relative z-10 flex items-center gap-5">
                                <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/30">
                                  <Crown className="w-7 h-7 text-white" />
                                </div>
                                <div className="text-left">
                                  <h4 className="font-bold text-white text-xl">{t.premium}</h4>
                                  <p className="text-white/70 text-sm">{t.premium_desc}</p>
                                </div>
                              </div>
                              <div className="relative z-10 bg-white/20 px-6 py-3 rounded-2xl backdrop-blur-md text-white text-sm font-bold group-hover:bg-white/30 transition-colors border border-white/30">
                                {t.upgrade}
                              </div>
                            </button>
                          </section>

                          {/* Settings List */}
                          <div className="grid grid-cols-1 gap-8">
                            <section className="space-y-2">
                              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2 mb-4">{t.messenger_settings}</h4>
                              
                              {[
                                { id: 'notifications', icon: Bell, label: t.notifications, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                                { id: 'privacy', icon: Lock, label: t.privacy, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                                { id: 'data', icon: Database, label: t.data, color: 'text-orange-400', bg: 'bg-orange-400/10' },
                                { id: 'media', icon: Mic, label: userSettings?.language === 'Russian' ? 'Аудио и Видео' : 'Audio & Video', color: 'text-rose-400', bg: 'bg-rose-400/10' },
                                { id: 'devices', icon: Smartphone, label: t.devices, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                                { id: 'language', icon: Globe, label: t.language, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
                                { id: 'premium', icon: Star, label: 'Premium', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
                              ].map((item) => (
                                <button 
                                  key={item.id}
                                  onClick={() => setActiveSettingsTab(item.id as any)}
                                  className="w-full flex items-center gap-5 p-4 rounded-2xl hover:bg-white/5 transition-all group"
                                >
                                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 border border-white/5", item.bg)}>
                                    <item.icon className={cn("w-6 h-6", item.color)} />
                                  </div>
                                  <span className="flex-1 text-left font-medium text-zinc-300 group-hover:text-white transition-colors">{item.label}</span>
                                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                                </button>
                              ))}
                            </section>

                            <section className="space-y-2">
                              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2 mb-4">{t.support}</h4>
                              {[
                                { id: 'ask', icon: HelpCircle, label: t.ask, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
                                { id: 'faq', icon: Info, label: t.faq, color: 'text-pink-400', bg: 'bg-pink-400/10' },
                                { id: 'policy', icon: Shield, label: t.policy, color: 'text-zinc-400', bg: 'bg-zinc-400/10' },
                              ].map((item) => (
                                <button 
                                  key={item.id}
                                  onClick={() => setActiveSettingsTab(item.id as any)}
                                  className="w-full flex items-center gap-5 p-4 rounded-2xl hover:bg-white/5 transition-all group"
                                >
                                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 border border-white/5", item.bg)}>
                                    <item.icon className={cn("w-6 h-6", item.color)} />
                                  </div>
                                  <span className="flex-1 text-left font-medium text-zinc-300 group-hover:text-white transition-colors">{item.label}</span>
                                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                                </button>
                              ))}
                            </section>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={activeSettingsTab}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-8"
                        >
                          {activeSettingsTab === 'notifications' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-6 space-y-6">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="font-bold text-white">{t.private_chats}</h4>
                                    <p className="text-xs text-zinc-500">{t.enable_notifications}</p>
                                  </div>
                                  <div 
                                    onClick={() => updateSetting('notifications_private', userSettings?.notifications_private ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.notifications_private ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.notifications_private ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="font-bold text-white">{t.groups}</h4>
                                    <p className="text-xs text-zinc-500">{t.enable_notifications}</p>
                                  </div>
                                  <div 
                                    onClick={() => updateSetting('notifications_groups', userSettings?.notifications_groups ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.notifications_groups ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.notifications_groups ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="font-bold text-white">{t.calls}</h4>
                                    <p className="text-xs text-zinc-500">{t.enable_notifications}</p>
                                  </div>
                                  <div 
                                    onClick={() => updateSetting('notifications_calls', userSettings?.notifications_calls ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.notifications_calls ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.notifications_calls ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="font-bold text-white">{t.call_sounds}</h4>
                                    <p className="text-xs text-zinc-500">{t.enable_notifications}</p>
                                  </div>
                                  <div 
                                    onClick={() => updateSetting('call_join_leave_sounds', userSettings?.call_join_leave_sounds === 0 ? 1 : 0)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.call_join_leave_sounds !== 0 ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.call_join_leave_sounds !== 0 ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                                <div className="pt-4 border-t border-white/10">
                                  <button 
                                    onClick={() => requestNotificationPermission()}
                                    className="w-full py-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-sm font-bold rounded-2xl border border-emerald-500/20 transition-all flex items-center justify-center gap-2"
                                  >
                                    <Bell className="w-4 h-4" />
                                    {userSettings?.language === 'Russian' ? 'Запросить разрешение на уведомления' : 'Request Browser Notifications'}
                                  </button>
                                  <p className="text-[10px] text-zinc-500 mt-2 text-center">
                                    {userSettings?.language === 'Russian' 
                                      ? 'Нажмите, чтобы браузер запросил разрешение на показ уведомлений о сообщениях и звонках.' 
                                      : 'Click to prompt the browser for permission to show message and call notifications.'}
                                  </p>
                                </div>
                              </div>
                              <div className="bg-white/5 rounded-3xl p-6">
                                <h4 className="font-bold text-white mb-4">{t.badge_counter}</h4>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-zinc-300">{t.include_muted}</span>
                                  <div 
                                    onClick={() => updateSetting('badge_muted', userSettings?.badge_muted ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.badge_muted ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.badge_muted ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'privacy' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-6 space-y-6">
                                <div className="flex items-center justify-between group cursor-pointer">
                                  <div>
                                    <h4 className="font-bold text-white">{t.two_step}</h4>
                                    <p className="text-xs text-zinc-500">{t.offline}</p>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white" />
                                </div>
                                <div className="flex items-center justify-between group cursor-pointer">
                                  <div>
                                    <h4 className="font-bold text-white">{t.passcode}</h4>
                                    <p className="text-xs text-zinc-500">{t.offline}</p>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white" />
                                </div>
                                <div className="flex items-center justify-between group cursor-pointer">
                                  <div>
                                    <h4 className="font-bold text-white">{t.blocked}</h4>
                                    <p className="text-xs text-zinc-500">0 {t.items}</p>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white" />
                                </div>
                              </div>
                              <div className="px-4">
                                <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-4">{t.advanced}</h4>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="font-bold text-white">{t.p2p}</h4>
                                    <p className="text-xs text-zinc-500">{t.p2p_desc}</p>
                                  </div>
                                  <div 
                                    onClick={() => updateSetting('p2p_calls', userSettings?.p2p_calls ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.p2p_calls ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.p2p_calls ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'data' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-6 space-y-6">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2">Disk and Network Usage</h4>
                                <div className="flex items-center justify-between group cursor-pointer">
                                  <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
                                      <Database className="w-5 h-5 text-blue-500" />
                                    </div>
                                    <div>
                                      <h4 className="font-bold text-white">{t.storage_usage}</h4>
                                      <p className="text-xs text-zinc-500">24.5 MB used</p>
                                    </div>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                                </div>
                                <div className="flex items-center justify-between group cursor-pointer">
                                  <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                                      <Globe className="w-5 h-5 text-emerald-500" />
                                    </div>
                                    <div>
                                      <h4 className="font-bold text-white">{t.data_usage}</h4>
                                      <p className="text-xs text-zinc-500">1.2 GB sent • 4.5 GB received</p>
                                    </div>
                                  </div>
                                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                                </div>
                              </div>
                              <div className="bg-white/5 rounded-3xl p-6 space-y-4">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2">{t.auto_media}</h4>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-zinc-300">{t.mobile_data}</span>
                                  <div 
                                    onClick={() => updateSetting('auto_media_mobile', userSettings?.auto_media_mobile ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.auto_media_mobile ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.auto_media_mobile ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-zinc-300">{t.wifi}</span>
                                  <div 
                                    onClick={() => updateSetting('auto_media_wifi', userSettings?.auto_media_wifi ? 0 : 1)}
                                    className={cn("w-12 h-6 rounded-full relative p-1 cursor-pointer transition-colors", userSettings?.auto_media_wifi ? "bg-emerald-500" : "bg-zinc-700")}
                                  >
                                    <motion.div 
                                      animate={{ x: userSettings?.auto_media_wifi ? 24 : 0 }}
                                      className="w-4 h-4 bg-white rounded-full" 
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'media' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-6 space-y-6">
                                <div>
                                  <h4 className="font-bold text-white mb-2">{userSettings?.language === 'Russian' ? 'Микрофон' : 'Microphone'}</h4>
                                  <select 
                                    value={selectedAudioId}
                                    onChange={(e) => setSelectedAudioId(e.target.value)}
                                    className="w-full bg-zinc-800 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                  >
                                    {audioDevices.map(device => (
                                      <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <h4 className="font-bold text-white mb-2">{userSettings?.language === 'Russian' ? 'Камера' : 'Camera'}</h4>
                                  <select 
                                    value={selectedVideoId}
                                    onChange={(e) => setSelectedVideoId(e.target.value)}
                                    className="w-full bg-zinc-800 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                  >
                                    {videoDevices.map(device => (
                                      <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'devices' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-8 text-center space-y-4">
                                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
                                  <Smartphone className="w-10 h-10 text-emerald-500" />
                                </div>
                                <h4 className="text-xl font-bold">{t.link_device}</h4>
                                <p className="text-sm text-zinc-400 max-w-xs mx-auto">{t.link_device_desc}</p>
                                <button className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold transition-all">
                                  {t.link_new}
                                </button>
                              </div>
                              <div className="space-y-4">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2">{t.active_sessions}</h4>
                                <div className="bg-white/5 rounded-3xl p-6 flex items-center gap-4">
                                  <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center">
                                    <Monitor className="w-6 h-6 text-zinc-400" />
                                  </div>
                                  <div className="flex-1">
                                    <h5 className="font-bold text-white">MOZA Web v1.0.4</h5>
                                    <p className="text-xs text-zinc-500">Chrome on Windows • {t.online}</p>
                                  </div>
                                  <span className="text-[10px] font-bold text-emerald-500 uppercase">{t.current}</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'language' && (
                            <div className="bg-white/5 rounded-3xl overflow-hidden">
                              {[
                                { name: 'English', native: 'English' },
                                { name: 'Russian', native: 'Русский' },
                                { name: 'German', native: 'Deutsch' },
                                { name: 'French', native: 'Français' },
                                { name: 'Spanish', native: 'Español' },
                                { name: 'Chinese', native: '中文' },
                              ].map((lang, i) => (
                                <button 
                                  key={i}
                                  onClick={() => updateSetting('language', lang.name)}
                                  className="w-full flex items-center justify-between p-6 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
                                >
                                  <div className="text-left">
                                    <div className="font-bold text-white">{lang.name}</div>
                                    <div className="text-xs text-zinc-500">{lang.native}</div>
                                  </div>
                                  {userSettings?.language === lang.name && (
                                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                                      <div className="w-2 h-2 bg-white rounded-full" />
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {activeSettingsTab === 'faq' && (
                            <div className="space-y-4">
                              {[
                                { q: 'What is MOZA?', a: 'MOZA is a secure, end-to-end encrypted messaging platform built for privacy and speed.' },
                                { q: 'Is it free?', a: 'Yes, MOZA is completely free to use. We offer Premium features for those who want to support development.' },
                                { q: 'How secure is it?', a: 'We use industry-standard E2EE protocols. Your messages never leave your device unencrypted.' },
                                { q: 'Can I use it on mobile?', a: 'Mobile apps are currently in development and will be released soon!' },
                              ].map((item, i) => (
                                <div key={i} className="bg-white/5 rounded-3xl p-6 space-y-2">
                                  <h4 className="font-bold text-white">{item.q}</h4>
                                  <p className="text-sm text-zinc-400 leading-relaxed">{item.a}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {activeSettingsTab === 'ask' && (
                            <div className="space-y-6">
                              <div className="bg-white/5 rounded-3xl p-8 text-center space-y-6">
                                <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto">
                                  <HelpCircle className="w-10 h-10 text-yellow-500" />
                                </div>
                                <div className="space-y-2">
                                  <h4 className="text-xl font-bold">{t.need_help}</h4>
                                  <p className="text-sm text-zinc-400">{t.help_desc}</p>
                                </div>
                                <button className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-900/20">
                                  {t.start_chat}
                                </button>
                              </div>
                              <div className="bg-white/5 rounded-3xl p-6 space-y-4">
                                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2">{t.contact_other}</h4>
                                <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 rounded-2xl transition-colors">
                                  <span className="text-sm text-zinc-300">{t.email_support}</span>
                                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                                </button>
                                <button className="w-full flex items-center justify-between p-4 hover:bg-white/5 rounded-2xl transition-colors">
                                  <span className="text-sm text-zinc-300">Twitter @MOZA_Support</span>
                                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                                </button>
                              </div>
                            </div>
                          )}

                          {activeSettingsTab === 'policy' && (
                            <div className="bg-white/5 rounded-3xl p-8 space-y-8">
                              <div className="space-y-4">
                                <h4 className="text-xl font-bold text-white">{t.policy}</h4>
                                <p className="text-xs text-zinc-500 uppercase tracking-widest">{t.last_updated}: March 1, 2026</p>
                              </div>
                              <div className="space-y-6 text-sm text-zinc-400 leading-relaxed">
                                <section className="space-y-2">
                                  <h5 className="font-bold text-white">1. Data Collection</h5>
                                  <p>We do not collect your personal data. Your messages are encrypted end-to-end and are never stored on our servers in a readable format.</p>
                                </section>
                                <section className="space-y-2">
                                  <h5 className="font-bold text-white">2. Encryption</h5>
                                  <p>MOZA uses the Signal Protocol for end-to-end encryption. This means only you and the person you're communicating with can read what is sent.</p>
                                </section>
                                <section className="space-y-2">
                                  <h5 className="font-bold text-white">3. Third Parties</h5>
                                  <p>We do not share your information with third parties. We do not sell your data. We do not show ads.</p>
                                </section>
                                <section className="space-y-2">
                                  <h5 className="font-bold text-white">4. Your Rights</h5>
                                  <p>You have the right to delete your account and all associated data at any time. Once deleted, this data cannot be recovered.</p>
                                </section>
                              </div>
                              <button className="w-full py-4 border border-white/10 hover:bg-white/5 rounded-2xl text-sm font-bold transition-all">
                                Download Full Policy (PDF)
                              </button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="pt-12 text-center border-t border-white/5">
                      <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">MOZA for Desktop v1.0.4</p>
                      <p className="text-zinc-700 text-[10px] mt-2 font-medium">Built with End-to-End Encryption</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : activeRoom || showFavorites ? (
              <motion.div
                key={activeRoom || 'favorites'}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex-1 flex h-full overflow-hidden"
              >
                <div className="flex-1 flex flex-col h-full min-w-0">
                  {/* Chat Header */}
                  <div className="h-20 lg:h-24 shrink-0 border-b border-white/10 flex items-center justify-between px-4 lg:px-10 bg-white/5 backdrop-blur-2xl">
                  <div 
                    className="flex items-center gap-5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => !showFavorites && setShowChatInfo(!showChatInfo)}
                  >
                    <motion.div 
                      layoutId="header-icon"
                      className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/10 shadow-inner overflow-hidden"
                    >
                      {showFavorites ? (
                        <Star className="w-6 h-6 text-emerald-400" />
                      ) : (
                        (() => {
                          const activeUser = profiles[activeRoomName] || userList.find(u => u.id === activeRoomName);
                          return activeUser?.avatar_url ? (
                            <img src={activeUser.avatar_url || DEFAULT_AVATAR} alt={activeRoomName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <UserIcon className="w-6 h-6 text-zinc-300" />
                          );
                        })()
                      )}
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <motion.h2 layoutId="header-title" className="font-bold text-lg tracking-tight truncate flex items-center gap-2">
                        {activeRoom?.startsWith('group-') ? activeRoomName : (profiles[activeRoomName]?.nickname || userList.find(u => u.id === activeRoomName)?.name || activeRoomName)}
                        {!activeRoom?.startsWith('group-') && (profiles[activeRoomName]?.is_premium === 1 || userList.find(u => u.id === activeRoomName)?.is_premium === 1) && (
                          <Crown className="w-4 h-4 text-indigo-400 fill-indigo-400" />
                        )}
                      </motion.h2>
                      <span className="text-xs text-emerald-400 font-medium uppercase tracking-widest block truncate">
                        {showFavorites ? (
                          `${favoriteMessages.length} ${t.items}`
                        ) : (
                          activeRoom?.startsWith('group-') ? t.group_chat : (profiles[activeRoomName]?.bio || userList.find(u => u.id === activeRoomName)?.bio || t.online)
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeRoom && !activeRoom.startsWith('group-') && (
                      <>
                        <button 
                          onClick={() => startCall(activeRoomName, 'audio')}
                          className="p-3 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-emerald-400 transition-all active:scale-90"
                        >
                          <Phone className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => startCall(activeRoomName, 'video')}
                          className="p-3 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-emerald-400 transition-all active:scale-90"
                        >
                          <Video className="w-5 h-5" />
                        </button>
                      </>
                    )}
                    {activeRoom && (
                      <>
                        {activeRoom.startsWith('group-') && (
                          <button 
                            onClick={() => {
                              const group = groupList.find(g => g.id === activeRoom);
                              if (group) setShowGroupSettings(group);
                            }}
                            className="p-3 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-emerald-400 transition-all active:scale-90"
                          >
                            <Settings className="w-5 h-5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div 
                  ref={scrollContainerRef}
                  className="flex-1 overflow-y-auto p-8 space-y-6 scroll-smooth"
                >
                  {(showFavorites ? favoriteMessages : messages).map((msg, i) => (
                    msg.sender === 'system' ? (
                      <div key={msg.id || i} className="w-full flex justify-center my-4">
                        <div className="bg-white/5 backdrop-blur-md border border-white/10 px-4 py-1.5 rounded-full">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">
                            {msg.content}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <motion.div
                        layout
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        key={msg.id || i}
                        className={cn(
                          "flex flex-col max-w-[70%] group",
                          msg.sender === username ? "ml-auto items-end" : "items-start"
                        )}
                      >
                      <div className="flex items-center gap-2 mb-1">
                        {msg.sender !== username && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                              {profiles[msg.sender]?.nickname || userList.find(u => u.id === msg.sender)?.name || msg.sender}
                            </span>
                            {(profiles[msg.sender]?.is_premium === 1 || userList.find(u => u.id === msg.sender)?.is_premium === 1) && (
                              <Crown className="w-2.5 h-2.5 text-indigo-400 fill-indigo-400" />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="relative">
                        <div className={cn(
                          "px-5 py-3.5 rounded-[1.5rem] text-sm leading-relaxed shadow-xl transition-all duration-300",
                          msg.sender === username 
                            ? "bg-emerald-600/80 text-white rounded-tr-none backdrop-blur-md border border-white/10 hover:bg-emerald-600" 
                            : "bg-white/10 text-zinc-100 rounded-tl-none border border-white/10 backdrop-blur-md hover:bg-white/15",
                          msg.mediaType === 'video' ? "p-1 bg-transparent border-none shadow-none hover:bg-transparent" : ""
                        )}>
                          {msg.mediaUrl && (
                            <div className={cn(
                              (msg.content && !msg.content.startsWith('[') && !msg.content.endsWith(']')) ? "mb-2" : ""
                            )}>
                              {msg.mediaType === 'audio' ? (
                                <AudioMessage src={msg.mediaUrl} />
                              ) : msg.mediaType === 'video' ? (
                                <VideoMessage src={msg.mediaUrl} />
                              ) : msg.mediaType === 'image' ? (
                                <div className="rounded-xl overflow-hidden max-w-sm">
                                  <img src={msg.mediaUrl} alt="Attachment" className="w-full h-auto object-cover" referrerPolicy="no-referrer" />
                                </div>
                              ) : msg.mediaType === 'video_file' ? (
                                <VideoMessage src={msg.mediaUrl} circular={false} />
                              ) : msg.mediaType === 'audio_file' ? (
                                <AudioMessage src={msg.mediaUrl} />
                              ) : msg.mediaType === 'file' ? (
                                <a 
                                  href={msg.mediaUrl} 
                                  download={msg.content.replace(/^\[|\]$/g, '')}
                                  className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors max-w-sm"
                                >
                                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                    <File className="w-5 h-5 text-emerald-500" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white truncate">{msg.content.replace(/^\[|\]$/g, '')}</p>
                                    <p className="text-[10px] text-zinc-400">Click to download</p>
                                  </div>
                                </a>
                              ) : null}
                            </div>
                          )}
                          {(!msg.mediaUrl || (msg.content && !msg.content.startsWith('[') && !msg.content.endsWith(']'))) && (
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          )}
                        </div>
                        
                        {/* Favorite Toggle Button */}
                        <button
                          onClick={() => msg.id && toggleFavorite(msg.id, !!msg.isFavorite)}
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 p-2 rounded-full transition-all opacity-0 group-hover:opacity-100",
                            msg.sender === username ? "-left-12" : "-right-12",
                            msg.isFavorite ? "text-emerald-500 opacity-100" : "text-zinc-600 hover:text-zinc-400"
                          )}
                        >
                          <Star className={cn("w-4 h-4", msg.isFavorite && "fill-current")} />
                        </button>
                      </div>
                      <span className="text-[10px] text-zinc-600 mt-2 px-1">
                        {format(new Date(msg.timestamp), 'HH:mm')}
                      </span>
                    </motion.div>
                  )))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                {!showFavorites && (
                  <div className="p-4 lg:p-10 shrink-0 relative">
                    <AnimatePresence>
                    </AnimatePresence>
                    <form 
                      onSubmit={sendMessage}
                      className="bg-white/5 border border-white/10 rounded-[1.5rem] p-2 lg:p-2.5 flex items-center gap-3 focus-within:border-emerald-500/50 transition-all backdrop-blur-xl shadow-2xl relative"
                    >
                      {recordingMode ? (
                        <div className="flex-1 flex items-center justify-between px-3 lg:px-5 py-2 lg:py-3 text-sm relative">
                          <div className="flex items-center gap-3 text-emerald-500">
                            <div className="flex items-center gap-1 h-4">
                              {[...Array(5)].map((_, i) => (
                                <motion.div
                                  key={i}
                                  animate={{ height: ['20%', '100%', '20%'] }}
                                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.1 }}
                                  className="w-1 bg-emerald-500 rounded-full"
                                />
                              ))}
                            </div>
                            <span className="font-mono">{Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</span>
                            <span className="text-zinc-400 ml-2 hidden sm:inline">
                              Recording voice message...
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              type="button" 
                              onClick={cancelRecording}
                              className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <button 
                              type="button" 
                              onClick={stopRecording}
                              className="p-2 bg-emerald-600/90 hover:bg-emerald-500 rounded-xl transition-all active:scale-90 shadow-lg shadow-emerald-900/40"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <input 
                            type="file" 
                            ref={attachmentInputRef} 
                            onChange={handleAttachmentUpload} 
                            className="hidden" 
                          />
                          <button
                            type="button"
                            onClick={() => attachmentInputRef.current?.click()}
                            className="p-3 text-zinc-400 hover:text-emerald-400 transition-colors rounded-xl hover:bg-white/5"
                          >
                            <Paperclip className="w-5 h-5" />
                          </button>
                          <div className="flex-1 flex flex-col justify-center relative">
                            {attachment && (
                              <div className="absolute bottom-full left-0 mb-2 p-2 bg-zinc-800 rounded-xl border border-white/10 flex items-center gap-3 shadow-xl">
                                {attachment.type === 'image' ? (
                                  <img src={attachment.url} alt="Attachment" className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                                ) : attachment.type === 'video_file' ? (
                                  <div className="w-12 h-12 rounded-lg bg-zinc-900 flex items-center justify-center">
                                    <VideoIcon className="w-6 h-6 text-emerald-500" />
                                  </div>
                                ) : attachment.type === 'audio_file' ? (
                                  <div className="w-12 h-12 rounded-lg bg-zinc-900 flex items-center justify-center">
                                    <Mic className="w-6 h-6 text-emerald-500" />
                                  </div>
                                ) : (
                                  <div className="w-12 h-12 rounded-lg bg-zinc-900 flex items-center justify-center">
                                    <File className="w-6 h-6 text-emerald-500" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-[100px] max-w-[200px]">
                                  <p className="text-sm font-medium text-white truncate">{attachment.name}</p>
                                  <p className="text-xs text-zinc-400 uppercase">{attachment.type}</p>
                                </div>
                                <button 
                                  type="button" 
                                  onClick={() => {
                                    setAttachment(null);
                                    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
                                  }}
                                  className="p-1.5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                            <input
                              type="text"
                              value={inputMessage}
                              onChange={(e) => setInputMessage(e.target.value)}
                              placeholder={t.type_message}
                              className="w-full bg-transparent px-3 lg:px-5 py-2 lg:py-3 text-sm focus:outline-none placeholder:text-zinc-500"
                            />
                          </div>
                          {inputMessage.trim() || attachment ? (
                            <button 
                              type="submit"
                              className="p-3 lg:p-4 bg-emerald-600/90 hover:bg-emerald-500 rounded-2xl transition-all active:scale-90 shadow-lg shadow-emerald-900/40"
                            >
                              <Send className="w-5 h-5" />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button 
                                type="button"
                                onClick={() => startRecording('audio')}
                                className="p-3 lg:p-4 text-zinc-400 hover:text-emerald-500 hover:bg-white/5 rounded-2xl transition-all active:scale-90"
                              >
                                <Mic className="w-5 h-5" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </form>
                  </div>
                )}
                </div>

                {/* Chat Info Sidebar */}
                <AnimatePresence>
                  {showChatInfo && activeRoom && (
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: isDesktop ? 320 : '100%', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      className={cn(
                        "bg-[#141414] border-l border-white/10 flex flex-col shrink-0 overflow-hidden",
                        !isDesktop && "absolute inset-0 z-50"
                      )}
                    >
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {/* Header */}
                        <div className="p-4 flex items-center justify-between border-b border-white/10">
                          <h3 className="font-bold text-lg">Информация</h3>
                          <button onClick={() => setShowChatInfo(false)} className="p-2 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        
                        {/* Profile Info */}
                        <div className="p-6 flex flex-col items-center border-b border-white/10">
                          <div className="w-24 h-24 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4 overflow-hidden border-2 border-white/10 shadow-xl">
                            {(() => {
                              const activeUser = profiles[activeRoomName] || userList.find(u => u.id === activeRoomName);
                              return activeRoom.startsWith('group-') ? (
                                <Users className="w-10 h-10 text-zinc-500" />
                              ) : activeUser?.avatar_url ? (
                                <img src={activeUser.avatar_url || DEFAULT_AVATAR} alt={activeRoomName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <UserIcon className="w-10 h-10 text-zinc-500" />
                              );
                            })()}
                          </div>
                          <h2 className="text-xl font-bold">
                            {activeRoom.startsWith('group-') ? activeRoomName : (profiles[activeRoomName]?.nickname || userList.find(u => u.id === activeRoomName)?.name || activeRoomName)}
                          </h2>
                          {activeRoom.startsWith('group-') ? (
                            <p className="text-sm text-zinc-400 mt-1">
                              {groupList.find(g => g.id === activeRoom)?.members?.length || 0} участников
                            </p>
                          ) : (
                            <div className="mt-1 flex flex-col">
                              <p className="text-sm text-zinc-300">
                                {profiles[activeRoomName]?.bio || userList.find(u => u.id === activeRoomName)?.bio || ''}
                              </p>
                              <p className="text-xs text-emerald-500 mt-1 font-medium">
                                {t.online}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="p-4 grid grid-cols-4 gap-2 border-b border-white/10">
                          <button 
                            onClick={() => {
                              const isMuted = mutedChats.includes(activeRoom);
                              socket.emit('toggle-mute-chat', { username, room: activeRoom, isMuted: !isMuted });
                            }}
                            className={cn(
                              "flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 transition-colors",
                              mutedChats.includes(activeRoom) ? "text-emerald-400" : "text-zinc-400 hover:text-white"
                            )}
                          >
                            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                              <VolumeX className="w-5 h-5" />
                            </div>
                            <span className="text-[10px] font-medium">{mutedChats.includes(activeRoom) ? 'Включить' : 'Звук'}</span>
                          </button>
                          <button 
                            onClick={() => {
                              if (activeRoom.startsWith('group-')) {
                                setReportGroupPrompt({ roomId: activeRoom, name: activeRoomName });
                              } else {
                                const reason = prompt('Укажите причину жалобы:');
                                if (reason) {
                                  socket.emit('report-user', { reporter: username, reportedUser: activeRoomName, reason });
                                  alert('Жалоба отправлена');
                                }
                              }
                            }}
                            className="flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                          >
                            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                              <Info className="w-5 h-5" />
                            </div>
                            <span className="text-[10px] font-medium">Жалоба</span>
                          </button>
                          {activeRoom.startsWith('group-') ? (
                            <button 
                              onClick={() => {
                                socket.emit('leave-group', { roomId: activeRoom, username });
                                setActiveRoom(null);
                                setActiveRoomName('');
                                setShowChatInfo(false);
                              }}
                              className="flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
                            >
                              <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                                <LogOut className="w-5 h-5" />
                              </div>
                              <span className="text-[10px] font-medium">Покинуть</span>
                            </button>
                          ) : (
                            <button 
                              onClick={() => {
                                const isBlocked = blockedUsers.includes(activeRoomName);
                                if (isBlocked) {
                                  socket.emit('unblock-user', { username, blockedUser: activeRoomName });
                                } else {
                                  if (confirm(`Вы уверены, что хотите заблокировать пользователя ${activeRoomName}?`)) {
                                    socket.emit('block-user', { username, blockedUser: activeRoomName });
                                  }
                                }
                              }}
                              className={cn(
                                "flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 transition-colors",
                                blockedUsers.includes(activeRoomName) ? "text-red-400" : "text-zinc-400 hover:text-white"
                              )}
                            >
                              <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                                <UserMinus className="w-5 h-5" />
                              </div>
                              <span className="text-[10px] font-medium">{blockedUsers.includes(activeRoomName) ? 'Разблок.' : 'Блок'}</span>
                            </button>
                          )}
                          <button 
                            onClick={() => {
                              if (confirm('Вы уверены, что хотите очистить историю сообщений в этом чате? Это действие нельзя отменить.')) {
                                socket.emit('clear-chat', { username, room: activeRoom });
                              }
                            }}
                            className="flex flex-col items-center gap-2 p-2 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-red-400 transition-colors"
                          >
                            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center">
                              <X className="w-5 h-5" />
                            </div>
                            <span className="text-[10px] font-medium">Очистить</span>
                          </button>
                        </div>

                        {/* Participants List (for groups) */}
                        {activeRoom.startsWith('group-') && (
                          <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2 text-zinc-400 font-bold text-xs tracking-widest uppercase">
                                <Users className="w-4 h-4" />
                                <span>{groupList.find(g => g.id === activeRoom)?.members?.length || 0} Участников</span>
                              </div>
                            </div>
                            <div className="space-y-1">
                              {(() => {
                                const group = groupList.find(g => g.id === activeRoom);
                                if (!group || !group.members) return null;
                                return group.members.map(member => {
                                  let userAvatar = undefined;
                                  let userBio = undefined;
                                  let isPremiumMember = false;
                                  if (member === username) {
                                    userAvatar = profile?.avatar_url;
                                    userBio = profile?.bio;
                                    isPremiumMember = isPremium;
                                  } else {
                                    const p = profiles[member];
                                    const u = userList.find(u => u.id === member);
                                    userAvatar = p?.avatar_url || u?.avatar_url;
                                    userBio = p?.bio || u?.bio;
                                    isPremiumMember = p?.is_premium === 1 || u?.is_premium === 1;
                                  }
                                  
                                  const isOnline = Array.from(socketToUsername.values()).includes(member) || member === username;
                                  
                                  return (
                                    <div 
                                      key={member} 
                                      className="flex items-center justify-between p-2 hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                                      onClick={() => {
                                        if (member !== username) {
                                          joinRoom(member);
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center overflow-hidden border border-white/5">
                                          <img src={userAvatar || DEFAULT_AVATAR} alt={member} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                        </div>
                                        <div>
                                          <div className="font-medium text-sm text-white flex items-center gap-1.5">
                                            {profiles[member]?.nickname || member}
                                            {isPremiumMember && <Crown className="w-3 h-3 text-indigo-400 fill-indigo-400" />}
                                          </div>
                                          <div className={cn("text-xs", isOnline ? "text-emerald-400" : "text-zinc-500")}>
                                            {isOnline ? 'в сети' : 'был(а) недавно'}
                                          </div>
                                        </div>
                                      </div>
                                      {group.owner === member && (
                                        <span className="text-[10px] text-blue-400 font-medium px-2 py-1 bg-blue-500/10 rounded-lg">
                                          владелец
                                        </span>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center text-zinc-600"
              >
                <div className="w-24 h-24 bg-white/5 rounded-[2rem] flex items-center justify-center mb-8 border border-white/5 backdrop-blur-xl">
                  <Send className="w-10 h-10 opacity-20 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-medium text-zinc-300 tracking-tight">{t.no_messages}</h2>
                <p className="text-sm text-zinc-500 mt-2">{t.select_contact}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

        {/* Minimized Call Bar */}
        <AnimatePresence>
          {activeCall && isCallMinimized && (
            <motion.div
              initial={{ y: -100 }}
              animate={{ y: 0 }}
              exit={{ y: -100 }}
              className="fixed top-0 left-0 right-0 z-[60] bg-emerald-600 text-white py-3 px-4 flex items-center justify-between shadow-lg cursor-pointer"
              onClick={() => setIsCallMinimized(false)}
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span className="text-sm font-medium">
                  {activeCall.type === 'video' ? t.video_call : t.audio_call}: {(() => {
                    const otherUser = activeCall.isIncoming ? activeCall.from : activeCall.to;
                    return profiles[otherUser]?.nickname || userList.find(u => u.id === otherUser)?.name || otherUser;
                  })()}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] uppercase tracking-widest font-bold opacity-80">{t.return_to_call}</span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    endCall();
                  }}
                  className="p-1.5 bg-red-500 rounded-lg hover:bg-red-400 transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Call Overlay */}
        <AnimatePresence>
          {activeCall && !isCallMinimized && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-[#0a0a0a] flex flex-col items-center justify-between overflow-hidden font-sans"
            >
              {/* Background Stream / Avatar */}
              <div className="absolute inset-0 z-0">
                {activeCall.remoteStream && activeCall.remoteStream.getVideoTracks().length > 0 ? (
                  <video
                    autoPlay
                    playsInline
                    ref={el => { if (el) el.srcObject = activeCall.remoteStream || null; }}
                    className="w-full h-full object-cover opacity-60"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] flex items-center justify-center">
                    <div className="relative">
                      <div className="w-48 h-48 rounded-full bg-zinc-800/50 p-1 backdrop-blur-3xl">
                        <img 
                          src={(() => {
                            const otherUser = activeCall.isIncoming ? activeCall.from : activeCall.to;
                            return profiles[otherUser]?.avatar_url || userList.find(u => u.id === otherUser)?.avatar_url || DEFAULT_AVATAR;
                          })()} 
                          alt="Avatar" 
                          className="w-full h-full rounded-full object-cover border-4 border-white/5"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      {activeCall.isIncoming && (
                        <div className="absolute -inset-4 rounded-full border-2 border-emerald-500/30 animate-ping" />
                      )}
                    </div>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent opacity-80" />
              </div>

              {/* Top Info */}
              <div className="relative z-10 w-full px-8 pt-12 flex flex-col items-center text-center">
                <motion.div
                  initial={{ y: -20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="space-y-2"
                >
                  <h2 className="text-3xl font-bold text-white tracking-tight">
                    {(() => {
                      const otherUser = activeCall.isIncoming ? activeCall.from : activeCall.to;
                      return profiles[otherUser]?.nickname || userList.find(u => u.id === otherUser)?.name || otherUser;
                    })()}
                  </h2>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-zinc-400 text-sm font-medium uppercase tracking-widest">
                      {activeCall.isIncoming 
                        ? t.incoming_call 
                        : (activeCall.remoteStream ? t.connected : t.calling)}
                    </p>
                  </div>
                </motion.div>
              </div>

              {/* Local Video PIP */}
              <AnimatePresence>
                {isVideoOn && localStream.current && (
                  <motion.div 
                    drag
                    dragConstraints={{ left: -100, right: 100, top: -100, bottom: 100 }}
                    initial={{ scale: 0.5, opacity: 0, x: 20, y: 20 }}
                    animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    className="absolute top-8 right-8 w-32 h-48 sm:w-40 sm:h-60 bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10 z-20 cursor-move"
                  >
                    <video
                      autoPlay
                      playsInline
                      muted
                      ref={el => { if (el) el.srcObject = localStream.current; }}
                      className="w-full h-full object-cover"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Controls Container */}
              <div className="relative z-10 w-full px-8 pb-16 flex flex-col items-center gap-8">
                <div className="flex items-center justify-center gap-6 sm:gap-10">
                  {activeCall.isIncoming ? (
                    <>
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={endCall}
                        className="w-16 h-16 sm:w-20 sm:h-20 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/20 transition-colors"
                      >
                        <PhoneOff className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                      </motion.button>
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={answerCall}
                        className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-500 hover:bg-emerald-400 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/20 transition-colors"
                      >
                        <Phone className="w-7 h-7 sm:w-8 sm:h-8 text-white animate-bounce" />
                      </motion.button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={toggleMute}
                        className={cn(
                          "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all active:scale-90",
                          isMuted ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                        )}
                      >
                        {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                      </button>
                      <button 
                        onClick={toggleVideo}
                        className={cn(
                          "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all active:scale-90",
                          !isVideoOn ? "bg-red-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                        )}
                      >
                        {isVideoOn ? <VideoIcon className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                      </button>
                      <button 
                        onClick={toggleScreenShare}
                        className={cn(
                          "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all active:scale-90",
                          isScreenSharing ? "bg-blue-500 text-white" : "bg-white/10 text-white hover:bg-white/20"
                        )}
                      >
                        <Monitor className="w-6 h-6" />
                      </button>
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={endCall}
                        className="w-16 h-16 sm:w-20 sm:h-20 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/20 transition-colors"
                      >
                        <PhoneOff className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                      </motion.button>
                    </>
                  )}
                </div>
                
                <button 
                  onClick={() => setIsCallMinimized(true)}
                  className="text-zinc-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors py-2 px-4 rounded-full hover:bg-white/5"
                >
                  {t.minimize_call}
                </button>
              </div>
              {/* Hidden Audio Element for Remote Stream */}
              <div className="hidden">
                {activeCall.remoteStream && (
                  <audio 
                    autoPlay 
                    ref={el => { if (el && activeCall.remoteStream) el.srcObject = activeCall.remoteStream }}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Story Modal */}
        <AnimatePresence>
          {activeStory && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black flex flex-col"
            >
              <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex justify-between items-center z-10">
                <div className="flex items-center gap-3">
                  <img src={activeStory.avatar_url || DEFAULT_AVATAR} alt={activeStory.username} className="w-10 h-10 rounded-full border border-white/20" referrerPolicy="no-referrer" />
                  <span className="text-white font-medium">{activeStory.username}</span>
                </div>
                <button
                  onClick={() => setActiveStory(null)}
                  className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center relative">
                {activeStory.media_type === 'image' ? (
                  <img src={activeStory.media_url} alt="Story" className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <video src={activeStory.media_url} controls autoPlay className="max-w-full max-h-full object-contain" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create Group Modal */}
        <AnimatePresence>
          {showPremiumModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-[2.5rem] p-10 w-full max-w-md shadow-2xl space-y-6 relative"
              >
                <button 
                  onClick={() => setShowPremiumModal(false)}
                  className="absolute top-6 right-6 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/20">
                  <Crown className="w-12 h-12 text-white" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold text-white">{t.premium}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {isPremium ? t.premium_member : t.premium_unlock}
                  </p>
                  {isPremium && premiumExpiresAt && (
                    <div className="mt-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                      <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Expires In</p>
                      <p className="text-lg font-mono text-yellow-500">
                        {Math.max(0, Math.ceil((new Date(premiumExpiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))} days
                      </p>
                    </div>
                  )}
                </div>
                {!isPremium && (
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={premiumKeyInput}
                      onChange={(e) => setPremiumKeyInput(e.target.value)}
                      placeholder={t.enter_key}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-center text-white focus:outline-none focus:border-yellow-500 transition-all font-mono"
                    />
                    <button
                      onClick={() => {
                        setPremiumMessage('');
                        socket.emit('redeem-premium-key', { username, key: premiumKeyInput });
                      }}
                      className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-xl transition-all"
                    >
                      {t.redeem_key}
                    </button>
                  </div>
                )}
                {premiumMessage && (
                  <div className="text-sm font-bold text-yellow-500 text-center">{premiumMessage}</div>
                )}
                
                {role === 'admin' && (
                  <div className="bg-white/5 rounded-3xl p-6 space-y-4 mt-6 border border-white/5">
                    <h4 className="font-bold text-white text-center">{t.admin_controls}</h4>
                    <button
                      onClick={() => {
                        setPremiumMessage('');
                        socket.emit('generate-premium-key', { username });
                      }}
                      className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl transition-all"
                    >
                      {t.generate_key}
                    </button>
                    {generatedPremiumKey && (
                      <div className="text-center space-y-2">
                        <p className="text-xs text-zinc-500 uppercase tracking-widest">Generated Key</p>
                        <div className="bg-black/50 border border-white/10 rounded-xl p-3 font-mono text-yellow-500 select-all">
                          {generatedPremiumKey}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
          {banUserPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-red-500">Бан пользователя</h3>
                  <button onClick={() => setBanUserPrompt(null)} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-6 text-center">
                  <p className="text-zinc-300">
                    Вы уверены, что хотите забанить пользователя <span className="font-bold text-white">"{banUserPrompt.targetUser}"</span>?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setBanUserPrompt(null)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-all"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={() => {
                        socket.emit('ban-user', { roomId: banUserPrompt.roomId, username, targetUser: banUserPrompt.targetUser });
                        setBanUserPrompt(null);
                      }}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-900/20 active:scale-[0.98]"
                    >
                      Забанить
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
          {reportGroupPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">Жалоба на группу</h3>
                  <button onClick={() => { setReportGroupPrompt(null); setReportReason(''); }} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <p className="text-sm text-zinc-400">Укажите причину жалобы на группу <span className="text-white font-medium">"{reportGroupPrompt.name}"</span></p>
                  <textarea
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="Причина жалобы..."
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-all resize-none h-24"
                    autoFocus
                  />
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => { setReportGroupPrompt(null); setReportReason(''); }}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-all"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={() => {
                        if (reportReason.trim()) {
                          socket.emit('report-group', { roomId: reportGroupPrompt.roomId, username, reason: reportReason });
                          setReportGroupPrompt(null);
                          setReportReason('');
                          // Show a toast or something, but no alert
                        }
                      }}
                      disabled={!reportReason.trim()}
                      className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-900/20 active:scale-[0.98]"
                    >
                      Отправить
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
          {joinGroupPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">Вступление в группу</h3>
                  <button onClick={() => setJoinGroupPrompt(null)} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-6 text-center">
                  <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="w-10 h-10 text-emerald-500" />
                  </div>
                  <p className="text-zinc-300">
                    Вы хотите вступить в группу <span className="font-bold text-white">"{joinGroupPrompt.name}"</span>?
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setJoinGroupPrompt(null)}
                      className="flex-1 bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl transition-all"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={confirmJoinGroup}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
                    >
                      Вступить
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
          {roomPasswordPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">{t.enter_password}</h3>
                  <button onClick={() => { setRoomPasswordPrompt(null); setPasswordInput(''); setPasswordError(false); }} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <p className="text-sm text-zinc-400">{t.enter_password} {roomPasswordPrompt.name}</p>
                  <div className="space-y-1">
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                      placeholder="••••••••"
                      className={cn(
                        "w-full bg-black/50 border rounded-xl px-4 py-3 text-white focus:outline-none transition-all",
                        passwordError ? "border-red-500 focus:border-red-500" : "border-white/10 focus:border-emerald-500"
                      )}
                      autoFocus
                    />
                    {passwordError && <p className="text-xs text-red-500 px-1">{t.wrong_password}</p>}
                  </div>
                  <button
                    onClick={verifyPassword}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
                  >
                    {t.verify}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
          {showCreateGroup && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">{t.create_group}</h3>
                  <button onClick={() => setShowCreateGroup(false)} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={createGroup} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.group_name}</label>
                    <input
                      type="text"
                      value={newGroupName || ''}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="e.g. Design Team"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.group_handle}</label>
                    <input
                      type="text"
                      value={newGroupHandle || ''}
                      onChange={(e) => setNewGroupHandle(e.target.value)}
                      placeholder="@design_team"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Lock className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t.is_private}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsNewGroupPrivate(!isNewGroupPrivate)}
                      className={cn(
                        "w-10 h-6 rounded-full transition-all relative",
                        isNewGroupPrivate ? "bg-emerald-500" : "bg-zinc-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        isNewGroupPrivate ? "left-5" : "left-1"
                      )} />
                    </button>
                  </div>
                  {isNewGroupPrivate && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.password}</label>
                      <input
                        type="password"
                        value={newGroupPassword || ''}
                        onChange={(e) => setNewGroupPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                        required={isNewGroupPrivate}
                      />
                    </div>
                  )}
                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
                  >
                    {t.create_group}
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
          {showGroupSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">{t.group_settings}</h3>
                  <button onClick={() => setShowGroupSettings(null)} className="text-zinc-500 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={updateGroup} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.group_name}</label>
                    <input
                      type="text"
                      defaultValue={showGroupSettings.name}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.group_handle}</label>
                    <input
                      type="text"
                      defaultValue={showGroupSettings.handle}
                      onChange={(e) => setNewGroupHandle(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Lock className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{t.is_private}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsNewGroupPrivate(!isNewGroupPrivate)}
                      className={cn(
                        "w-10 h-6 rounded-full transition-all relative",
                        isNewGroupPrivate ? "bg-emerald-500" : "bg-zinc-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        isNewGroupPrivate ? "left-5" : "left-1"
                      )} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">{t.password}</label>
                    <input
                      type="password"
                      defaultValue={showGroupSettings.password}
                      onChange={(e) => setNewGroupPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                  
                  {(showGroupSettings.owner === username || showGroupSettings.admins?.includes(username)) && (
                    <div className="space-y-2 pt-4 border-t border-white/10">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Управление участниками</label>
                      <div className="max-h-40 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {showGroupSettings.members?.map(member => {
                          if (member === username) return null;
                          const isMemberAdmin = showGroupSettings.admins?.includes(member);
                          const isMemberOwner = showGroupSettings.owner === member;
                          
                          return (
                            <div key={member} className="flex items-center justify-between p-2 bg-white/5 rounded-xl">
                              <span className="text-sm font-medium">{member}</span>
                              <div className="flex gap-2">
                                {showGroupSettings.owner === username && !isMemberOwner && !isMemberAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => socket.emit('promote-user', { roomId: showGroupSettings.id, username, targetUser: member })}
                                    className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded hover:bg-emerald-500/30 transition-colors"
                                  >
                                    Сделать админом
                                  </button>
                                )}
                                {!isMemberOwner && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBanUserPrompt({ roomId: showGroupSettings.id, targetUser: member });
                                    }}
                                    className="text-[10px] bg-red-500/20 text-red-400 px-2 py-1 rounded hover:bg-red-500/30 transition-colors"
                                  >
                                    Бан
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.98]"
                  >
                    {t.save}
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
    </div>
  );
}
