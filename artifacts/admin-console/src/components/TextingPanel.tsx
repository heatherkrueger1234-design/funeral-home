import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, CardTitle, Field, Select } from "@/components/ui";

/**
 * A home's own texting sender: Twilio subaccount, the 10DLC brand and
 * campaign on its messaging service, and a verified toll-free fallback.
 * Mirrors `GET/PUT /admin/homes/:id/sms` in `routes/admin/licensure.ts`.
 */
type SmsSetup = {
  subaccountSid: string | null;
  messagingServiceSid: string | null;
  brandRegistrationSid: string | null;
  brandStatus: string;
  campaignStatus: string;
  tollFreeNumber: string | null;
  tollFreeStatus: string;
  checkedAt: string | null;
  sendingFrom: "10dlc" | "toll_free" | "platform" | null;
  description: string;
};

const REGISTRATION = ["none", "pending", "approved", "failed"];
const TOLL_FREE = ["none", "pending", "verified", "rejected"];

export function TextingPanel({ homeId }: { homeId: number }) {
  const queryClient = useQueryClient();
  const key = ["admin", "home", homeId, "sms"];
  const setup = useQuery({ queryKey: key, queryFn: () => api.get<SmsSetup>(`/admin/homes/${homeId}/sms`) });
  const [problem, setProblem] = useState<string | null>(null);
  const done = (data: SmsSetup) => {
    setProblem(null);
    queryClient.setQueryData(key, data);
  };
  const fail = (error: unknown) => setProblem(error instanceof Error ? error.message : "That did not save.");

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) => api.put<SmsSetup>(`/admin/homes/${homeId}/sms`, body),
    onSuccess: done,
    onError: fail,
  });
  const create = useMutation({
    mutationFn: () => api.post<SmsSetup>(`/admin/homes/${homeId}/sms/subaccount`),
    onSuccess: done,
    onError: fail,
  });
  const refresh = useMutation({
    mutationFn: () => api.post<SmsSetup>(`/admin/homes/${homeId}/sms/refresh`),
    onSuccess: done,
    onError: fail,
  });

  if (!setup.data) return null;
  const s = setup.data;
  const text = (name: keyof SmsSetup, label: string, hint: string) => (
    <Field
      label={label}
      hint={hint}
      defaultValue={(s[name] as string | null) ?? ""}
      key={`${name}:${s[name] ?? ""}`}
      onBlur={(event) => {
        const value = event.target.value.trim() || null;
        if (value !== (s[name] ?? null)) save.mutate({ [name]: value });
      }}
    />
  );
  const status = (name: "brandStatus" | "campaignStatus" | "tollFreeStatus", label: string, options: string[]) => (
    <Select label={label} value={s[name]} onChange={(event) => save.mutate({ [name]: event.target.value })}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );

  return (
    <Card>
      <CardTitle>Texting</CardTitle>
      <p className="text-sm text-[var(--muted-foreground)]">{s.description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {text("subaccountSid", "Twilio subaccount", "AC… — or create one below.")}
        {text("messagingServiceSid", "Messaging service", "MG… with the 10DLC campaign on it.")}
        {text("brandRegistrationSid", "10DLC brand registration", "BN…, so the status can be refreshed.")}
        {status("brandStatus", "Brand", REGISTRATION)}
        {status("campaignStatus", "Campaign", REGISTRATION)}
        {text("tollFreeNumber", "Toll-free number", "+1 8XX, the fallback while 10DLC is pending.")}
        {status("tollFreeStatus", "Toll-free verification", TOLL_FREE)}
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-sm text-[var(--notice)]">
          {problem}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!s.subaccountSid && (
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            Create a subaccount
          </Button>
        )}
        <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          Refresh from Twilio
        </Button>
      </div>
    </Card>
  );
}
