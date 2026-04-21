export { execBin, type ExecResult };

import { Future } from "@/libs/future";
import { spawn } from "node:child_process";

type ExecResult = { stdout: string; stderr: string; exitCode: number };

const execBin = (bin: string, args: string[]): Future<Error, ExecResult> =>
  Future.create<Error, ExecResult>((reject, resolve) => {
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
    proc.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
    return () => {
      proc.kill();
    };
  });
