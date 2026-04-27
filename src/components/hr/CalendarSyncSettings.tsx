import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Save } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CalendarSyncSettings() {
  const qc = useQueryClient();
  const [calendarId, setCalendarId] = useState("");

  const { data } = useQuery({
    queryKey: ["hr", "settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_settings")
        .select("google_calendar_id")
        .eq("id", true)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (data?.google_calendar_id != null) setCalendarId(data.google_calendar_id);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("hr_settings")
        .update({ google_calendar_id: calendarId.trim() || null })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "settings"] });
      toast.success("Calendar settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-accent/10 p-2 text-accent">
          <Calendar className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-serif text-lg text-foreground">Google Calendar sync</h3>
            <p className="text-sm text-muted-foreground">
              Approved time-off requests are added as all-day events to this calendar.
              Leave blank to use the connected account&rsquo;s primary calendar.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="cal-id">Calendar ID</Label>
              <Input
                id="cal-id"
                placeholder="primary or hr@yourcompany.com"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
              />
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
