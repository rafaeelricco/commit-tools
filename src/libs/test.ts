/*
    A sane, simple testing framework, which seems to be lacking in Node.js land.

    Instead of having a complicated test setup which finds and compiles files,
    we do the simplest obvious thing: A function that takes a list of tests.
    To run the tests execute a node.js program that calls the `run` function.

    It's self-explanatory. Use it like this:

        import { run, test, group, expect } from "@test/test";

        run([
          group("trivial tests", [
            test("referential equality", () => expect.equals(1,3))
            test("structural equality", () => expect.json_equals({}, {})),
            test("async test", async () => {
              const n = await fetchNumberFromTheInternet();
              expect.equals(1, n);
            })
          ])
        ]);

    If you want to have test in different files, just import them like you would
    in a normal program.

        import { run } from "@test/test";
        import * as unit "@test/unitTests";
        import * as integration "@test/integrationTests";

        run([
          unit.tests,
          integration.tests
        ])

*/
import { object } from '@optique/core/constructs';
import { multiple } from '@optique/core/modifiers';
import { option } from '@optique/core/primitives';
import { runSync } from '@optique/run';
import { message } from '@optique/core/message';
import type { ValueParser, ValueParserResult } from '@optique/core/valueparser';
import { randomUUID } from 'node:crypto';

export { run, expect, group, test, parseArgs, type RunOptions };

class Test {
  public readonly id: string;
  constructor(
    public readonly name: string,
    public readonly fun: () => void | Promise<void>
  ) {
    this.id = randomUUID();
  }
}

class Group {
  constructor(
    public readonly name: string,
    public readonly entries: Array<Group | Test>
  ) {}
}

const test = (x: string, y: () => void | Promise<void>) => new Test(x, y);
const group = (x: string, y: Array<Group | Test>) => new Group(x, y);

type RunOptions = {
  filters: ReadonlyArray<RegExp>;
};

type FailureReason = string;

type Failure = {
  readonly path: string;
  readonly reason: FailureReason;
  readonly duration: Millis;
};

type Millis = number;

type ResultTree =
  | { readonly type: 'node'; name: string; children: Array<ResultTree> }
  | {
      readonly type: 'leaf';
      name: string;
      duration: Millis;
      failure: string | null;
    };

type TestState =
  | { readonly type: 'not-started' }
  | { readonly type: 'started'; start: number }
  | {
      readonly type: 'finished';
      start: number;
      end: number;
      failure: string | null;
    };

type TestInfo = {
  readonly fullName: string;
  readonly order: number;
  readonly state: TestState;
};

const INDENT = '  ';
const USE_COLORS = process.stdout.isTTY;
const PROGRESS_UPDATE_INTERVAL = 500;

function red(txt: string): string {
  return USE_COLORS ? `\x1b[31m${txt}\x1b[0m` : txt;
}

function green(txt: string): string {
  return USE_COLORS ? `\x1b[32m${txt}\x1b[0m` : txt;
}

function gray(txt: string): string {
  return USE_COLORS ? `\x1b[90m${txt}\x1b[0m` : txt;
}

function italic(txt: string): string {
  return USE_COLORS ? `\x1b[3m${txt}\x1b[0m` : txt;
}

function yellow(txt: string): string {
  return USE_COLORS ? `\x1b[33m${txt}\x1b[0m` : txt;
}

function collectTestInfos(
  group: Group,
  parentPath: ReadonlyArray<string>,
  startOrder: number
): { infos: ReadonlyMap<string, TestInfo>; nextOrder: number } {
  const currentPath = [...parentPath, group.name];

  let currentOrder = startOrder;
  const allInfos = new Map<string, TestInfo>();

  for (const entry of group.entries) {
    if (entry instanceof Test) {
      const fullName = currentPath.concat(entry.name).join(' / ');
      allInfos.set(entry.id, {
        fullName,
        order: currentOrder,
        state: { type: 'not-started' },
      });
      currentOrder++;
    } else if (entry instanceof Group) {
      const result = collectTestInfos(entry, currentPath, currentOrder);
      for (const [key, value] of result.infos) {
        allInfos.set(key, value);
      }
      currentOrder = result.nextOrder;
    }
  }

  return { infos: allInfos, nextOrder: currentOrder };
}

