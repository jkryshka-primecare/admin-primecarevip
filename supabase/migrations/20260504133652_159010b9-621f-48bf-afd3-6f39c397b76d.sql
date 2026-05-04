
-- Reuse existing app_role/has_role/is_staff functions.

-- ─── 1. medications ─────────────────────────────────────────────────────────
CREATE TABLE public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  generic_name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Other',
  dosage_form text NOT NULL DEFAULT 'Tablet',
  strength text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0,
  cost_per_unit numeric(10,4) NOT NULL DEFAULT 0,
  dispense_price_per_unit numeric(10,4) NOT NULL DEFAULT 0,
  unit_type text NOT NULL DEFAULT 'Bulk',
  expiry_date date,
  ndc_number text NOT NULL DEFAULT '',
  supplier text,
  manufacturer text,
  lot_number text,
  date_inventoried date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_medications_ndc ON public.medications (ndc_number);
CREATE INDEX idx_medications_name ON public.medications (lower(name));
CREATE INDEX idx_medications_expiry ON public.medications (expiry_date);

CREATE TRIGGER update_medications_updated_at
BEFORE UPDATE ON public.medications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read medications" ON public.medications
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Pharmacy staff manage medications" ON public.medications
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role));

-- ─── 2. prescription_queue ─────────────────────────────────────────────────
CREATE TABLE public.prescription_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  elation_prescription_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispensed','dismissed','do_not_fill','archived')),
  status_reason text,
  patient_name text, patient_dob text, patient_address text, patient_phone text,
  prescriber_name text, prescriber_dea text, prescriber_npi text, prescriber_phone text,
  medication_name text, medication_strength text, medication_ndc text, medication_manufacturer text,
  quantity integer, days_supply integer, directions text,
  dea_schedule text DEFAULT 'Non-Controlled',
  refills_authorized integer DEFAULT 0,
  diagnosis_code text, lot_number text, date_written text, note_to_pharmacy text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER update_prescription_queue_updated_at
BEFORE UPDATE ON public.prescription_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.prescription_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read prescription_queue" ON public.prescription_queue
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Pharmacy staff manage prescription_queue" ON public.prescription_queue
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role));

CREATE POLICY "Service role manages prescription_queue"
ON public.prescription_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 3. dispense_records ───────────────────────────────────────────────────
CREATE TABLE public.dispense_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id text,
  medication_name text NOT NULL,
  patient_name text NOT NULL,
  patient_dob text, patient_address text, patient_phone text,
  rx_number text,
  prescriber text, prescriber_dea text, prescriber_npi text, prescriber_phone text,
  date_written text,
  quantity integer NOT NULL,
  days_supply integer,
  directions text,
  dea_schedule text DEFAULT 'Non-Controlled',
  lot_number text,
  refills_authorized integer DEFAULT 0,
  refill_number integer DEFAULT 0,
  dispensed_by text,
  pharmacist_license text,
  notes text,
  diagnosis_code text,
  prescription_queue_id uuid REFERENCES public.prescription_queue(id),
  unit_price numeric(10,4),
  total_cost numeric(10,2),
  hint_charge_id text,
  hint_patient_id text,
  hint_billed_at timestamptz,
  hint_billing_status text DEFAULT 'pending',
  hint_billing_error text,
  hint_voided_at timestamptz,
  hint_voided_by text,
  stock_returned_at timestamptz,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  dispensed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispense_records_patient ON public.dispense_records (patient_name);
CREATE INDEX idx_dispense_records_medication ON public.dispense_records (medication_name);
CREATE INDEX idx_dispense_records_rx ON public.dispense_records (rx_number);
CREATE INDEX idx_dispense_records_dispensed_at ON public.dispense_records (dispensed_at DESC);

ALTER TABLE public.dispense_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read dispense_records" ON public.dispense_records
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Pharmacy staff manage dispense_records" ON public.dispense_records
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'pharmacy'::app_role));

CREATE POLICY "Service role manages dispense_records"
ON public.dispense_records FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 4. audit_log ──────────────────────────────────────────────────────────
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit_log" ON public.audit_log
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Authenticated insert audit_log" ON public.audit_log
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages audit_log"
ON public.audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 5. Seed medications ───────────────────────────────────────────────────
INSERT INTO public.medications
  (name, generic_name, category, dosage_form, strength, quantity, reorder_level, cost_per_unit, dispense_price_per_unit, unit_type, expiry_date, ndc_number, supplier, manufacturer, date_inventoried)
VALUES
  ('Amoxicillin', 'Amoxicillin Trihydrate', 'Antibiotics', 'Capsule', '500mg', 240, 50, 0.30, 0.45, 'Individual Capsule', '2026-08-15', '0093-3109-01', 'PharmaCorp', 'Teva Pharmaceuticals', '2025-01-10'),
  ('Metformin', 'Metformin HCl', 'Antidiabetics', 'Tablet', '850mg', 180, 40, 0.20, 0.32, 'Individual Tablet', '2027-01-20', '0378-0234-01', 'MediSource', NULL, '2025-02-15'),
  ('Lisinopril', 'Lisinopril Dihydrate', 'Antihypertensives', 'Tablet', '10mg', 15, 30, 0.35, 0.55, 'Bottle (30 tablets)', '2026-11-30', '0071-0535-23', 'PharmaCorp', NULL, '2024-11-20'),
  ('Ibuprofen', 'Ibuprofen', 'Analgesics', 'Tablet', '400mg', 500, 100, 0.10, 0.18, 'Bulk', '2027-03-10', '0904-5855-60', 'GenericRx', NULL, '2025-03-01'),
  ('Cetirizine', 'Cetirizine HCl', 'Antihistamines', 'Tablet', '10mg', 8, 25, 0.12, 0.22, 'Pre-dosed Pack', '2026-06-25', '0536-1001-15', 'MediSource', NULL, '2024-09-05'),
  ('Omeprazole', 'Omeprazole', 'Gastrointestinal', 'Capsule', '20mg', 120, 30, 0.40, 0.65, 'Bottle (90 tablets)', '2026-09-18', '0186-5020-31', 'PharmaCorp', NULL, '2025-04-01'),
  ('Salbutamol Inhaler', 'Salbutamol Sulphate', 'Respiratory', 'Inhaler', '100mcg', 45, 15, 5.00, 8.50, 'Inhaler', '2026-12-01', '0173-0682-20', 'RespiCare', NULL, '2025-01-25'),
  ('Amlodipine', 'Amlodipine Besylate', 'Cardiovascular', 'Tablet', '5mg', 200, 40, 0.22, 0.38, 'Individual Tablet', '2027-02-14', '0069-1540-30', 'GenericRx', NULL, '2025-03-20');
