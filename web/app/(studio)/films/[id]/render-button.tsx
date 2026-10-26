"use client";

import { useActionState } from "react";

import { button } from "@/components/ui";

import { renderFilm } from "./look/actions";
import type { ActionState } from "./actions";

export function RenderButton({ projectId, again = false, minutes }: { projectId: string; again?: boolean; minutes: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(renderFilm.bind(null, projectId), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <button type="submit" disabled={pending} className={`${button.primary} self-start`}>
        {pending ? "Starting the render…" : again ? "Render again" : "Render the film"}
      </button>
      <p className="text-sm text-faint">
        About {minutes} minutes on the studio machine. You can close this page; finished frames are kept if anything interrupts it.
      </p>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}
