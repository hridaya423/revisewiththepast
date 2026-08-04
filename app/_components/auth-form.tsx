"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/shared/infrastructure/auth/client";
import { ArrowRight, Check, Eye, EyeOff, Loader2, Mail, User } from "lucide-react";
import { BrandMark } from "@/app/_components/brand-mark";

type Mode = "sign-in" | "sign-up";

type FieldState = {
  value: string;
  error: string;
  touched: boolean;
};

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
  return value;
}

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = getSafeRedirectTarget(searchParams.get("redirect"));
  const [mode, setMode] = useState<Mode>("sign-in");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<"signed-in" | "signed-up" | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [nameField, setNameField] = useState<FieldState>({ value: "", error: "", touched: false });
  const [emailField, setEmailField] = useState<FieldState>({ value: "", error: "", touched: false });
  const [passwordField, setPasswordField] = useState<FieldState>({ value: "", error: "", touched: false });

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
    setMode(nextMode);
    setServerError(null);
    setSuccessState(null);
    setNameField((f) => ({ ...f, error: "", touched: false }));
    setEmailField((f) => ({ ...f, error: "", touched: false }));
    setPasswordField((f) => ({ ...f, error: "", touched: false }));
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      if (nextMode === "sign-up") nameRef.current?.focus();
      else emailRef.current?.focus();
    }, 50);
  }, []);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setServerError(null);

      let hasError = false;
      const nameErr = mode === "sign-up" ? validateName(nameField.value) : "";
      const emailErr = validateEmail(emailField.value);
      const passwordErr = validatePassword(passwordField.value, mode);

      if (nameErr) { setNameField((f) => ({ ...f, error: nameErr, touched: true })); hasError = true; }
      if (emailErr) { setEmailField((f) => ({ ...f, error: emailErr, touched: true })); hasError = true; }
      if (passwordErr) { setPasswordField((f) => ({ ...f, error: passwordErr, touched: true })); hasError = true; }

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
            setServerError(result.error.message ?? "Could not create account. Please try again.");
            return;
          }
          setSuccessState("signed-up");
        } else {
          const result = await authClient.signIn.email({
            email: emailField.value.trim(),
            password: passwordField.value,
          });
          if (result.error) {
            setServerError(result.error.message ?? "Could not sign in. Check your credentials.");
            return;
          }
          setSuccessState("signed-in");
        }

        redirectTimerRef.current = setTimeout(() => {
          router.push(redirectTo);
          router.refresh();
        }, 600);
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Something went wrong.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [mode, nameField.value, emailField.value, passwordField.value, redirectTo, router],
  );

  const isSuccess = successState !== null;

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

        <div className="mt-12 lg:mt-0">
          <div>
            <h1 className="font-serif text-[2.35rem] leading-[1.04] tracking-[-0.045em] text-text sm:text-[2.75rem]">
              {isSuccess
                ? successState === "signed-up"
                  ? "Account created"
                  : "Welcome back"
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </h1>
            <p className="mt-3 max-w-[44ch] text-[0.95rem] leading-7 text-text-muted">
              {isSuccess
                ? successState === "signed-up"
                  ? "Your account is ready. Redirecting now..."
                  : "Redirecting to your papers..."
                : mode === "sign-in"
                   ? "Sign in to return to your saved papers."
                   : "Create an account to keep your papers and answers together."}
            </p>
          </div>

          {isSuccess ? (
            <div className="mt-10 flex items-center gap-4 border-y border-text/15 py-6" aria-live="polite">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
              </div>
              <div>
                <p className="text-[0.92rem] font-semibold text-text">Authentication complete</p>
                <p className="mt-1 flex items-center gap-2 text-[0.8rem] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Redirecting securely
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-9 flex gap-8 border-b border-text/15" aria-label="Authentication mode">
                <button
                  type="button"
                  onClick={() => handleModeSwitch("sign-in")}
                  aria-pressed={mode === "sign-in"}
                  className={`relative -mb-px border-b-2 px-0 pb-3 text-[0.84rem] font-semibold transition-colors ${
                    mode === "sign-in"
                      ? "border-accent text-text"
                      : "border-transparent text-text-muted hover:text-text"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => handleModeSwitch("sign-up")}
                  aria-pressed={mode === "sign-up"}
                  className={`relative -mb-px border-b-2 px-0 pb-3 text-[0.84rem] font-semibold transition-colors ${
                    mode === "sign-up"
                      ? "border-accent text-text"
                      : "border-transparent text-text-muted hover:text-text"
                  }`}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={onSubmit} className="pt-8">
                {serverError && (
                  <div className="mb-6 border-l-2 border-danger bg-danger-soft px-4 py-3 text-[0.85rem] leading-6 text-danger" role="alert">
                    {serverError}
                  </div>
                )}

                {mode === "sign-up" && (
                  <div className="mb-4">
                    <label htmlFor="auth-name" className="mb-1.5 block text-[0.72rem] font-semibold text-text-secondary">
                      Name
                    </label>
                    <div className="relative">
                      <input
                        ref={nameRef}
                        id="auth-name"
                        type="text"
                        autoComplete="name"
                        aria-invalid={Boolean(nameField.touched && nameField.error)}
                        aria-describedby={nameField.touched && nameField.error ? "auth-name-error" : undefined}
                        value={nameField.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNameField((f) => ({
                            value: val,
                            error: f.touched ? validateName(val) : "",
                            touched: f.touched,
                          }));
                        }}
                        onBlur={() => {
                          setNameField((f) => ({
                            ...f,
                            error: validateName(f.value),
                            touched: true,
                          }));
                        }}
                        placeholder="Your name"
                        className={`w-full rounded-[0.7rem] border bg-bg-soft px-4 py-3 pl-11 text-[0.84rem] text-text outline-none placeholder:text-text-subtle focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-glow)] ${
                          nameField.touched && nameField.error
                            ? "border-danger/40 focus:border-danger"
                            : "border-text/10 focus:border-accent"
                        }`}
                      />
                      <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" strokeWidth={1.5} />
                    </div>
                    {nameField.touched && nameField.error ? (
                      <p id="auth-name-error" className="mt-1.5 text-[0.72rem] text-danger">{nameField.error}</p>
                    ) : null}
                  </div>
                )}

                <div className="mb-4">
                  <label htmlFor="auth-email" className="mb-1.5 block text-[0.72rem] font-semibold text-text-secondary">
                    Email
                  </label>
                  <div className="relative">
                    <input
                      ref={emailRef}
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      aria-invalid={Boolean(emailField.touched && emailField.error)}
                      aria-describedby={emailField.touched && emailField.error ? "auth-email-error" : undefined}
                      value={emailField.value}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEmailField((f) => ({
                          value: val,
                          error: f.touched ? validateEmail(val) : "",
                          touched: f.touched,
                        }));
                      }}
                      onBlur={() => {
                        setEmailField((f) => ({
                          ...f,
                          error: validateEmail(f.value),
                          touched: true,
                        }));
                      }}
                      placeholder="you@example.com"
                      className={`w-full rounded-[0.7rem] border bg-bg-soft px-4 py-3 pl-11 text-[0.84rem] text-text outline-none placeholder:text-text-subtle focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-glow)] ${
                        emailField.touched && emailField.error
                          ? "border-danger/40 focus:border-danger"
                          : "border-text/10 focus:border-accent"
                      }`}
                    />
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" strokeWidth={1.5} />
                  </div>
                  {emailField.touched && emailField.error ? (
                    <p id="auth-email-error" className="mt-1.5 text-[0.72rem] text-danger">{emailField.error}</p>
                  ) : null}
                </div>

                <div className="mb-1">
                  <label htmlFor="auth-password" className="mb-1.5 block text-[0.72rem] font-semibold text-text-secondary">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                      aria-invalid={Boolean(passwordField.touched && passwordField.error)}
                      aria-describedby={passwordField.touched && passwordField.error ? "auth-password-error" : mode === "sign-up" ? "auth-password-help" : undefined}
                      value={passwordField.value}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPasswordField((f) => ({
                          value: val,
                          error: f.touched ? validatePassword(val, mode) : "",
                          touched: f.touched,
                        }));
                      }}
                      onBlur={() => {
                        setPasswordField((f) => ({
                          ...f,
                          error: validatePassword(f.value, mode),
                          touched: true,
                        }));
                      }}
                      placeholder={mode === "sign-up" ? "At least 8 characters" : "Enter your password"}
                      className={`w-full rounded-[0.7rem] border bg-bg-soft px-4 py-3 pr-11 text-[0.84rem] text-text outline-none placeholder:text-text-subtle focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-glow)] ${
                        passwordField.touched && passwordField.error
                          ? "border-danger/40 focus:border-danger"
                          : "border-text/10 focus:border-accent"
                      }`}
                    />
                    <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-text-subtle hover:bg-text/[0.05] hover:text-text" aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordField.touched && passwordField.error ? (
                    <p id="auth-password-error" className="mt-1.5 text-[0.72rem] text-danger">{passwordField.error}</p>
                  ) : null}
                  {mode === "sign-up" && !passwordField.touched && (
                    <p id="auth-password-help" className="mt-1.5 text-[0.72rem] text-text-subtle">8 characters minimum</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-press group mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-[0.7rem] bg-accent px-5 text-[0.8rem] font-bold text-white hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <>
                      <span>{mode === "sign-in" ? "Sign in" : "Create account"}</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[0.72rem] leading-5 text-text-subtle">Your account keeps generated papers and marking progress together.</p>
          </div>
        </main>
      </div>
    </div>
  );
}
