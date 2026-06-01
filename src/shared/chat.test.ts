import { describe, expect, it } from 'vitest';
import { getOtherParticipant, isChatParticipant, makeChatId, parseChatId } from './chat';

describe('chat helpers', () => {
  it('creates a stable sorted chat id', () => {
    expect(makeChatId('g-2', 'g-1')).toBe('g-1__g-2');
    expect(makeChatId('g-1', 'g-2')).toBe('g-1__g-2');
  });

  it('rejects invalid chat ids', () => {
    expect(parseChatId('')).toBeNull();
    expect(parseChatId('g-1')).toBeNull();
    expect(parseChatId('g-1__g-1')).toBeNull();
    expect(parseChatId('g-1__g-2__g-3')).toBeNull();
  });

  it('checks participants without granting access to non-participants', () => {
    const chatId = makeChatId('g-1', 'g-2');
    expect(isChatParticipant(chatId, 'g-1')).toBe(true);
    expect(isChatParticipant(chatId, 'g-3')).toBe(false);
    expect(getOtherParticipant(chatId, 'g-1')).toBe('g-2');
    expect(getOtherParticipant(chatId, 'g-3')).toBeNull();
  });
});
