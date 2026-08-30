CREATE TYPE public.hr_contractor_status AS ENUM ('active', 'inactive', 'terminated');
CREATE TYPE public.hr_contractor_rate_type AS ENUM ('hourly', 'daily', 'per_project', 'retainer');

CREATE TABLE public.hr_contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  address text,
  company_name text,
  tax_id text,
  w9_on_file boolean NOT NULL DEFAULT false,
  service_role text,
  department_id uuid REFERENCES public.hr_departments(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  status public.hr_contractor_status NOT NULL DEFAULT 'active',
  rate numeric,
  rate_type public.hr_contractor_rate_type,
  contract_number text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_contractors TO authenticated;
GRANT ALL ON public.hr_contractors TO service_role;

ALTER TABLE public.hr_contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_contractors"
ON public.hr_contractors FOR ALL TO authenticated
USING (public.is_hr_manager(auth.uid()))
WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE TRIGGER trg_hr_contractors_updated_at
BEFORE UPDATE ON public.hr_contractors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_hr_contractors_last_name ON public.hr_contractors (last_name);
