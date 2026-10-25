import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeviceStatusCard } from "../components/device-status-card";
import { TooltipProvider } from "../primitives/tooltip";
import type { Device } from "../model/types";

const device: Device = {
  id: "d1",
  name: "Laptop",
  platform: "macos",
  status: "online",
  lastSeenAt: "2026-01-01T00:00:00Z",
  projectCount: 2,
  activeSessionCount: 1,
};

describe("DeviceStatusCard", () => {
  it("never enables remote actions without an authorized control plane", () => {
    render(
      <TooltipProvider>
        <DeviceStatusCard device={device} onStartSession={vi.fn()} remoteActionsUnavailableReason="No control plane" />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: /Start session/ })).toBeDisabled();
    expect(screen.getByText("Remote control unavailable")).toBeInTheDocument();
  });

  it("disables actions for offline devices", () => {
    render(
      <TooltipProvider>
        <DeviceStatusCard device={{ ...device, status: "offline" }} onStartSession={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("article", { name: "Laptop, offline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start session/ })).toBeDisabled();
  });
});
