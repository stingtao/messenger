import type { CallRow, MessageRow } from "./types";

export function messageFromRow(row: MessageRow) {
  return {
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    imageUrl: row.attachment_key ? `/api/attachments/${row.id}` : undefined,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    timestamp: new Date(row.created_at).toISOString(),
  };
}

export function callFromRow(row: CallRow) {
  return {
    id: row.id,
    chatId: row.chat_id,
    callerId: row.caller_id,
    receiverId: row.receiver_id,
    type: row.type,
    status: row.status,
    offer: row.offer ? JSON.parse(row.offer) : undefined,
    answer: row.answer ? JSON.parse(row.answer) : undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
