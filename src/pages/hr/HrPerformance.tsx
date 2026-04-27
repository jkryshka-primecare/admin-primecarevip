import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Plus,
  ClipboardList,
  Star,
  CheckCircle2,
  Clock,
  Target,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CycleStatus = "draft" | "active" | "closed";
type ReviewStatus = "draft" | "in_progress" | "employee_review" | "completed";
type GoalStatus = "not_started" | "in_progress" | "completed" | "cancelled";

const REVIEW_STATUS_STYLE: Record<ReviewStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-warning/10 text-warning",
  employee_review: "bg-accent/10 text-accent-foreground",
  completed: "bg-success/10 text-success",
};

const CYCLE_STATUS_STYLE: Record<CycleStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
};

const GOAL_STATUS_STYLE: Record<GoalStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

function StarRating({
  value,
  onChange,
  readOnly,
}: {
  value: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
        >
          <Star
            className={`h-5 w-5 transition-colors ${
              value && n <= value
                ? "fill-warning text-warning"
                : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export default function HrPerformance() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"cycles" | "reviews" | "ones">("cycles");
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [oneOpen, setOneOpen] = useState(false);

  // ── Cycles ──────────────────────────────────────────────────────
  const { data: cycles = [] } = useQuery({
    queryKey: ["hr", "review-cycles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_review_cycles")
        .select("*")
        .order("period_start", { ascending: false });
      return data ?? [];
    },
  });

  const [cycleForm, setCycleForm] = useState({
    name: "",
    period_start: "",
    period_end: "",
    due_date: "",
    status: "draft" as CycleStatus,
    description: "",
  });

  const createCycle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("hr_review_cycles").insert({
        ...cycleForm,
        due_date: cycleForm.due_date || null,
        description: cycleForm.description || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "review-cycles"] });
      toast.success("Cycle created");
      setCycleOpen(false);
      setCycleForm({
        name: "",
        period_start: "",
        period_end: "",
        due_date: "",
        status: "draft",
        description: "",
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const updateCycleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CycleStatus }) => {
      const { error } = await supabase
        .from("hr_review_cycles")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "review-cycles"] });
      toast.success("Cycle updated");
    },
  });

  // ── Reviews ─────────────────────────────────────────────────────
  const { data: reviews = [] } = useQuery({
    queryKey: ["hr", "performance-reviews"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_performance_reviews")
        .select(
          "*, employee:hr_employees!hr_performance_reviews_employee_id_fkey(first_name, last_name), reviewer:hr_employees!hr_performance_reviews_reviewer_id_fkey(first_name, last_name), cycle:hr_review_cycles(name, due_date)",
        )
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["hr", "employees-list-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_employees")
        .select("id, first_name, last_name, manager_id")
        .eq("employment_status", "active")
        .order("last_name");
      return data ?? [];
    },
  });

  const [reviewForm, setReviewForm] = useState({
    cycle_id: "",
    employee_id: "",
    reviewer_id: "",
  });

  const createReview = useMutation({
    mutationFn: async () => {
      if (!reviewForm.cycle_id || !reviewForm.employee_id)
        throw new Error("Cycle and employee required");
      const { error } = await supabase.from("hr_performance_reviews").insert({
        cycle_id: reviewForm.cycle_id,
        employee_id: reviewForm.employee_id,
        reviewer_id: reviewForm.reviewer_id || null,
        status: "draft",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "performance-reviews"] });
      toast.success("Review created");
      setReviewOpen(false);
      setReviewForm({ cycle_id: "", employee_id: "", reviewer_id: "" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const bulkCreateForCycle = useMutation({
    mutationFn: async (cycleId: string) => {
      // Auto-create reviews for all active employees who have a manager
      const rows = employees
        .filter((e: any) => e.manager_id)
        .map((e: any) => ({
          cycle_id: cycleId,
          employee_id: e.id,
          reviewer_id: e.manager_id,
          status: "draft" as ReviewStatus,
        }));
      if (rows.length === 0) throw new Error("No employees with managers");
      const { error } = await supabase
        .from("hr_performance_reviews")
        .upsert(rows, { onConflict: "cycle_id,employee_id", ignoreDuplicates: true });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["hr", "performance-reviews"] });
      toast.success(`Generated ${n} reviews`);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // ── 1:1 Notes ───────────────────────────────────────────────────
  const { data: ones = [] } = useQuery({
    queryKey: ["hr", "one-on-ones"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_one_on_ones")
        .select(
          "*, employee:hr_employees!hr_one_on_ones_employee_id_fkey(first_name, last_name), manager:hr_employees!hr_one_on_ones_manager_id_fkey(first_name, last_name)",
        )
        .order("meeting_date", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const [oneForm, setOneForm] = useState({
    employee_id: "",
    manager_id: "",
    meeting_date: new Date().toISOString().slice(0, 10),
    summary: "",
    action_items: "",
    is_private: false,
  });

  const createOne = useMutation({
    mutationFn: async () => {
      if (!oneForm.employee_id || !oneForm.manager_id)
        throw new Error("Employee and manager required");
      const { error } = await supabase.from("hr_one_on_ones").insert({
        ...oneForm,
        summary: oneForm.summary || null,
        action_items: oneForm.action_items || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "one-on-ones"] });
      toast.success("Note saved");
      setOneOpen(false);
      setOneForm({
        employee_id: "",
        manager_id: "",
        meeting_date: new Date().toISOString().slice(0, 10),
        summary: "",
        action_items: "",
        is_private: false,
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  // ── Stats ───────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const completed = reviews.filter((r: any) => r.status === "completed").length;
    const inProgress = reviews.filter(
      (r: any) => r.status === "in_progress" || r.status === "employee_review",
    ).length;
    const draft = reviews.filter((r: any) => r.status === "draft").length;
    const ratings = reviews
      .filter((r: any) => r.overall_rating)
      .map((r: any) => Number(r.overall_rating));
    const avg =
      ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    return { completed, inProgress, draft, avg, total: reviews.length };
  }, [reviews]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-foreground">Performance</h2>
        <p className="text-sm text-muted-foreground">
          Review cycles, performance evaluations, goals, and 1:1 notes.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Reviews
            </p>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 font-mono text-2xl">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              In Progress
            </p>
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-2 font-mono text-2xl text-warning">{stats.inProgress}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Completed
            </p>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </div>
          <p className="mt-2 font-mono text-2xl text-success">{stats.completed}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Avg Rating
            </p>
            <Star className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-2 font-mono text-2xl">{stats.avg.toFixed(1)}</p>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="cycles">Cycles</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="ones">1:1 Notes</TabsTrigger>
        </TabsList>

        {/* ── Cycles ── */}
        <TabsContent value="cycles" className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" /> New Cycle
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Review Cycle</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createCycle.mutate();
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        required
                        placeholder="Q1 2026 Performance Review"
                        value={cycleForm.name}
                        onChange={(e) =>
                          setCycleForm({ ...cycleForm, name: e.target.value })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Period start</Label>
                        <Input
                          type="date"
                          required
                          value={cycleForm.period_start}
                          onChange={(e) =>
                            setCycleForm({ ...cycleForm, period_start: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Period end</Label>
                        <Input
                          type="date"
                          required
                          value={cycleForm.period_end}
                          onChange={(e) =>
                            setCycleForm({ ...cycleForm, period_end: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Due date (optional)</Label>
                      <Input
                        type="date"
                        value={cycleForm.due_date}
                        onChange={(e) =>
                          setCycleForm({ ...cycleForm, due_date: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={cycleForm.description}
                        onChange={(e) =>
                          setCycleForm({ ...cycleForm, description: e.target.value })
                        }
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={createCycle.isPending}>
                      Create
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          <div className="grid gap-3">
            {cycles.map((c: any) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{c.name}</h3>
                      <Badge
                        variant="secondary"
                        className={`text-xs capitalize ${CYCLE_STATUS_STYLE[c.status as CycleStatus]}`}
                      >
                        {c.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(c.period_start).toLocaleDateString()} –{" "}
                      {new Date(c.period_end).toLocaleDateString()}
                      {c.due_date && (
                        <>
                          {" · Due "}
                          {new Date(c.due_date).toLocaleDateString()}
                        </>
                      )}
                    </p>
                    {c.description && (
                      <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      {c.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCycleStatus.mutate({ id: c.id, status: "active" })
                          }
                        >
                          Activate
                        </Button>
                      )}
                      {c.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateCycleStatus.mutate({ id: c.id, status: "closed" })
                          }
                        >
                          Close
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => bulkCreateForCycle.mutate(c.id)}
                        disabled={bulkCreateForCycle.isPending}
                      >
                        Generate Reviews
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
            {cycles.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No review cycles yet.
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Reviews ── */}
        <TabsContent value="reviews" className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" /> New Review
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>New Performance Review</DialogTitle>
                  </DialogHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createReview.mutate();
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label>Cycle</Label>
                      <Select
                        value={reviewForm.cycle_id}
                        onValueChange={(v) =>
                          setReviewForm({ ...reviewForm, cycle_id: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select cycle" />
                        </SelectTrigger>
                        <SelectContent>
                          {cycles.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Employee</Label>
                      <Select
                        value={reviewForm.employee_id}
                        onValueChange={(v) =>
                          setReviewForm({ ...reviewForm, employee_id: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e: any) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.first_name} {e.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Reviewer</Label>
                      <Select
                        value={reviewForm.reviewer_id}
                        onValueChange={(v) =>
                          setReviewForm({ ...reviewForm, reviewer_id: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select reviewer" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e: any) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.first_name} {e.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" className="w-full" disabled={createReview.isPending}>
                      Create
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cycle
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reviewer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Rating
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reviews.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">
                        {r.employee?.first_name} {r.employee?.last_name}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {r.cycle?.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {r.reviewer
                          ? `${r.reviewer.first_name} ${r.reviewer.last_name}`
                          : "—"}
                      </td>
                      <td className="px-6 py-4">
                        {r.overall_rating ? (
                          <StarRating value={Number(r.overall_rating)} readOnly />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant="secondary"
                          className={`text-xs capitalize ${REVIEW_STATUS_STYLE[r.status as ReviewStatus]}`}
                        >
                          {String(r.status).replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedReview(r.id)}
                        >
                          Open <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {reviews.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-8 text-center text-sm text-muted-foreground"
                      >
                        No reviews yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ── 1:1 Notes ── */}
        <TabsContent value="ones" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={oneOpen} onOpenChange={setOneOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" /> New 1:1 Note
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>1:1 Meeting Note</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createOne.mutate();
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Employee</Label>
                      <Select
                        value={oneForm.employee_id}
                        onValueChange={(v) => setOneForm({ ...oneForm, employee_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e: any) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.first_name} {e.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Manager</Label>
                      <Select
                        value={oneForm.manager_id}
                        onValueChange={(v) => setOneForm({ ...oneForm, manager_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Manager" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((e: any) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.first_name} {e.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Meeting date</Label>
                    <Input
                      type="date"
                      required
                      value={oneForm.meeting_date}
                      onChange={(e) =>
                        setOneForm({ ...oneForm, meeting_date: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Summary</Label>
                    <Textarea
                      rows={3}
                      value={oneForm.summary}
                      onChange={(e) => setOneForm({ ...oneForm, summary: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Action items</Label>
                    <Textarea
                      rows={3}
                      value={oneForm.action_items}
                      onChange={(e) =>
                        setOneForm({ ...oneForm, action_items: e.target.value })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={oneForm.is_private}
                      onChange={(e) =>
                        setOneForm({ ...oneForm, is_private: e.target.checked })
                      }
                    />
                    Private (manager-only)
                  </label>
                  <Button type="submit" className="w-full" disabled={createOne.isPending}>
                    Save
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-3">
            {ones.map((o: any) => (
              <Card key={o.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <p className="font-medium text-sm">
                        {o.employee?.first_name} {o.employee?.last_name}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        with {o.manager?.first_name} {o.manager?.last_name}
                      </span>
                      {o.is_private && (
                        <Badge variant="secondary" className="text-xs">
                          Private
                        </Badge>
                      )}
                    </div>
                    {o.summary && (
                      <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
                        {o.summary}
                      </p>
                    )}
                    {o.action_items && (
                      <div className="mt-2 rounded-md bg-muted/50 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          Action Items
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{o.action_items}</p>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(o.meeting_date).toLocaleDateString()}
                  </span>
                </div>
              </Card>
            ))}
            {ones.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No 1:1 notes yet.
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {selectedReview && (
        <ReviewDetailDialog
          reviewId={selectedReview}
          onClose={() => setSelectedReview(null)}
        />
      )}
    </div>
  );
}

// ── Review detail dialog ────────────────────────────────────────────
function ReviewDetailDialog({
  reviewId,
  onClose,
}: {
  reviewId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: review, isLoading } = useQuery({
    queryKey: ["hr", "performance-review", reviewId],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_performance_reviews")
        .select(
          "*, employee:hr_employees!hr_performance_reviews_employee_id_fkey(first_name, last_name), reviewer:hr_employees!hr_performance_reviews_reviewer_id_fkey(first_name, last_name), cycle:hr_review_cycles(name)",
        )
        .eq("id", reviewId)
        .maybeSingle();
      return data;
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["hr", "review-goals", reviewId],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_review_goals")
        .select("*")
        .eq("review_id", reviewId)
        .order("sort_order");
      return data ?? [];
    },
  });

  const [form, setForm] = useState<any>(null);
  const [goalForm, setGoalForm] = useState({
    title: "",
    description: "",
    target_date: "",
  });

  useMemo(() => {
    if (review) {
      setForm({
        overall_rating: review.overall_rating ?? null,
        strengths: review.strengths ?? "",
        areas_to_improve: review.areas_to_improve ?? "",
        manager_comments: review.manager_comments ?? "",
        employee_comments: review.employee_comments ?? "",
        status: review.status,
      });
    }
  }, [review]);

  const save = useMutation({
    mutationFn: async () => {
      const previousStatus = review?.status as ReviewStatus | undefined;
      const { error } = await supabase
        .from("hr_performance_reviews")
        .update(form)
        .eq("id", reviewId);
      if (error) throw error;

      // Fire-and-forget notification when status transitions to a notify stage.
      const newStatus = form.status as ReviewStatus;
      const NOTIFY: ReviewStatus[] = ["in_progress", "employee_review", "completed"];
      if (newStatus !== previousStatus && NOTIFY.includes(newStatus)) {
        supabase.functions
          .invoke("notify-review-status", {
            body: { reviewId, previousStatus, newStatus },
          })
          .catch(() => {
            /* non-blocking */
          });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "performance-review", reviewId] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const addGoal = useMutation({
    mutationFn: async () => {
      if (!goalForm.title) throw new Error("Title required");
      const { error } = await supabase.from("hr_review_goals").insert({
        review_id: reviewId,
        title: goalForm.title,
        description: goalForm.description || null,
        target_date: goalForm.target_date || null,
        sort_order: goals.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "review-goals", reviewId] });
      setGoalForm({ title: "", description: "", target_date: "" });
      toast.success("Goal added");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const updateGoal = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<{ status: GoalStatus; progress_pct: number }>;
    }) => {
      const { error } = await supabase
        .from("hr_review_goals")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "review-goals", reviewId] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        {isLoading || !review || !form ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {review.employee?.first_name} {review.employee?.last_name} ·{" "}
                {review.cycle?.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge
                  variant="secondary"
                  className={`text-xs capitalize ${REVIEW_STATUS_STYLE[form.status as ReviewStatus]}`}
                >
                  {String(form.status).replace("_", " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Reviewer:{" "}
                  {review.reviewer
                    ? `${review.reviewer.first_name} ${review.reviewer.last_name}`
                    : "—"}
                </span>
              </div>

              <div className="space-y-2">
                <Label>Overall Rating</Label>
                <StarRating
                  value={form.overall_rating}
                  onChange={(v) => setForm({ ...form, overall_rating: v })}
                />
              </div>

              <div className="space-y-2">
                <Label>Strengths</Label>
                <Textarea
                  rows={3}
                  value={form.strengths}
                  onChange={(e) => setForm({ ...form, strengths: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Areas to Improve</Label>
                <Textarea
                  rows={3}
                  value={form.areas_to_improve}
                  onChange={(e) =>
                    setForm({ ...form, areas_to_improve: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Manager Comments</Label>
                <Textarea
                  rows={3}
                  value={form.manager_comments}
                  onChange={(e) =>
                    setForm({ ...form, manager_comments: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Employee Comments</Label>
                <Textarea
                  rows={3}
                  value={form.employee_comments}
                  onChange={(e) =>
                    setForm({ ...form, employee_comments: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="employee_review">Employee Review</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Goals */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Goals</h3>
                </div>
                {goals.map((g: any) => (
                  <Card key={g.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{g.title}</p>
                          <Badge
                            variant="secondary"
                            className={`text-xs capitalize ${GOAL_STATUS_STYLE[g.status as GoalStatus]}`}
                          >
                            {String(g.status).replace("_", " ")}
                          </Badge>
                        </div>
                        {g.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {g.description}
                          </p>
                        )}
                        {g.target_date && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Target: {new Date(g.target_date).toLocaleDateString()}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={g.progress_pct} className="h-1.5 flex-1" />
                          <span className="text-xs font-mono w-10 text-right">
                            {g.progress_pct}%
                          </span>
                        </div>
                      </div>
                      <Select
                        value={g.status}
                        onValueChange={(v) =>
                          updateGoal.mutate({
                            id: g.id,
                            patch: {
                              status: v as GoalStatus,
                              progress_pct: v === "completed" ? 100 : g.progress_pct,
                            },
                          })
                        }
                      >
                        <SelectTrigger className="w-36 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">Not Started</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </Card>
                ))}

                <Card className="p-3 bg-muted/30">
                  <div className="space-y-2">
                    <Input
                      placeholder="Goal title"
                      value={goalForm.title}
                      onChange={(e) =>
                        setGoalForm({ ...goalForm, title: e.target.value })
                      }
                    />
                    <Textarea
                      placeholder="Description (optional)"
                      rows={2}
                      value={goalForm.description}
                      onChange={(e) =>
                        setGoalForm({ ...goalForm, description: e.target.value })
                      }
                    />
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        value={goalForm.target_date}
                        onChange={(e) =>
                          setGoalForm({ ...goalForm, target_date: e.target.value })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => addGoal.mutate()}
                        disabled={addGoal.isPending}
                      >
                        Add Goal
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  Save Changes
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
