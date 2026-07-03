"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

const AuthContext = createContext();

// Simple JWT decode (just the payload — no verification needed client-side)
function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.auto-flow.studio/api";

  // Silently refresh the access token using the stored refresh token
  const refreshAccessToken = useCallback(async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!response.ok) {
        // Refresh token is also expired — force logout
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("user_email");
        setToken(null);
        setUser(null);
        return false;
      }

      const data = await response.json();
      localStorage.setItem("access_token", data.access);
      if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
      setToken(data.access);
      return true;
    } catch {
      return false;
    }
  }, [API_URL]);

  // Schedule a refresh 2 minutes before the token expires
  const scheduleRefresh = useCallback((accessToken) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const payload = decodeJwtPayload(accessToken);
    if (!payload || !payload.exp) return;

    const expiresInMs = payload.exp * 1000 - Date.now();
    // Refresh 2 minutes before expiry (or immediately if less than 2 min left)
    const refreshInMs = Math.max(expiresInMs - 120_000, 0);

    refreshTimerRef.current = setTimeout(async () => {
      const success = await refreshAccessToken();
      if (success) {
        const newToken = localStorage.getItem("access_token");
        if (newToken) scheduleRefresh(newToken);
      }
    }, refreshInMs);
  }, [refreshAccessToken]);

  // On mount: restore session and check if token needs refreshing
  useEffect(() => {
    const init = async () => {
      const storedToken = localStorage.getItem("access_token");
      const storedEmail = localStorage.getItem("user_email");

      if (storedToken) {
        const payload = decodeJwtPayload(storedToken);
        const isExpired = payload && payload.exp && payload.exp * 1000 < Date.now();

        if (isExpired) {
          // Token expired — try to refresh silently
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            const newToken = localStorage.getItem("access_token");
            setToken(newToken);
            setUser({ email: storedEmail || "User" });
            scheduleRefresh(newToken);
          }
          // If refresh failed, user stays logged out (state is already null)
        } else {
          // Token is still valid
          setToken(storedToken);
          setUser({ email: storedEmail || "User" });
          scheduleRefresh(storedToken);
        }
      }
      setLoading(false);
    };
    init();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshAccessToken, scheduleRefresh]);

  const login = async (email, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Invalid email or password");
      }

      const data = await response.json();

      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      localStorage.setItem("user_email", email);

      setToken(data.access);
      setUser({ email });
      scheduleRefresh(data.access);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const register = async (email, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.message || "Registration failed");
      }

      // Automatically login after successful registration
      return await login(email, password);
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  const logout = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user_email");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
