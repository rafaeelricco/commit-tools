export { ModelSelector, type Model, type ModelSelectorProps };

import * as React from "react";

import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";

type Model = {
  id: string;
  description: string;
};

type ModelSelectorProps = {
  models: Model[];
  onSelect: (modelId: string) => void;
  onCancel: () => void;
};

const ModelSelector = ({ models, onSelect, onCancel }: ModelSelectorProps) => {
  const { exit } = useApp();
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const filteredModels = models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()));

  useInput((_, key) => {
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
  });

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const windowSize = 5;
  const startIndex = Math.max(0, Math.min(selectedIndex - 2, filteredModels.length - windowSize));
  const visibleModels = filteredModels.slice(startIndex, startIndex + windowSize);

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
        <TextInput value={query} onChange={setQuery} placeholder="type to search" />
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
