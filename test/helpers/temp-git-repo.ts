import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export type TempGitRepo = { dir: string; run: (args: string) => string };

export const createTempGitRepo = (opts?: { staged?: boolean; unstaged?: boolean; untrackedFile?: { path: string; contents: string } }): TempGitRepo => {
  const dir = mkdtempSync(join(tmpdir(), "commit-tools-git-"));
  const run = (args: string) => execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" });
  run("init -b main");
  run('config user.email "test@example.com"');
  run('config user.name "Test"');
  writeFileSync(join(dir, "file.txt"), "hello\n");
  run("add file.txt");
  run('commit -m "initial"');
  if (opts?.staged) {
    writeFileSync(join(dir, "file.txt"), "hello world\n");
    run("add file.txt");
  }
  if (opts?.unstaged) {
    writeFileSync(join(dir, "file.txt"), "hello unstaged\n");
  }
  if (opts?.untrackedFile) {
    writeFileSync(join(dir, opts.untrackedFile.path), opts.untrackedFile.contents);
  }
  return { dir, run };
};
