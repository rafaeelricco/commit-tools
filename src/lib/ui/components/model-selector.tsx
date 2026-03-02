export { ModelSelector, type Model, type ModelSelectorProps };

import * as React from "react";

import { Box, Text, useInput, useApp } from "ink";

import chalk from "chalk";

type Model = {
  id: string;
  description: string;
};

type ModelSelectorProps = {
  models: Model[];
  onSelect: (modelId: string) => void;
  onCancel: () => void;
};

function fuzzyMatch(pattern: string, target: string): boolean {
  const p = pattern.toLowerCase();
  const t = target.toLowerCase();
  let pi = 0;
  let ti = 0;

  while (pi < p.length && ti < t.length) {
    if (p[pi] === t[ti]) pi++;
    ti++;
  }

  return pi === p.length;
}

function deleteWordLeft(value: string, cursor: number): [string, number] {
  let i = cursor - 1;
  while (i > 0 && value[i - 1] === " ") i--;
  while (i > 0 && value[i - 1] !== " ") i--;
  return [value.slice(0, i) + value.slice(cursor), i];
}

function wordBoundaryLeft(value: string, cursor: number): number {
  let i = cursor - 1;
  while (i > 0 && value[i - 1] === " ") i--;
  while (i > 0 && value[i - 1] !== " ") i--;
  return i;
}

function wordBoundaryRight(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && value[i] === " ") i++;
  while (i < value.length && value[i] !== " ") i++;
  return i;
}

const ModelSelector = ({ models, onSelect, onCancel }: ModelSelectorProps) => {
  const { exit } = useApp();
  const [query, setQuery] = React.useState("");
  const [cursorOffset, setCursorOffset] = React.useState(0);
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const filteredModels = models.filter((m) => {
    const q = query.trim();
    if (!q) return true;
    return fuzzyMatch(q, m.id) || (m.description && fuzzyMatch(q, m.description));
  });

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      exit();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filteredModels.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      const selectedModel = filteredModels[selectedIndex];
      if (selectedModel) {
        onSelect(selectedModel.id);
      } else {
        onCancel();
      }
      exit();
      return;
    }

    // Option+Delete or Ctrl+W — delete word left
    if ((key.meta && key.backspace) || (key.ctrl && input === "w")) {
      const [next, pos] = deleteWordLeft(query, cursorOffset);
      setQuery(next);
      setCursorOffset(Math.max(0, pos));
      return;
    }

    // Ctrl+U — delete to start of line
    if (key.ctrl && input === "u") {
      setQuery(query.slice(cursorOffset));
      setCursorOffset(0);
      return;
    }

    // Option+Left/Right — move cursor by word
    if (key.meta && key.leftArrow) {
      setCursorOffset(Math.max(0, wordBoundaryLeft(query, cursorOffset)));
      return;
    }
    if (key.meta && key.rightArrow) {
      setCursorOffset(Math.min(query.length, wordBoundaryRight(query, cursorOffset)));
      return;
    }

    // Left/Right arrow - move cursor 1 char
    if (key.leftArrow) {
      setCursorOffset((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset((prev) => Math.min(query.length, prev + 1));
      return;
    }

    // Regular backspace — delete one char
    if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        setQuery(query.slice(0, cursorOffset - 1) + query.slice(cursorOffset));
        setCursorOffset((prev) => Math.max(0, prev - 1));
      }
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setQuery(query.slice(0, cursorOffset) + input + query.slice(cursorOffset));
      setCursorOffset((prev) => prev + input.length);
    }
  });

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const windowSize = 5;
  const startIndex = Math.max(0, Math.min(selectedIndex - 2, filteredModels.length - windowSize));
  const visibleModels = filteredModels.slice(startIndex, startIndex + windowSize);

  let renderedQuery = "";
  for (let i = 0; i < query.length; i++) {
    if (i === cursorOffset) {
      renderedQuery += chalk.inverse(query[i]);
    } else {
      renderedQuery += query[i];
    }
  }
  if (cursorOffset === query.length) {
    renderedQuery += chalk.inverse(" ");
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">│</Text>
      </Box>
      <Box>
        <Text color="cyan">◇ </Text>
        <Text>Search and select model</Text>
      </Box>

      <Box>
        <Text color="gray">│ </Text>
        <Text color="cyan">{"> "}</Text>
        {query.length === 0 ?
          <Text color="gray">{chalk.inverse(" ")} type to search</Text>
        : <Text>{renderedQuery}</Text>}
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={1}>
          {Array.from({ length: Math.max(1, visibleModels.length) + 2 }).map((_, i) => (
            <Text key={i} color="gray">
              │
            </Text>
          ))}
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={0} paddingY={0} flexDirection="column" width={64}>
          {visibleModels.length === 0 ?
            <Box>
              <Text color="red"> No models found.</Text>
            </Box>
          : visibleModels.map((model) => {
              const globalIdx = filteredModels.indexOf(model);
              const isSelected = globalIdx === selectedIndex;

              return (
                <Box key={model.id}>
                  <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? " ● " : " ○ "}</Text>
                  {isSelected ?
                    <Text color="cyan">{model.id}</Text>
                  : <Text>{model.id}</Text>}
                </Box>
              );
            })
          }
        </Box>
      </Box>

      <Box>
        <Text color="gray">│</Text>
      </Box>
    </Box>
  );
};
