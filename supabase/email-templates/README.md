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

Confirm signup, Magic Link and Reauthentication show the 6-digit code
(`{{ .Token }}`): the app signs people in with an emailed code (no passwords),
and a brand-new person's first code arrives in the Confirm signup email. The
others use the confirmation link (`{{ .ConfirmationURL }}`).

## Security notifications

Supabase dashboard -> **Authentication -> Emails -> Security** (owner-chosen
switches, 4 Oct 2026). Each switch's arrow opens its template: set the subject,
paste the file, save. These tell the person when something changed on their
account; the footer asks them to contact their ministry's Admin if it wasn't
them. Phone number changed stays off (phone sign-in isn't used).

| Notification | On | Subject | File |
|---|---|---|---|
| Password changed | yes | Your Ministry Hub password was changed | `notifications/password-changed.html` |
| Email address changed | yes | Your Ministry Hub email address was changed | `notifications/email-changed.html` |
| Phone number changed | no | -- | -- |
| Sign-in method linked | yes | A sign-in method was added to your Ministry Hub account | `notifications/identity-linked.html` |
| Sign-in method removed | yes | A sign-in method was removed from your Ministry Hub account | `notifications/identity-unlinked.html` |
| MFA method added | yes | Authenticator app added to your Ministry Hub account | `notifications/mfa-added.html` |
| MFA method removed | yes | Authenticator app removed from your Ministry Hub account | `notifications/mfa-removed.html` |
