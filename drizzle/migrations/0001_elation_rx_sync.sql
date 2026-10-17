ALTER TABLE public.prescription_queue
  ADD COLUMN IF NOT EXISTS program text,
  ADD COLUMN IF NOT EXISTS not_in_inventory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS matched_medication_id uuid,
  ADD COLUMN IF NOT EXISTS elation_patient_id text;
ALTER TABLE public.prescription_queue
  ADD CONSTRAINT prescription_queue_program_check CHECK (program IS NULL OR program IN ('pcvip','hero'));

ALTER TABLE public.dispense_records
  ADD COLUMN IF NOT EXISTS program text;
ALTER TABLE public.dispense_records
  ADD CONSTRAINT dispense_records_program_check CHECK (program IS NULL OR program IN ('pcvip','hero'));

CREATE TABLE public.elation_rx_sync_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_medication_id bigint,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_imported integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.elation_rx_sync_state TO authenticated;
GRANT ALL ON public.elation_rx_sync_state TO service_role;
ALTER TABLE public.elation_rx_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pharmacy staff read rx sync state" ON public.elation_rx_sync_state
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'pharmacy'));

INSERT INTO public.elation_rx_sync_state (id, last_medication_id) VALUES (true, 1420000000000000)
ON CONFLICT (id) DO NOTHING;