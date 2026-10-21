// Imported first by device.ts, because the SDK reads its configuration when its modules are first
// evaluated. It does for this process what packages/matter/src/sdk-config.ts does for the hub, except the
// storage driver, which is the hub's choice.
//
// `@matter/nodejs` is not a declared dependency, as in packages/matter: `@matter/main` 0.17.9 requires it as
// an exact optional dependency, so there is one copy. `@matter/main` is not declared here either: it comes
// from packages/matter, so the repository holds one copy, at the version the controller is built with.
import { config } from "@matter/nodejs/config";

config.loadProcessEnv = false;
config.loadProcessArgv = false;
config.loadConfigFile = false;
config.trapProcessSignals = false;
