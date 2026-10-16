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
    // The native Android/iOS projects (Capacitor, 2026-10-16) — Java/
    // Gradle and Swift/Xcode respectively, not JS/TS. Both ship a copy of
    // Capacitor's own bundled native-bridge.js runtime once built
    // (android/app/build/.../native-bridge.js, ios/App/App/public/...)
    // that this config's own top-level "build/**" rule doesn't reach.
    "android/**",
    "ios/**",
  ]),
]);

export default eslintConfig;
