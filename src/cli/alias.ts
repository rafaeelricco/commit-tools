export { AliasCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { Just } from "@/libs/maybe";
import { absurd } from "@/libs/types";
import { ALIAS_TARGETS, AliasName, addAlias, describeTarget, removeAlias, type Alias, type AliasTarget } from "@/domain/alias/alias";
import { type AliasAction } from "@/cli/parser";
import { loadAliases, saveAliases } from "@/infra/storage/aliases";
import { aliasBinDir, findConflictingBinary, reconcileShims, removeShim, shimPath, writeShim } from "@/infra/alias/shims";
import { detectProfile, ensureBinDirOnPath, isBinDirOnPath, pathExportLine } from "@/infra/alias/path-setup";

import color from "picocolors";
import Table from "cli-table3";

const cancelled = (): Error => new Error("Cancelled");

const parseName = (raw: string): Future<Error, AliasName> =>
  AliasName.parse(raw).either(
    (msg) => Future.reject<Error, AliasName>(new Error(msg)),
    (name) => Future.resolve<Error, AliasName>(name)
  );

class AliasCommand {
  private constructor(
    private readonly action: AliasAction,
    private readonly initial: readonly Alias[]
  ) {}

  /** Unlike ModelCommand, this needs no config — aliases work before `commit setup` has ever run. */
  static create(action: AliasAction): Future<Error, AliasCommand> {
    // index.ts exits without printing create rejections, so load failures must log here.
    return loadAliases()
      .map((aliases) => new AliasCommand(action, aliases))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  run(): Future<Error, void> {
    // index.ts exits without printing a rejection, so every user-facing error goes through here.
    return this.dispatch().mapRej((e) => {
      p.log.error(color.red(e.message));
      return e;
    });
  }

  private dispatch(): Future<Error, void> {
    if (process.platform === "win32") {
      return Future.reject(new Error("`commit alias` is not supported on Windows yet — it writes POSIX shell shims."));
    }

    // Bound to a const so the narrowing survives into the callbacks below.
    const action = this.action;

    switch (action.type) {
      case "list":
        return Future.resolve(this.renderTable(this.initial));
      case "add":
        return parseName(action.name)
          .chain((name) => this.createAlias(this.initial, name, action.target))
          .map(() => undefined);
      case "remove":
        return parseName(action.name)
          .chain((name) => this.deleteAlias(this.initial, name))
          .map(() => undefined);
      case "hub":
        return reconcileShims(this.initial).chain(() => {
          p.intro(color.bgCyan(color.black(" Aliases ")));
          return this.hub(this.initial).map(() => p.outro(color.green("Done!")));
        });
      default:
        return absurd(action, "AliasAction");
    }
  }

  /** The registry is threaded through the loop rather than read from `this`, so the table never goes stale. */
  private hub(aliases: readonly Alias[]): Future<Error, void> {
    this.renderTable(aliases);

    return Future.attemptP(async () => {
      const choice = await p.select({
        message: "What next?",
        options: [
          { value: "create" as const, label: "Create alias" },
          { value: "delete" as const, label: "Delete alias", disabled: aliases.length === 0 },
          { value: "done" as const, label: "Done" }
        ],
        initialValue: "create" as const
      });

      if (p.isCancel(choice)) throw cancelled();
      return choice;
    }).chain((choice) => {
      switch (choice) {
        case "create":
          return this.createAlias(aliases).chain((next) => this.hub(next));
        case "delete":
          return this.deleteAlias(aliases).chain((next) => this.hub(next));
        case "done":
          return Future.resolve(undefined);
        default:
          return absurd(choice, "HubChoice");
      }
    });
  }

  private createAlias(aliases: readonly Alias[], presetName?: AliasName, presetTarget?: AliasTarget): Future<Error, readonly Alias[]> {
    return this.resolveNewAlias(presetName, presetTarget)
      .chain((alias) =>
        addAlias(aliases, alias).either(
          (msg) => Future.reject<Error, readonly Alias[]>(new Error(msg)),
          (next) =>
            writeShim(alias)
              .chain(() => saveAliases(next))
              .map(() => next)
        )
      )
      .chain((next) => this.reportCreated(next).map(() => next));
  }

  private resolveNewAlias(presetName?: AliasName, presetTarget?: AliasTarget): Future<Error, Alias> {
    const name =
      presetName ?
        Future.resolve<Error, AliasName>(presetName)
      : Future.attemptP(async () => {
          const raw = await p.text({
            message: "Alias name:",
            placeholder: "cb",
            validate: (value) =>
              AliasName.parse(value ?? "").either(
                (msg) => msg,
                () => undefined
              )
          });
          if (p.isCancel(raw)) throw cancelled();
          return raw;
        }).chain(parseName);

    const target = (chosen?: AliasTarget): Future<Error, AliasTarget> =>
      chosen ?
        Future.resolve<Error, AliasTarget>(chosen)
      : Future.attemptP(async () => {
          const value = await p.select({
            message: "Runs which command?",
            options: ALIAS_TARGETS.map((t) => ({ value: t, label: `commit ${t}`, hint: describeTarget(t) })),
            initialValue: "generate" as const
          });
          if (p.isCancel(value)) throw cancelled();
          return value;
        });

    return name.chain((n) => this.confirmShadowing(n).map(() => n)).chain((n) => target(presetTarget).map((t): Alias => ({ name: n, target: t })));
  }

  /** The bin dir is prepended to PATH, so a name that already resolves elsewhere would be shadowed. */
  private confirmShadowing(name: AliasName): Future<Error, void> {
    return findConflictingBinary(name).chain((conflict) => {
      if (!(conflict instanceof Just)) return Future.resolve(undefined);

      if (!process.stdout.isTTY) {
        p.log.warn(color.yellow(`'${name.value}' already exists at ${conflict.value} — the alias will shadow it.`));
        return Future.resolve(undefined);
      }

      return Future.attemptP(async () => {
        const ok = await p.confirm({ message: `'${name.value}' already exists at ${conflict.value}. Shadow it?`, initialValue: false });
        if (p.isCancel(ok) || !ok) throw cancelled();
      });
    });
  }

  private reportCreated(aliases: readonly Alias[]): Future<Error, void> {
    const created = aliases[aliases.length - 1];
    if (!created) return Future.resolve(undefined);

    p.log.success(`Created ${color.cyan(created.name.value)} -> ${color.dim(`commit ${created.target}`)} (${shimPath(created.name)})`);
    return isBinDirOnPath() ? Future.resolve(undefined) : this.offerPathSetup();
  }

  private offerPathSetup(): Future<Error, void> {
    const profile = detectProfile();

    if (!(profile instanceof Just) || !process.stdout.isTTY) {
      const shell = profile instanceof Just ? profile.value.shell : "bash";
      p.note(pathExportLine(shell), `Add ${aliasBinDir()} to your PATH`);
      return Future.resolve(undefined);
    }

    const { file, shell } = profile.value;

    return Future.attemptP(async () => {
      const ok = await p.confirm({ message: `Add ${aliasBinDir()} to your PATH in ${file}?`, initialValue: true });
      return !p.isCancel(ok) && ok;
    }).chain((ok) => {
      if (!ok) {
        p.note(pathExportLine(shell), `Add ${aliasBinDir()} to your PATH`);
        return Future.resolve(undefined);
      }

      return ensureBinDirOnPath(profile.value).map((outcome) => {
        if (outcome === "added") p.note(`source ${file}`, "Run this to use the alias in this shell");
      });
    });
  }

  private deleteAlias(aliases: readonly Alias[], preset?: AliasName): Future<Error, readonly Alias[]> {
    // Only the interactive picker needs something to pick from. A named delete must still
    // reach `removeAlias`, so an unknown name fails instead of reporting a silent success.
    if (aliases.length === 0 && !preset) {
      p.log.info("No custom aliases to delete.");
      return Future.resolve(aliases);
    }

    return this.resolveNameToDelete(aliases, preset).chain((name) =>
      removeAlias(aliases, name).either(
        (msg) => Future.reject<Error, readonly Alias[]>(new Error(msg)),
        (next) =>
          removeShim(name)
            .chain(() => saveAliases(next))
            .map(() => {
              p.log.success(`Deleted ${color.cyan(name.value)}`);
              return next;
            })
      )
    );
  }

  private resolveNameToDelete(aliases: readonly Alias[], preset?: AliasName): Future<Error, AliasName> {
    if (preset) return Future.resolve(preset);

    return Future.attemptP(async () => {
      const value = await p.select({
        message: "Delete which alias?",
        options: aliases.map((a) => ({ value: a.name.value, label: a.name.value, hint: `commit ${a.target}` }))
      });
      if (p.isCancel(value)) throw cancelled();

      const confirmed = await p.confirm({ message: `Delete '${value}'?`, initialValue: false });
      if (p.isCancel(confirmed) || !confirmed) throw cancelled();

      return value;
    }).chain(parseName);
  }

  private renderTable(aliases: readonly Alias[]): void {
    const table = new Table({
      head: [color.cyan("Alias"), color.cyan("Runs"), color.cyan("Source")],
      colWidths: [16, 24, 12]
    });

    for (const alias of aliases) {
      table.push([alias.name.value, `commit ${alias.target}`, color.green("custom")]);
    }
    table.push(["commit", "commit generate", color.gray("built-in")]);

    process.stdout.write("\n" + table.toString() + "\n\n");
  }
}
