/**
 * Vitest setup.
 *
 * Vitest runs modules in a `vm` context, where the loader's `new Function`
 * dynamic import has no import callback and would fail even though the runtime
 * loads perfectly well in the real CommonJS build. Injecting Vite's own
 * dynamic import makes the tests exercise the genuine WASM grammars.
 */
import { setDynamicImporter } from '../src/parser/languages/treeSitterLoader';

setDynamicImporter((specifier) => import(/* @vite-ignore */ specifier));