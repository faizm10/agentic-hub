import type { Metadata } from "next";
import { SessionsIndex } from "@/components/sessions-index";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsPage() {
  return <SessionsIndex />;
}
