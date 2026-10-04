# Ministry Hub email templates

Branded emails sent by Supabase Auth from `no-reply@ministryhub.magnous.ca`
(custom SMTP through Resend; owner-requested 3 Oct 2026: show the Ministry Hub
logo and wordmark). One set serves every ministry and both QA and prod, since
Supabase Auth is shared by the whole project, so the wording says "Ministry
Hub", never a ministry's name.

The images load from the production app's public files
(`https://youth-ministry-app-prod.vercel.app/brand/...`). If the app's address
moves, update the two `<img src>` lines in every template.

## Where they go

Supabase dashboard -> **Authentication -> Emails -> Templates**. For each
template: set the **Subject**, switch the body to the HTML/source view, replace
everything with the file's contents, then **Save**. (Editing templates needs
custom SMTP turned on first.)

| Supabase template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your email | `confirm-signup.html` |
| Invite user | You're invited to Ministry Hub | `invite-user.html` |
| Magic Link | Your Ministry Hub sign-in code | `magic-link.html` |
| Change Email Address | Confirm your new email address | `change-email.html` |
| Reset Password | Reset your Ministry Hub password | `reset-password.html` |
| Reauthentication | Your Ministry Hub verification code | `reauthentication.html` |

Magic Link and Reauthentication show the 6-digit code (`{{ .Token }}`) for the
sign-in-by-code work; the others use the confirmation link
(`{{ .ConfirmationURL }}`).