function buildProgressDisplay(
  executionInfos: ReadonlyMap<string, TestInfo>
): ReadonlyArray<string> {
  const total = executionInfos.size;

  const stats = Array.from(executionInfos.values()).reduce(
    (acc, info) => {
      if (info.state.type === 'finished') {
        return {
          ...acc,
          completed: acc.completed + 1,
          successes:
            info.state.failure === null ? acc.successes + 1 : acc.successes,
          failures:
            info.state.failure !== null ? acc.failures + 1 : acc.failures,
        };
      } else if (info.state.type === 'started') {
        const elapsed = Date.now() - info.state.start;
        return {
          ...acc,
          running: [
            ...acc.running,
            {
              name: info.fullName,
              duration: prettyTime(elapsed),
              startTime: info.state.start,
            },
          ],
        };
      }
      return acc;
    },
    {
      completed: 0,
      successes: 0,
      failures: 0,
      running: [] as Array<{
        name: string;
        duration: string;
        startTime: number;
      }>,
    }
  );

  const recentRunning = stats.running
    .sort((a, b) => a.startTime - b.startTime)
    .slice(-6);

  return [
    gray(
      `Running ${stats.completed}/${total} ... (${green(`✓ ${stats.successes}`)} / ${red(`✗ ${stats.failures}`)})`
    ),
    ...recentRunning.map(
      ({ name, duration }) => `  ${name} - ${gray(duration)}`
    ),
  ];
}

function startProgressDisplay(executionInfos: ReadonlyMap<string, TestInfo>): {
  stop: () => void;
  clear: () => void;
} {
  let lastHeight = 0;
  let stopped = false;

  const render = () => {
    if (stopped) return;

    const lines = buildProgressDisplay(executionInfos);

    if (lastHeight > 0) {
      process.stdout.write(`\x1b[${lastHeight}A`);
    }

    for (const line of lines) {
      process.stdout.write('\r');
      process.stdout.write('\x1b[2K');
      process.stdout.write(line);
      process.stdout.write('\n');
    }

    if (lines.length < lastHeight) {
      const extraLines = lastHeight - lines.length;
      for (let i = 0; i < extraLines; i++) {
        process.stdout.write('\r\x1b[2K\n');
      }
      process.stdout.write(`\x1b[${extraLines}A`);
    }

    lastHeight = lines.length;
  };

  render();

  const interval = setInterval(render, PROGRESS_UPDATE_INTERVAL);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
    clear: () => {
      if (lastHeight > 0) {
        process.stdout.write(`\x1b[${lastHeight}A`);
        process.stdout.write('\x1b[0J');
        lastHeight = 0;
      }
    },
  };
}

// Run a test suite.
// This should be the entry point of a test program.
async function run(options: RunOptions, groups: Array<Group>): Promise<void> {
  const filters = options.filters || [];
  const selectedGroups = filterGroups(groups, filters);

  if (filters.length > 0 && selectedGroups.length === 0) {
    console.log('No tests matched the provided filters.');
    process.exit(0);
  }

  const collectedData = selectedGroups.reduce(
    (acc, group) => {
      const result = collectTestInfos(group, [], acc.nextOrder);
      const mergedMap = new Map([...acc.infos, ...result.infos]);
      return { infos: mergedMap, nextOrder: result.nextOrder };
    },
    { infos: new Map<string, TestInfo>(), nextOrder: 0 }
  );

  const executionInfos = collectedData.infos;
  const totalTests = executionInfos.size;

  const before = Date.now();
  const progressDisplay = startProgressDisplay(executionInfos);

  const results = await Promise.all(
    selectedGroups.map((group) => runGroup(group, executionInfos))
  );

  progressDisplay.stop();
  progressDisplay.clear();

  process.stdout.write(`\r\x1b[K`);

  const after = Date.now();

  logResults(results);
  const failures = getFailures(results);
  const failed = failures.length > 0;

  console.log('');
  if (!failed) {
    console.log(green('✓ Success'));
  } else {
    console.log('\nFailures:\n');
    failures.forEach(logFailure);
    console.log(red('✗ Failed'));
  }

  console.log(
    `Tests:    ${totalTests - failures.length} passed, ${totalTests} total`
  );
  console.log(`Duration: ${prettyTime(after - before)}`);
  process.exit(failed ? 1 : 0);
}

