export { ModelSelector, type Model, type ModelSelectorProps };

import React, { useState, useEffect } from "react";
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
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredModels = models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()));

  // Handle keyboard navigation
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

  // Reset selection index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Display only a window of models (e.g., 5 at a time)
  const windowSize = 5;
  const startIndex = Math.max(0, Math.min(selectedIndex - 2, filteredModels.length - windowSize));
  const visibleModels = filteredModels.slice(startIndex, startIndex + windowSize);

  return (
    <Box flexDirection="column" paddingBottom={1} paddingTop={1}>
      {/* Search Box */}
      <Box borderStyle="round" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text color="gray">⌕ </Text>
        <TextInput value={query} onChange={setQuery} placeholder="Search models..." />
      </Box>

      {/* Model List */}
      {visibleModels.length === 0 ?
        <Text color="red"> No models found.</Text>
      : visibleModels.map((model, idx) => {
          const globalIdx = startIndex + idx;
          const isSelected = globalIdx === selectedIndex;
          return (
            <Box key={model.id} flexDirection="column" paddingLeft={1} marginBottom={1}>
              <Text bold={isSelected}>
                <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "> ◯ " : "  ◯ "}</Text>
                {model.id}
              </Text>
              <Box paddingLeft={4}>
                <Text color="gray" dimColor>
                  {model.description}
                </Text>
              </Box>
            </Box>
          );
        })
      }

      {/* Footer Instructions */}
      <Box marginTop={1} paddingLeft={1}>
        <Text color="gray" dimColor>
          type to search · ↑/↓ to navigate · Enter to select · Esc to cancel
        </Text>
      </Box>
    </Box>
  );
};
