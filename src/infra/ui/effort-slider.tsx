export { EffortSlider, type EffortSliderProps };

import * as React from "react";

import { Box, Text, useInput, useApp, type Key } from "ink";

import chalk from "chalk";

type ChalkColor = "yellow" | "green" | "cyan" | "blueBright" | "magenta" | "red" | "gray";

type EffortSliderProps<V extends string> = {
  title: string;
  options: readonly V[];
  initialIndex: number;
  onSubmit: (value: V) => void;
  onCancel: () => void;
};

const PALETTE: Record<number, readonly ChalkColor[]> = {
  2: ["yellow", "red"],
  3: ["yellow", "green", "red"],
  4: ["yellow", "green", "magenta", "red"],
  5: ["yellow", "green", "cyan", "magenta", "red"],
  6: ["yellow", "green", "cyan", "blueBright", "magenta", "red"]
};

const paletteFor = (n: number): readonly ChalkColor[] => PALETTE[n] ?? PALETTE[6]!;

const colorize = (color: ChalkColor, text: string, bold: boolean): string =>
  bold ? chalk[color].bold(text) : chalk[color](text);

const EffortSlider = <V extends string>({ title, options, initialIndex, onSubmit, onCancel }: EffortSliderProps<V>) => {
  const { exit } = useApp();
  const clamped = Math.max(0, Math.min(options.length - 1, initialIndex));
  const [index, setIndex] = React.useState(clamped);

  const handleLifecycle = (key: Key): boolean => {
    if (key.escape) {
      onCancel();
      exit();
      return true;
    }
    if (key.return) {
      onSubmit(options[index]!);
      exit();
      return true;
    }
    return false;
  };

  const handleNavigation = (key: Key): boolean => {
    if (key.leftArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return true;
    }
    if (key.rightArrow) {
      setIndex((i) => Math.min(options.length - 1, i + 1));
      return true;
    }
    return false;
  };

  useInput((_input, key) => {
    if (handleLifecycle(key)) return;
    handleNavigation(key);
  });

  const cols = Math.min(72, Math.max(40, (process.stdout.columns ?? 72) - 8));
  const palette = paletteFor(options.length);
  const lastIndex = options.length - 1;
  const step = lastIndex > 0 ? Math.floor((cols - 1) / lastIndex) : 0;
  const markerCol = index * step;
  const markerColor = palette[index] ?? "cyan";

  const railChars = Array.from({ length: cols }).map((_, c) =>
    c === markerCol ? chalk[markerColor]("▲") : chalk.dim("─")
  );
  const rail = railChars.join("");

  const labelParts: string[] = options.map((opt, i) => {
    const color = palette[i] ?? "gray";
    return i === index ? colorize(color, opt, true) : chalk.gray(opt);
  });
  const labelWidth = (cols - options.join("").length) / Math.max(1, options.length - 1);
  const labels = labelParts.join(" ".repeat(Math.max(1, Math.floor(labelWidth))));

  const spacerLen = Math.max(1, cols - "Speed".length - "Intelligence".length);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">◆ </Text>
        <Text>{title}</Text>
      </Box>
      <Box>
        <Text color="gray">│</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <Text color="gray">Speed</Text>
        <Text>{" ".repeat(spacerLen)}</Text>
        <Text color="gray">Intelligence</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <Text>{rail}</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <Text>{labels}</Text>
      </Box>
      <Box>
        <Text color="gray">│</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <Text color="gray">Use ◀ ▶ to adjust • Enter to confirm • Esc to cancel</Text>
      </Box>
    </Box>
  );
};
