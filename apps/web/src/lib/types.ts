export type User = {
  id: string;
  phone: string;
  email?: string | null;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  bio: string;
  birth_date?: string | null;
  address?: string;
  username_hidden?: boolean;
  public_id?: string | null;
  notifications?: boolean;
  created_at?: string;
  updated_at?: string;
  last_seen_at?: string | null;
  online?: boolean;
  contacts_sync?: boolean;
  book_name?: string | null;
};

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user: User;
  device_id: string;
};

export type ReplyPreview = {
  id: string;
  author_id?: string | null;
  author_name?: string | null;
  type: string;
  text?: string;
  deleted?: boolean;
};

export type Message = {
  id: string;
  chat_id: string;
  author_id?: string | null;
  author_name?: string | null;
  type: string;
  payload: { text?: string; lat?: number; lon?: number; caption?: string; duration_ms?: number; waveform?: number[] };
  client_id: string;
  reply_to_id?: string | null;
  reply_to?: ReplyPreview | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  attachments?: {
    id: string;
    kind: string;
    url: string;
    mime: string;
    filename?: string | null;
    duration_ms?: number | null;
  }[];
  local_url?: string;
  status?: string;
};

export type ChatMember = {
  user: User;
  role: "owner" | "admin" | "member" | string;
  joined_at: string;
};

export type Chat = {
  id: string;
  type: string;
  title: string;
  username?: string | null;
  avatar_url?: string | null;
  peer?: User;
  last_message?: Message | null;
  unread_count: number;
  muted_until?: string | null;
  member_count: number;
  updated_at: string;
  created_at: string;
};

export type ProfileLibrary = {
  media: { id: string; url: string; kind: string; created_at: string }[];
  links: { id: string; url: string; created_at: string }[];
  voice: { id: string; url: string; duration_ms?: number | null; created_at: string }[];
  groups: { id: string; title: string; username?: string | null; avatar_url?: string | null; member_count: number }[];
};

export type Call = {
  id: string;
  chat_id: string;
  initiator_id: string;
  kind: string;
  status: string;
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
};

export type Envelope = {
  type: string;
  ts: string;
  body: unknown;
};
