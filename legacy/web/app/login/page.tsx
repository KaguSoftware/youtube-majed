import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="title-card text-marquee">Studio</p>
        <p className="mt-3 text-muted">Researched history films, from topic to finished video.</p>
        <div className="mt-12">
          <Suspense fallback={<SignInForm next="/" />}>
            <WithNext searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function WithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  return <SignInForm next={typeof next === "string" ? next : "/"} />;
}
