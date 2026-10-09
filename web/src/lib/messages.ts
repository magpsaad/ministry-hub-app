/** Messages and tasks (owner-approved design 8 Oct 2026, migration 0102).
 * Types and helpers shared by the inbox, a conversation and New message. */

/** One row of my_conversations(). */
export type ConversationRow = {
  id: string;
  subject: string;
  is_task: boolean;
  due_on: string | null;
  /** 'direct' = two people; 'group' = one conversation for everyone. */
  mode: "direct" | "group";
  /** Shared by the conversations of one "each replies privately" send. */
  batch_id: string;
  i_sent: boolean;
  /** False when a General Coordinator is reading someone else's. */
  member: boolean;
  people: string | null;
  last_body: string | null;
  last_author: string | null;
  last_message_at: string;
  unread: boolean;
  my_done: boolean;
  done_count: number;
  recipient_count: number;
};

/** An inbox line: one conversation, or (for the sender) a private send to
 * several people shown together. */
export type InboxItem = {
  key: string;
  /** Where tapping it goes: the conversation, or the first of the batch. */
  href: string;
  subject: string;
  is_task: boolean;
  due_on: string | null;
  mode: "direct" | "group";
  people: string;
  last_body: string | null;
  last_author: string | null;
  last_message_at: string;
  unread: boolean;
  i_sent: boolean;
  member: boolean;
  my_done: boolean;
  done_count: number;
  recipient_count: number;
  /** "Each replies privately" to more than one person. */
  batch_size: number;
};

/** The sender sees a private send to several people as one line (with
 * "2 of 5 done"); everyone else sees their own conversation. */
export function toInbox(rows: ConversationRow[]): InboxItem[] {
  const out: InboxItem[] = [];
  const batches = new Map<string, InboxItem>();
  for (const r of rows) {
    const item: InboxItem = {
      key: r.id,
      href: `/messages/${r.id}`,
      subject: r.subject,
      is_task: r.is_task,
      due_on: r.due_on,
      mode: r.mode,
      people: r.people ?? "",
      last_body: r.last_body,
      last_author: r.last_author,
      last_message_at: r.last_message_at,
      unread: r.unread,
      i_sent: r.i_sent,
      member: r.member,
      my_done: r.my_done,
      done_count: r.done_count,
      recipient_count: r.recipient_count,
      batch_size: 1,
    };
    if (r.mode === "direct" && r.i_sent) {
      const b = batches.get(r.batch_id);
      if (b) {
        // Rows come newest first, so the first one seen is the latest.
        b.people = `${b.people}, ${item.people}`;
        b.unread = b.unread || item.unread;
        b.done_count += item.done_count;
        b.recipient_count += item.recipient_count;
        b.batch_size += 1;
        continue;
      }
      item.key = `batch:${r.batch_id}`;
      batches.set(r.batch_id, item);
    }
    out.push(item);
  }
  return out;
}

/** One message in get_conversation(). */
export type MessageItem = {
  id: string;
  author: string;
  mine: boolean;
  body: string;
  created_at: string;
  edited_at: string | null;
  can_edit: boolean;
};

export type ConversationMember = {
  user_id: string;
  name: string;
  is_sender: boolean;
  done_at: string | null;
  done_note: string | null;
  me: boolean;
};

export type BatchEntry = {
  conversation_id: string;
  name: string;
  done_at: string | null;
  done_note: string | null;
  current: boolean;
};

/** get_conversation(). */
export type ConversationDetail = {
  id: string;
  subject: string;
  is_task: boolean;
  due_on: string | null;
  mode: "direct" | "group";
  batch_id: string;
  created_at: string;
  member: boolean;
  i_sent: boolean;
  members: ConversationMember[];
  messages: MessageItem[] | null;
  /** For the sender of a private send to several people: everyone's status. */
  batch: BatchEntry[] | null;
};

/** One row of message_people(). */
export type PersonOption = { user_id: string; full_name: string; roles: string; servant_of: string[] };

/** "2026-10-09" -> "Fri, Oct 9" (due dates are the ministry's calendar days). */
export function dueLabel(key: string): string {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** When a message was sent, in the ministry's timezone: "3:42 PM" today,
 * "Oct 7" earlier this year, "Oct 7, 2025" before that. */
export function whenLabel(iso: string, timeZone: string, todayKey: string): string {
  const d = new Date(iso);
  const dayKey = d.toLocaleDateString("en-CA", { timeZone });
  if (dayKey === todayKey) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const sameYear = dayKey.slice(0, 4) === todayKey.slice(0, 4);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone });
}

/** "Oct 7, 3:42 PM" for inside a conversation. */
export function stampLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}
