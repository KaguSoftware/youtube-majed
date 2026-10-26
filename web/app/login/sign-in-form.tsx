"use client";

import { useActionState } from "react";

import { button, field } from "@/components/ui";

import { signIn, type SignInState } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="eyebrow text-muted">Username</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          required defaultValue={state.username} aria-invalid={!!state.error} className={field} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="eyebrow text-muted">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          aria-invalid={!!state.error} aria-describedby={state.error ? "signin-error" : undefined} className={field} />
      </div>
      <p id="signin-error" role="alert" className="min-h-5 text-sm text-danger">{state.error}</p>
      <button type="submit" disabled={pending} className={`${button.primary} w-full`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
