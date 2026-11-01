import { useEffect, useState, type ReactNode } from "react";
import { apiFetch, clearTokens, setTokens } from "../api/client";
import type { TokenResponse, User } from "../types";
import { AuthContext } from "./auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Only a stored token has anything to wait for; without one we already know
  // the answer is "signed out".
  const [loading, setLoading] = useState(() => localStorage.getItem("access_token") !== null);

  useEffect(() => {
    if (!localStorage.getItem("access_token")) return;
    apiFetch<User>("/api/auth/me")
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiFetch<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setTokens(data.access_token, data.refresh_token);
    const me = await apiFetch<User>("/api/auth/me");
    setUser(me);
  };

  const register = async (
    email: string,
    username: string,
    password: string
  ) => {
    const data = await apiFetch<TokenResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    });
    setTokens(data.access_token, data.refresh_token);
    const me = await apiFetch<User>("/api/auth/me");
    setUser(me);
  };

  const logout = () => {
    clearTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