function filterGroups(
  groups: Array<Group>,
  filters: ReadonlyArray<RegExp>
): Array<Group> {
  if (filters.length === 0) {
    return groups;
  }

  return groups.flatMap((group) => {
    const filtered = filterGroup(group, filters, []);
    return filtered ? [filtered] : [];
  });
}

function logResults(results: Array<ResultTree>): void {
  function showLeaf(
    lvl: number,
    name: string,
    duration: Millis,
    failure: string | null
  ) {
    const color = failure === null ? green : red;
    const symbol = failure === null ? '✓' : '✗';
    console.log(
      `${INDENT.repeat(lvl)}${color(symbol)} ${name} ${gray(`(${prettyTime(duration)})`)}`
    );
  }

  function showNode(lvl: number, name: string, children: Array<ResultTree>) {
    console.log(`${INDENT.repeat(lvl)}${italic(yellow(name))}`);
    showTrees(lvl + 1, children);
  }

  function showTrees(lvl: number, trees: Array<ResultTree>) {
    trees.forEach((tree) => {
      if (tree.type === 'node') {
        showNode(lvl, tree.name, tree.children);
      } else {
        showLeaf(lvl, tree.name, tree.duration, tree.failure);
      }
    });
  }

  showTrees(0, results);
}

function getFailures(
  results: ReadonlyArray<ResultTree>
): ReadonlyArray<Failure> {
  function fromOne(
    path: string,
    duration: Millis,
    reason: FailureReason | null
  ): ReadonlyArray<Failure> {
    return reason === null ? [] : [{ path, reason, duration }];
  }

  function fromMany(
    path: string,
    rs: ReadonlyArray<ResultTree>
  ): ReadonlyArray<Failure> {
    return rs.flatMap((r) => {
      const rpath = `${path}${path ? ' / ' : ''}${r.name}`;
      return r.type === 'node'
        ? fromMany(rpath, r.children)
        : fromOne(rpath, r.duration, r.failure);
    });
  }

  return fromMany('', results);
}

function prettyTime(ms: number): string {
  const second = 1000;
  const seconds = ms / second;

  return `${seconds}s`;
}

function indented(str: string): string {
  return INDENT + str.split('\n').join(`\n${INDENT}`);
}

function logFailure({ path, reason, duration }: Failure): void {
  console.log(red(`- ${path}`));
  console.log(indented(`Duration: ${prettyTime(duration)}`));
  console.log(indented(reason));
  console.log();
}

function filterGroup(
  group: Group,
  filters: ReadonlyArray<RegExp>,
  parents: Array<string>
): Group | null {
  const currentPath = joinPath([...parents, group.name]);
  if (matchesAnyFilter(filters, currentPath)) {
    return group;
  }

  const matchedEntries: Array<Group | Test> = [];
  const pathSegments = [...parents, group.name];

  for (const entry of group.entries) {
    if (entry instanceof Group) {
      const filteredChild = filterGroup(entry, filters, pathSegments);
      if (filteredChild !== null) {
        matchedEntries.push(filteredChild);
      }
      continue;
    }

    if (matchesAnyFilter(filters, joinPath([...pathSegments, entry.name]))) {
      matchedEntries.push(entry);
    }
  }

  if (matchedEntries.length === 0) {
    return null;
  }

  return new Group(group.name, matchedEntries);
}

function matchesAnyFilter(
  filters: ReadonlyArray<RegExp>,
  path: string
): boolean {
  return filters.some((filter) => filter.test(path));
}

function joinPath(parts: Array<string>): string {
  return parts.join(' / ');
}

async function runGroup(
  group: Group,
  executionInfos: Map<string, TestInfo>
): Promise<ResultTree> {
  const children = await Promise.all(
    group.entries.map((entry) => {
      if (entry instanceof Test) {
        return runTest(entry, executionInfos);
      } else {
        return runGroup(entry, executionInfos);
      }
    })
  );

  return {
    type: 'node',
    name: group.name,
    children,
  };
}

