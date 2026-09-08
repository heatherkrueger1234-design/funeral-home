import { asset } from "@/lib/assets";

/**
 * A plain link, not a fetch.
 *
 * The OAuth flow is a full page navigation out to Google and back; starting
 * it with XHR would only end in a blocked redirect. The href is built from
 * the app's base path for the same reason every other URL here is.
 */
export function GoogleButton() {
  return (
    <a
      href={asset("api/auth/google")}
      className="w-full inline-flex items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-medium text-[#1f1f1f] transition-opacity hover:opacity-90"
    >
      <svg aria-hidden viewBox="0 0 18 18" className="w-[18px] h-[18px]">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
      Continue with Google
    </a>
  );
}
