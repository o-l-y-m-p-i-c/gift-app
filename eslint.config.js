import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/**", "node_modules/**", "public/build/**", ".cache/**"] },
  {
    files: ["app/**/*.{ts,tsx}", "tests/**/*.ts", "*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Admin API responses are untyped GraphQL JSON.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Storefront scripts served as-is by the theme app extension.
    files: ["extensions/**/assets/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "script", globals: globals.browser },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
);
