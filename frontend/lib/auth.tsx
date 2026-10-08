"use client";

/**
 * Client-side session state. The token lives in localStorage, not an
 * httpOnly cookie -- the backend and frontend are on different origins in
 * dev (localhost:8000 vs :3000) with no shared-cookie setup, and this is a
 * portfolio project rather than something handling real user data, so the
 * simplification is a deliberate, stated tradeoff, not an oversight: a
 * token readable by any script on this origin is an XSS exposure a
 * production app would close off with an httpOnly cookie + CSRF token pair.
 *
 * On load (and after login) the token is verified against GET /auth/me
 * rather than trusted from its decoded payload -- the frontend can't verify
 * a JWT signature anyway, and this also catches an account that no longer
 * exists or a token past its server-side lifetime.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getMe,
  login as apiLogin,
  signup as apiSignup,
  TOKEN_KEY,
  type Account,
  type Role,
  type SignupPayload,
} from "./api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: Status;
  account: Account | null;
  token: string | null;
  login: (email: string, password: string) => Promise<Account>;
  signup: (payload: SignupPayload) => Promise<Account>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Where each role lands after login, and where a guard sends a
 *  role-mismatched visitor instead of just blocking them. */
export function homeForRole(role: Role): string {
  if (role === "recruiter") return "/manage";
  if (role === "admin") return "/admin";
  return "/";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Always starts at "loading", on both server and client -- deciding
  // "anonymous" vs "loading" during the lazy initializer by branching on
  // `typeof window` (an earlier version of this file did that, to satisfy
  // a lint rule about setState-in-effect) made the client's first render
  // disagree with the server-rendered HTML whenever a token was already
  // present, which is a genuine hydration-mismatch error, not a style nit.
  // localStorage plainly doesn't exist during SSR, so there is no way to
  // know the real status before the effect below runs client-side; this
  // is the correct place for it, not a lint-rule violation to route around.
  const [status, setStatus] = useState<Status>("loading");
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      // This is the first point at which "no session" can be known at all
      // (see the comment above the `status` useState above) -- not state
      // that render itself could have derived, so this is the legitimate
      // case the lint rule's own docs carve out.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("anonymous");
      return;
    }

    let cancelled = false;
    getMe(stored)
      .then((acc) => {
        if (cancelled) return;
        setToken(stored);
        setAccount(acc);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        window.localStorage.removeItem(TOKEN_KEY);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await apiLogin(email, password);
    const acc = await getMe(session.access_token);
    window.localStorage.setItem(TOKEN_KEY, session.access_token);
    setToken(session.access_token);
    setAccount(acc);
    setStatus("authenticated");
    return acc;
  }, []);

  const signup = useCallback(async (payload: SignupPayload) => {
    const session = await apiSignup(payload);
    const acc = await getMe(session.access_token);
    window.localStorage.setItem(TOKEN_KEY, session.access_token);
    setToken(session.access_token);
    setAccount(acc);
    setStatus("authenticated");
    return acc;
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setAccount(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ status, account, token, login, signup, logout }),
    [status, account, token, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}
