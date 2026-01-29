<p align="center">
    <a href="https://github.com/porada/prettier-plugin-expand-json">
        <picture>
            <source srcset="assets/prettier-plugin-expand-json@3x.png" media="(prefers-color-scheme: light)" />
            <img src="assets/prettier-plugin-expand-json@3x.png" width="520" alt="" />
        </picture>
    </a>
</p>

<h1 align="center">
    prettier-plugin-expand-json
</h1>

<p align="center">
    Expand JSON arrays and objects into multi&#8209;line&nbsp;format with&nbsp;Prettier.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/prettier-plugin-expand-json"><img src="https://img.shields.io/npm/v/prettier-plugin-expand-json" alt="" /></a>
    <a href="https://github.com/porada/prettier-plugin-expand-json/actions/workflows/test.yaml"><img src="https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-expand-json/test.yaml" alt="" /></a>
    <a href="https://codecov.io/github/porada/prettier-plugin-expand-json"><img src="https://img.shields.io/codecov/c/github/porada/prettier-plugin-expand-json" alt="" /></a>
</p>

<div>&nbsp;</div>

## Overview

This plugin expands all JSON arrays and objects into a consistent multi-line format. It works with both JSON and JSONC files.

It also supports files that Prettier treats as special cases, including `package.json`, `composer.json`, and others.

## Example

<!-- prettier-ignore-start -->

```json
{
    "extends": "@standard-config/tsconfig",
    "compilerOptions": { "exactOptionalPropertyTypes": true },
    "files": ["src/index.ts", "src/index.d.ts"]
}
```

<!-- prettier-ignore-end -->

…will always be formatted as:

```json
{
    "extends": "@standard-config/tsconfig",
    "compilerOptions": {
        "exactOptionalPropertyTypes": true
    },
    "files": [
        "src/index.ts",
        "src/index.d.ts"
    ]
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

If you’re using any other JSON plugins, make sure `prettier-plugin-expand-json` is listed last. This applies to each `overrides` entry as well.

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
    "overrides": [
        {
            "files": "**/package.json",
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

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-yaml**](https://github.com/porada/prettier-plugin-yaml)

## License

MIT © [Dom Porada](https://dom.engineering)
