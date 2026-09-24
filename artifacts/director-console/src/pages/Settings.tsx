import { Link } from "wouter";
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
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { StandardSchedule } from "@/components/StandardSchedule";
import { BillingSection } from "@/components/BillingSection";
import { SnippetLibrary } from "@/components/SnippetLibrary";
import { StaffSection } from "@/components/StaffSection";
import { LoadFailed, Loading, PageHeader } from "@/components/page";

/** Every zone this browser can format in; the home's clock must be one. */
const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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

  if (home.isPending) return <Loading rows={4} />;

  if (!home.data) {
    return <LoadFailed what="Your settings" onRetry={() => void home.refetch()} />;
  }

  const row = home.data;
  const readOnly = session?.user.role !== "owner";
  const save = (data: Record<string, unknown>) => update.mutate({ data: data as never });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7">
      <PageHeader title="Settings">
        {readOnly
        ? "Only an owner can change these."
        : "How families see you, and when you are open."}
      </PageHeader>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">How families see you</h2>

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
          <Label htmlFor="accentColor">Brand color</Label>
          <div className="flex items-center gap-3">
            {/* The swatch is the control. A hex field would be a worse
                version of the thing every operating system already has. */}
            <Input
              id="accentColor"
              type="color"
              disabled={readOnly}
              defaultValue={row.accentColor}
              className="h-11 w-16 cursor-pointer p-1"
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
            <p className="text-sm leading-snug text-muted-foreground">
              Shown on every screen a family sees, and beside the out-of-hours
              notice.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">Office hours</h2>
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
            {/* Typed, with every zone the browser knows offered as it is
                typed: a misspelt "America/Denvr" would otherwise be saved
                and quietly put every time in the console out by hours. */}
            <Input
              id="timezone"
              list="timezones"
              disabled={readOnly}
              defaultValue={row.timezone}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (!value || value === row.timezone) return;
                if (!isTimezone(value)) {
                  event.target.value = row.timezone;
                  toast({
                    title: "That isn't a timezone we know",
                    description: "Choose one from the list, like America/Denver.",
                  });
                  return;
                }
                save({ timezone: value });
              }}
            />
            <datalist id="timezones">
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <StandardSchedule readOnly={readOnly} />

      <SnippetLibrary readOnly={readOnly} />

      <BillingSection readOnly={readOnly} />

      {/*
        The rules below genuinely change what the software does, which is why
        they live here rather than on the storefront next to the words. A home
        that writes "photographs are due four days before" into a policy
        section has changed a sentence; changing the standard schedule above
        is what changes a date.
      */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">How you work</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="messageLockDays">Thread stays open for</Label>
            <div className="flex items-center gap-2">
              <Input
                id="messageLockDays"
                type="number"
                min={1}
                max={365}
                className="w-24"
                disabled={readOnly}
                defaultValue={row.messageLockDays}
                onBlur={(event) => {
                  const days = Number(event.target.value);
                  if (Number.isInteger(days) && days >= 1 && days <= 365) {
                    save({ messageLockDays: days });
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">
                days after the service
              </span>
            </div>
            <p className="text-sm leading-snug text-muted-foreground">
              Applied when you close a case, for both sides. Conversations
              already open keep the window they were closed with — shortening
              this will not shut a door on a family mid-sentence.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slideshowTarget">Ask families for about</Label>
            <div className="flex items-center gap-2">
              <Input
                id="slideshowTarget"
                type="number"
                min={1}
                max={500}
                className="w-24"
                disabled={readOnly}
                defaultValue={row.slideshowTarget}
                onBlur={(event) => {
                  const target = Number(event.target.value);
                  if (Number.isInteger(target) && target >= 1 && target <= 500) {
                    save({ slideshowTarget: target });
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">photographs</span>
            </div>
            <p className="text-sm leading-snug text-muted-foreground">
              How long your slideshows actually run. Shown to the family as a
              suggestion and never enforced — someone who wants sixty for
              their mother gets sixty.
            </p>
          </div>
        </div>
      </section>

      <StaffSection readOnly={readOnly} currentUserId={session?.user.id} />

      <section className="space-y-2 rounded-xl border border-dashed p-5">
        <h2 className="font-display text-lg">Your public page</h2>
        <p className="text-sm text-muted-foreground">
          The address to put on your website, what it says, and the policies
          families read on it now live on their own screen.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/storefront">Open your page</Link>
        </Button>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">Aftercare</h2>

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
          <p className="text-sm leading-snug text-muted-foreground">
            "Provided in care with {row.aftercareSenderName?.trim() || row.name}".
            Leave blank to use the home's name.
          </p>
        </div>
      </section>
    </div>
  );
}
