import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function HrNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["hr", "notifications"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("hr_notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const unreadIds = notifications.filter((n: any) => !n.read).map((n: any) => n.id);

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      await supabase.from("hr_notifications").update({ read: true }).in("id", ids);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr", "notifications"] }),
  });

  const handleClick = (n: any) => {
    if (!n.read) markRead.mutate([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            HR alerts: license expirations, time-off updates, onboarding tasks.
          </p>
        </div>
        {unreadIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => markRead.mutate(unreadIds)}>
            Mark all read
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => (
            <Card
              key={n.id}
              className={`cursor-pointer transition-colors hover:bg-muted/40 ${
                !n.read ? "border-l-4 border-l-primary" : ""
              }`}
              onClick={() => handleClick(n)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{n.message}</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
