"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/shared/infrastructure/auth/client";
import { BrandMark } from "@/app/_components/brand-mark";
import { AuthFormView } from "@/app/_components/auth-form-view";
import { authFormReducer, initialAuthFormState, type AuthMode } from "@/app/_components/auth-form-model";

type Mode = AuthMode;

function validateEmail(email: string): string {
  if (!email.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email";
  return "";
}

function validatePassword(password: string, mode: Mode): string {
  if (!password) return "Password is required";
  if (mode === "sign-up" && password.length < 8) return "Must be at least 8 characters";
  return "";
}

function validateName(name: string): string {
  if (!name.trim()) return "Name is required";
  return "";
}

function getSafeRedirectTarget(value: string | null) {
  if (!value) return "/paper-maker";
  if (!value.startsWith("/")) return "/paper-maker";
  if (value.startsWith("//")) return "/paper-maker";
  if (value.includes("\\")) return "/paper-maker";
  return value;
}

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = getSafeRedirectTarget(searchParams.get("redirect"));
  const [formState, dispatch] = useReducer(authFormReducer, initialAuthFormState);
  const { mode, nameField, emailField, passwordField } = formState;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
  }, []);

  const handleModeSwitch = useCallback((nextMode: Mode) => {
    dispatch({ type: "mode-changed", mode: nextMode });
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      if (nextMode === "sign-up") nameRef.current?.focus();
      else emailRef.current?.focus();
    }, 50);
  }, []);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      dispatch({ type: "server-error", message: "" });

      let hasError = false;
      const nameErr = mode === "sign-up" ? validateName(nameField.value) : "";
      const emailErr = validateEmail(emailField.value);
      const passwordErr = validatePassword(passwordField.value, mode);

      dispatch({ type: "validation-failed", fields: { ...(nameErr ? { nameField: nameErr } : {}), ...(emailErr ? { emailField: emailErr } : {}), ...(passwordErr ? { passwordField: passwordErr } : {}) } });
      hasError = Boolean(nameErr || emailErr || passwordErr);

      if (hasError) return;

      setIsSubmitting(true);
      try {
        if (mode === "sign-up") {
          const result = await authClient.signUp.email({
            name: nameField.value.trim(),
            email: emailField.value.trim(),
            password: passwordField.value,
          });
          if (result.error) {
            dispatch({ type: "server-error", message: result.error.message ?? "Could not create account. Please try again." });
            return;
          }
          dispatch({ type: "success", state: "signed-up" });
        } else {
          const result = await authClient.signIn.email({
            email: emailField.value.trim(),
            password: passwordField.value,
          });
          if (result.error) {
            dispatch({ type: "server-error", message: result.error.message ?? "Could not sign in. Check your credentials." });
            return;
          }
          dispatch({ type: "success", state: "signed-in" });
        }

        redirectTimerRef.current = setTimeout(() => {
          router.push(redirectTo);
          router.refresh();
        }, 600);
      } catch (error) {
        dispatch({ type: "server-error", message: error instanceof Error ? error.message : "Something went wrong." });
      } finally {
        setIsSubmitting(false);
      }
    },
    [mode, nameField.value, emailField.value, passwordField.value, redirectTo, router],
  );


  return (
    <div className="min-h-[100dvh] bg-bg-workspace px-5 py-5 sm:px-8 sm:py-8 lg:flex lg:items-center lg:px-10 lg:py-6">
      <div className="mx-auto grid w-full max-w-[1180px] overflow-hidden border border-text/20 bg-bg-soft shadow-[0_28px_80px_rgba(13,23,52,0.16)] lg:min-h-[min(760px,calc(100dvh-3rem))] lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[410px_minmax(0,1fr)]">
        <aside className="relative hidden overflow-hidden bg-[#0B1736] text-white lg:flex lg:flex-col">
          <div className="relative z-10 px-8 pt-8 xl:px-10 xl:pt-10">
            <Link href="/" className="inline-flex items-center gap-3 text-[0.9rem] font-bold tracking-[-0.025em] text-white">
              <BrandMark className="h-9 w-8 text-white" title="Revise with the Past" />
              <span>Revise with the Past</span>
            </Link>
            <h2 className="mt-12 max-w-[11ch] font-serif text-[2.25rem] leading-[1.02] tracking-[-0.045em] text-white xl:text-[2.55rem]">
              Your papers, ready when you are.
            </h2>
            <p className="mt-4 max-w-[32ch] text-[0.84rem] leading-6 text-white/65">
              Return to the questions you saved and continue your revision.
            </p>
          </div>
          <figure className="relative mt-10 flex flex-1 items-end justify-end pl-12 xl:pl-16">
            <div className="relative -mb-24 -mr-10 w-[330px] rotate-[1.5deg] overflow-hidden border border-white/25 bg-white shadow-[0_20px_45px_rgba(0,0,0,0.24)] xl:w-[355px]">
              <Image
                src="/landing/aqa-geography-paper-page.png"
                alt="AQA Geography exam paper page with Arctic sea ice questions"
                width={1272}
                height={1800}
                sizes="(min-width: 1280px) 355px, 330px"
                className="h-auto w-full"
                priority
              />
            </div>
          </figure>
        </aside>

        <main className="flex min-w-0 items-center justify-center px-1 py-3 sm:px-8 sm:py-10 lg:px-14 lg:py-12 xl:px-20">
          <div className="w-full max-w-[500px]">
        <div className="lg:hidden">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[0.9rem] font-bold tracking-[-0.025em] text-text">
            <BrandMark className="h-9 w-8 text-accent" title="Revise with the Past" />
            <span>Revise with the Past</span>
          </Link>
        </div>

        <AuthFormView
          state={formState}
          mode={mode}
          isSubmitting={isSubmitting}
          showPassword={showPassword}
          refs={{ name: nameRef, email: emailRef, password: passwordRef }}
          actions={{
            switchMode: handleModeSwitch,
            submit: onSubmit,
            togglePassword: () => setShowPassword((current) => !current),
            changeField: (field, value) => dispatch({ type: "field-changed", field, value, error: field === "nameField" ? (nameField.touched ? validateName(value) : "") : field === "emailField" ? (emailField.touched ? validateEmail(value) : "") : (passwordField.touched ? validatePassword(value, mode) : "") }),
            blurField: (field) => dispatch({ type: "field-blurred", field, error: field === "nameField" ? validateName(nameField.value) : field === "emailField" ? validateEmail(emailField.value) : validatePassword(passwordField.value, mode) }),
          }}
        />

        <p className="mt-6 text-center text-[0.72rem] leading-5 text-text-subtle">Your account keeps generated papers and marking progress together.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
