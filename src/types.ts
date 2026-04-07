export interface Poll {
  id: string;
  room: string;
  question: string;
  options: string[];
  votes: { [optionIndex: number]: string[] }; // optionIndex -> list of usernames
  creator: string;
  timestamp: string;
  isClosed?: boolean;
}

export interface Sticker {
  id: string;
  url: string;
  packName: string;
  creator: string;
}

export interface Message {
  id?: string | number;
  room: string;
  sender: string;
  content: string;
  timestamp: string;
  isFavorite?: boolean;
  mediaUrl?: string;
  mediaType?: 'audio' | 'video' | 'image' | 'video_file' | 'audio_file' | 'file' | 'sticker' | 'poll';
  pollId?: string;
}

export interface User {
  id: string;
  name: string;
  nickname?: string;
  bio?: string;
  avatar_url?: string;
  isOnline?: boolean;
  role?: string;
  is_premium?: number;
}

export interface Room {
  id: string;
  name: string;
  handle?: string;
  type: 'direct' | 'group';
  participants?: string[];
  members?: string[];
  admins?: string[];
  banned?: string[];
  reports?: string[];
  password?: string;
  is_private?: number;
  owner?: string;
  avatar_url?: string;
}

export interface Profile {
  username: string;
  nickname?: string;
  bio: string;
  avatar_url: string;
  is_premium?: number;
}

export interface UserSettings {
  notifications_private: number;
  notifications_groups: number;
  notifications_calls: number;
  badge_muted: number;
  p2p_calls: number;
  language: string;
  auto_media_mobile: number;
  auto_media_wifi: number;
  wallpaper?: string;
}
