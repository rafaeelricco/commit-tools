export { execBin, execBinInteractive, type CommandOutput, type CommandFailure, type ExecResult };

import { Future } from "@/libs/future";
import { Failure, type Result, Success } from "@/libs/result";
import { spawn } from "node:child_process";

type CommandOutput = Readonly<{ stdout: string; stderr: string }>;
type CommandFailure = Readonly<{ output: CommandOutput; error: Error }>;
type ExecResult = Result<CommandFailure, CommandOutput>;

const exitCodeError = (exitCode: number | null, signal: NodeJS.Signals | null): Error =>
  new Error(`Command failed with exit code ${exitCode}${signal ? ` and signal ${signal}` : ""}`);

const commandResult = (output: CommandOutput, exitCode: number | null, signal: NodeJS.Signals | null): ExecResult =>
  exitCode === 0 ?
    Success<CommandFailure, CommandOutput>(output)
  : Failure<CommandFailure, CommandOutput>({ output, error: exitCodeError(exitCode, signal) });

const execBin = (bin: string, args: string[]): Future<Error, ExecResult> =>
  Future.create<Error, ExecResult>((reject, resolve) => {
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    proc.on("error", (err) => reject(new Error(`Failed to start process: ${err.message}`)));
    proc.on("close", (exitCode, signal) => resolve(commandResult({ stdout, stderr }, exitCode, signal)));

    return () => proc.kill();
  });

const execBinInteractive = (bin: string, args: string[]): Future<Error, void> =>
  Future.create<Error, void>((reject, resolve) => {
    const proc = spawn(bin, args, { stdio: "inherit", shell: process.platform === "win32" });

    proc.on("error", (err) => reject(new Error(`Failed to start process: ${err.message}`)));
    proc.on("close", (exitCode, signal) => (exitCode === 0 ? resolve(undefined) : reject(exitCodeError(exitCode, signal))));

    return () => proc.kill();
  });
