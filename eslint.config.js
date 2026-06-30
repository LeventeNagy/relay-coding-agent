import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["out/**", "node_modules/**", "public/**", "*.config.*", "scripts/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Renderer console use is warned; main-process logging is allowed below.
      "no-console": "warn",
      // The CJK regex (tokens.ts) and a zero-width-space template (ChatView) use
      // intentional non-ASCII whitespace; still catch stray whitespace in code.
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }
      ],
      // Allow deliberate escape hatches, but keep them visible.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ]
    }
  },
  {
    // Structured logging lands in Phase 2; until then main-process console
    // output is intentional operational logging, not a smell.
    files: ["src/main/**", "src/mastra/**"],
    rules: { "no-console": "off" }
  }
);
