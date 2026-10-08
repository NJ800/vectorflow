/**
 * Single service layer for the VectorFlow FastAPI backend.
 * Every type here mirrors an actual response shape from app/main.py --
 * nothing in this file is speculative, and nothing in this app talks to the
 * backend except through here.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Single source of truth for the localStorage key -- lib/auth.tsx imports
 *  this rather than defining its own, so the 401 handler below and the
 *  auth context can never disagree about where the token lives. */
export const TOKEN_KEY = "vectorflow_token";

// ---------- Response types ----------

export interface User {
  user_id: number;
  current_title: string | null;
  location: string | null;
  total_experience_years: number | null;
}

export interface UserDetail extends User {
  skills: string[] | null;
  profile_text: string | null;
}

export interface UsersResponse {
  users: User[];
}

export interface RecommendationResult {
  job_id: number;
  title: string;
  company: string;
  location: string;
  score: number;
  cosine_similarity: number;
}

export interface RecommendationsResponse {
  user_id: number;
  source: "cache" | "live";
  latency_ms: number;
  results: RecommendationResult[];
}

export interface JobSummary {
  job_id: number;
  title: string;
  company: string;
  location: string;
  seniority_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  /** NULL for the 5,000 seed postings (no recruiter account existed when they were loaded). */
  posted_by_account_id: number | null;
}

export interface JobDetail extends JobSummary {
  description: string;
}

export interface JobsResponse {
  jobs: JobSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface JobWritePayload {
  title: string;
  description?: string | null;
  company: string;
  location: string;
  seniority_level?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
}

export type EventType = "view" | "click" | "apply" | "save";

export const EVENT_TYPES: EventType[] = ["view", "click", "apply", "save"];

export type JobSort = "recent" | "salary_high" | "salary_low";

export interface InteractionEvent {
  user_id: number;
  job_id: number;
  event_type: EventType;
  session_id: string;
  event_ts: string;
}

export interface SimulateResponse {
  status: string;
  event: InteractionEvent;
}

export interface ActivityEvent {
  interaction_id: number;
  user_id: number;
  job_id: number;
  event_type: EventType;
  /** Postgres `TIMESTAMP` with no zone; the backend writes UTC. */
  event_ts: string;
  user_title: string;
  job_title: string;
  job_company: string;
}

export interface ActivityResponse {
  events: ActivityEvent[];
}

export interface HealthResponse {
  status: string;
}

// ---------- Transport ----------

/**
 * Carries the HTTP status alongside the message so views can distinguish
 * "this user does not exist" (404) from "the backend is down".
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  if (!body) return res.statusText || `HTTP ${res.status}`;
  try {
    // FastAPI surfaces HTTPException as {"detail": "..."} and validation
    // failures as {"detail": [...]}.
    const parsed = JSON.parse(body);
    const detail = parsed?.detail;
    if (typeof detail === "string") return detail;
    if (detail) return JSON.stringify(detail);
  } catch {
    /* not JSON -- fall through and show the raw body */
  }
  return body.slice(0, 300);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (cause) {
    // fetch only rejects on network-level failure, which here almost always
    // means the API process is not running or CORS blocked the call.
    throw new ApiError(
      `Cannot reach the API at ${API_URL} (${
        cause instanceof Error ? cause.message : "network error"
      })`,
      0
    );
  }
  if (!res.ok) {
    // A previously-valid session token the API no longer accepts (expired,
    // or the account was removed) -- clear it and bounce to /login instead
    // of leaving every protected view stuck rendering a raw 401. Scoped to
    // requests that actually carried a bearer token: /auth/login's own 401
    // (wrong password) never does, so that still surfaces through the
    // normal ApiError path below and shows inline on the login form,
    // rather than silently redirecting away from it.
    if (res.status === 401 && new Headers(init?.headers).has("Authorization") && typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      if (window.location.pathname !== "/login") {
        // A hard navigation, not router.push(), is deliberate here: this
        // file has no access to the Next.js router (it's a plain module,
        // not a component), and more importantly a soft client-side
        // navigation would leave every other component's in-memory
        // state (SWR's cache included) holding data fetched under a
        // session that's just been invalidated.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
      }
    }
    throw new ApiError(await readError(res), res.status);
  }
  // DELETE /jobs/{id} answers 204 with no body -- res.json() would throw on
  // the empty string, so this is not just a style choice.
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ---------- Endpoints ----------

export function getHealth() {
  return request<HealthResponse>("/health");
}

export function getUsers(search?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set("search", search);
  return request<UsersResponse>(`/users?${params}`);
}

