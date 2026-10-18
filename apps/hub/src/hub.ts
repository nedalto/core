import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";

import type { Environment } from "@nedalto/config/environment.ts";
import type { Lifecycle } from "@nedalto/contract/common/lifecycle.ts";
import type { Config } from "@nedalto/contract/config/schemas.ts";
import type { Logger } from "@nedalto/contract/logger/ports.ts";
import { createSqliteDatabase } from "@nedalto/database/database.ts";
import { createRotatingLogFile } from "@nedalto/logger/log-file.ts";
import { createLogger } from "@nedalto/logger/logger.ts";
import { createMatterController } from "@nedalto/matter/matter.ts";
import { createHttpServer } from "@nedalto/server/server.ts";

import { createSyncEventBus } from "./bus.ts";

/** The hub: builds the components, starts them in dependency order and stops them in reverse. */
export class Hub implements Lifecycle {
    readonly #environment: Environment;
    readonly #config: Config;
    // Kept apart from the services, so that they close after everything else has logged.
    readonly #logFiles: Lifecycle[] = [];
    readonly #services: Lifecycle[] = [];
    #logger: Logger | undefined;

    constructor(environment: Environment, config: Config) {
        this.#environment = environment;
        this.#config = config;
    }

    async start(): Promise<void> {
        try {
            await this.#boot();
        } catch (error) {
            this.#logger?.error("failed to start", error);
            await this.#shutdown();
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.#logger?.notice("stopping");
        await this.#shutdown();
    }

    // The repositories and gateways exist only between `start()` and `stop()` of their owner, so
    // each component is built once the ones it reads from are running.
    async #boot(): Promise<void> {
        const { storagePath, logPath, authToken } = this.#environment;
        const { server: serverConfig, logger: loggerConfig, matter: matterConfig } = this.#config;

        await mkdir(storagePath, { recursive: true });

        // rotating-file-stream 3.2.10 creates the missing directories of the file it opens.
        const hubLog = await this.#launch(
            this.#logFiles,
            createRotatingLogFile(join(logPath, "hub.log"), loggerConfig),
        );
        const matterLog = await this.#launch(
            this.#logFiles,
            createRotatingLogFile(join(logPath, "matter", "hub.log"), loggerConfig),
        );
        const logger = createLogger(hubLog.stream, loggerConfig.level, "Hub");
        this.#logger = logger;

        const database = await this.#launch(this.#services, createSqliteDatabase(join(storagePath, "hub.db"), logger));
        const bus = createSyncEventBus(logger);
        const matter = await this.#launch(
            this.#services,
            createMatterController(
                join(storagePath, "matter"),
                {
                    logger,
                    stream: matterLog.stream,
                    nodeRepository: database.node,
                    endpointRepository: database.endpoint,
                    bus,
                },
                { ...matterConfig, logLevel: loggerConfig.level },
            ),
        );
        await this.#launch(
            this.#services,
            createHttpServer(
                {
                    logger,
                    nodeRepository: database.node,
                    endpointRepository: database.endpoint,
                    roomRepository: database.room,
                    transactor: database.transactor,
                    nodeGateway: matter.node,
                    endpointGateway: matter.endpoint,
                    bus,
                },
                { ...serverConfig, authToken },
            ),
        );

        logger.notice("ready");
    }

    async #launch<T extends Lifecycle>(started: Lifecycle[], component: T): Promise<T> {
        await component.start();
        started.push(component);
        return component;
    }

    // In reverse, and the log files last, so that everything else can log while it stops.
    async #shutdown(): Promise<void> {
        await this.#stopEach(this.#services);
        this.#logger?.notice("stopped");
        await this.#stopEach(this.#logFiles);
        this.#logger = undefined;
    }

    async #stopEach(started: Lifecycle[]): Promise<void> {
        for (const component of started.splice(0).toReversed()) {
            try {
                // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time: the order is the point
                await component.stop();
            } catch (error) {
                if (this.#logger === undefined) {
                    process.stderr.write(`nedalto: component failed to stop: ${inspect(error)}\n`);
                } else {
                    this.#logger.error("component failed to stop", error);
                }
            }
        }
    }
}

/** A `Hub` that runs with `environment` and `config`; nothing is created until `start()`. */
export const createHub = (environment: Environment, config: Config): Hub => new Hub(environment, config);
