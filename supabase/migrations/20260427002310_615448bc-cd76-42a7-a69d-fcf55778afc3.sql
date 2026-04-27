
-- ============ ENUMS ============
CREATE TYPE public.hr_employment_status AS ENUM ('active','on_leave','terminated','suspended');
CREATE TYPE public.hr_payroll_status AS ENUM ('pending','processed','paid','cancelled');
CREATE TYPE public.hr_time_off_type AS ENUM ('vacation','sick','personal','bereavement','jury_duty','unpaid','other');
CREATE TYPE public.hr_request_status AS ENUM ('pending','approved','denied','cancelled');
CREATE TYPE public.hr_onboarding_stage AS ENUM ('pre_hire','first_day','first_week','first_month','complete');
CREATE TYPE public.hr_grievance_priority AS ENUM ('low','medium','high','urgent');
CREATE TYPE public.hr_grievance_status AS ENUM ('new','under_review','in_progress','resolved','closed');
CREATE TYPE public.hr_attendance_status AS ENUM ('present','absent','late','remote','holiday','sick');

-- ============ HELPER FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.is_hr_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin','hr')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hr_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin')
  );
$$;

-- ============ DEPARTMENTS ============
CREATE TABLE public.hr_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  head_employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_departments ENABLE ROW LEVEL SECURITY;

