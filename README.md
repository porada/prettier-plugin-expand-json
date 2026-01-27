[![](https://img.shields.io/npm/v/prettier-plugin-expand-json)](https://www.npmjs.com/package/prettier-plugin-expand-json)
[![](https://img.shields.io/github/actions/workflow/status/porada/prettier-plugin-expand-json/test.yaml)](https://github.com/porada/prettier-plugin-expand-json/actions/workflows/test.yaml)
[![](https://img.shields.io/codecov/c/github/porada/prettier-plugin-expand-json)](https://codecov.io/github/porada/prettier-plugin-expand-json)

# prettier-plugin-expand-json

Expand JSON arrays and objects into multi-line notation with Prettier—for JSON and JSONC files.

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

## Related

- [**@standard-config/prettier**](https://github.com/standard-config/prettier)
- [**prettier-plugin-yaml**](https://github.com/porada/prettier-plugin-yaml)

## License

MIT © [Dom Porada](https://dom.engineering)
