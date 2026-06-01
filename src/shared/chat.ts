export const CHAT_ID_SEPARATOR = "__";

export function makeChatId(a: string, b: string): string {
  return [a, b].sort().join(CHAT_ID_SEPARATOR);
}

export function parseChatId(chatId: string): [string, string] | null {
  const parts = chatId.split(CHAT_ID_SEPARATOR);
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) {
    return null;
  }
  return [parts[0], parts[1]];
}

export function isChatParticipant(chatId: string, uid: string): boolean {
  const parts = parseChatId(chatId);
  return Boolean(parts && parts.includes(uid));
}

export function getOtherParticipant(chatId: string, uid: string): string | null {
  const parts = parseChatId(chatId);
  if (!parts || !parts.includes(uid)) return null;
  return parts[0] === uid ? parts[1] : parts[0];
}
