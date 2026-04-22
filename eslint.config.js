import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "dist/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_|^e$" }],
      "no-undef": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["content.js"],
    languageOptions: {
      globals: {
        RailsDecryptor: "readonly",
      },
    },
  },
  {
    files: ["decrypt.js"],
    languageOptions: {
      globals: {
        module: "readonly",
      },
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
