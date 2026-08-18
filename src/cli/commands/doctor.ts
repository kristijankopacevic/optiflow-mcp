import type { Command } from "commander";
import { renderDoctorReport, runDoctor } from "../../install/doctor.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Print an environment report: Node/npm versions, config resolution, gh CLI presence/auth."
    )
    .action(() => {
      const report = runDoctor();
      console.log(renderDoctorReport(report));
    });
}
