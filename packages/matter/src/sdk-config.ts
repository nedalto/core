// Every module that imports `@matter/*` imports this one first, because the SDK reads its configuration
// when its modules are first evaluated. It holds only this import and these assignments, so that sorting
// imports cannot move an SDK import ahead of them.
//
// `@matter/nodejs` is not a declared dependency: `@matter/main` 0.17.9 requires it as an exact optional
// dependency, so there is one copy. With a second one this file would configure a module the SDK does not
// read; the `sdk-config` test that reads the storage driver back fails if that ever happens.
import { config } from "@matter/nodejs/config";

// The configuration of the hub is the only one: no MATTER_* variables, command-line flags or config file.
config.loadProcessEnv = false;
config.loadProcessArgv = false;
config.loadConfigFile = false;

// @matter/nodejs 0.17.9: the default environment copies this into its `storage.driver` variable when it is
// created, which is after this file runs.
config.storageDriver = "sqlite";

// @matter/nodejs 0.17.9: the SDK's process manager would handle SIGINT and SIGTERM by interrupting the SDK
// on its own, but the hub stops it in order from its own handlers.
config.trapProcessSignals = false;
