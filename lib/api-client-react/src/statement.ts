import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

/**
 * The statement endpoints, hand-written.
 *
 * Everything else in this package is generated from `lib/api-spec/openapi.yaml`
 * by orval, and nothing generated may be edited by hand. These are not
 * generated because the spec is still one file that every component would have
 * to edit at once; until Component 1 splits it into `lib/api-spec/paths/`,
 * adding paths to it means six agents rewriting the same document.
 *
 * TODO(C1): when the split lands, `orders.yaml` describes these endpoints and
 * this file is deleted in the same commit as the generated code that replaces
 * it. `uploads.ts` next door stays hand-written for a different reason — orval
 * cannot send multipart — so do not fold the two together.
 */

export type StatementLineJson = {
  id: number;
  kind:
    | "service"
    | "merchandise"
    | "cash_advance"
    | "family_provided"
    | "allowance";
  description: string;
  detail: string | null;
  quantity: number;
  unitAmountCents: number;
  /** Null on a line that carries no price, so nothing renders a "$0.00". */
  subtotalCents: number | null;
  amount: string | null;
  disclosure: string | null;
  position: number;
  catalogueItemId: number | null;
};

export type StatementJson = {
  id: number;
  status: "draft" | "confirmed" | "superseded";
  version: number;
  reference: string | null;
  notes: string | null;
  confirmedAt: string | null;
  /**
   * That the *home* recorded this as settled in their own books. Never a
   * receipt from us: no payment passes through this product, so we are never
   * told when one is made. Any copy written against this field has to say as
   * much.
   */
  settledAt: string | null;
  settledNote: string | null;
  lines: StatementLineJson[];
  totalCents: number;
  total: string;
  createdAt: string;
  updatedAt: string;
};

/** Where the home takes payment. Always the home's own page, never ours. */
export type PaymentHandoffJson = {
  url: string | null;
  /** The hostname, shown beside the link so a family can see where it goes. */
  host: string | null;
  otherWaysToPay: string | null;
  phone: string | null;
};

export type FamilyStatementJson = {
  statement: StatementJson | null;
  payment: PaymentHandoffJson | null;
};

/* --------------------------------------------------------------- family -- */

export const familyStatementKey = ["family", "statement"] as const;

export function getFamilyStatement(): Promise<FamilyStatementJson> {
  return customFetch<FamilyStatementJson>("/api/family/statement", {
    responseType: "json",
  });
}

export function useFamilyStatement(): UseQueryResult<FamilyStatementJson> {
  return useQuery({
    queryKey: familyStatementKey,
    queryFn: getFamilyStatement,
  });
}

/**
 * The family's own printable copy, fetched as HTML rather than linked to.
 *
 * The family's credential is a bearer token, and a browser cannot put a header
 * on an `<iframe src>` or a link. Fetching the document and handing the markup
 * to the iframe keeps the token out of the address bar, which is the same
 * reason the portal lifts it out of the URL on the first load.
 */
export function getFamilyStatementHtml(): Promise<string> {
  return customFetch<string>("/api/family/statement/print", {
    responseType: "text",
  });
}

/* ---------------------------------------------------------------- staff -- */

export const statementsKey = (caseId: number) =>
  ["cases", caseId, "statements"] as const;

export const paymentHandoffKey = ["payment-handoff"] as const;

export function getCaseStatements(caseId: number): Promise<StatementJson[]> {
  return customFetch<StatementJson[]>(`/api/cases/${caseId}/statements`, {
    responseType: "json",
  });
}

export function useCaseStatements(
  caseId: number,
): UseQueryResult<StatementJson[]> {
  return useQuery({
    queryKey: statementsKey(caseId),
    queryFn: () => getCaseStatements(caseId),
  });
}

export function getPaymentHandoff(): Promise<PaymentHandoffJson> {
  return customFetch<PaymentHandoffJson>("/api/payment-handoff", {
    responseType: "json",
  });
}

