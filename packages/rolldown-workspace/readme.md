# Rolldown Workspace

Utility library marrying Rolldown with Yarn Workspaces with declarative and
reusable config blocks inspired by Gradle.

## Getting Started

First, create a `build-logic` workspace in your monorepo. This alone creates a
powerful setup for sharing dependencies and build configs without the need to
re-define anything twice. The general structure looks similar to this:

```txt
my-monorepo
├─ build-logic
│  ├─ build.js              the global build command
│  ├─ package.json          defines Rolldown and plugin versions
│  ├─ plugins.js            plugin imports and default configs
│  └─ targets.js            common build targets used by individual packages
│
├─ packages
│  ├─ package-1
│  │  ├─ build.config.js    defines which targets to build with optional overrides
│  │  ├─ package.json       defines build-logic dev dependency
│  │  └─ ...
│  │
│  ├─ package-2
│  │  ├─ build.config.js    defines which targets to build with optional overrides
│  │  ├─ package.json       defines build-logic dev dependency
│  │  └─ ...
│  │
│  └─ ...
│
└─ package.json             defines workspaces
```

The monorepo root `package.json` only needs to define workspaces and optionally
a dev dependency on `build-logic` if you'd like to have the build command
available throughout all workspaces.

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
`package.json` file. It should define your plugins and targets exports, the
global build command and dev dependencies on rolldown itself and all plugins
you're using. E.g.:

```json
{
  "name": "build-logic",
  "private": true,
  "exports": {
    "./plugins": {
      "import": "./plugins.js"
    },
    "./targets": {
      "import": "./targets.js"
    }
  },
  "bin": {
    "build": "./build.js"
  },
  "devDependencies": {
    "@calmdown/rolldown-workspace": "1.0.0",
    "rolldown": "1.0.0-rc.3",
    "rolldown-plugin-dts": "0.22.1"
  }
}
```

Then, define the plugins you will be using in `plugins.js`. To avoid importing
plugins that are only used by some targets, dynamic imports are typically used.
E.g.:

```js
import { definePlugin } from "@calmdown/rolldown-workspace";

export const Declarations = definePlugin(
  "Declarations",
  async () => (await import("rolldown-plugin-dts")).dts,
);
```

Then, define common build targets in `targets.mjs`. E.g.:

```js
import { defineTarget, Env, inEnv } from "@calmdown/rolldown-workspace";

import * as Plugin from "./plugins.mjs";

export const TypeScriptLibrary = defineTarget("TypeScriptLibrary", target => target
  .configure({
    external: [ "lodash" ],
    tsconfig: "./tsconfig.json",
  })
  .pipeline("Code", pipe => pipe
    .plugin(Plugin.Declarations
      .enable(inEnv(Env.Production))
    )
    .output("Main", out => out
      .configure((prev, context) => ({
        ...prev,
        cleanDir: true,
        minify: isEnv(context, Env.Production),
      }))
    )
  )
);

// ...
```

Finally add the build command script in `build.mjs`. The build function comes
with sensible defaults out of the box, however it is recommended to set at least
the `jail` directory to constrain all lookups to stay within the monorepo.

```js
import * as path from "node:path";

import { build } from "@calmdown/rolldown-workspace";

const jail = path.join(import.meta.dirname, "../..");
await build({ jail });
```

### Other Packages

With this setup, any package that needs a Rolldown build can now do so simply by
adding a dev dependency on `build-logic` and adding a `build.config.mjs` script:

```json
{
  "name": "package-1",
  "devDependencies": {
    "build-logic": "workspace:*"
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
`yarn build`, it will execute the configured Rolldown build. Additionally, if
your package defines dependencies on other workspace packages, they will be
built first as long as they define their own build configs.
