import { User, Message, CallSignal } from '../types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<{ user: User }>('/api/me'),
  users: () => apiFetch<{ users: User[] }>('/api/users'),
  friends: () => apiFetch<{ friends: User[] }>('/api/friends'),
  addFriend: (friendId: string) =>
    apiFetch<{ ok: true }>('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    }),
  logout: () =>
    apiFetch<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  messages: (chatId: string) => apiFetch<{ messages: Message[] }>(`/api/chats/${encodeURIComponent(chatId)}/messages`),
  uploadAttachment: (chatId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<{ message: Message }>(`/api/chats/${encodeURIComponent(chatId)}/attachments`, {
      method: 'POST',
      body: form,
    });
  },
  incomingCalls: () => apiFetch<{ calls: CallSignal[] }>('/api/calls/incoming'),
};

export function websocketUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
