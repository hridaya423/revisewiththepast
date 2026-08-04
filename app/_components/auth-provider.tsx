"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { authClient } from "@/shared/infrastructure/auth/client";

type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AuthState = {
  user: User | null;
  isLoaded: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  isLoaded: false,
  isAuthenticated: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending, error } = authClient.useSession();

  const user = useMemo(() => {
    if (error || !data?.user) return null;
    return data.user as User;
  }, [data, error]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    window.location.href = "/";
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoaded: !isPending,
      isAuthenticated: user !== null,
      signOut,
    }),
    [user, isPending, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}