export function usePaymentHandoff(): UseQueryResult<PaymentHandoffJson> {
  return useQuery({
    queryKey: paymentHandoffKey,
    queryFn: getPaymentHandoff,
  });
}

export function usePutPaymentHandoff() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      paymentPageUrl?: string | null;
      otherWaysToPay?: string | null;
    }) =>
      customFetch<PaymentHandoffJson>("/api/payment-handoff", {
        method: "PUT",
        body: JSON.stringify(body),
        responseType: "json",
      }),
    onSuccess: (data) => client.setQueryData(paymentHandoffKey, data),
  });
}

export type StatementLineInput = {
  kind: StatementLineJson["kind"];
  description: string;
  detail?: string | null;
  quantity?: number;
  unitAmountCents?: number;
  disclosure?: string | null;
  catalogueItemId?: number | null;
};

/**
 * Every write returns the whole statement rather than the row it touched.
 *
 * The number on this screen that matters is the total, and a client that
 * recomputes it from a patched row is a second implementation of the sum on a
 * document that has to be right. The server adds it up; the screen shows what
 * the server said.
 */
export function useStatementWrites(caseId: number) {
  const client = useQueryClient();

  const refresh = (updated: StatementJson) => {
    client.setQueryData<StatementJson[]>(statementsKey(caseId), (rows) =>
      rows?.map((row) => (row.id === updated.id ? updated : row)),
    );
    void client.invalidateQueries({ queryKey: statementsKey(caseId) });
  };

  const write = <T>(path: string, method: string, body?: unknown) =>
    customFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      responseType: "json",
    });

  return {
    start: useMutation({
      mutationFn: () =>
        write<StatementJson>(`/api/cases/${caseId}/statements`, "POST", {}),
      onSuccess: () =>
        void client.invalidateQueries({ queryKey: statementsKey(caseId) }),
    }),
    addLine: useMutation({
      mutationFn: (input: { statementId: number; line: StatementLineInput }) =>
        write<StatementJson>(
          `/api/statements/${input.statementId}/lines`,
          "POST",
          input.line,
        ),
      onSuccess: refresh,
    }),
    updateLine: useMutation({
      mutationFn: (input: {
        lineId: number;
        values: Partial<StatementLineInput>;
      }) =>
        write<StatementJson>(
          `/api/statement-lines/${input.lineId}`,
          "PUT",
          input.values,
        ),
      onSuccess: refresh,
    }),
    removeLine: useMutation({
      mutationFn: (lineId: number) =>
        write<StatementJson>(`/api/statement-lines/${lineId}`, "DELETE"),
      onSuccess: refresh,
    }),
    updateStatement: useMutation({
      mutationFn: (input: {
        statementId: number;
        values: { reference?: string | null; notes?: string | null };
      }) =>
        write<StatementJson>(
          `/api/statements/${input.statementId}`,
          "PUT",
          input.values,
        ),
      onSuccess: refresh,
    }),
    confirm: useMutation({
      mutationFn: (statementId: number) =>
        write<StatementJson>(`/api/statements/${statementId}/confirm`, "POST", {}),
      onSuccess: () =>
        void client.invalidateQueries({ queryKey: statementsKey(caseId) }),
    }),
    markSettled: useMutation({
      mutationFn: (input: { statementId: number; note?: string | null }) =>
        write<StatementJson>(
          `/api/statements/${input.statementId}/settled`,
          "POST",
          { note: input.note ?? null },
        ),
      onSuccess: refresh,
    }),
    clearSettled: useMutation({
      mutationFn: (statementId: number) =>
        write<StatementJson>(`/api/statements/${statementId}/settled`, "DELETE"),
      onSuccess: refresh,
    }),
  };
}

/**
 * The director's printable copy. A plain URL is enough here — staff carry a
 * session cookie, which an iframe sends on its own.
 */
export function statementPrintUrl(statementId: number): string {
  return `/api/statements/${statementId}/print`;
}
