"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AGREEMENT_LATER_COOKIE, AGREEMENT_LATER_SECONDS, AGREEMENT_PATH } from "@/lib/agreement";
import { safeNext } from "../shared";

/** Signs the confidentiality agreement (migration 0086's sign_agreement():
 * the database stamps the time and email, and records the audit entry). */
export async function signAgreement(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? "/"));
  const back = (code: string) => `${AGREEMENT_PATH}?error=${code}&next=${encodeURIComponent(next)}`;

  if (formData.get("agree") !== "on") redirect(back("agree"));
  const typedName = String(formData.get("typed_name") ?? "").replace(/\s+/g, " ").trim();
  if (typedName.length < 2 || typedName.length > 120) redirect(back("name"));
  const versionId = Number(formData.get("version_id"));
  if (!Number.isInteger(versionId)) redirect(back("updated"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_agreement", { p_version_id: versionId, p_typed_name: typedName });
  if (error) redirect(back(error.message.includes("updated") ? "updated" : "failed"));

  (await cookies()).delete(AGREEMENT_LATER_COOKIE);
  revalidatePath("/", "layout");
  redirect(next);
}

/** During the grace period only: carry on, and no reminder for a day. (Once
 * signing is required, the front door sends them straight back.) */
export async function remindLater(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? "/"));
  (await cookies()).set(AGREEMENT_LATER_COOKIE, "1", {
    maxAge: AGREEMENT_LATER_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect(next);
}
