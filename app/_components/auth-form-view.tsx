"use client";

import { ArrowRight, Check, Eye, EyeOff, Loader2, Mail, User } from "lucide-react";
import type { AuthFieldName, AuthFormState, AuthMode } from "@/app/_components/auth-form-model";

type AuthFormViewProps = {
  state: AuthFormState;
  mode: AuthMode;
  isSubmitting: boolean;
  showPassword: boolean;
  refs: { name: React.RefObject<HTMLInputElement | null>; email: React.RefObject<HTMLInputElement | null>; password: React.RefObject<HTMLInputElement | null> };
  actions: { switchMode: (mode: AuthMode) => void; submit: (event: React.FormEvent<HTMLFormElement>) => void; togglePassword: () => void; changeField: (field: AuthFieldName, value: string) => void; blurField: (field: AuthFieldName) => void };
};

export function AuthFormView({ state, mode, isSubmitting, showPassword, refs, actions }: AuthFormViewProps) {
  const { nameField, emailField, passwordField, serverError, successState } = state;
  const isSuccess = successState !== null;
  const { name: nameRef, email: emailRef, password: passwordRef } = refs;
  return (
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
                  onClick={() => actions.switchMode("sign-in")}
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
                  onClick={() => actions.switchMode("sign-up")}
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

              <form onSubmit={actions.submit} className="pt-8">
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
                          actions.changeField("nameField", val);
                        }}
                        onBlur={() => {
                          actions.blurField("nameField");
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
                        actions.changeField("emailField", val);
                      }}
                      onBlur={() => {
                        actions.blurField("emailField");
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
                        actions.changeField("passwordField", val);
                      }}
                      onBlur={() => {
                        actions.blurField("passwordField");
                      }}
                      placeholder={mode === "sign-up" ? "At least 8 characters" : "Enter your password"}
                      className={`w-full rounded-[0.7rem] border bg-bg-soft px-4 py-3 pr-11 text-[0.84rem] text-text outline-none placeholder:text-text-subtle focus:bg-white focus:shadow-[0_0_0_3px_var(--accent-glow)] ${
                        passwordField.touched && passwordField.error
                          ? "border-danger/40 focus:border-danger"
                          : "border-text/10 focus:border-accent"
                      }`}
                    />
                    <button type="button" onClick={() => actions.togglePassword()} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-text-subtle hover:bg-text/[0.05] hover:text-text" aria-label={showPassword ? "Hide password" : "Show password"}>
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
  );
}
