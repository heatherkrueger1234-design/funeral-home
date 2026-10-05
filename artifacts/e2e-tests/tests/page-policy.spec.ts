import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  adminConsoleBase,
  apiBase,
  directorConsoleBase,
  familyPortalBase,
  PLATFORM_ADMIN_EMAIL,
} from "../ports";
import {
  ensurePlatformAdminAccount,
  PLATFORM_ADMIN_PASSWORD,
} from "../platform-admin";

/**
 * The policy each app has to carry in its own HTML, because the host may send
 * none.
 *
 * Both live deployments are on Replit, whose static hosting sends no security
 * headers at all and appends its analytics script to the end of every page it
 * serves:
 *
 *   <script src="https://i.replit.com/script.js" async data-website-id="..."></script>
 *
 * which reports each page's address to Replit -- and a family's address is
 * /f/<token>, their credential. The Content-Security-Policy nginx sends on the
 * Docker path (deploy/security-headers.conf) would refuse it, but there is no
 * nginx there. So each app's production build carries that policy as a <meta>
 * tag, and a referrer policy, so that the token in /f/<token> or ?token= is
 * never sent as the Referer of the app's own calls to its API.
 *
 * `vite preview` sends no security headers either, which makes it a fair
 * stand-in for Replit: whatever holds here, the page holds by itself. Each
 * test appends Replit's tag to every page exactly where Replit does, uses the
 * app the way somebody would, and expects that script to be the only thing the
 * policy refuses.
 */

const REPLIT_SCRIPT = "https://i.replit.com/script.js";
const REPLIT_TAG = `<script src="${REPLIT_SCRIPT}" async="" data-website-id="00000000-0000-0000-0000-000000000000"></script>`;

/**
 * A header as nginx sends it, read from the file nginx is given. Read here on
 * its own terms rather than through the build's reader, so that a fault in
 * one cannot agree with itself.
 */
function nginxHeader(name: string): string {
  const conf = readFileSync(
    path.resolve(import.meta.dirname, "../../../deploy/security-headers.conf"),
    "utf8",
  );
  const match = new RegExp(
    `^add_header ${name} (?:"([^"]*)"|(\\S+)) always;$`,
    "m",
  ).exec(conf);
  if (!match) throw new Error(`deploy/security-headers.conf sets no ${name}`);
  return match[1] ?? match[2]!;
}

function directives(policy: string): string[] {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);
}

type Watch = {
  /** Pages served, each with Replit's tag appended. */
  documents: number;
  violations: { blockedURI: string; directive: string }[];
  /** The browser's console lines about the policy. */
  policyConsole: string[];
  /** Times the browser asked for Replit's script at all. */
  replitFetches: number;
  apiCalls: number;
  /** The app's own requests (API, scripts, fonts) that carried a Referer. */
  referers: string[];
  pending: Promise<void>[];
};