export function getUserDetail(userId: number) {
  return request<UserDetail>(`/users/${userId}`);
}

export function getRecommendations(userId: number, topK = 10) {
  return request<RecommendationsResponse>(
    `/recommendations/${userId}?top_k=${topK}`
  );
}

export interface JobsQuery {
  search?: string;
  location?: string;
  seniority?: string;
  sort?: JobSort;
  page?: number;
  page_size?: number;
  /** Recruiter's own account_id, to scope the management view to "my postings". */
  posted_by?: number;
}

export function getJobs(query: JobsQuery = {}) {
  const params = new URLSearchParams({
    sort: query.sort ?? "recent",
    page: String(query.page ?? 1),
    page_size: String(query.page_size ?? 20),
  });
  if (query.search) params.set("search", query.search);
  if (query.location) params.set("location", query.location);
  if (query.seniority) params.set("seniority", query.seniority);
  if (query.posted_by !== undefined) params.set("posted_by", String(query.posted_by));
  return request<JobsResponse>(`/jobs?${params}`);
}

export function getJobDetail(jobId: number) {
  return request<JobDetail>(`/jobs/${jobId}`);
}

export function createJob(token: string, payload: JobWritePayload) {
  return request<JobDetail>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
}

export function updateJob(token: string, jobId: number, payload: Partial<JobWritePayload>) {
  return request<JobDetail>(`/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
}

export function deleteJob(token: string, jobId: number) {
  return request<void>(`/jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

/**
 * Publishes to the `interaction-events` Kafka topic and returns immediately.
 * The consumer (scripts/consume_events.py) writes the interaction row and
 * nudges the user embedding afterwards, so nothing downstream of this call is
 * up to date the moment it resolves.
 *
 * Requires auth. A job_seeker's own linked_user_id is used automatically by
 * the backend regardless of `userId` -- passing it is only meaningful for a
 * recruiter/admin simulating on a chosen profile for demo/testing purposes.
 */
export function simulateInteraction(
  token: string,
  jobId: number,
  eventType: EventType,
  userId?: number
) {
  return request<SimulateResponse>("/interactions/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({
      job_id: jobId,
      event_type: eventType,
      ...(userId !== undefined ? { user_id: userId } : {}),
    }),
  });
}

export function getRecentActivity(limit = 30, sinceId?: number) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sinceId !== undefined) params.set("since_id", String(sinceId));
  return request<ActivityResponse>(`/activity/recent?${params}`);
}

// ---------- Auth (Part 3) ----------

export type Role = "job_seeker" | "recruiter" | "admin";

export interface SessionResponse {
  access_token: string;
  role: Role;
  account_id: number;
  linked_user_id: number | null;
}

export interface Account {
  account_id: number;
  email: string;
  role: Role;
  linked_user_id: number | null;
  created_at: string;
}

export function login(email: string, password: string) {
  return request<SessionResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export interface RegisterPayload {
  email: string;
  password: string;
  role: Role;
  linked_user_id?: number;
}

export function register(payload: RegisterPayload) {
  return request<SessionResponse>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Self-serve signup. Distinct from `register` above: a job_seeker signup
 * here creates a brand-new row in the `users` table and computes a real
 * embedding for it server-side (synchronously), rather than only linking to
 * a user_id that already exists. `register` still exists for the seeded
 * accounts and admin tooling; this is what the public /signup page calls.
 */
export type SignupPayload =
  | { email: string; password: string; role: "recruiter" }
  | {
      email: string;
      password: string;
      role: "job_seeker";
      current_title: string;
      location: string;
      total_experience_years: number;
      skills: string[];
    };

export function signup(payload: SignupPayload) {
  return request<SessionResponse>("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getMe(token: string) {
  return request<Account>("/auth/me", { headers: authHeaders(token) });
}

// ---------- Admin (Part 3) ----------

export interface AdminStats {
  total_users: number;
  total_jobs: number;
  total_interactions: number;
  total_accounts: number;
  accounts_by_role: Record<string, number>;
  jobs_per_recruiter: { account_id: number; email: string; job_count: number }[];
  /** Last interaction actually written by the Kafka consumer -- a real,
   *  durable signal that the pipeline is alive, not a frontend assumption. */
  latest_interaction_at: string | null;
}

export function getAdminStats(token: string) {
  return request<AdminStats>("/admin/stats", { headers: authHeaders(token) });
}

export function getAdminAccounts(token: string) {
  return request<{ accounts: Account[] }>("/admin/accounts", { headers: authHeaders(token) });
}
