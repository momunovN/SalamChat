export type User = {
  id: string;
  phone: string;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
  bio: string;
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

export type Message = {
  id: string;
  chat_id: string;
  author_id?: string | null;
  type: string;
  payload: { text?: string; lat?: number; lon?: number; caption?: string };
  client_id: string;
  reply_to_id?: string | null;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  attachments?: {
    id: string;
    kind: string;
    url: string;
    mime: string;
    filename?: string | null;
  }[];
  status?: string;
};

export type Chat = {
  id: string;
  type: string;
  title: string;
  avatar_url?: string | null;
  peer?: User;
  last_message?: Message | null;
  unread_count: number;
  member_count: number;
  updated_at: string;
  created_at: string;
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
