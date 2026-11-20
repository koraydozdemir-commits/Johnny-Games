export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", location: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly", innerWidth: "readonly", innerHeight: "readonly", devicePixelRatio: "readonly",
        matchMedia: "readonly", performance: "readonly", console: "readonly", URL: "readonly", URLSearchParams: "readonly", Blob: "readonly",
        Audio: "readonly", btoa: "readonly", DataView: "readonly", AudioContext: "readonly", webkitAudioContext: "readonly", Image: "readonly", Uint8Array: "readonly", Float32Array: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
    },
  },
];
