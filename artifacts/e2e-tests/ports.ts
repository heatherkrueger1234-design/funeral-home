export const API_PORT = 4300;
export const FAMILY_PORTAL_PORT = 4301;
export const DIRECTOR_CONSOLE_PORT = 4302;
export const ADMIN_CONSOLE_PORT = 4303;

export const apiBase = `http://localhost:${API_PORT}`;
export const familyPortalBase = `http://localhost:${FAMILY_PORTAL_PORT}`;
export const directorConsoleBase = `http://localhost:${DIRECTOR_CONSOLE_PORT}`;
export const adminConsoleBase = `http://localhost:${ADMIN_CONSOLE_PORT}`;

/** Seeded as the platform admin by the api-server web server; see playwright.config.ts. */
export const PLATFORM_ADMIN_EMAIL = "platform-admin@e2e.test";
