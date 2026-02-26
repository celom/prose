## 0.1.1 (2026-02-26)

### 🩹 Fixes

- retain outputMapper in FlowBuilder steps for consistent state handling ([2042b38](https://github.com/celom/flume/commit/2042b38))
- update repository URL format in package.json ([3037775](https://github.com/celom/flume/commit/3037775))
- change package.json private field to false ([a8b7460](https://github.com/celom/flume/commit/a8b7460))
- update repository URL format in package.json and add release workflow ([889995a](https://github.com/celom/flume/commit/889995a))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.0 (2026-02-25)

### 🚀 Features

- update package.json files to include repository information and enhance metadata ([d9a9e9b](https://github.com/celom/flume/commit/d9a9e9b))
- **docs:** Add comprehensive documentation for Flume core concepts, examples, and guides ([47fbc93](https://github.com/celom/flume/commit/47fbc93))
- implement AbortSignal support for cooperative cancellation in flow execution ([11cf776](https://github.com/celom/flume/commit/11cf776))
- remove composeFlows function in favor of new pipe chain. ([a30fecb](https://github.com/celom/flume/commit/a30fecb))
- add .pipe() method to FlowBuilder for reusable sub-flows and implement tests for its functionality ([be46068](https://github.com/celom/flume/commit/be46068))
- extend FlowBuilder and FlowDefinition to support break outputs ([fb5473d](https://github.com/celom/flume/commit/fb5473d))
- add type inference smoke test for FlowBuilder's cons-list internals ([fc50f9e](https://github.com/celom/flume/commit/fc50f9e))

### 🩹 Fixes

- **ci:** update commands to use bunx for consistency in CI workflow ([3cefd8e](https://github.com/celom/flume/commit/3cefd8e))
- remove unused BreakStepDefinition import in flow-builder and adjust break step handling in flow-executor ([b3ef39d](https://github.com/celom/flume/commit/b3ef39d))
- update transaction method to require name parameter in FlowBuilder ([792ec14](https://github.com/celom/flume/commit/792ec14))

### ❤️ Thank You

- Carlos Mimoso