import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCase,
  useGetStaff,
  useGetAftercare,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  type CaseDetail,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** For a `datetime-local` input, which wants local wall time with no zone. */
function toLocalInput(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

  const update = useUpdateCase({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetCaseQueryKey(caseId),
        });
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
      },
    },
  });

  const save = (data: Record<string, unknown>) =>
    update.mutate({ caseId, data: data as never });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">The service</h2>

        <div className="space-y-1.5">
          <Label htmlFor="serviceAt">Date and time</Label>
          <Input
            id="serviceAt"
            type="datetime-local"
            defaultValue={toLocalInput(detail.serviceAt)}
            onBlur={(event) => {
              const value = event.target.value;
              save({ serviceAt: value ? new Date(value).toISOString() : null });
            }}
          />
          <p className="text-xs text-muted-foreground">
            The family is shown this as confirmed. Leave it empty until it is.
          </p>
        </div>

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
            <SelectTrigger>
              <SelectValue placeholder="Nobody yet" />
            </SelectTrigger>
            <SelectContent>
              {(staff.data ?? []).map((member) => (
                <SelectItem key={member.id} value={String(member.id)}>
                  {member.displayName ?? member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Who the family is told to picture when the portal says "your
            director".
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">The person</h2>

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
          <p className="text-xs text-muted-foreground">
            Used everywhere the family sees their name.
          </p>
        </div>
      </section>

      {(aftercare.data ?? []).length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h2 className="font-medium">Aftercare</h2>
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
          <p className="text-xs text-muted-foreground">
            Signed "{aftercare.data![0]!.brandedAs}". Nothing is sent until a
            family member says yes.
          </p>
        </section>
      )}
    </div>
  );
}
