import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await currentUser().catch(() => null)) redirect("/app");
  return <AuthForm mode="signup" />;
}
