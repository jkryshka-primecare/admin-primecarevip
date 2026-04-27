import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, CheckCircle2, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  new: AlertTriangle,
  under_review: Clock,
  in_progress: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

const STATUS_STYLE: Record<string, string> = {
  new: "bg-destructive/10 text-destructive",
  under_review: "bg-warning/10 text-warning",
  in_progress: "bg-warning/10 text-warning",
  resolved: "bg-success/10 text-success",
  closed: "bg-muted text-muted-foreground",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning/10 text-warning",
  high: "bg-warning/10 text-warning",
  urgent: "bg-destructive/10 text-destructive",
};

export default function HrGrievances() {
  const { user, hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["super_admin", "admin", "hr"]);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [anonymous, setAnonymous] = useState(false);

  const { data: grievances = [] } = useQuery({
    queryKey: ["hr", "grievances"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_grievances")
        .select("*")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("hr_grievances").insert({
        submitted_by: anonymous ? null : user!.id,
        is_anonymous: anonymous,
        category,
        summary,
        description: description || null,
        priority: priority as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr", "grievances"] });
      toast.success("Grievance submitted");
      setOpen(false);
      setCategory("");
      setSummary("");
      setDescription("");
      setAnonymous(false);
      setPriority("medium");
    },
    onError: (err: any) => toast.error(err.message ?? "Failed"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Grievances</h2>
          <p className="text-sm text-muted-foreground">
            Confidentially raise and track workplace concerns.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              File a Grievance
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>File a Grievance</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label>Category</Label>
                <Input
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Workplace Conduct, Safety"
                />
              </div>
              <div className="space-y-2">
                <Label>Summary</Label>
                <Input required value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="anon"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="anon" className="text-sm">
                  Submit anonymously
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={submit.isPending}>
                Submit Grievance
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {grievances.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No grievances filed.</p>
        ) : (
          grievances.map((g: any) => {
            const Icon = STATUS_ICON[g.status] ?? Clock;
            return (
              <Card key={g.id}>
                <CardContent className="flex items-start justify-between p-5">
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{g.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.category}
                      {g.is_anonymous ? " · anonymous" : ""}
                    </p>
                    {g.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 pt-1">
                        {g.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-4">
                    <Badge
                      variant="secondary"
                      className={`gap-1 text-xs capitalize ${STATUS_STYLE[g.status] ?? ""}`}
                    >
                      <Icon className="h-3 w-3" />
                      {String(g.status).replace("_", " ")}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={`text-xs capitalize ${PRIORITY_STYLE[g.priority] ?? ""}`}
                    >
                      {g.priority}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
        {!isAdmin && grievances.length === 0 && null}
      </div>
    </div>
  );
}
