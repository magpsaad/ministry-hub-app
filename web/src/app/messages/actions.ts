"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dispatchPush } from "@/lib/push";
import { roleWords } from "@/lib/role-labels-server";

/** Messages and tasks (migration 0102). The database decides who may read
 * and write what; these only pass the form along. Each one that can alert
 * someone sends the phone notifications straight away, like a text. */

export type SendInput = {
  people: string[];
  classes: string[];
  subject: string;
  body: string;
  isTask: boolean;
  dueOn: string;
  /** 'private' = each replies only to me; 'group' = one conversation. */
  mode: "private" | "group";
};

export async function sendMessageAction(input: SendInput): Promise<{ error: string | null; ids: string[] }> {
  if (input.people.length === 0 && input.classes.length === 0) return { error: "Choose who it’s to.", ids: [] };
  if (!input.subject.trim()) return { error: "Add a subject.", ids: [] };
  if (!input.body.trim()) return { error: "Write a message.", ids: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_message", {
    p_people: input.people,
    p_classes: input.classes,
    p_subject: input.subject,
    p_body: input.body,
    p_is_task: input.isTask,
    p_due_on: input.isTask && input.dueOn ? input.dueOn : null,
    p_mode: input.mode,
  });
  if (error) return { error: await roleWords(error.message), ids: [] };
  after(dispatchPush);
  revalidatePath("/messages");
  return { error: null, ids: (data ?? []) as string[] };
}

export async function replyAction(conversationId: string, body: string): Promise<{ error: string | null }> {
  if (!body.trim()) return { error: "Write a message." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_message", { p_conv: conversationId, p_body: body });
  if (error) return { error: await roleWords(error.message) };
  after(dispatchPush);
  revalidatePath("/messages");
  return { error: null };
}

export async function editMessageAction(messageId: string, body: string): Promise<{ error: string | null }> {
  if (!body.trim()) return { error: "Write a message." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_message", { p_id: messageId, p_body: body });
  if (error) return { error: await roleWords(error.message) };
  return { error: null };
}

/** A task's recipient: done (with an optional note), or reopened. */
export async function setTaskDoneAction(conversationId: string, done: boolean, note: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_task_done", { p_conv: conversationId, p_done: done, p_note: note });
  if (error) return { error: await roleWords(error.message) };
  if (done) after(dispatchPush);
  revalidatePath("/messages");
  return { error: null };
}

/** Opened: clears its unread mark (and the menu badge). */
export async function markReadAction(conversationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { p_conv: conversationId });
}
