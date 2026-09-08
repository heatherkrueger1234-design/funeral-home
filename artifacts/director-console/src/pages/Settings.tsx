import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHome,
  useUpdateHome,
  getGetHomeQueryKey,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { StandardSchedule } from "@/components/StandardSchedule";

/** "08:00" for a time input, from minutes since midnight. */
const toTimeInput = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const fromTimeInput = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * The home's settings: how the family portal is branded, when the home is
 * open, and whether closing a case starts the aftercare.
 *
 * Owner-only on the server, so a non-owner sees the values read-only rather
 * than a form that fails on save.
 */
export default function Settings() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const home = useGetHome();

  const update = useUpdateHome({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetHomeQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
      },
    },
  });

  if (home.isPending) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!home.data) return null;

  const row = home.data;
  const readOnly = session?.user.role !== "owner";
  const save = (data: Record<string, unknown>) => update.mutate({ data: data as never });

  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-2xl mb-1">Settings</h1>
        <p className="text-muted-foreground">
          {readOnly
            ? "Only an owner can change these."
            : "How families see you, and when you are open."}
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">How families see you</h2>

        <div className="space-y-1.5">
          <Label htmlFor="name">Funeral home</Label>
          <Input
            id="name"
            disabled={readOnly}
            defaultValue={row.name}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== row.name) save({ name: value });
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="accentColor">Brand colour</Label>
          <div className="flex items-center gap-3">
            <Input
              id="accentColor"
              type="color"
              disabled={readOnly}
              defaultValue={row.accentColor}
              className="h-10 w-16 p-1"
              onBlur={(event) => save({ accentColor: event.target.value })}
            />
            <span className="text-sm text-muted-foreground">
              Used across the family's portal.
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Office number</Label>
            <Input
              id="phone"
              type="tel"
              disabled={readOnly}
              defaultValue={row.phone ?? ""}
              onBlur={(event) => save({ phone: event.target.value.trim() || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="urgentPhone">24-hour number</Label>
            <Input
              id="urgentPhone"
              type="tel"
              disabled={readOnly}
              defaultValue={row.urgentPhone ?? ""}
              onBlur={(event) =>
                save({ urgentPhone: event.target.value.trim() || null })
              }
            />
            <p className="text-xs text-muted-foreground">
              Shown on every screen a family sees, and beside the out-of-hours
              notice.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Office hours</h2>
        <p className="text-sm text-muted-foreground">
          These never hold a message back. A family writing at two in the
          morning is told, before they send, that you read messages from the
          time below — and offered the 24-hour number if it cannot wait.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="opens">Open from</Label>
            <Input
              id="opens"
              type="time"
              disabled={readOnly}
              defaultValue={toTimeInput(row.officeOpensMinute)}
              onBlur={(event) => {
                const minute = fromTimeInput(event.target.value);
                if (minute !== null) save({ officeOpensMinute: minute });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="closes">Until</Label>
            <Input
              id="closes"
              type="time"
              disabled={readOnly}
              defaultValue={toTimeInput(row.officeClosesMinute)}
              onBlur={(event) => {
                const minute = fromTimeInput(event.target.value);
                if (minute !== null) save({ officeClosesMinute: minute });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              disabled={readOnly}
              defaultValue={row.timezone}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== row.timezone) save({ timezone: value });
              }}
            />
          </div>
        </div>
      </section>

      <StandardSchedule readOnly={readOnly} />

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">Aftercare</h2>

        <label className="flex items-start gap-3">
          <Switch
            checked={row.aftercareEnabled}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ aftercareEnabled: checked })}
          />
          <span className="text-sm">
            <span className="block font-medium">
              Offer grief check-ins when a case closes
            </span>
            <span className="block text-muted-foreground">
              Gentle check-ins at 30, 60 and 90 days, and on the anniversary —
              sent in your name, with no staff time from you. Families are
              asked first, and nothing goes out until they say yes.
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="senderName">Signed</Label>
          <Input
            id="senderName"
            disabled={readOnly}
            placeholder={row.name}
            defaultValue={row.aftercareSenderName ?? ""}
            onBlur={(event) =>
              save({ aftercareSenderName: event.target.value.trim() || null })
            }
          />
          <p className="text-xs text-muted-foreground">
            "Provided in care with {row.aftercareSenderName?.trim() || row.name}".
            Leave blank to use the home's name.
          </p>
        </div>
      </section>
    </div>
  );
}
