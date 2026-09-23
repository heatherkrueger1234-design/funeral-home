import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCase,
  useGetStaff,
  useGetAftercare,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  getGetDeadlinesQueryKey,
  getGetHomeDashboardQueryKey,
  type CaseDetail,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { fromHomeInput, toHomeInput, zoneHint } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateOptions } from "@/components/case/DateOptions";


/** For a `date` input. Dates of birth and death are stored as midnight UTC. */
function toDateInput(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/**
 * The case's own facts, and the aftercare it will start.
 *
 * The service time here is what the family is shown as confirmed fact, so
 * the hint says so — a director who types a time the church has not agreed
 * to will have a family arriving at the wrong hour.
 */
export function DetailsPanel({
  caseId,
  detail,
}: {
  caseId: number;
  detail: CaseDetail;
}) {
  const queryClient = useQueryClient();
  const staff = useGetStaff();
  const aftercare = useGetAftercare(caseId);
  // The picker shows and takes the home's wall time; see `toHomeInput`.
  const zone = useHomeZone();

  const update = useUpdateCase({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetCaseQueryKey(caseId),
        });
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        // Setting the service date from here builds the timeline exactly
        // like choosing an offered time does (see DateOptions' `refresh`),
        // so it has to invalidate the same queries — otherwise the timeline
        // tab and the dashboard's "no date yet" / "this week" sections keep
        // showing stale data until their next poll.
        void queryClient.invalidateQueries({
          queryKey: getGetDeadlinesQueryKey(caseId),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
      },
    },
  });

  const save = (data: Record<string, unknown>) =>
    update.mutate({ caseId, data: data as never });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">The service</h2>

        <div className="space-y-1.5">
          <Label htmlFor="serviceAt">Date and time</Label>
          <Input
            id="serviceAt"
            type="datetime-local"
            key={`${detail.serviceAt ?? "none"}-${zone ?? ""}`}
            defaultValue={toHomeInput(detail.serviceAt, zone)}
            onBlur={(event) => {
              const value = event.target.value;
              save({ serviceAt: value ? fromHomeInput(value, zone) : null });
            }}
          />
          <p className="text-sm leading-snug text-muted-foreground">
            The family is shown this as confirmed. Leave it empty until it is.
            Moving it moves every unfinished step on their timeline with it.
            {zoneHint(zone) && <> {zoneHint(zone)}</>}
          </p>
        </div>

        <DateOptions caseId={caseId} />

        <div className="space-y-1.5">
          <Label htmlFor="serviceLocation">Where</Label>
          <Input
            id="serviceLocation"
            defaultValue={detail.serviceLocation ?? ""}
            onBlur={(event) =>
              save({ serviceLocation: event.target.value.trim() || null })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>Lead director</Label>
          <Select
            value={detail.leadDirectorId ? String(detail.leadDirectorId) : ""}
            onValueChange={(value) => save({ leadDirectorId: Number(value) })}
          >
            <SelectTrigger aria-label="Lead director">
              <SelectValue placeholder="Nobody yet" />
            </SelectTrigger>
            <SelectContent>
              {/* Only people who still work here -- plus whoever already
                  holds the case, so the current value never renders blank. */}
              {(staff.data ?? [])
                .filter(
                  (member) =>
                    member.deactivatedAt === null ||
                    member.id === detail.leadDirectorId,
                )
                .map((member) => (
                <SelectItem key={member.id} value={String(member.id)}>
                  {member.displayName ?? member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm leading-snug text-muted-foreground">
            Who the family is told to picture when the portal says "your
            director".
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <h2 className="font-display text-lg">The person</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              defaultValue={detail.decedentFirstName}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== detail.decedentFirstName) {
                  save({ decedentFirstName: value });
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              defaultValue={detail.decedentLastName}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== detail.decedentLastName) {
                  save({ decedentLastName: value });
                }
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="preferred">What they were called</Label>
          <Input
            id="preferred"
            placeholder="Peggy"
            defaultValue={detail.decedentPreferredName ?? ""}
            onBlur={(event) =>
              save({ decedentPreferredName: event.target.value.trim() || null })
            }
          />
          <p className="text-sm leading-snug text-muted-foreground">
            Used everywhere the family sees their name.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input
              id="dateOfBirth"
              type="date"
              defaultValue={toDateInput(detail.dateOfBirth)}
              onBlur={(event) => {
                const value = event.target.value;
                if (value !== toDateInput(detail.dateOfBirth)) {
                  save({
                    dateOfBirth: value ? new Date(value).toISOString() : null,
                  });
                }
              }}
            />
          </div>
          {detail.kind !== "pre_need" && (
            <div className="space-y-1.5">
              <Label htmlFor="dateOfDeath">Date of death</Label>
              <Input
                id="dateOfDeath"
                type="date"
                defaultValue={toDateInput(detail.dateOfDeath)}
                onBlur={(event) => {
                  const value = event.target.value;
                  if (value !== toDateInput(detail.dateOfDeath)) {
                    save({
                      dateOfDeath: value ? new Date(value).toISOString() : null,
                    });
                  }
                }}
              />
            </div>
          )}
        </div>
        {detail.kind !== "pre_need" && (
          <p className="text-sm leading-snug text-muted-foreground">
            Steps your standard schedule counts from the death, like the
            certificate details, appear on the family's timeline as soon as
            this is set.
          </p>
        )}
      </section>

      {(aftercare.data ?? []).length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)] lg:col-span-2">
          <h2 className="font-display text-lg">Aftercare</h2>
          <ul className="space-y-2">
            {aftercare.data!.map((enrollment) => (
              <li
                key={enrollment.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <span className="font-medium">{enrollment.contactName}</span>
                <span className="text-muted-foreground">
                  {enrollment.email ?? enrollment.phone}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {enrollment.status === "pending"
                    ? "waiting on their consent"
                    : enrollment.status === "active"
                      ? `${enrollment.deliveries.filter((d) => d.sentAt).length} of ${enrollment.deliveries.length} sent`
                      : "ended"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-snug text-muted-foreground">
            Signed "{aftercare.data![0]!.brandedAs}". Nothing is sent until a
            family member says yes.
          </p>
        </section>
      )}
    </div>
  );
}