-- ============ EMPLOYEES ============
CREATE TABLE public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,                  -- optional link to auth.users
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  address text,
  date_of_birth date,
  hire_date date,
  termination_date date,
  employment_status public.hr_employment_status NOT NULL DEFAULT 'active',
  job_title text,
  department_id uuid REFERENCES public.hr_departments(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  salary numeric(12,2),
  ssn text,
  emergency_contact_name text,
  emergency_contact_phone text,
  avatar_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_employees_user_id ON public.hr_employees(user_id);
CREATE INDEX idx_hr_employees_manager_id ON public.hr_employees(manager_id);
CREATE INDEX idx_hr_employees_department_id ON public.hr_employees(department_id);

-- now we can add the FK on departments.head
ALTER TABLE public.hr_departments
  ADD CONSTRAINT hr_departments_head_fk
  FOREIGN KEY (head_employee_id) REFERENCES public.hr_employees(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_employee_manager_of(_viewer_user_id uuid, _employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hr_employees emp
    JOIN public.hr_employees mgr ON mgr.id = emp.manager_id
    WHERE emp.id = _employee_id AND mgr.user_id = _viewer_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.hr_employees WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============ DOCUMENTS ============
CREATE TABLE public.hr_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  file_url text NOT NULL,
  file_type text,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_documents_employee_id ON public.hr_documents(employee_id);

-- ============ CERTIFICATIONS ============
CREATE TABLE public.hr_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  issuing_authority text,
  license_number text,
  issue_date date,
  expiration_date date,
  document_url text,
  document_name text,
  notes text,
  last_notified_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_certifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_certifications_employee_id ON public.hr_certifications(employee_id);
CREATE INDEX idx_hr_certifications_expiration ON public.hr_certifications(expiration_date);

-- ============ GRIEVANCES ============
CREATE TABLE public.hr_grievances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by uuid,             -- references auth.users.id (nullable for anonymous)
  is_anonymous boolean NOT NULL DEFAULT false,
  category text NOT NULL,
  summary text NOT NULL,
  description text,
  priority public.hr_grievance_priority NOT NULL DEFAULT 'medium',
  status public.hr_grievance_status NOT NULL DEFAULT 'new',
  assigned_to uuid,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_grievances ENABLE ROW LEVEL SECURITY;

-- ============ NOTIFICATIONS ============
CREATE TABLE public.hr_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_notifications_user_id ON public.hr_notifications(user_id);

-- ============ ONBOARDING ============
CREATE TABLE public.hr_onboarding_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  stage public.hr_onboarding_stage NOT NULL DEFAULT 'pre_hire',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_onboarding_checklists ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_onboarding_employee_id ON public.hr_onboarding_checklists(employee_id);

CREATE TABLE public.hr_onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.hr_onboarding_checklists(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_onboarding_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_onboarding_tasks_checklist_id ON public.hr_onboarding_tasks(checklist_id);

-- ============ PAYROLL ============
CREATE TABLE public.hr_payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_pay numeric(12,2) NOT NULL,
  deductions numeric(12,2) NOT NULL DEFAULT 0,
  taxes numeric(12,2) NOT NULL DEFAULT 0,
  net_pay numeric(12,2) NOT NULL,
  status public.hr_payroll_status NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_payroll_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_payroll_employee_id ON public.hr_payroll_records(employee_id);
CREATE INDEX idx_hr_payroll_period ON public.hr_payroll_records(period_start, period_end);

-- ============ ATTENDANCE ============
CREATE TABLE public.hr_attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  date date NOT NULL,
  clock_in timestamptz,
  clock_out timestamptz,
  hours_worked numeric(5,2),
  status public.hr_attendance_status NOT NULL DEFAULT 'present',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
ALTER TABLE public.hr_attendance_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_attendance_employee_date ON public.hr_attendance_records(employee_id, date);

-- ============ TIME OFF ============
CREATE TABLE public.hr_time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  type public.hr_time_off_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(5,2) NOT NULL,
  reason text,
  status public.hr_request_status NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  calendar_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_time_off_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_hr_time_off_employee_id ON public.hr_time_off_requests(employee_id);
CREATE INDEX idx_hr_time_off_dates ON public.hr_time_off_requests(start_date, end_date);

-- ============ updated_at TRIGGERS ============
CREATE TRIGGER trg_hr_departments_updated_at BEFORE UPDATE ON public.hr_departments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_employees_updated_at BEFORE UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_certifications_updated_at BEFORE UPDATE ON public.hr_certifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_grievances_updated_at BEFORE UPDATE ON public.hr_grievances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_onboarding_checklists_updated_at BEFORE UPDATE ON public.hr_onboarding_checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hr_time_off_requests_updated_at BEFORE UPDATE ON public.hr_time_off_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ RLS POLICIES ============

-- DEPARTMENTS: all signed-in staff can read, HR/admin manage
CREATE POLICY "Staff read hr_departments" ON public.hr_departments FOR SELECT TO authenticated USING (is_staff(auth.uid()) OR is_hr_manager(auth.uid()));
CREATE POLICY "HR manage hr_departments" ON public.hr_departments FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- EMPLOYEES
CREATE POLICY "HR read all hr_employees" ON public.hr_employees FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own record" ON public.hr_employees FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Managers read direct reports" ON public.hr_employees FOR SELECT TO authenticated USING (
  manager_id IN (SELECT id FROM public.hr_employees WHERE user_id = auth.uid())
);
CREATE POLICY "HR manage hr_employees" ON public.hr_employees FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- DOCUMENTS
CREATE POLICY "HR read all hr_documents" ON public.hr_documents FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_documents" ON public.hr_documents FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "HR manage hr_documents" ON public.hr_documents FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- CERTIFICATIONS
CREATE POLICY "HR read all hr_certifications" ON public.hr_certifications FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_certifications" ON public.hr_certifications FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "HR manage hr_certifications" ON public.hr_certifications FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- GRIEVANCES
CREATE POLICY "HR read all hr_grievances" ON public.hr_grievances FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Submitter reads own non-anon grievance" ON public.hr_grievances FOR SELECT TO authenticated USING (
  submitted_by = auth.uid() AND NOT is_anonymous
);
CREATE POLICY "Anyone signed-in can submit grievance" ON public.hr_grievances FOR INSERT TO authenticated WITH CHECK (
  (is_anonymous AND submitted_by IS NULL) OR submitted_by = auth.uid()
);
CREATE POLICY "HR update hr_grievances" ON public.hr_grievances FOR UPDATE TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));
CREATE POLICY "Admins delete hr_grievances" ON public.hr_grievances FOR DELETE TO authenticated USING (is_hr_admin(auth.uid()));

-- NOTIFICATIONS
CREATE POLICY "Users read own hr_notifications" ON public.hr_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users mark own hr_notifications read" ON public.hr_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own hr_notifications" ON public.hr_notifications FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "HR insert hr_notifications" ON public.hr_notifications FOR INSERT TO authenticated WITH CHECK (is_hr_manager(auth.uid()));
CREATE POLICY "Service role manages hr_notifications" ON public.hr_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ONBOARDING
CREATE POLICY "HR read all hr_onboarding_checklists" ON public.hr_onboarding_checklists FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_onboarding_checklists" ON public.hr_onboarding_checklists FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "HR manage hr_onboarding_checklists" ON public.hr_onboarding_checklists FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

CREATE POLICY "HR read all hr_onboarding_tasks" ON public.hr_onboarding_tasks FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_onboarding_tasks" ON public.hr_onboarding_tasks FOR SELECT TO authenticated USING (
  checklist_id IN (SELECT id FROM public.hr_onboarding_checklists WHERE employee_id = current_employee_id())
);
CREATE POLICY "Employees toggle own hr_onboarding_tasks" ON public.hr_onboarding_tasks FOR UPDATE TO authenticated USING (
  checklist_id IN (SELECT id FROM public.hr_onboarding_checklists WHERE employee_id = current_employee_id())
) WITH CHECK (
  checklist_id IN (SELECT id FROM public.hr_onboarding_checklists WHERE employee_id = current_employee_id())
);
CREATE POLICY "HR manage hr_onboarding_tasks" ON public.hr_onboarding_tasks FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- PAYROLL
CREATE POLICY "HR read all hr_payroll_records" ON public.hr_payroll_records FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_payroll_records" ON public.hr_payroll_records FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "HR manage hr_payroll_records" ON public.hr_payroll_records FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- ATTENDANCE
CREATE POLICY "HR read all hr_attendance_records" ON public.hr_attendance_records FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_attendance_records" ON public.hr_attendance_records FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "Employees insert own hr_attendance_records" ON public.hr_attendance_records FOR INSERT TO authenticated WITH CHECK (
  employee_id = current_employee_id()
);
CREATE POLICY "Employees update own hr_attendance_records" ON public.hr_attendance_records FOR UPDATE TO authenticated USING (
  employee_id = current_employee_id()
) WITH CHECK (employee_id = current_employee_id());
CREATE POLICY "HR manage hr_attendance_records" ON public.hr_attendance_records FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- TIME OFF
CREATE POLICY "HR read all hr_time_off_requests" ON public.hr_time_off_requests FOR SELECT TO authenticated USING (is_hr_manager(auth.uid()));
CREATE POLICY "Employees read own hr_time_off_requests" ON public.hr_time_off_requests FOR SELECT TO authenticated USING (
  employee_id = current_employee_id()
);
CREATE POLICY "Employees insert own hr_time_off_requests" ON public.hr_time_off_requests FOR INSERT TO authenticated WITH CHECK (
  employee_id = current_employee_id() AND status = 'pending'
);
CREATE POLICY "Employees cancel own hr_time_off_requests" ON public.hr_time_off_requests FOR UPDATE TO authenticated USING (
  employee_id = current_employee_id() AND status IN ('pending','approved')
) WITH CHECK (employee_id = current_employee_id());
CREATE POLICY "HR manage hr_time_off_requests" ON public.hr_time_off_requests FOR ALL TO authenticated USING (is_hr_manager(auth.uid())) WITH CHECK (is_hr_manager(auth.uid()));

-- ============ STORAGE BUCKETS ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('hr-documents','hr-documents', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('hr-avatars','hr-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- hr-documents storage policies (private)
CREATE POLICY "HR manage hr-documents storage" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'hr-documents' AND is_hr_manager(auth.uid()))
  WITH CHECK (bucket_id = 'hr-documents' AND is_hr_manager(auth.uid()));

CREATE POLICY "Employees read own hr-documents storage" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'hr-documents'
    AND (storage.foldername(name))[1] = current_employee_id()::text
  );

-- hr-avatars storage policies (public read)
CREATE POLICY "Public read hr-avatars" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'hr-avatars');

CREATE POLICY "HR manage hr-avatars" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'hr-avatars' AND is_hr_manager(auth.uid()))
  WITH CHECK (bucket_id = 'hr-avatars' AND is_hr_manager(auth.uid()));

CREATE POLICY "Users upload own hr-avatar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hr-avatars'
    AND (storage.foldername(name))[1] = current_employee_id()::text
  );
