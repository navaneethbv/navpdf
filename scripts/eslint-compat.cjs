// TypeScript 7.0 removes the legacy programmatic compiler JavaScript API.
// This compatibility shim allows typescript-eslint to access the TypeScript 6.0 API
// via @typescript/typescript6 when linting side-by-side with TypeScript 7.0.
const Module = require("node:module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "typescript") {
    return originalRequire.call(this, "@typescript/typescript6");
  }
  return originalRequire.apply(this, arguments);
};
