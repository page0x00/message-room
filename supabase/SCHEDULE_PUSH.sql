-- Optional after INSTALL.sql and mailbox-push deployment. No secrets in this file.
-- Enable pg_cron and pg_net in Dashboard first, and create these two Vault entries:
-- mailbox_project_url: your project's https://....supabase.co URL
-- mailbox_cron_secret: same random value as the Edge secret MAILBOX_CRON_SECRET
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='mailbox_project_url')
 or not exists(select 1 from vault.decrypted_secrets where name='mailbox_cron_secret') then
  raise exception 'Create mailbox_project_url and mailbox_cron_secret in Vault first';
 end if;
end $$;
select cron.schedule('mailbox-reminders-and-retries','*/5 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='mailbox_project_url')||'/functions/v1/mailbox-push',
  headers:=jsonb_build_object('Content-Type','application/json','x-mailbox-cron',(select decrypted_secret from vault.decrypted_secrets where name='mailbox_cron_secret')),
  body:='{"action":"scheduled"}'::jsonb,timeout_milliseconds:=60000
 );
$job$);
