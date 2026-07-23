import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/app/_components/auth-form";

export const metadata: Metadata = {
  title: "Sign in — Revise with the Past",
  description: "Sign in to save practice papers and continue marking.",
};

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
