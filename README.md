[![](https://img.shields.io/npm/v/prettier-plugin-expand-json)](https://www.npmjs.com/package/prettier-plugin-expand-json)

# prettier-plugin-expand-json

Prettier plugin that expands all JSON arrays and objects into multi-line notation. Works with both JSON and JSONC files.

```diff
@@ -1,6 +1,12 @@
 {
     "extends": "@standard-config/tsconfig",
-    "compilerOptions": { "exactOptionalPropertyTypes": true },
+    "compilerOptions": {
+        "exactOptionalPropertyTypes": true
+    },
-    "include": ["**/*"],
+    "include": [
+        "**/*"
+    ],
-    "exclude": ["node_modules"]
+    "exclude": [
+        "node_modules"
+    ]
 }
```

## Install

```sh
npm install --save-dev prettier-plugin-expand-json
```

```sh
pnpm add --save-dev prettier-plugin-expand-json
```

## Usage

Reference `prettier-plugin-expand-json` in your [Prettier config](https://prettier.io/docs/configuration):

```json
{
    "plugins": [
        "prettier-plugin-expand-json"
    ]
}
```

If you’re using multiple JSON-related plugins, make sure `prettier-plugin-expand-json` is listed last. This applies to each `overrides` entry as well.

```json
{
    "plugins": [
        "prettier-plugin-sort-json",
        "prettier-plugin-expand-json"
    ]
}
```

```json
{
    "plugins": [
        "prettier-plugin-expand-json"
    ],
    "overrides": [
        {
            "files": "packages/**/package.json",
            "options": {
                "plugins": [
                    "prettier-plugin-pkg",
                    "prettier-plugin-expand-json"
                ]
            }
        }
    ]
}
```

## Recommended

Try [**@standard-config/prettier**](https://github.com/standard-config/prettier) if you’re looking for a consistent, TypeScript-first Prettier config. It comes with this plugin pre-configured.
