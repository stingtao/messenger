export interface Env {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  USER_HUB: DurableObjectNamespace;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  CLOUDFLARE_TURN_KEY_ID?: string;
  CLOUDFLARE_TURN_API_TOKEN?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
}

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export interface UserRow {
  uid: string;
  google_sub: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  status: string;
  created_at: number;
  last_seen: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  attachment_key: string | null;
  attachment_content_type: string | null;
  attachment_size: number | null;
  created_at: number;
}

export interface CallRow {
  id: string;
  chat_id: string;
  caller_id: string;
  receiver_id: string;
  type: "audio" | "video";
  status: "calling" | "connected" | "ended";
  offer: string | null;
  answer: string | null;
  created_at: number;
  updated_at: number;
}
