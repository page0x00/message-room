# Mailbox v2 roadmap

## Compatibility contract

- Existing `public.messages` data remains the source for legacy text messages.
- No destructive migration without a separately reviewed rollback plan.
- User-authored display date is separate from immutable `created_at`.
- Messages are stored once; chat, diary and memory-wall are projections of the same records.
- **Layout invariant:** current user's messages render on the LEFT; the other participant renders on the RIGHT.

## Implemented in the current frontend

- Clean / warm themes, responsive app shell, rotating daily copy, recent joined rooms.
- Legacy text compatibility, per-room drafts, accurate timestamp/keyset pagination.
- Self-left / other-right chat, editable own nickname/avatar and local counterpart overrides.
- Up to eight quoted messages, display date for new messages, owner-only date edits in invitation rooms.
- Chat / diary / memory-wall projections over the same message records.
- Anonymous Auth + token-gated new room memberships, member profile sync and authenticated nonce deduplication.
- SQL migrations, isolated authorization tests, browser integration tests and deployment notes.

These are code-level implementations. The user must execute the SQL and enable anonymous Auth before protected features become live. Old rooms retain their old permissions and do not silently become private.

## Front-end slices

1. Account linking/recovery and CAPTCHA before broader public use; invitation rotation/revocation and abuse controls.
2. Attachments: room-member Storage policies, progress/retry/preview. Currently unavailable, private bucket remains closed.
3. Relationship panel: swipe-right route, days connected, anniversaries/events.
4. Together listening: local audio + imported lyrics; fingerprint/key match before syncing playback state; chat remains usable.
5. Screenshot import: browser OCR first, editable reconstructed draft, explicit confirmation before sending.
6. Memoir: owner-only editable generated drafts by date range; never exposed through normal conversation reads.

## Security gate

The legacy client uses a random local device id, not a secure identity. Member policies are now available only for new token-gated invitation rooms. Legacy profiles remain local. Media, anniversaries, listen state and memoir remain fail-closed until each feature's policy and UI workflow is implemented and tested. Never add permissive anon RLS merely to make a demo work.