async function runTest(
  test: Test,
  executionInfos: Map<string, TestInfo>
): Promise<ResultTree> {
  const info = executionInfos.get(test.id);
  const start = Date.now();

  if (info) {
    executionInfos.set(test.id, {
      ...info,
      state: { type: 'started', start },
    });
  }

  const failure = await execute(test);
  const end = Date.now();

  if (info) {
    executionInfos.set(test.id, {
      ...info,
      state: { type: 'finished', start, end, failure },
    });
  }

  return {
    type: 'leaf',
    name: test.name,
    failure,
    duration: end - start,
  };
}

async function execute(test: Test): Promise<string | null> {
  try {
    const r = test.fun();
    if (r instanceof Promise) {
      await r;
    }

    return null;
  } catch (e) {
    const err = e as Error;
    return err.stack ? err.stack : err.message;
  }
}

// Expectations

class ExpectationFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectationFailure';
  }
}

const expect = {
  fail: function fail(reason: string): void {
    throw new ExpectationFailure(reason);
  },

  equals: function equals<T>(a: T, b: T): void {
    if (a === b) {
      return;
    }
    throw new ExpectationFailure(`expected ${a} to equal ${b}`);
  },

  deep_equals: function equals<T>(ra: T, rb: T): void {
    const a = stringify(ra);
    const b = stringify(rb);
    if (a === b) {
      return;
    }
    throw new ExpectationFailure(`expected '${a}' to equal '${b}'`);
  },

  greater_than: function greater_than<T>(a: T, b: T): void {
    if (a > b) {
      return;
    }
    throw new ExpectationFailure(`expected ${a} to be greater than ${b}`);
  },

  not_equals: function not_equals<T>(a: T, b: T): void {
    if (a !== b) {
      return;
    }
    throw new ExpectationFailure(`expected ${a} to not equal ${b}`);
  },

  json_equals: function json_equals<T>(a: T, b: T): void {
    const j_a = JSON.stringify(a);
    const j_b = JSON.stringify(b);
    if (j_a == j_b) {
      return;
    }
    throw new ExpectationFailure(`expected ${j_a} to equal ${j_b}`);
  },

  contains: function contains(needle: string, haystack: string) {
    if (haystack.includes(needle)) {
      return;
    }
    throw new ExpectationFailure(
      `expected '${haystack}' to contain '${needle}'`
    );
  },

  throws: function (f: () => unknown, g: (e: Error) => void) {
    try {
      f();
    } catch (e) {
      g(e as Error);
      return;
    }
    throw new ExpectationFailure('did not throw');
  },
};

function stringify(v: any) {
  const str = JSON.stringify(v);
  if (str.startsWith('Object') || str.startsWith('[Function')) {
    throw new Error('Value is not meaningfully stringifiable');
  }
  return str;
}

function extractPattern(input: string): { pattern: string; flags: string } {
  if (input.startsWith('/') && input.lastIndexOf('/') > 0) {
    const lastSlash = input.lastIndexOf('/');
    const pattern = input.slice(1, lastSlash);
    const flags = input.slice(lastSlash + 1);
    return { pattern, flags };
  }

  return { pattern: input, flags: '' };
}

const regex: ValueParser<'sync', RegExp> = {
  $mode: 'sync',
  metavar: 'REGEX',

  parse(input: string): ValueParserResult<RegExp> {
    try {
      const { pattern, flags } = extractPattern(input);
      return { success: true, value: new RegExp(pattern, flags) };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message`Invalid regular expression ${input}: ${reason}`,
      };
    }
  },

  format(value: RegExp): string {
    return value.toString();
  },
};

const cliParser = object({
  matches: multiple(option('-m', '--match', regex)),
});

function parseArgs(argv: Array<string> = process.argv.slice(2)): RunOptions {
  const config = runSync(cliParser, {
    args: argv,
    programName: 'backend-tests',
  });

  return {
    filters: config.matches,
  };
}
