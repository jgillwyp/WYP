import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The native Android project (Capacitor, 2026-10-16) — Java/Gradle, not
    // JS/TS, and its own build/ output under android/app/build/ ships a
    // copy of Capacitor's bundled native-bridge.js runtime that this
    // config's own "build/**" rule above doesn't reach (that only matches
    // a top-level build/ directory, not a nested one).
    "android/**",
  ]),
]);

export default eslintConfig;
