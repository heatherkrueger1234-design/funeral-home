import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatDate,
  LICENCE_STANDING_LABELS,
  LICENCE_STANDINGS,
  PRACTITIONER_ROLE_LABELS,
  PRACTITIONER_ROLES,
  type AdminHomeDetail,
  type HomeLicensure,
  type LicenceStanding,
  type Practitioner,
  type PractitionerRole,
} from "@/lib/api";
import { Button, Card, CardTitle, EmptyState, Field, Select } from "./ui";
import { Reminders } from "./Reminders";

/**
 * One home's Colorado paperwork.
 *
 * Everything here is the platform's own record of a customer — a note of
 * their DORA registration and who at the home needs a license by January. It
 * is not the home's data and it is never shown to a family. See the comment
 * at the top of `lib/db/src/schema/licensure.ts` for where that line is and
 * why it is drawn there.
 */

function splitServices(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Everything a licensure change can make stale: this home, the overview's
 * "Worth a look" list, and the access log the change was written to.
 */
function useRefreshAfterLicensure(homeId: number) {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["home", homeId] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
}

export function LicensurePanel({ home }: { home: AdminHomeDetail }) {
  const [editing, setEditing] = useState(false);
  const refresh = useRefreshAfterLicensure(home.id);

  const save = useMutation({
    mutationFn: (values: Partial<HomeLicensure>) =>
      api.put(`/admin/homes/${home.id}/licensure`, values),
    onSuccess: () => {
      setEditing(false);
      void refresh();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle>What Colorado asks of this home</CardTitle>
        <Reminders
          reminders={home.reminders}
          emptyDetail={
            home.licensure
              ? "Nothing is due here. The registration is current and everyone listed holds a license."
              : "Nothing to say yet. Add this home's DORA registration below and the dates that matter will appear here."
          }
        />
      </Card>

      <Card>
        <CardTitle
          action={
            // With nothing recorded, the empty state's button is the one way
            // in; an "Edit" beside it would be a second, for nothing to edit.
            (editing || home.licensure) && (
              <Button
                variant="plain"
                onClick={() => {
                  setEditing((was) => !was);
                  save.reset();
                }}
              >
                {editing ? "Cancel" : "Edit registration"}
              </Button>
            )
          }
        >
          DORA registration
        </CardTitle>

        {editing ? (
          <RegistrationForm
            licensure={home.licensure}
            pending={save.isPending}
            problem={save.error instanceof Error ? save.error.message : null}
            onSave={(values) => save.mutate(values)}
          />
        ) : home.licensure ? (
          <RegistrationSummary licensure={home.licensure} />
        ) : (
          <EmptyState
            title="No registration recorded"
            detail="Under C.R.S. 12-135-110 every funeral establishment registers with DORA: its location, its appointed designee, and the services it provides there. Recording it here is how the January deadline and the thirty-day amendment rule start showing up on this page."
            action={
              <Button variant="primary" onClick={() => setEditing(true)}>
                Add the registration
              </Button>
            }
          />
        )}
      </Card>

      <PractitionersCard home={home} />
    </div>
  );
}

function RegistrationSummary({ licensure }: { licensure: HomeLicensure }) {
  const rows: Array<[string, string]> = [
    ["Registration number", licensure.doraRegistrationNumber || "—"],
    [
      "Appointed designee",
      [licensure.designeeName, licensure.designeeTitle]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    ["Began business", formatDate(licensure.beganBusinessOn)],
    ["Renews", formatDate(licensure.registrationRenewsOn)],
    ["Services last changed", formatDate(licensure.servicesChangedOn)],
    ["Amendment filed", formatDate(licensure.amendmentFiledOn)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-[var(--muted-foreground)]">{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Registered services
        </p>
        {licensure.registeredServices.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">
            None recorded. Adding a service at a location means an amended
            registration within thirty days.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {licensure.registeredServices.map((service) => (
              <li
                key={service}
                className="rounded-sm bg-[var(--muted)] px-2 py-1 text-sm"
              >
                {service}
              </li>
            ))}
          </ul>
        )}
      </div>

      {licensure.notes && (
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">Notes</p>
          <p className="max-w-prose whitespace-pre-wrap">{licensure.notes}</p>
        </div>
      )}
    </div>
  );
}

function RegistrationForm({
  licensure,
  pending,
  problem,
  onSave,
}: {
  licensure: HomeLicensure | null;
  pending: boolean;
  problem: string | null;
  onSave: (values: Partial<HomeLicensure>) => void;
}) {
  const [form, setForm] = useState({
    doraRegistrationNumber: licensure?.doraRegistrationNumber ?? "",
    registeredServices: (licensure?.registeredServices ?? []).join(", "),
    designeeName: licensure?.designeeName ?? "",
    designeeTitle: licensure?.designeeTitle ?? "",
    beganBusinessOn: licensure?.beganBusinessOn ?? "",
    registrationRenewsOn: licensure?.registrationRenewsOn ?? "",
    servicesChangedOn: licensure?.servicesChangedOn ?? "",
    amendmentFiledOn: licensure?.amendmentFiledOn ?? "",
    notes: licensure?.notes ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          doraRegistrationNumber: form.doraRegistrationNumber.trim() || null,
          registeredServices: splitServices(form.registeredServices),
          designeeName: form.designeeName.trim() || null,
          designeeTitle: form.designeeTitle.trim() || null,
          beganBusinessOn: form.beganBusinessOn || null,
          registrationRenewsOn: form.registrationRenewsOn || null,
          servicesChangedOn: form.servicesChangedOn || null,
          amendmentFiledOn: form.amendmentFiledOn || null,
          notes: form.notes.trim() || null,
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="DORA registration number"
          value={form.doraRegistrationNumber}
          onChange={(event) => set("doraRegistrationNumber")(event.target.value)}
          maxLength={60}
          hint="Exactly as it appears on the certificate."
        />
        <Field
          label="Appointed designee"
          value={form.designeeName}
          onChange={(event) => set("designeeName")(event.target.value)}
          maxLength={160}
          hint="The person named on the registration."
        />
        <Field
          label="Designee's title"
          value={form.designeeTitle}
          onChange={(event) => set("designeeTitle")(event.target.value)}
          maxLength={160}
        />
        <Field
          label="Began business at this location"
          type="date"
          value={form.beganBusinessOn}
          onChange={(event) => set("beganBusinessOn")(event.target.value)}
        />
        <Field
          label="Registration renews"
          type="date"
          value={form.registrationRenewsOn}
          onChange={(event) => set("registrationRenewsOn")(event.target.value)}
          hint="At renewal the home attests whether it sells preneed."
        />
        <Field
          label="Services last changed"
          type="date"
          value={form.servicesChangedOn}
          onChange={(event) => set("servicesChangedOn")(event.target.value)}
          hint="Starts the thirty-day clock for an amended registration."
        />
        <Field
          label="Amendment filed"
          type="date"
          value={form.amendmentFiledOn}
          onChange={(event) => set("amendmentFiledOn")(event.target.value)}
          hint="Stops that clock."
        />
      </div>

      <Field
        label="Registered services"
        value={form.registeredServices}
        onChange={(event) => set("registeredServices")(event.target.value)}
        hint="Separated by commas, as written on the registration."
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="licensure-notes" className="text-sm font-semibold">
          Notes
        </label>
        <textarea
          id="licensure-notes"
          rows={3}
          maxLength={2000}
          value={form.notes}
          onChange={(event) => set("notes")(event.target.value)}
          // The same well as `Field`, which it sat beside looking unfinished.
          className="rounded-md border border-[var(--border-strong)] bg-white p-3 text-base focus-visible:border-[var(--accent)]"
        />
      </div>

      {problem && (
        <p role="alert" className="text-sm text-[var(--notice)]">
          {problem}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save the registration"}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- the people -- */

function PractitionersCard({ home }: { home: AdminHomeDetail }) {
  const [adding, setAdding] = useState(false);
  // Which row is asking "are you sure". Removing somebody is the one thing on
  // this card that cannot be put back by choosing a different option.
  const [removing, setRemoving] = useState<number | null>(null);
  const refresh = useRefreshAfterLicensure(home.id);

  const add = useMutation({
    mutationFn: (values: Omit<Practitioner, "id">) =>
      api.post(`/admin/homes/${home.id}/practitioners`, values),
    onSuccess: () => {
      setAdding(false);
      void refresh();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: Practitioner) =>
      api.put(`/admin/homes/${home.id}/practitioners/${id}`, values),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      api.delete(`/admin/homes/${home.id}/practitioners/${id}`),
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
  });

  const problem =
    update.error instanceof Error
      ? update.error.message
      : remove.error instanceof Error
        ? remove.error.message
        : null;

  return (
    <Card>
      <CardTitle
        action={
          home.practitioners.length > 0 && (
            <Button
              variant="plain"
              onClick={() => {
                setAdding(true);
                add.reset();
              }}
            >
              Add someone
            </Button>
          )
        }
      >
        Who needs a license by January 1, 2027
      </CardTitle>

      {home.practitioners.length === 0 && !adding ? (
        <EmptyState
          title="Nobody listed yet"
          detail="Senate Bill 24-173 brought mortuary science practitioners, funeral directors, embalmers, cremationists and natural reductionists under licensure. List the people at this home it applies to — including the ones who don't have a sign-in here, like an embalmer who works across three homes."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add the first person
            </Button>
          }
        />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="text-sm text-[var(--muted-foreground)]">
              <tr>
                <th scope="col" className="pb-2 font-medium">Name</th>
                <th scope="col" className="pb-2 font-medium">Role</th>
                <th scope="col" className="pb-2 font-medium">Standing</th>
                <th scope="col" className="pb-2 font-medium">License no.</th>
                <th scope="col" className="pb-2 font-medium">Expires</th>
                <th scope="col" className="pb-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {home.practitioners.map((person) => (
                <tr key={person.id} className="border-t border-[var(--border)]">
                  <td className="py-3 pr-4">{person.personName}</td>
                  <td className="py-3 pr-4 text-[var(--muted-foreground)]">
                    {PRACTITIONER_ROLE_LABELS[person.role]}
                  </td>
                  <td className="py-3 pr-4">
                    <label className="sr-only" htmlFor={`standing-${person.id}`}>
                      {person.personName}'s license standing
                    </label>
                    <select
                      id={`standing-${person.id}`}
                      value={person.standing}
                      disabled={update.isPending}
                      onChange={(event) =>
                        update.mutate({
                          ...person,
                          standing: event.target.value as LicenceStanding,
                        })
                      }
                      className="min-h-11 rounded-md border border-[var(--border)] bg-white px-2"
                    >
                      {LICENCE_STANDINGS.map((standing) => (
                        <option key={standing} value={standing}>
                          {LICENCE_STANDING_LABELS[standing]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="tabular py-3 pr-4">
                    {person.licenceNumber || "—"}
                  </td>
                  <td className="tabular py-3 pr-4">
                    {formatDate(person.expiresOn)}
                  </td>
                  <td className="py-3">
                    {removing === person.id ? (
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(person.id)}
                        >
                          {remove.isPending ? "Removing…" : `Remove ${person.personName}`}
                        </Button>
                        <Button
                          variant="plain"
                          onClick={() => {
                            setRemoving(null);
                            remove.reset();
                          }}
                        >
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="plain"
                        aria-label={`Remove ${person.personName}`}
                        onClick={() => {
                          setRemoving(person.id);
                          remove.reset();
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {problem && (
            <p role="alert" className="mt-3 text-sm text-[var(--notice)]">
              {problem}
            </p>
          )}
        </div>
      )}

      {adding && (
        <PractitionerForm
          pending={add.isPending}
          problem={add.error instanceof Error ? add.error.message : null}
          onCancel={() => {
            setAdding(false);
            add.reset();
          }}
          onAdd={(values) => add.mutate(values)}
        />
      )}
    </Card>
  );
}

function PractitionerForm({
  pending,
  problem,
  onAdd,
  onCancel,
}: {
  pending: boolean;
  problem: string | null;
  onAdd: (values: Omit<Practitioner, "id">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    personName: "",
    role: "mortuary_science_practitioner" as PractitionerRole,
    standing: "not_applied" as LicenceStanding,
    licenceNumber: "",
    expiresOn: "",
  });

  return (
    <form
      className="mt-6 flex flex-col gap-5 border-t border-[var(--border)] pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({
          personName: form.personName.trim(),
          role: form.role,
          standing: form.standing,
          licenceNumber: form.licenceNumber.trim() || null,
          expiresOn: form.expiresOn || null,
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Name"
          required
          value={form.personName}
          onChange={(event) =>
            setForm((current) => ({ ...current, personName: event.target.value }))
          }
          maxLength={160}
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              role: event.target.value as PractitionerRole,
            }))
          }
        >
          {PRACTITIONER_ROLES.map((role) => (
            <option key={role} value={role}>
              {PRACTITIONER_ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        <Select
          label="Standing"
          value={form.standing}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              standing: event.target.value as LicenceStanding,
            }))
          }
        >
          {LICENCE_STANDINGS.map((standing) => (
            <option key={standing} value={standing}>
              {LICENCE_STANDING_LABELS[standing]}
            </option>
          ))}
        </Select>
        <Field
          label="License number"
          value={form.licenceNumber}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              licenceNumber: event.target.value,
            }))
          }
          hint="Once it has been issued."
          maxLength={60}
        />
        <Field
          label="Expires"
          type="date"
          value={form.expiresOn}
          onChange={(event) =>
            setForm((current) => ({ ...current, expiresOn: event.target.value }))
          }
          hint="Provisional licenses run three years from issue."
        />
      </div>

      {problem && (
        <p role="alert" className="text-sm text-[var(--notice)]">
          {problem}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !form.personName.trim()}
        >
          {pending ? "Adding…" : "Add them"}
        </Button>
        <Button type="button" variant="plain" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
