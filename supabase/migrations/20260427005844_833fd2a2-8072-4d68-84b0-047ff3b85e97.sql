-- PTO balances per employee, per type, per year
CREATE TABLE public.hr_pto_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  type public.hr_time_off_type NOT NULL,
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::int,
  accrual_rate_per_year NUMERIC NOT NULL DEFAULT 0,
  accrued_days NUMERIC NOT NULL DEFAULT 0,
  used_days NUMERIC NOT NULL DEFAULT 0,
  carryover_days NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, type, year)
);

CREATE INDEX idx_hr_pto_balances_employee ON public.hr_pto_balances(employee_id);
CREATE INDEX idx_hr_pto_balances_year ON public.hr_pto_balances(year);

ALTER TABLE public.hr_pto_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_pto_balances"
  ON public.hr_pto_balances FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE POLICY "HR read all hr_pto_balances"
  ON public.hr_pto_balances FOR SELECT TO authenticated
  USING (public.is_hr_manager(auth.uid()));

CREATE POLICY "Employees read own hr_pto_balances"
  ON public.hr_pto_balances FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());

CREATE TRIGGER update_hr_pto_balances_updated_at
  BEFORE UPDATE ON public.hr_pto_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: keep used_days in sync with approved time-off requests.
CREATE OR REPLACE FUNCTION public.sync_pto_used_on_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _year INT;
BEGIN
  _year := EXTRACT(YEAR FROM COALESCE(NEW.start_date, OLD.start_date))::int;

  -- INSERT: if created already approved, add days
  IF (TG_OP = 'INSERT') THEN
    IF NEW.status = 'approved' THEN
      INSERT INTO public.hr_pto_balances (employee_id, type, year, used_days)
      VALUES (NEW.employee_id, NEW.type, _year, NEW.days)
      ON CONFLICT (employee_id, type, year)
      DO UPDATE SET used_days = public.hr_pto_balances.used_days + NEW.days,
                    updated_at = now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: handle status transitions
  IF (TG_OP = 'UPDATE') THEN
    -- Became approved
    IF OLD.status <> 'approved' AND NEW.status = 'approved' THEN
      INSERT INTO public.hr_pto_balances (employee_id, type, year, used_days)
      VALUES (NEW.employee_id, NEW.type, _year, NEW.days)
      ON CONFLICT (employee_id, type, year)
      DO UPDATE SET used_days = public.hr_pto_balances.used_days + NEW.days,
                    updated_at = now();
    -- Was approved, now isn't (denied/cancelled)
    ELSIF OLD.status = 'approved' AND NEW.status <> 'approved' THEN
      UPDATE public.hr_pto_balances
         SET used_days = GREATEST(0, used_days - OLD.days),
             updated_at = now()
       WHERE employee_id = OLD.employee_id
         AND type = OLD.type
         AND year = EXTRACT(YEAR FROM OLD.start_date)::int;
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE of an approved request → release days
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'approved' THEN
      UPDATE public.hr_pto_balances
         SET used_days = GREATEST(0, used_days - OLD.days),
             updated_at = now()
       WHERE employee_id = OLD.employee_id
         AND type = OLD.type
         AND year = EXTRACT(YEAR FROM OLD.start_date)::int;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_pto_used
AFTER INSERT OR UPDATE OR DELETE ON public.hr_time_off_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_pto_used_on_request();