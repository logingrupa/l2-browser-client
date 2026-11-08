import { hostname } from "node:os";
import { describeActiveMachineWindow, findActiveMachineWindow, formatRigaTimestamp } from "../../../scripts/check-machine-schedule.mjs";

export function refuseTestRunInsideMachineWindow(hostName: string = hostname(), instant: Date = new Date()): void {
  const activeWindow = findActiveMachineWindow(hostName, instant);
  if (activeWindow !== null) throw new Error(`Playwright run refused: ${describeActiveMachineWindow(activeWindow, formatRigaTimestamp(instant))}`);
}
