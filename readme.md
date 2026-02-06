# Rollup Workspace

Utility library marrying Rollup with Yarn Workspaces with declarative and
reusable config blocks inspired by Gradle.

## Getting Started

First, create a `build-logic` workspace in your monorepo. This creates a
powerful setup for sharing dependencies and build configs without the need to
re-declare anything twice. The general structure looks similar to this:

```txt
my-monorepo
├─ build-logic
│  ├─ build.mjs             the global build command
│  ├─ package.json          declares rollup and plugin versions
│  ├─ rollup-plugins.mjs    plugin imports and default configs
│  └─ rollup-targets.mjs    common build targets used by individual packages
│
├─ packages
│  ├─ package-1
│  │  ├─ build.config.mjs   declares which targets to build with optional overrides
│  │  ├─ package.json       declares build-logic dev dependency
│  │  └─ ...
│  │
│  ├─ package-2
│  │  ├─ build.config.mjs   declares which targets to build with optional overrides
│  │  ├─ package.json       declares build-logic dev dependency
│  │  └─ ...
│  │
│  └─ ...
│
└─ package.json             declares workspaces
```

The monorepo root `package.json` only needs to declare workspaces and optionally
a dev dependency on `build-logic` if you'd like to have the build command
available throughout the entire monorepo.

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "build-logic",
    "packages/*"
  ],
  "devDependencies": {
    "build-logic": "workspace:*"
  }
}
```

### The build-logic Package

The `build-logic` package will contain most of the meat. First, create the
`package.json` file. It should declare your plugins and targets exports, the
global build command and dev dependencies for all things Rollup you're using.

```json
{
  "name": "build-logic",
  "private": true,
  "exports": {
    "./plugins": {
      "import": "./rollup-plugins.mjs"
    },
    "./targets": {
      "import": "./rollup-targets.mjs"
    }
  },
  "bin": {
    "build": "./build.mjs"
  },
  "devDependencies": {
    "@calmdown/rollup-monorepo": "1.0.0",
    "@rollup/plugin-node-resolve": "16.0.3",
    "@rollup/plugin-terser": "0.4.4",
    "rollup": "4.57.1"
  }
}
```

Then declare imports of the plugins you will be using in `rollup-plugins.mjs`.
To avoid importing plugins that are only used by some targets, dynamic imports
are typically used.

```js
import { declarePlugin } from "@calmdown/rollup-monorepo";

export const NodeResolve = declarePlugin(
  "NodeResolve",
  async () => (await import("@rollup/plugin-node-resolve")).default,
);

export const Terser = declarePlugin(
  "Terser",
  async () => (await import("@rollup/plugin-terser")).default,
);

// ...
```

Then define build targets commonly used by individual packages in
`rollup-targets.mjs`.

```js
import { declareTarget, inEnv } from "@calmdown/rollup-monorepo";

import * as Plugin from "./rollup-plugins.mjs";

export const JavaScriptLibrary = declareTarget("JavaScriptLibrary", target => target
  .pipeline("Code", pipe => pipe
      .plugin(Plugin.NodeResolve)
      .plugin(Plugin.Terser
          .enable(inEnv("prod"))
          .configure({
              format: {
                  comments: false,
              },
          }))
      .output("Main", out => out
          .configure({
              format: "es",
              entryFileNames: "[name].js",
              sourcemap: true,
          }))
  )
);
```

Finally add the build command script in `build.mjs`. It is recommended to set a
jail directory to constrain all lookups to within the monorepo directory.

```js
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "@calmdown/rollup-monorepo";

await build({
  // jail to the monorepo root directory
  jail: join(dirname(fileURLToPath(import.meta.url)), ".."),
});
```

### Other Packages

With this setup, any package that needs a Rollup build can now do so simply by
adding a dev dependency on `build-logic` and adding a `build.config.mjs` script:

```json
{
  "name": "package-1",
  // ...
  "devDependencies": {
    "build-logic": "workspace:*",
    // ...
  }
}
```

```js
import * as Target from "build-logic/targets";

Target.JavaScriptLibrary.build(target => {
  target.entry("app", "./src/index.js");

  // here you can override individual configurations, add or disable plugins, etc.
  // all without affecting other packages even if they use the same target
  target.pipelines.Code.plugins.Terser.disable();
});
```

Now when you navigate to the `./packages/package-1` directory and run
`yarn build`, it will execute the configured Rollup build. Additionally, if your
package declares dependencies on other workspace packages, they will be built
first as long as they declare their own build configs.
