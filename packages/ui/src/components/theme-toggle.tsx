"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../lib/theme";
import { SegmentedControl } from "../primitives/form";

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl<ThemePreference>
      label="Theme"
      value={preference}
      onChange={setPreference}
      className={className}
      options={[
        { value: "system", label: "System", icon: <Monitor /> },
        { value: "light", label: "Light", icon: <Sun /> },
        { value: "dark", label: "Dark", icon: <Moon /> },
      ]}
    />
  );
}