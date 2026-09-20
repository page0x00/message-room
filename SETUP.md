# Message Room v2 setup

This branch is deliberately additive. Do not delete or truncate the existing `messages` table.

## What the current production app uses

The legacy client reads/writes `public.messages` with `room_id`, `content`, `sender`, `sender_name`, `created_at` and subscribes to INSERT events. The v2 migration extends this table rather than replacing it.

## Apply database migration

1. Supabase Dashboard → SQL Editor.
2. Review and run `supabase/migrations/20260920_mailbox_v2.sql`.
3. Confirm old rows still exist and old client can read/send.
4. Database → Replication/Realtime: confirm `messages` is enabled. The migration attempts to add it safely.

## Storage

The migration creates a private `message-media` bucket with a 50 MB object limit. Do not make it public.

Important: the current app has no Supabase Auth identity; its local `device_id` is client-controlled. A trustworthy per-member Storage/RLS policy cannot be built on that value. The v2 private tables therefore have RLS enabled with no anonymous access policies until Auth is added. This is intentional fail-closed behavior.

Next security milestone: introduce Supabase Auth (anonymous auth is acceptable), map each room membership to `auth.uid()`, then add room-member SELECT/INSERT/UPDATE policies and Storage policies that validate the authenticated member and room path.

## Realtime

Legacy chat: `messages` INSERT events.

Together-listening: `listen_sessions` is prepared as a table but should only be enabled for Realtime after authenticated room policies exist. Do not expose it anonymously.

## OCR

Do not put OCR API secrets in browser code. Prefer browser-side OCR for an initial implementation. If server OCR is later used, put credentials in Supabase Edge Function secrets and return only parsed draft data; the client must show an editable preview before any messages are sent.

## Rollback

The migration is additive. If the new client is not ready, continue serving the old client. Do not drop the new columns/tables while any v2 client depends on them. The legacy `messages` rows remain untouched.
