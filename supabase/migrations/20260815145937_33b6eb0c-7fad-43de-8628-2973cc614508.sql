SELECT cron.schedule(
  'daily-integration-health-check',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://imewkweatgvqledptdna.supabase.co/functions/v1/integration-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);