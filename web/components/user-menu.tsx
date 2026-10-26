import { signOut } from "@/app/login/actions";
import { requireUser } from "@/lib/auth";

import { button } from "./ui";

export async function UserMenu() {
  const user = await requireUser();
  return (
    <form action={signOut} className="flex items-center gap-1">
      <span className="hidden text-sm text-muted sm:inline">{user.displayName}</span>
      <button type="submit" className={`${button.quiet} whitespace-nowrap`}>Sign out</button>
    </form>
  );
}
