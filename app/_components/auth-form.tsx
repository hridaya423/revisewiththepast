"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ArrowRight, Check, Loader2, Mail, User } from "lucide-react";

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

  const [nameField, setNameField] = useState<FieldState>({ value: "", error: "", touched: false });
  const [emailField, setEmailField] = useState<FieldState>({ value: "", error: "", touched: false });
  const [passwordField, setPasswordField] = useState<FieldState>({ value: "", error: "", touched: false });

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "sign-up") {
      setNameField({ value: "", error: "", touched: false });
    }
  }, [mode]);

  const handleModeSwitch = useCallback((nextMode: Mode) => {
    setMode(nextMode);
    setServerError(null);
    setSuccessState(null);
    setNameField((f) => ({ ...f, error: "", touched: false }));
    setEmailField((f) => ({ ...f, error: "", touched: false }));
    setPasswordField((f) => ({ ...f, error: "", touched: false }));
    setTimeout(() => {
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

        setTimeout(() => {
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
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f2ec] px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="text-center">
          <a href="/" className="inline-block font-serif text-[1.05rem] tracking-[-0.02em] text-[#1a2e1a]">
            Revise with the Past
          </a>
        </div>

        <div className="mt-8 rounded-[1.6rem] border border-[#1a2e1a]/[0.06] bg-white shadow-[0_8px_40px_rgba(26,46,26,0.06)]">
          <div className="px-8 pt-8 pb-2">
            <h1 className="font-serif text-[1.7rem] tracking-[-0.03em] text-[#1a2e1a]">
              {isSuccess
                ? successState === "signed-up"
                  ? "Account created"
                  : "Welcome back"
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </h1>
            <p className="mt-2 text-[0.88rem] leading-[1.6] text-[#3d5a3f]/60">
              {isSuccess
                ? successState === "signed-up"
                  ? "Your account is ready. Redirecting now..."
                  : "Redirecting to your papers..."
                : mode === "sign-in"
                  ? "Welcome back to your paper builder."
                  : "Start building papers with a free account."}
            </p>
          </div>

          {isSuccess ? (
            <div className="flex flex-col items-center gap-4 px-8 pb-10 pt-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Check className="h-6 w-6" strokeWidth={2.5} />
              </div>
              <div className="h-1 w-24 overflow-hidden rounded-full bg-[#1a2e1a]/[0.06]">
                <div className="h-full w-1/3 animate-[indeterminate-bar_1.5s_ease-in-out_infinite] rounded-full bg-accent" />
              </div>
            </div>
          ) : (
            <>
              <div className="mt-4 flex px-8">
                <button
                  type="button"
                  onClick={() => handleModeSwitch("sign-in")}
                  className={`flex-1 border-b-2 pb-3 text-[0.82rem] font-medium tracking-[-0.01em] transition-all ${
                    mode === "sign-in"
                      ? "border-[#1a2e1a] text-[#1a2e1a]"
                      : "border-transparent text-[#3d5a3f]/40 hover:text-[#3d5a3f]/60"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => handleModeSwitch("sign-up")}
                  className={`flex-1 border-b-2 pb-3 text-[0.82rem] font-medium tracking-[-0.01em] transition-all ${
                    mode === "sign-up"
                      ? "border-[#1a2e1a] text-[#1a2e1a]"
                      : "border-transparent text-[#3d5a3f]/40 hover:text-[#3d5a3f]/60"
                  }`}
                >
                  Create account
                </button>
              </div>

              <form onSubmit={onSubmit} className="mt-2 space-y-0 px-8 pt-5 pb-8">
                {serverError && (
                  <div className="mb-4 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-[0.82rem] leading-[1.5] text-red-800">
                    {serverError}
                  </div>
                )}

                {mode === "sign-up" && (
                  <div className="mb-4">
                    <label htmlFor="auth-name" className="mb-1.5 block text-[0.78rem] font-medium tracking-[-0.01em] text-[#1a2e1a]/75">
                      Name
                    </label>
                    <div className="relative">
                      <input
                        ref={nameRef}
                        id="auth-name"
                        type="text"
                        autoComplete="name"
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
                        className={`w-full rounded-xl border bg-[#faf9f6] px-4 py-3 pl-11 text-[0.88rem] text-[#1a2e1a] outline-none transition-all placeholder:text-[#3d5a3f]/30 focus:bg-white focus:shadow-[0_0_0_3px_rgba(90,138,92,0.15)] ${
                          nameField.touched && nameField.error
                            ? "border-red-300 focus:border-red-300 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]"
                            : "border-[#1a2e1a]/[0.08] focus:border-accent/40"
                        }`}
                      />
                      <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3d5a3f]/30" strokeWidth={1.5} />
                    </div>
                    {nameField.touched && nameField.error ? (
                      <p className="mt-1.5 text-[0.72rem] text-red-600">{nameField.error}</p>
                    ) : null}
                  </div>
                )}

                <div className="mb-4">
                  <label htmlFor="auth-email" className="mb-1.5 block text-[0.78rem] font-medium tracking-[-0.01em] text-[#1a2e1a]/75">
                    Email
                  </label>
                  <div className="relative">
                    <input
                      ref={emailRef}
                      id="auth-email"
                      type="email"
                      autoComplete="email"
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
                      className={`w-full rounded-xl border bg-[#faf9f6] px-4 py-3 pl-11 text-[0.88rem] text-[#1a2e1a] outline-none transition-all placeholder:text-[#3d5a3f]/30 focus:bg-white focus:shadow-[0_0_0_3px_rgba(90,138,92,0.15)] ${
                        emailField.touched && emailField.error
                          ? "border-red-300 focus:border-red-300 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]"
                          : "border-[#1a2e1a]/[0.08] focus:border-accent/40"
                      }`}
                    />
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3d5a3f]/30" strokeWidth={1.5} />
                  </div>
                  {emailField.touched && emailField.error ? (
                    <p className="mt-1.5 text-[0.72rem] text-red-600">{emailField.error}</p>
                  ) : null}
                </div>

                <div className="mb-1">
                  <label htmlFor="auth-password" className="mb-1.5 block text-[0.78rem] font-medium tracking-[-0.01em] text-[#1a2e1a]/75">
                    Password
                  </label>
                  <input
                    ref={passwordRef}
                    id="auth-password"
                    type="password"
                    autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
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
                    className={`w-full rounded-xl border bg-[#faf9f6] px-4 py-3 text-[0.88rem] text-[#1a2e1a] outline-none transition-all placeholder:text-[#3d5a3f]/30 focus:bg-white focus:shadow-[0_0_0_3px_rgba(90,138,92,0.15)] ${
                      passwordField.touched && passwordField.error
                        ? "border-red-300 focus:border-red-300 focus:shadow-[0_0_0_3px_rgba(220,38,38,0.1)]"
                        : "border-[#1a2e1a]/[0.08] focus:border-accent/40"
                    }`}
                  />
                  {passwordField.touched && passwordField.error ? (
                    <p className="mt-1.5 text-[0.72rem] text-red-600">{passwordField.error}</p>
                  ) : null}
                  {mode === "sign-up" && !passwordField.touched && (
                    <p className="mt-1.5 text-[0.72rem] text-[#3d5a3f]/40">8 characters minimum</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-press group mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#1a2e1a] px-5 py-3 text-[0.88rem] font-semibold text-white shadow-[0_6px_20px_rgba(26,46,26,0.2)] transition-all hover:bg-[#243824] hover:shadow-[0_8px_28px_rgba(26,46,26,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
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

        <p className="mt-6 text-center text-[0.78rem] text-[#3d5a3f]/40">
          By continuing, you agree to our terms of use.
        </p>
      </div>
    </div>
  );
}
