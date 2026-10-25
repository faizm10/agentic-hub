import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { currentUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Workspace" };

export default async function AppPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <Workspace email={user.email} />;
}
