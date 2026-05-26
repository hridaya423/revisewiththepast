import { Suspense } from "react";

import { AuthForm } from "@/app/_components/auth-form";

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}