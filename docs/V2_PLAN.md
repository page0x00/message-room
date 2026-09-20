# Mailbox v2 roadmap

## Compatibility contract
- Existing `public.messages` data remains the source for legacy text messages.
- No destructive migration without a separately reviewed rollback plan.
- User-authored display date is separate from immutable `created_at`.
- Messages are stored once; chat, diary and memory-wall are projections of the same records.
- **Layout invariant:** current user's messages render on the LEFT; the other participant renders on the RIGHT.

## Implemented foundation in this branch
- Additive message metadata for display date, message type, media metadata and multi-reply references.
- Private-by-default tables for room member profiles, anniversaries, memoir drafts and listen state.
- Private media Storage bucket definition.
- Deployment/security notes in SETUP.md.

## Front-end slices
1. App shell: Instagram-clean / warm themes, responsive phone/tablet layout, daily copy pool, recent joined rooms list.
2. Member identity: authenticated room membership, display name/avatar as member data, consistent rendering across views.
3. Messaging: left-self/right-other, multi-select + multi-quote, display-date editing, attachments with progress/retry/preview.
4. Views: chat / diary / memory wall from one message dataset.
5. Relationship panel: swipe-right route, days connected, anniversaries/events.
6. Together listening: local audio + imported lyrics; fingerprint/key match before syncing playback state; chat remains usable.
7. Screenshot import: browser OCR first, editable reconstructed draft, explicit confirmation before sending.
8. Memoir: owner-only editable generated drafts by date range; never exposed through normal conversation reads.

## Security gate
The legacy client uses a random local device id. It is not a secure identity. Media, member profiles, anniversaries, listen state and memoir must remain fail-closed until Supabase Auth + room membership policies are implemented. Do not add permissive anon RLS merely to make UI demos work.
