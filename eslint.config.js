import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "**/*.d.ts"] },
  {
    files: ["index.ts", "src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { sonarjs },
    rules: {
      "sonarjs/cognitive-complexity": ["error", 15]
    }
  }
);
