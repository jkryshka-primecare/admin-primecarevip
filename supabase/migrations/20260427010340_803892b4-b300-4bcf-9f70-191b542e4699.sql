-- ── Enums ───────────────────────────────────────────────────────────
CREATE TYPE public.hr_review_cycle_status AS ENUM ('draft', 'active', 'closed');
CREATE TYPE public.hr_review_status AS ENUM (
  'draft', 'in_progress', 'employee_review', 'completed'
);
CREATE TYPE public.hr_goal_status AS ENUM (
  'not_started', 'in_progress', 'completed', 'cancelled'
);

-- ── Cycles ──────────────────────────────────────────────────────────
CREATE TABLE public.hr_review_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE,
  status public.hr_review_cycle_status NOT NULL DEFAULT 'draft',
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_review_cycles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_review_cycles"
  ON public.hr_review_cycles FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE POLICY "Authenticated read non-draft cycles"
  ON public.hr_review_cycles FOR SELECT TO authenticated
  USING (status <> 'draft' OR public.is_hr_manager(auth.uid()));

CREATE TRIGGER update_hr_review_cycles_updated_at
  BEFORE UPDATE ON public.hr_review_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Performance reviews ────────────────────────────────────────────
CREATE TABLE public.hr_performance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.hr_review_cycles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.hr_employees(id) ON DELETE SET NULL,
  overall_rating NUMERIC CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  strengths TEXT,
  areas_to_improve TEXT,
  manager_comments TEXT,
  employee_comments TEXT,
  status public.hr_review_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

CREATE INDEX idx_hr_perf_reviews_employee ON public.hr_performance_reviews(employee_id);
CREATE INDEX idx_hr_perf_reviews_reviewer ON public.hr_performance_reviews(reviewer_id);
CREATE INDEX idx_hr_perf_reviews_cycle ON public.hr_performance_reviews(cycle_id);

ALTER TABLE public.hr_performance_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_performance_reviews"
  ON public.hr_performance_reviews FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE POLICY "Reviewer reads assigned reviews"
  ON public.hr_performance_reviews FOR SELECT TO authenticated
  USING (reviewer_id = public.current_employee_id());

CREATE POLICY "Reviewer updates assigned reviews"
  ON public.hr_performance_reviews FOR UPDATE TO authenticated
  USING (reviewer_id = public.current_employee_id())
  WITH CHECK (reviewer_id = public.current_employee_id());

CREATE POLICY "Employees read own reviews"
  ON public.hr_performance_reviews FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() AND status <> 'draft');

CREATE POLICY "Employees comment on own reviews"
  ON public.hr_performance_reviews FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() AND status = 'employee_review')
  WITH CHECK (employee_id = public.current_employee_id());

CREATE TRIGGER update_hr_performance_reviews_updated_at
  BEFORE UPDATE ON public.hr_performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Goals ──────────────────────────────────────────────────────────
CREATE TABLE public.hr_review_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL REFERENCES public.hr_performance_reviews(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status public.hr_goal_status NOT NULL DEFAULT 'not_started',
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_review_goals_review ON public.hr_review_goals(review_id);

ALTER TABLE public.hr_review_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_review_goals"
  ON public.hr_review_goals FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE POLICY "Reviewer manage goals on their reviews"
  ON public.hr_review_goals FOR ALL TO authenticated
  USING (
    review_id IN (
      SELECT id FROM public.hr_performance_reviews
      WHERE reviewer_id = public.current_employee_id()
    )
  )
  WITH CHECK (
    review_id IN (
      SELECT id FROM public.hr_performance_reviews
      WHERE reviewer_id = public.current_employee_id()
    )
  );

CREATE POLICY "Employees read goals on own reviews"
  ON public.hr_review_goals FOR SELECT TO authenticated
  USING (
    review_id IN (
      SELECT id FROM public.hr_performance_reviews
      WHERE employee_id = public.current_employee_id()
        AND status <> 'draft'
    )
  );

CREATE POLICY "Employees update progress on own goals"
  ON public.hr_review_goals FOR UPDATE TO authenticated
  USING (
    review_id IN (
      SELECT id FROM public.hr_performance_reviews
      WHERE employee_id = public.current_employee_id()
        AND status <> 'draft'
    )
  )
  WITH CHECK (
    review_id IN (
      SELECT id FROM public.hr_performance_reviews
      WHERE employee_id = public.current_employee_id()
        AND status <> 'draft'
    )
  );

CREATE TRIGGER update_hr_review_goals_updated_at
  BEFORE UPDATE ON public.hr_review_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 1:1 Notes ──────────────────────────────────────────────────────
CREATE TABLE public.hr_one_on_ones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  meeting_date DATE NOT NULL,
  summary TEXT,
  action_items TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_one_on_ones_employee ON public.hr_one_on_ones(employee_id);
CREATE INDEX idx_hr_one_on_ones_manager ON public.hr_one_on_ones(manager_id);

ALTER TABLE public.hr_one_on_ones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR manage hr_one_on_ones"
  ON public.hr_one_on_ones FOR ALL TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE POLICY "Manager manage own 1:1s"
  ON public.hr_one_on_ones FOR ALL TO authenticated
  USING (manager_id = public.current_employee_id())
  WITH CHECK (manager_id = public.current_employee_id());

CREATE POLICY "Employee read non-private 1:1s"
  ON public.hr_one_on_ones FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id() AND NOT is_private);

CREATE TRIGGER update_hr_one_on_ones_updated_at
  BEFORE UPDATE ON public.hr_one_on_ones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();