async function watch(page: Page, origin: string): Promise<Watch> {
  const seen: Watch = {
    documents: 0,
    violations: [],
    policyConsole: [],
    replitFetches: 0,
    apiCalls: 0,
    referers: [],
    pending: [],
  };

  // The event, as the page sees it. A binding rather than a global, so that
  // what a full page load clears is already counted.
  await page.exposeFunction(
    "__e2ePolicyViolation",
    (violation: Watch["violations"][number]) => {
      seen.violations.push(violation);
    },
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (
        window as unknown as { __e2ePolicyViolation: (v: unknown) => void }
      ).__e2ePolicyViolation;
      void report({
        blockedURI: event.blockedURI,
        directive: event.effectiveDirective,
      });
    });
  });

  page.on("console", (message) => {
    if (/Content.Security.Policy/i.test(message.text()))
      seen.policyConsole.push(message.text());
  });

  page.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`)) return;
    if (request.url().startsWith(`${origin}/api/`)) seen.apiCalls += 1;
    seen.pending.push(
      request.allHeaders().then((headers) => {
        if (headers["referer"]) {
          seen.referers.push(
            `${request.method()} ${new URL(request.url()).pathname} <- ${headers["referer"]}`,
          );
        }
      }),
    );
  });

  // What Replit does to every page it serves.
  await page.route(
    (url) => url.origin === origin && !/^\/(api|assets)\//.test(url.pathname),
    async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const html = await response.text();
      expect(
        html,
        "the page has a </body> for Replit to write before",
      ).toContain("</body>");
      seen.documents += 1;
      await route.fulfill({
        response,
        body: html.replace("</body>", `${REPLIT_TAG}</body>`),
      });
    },
  );

  // The script itself, should the browser ever ask: one that leaves a mark,
  // rather than a request to Replit from a test.
  await page.route(`${REPLIT_SCRIPT}**`, async (route) => {
    seen.replitFetches += 1;
    await route.fulfill({
      contentType: "text/javascript",
      body: "window.__replitAnalyticsRan = true;",
    });
  });

  return seen;
}

/**
 * Everything the policy promises, checked once the app has been used.
 *
 * Soft where the checks are independent, so that a page which has lost its
 * policy reports everything that went with it rather than the first thing.
 */
async function expectOnlyReplitRefused(page: Page, seen: Watch): Promise<void> {
  await Promise.all(seen.pending);
  expect.soft(seen.apiCalls, "the app called its API").toBeGreaterThan(0);
  expect
    .soft(seen.referers, "a request from the app carried a Referer")
    .toEqual([]);

  const head = await page.evaluate(() =>
    Array.from(document.head.children, (element) => ({
      charset: element.getAttribute("charset"),
      httpEquiv: element.getAttribute("http-equiv"),
      name: element.getAttribute("name"),
      content: element.getAttribute("content"),
    })),
  );
  // Nothing before the policy, so nothing escapes it: <meta charset> must be
  // first, and the two policy tags straight after it.
  expect
    .soft(head[0]?.charset?.toLowerCase(), "<meta charset> first")
    .toBe("utf-8");
  expect
    .soft(head[1]?.httpEquiv, "the policy straight after it")
    .toBe("Content-Security-Policy");
  expect.soft(head[2]?.name, "then the referrer policy").toBe("referrer");

  const csp =
    head.find((tag) => tag.httpEquiv === "Content-Security-Policy")?.content ??
    "";
  expect
    .soft(
      directives(csp),
      "the page's policy is nginx's, without frame-ancestors",
    )
    .toEqual(
      directives(nginxHeader("Content-Security-Policy")).filter(
        (directive) => !directive.startsWith("frame-ancestors"),
      ),
    );
  const referrer = head.find((tag) => tag.name === "referrer")?.content;
  expect
    .soft(referrer, "the page's referrer policy is nginx's")
    .toBe(nginxHeader("Referrer-Policy"));
  expect.soft(referrer).toBe("no-referrer");

  expect
    .soft(seen.replitFetches, "the browser asked for Replit's script")
    .toBe(0);
  expect
    .soft(
      await page.evaluate(() => "__replitAnalyticsRan" in window),
      "Replit's script ran",
    )
    .toBe(false);

  expect(
    seen.documents,
    "Replit's tag was appended to the page",
  ).toBeGreaterThan(0);
  await expect
    .poll(() => seen.violations, {
      message: "the policy refused Replit's script, and only that",
    })
    .toEqual(
      Array.from({ length: seen.documents }, () => ({
        blockedURI: REPLIT_SCRIPT,
        directive: "script-src-elem",
      })),
    );
  expect(seen.policyConsole).toHaveLength(seen.documents);
  for (const line of seen.policyConsole) expect(line).toContain(REPLIT_SCRIPT);
}

test("the family portal keeps its link to itself and refuses Replit's script", async ({
  page,
}) => {
  const suffix = randomUUID();
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  const register = await api.post("/api/auth/register", {
    data: {
      homeName: `E2E Home ${suffix}`,
      ownerName: "E2E Director",
      email: `director-${suffix}@e2e.test`,
      password: "correct-horse-battery-staple-1",
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();
  const created = await api.post("/api/cases", {
    data: { decedentFirstName: "Iris", decedentLastName: "Calloway" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id: caseId } = await created.json();
  const contact = await api.post(`/api/cases/${caseId}/contacts`, {
    data: {
      name: "Rowan Calloway",
      relationship: "Son",
      email: `rowan-${suffix}@e2e.test`,
      phone: "+15555550125",
    },
  });
  expect(contact.ok(), await contact.text()).toBeTruthy();
  const { link } = await contact.json();
  await api.dispose();
  const token = new URL(link).pathname.split("/f/")[1]!;

  const seen = await watch(page, familyPortalBase);

  // The link as it arrives by text. Everything the page fetches before it
  // takes the token out of the address bar -- its scripts, its stylesheet,
  // its fonts -- would otherwise go out with /f/<token> as the Referer.
  await page.goto(`${familyPortalBase}/f/${token}`);
  await expect(
    page.getByRole("heading", { name: "Iris Calloway" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${familyPortalBase}/`);

  // And a write, which is refused unless the browser still says where it
  // came from (an Origin) after being told to send no Referer.
  await page.getByRole("link", { name: /Ask a question/ }).click();
  const body = "Could we bring her reading glasses on Thursday?";
  await page.getByPlaceholder("What would you like to ask?").fill(body);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(body)).toBeVisible();

  await expectOnlyReplitRefused(page, seen);
});

test("the director console keeps an emailed token to itself and refuses Replit's script", async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `director-${suffix}@e2e.test`;
  const password = "correct-horse-battery-staple-1";
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  const register = await api.post("/api/auth/register", {
    data: {
      homeName: `E2E Home ${suffix}`,
      ownerName: "E2E Director",
      email,
      password,
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();
  await api.dispose();

  const seen = await watch(page, directorConsoleBase);

  // A confirmation link as it arrives by email. The page redeems the token
  // the moment it opens, while the address still holds it, so that call
  // would have carried the token as its Referer. (This one is made up, so
  // the answer is a refusal.)
  await page.goto(`${directorConsoleBase}/verify-email?token=${randomUUID()}`);
  await expect(
    page.getByRole("heading", { name: "That link didn't work" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();

  await page.getByRole("link", { name: "Cases" }).click();
  await expect(page).toHaveURL(`${directorConsoleBase}/cases`);

  await expectOnlyReplitRefused(page, seen);
});

test("the platform console signs in under its own policy and refuses Replit's script", async ({
  page,
}) => {
  await ensurePlatformAdminAccount();

  const seen = await watch(page, adminConsoleBase);

  await page.goto(adminConsoleBase);
  await page.getByLabel("Email address").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PLATFORM_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.getByRole("link", { name: "Homes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Homes" })).toBeVisible();

  await expectOnlyReplitRefused(page, seen);
});
