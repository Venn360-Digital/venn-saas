var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/@cloudflare/containers/dist/lib/helpers.js
function generateId(length = 9) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}
__name(generateId, "generateId");
function parseTimeExpression(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  }
  if (typeof timeExpression === "string") {
    const match = timeExpression.match(/^(\d+)([smh])$/);
    if (!match) {
      throw new Error(`invalid time expression ${timeExpression}`);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      default:
        throw new Error(`unknown time unit ${unit}`);
    }
  }
  throw new Error(`invalid type for a time expression: ${typeof timeExpression}`);
}
__name(parseTimeExpression, "parseTimeExpression");

// node_modules/@cloudflare/containers/dist/lib/container.js
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
var NO_CONTAINER_INSTANCE_ERROR = "there is no container instance that can be provided to this durable object";
var RATE_LIMITED_ERROR = "you are requesting too many containers per second";
var RUNTIME_SIGNALLED_ERROR = "runtime signalled the container to exit:";
var UNEXPECTED_EXIT_ERROR = "container exited with unexpected exit code:";
var NOT_LISTENING_ERROR = "the container is not listening";
var CONTAINER_STATE_KEY = "__CF_CONTAINER_STATE";
var OUTBOUND_CONFIGURATION_KEY = "OUTBOUND_CONFIGURATION";
var MAX_ALARM_RETRIES = 3;
var PING_TIMEOUT_MS = 5e3;
var DEFAULT_SLEEP_AFTER = "10m";
var INSTANCE_POLL_INTERVAL_MS = 300;
var TIMEOUT_TO_GET_CONTAINER_MS = 8e3;
var TIMEOUT_TO_GET_PORTS_MS = 2e4;
var FALLBACK_PORT_TO_CHECK = 33;
var outboundHandlersRegistry = /* @__PURE__ */ new Map();
var defaultOutboundHandlerNameRegistry = /* @__PURE__ */ new Map();
var outboundByHostRegistry = /* @__PURE__ */ new Map();
var signalToNumbers = {
  SIGINT: 2,
  SIGTERM: 15,
  SIGKILL: 9
};
function isErrorOfType(e, matchingString) {
  const errorString = e instanceof Error ? e.message : String(e);
  return errorString.toLowerCase().includes(matchingString);
}
__name(isErrorOfType, "isErrorOfType");
var isNoInstanceError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NO_CONTAINER_INSTANCE_ERROR), "isNoInstanceError");
var isRateLimitedError = /* @__PURE__ */ __name((error) => isErrorOfType(error, RATE_LIMITED_ERROR), "isRateLimitedError");
var isRuntimeSignalledError = /* @__PURE__ */ __name((error) => isErrorOfType(error, RUNTIME_SIGNALLED_ERROR), "isRuntimeSignalledError");
var isNotListeningError = /* @__PURE__ */ __name((error) => isErrorOfType(error, NOT_LISTENING_ERROR), "isNotListeningError");
var isContainerExitNonZeroError = /* @__PURE__ */ __name((error) => isErrorOfType(error, UNEXPECTED_EXIT_ERROR), "isContainerExitNonZeroError");
function getExitCodeFromError(error) {
  if (!(error instanceof Error)) {
    return null;
  }
  if (isRuntimeSignalledError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(RUNTIME_SIGNALLED_ERROR) + RUNTIME_SIGNALLED_ERROR.length + 1);
  }
  if (isContainerExitNonZeroError(error)) {
    return +error.message.toLowerCase().slice(error.message.toLowerCase().indexOf(UNEXPECTED_EXIT_ERROR) + UNEXPECTED_EXIT_ERROR.length + 1);
  }
  return null;
}
__name(getExitCodeFromError, "getExitCodeFromError");
function addTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  if (existingSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }
  existingSignal?.addEventListener("abort", () => controller.abort());
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller.signal;
}
__name(addTimeoutSignal, "addTimeoutSignal");
var ContainerState = class {
  static {
    __name(this, "ContainerState");
  }
  storage;
  status;
  constructor(storage) {
    this.storage = storage;
  }
  async setRunning() {
    await this.setStatusAndupdate("running");
  }
  async setHealthy() {
    await this.setStatusAndupdate("healthy");
  }
  async setStopping() {
    await this.setStatusAndupdate("stopping");
  }
  async setStopped() {
    await this.setStatusAndupdate("stopped");
  }
  async setStoppedIfUnchanged(previousState) {
    if (this.status !== previousState) {
      return;
    }
    await this.setStopped();
  }
  async setStoppedWithCode(exitCode) {
    this.status = { status: "stopped_with_code", lastChange: Date.now(), exitCode };
    await this.update();
  }
  async getState() {
    if (!this.status) {
      const state = await this.storage.get(CONTAINER_STATE_KEY);
      if (!state) {
        this.status = {
          status: "stopped",
          lastChange: Date.now()
        };
        await this.update();
      } else {
        this.status = state;
      }
    }
    return this.status;
  }
  async setStatusAndupdate(status) {
    this.status = { status, lastChange: Date.now() };
    await this.update();
  }
  async update() {
    if (!this.status)
      throw new Error("status should be init");
    await this.storage.put(CONTAINER_STATE_KEY, this.status);
  }
};
var Container = class extends DurableObject {
  static {
    __name(this, "Container");
  }
  static get outboundByHost() {
    return outboundByHostRegistry.get(this.name);
  }
  static set outboundByHost(handlers) {
    outboundByHostRegistry.set(this.name, handlers);
  }
  static get outboundHandlers() {
    return outboundHandlersRegistry.get(this.name);
  }
  static set outboundHandlers(handlers) {
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, ...handlers });
  }
  static get outbound() {
    const handlerName = defaultOutboundHandlerNameRegistry.get(this.name);
    if (!handlerName)
      return void 0;
    return outboundHandlersRegistry.get(this.name)?.[handlerName];
  }
  static set outbound(handler) {
    const key = "__outbound__";
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, [key]: handler });
    defaultOutboundHandlerNameRegistry.set(this.name, key);
  }
  static get outboundProxies() {
    return this.outboundHandlers;
  }
  static set outboundProxies(handlers) {
    this.outboundHandlers = handlers;
  }
  static get outboundProxy() {
    return this.outbound;
  }
  static set outboundProxy(handler) {
    this.outbound = handler;
  }
  // =========================
  //     Public Attributes
  // =========================
  // Default port for the container (undefined means no default port)
  defaultPort;
  // Required ports that should be checked for availability during container startup
  // Override this in your subclass to specify ports that must be ready
  requiredPorts;
  // Timeout after which the container will sleep if no activity
  // The signal sent to the container by default is a SIGTERM.
  // The container won't get a SIGKILL if this threshold is triggered.
  sleepAfter = DEFAULT_SLEEP_AFTER;
  // Container configuration properties
  // Set these properties directly in your container instance
  envVars = {};
  entrypoint;
  enableInternet = true;
  labels = {};
  // When true, outbound HTTPS traffic from the container will be intercepted.
  // The container must trust /etc/cloudflare/certs/cloudflare-containers-ca.crt
  interceptHttps = false;
  // Hosts that are allowed to access the internet, even when enableInternet is false.
  // Useful for allowing specific domains on a per-host basis.
  allowedHosts;
  // Hosts that are denied internet access, even when enableInternet is true.
  // Also blocks hosts from being handled by the catch-all outbound handler.
  deniedHosts;
  // pingEndpoint is the host and path value that the class will use to send a request to the container and check if the
  // instance is ready.
  //
  // The user does not have to implement this route by any means,
  // but it's still useful if you want to control the path that
  // the Container class uses to send HTTP requests to.
  pingEndpoint = "ping";
  applyOutboundInterceptionPromise = Promise.resolve();
  usingInterception = false;
  // =========================
  //     PUBLIC INTERFACE
  // =========================
  constructor(ctx, env, options) {
    super(ctx, env);
    if (ctx.container === void 0) {
      throw new Error("Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration");
    }
    this.state = new ContainerState(this.ctx.storage);
    const persistedOutboundConfiguration = this.restoreOutboundConfiguration();
    this.ctx.blockConcurrencyWhile(async () => {
      await this.scheduleNextAlarm();
      this.renewActivityTimeout();
      const ctor = this.constructor;
      if (persistedOutboundConfiguration !== void 0 || ctor.outboundByHost !== void 0 || ctor.outbound !== void 0 || ctor.outboundHandlers !== void 0 || this.effectiveAllowedHosts !== void 0 || this.effectiveDeniedHosts !== void 0) {
        this.usingInterception = true;
      }
      if (this.container.running) {
        this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
      }
    });
    this.container = ctx.container;
    if (options) {
      if (options.defaultPort !== void 0)
        this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== void 0)
        this.sleepAfter = options.sleepAfter;
      if (options.envVars !== void 0)
        this.envVars = options.envVars;
      if (options.entrypoint !== void 0)
        this.entrypoint = options.entrypoint;
      if (options.enableInternet !== void 0)
        this.enableInternet = options.enableInternet;
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
    if (this.container.running) {
      this.monitor = this.container.monitor();
      this.setupMonitorCallbacks();
    }
  }
  /**
   * Gets the current state of the container
   * @returns Promise<State>
   */
  async getState() {
    return { ...await this.state.getState() };
  }
  // ====================================
  //     OUTBOUND INTERCEPTION CONFIG
  // ====================================
  /**
   * Set the catch-all outbound handler to a named method from `outboundHandlers`.
   * Overrides the default `outbound` at runtime via ContainerProxy props.
   *
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundHandler(methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundHandlerOverride = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Add or override a hostname-specific outbound handler at runtime,
   * referencing a named method from `outboundHandlers`.
   * Overrides any matching entry in `static outboundByHost` for this hostname.
   *
   * @param hostname - The hostname or ip:port to intercept (e.g. `'google.com'`)
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundByHost(hostname, methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundByHostOverrides[hostname] = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a runtime hostname override added via `setOutboundByHost`.
   * The default handler from `static outboundByHost` (if any) will be used again.
   *
   * @param hostname - The hostname or ip:port to stop overriding
   */
  async removeOutboundByHost(hostname) {
    delete this.outboundByHostOverrides[hostname];
    await this.refreshOutboundInterception();
  }
  /**
   * Replace all runtime hostname overrides at once.
   * Each value may be either a method name or an object with `method` and `params`.
   *
   * @param handlers - Record mapping hostnames to handler configs in `outboundHandlers`
   * @throws Error if any method name is not found in `outboundHandlers`
   */
  async setOutboundByHosts(handlers) {
    for (const handler of Object.values(handlers)) {
      const methodName = typeof handler === "string" ? handler : handler.method;
      this.validateOutboundHandlerMethodName(methodName);
    }
    this.outboundByHostOverrides = Object.fromEntries(Object.entries(handlers).map(([hostname, handler]) => [
      hostname,
      typeof handler === "string" ? { method: handler } : handler
    ]));
    await this.refreshOutboundInterception();
  }
  // ====================================
  //     ALLOWED / DENIED HOSTS CONFIG
  // ====================================
  /**
   * Replace all allowed hosts at runtime.
   * Allowed hosts get internet access even when `enableInternet` is false.
   *
   * @param hosts - Array of hostnames to allow (e.g. `['api.stripe.com', 'example.com']`)
   */
  async setAllowedHosts(hosts) {
    this.allowedHostsOverride = [...hosts];
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Replace all denied hosts at runtime.
   * Denied hosts are blocked unconditionally, even when `enableInternet` is true
   * or a catch-all outbound handler is set.
   *
   * @param hosts - Array of hostnames to deny (e.g. `['evil.com', 'blocked.org']`)
   */
  async setDeniedHosts(hosts) {
    this.deniedHostsOverride = [...hosts];
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Add a single hostname to the allowed hosts list at runtime.
   *
   * @param hostname - The hostname to allow (e.g. `'api.stripe.com'`)
   */
  async allowHost(hostname) {
    const effective = this.effectiveAllowedHosts ?? [];
    if (!effective.includes(hostname)) {
      this.allowedHostsOverride = [...effective, hostname];
    }
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Add a single hostname to the denied hosts list at runtime.
   *
   * @param hostname - The hostname to deny (e.g. `'evil.com'`)
   */
  async denyHost(hostname) {
    const effective = this.effectiveDeniedHosts ?? [];
    if (!effective.includes(hostname)) {
      this.deniedHostsOverride = [...effective, hostname];
    }
    this.usingInterception = true;
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a hostname from the allowed hosts list.
   *
   * @param hostname - The hostname to remove from the allow list
   */
  async removeAllowedHost(hostname) {
    this.allowedHostsOverride = (this.effectiveAllowedHosts ?? []).filter((h) => h !== hostname);
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a hostname from the denied hosts list.
   *
   * @param hostname - The hostname to remove from the deny list
   */
  async removeDeniedHost(hostname) {
    this.deniedHostsOverride = (this.effectiveDeniedHosts ?? []).filter((h) => h !== hostname);
    await this.refreshOutboundInterception();
  }
  // ==========================
  //     CONTAINER STARTING
  // ==========================
  /**
   * Start the container if it's not running and set up monitoring and lifecycle hooks,
   * without waiting for ports to be ready.
   *
   * It will automatically retry if the container fails to start, using the specified waitOptions
   *
   *
   * @example
   * await this.start({
   *   envVars: { DEBUG: 'true', NODE_ENV: 'development' },
   *   entrypoint: ['npm', 'run', 'dev'],
   *   enableInternet: false,
   *   labels: { tenant: 'acme', env: 'prod' },
   * });
   *
   * @param startOptions - Override `envVars`, `entrypoint`, `enableInternet` and `labels` on a per-instance basis
   * @param waitOptions - Optional wait configuration with abort signal for cancellation. Default ~8s timeout.
   * @returns A promise that resolves when the container start command has been issued
   * @throws Error if no container context is available or if all start attempts fail
   */
  async start(startOptions, waitOptions) {
    const portToCheck = waitOptions?.portToCheck ?? this.defaultPort ?? (this.requiredPorts ? this.requiredPorts[0] : FALLBACK_PORT_TO_CHECK);
    const pollInterval = waitOptions?.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    await this.startContainerIfNotRunning({
      signal: waitOptions?.signal,
      waitInterval: pollInterval,
      retries: waitOptions?.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval),
      portToCheck
    }, startOptions);
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.onStart();
    });
  }
  async startAndWaitForPorts(portsOrArgs, cancellationOptions, startOptions) {
    let ports;
    let resolvedCancellationOptions;
    let resolvedStartOptions;
    if (typeof portsOrArgs === "object" && portsOrArgs !== null && !Array.isArray(portsOrArgs)) {
      ports = portsOrArgs.ports;
      resolvedCancellationOptions = portsOrArgs.cancellationOptions;
      resolvedStartOptions = portsOrArgs.startOptions;
    } else {
      ports = portsOrArgs;
      resolvedCancellationOptions = cancellationOptions;
      resolvedStartOptions = startOptions;
    }
    const portsToCheck = await this.getPortsToCheck(ports);
    await this.syncPendingStoppedEvents();
    resolvedCancellationOptions ??= {};
    const containerGetTimeout = resolvedCancellationOptions.instanceGetTimeoutMS ?? TIMEOUT_TO_GET_CONTAINER_MS;
    const pollInterval = resolvedCancellationOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const containerGetRetries = Math.ceil(containerGetTimeout / pollInterval);
    const waitOptions = {
      signal: resolvedCancellationOptions.abort,
      retries: containerGetRetries,
      waitInterval: pollInterval,
      portToCheck: portsToCheck[0]
    };
    const triesUsed = await this.startContainerIfNotRunning(waitOptions, resolvedStartOptions);
    const totalPortReadyTries = Math.ceil((resolvedCancellationOptions.portReadyTimeoutMS ?? TIMEOUT_TO_GET_PORTS_MS) / pollInterval);
    let triesLeft = totalPortReadyTries - triesUsed;
    for (const port of portsToCheck) {
      triesLeft = await this.waitForPort({
        signal: resolvedCancellationOptions.abort,
        waitInterval: pollInterval,
        retries: triesLeft,
        portToCheck: port
      });
    }
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.state.setHealthy();
      await this.onStart();
    });
  }
  /**
   *
   * Waits for a specified port to be ready
   *
   * Returns the number of tries used to get the port, or throws if it couldn't get the port within the specified retry limits.
   *
   * @param waitOptions -
   * - `portToCheck`: The port number to check
   * - `abort`: Optional AbortSignal to cancel waiting
   * - `retries`: Number of retries before giving up (default: TRIES_TO_GET_PORTS)
   * - `waitInterval`: Interval between retries in milliseconds (default: INSTANCE_POLL_INTERVAL_MS)
   */
  async waitForPort(waitOptions) {
    const port = waitOptions.portToCheck;
    const tcpPort = this.container.getTcpPort(port);
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const tries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_PORTS_MS / pollInterval);
    for (let i = 0; i < tries; i++) {
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await tcpPort.fetch(`http://${this.pingEndpoint}`, { signal: combinedSignal });
        break;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        if (!this.container.running) {
          try {
            await this.onError(new Error(`Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?`));
          } catch {
          }
          throw e;
        }
        if (i === tries - 1) {
          try {
            await this.onError(`Failed to verify port ${port} is available after ${(i + 1) * pollInterval}ms, last error: ${errorMessage}`);
          } catch {
          }
          throw e;
        }
        await Promise.any([
          new Promise((resolve) => setTimeout(resolve, pollInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Container request aborted.", { cause: e });
        }
      }
    }
    return tries;
  }
  // =======================
  //     LIFECYCLE HOOKS
  // =======================
  /**
   * Send a signal to the container.
   * @param signal - The signal to send to the container (default: 15 for SIGTERM)
   */
  async stop(signal = "SIGTERM") {
    if (this.container.running) {
      this.container.signal(typeof signal === "string" ? signalToNumbers[signal] : signal);
    }
    await this.syncPendingStoppedEvents();
  }
  /**
   * Destroys the container with a SIGKILL. Triggers onStop.
   */
  async destroy() {
    await this.container.destroy();
  }
  /**
   * Lifecycle method called when container starts successfully
   * Override this method in subclasses to handle container start events
   */
  onStart() {
  }
  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle Container stopped events
   * @param params - Object containing exitCode and reason for the stop
   */
  onStop(params) {
    void params;
  }
  /**
   * Lifecycle method called when the container is running, and the activity timeout
   * expiration (set by `sleepAfter`) has been reached.
   *
   * If you want to shutdown the container, you should call this.stop() here
   *
   * By default, this method calls `this.stop()`
   */
  async onActivityExpired() {
    console.log("Activity expired, signalling container to stop");
    if (!this.container.running) {
      return;
    }
    await this.stop();
  }
  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   * @param error - The error that occurred
   * @returns Can return any value or throw the error
   */
  onError(error) {
    console.error("Container error:", error);
    throw error;
  }
  /**
   * Renew the container's activity timeout
   *
   * Call this method whenever there is activity on the container
   */
  renewActivityTimeout() {
    const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1e3;
    this.sleepAfterMs = Date.now() + timeoutInMs;
  }
  /**
   * Decrement the inflight request counter.
   * When the counter transitions to 0, renew the activity timeout so the
   * inactivity window starts fresh from the moment the last request completes.
   */
  decrementInflight() {
    this.inflightRequests = Math.max(0, this.inflightRequests - 1);
    if (this.inflightRequests === 0) {
      this.renewActivityTimeout();
    }
  }
  // ==================
  //     SCHEDULING
  // ==================
  /**
   * Schedule a task to be executed in the future.
   *
   * We strongly recommend using this instead of the `alarm` handler.
   *
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = generateId(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled"
      };
    }
    if (typeof when === "number") {
      const time = Math.floor(Date.now() / 1e3 + when);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        delayInSeconds: when,
        time,
        type: "delayed"
      };
    }
    throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
  }
  // ============
  //     HTTP
  // ============
  /**
   * Send a request to the container (HTTP or WebSocket) using standard fetch API signature
   *
   * This method handles HTTP requests to the container.
   *
   * WebSocket requests done outside the DO won't work until https://github.com/cloudflare/workerd/issues/2319 is addressed.
   * Until then, please use `switchPort` + `fetch()`.
   *
   * Method supports multiple signatures to match standard fetch API:
   * - containerFetch(request: Request, port?: number)
   * - containerFetch(url: string | URL, init?: RequestInit, port?: number)
   *
   * Starts the container if not already running, and waits for the target port to be ready.
   *
   * @returns A Response from the container
   */
  async containerFetch(requestOrUrl, portOrInit, portParam) {
    const { request, port } = this.requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam);
    const state = await this.state.getState();
    if (!this.container.running || state.status !== "healthy") {
      try {
        await this.startAndWaitForPorts(port, { abort: request.signal });
      } catch (e) {
        if (isNoInstanceError(e)) {
          return new Response("There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.", { status: 503 });
        }
        if (isRateLimitedError(e)) {
          return new Response(e instanceof Error ? e.message : String(e), { status: 429 });
        }
        return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, {
          status: 500
        });
      }
    }
    const tcpPort = this.container.getTcpPort(port);
    const containerUrl = request.url.replace("https:", "http:");
    this.inflightRequests++;
    try {
      this.renewActivityTimeout();
      const res = await tcpPort.fetch(containerUrl, request);
      if (res.webSocket !== null) {
        const containerWs = res.webSocket;
        const [client, server] = Object.values(new WebSocketPair());
        let settled = false;
        const settleInflight = /* @__PURE__ */ __name(() => {
          if (!settled) {
            settled = true;
            this.decrementInflight();
          }
        }, "settleInflight");
        containerWs.accept();
        server.accept();
        server.addEventListener("message", async (event) => {
          this.renewActivityTimeout();
          try {
            const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
            containerWs.send(data);
          } catch {
            server.close(1011, "Failed to forward message to container");
          }
        });
        containerWs.addEventListener("message", async (event) => {
          this.renewActivityTimeout();
          try {
            const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
            server.send(data);
          } catch {
            containerWs.close(1011, "Failed to forward message to client");
          }
        });
        server.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          containerWs.close(code, event.reason);
        });
        containerWs.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          server.close(code, event.reason);
        });
        server.addEventListener("error", () => {
          settleInflight();
          containerWs.close(1011, "Client WebSocket error");
        });
        containerWs.addEventListener("error", () => {
          settleInflight();
          server.close(1011, "Container WebSocket error");
        });
        return new Response(null, { status: res.status, webSocket: client, headers: res.headers });
      }
      if (res.body !== null) {
        const { readable, writable } = new IdentityTransformStream();
        res.body?.pipeTo(writable).finally(() => {
          this.decrementInflight();
        });
        return new Response(readable, res);
      }
      this.decrementInflight();
      return res;
    } catch (e) {
      this.decrementInflight();
      if (!(e instanceof Error)) {
        throw e;
      }
      if (e.message.includes("Network connection lost.")) {
        return new Response("Container suddenly disconnected, try again", { status: 500 });
      }
      console.error(`Error proxying request to container ${this.ctx.id}:`, e);
      return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  }
  /**
   *
   * Fetch handler on the Container class.
   * By default this forwards all requests to the container by calling `containerFetch`.
   * Use `switchPort` to specify which port on the container to target, or this will use `defaultPort`.
   * @param request The request to handle
   */
  async fetch(request) {
    if (this.defaultPort === void 0 && !request.headers.has("cf-container-target-port")) {
      throw new Error("No port configured for this container. Set the `defaultPort` in your Container subclass, or specify a port with `container.fetch(switchPort(request, port))`.");
    }
    let portValue = this.defaultPort;
    if (request.headers.has("cf-container-target-port")) {
      const portFromHeaders = parseInt(request.headers.get("cf-container-target-port") ?? "");
      if (isNaN(portFromHeaders)) {
        throw new Error("port value from switchPort is not a number");
      } else {
        portValue = portFromHeaders;
      }
    }
    return await this.containerFetch(request, portValue);
  }
  // ===============================
  // ===============================
  //     PRIVATE METHODS & ATTRS
  // ===============================
  // ===============================
  // ==========================
  //     PRIVATE ATTRIBUTES
  // ==========================
  container;
  // onStopCalled will be true when we are in the middle of an onStop call
  onStopCalled = false;
  state;
  monitor;
  // Coalesces concurrent calls to startContainerIfNotRunning so we never
  // call `this.container.start()` twice. Without this guard, two requests
  // racing the readiness path can both pass the `if (this.container.running)`
  // early-return (each yielding the DO input gate at storage awaits) and
  // both reach the synchronous workerd `start()`, causing the second to
  // throw "start() cannot be called on a container that is already running."
  // See https://github.com/cloudflare/containers/issues/173.
  startInFlight;
  monitoredPromise;
  sleepAfterMs = 0;
  inflightRequests = 0;
  // Outbound interception runtime overrides (passed through ContainerProxy props)
  outboundByHostOverrides = {};
  outboundHandlerOverride;
  // Only set when the user calls setAllowedHosts/setDeniedHosts at runtime
  allowedHostsOverride;
  deniedHostsOverride;
  // The runtime does not expose a way to remove outbound interceptions yet, so
  // once we promote an instance to intercept-all we must keep using it.
  hasInterceptAllRegistration = false;
  // ==========================
  //     GENERAL HELPERS
  // ==========================
  /**
   * Validates that a method name exists in the outboundHandlers registry for this class.
   * @throws Error if the method name is not found
   */
  validateOutboundHandlerMethodName(methodName) {
    const handlers = outboundHandlersRegistry.get(this.constructor.name);
    if (!handlers || !(methodName in handlers)) {
      throw new Error(`Outbound handler method '${methodName}' not found in outboundHandlers for ${this.constructor.name}`);
    }
  }
  get effectiveAllowedHosts() {
    return this.allowedHostsOverride ?? this.allowedHosts;
  }
  get effectiveDeniedHosts() {
    return this.deniedHostsOverride ?? this.deniedHosts;
  }
  getOutboundConfiguration() {
    return {
      outboundByHostOverrides: Object.keys(this.outboundByHostOverrides).length > 0 ? this.outboundByHostOverrides : void 0,
      outboundHandlerOverride: this.outboundHandlerOverride,
      allowedHosts: this.effectiveAllowedHosts,
      deniedHosts: this.effectiveDeniedHosts,
      hasInterceptAllRegistration: this.hasInterceptAllRegistration || void 0
    };
  }
  persistOutboundConfiguration(configuration) {
    this.ctx.storage.kv.put(OUTBOUND_CONFIGURATION_KEY, {
      ...configuration,
      allowedHosts: this.allowedHostsOverride,
      deniedHosts: this.deniedHostsOverride
    });
  }
  restoreOutboundConfiguration() {
    const configuration = this.ctx.storage.kv.get(OUTBOUND_CONFIGURATION_KEY);
    if (!configuration) {
      return void 0;
    }
    this.outboundHandlerOverride = void 0;
    if (configuration.outboundHandlerOverride !== void 0) {
      try {
        this.validateOutboundHandlerMethodName(configuration.outboundHandlerOverride.method);
        this.outboundHandlerOverride = configuration.outboundHandlerOverride;
      } catch (error) {
        console.warn("Ignoring invalid persisted outbound handler override:", error);
      }
    }
    this.outboundByHostOverrides = {};
    for (const [hostname, override] of Object.entries(configuration.outboundByHostOverrides ?? {})) {
      try {
        this.validateOutboundHandlerMethodName(override.method);
        this.outboundByHostOverrides[hostname] = override;
      } catch (error) {
        console.warn(`Ignoring invalid persisted outbound override for ${hostname}:`, error);
      }
    }
    this.hasInterceptAllRegistration = configuration.hasInterceptAllRegistration === true;
    if (configuration.allowedHosts) {
      this.allowedHostsOverride = configuration.allowedHosts;
    }
    if (configuration.deniedHosts) {
      this.deniedHostsOverride = configuration.deniedHosts;
    }
    return this.getOutboundConfiguration();
  }
  /**
   * Returns true if a catch-all outbound HTTP interception is needed.
   * This is the case when a static `outbound` handler or a runtime
   * `outboundHandlerOverride` (catch-all) is configured.
   * When false, we only intercept specific hosts to avoid overhead.
   */
  needsCatchAllInterception() {
    const ctor = this.constructor;
    return ctor.outbound !== void 0 || this.outboundHandlerOverride !== void 0;
  }
  hasMutableOutboundConfiguration() {
    return Object.keys(this.outboundByHostOverrides).length > 0 || this.allowedHostsOverride !== void 0 || this.deniedHostsOverride !== void 0;
  }
  shouldInterceptAllOutbound() {
    return this.hasInterceptAllRegistration || this.needsCatchAllInterception() || this.effectiveAllowedHosts !== void 0 || this.effectiveDeniedHosts !== void 0 || this.hasMutableOutboundConfiguration();
  }
  getStaticOutboundByHostKeys() {
    const ctor = this.constructor;
    return ctor.outboundByHost ? Object.keys(ctor.outboundByHost) : [];
  }
  /**
   * Collects all hostnames that need per-host outbound interception.
   * This path is only used for the narrow optimized case where outbound
   * handling is static and host-specific.
   */
  getHostsToIntercept() {
    const hosts = /* @__PURE__ */ new Set();
    const ctor = this.constructor;
    if (ctor.outboundByHost) {
      for (const hostname of Object.keys(ctor.outboundByHost)) {
        hosts.add(hostname);
      }
    }
    for (const hostname of Object.keys(this.outboundByHostOverrides)) {
      hosts.add(hostname);
    }
    return [...hosts];
  }
  async refreshOutboundInterception() {
    if (!this.usingInterception) {
      return;
    }
    this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
    await this.applyOutboundInterceptionPromise;
  }
  /**
   * Applies (or re-applies) outbound HTTP interception with the current
   * default registries + runtime overrides passed through ContainerProxy props.
   *
   * Uses per-host interception only for static host-specific outbound handlers.
   * As soon as the config needs to evaluate all hosts (catch-all outbound,
   * allow/deny lists, or runtime-mutated outbound config), we promote the
   * container to intercept-all and keep it there until the instance restarts.
   *
   * When `interceptHttps` is enabled, also applies HTTPS interception:
   * - Intercept-all mode: `interceptOutboundHttps('*', ...)` for all HTTPS traffic
   * - Per-host mode: `interceptOutboundHttps(host, ...)` for each known host
   */
  async applyOutboundInterception() {
    const ctx = this.ctx;
    if (ctx.exports === void 0) {
      throw new Error("ctx.exports is undefined, please try to update your compatibility date or export ContainerProxy from the containers package in your worker entrypoint");
    }
    if (ctx.exports.ContainerProxy === void 0) {
      throw new Error("ctx.exports.ContainerProxy is undefined, export ContainerProxy from the containers package in your worker entrypoint");
    }
    const interceptAll = this.shouldInterceptAllOutbound();
    if (interceptAll) {
      this.hasInterceptAllRegistration = interceptAll;
    }
    const outboundConfiguration = this.getOutboundConfiguration();
    this.persistOutboundConfiguration(outboundConfiguration);
    const hosts = this.getHostsToIntercept();
    const props = {
      enableInternet: this.enableInternet,
      containerId: this.ctx.id.toString(),
      className: this.constructor.name,
      outboundByHostOverrides: outboundConfiguration.outboundByHostOverrides,
      outboundHandlerOverride: outboundConfiguration.outboundHandlerOverride,
      allowedHosts: outboundConfiguration.allowedHosts,
      deniedHosts: outboundConfiguration.deniedHosts,
      interceptAll
    };
    const fetcher = ctx.exports.ContainerProxy({
      props
    });
    if (interceptAll) {
      for (const host of this.getStaticOutboundByHostKeys()) {
        await this.container.interceptOutboundHttp(host, fetcher);
        if (this.interceptHttps) {
          await this.container.interceptOutboundHttps(host, fetcher);
        }
      }
      if (this.interceptHttps) {
        await this.container.interceptOutboundHttps("*", fetcher);
      }
      await this.container.interceptAllOutboundHttp(fetcher);
    } else {
      for (const host of hosts) {
        await this.container.interceptOutboundHttp(host, fetcher);
        if (this.interceptHttps) {
          await this.container.interceptOutboundHttps(host, fetcher);
        }
      }
    }
  }
  /**
   * Execute SQL queries against the Container's database
   */
  sql(strings, ...values) {
    const query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
    return [...this.ctx.storage.sql.exec(query, ...values)];
  }
  requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
    let request;
    let port;
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl;
      port = typeof portOrInit === "number" ? portOrInit : void 0;
    } else {
      const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
      const init = typeof portOrInit === "number" ? {} : portOrInit || {};
      port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
      request = new Request(url, init);
    }
    port ??= this.defaultPort;
    if (port === void 0) {
      throw new Error("No port specified for container fetch. Set defaultPort or specify a port parameter.");
    }
    return { request, port };
  }
  /**
   *
   * The method prioritizes port sources in this order:
   * 1. Ports specified directly in the method call
   * 2. `requiredPorts` class property (if set)
   * 3. `defaultPort` (if neither of the above is specified)
   * 4. Falls back to port 33 if none of the above are set
   */
  async getPortsToCheck(overridePorts) {
    if (overridePorts !== void 0) {
      return Array.isArray(overridePorts) ? overridePorts : [overridePorts];
    }
    if (this.requiredPorts && this.requiredPorts.length > 0) {
      return [...this.requiredPorts];
    }
    return [this.defaultPort ?? FALLBACK_PORT_TO_CHECK];
  }
  // ===========================================
  //     CONTAINER INTERACTION & MONITORING
  // ===========================================
  /**
   * Tries to start a container if it's not already running
   * Returns the number of tries used
   */
  async startContainerIfNotRunning(waitOptions, options) {
    if (this.startInFlight) {
      return this.startInFlight;
    }
    if (this.container.running) {
      if (!this.monitor) {
        this.monitor = this.container.monitor();
      }
      return 0;
    }
    const startPromise = this.doStartContainer(waitOptions, options);
    this.startInFlight = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startInFlight === startPromise) {
        this.startInFlight = void 0;
      }
    }
  }
  async doStartContainer(waitOptions, options) {
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const totalTries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval);
    for (let tries = 0; tries < totalTries; tries++) {
      const envVars = options?.envVars ?? this.envVars;
      const entrypoint = options?.entrypoint ?? this.entrypoint;
      const enableInternet = options?.enableInternet ?? this.enableInternet;
      const labels = options?.labels ?? this.labels;
      const startConfig = {
        enableInternet
      };
      if (envVars && Object.keys(envVars).length > 0)
        startConfig.env = envVars;
      if (entrypoint)
        startConfig.entrypoint = entrypoint;
      if (labels && Object.keys(labels).length > 0)
        startConfig.labels = labels;
      this.renewActivityTimeout();
      const handleError = /* @__PURE__ */ __name(async () => {
        const err = await this.monitor?.catch((err2) => err2);
        if (typeof err === "number") {
          const toThrow = new Error(`Container exited before we could determine the container health, exit code: ${err}`);
          await this.state.setStoppedWithCode(err);
          this.monitor = void 0;
          try {
            await this.onError(toThrow);
          } catch {
          }
          throw toThrow;
        } else if (!isNoInstanceError(err)) {
          await this.state.setStopped();
          this.monitor = void 0;
          try {
            await this.onError(err);
          } catch {
          }
          throw err;
        }
      }, "handleError");
      if (tries > 0 && !this.container.running) {
        await handleError();
      }
      await this.scheduleNextAlarm();
      if (!this.container.running) {
        await this.refreshOutboundInterception();
        this.container.start(startConfig);
        this.monitor = this.container.monitor();
        await this.state.setRunning();
      } else {
        await this.scheduleNextAlarm();
      }
      this.renewActivityTimeout();
      const port = this.container.getTcpPort(waitOptions.portToCheck);
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await port.fetch("http://containerstarthealthcheck", { signal: combinedSignal });
        return tries;
      } catch (error) {
        if (isNotListeningError(error) && this.container.running) {
          return tries;
        }
        if (!this.container.running && isNotListeningError(error)) {
          await handleError();
        }
        await Promise.any([
          new Promise((res) => setTimeout(res, waitOptions.waitInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Aborted waiting for container to start as we received a cancellation signal", { cause: error });
        }
        if (totalTries === tries + 1) {
          if (error instanceof Error && error.message.includes("Network connection lost")) {
            this.ctx.abort();
          }
          await handleError();
          await this.state.setStopped();
          this.monitor = void 0;
          throw new Error(NO_CONTAINER_INSTANCE_ERROR, { cause: error });
        }
        continue;
      }
    }
    throw new Error(`Container did not start after ${totalTries * pollInterval}ms`);
  }
  setupMonitorCallbacks() {
    const monitor = this.monitor;
    if (!monitor || this.monitoredPromise === monitor) {
      return;
    }
    this.monitoredPromise = monitor;
    monitor.then(async () => {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (this.monitor === monitor) {
          await this.state.setStoppedWithCode(0);
        }
      });
    }).catch(async (error) => {
      if (this.monitor !== monitor) {
        return;
      }
      if (isNoInstanceError(error)) {
        await this.ctx.blockConcurrencyWhile(async () => {
          if (this.monitor === monitor) {
            await this.state.setStopped();
          }
        });
        return;
      }
      const exitCode = getExitCodeFromError(error);
      if (exitCode !== null) {
        await this.ctx.blockConcurrencyWhile(async () => {
          if (this.monitor === monitor) {
            await this.state.setStoppedWithCode(exitCode);
          }
        });
        return;
      }
      await this.ctx.blockConcurrencyWhile(async () => {
        if (this.monitor === monitor) {
          await this.state.setStopped();
        }
      });
      if (this.monitor !== monitor) {
        return;
      }
      try {
        await this.onError(error);
      } catch {
      }
    }).finally(() => {
      if (this.monitor !== monitor) {
        return;
      }
      this.monitoredPromise = void 0;
      this.monitor = void 0;
      if (this.timeout) {
        if (this.resolve)
          this.resolve();
        clearTimeout(this.timeout);
      }
    });
  }
  deleteSchedules(name) {
    this.sql`DELETE FROM container_schedules WHERE callback = ${name}`;
  }
  // ============================
  //     ALARMS AND SCHEDULES
  // ============================
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm(alarmProps) {
    if (alarmProps !== void 0 && alarmProps.isRetry && alarmProps.retryCount > MAX_ALARM_RETRIES) {
      const scheduleCount = Number(this.sql`SELECT COUNT(*) as count FROM container_schedules`[0]?.count) || 0;
      const hasScheduledTasks = scheduleCount > 0;
      if (hasScheduledTasks || this.container.running) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    const prevAlarm = Date.now();
    await this.ctx.storage.setAlarm(prevAlarm);
    await this.ctx.storage.sync();
    const result = this.sql`
         SELECT * FROM container_schedules;
       `;
    let minTime = Date.now() + 3 * 60 * 1e3;
    const now = Date.now() / 1e3;
    for (const row of result) {
      if (row.time > now) {
        continue;
      }
      const callback = this[row.callback];
      if (!callback || typeof callback !== "function") {
        console.error(`Callback ${row.callback} not found or is not a function`);
        continue;
      }
      const schedule = this.getSchedule(row.id);
      try {
        const payload = row.payload ? JSON.parse(row.payload) : void 0;
        await callback.call(this, payload, await schedule);
      } catch (e) {
        console.error(`Error executing scheduled callback "${row.callback}":`, e);
      }
      this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
    }
    const resultForMinTime = this.sql`
         SELECT * FROM container_schedules;
       `;
    const minTimeFromSchedules = Math.min(...resultForMinTime.map((r) => r.time * 1e3));
    if (!this.container.running) {
      await this.syncPendingStoppedEvents();
      if (resultForMinTime.length == 0) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(minTimeFromSchedules);
      }
      return;
    }
    if (this.isActivityExpired()) {
      await this.onActivityExpired();
      this.renewActivityTimeout();
      return;
    }
    minTime = Math.min(minTimeFromSchedules, minTime, this.sleepAfterMs);
    const timeout = Math.max(0, minTime - Date.now());
    await new Promise((resolve) => {
      this.resolve = resolve;
      if (!this.container.running) {
        resolve();
        return;
      }
      this.timeout = setTimeout(() => {
        resolve();
      }, timeout);
    });
    await this.ctx.storage.setAlarm(Date.now());
  }
  timeout;
  resolve;
  // synchronises container state with the container source of truth to process events
  async syncPendingStoppedEvents() {
    const state = await this.state.getState();
    if (!this.container.running && (state.status === "healthy" || state.status === "running")) {
      await this.callOnStop({ exitCode: 0, reason: "exit" }, state);
      return;
    }
    if (!this.container.running && state.status === "stopped_with_code") {
      await this.callOnStop({ exitCode: state.exitCode ?? 0, reason: "exit" }, state);
      return;
    }
  }
  async callOnStop(onStopParams, stateBeforeOnStop) {
    if (this.onStopCalled) {
      return;
    }
    this.onStopCalled = true;
    const promise = this.onStop(onStopParams);
    if (promise instanceof Promise) {
      await promise.finally(() => {
        this.onStopCalled = false;
      });
    } else {
      this.onStopCalled = false;
    }
    await this.state.setStoppedIfUnchanged(stateBeforeOnStop);
  }
  /**
   * Schedule the next alarm based on upcoming tasks
   */
  async scheduleNextAlarm(ms = 1e3) {
    const nextTime = ms + Date.now();
    if (this.timeout) {
      if (this.resolve)
        this.resolve();
      clearTimeout(this.timeout);
    }
    await this.ctx.storage.setAlarm(nextTime);
    await this.ctx.storage.sync();
  }
  async listSchedules(name) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE callback = ${name} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return [];
    }
    return result.map(this.toSchedule);
  }
  toSchedule(schedule) {
    let payload;
    try {
      payload = JSON.parse(schedule.payload);
    } catch (e) {
      console.error(`Error parsing payload for schedule ${schedule.id}:`, e);
      payload = void 0;
    }
    if (schedule.type === "delayed") {
      return {
        taskId: schedule.id,
        callback: schedule.callback,
        payload,
        type: "delayed",
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds
      };
    }
    return {
      taskId: schedule.id,
      callback: schedule.callback,
      payload,
      type: "scheduled",
      time: schedule.time
    };
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return void 0;
    }
    const schedule = result[0];
    return this.toSchedule(schedule);
  }
  isActivityExpired() {
    if (this.inflightRequests > 0) {
      this.renewActivityTimeout();
      return false;
    }
    return this.sleepAfterMs <= Date.now();
  }
};

// node_modules/@cloudflare/containers/dist/lib/utils.js
var singletonContainerId = "cf-singleton-container";
function getContainer(binding, name = singletonContainerId) {
  const objectId = binding.idFromName(name);
  return binding.get(objectId);
}
__name(getContainer, "getContainer");

// src/decisoes.ts
var JANELA = {
  /** Antes disto o login pode não ter completado, e o reinício estraga o pareamento. */
  PISO_MS: 16e3,
  /** Depois disto reinicia sem esperar mais: é o teto do vigia do host. */
  TETO_MS: 7e4,
  /** Depois disto não há o que salvar — o logout forçado já aconteceu. */
  LOGOUT_MS: 105e3
};
var PASSO_DE_ESPERA_MS = 5e3;
function decidirReinicio(s) {
  if (s.desdeParearMs >= JANELA.LOGOUT_MS) {
    return { acao: "desistir", motivo: "janela fechada: o logout for\xE7ado j\xE1 passou" };
  }
  if (!s.jidConhecido && !s.loggedIn) {
    return { acao: "desistir", motivo: "nenhum sinal de sess\xE3o para retomar" };
  }
  if (s.desdeParearMs < JANELA.PISO_MS) {
    return {
      acao: "esperar",
      emMs: Math.min(PASSO_DE_ESPERA_MS, JANELA.PISO_MS - s.desdeParearMs),
      motivo: "piso da janela: reiniciar agora deixaria companheiro meio-registrado"
    };
  }
  if (s.loggedIn) {
    return { acao: "reiniciar", motivo: "login completo" };
  }
  if (s.desdeParearMs >= JANELA.TETO_MS) {
    return { acao: "reiniciar", motivo: "teto da janela sem ver LoggedIn" };
  }
  return { acao: "esperar", emMs: PASSO_DE_ESPERA_MS, motivo: "aguardando LoggedIn" };
}
__name(decidirReinicio, "decidirReinicio");
function decidirOcio(s) {
  if (s.pareandoAgora) {
    return { acao: "permanecer", motivo: "pareamento em curso" };
  }
  if (s.temAparelhoPareado) {
    return { acao: "permanecer", motivo: "sess\xE3o pareada: hibernar tira o n\xFAmero do ar" };
  }
  return { acao: "dormir", motivo: "sem sess\xE3o pareada: nada a perder e nada a pagar" };
}
__name(decidirOcio, "decidirOcio");
var VIGIA = {
  /**
   * Teto de um reinício por hora, herdado de `wa-pool-guard.sh`: se a causa
   * for outra, reiniciar em laço não conserta e esconde o motivo.
   */
  MIN_ENTRE_REINICIOS_MS: 36e5,
  /** Três rodadas sem resposta antes de reiniciar — uma pode ser rede. */
  FALHAS_PARA_REINICIAR: 3,
  /** Ritmo da ronda. */
  INTERVALO_MS: 3e5
};
function decidirVigia(s) {
  if (!s.temAparelhoPareado) {
    return { acao: "nada", motivo: "sem sess\xE3o pareada" };
  }
  if (s.estado === "saudavel") {
    return { acao: "nada", motivo: "saud\xE1vel" };
  }
  if (s.estado === "socket-caido") {
    return { acao: "reconectar", motivo: "soquete ca\xEDdo: retomada pelo JID guardado" };
  }
  if (s.falhasSeguidas < VIGIA.FALHAS_PARA_REINICIAR) {
    return {
      acao: "nada",
      motivo: `sem resposta ${s.falhasSeguidas}/${VIGIA.FALHAS_PARA_REINICIAR}`
    };
  }
  if (s.desdeUltimoReinicioMs !== null && s.desdeUltimoReinicioMs < VIGIA.MIN_ENTRE_REINICIOS_MS) {
    const faltam = Math.ceil((VIGIA.MIN_ENTRE_REINICIOS_MS - s.desdeUltimoReinicioMs) / 6e4);
    return { acao: "nada", motivo: `teto de rein\xEDcios: ${faltam} min para o pr\xF3ximo` };
  }
  return { acao: "reiniciar", motivo: `${s.falhasSeguidas} rondas sem resposta` };
}
__name(decidirVigia, "decidirVigia");
var INSTANCIAS = {
  lite: { vcpu: 1 / 16, memoriaGiB: 0.25, discoGB: 2 },
  basic: { vcpu: 1 / 4, memoriaGiB: 1, discoGB: 4 },
  "standard-1": { vcpu: 1 / 2, memoriaGiB: 4, discoGB: 8 }
};

// src/canal.ts
var CHAVE = {
  /** Nome e token da instância do Evolution Go que este contêiner serve. */
  INSTANCIA: "instancia",
  TOKEN: "token",
  /** O nome da sala (id da integração), que o Worker passa no header. */
  SALA: "sala",
  JID: "jid",
  /**
   * Sticky: setado quando `loggedIn` é visto `true`, limpo só no logout real.
   *
   * Substitui `Boolean(jid)` como sinal de "há sessão a defender". Medido em
   * 2026-10-22: o Evolution Go 0.7.2 devolve `loggedIn:true` com `JID:""`, e
   * gatear pareamento no JID fazia a vigia hibernar uma sessão viva.
   */
  PAREADO: "pareado",
  PAREOU_EM: "pareouEm",
  ULTIMO_REINICIO: "ultimoReinicio",
  FALHAS: "falhas",
  /**
   * Se o webhook já foi (re)armado NESTA subida do contêiner.
   *
   * Resetado no `onStart`: o webhook do Evolution Go mora na requisição de
   * `/instance/connect` e **não sobrevive ao restart** (medido 2026-10-22) — a
   * sessão volta saudável, mas sem webhook, e o inbound para calado porque o
   * vigia só re-arma quando o socket cai. Ver `rearmarWebhook`.
   */
  WEBHOOK_ARMADO: "webhookArmado",
  /** Quando o contêiner subiu — teto de tempo para o re-arme desistir. */
  BOOT_EM: "bootEm",
  DIARIO: "diario"
};
var EVENTOS_ASSINADOS = [
  "MESSAGE",
  "SEND_MESSAGE",
  "READ_RECEIPT",
  "CHAT_PRESENCE",
  "CONNECTION",
  "QRCODE",
  "CONTACT"
];
var DIARIO_MAXIMO = 200;
var CanalWhatsApp = class extends Container {
  static {
    __name(this, "CanalWhatsApp");
  }
  defaultPort = 8080;
  /**
   * O cronômetro existe, mas quem decide é `onActivityExpired()`. Dez minutos
   * é só o ritmo em que a pergunta "pode dormir?" é feita.
   */
  sleepAfter = "10m";
  /** O WhatsApp é a razão de existir deste contêiner. */
  enableInternet = true;
  /** O Evolution Go responde aqui quando está de pé. */
  pingEndpoint = "localhost/server/ok";
  /**
   * `envVars` é propriedade da classe base, lida quando o contêiner sobe —
   * por isso é atribuída no construtor e não exposta como getter: TypeScript
   * recusa trocar propriedade por acessor, e a plataforma recusaria o valor
   * tarde demais.
   */
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      SERVER_PORT: "8080",
      CLIENT_NAME: "odontobox360",
      GLOBAL_API_KEY: env.EVOLUTION_GO_API_KEY,
      // As credenciais do whatsmeow moram no Postgres, não no disco — é o
      // que faz o item 4 do roteiro passar sem snapshot: o disco do
      // contêiner é efêmero por definição e aqui não guarda nada que
      // importe.
      POSTGRES_AUTH_DB: env.EVOGO_AUTH_DB,
      POSTGRES_USERS_DB: env.EVOGO_USERS_DB,
      // Nós mesmos persistimos mensagens; uma segunda cópia aqui só
      // duplicaria a tabela e cresceria sem limite.
      DATABASE_SAVE_MESSAGES: "false",
      // A mídia vem no próprio webhook, em base64 — é o que evita que uma
      // nota de voz atrase a resposta do agente.
      WEBHOOKFILES: "true",
      MINIO_ENABLED: "false",
      /**
       * Reatar as sessões ao subir.
       *
       * Em produção é `true`, e é o que torna o reinício um contorno
       * viável em vez de uma perda de sessão — o item 5 do roteiro
       * depende disto, não de sorte.
       *
       * **Na POC é `false` por padrão, e isso não é cautela genérica.**
       * A partir do momento em que esta POC aponta para um `evogo_users`
       * com credencial real, `true` faria este contêiner disputar o
       * aparelho com o Evolution Go que está no ar na VPS. O WhatsApp
       * aceita uma conexão por aparelho vinculado: os dois se derrubariam
       * em laço, e o desfecho provável é o aparelho ser **desvinculado** —
       * o número da clínica fora do ar, por causa de um teste.
       *
       * Só vale `true` aqui quando o `evolution-go` da VPS estiver
       * parado — ou seja, dentro da janela do corte.
       */
      CONNECT_ON_STARTUP: this.env.REATAR_SESSOES === "true" ? "true" : "false",
      /**
       * Ativação da licença **sem navegador**.
       *
       * Do `.env.example` do projeto, literal: "Set this to the email you
       * used in your first manual license registration. On startup, the
       * service will silently call /v1/register/auto and skip the browser
       * flow. Falls back to the manual flow if the email isn't registered
       * yet."
       *
       * É o que tira a ativação do caminho crítico do corte. Com isto, a
       * licença deixa de ser **estado num banco que precisa ser migrado**
       * e passa a ser **configuração num segredo** — e o `evogo_auth` do
       * destino pode nascer vazio.
       *
       * Vazio aqui mantém o comportamento antigo (registro manual), então
       * não configurar não quebra nada.
       */
      ...env.EVOLUTION_OPERATOR_EMAIL ? { EVOLUTION_OPERATOR_EMAIL: env.EVOLUTION_OPERATOR_EMAIL } : {},
      WADEBUG: "INFO",
      LOGTYPE: "json"
    };
  }
  // ----------------------------------------------------------- diário
  async registrar(o_que, detalhe) {
    const diario = (await this.ctx.storage.get(CHAVE.DIARIO) ?? []).slice(-DIARIO_MAXIMO + 1);
    diario.push({ em: (/* @__PURE__ */ new Date()).toISOString(), o_que, detalhe });
    await this.ctx.storage.put(CHAVE.DIARIO, diario);
    console.log(`[canal ${this.ctx.id.toString().slice(0, 8)}] ${o_que}${detalhe ? " \u2014 " + detalhe : ""}`);
  }
  // ----------------------------------------------------- ganchos de vida
  async onStart() {
    await this.registrar("cont\xEAiner de p\xE9");
    await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, false);
    await this.ctx.storage.put(CHAVE.BOOT_EM, Date.now());
    await this.schedule(VIGIA.INTERVALO_MS / 1e3, "ronda");
    await this.schedule(40, "rearmarWebhook");
  }
  async onStop({ exitCode, reason }) {
    await this.registrar("cont\xEAiner parou", `c\xF3digo=${exitCode} raz\xE3o=${reason}`);
  }
  async onError(erro) {
    await this.registrar("falha ao subir", String(erro));
    throw erro;
  }
  /**
   * O item 6 do roteiro da POC, e o único lugar onde o scale-to-zero é
   * recusado.
   *
   * A documentação da Cloudflare é explícita: não chamar `stop()` aqui faz o
   * cronômetro renovar e o gancho disparar de novo. Então permanecer de pé é
   * caminho previsto da plataforma, não truque — e a recusa é condicional de
   * propósito, porque workspace sem sessão pareada **deve** dormir. É o que
   * faz a conta seguir o número de clientes reais e não o de cadastros.
   */
  async onActivityExpired() {
    const jid = await this.ctx.storage.get(CHAVE.JID);
    const pareouEm = await this.ctx.storage.get(CHAVE.PAREOU_EM);
    const pareandoAgora = pareouEm !== void 0 && Date.now() - pareouEm < JANELA.LOGOUT_MS;
    const decisao = decidirOcio({ temAparelhoPareado: Boolean(jid), pareandoAgora });
    await this.registrar(`\xF3cio: ${decisao.acao}`, decisao.motivo);
    if (decisao.acao === "dormir") await this.stop();
  }
  // ------------------------------------------------- o contorno, agendado
  /**
   * Chamado quando o `PairSuccess` chega. Dispara a janela do reinício.
   */
  async pareou() {
    await this.ctx.storage.put(CHAVE.PAREOU_EM, Date.now());
    await this.registrar("PairSuccess recebido", "janela de rein\xEDcio aberta");
    await this.schedule(1, "avaliarReinicio");
  }
  /**
   * Re-arma o webhook logo após a subida do contêiner.
   *
   * O webhook some no restart (ver `armarWebhook`), e o vigia só re-arma no
   * socket caído — numa reconexão saudável ele nunca perceberia, e o inbound
   * pararia calado com a sessão de pé. Agendado pelo `onStart`: espera a sessão
   * logar e re-arma uma vez. Desiste após ~5 min (o `ronda` é a rede), para não
   * ficar acordando um contêiner que não tem sessão a defender.
   */
  async rearmarWebhook() {
    if (await this.ctx.storage.get(CHAVE.WEBHOOK_ARMADO)) return;
    if (!await this.ctx.storage.get(CHAVE.TOKEN)) return;
    const estado = await this.consultarInstancia();
    if (!estado.loggedIn) {
      const bootEm = await this.ctx.storage.get(CHAVE.BOOT_EM) ?? 0;
      if (Date.now() - bootEm < 5 * 6e4) await this.schedule(20, "rearmarWebhook");
      return;
    }
    try {
      await this.armarWebhook();
      await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, true);
      await this.registrar("webhook re-armado", "ap\xF3s subida do cont\xEAiner");
    } catch (erro) {
      await this.registrar("re-armar webhook falhou", String(erro));
    }
  }
  /**
   * Um passo da janela. Consulta o estado, pergunta à função pura e obedece.
   *
   * Reagenda a si mesmo em vez de dormir num laço: o Durable Object não deve
   * ficar segurando uma invocação por 70 s, e um alarme perdido é recuperável
   * enquanto um `await` perdido não é.
   */
  async avaliarReinicio() {
    const pareouEm = await this.ctx.storage.get(CHAVE.PAREOU_EM);
    if (pareouEm === void 0) return;
    const estado = await this.consultarInstancia();
    if (estado.jid) await this.ctx.storage.put(CHAVE.JID, estado.jid);
    if (estado.loggedIn) await this.ctx.storage.put(CHAVE.PAREADO, Date.now());
    const decisao = decidirReinicio({
      desdeParearMs: Date.now() - pareouEm,
      loggedIn: estado.loggedIn,
      jidConhecido: Boolean(estado.jid ?? await this.ctx.storage.get(CHAVE.JID))
    });
    await this.registrar(
      `rein\xEDcio: ${decisao.acao}`,
      `${decisao.motivo} (+${Math.round((Date.now() - pareouEm) / 1e3)}s, loggedIn=${estado.loggedIn})`
    );
    if (decisao.acao === "esperar") {
      await this.schedule(Math.max(1, Math.round(decisao.emMs / 1e3)), "avaliarReinicio");
      return;
    }
    await this.ctx.storage.delete(CHAVE.PAREOU_EM);
    if (decisao.acao === "reiniciar") await this.reiniciar("contorno p\xF3s-pareamento");
  }
  /**
   * O equivalente escopado do `docker restart` do host.
   *
   * SIGTERM e não SIGKILL: o desligamento gracioso deixa o whatsmeow fechar
   * os soquetes e devolver as conexões do Postgres — que é justamente o
   * segundo defeito medido (vazamento até esgotar `max_connections`).
   */
  async reiniciar(motivo) {
    await this.registrar("reiniciando", motivo);
    await this.ctx.storage.put(CHAVE.ULTIMO_REINICIO, Date.now());
    await this.ctx.storage.put(CHAVE.FALHAS, 0);
    await this.stop("SIGTERM");
    await this.startAndWaitForPorts({ cancellationOptions: { portReadyTimeoutMS: 6e4 } });
    await this.registrar("reiniciado");
    try {
      await this.armarWebhook();
      await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, true);
      await this.registrar("sess\xE3o reatada", "ap\xF3s o rein\xEDcio");
    } catch (erro) {
      await this.registrar("reatar ap\xF3s rein\xEDcio falhou", String(erro));
    }
  }
  // ---------------------------------------------------------- o vigia
  /** Substitui `wa-guard.sh` e `wa-pool-guard.sh` — os dois, num só lugar. */
  async ronda() {
    const estado = await this.consultarInstancia();
    let pareado = await this.ctx.storage.get(CHAVE.PAREADO);
    if (estado.respondeu && estado.loggedIn) {
      if (estado.jid) await this.ctx.storage.put(CHAVE.JID, estado.jid);
      if (!pareado) {
        pareado = Date.now();
        await this.ctx.storage.put(CHAVE.PAREADO, pareado);
        await this.registrar("vigia: sess\xE3o pareada detectada", "loggedIn=true");
      }
      if (!await this.ctx.storage.get(CHAVE.WEBHOOK_ARMADO)) {
        try {
          await this.armarWebhook();
          await this.ctx.storage.put(CHAVE.WEBHOOK_ARMADO, true);
          await this.registrar("webhook re-armado", "pelo vigia");
        } catch (erro) {
          await this.registrar("re-armar webhook falhou", String(erro));
        }
      }
    }
    if (pareado && estado.respondeu && !estado.loggedIn && !estado.socketAberto) {
      await this.ctx.storage.delete(CHAVE.PAREADO);
      await this.ctx.storage.delete(CHAVE.JID);
      await this.registrar("vigia: sess\xE3o deslogou", "hibernando \u2014 aparelho desvinculado");
      return;
    }
    if (!pareado) {
      await this.registrar("vigia: encerrado", "sem sess\xE3o pareada; deixando o cont\xEAiner hibernar");
      return;
    }
    const observado = !estado.respondeu ? "sem-resposta" : estado.loggedIn && estado.socketAberto ? "saudavel" : "socket-caido";
    const falhas = observado === "sem-resposta" ? (await this.ctx.storage.get(CHAVE.FALHAS) ?? 0) + 1 : 0;
    await this.ctx.storage.put(CHAVE.FALHAS, falhas);
    const ultimo = await this.ctx.storage.get(CHAVE.ULTIMO_REINICIO);
    const decisao = decidirVigia({
      estado: observado,
      temAparelhoPareado: true,
      falhasSeguidas: falhas,
      desdeUltimoReinicioMs: ultimo === void 0 ? null : Date.now() - ultimo
    });
    if (decisao.acao !== "nada" || observado !== "saudavel") {
      await this.registrar(`vigia: ${decisao.acao}`, `${decisao.motivo} (observado=${observado})`);
    }
    if (decisao.acao === "reconectar") await this.reconectar();
    if (decisao.acao === "reiniciar") await this.reiniciar(decisao.motivo);
    await this.schedule(VIGIA.INTERVALO_MS / 1e3, "ronda");
  }
  // ------------------------------------------- conversa com o Evolution Go
  /**
   * Garante que existe uma instância, e devolve o token dela.
   *
   * A chave global do Evolution Go só serve para `/instance/create`; todos os
   * outros caminhos exigem o token da própria instância. Geramos o token aqui
   * em vez de aceitar o que o servidor atribui, pelo mesmo motivo que o
   * cliente da aplicação faz isso: perder o token órfã a instância, porque é
   * o único jeito de endereçá-la.
   */
  async garantirInstancia() {
    const guardado = await this.ctx.storage.get(CHAVE.TOKEN);
    if (guardado) return guardado;
    throw new Error("inst\xE2ncia n\xE3o adotada: o app ainda n\xE3o criou a linha neste cont\xEAiner");
  }
  async consultarInstancia() {
    const mudo = { respondeu: false, loggedIn: false, socketAberto: false };
    const token = await this.ctx.storage.get(CHAVE.TOKEN);
    if (!token) return mudo;
    try {
      const r = await this.containerFetch("http://localhost/instance/status", {
        headers: { apikey: token }
      });
      if (!r.ok) return mudo;
      const envelope = await r.json();
      const corpo = envelope.data ?? envelope;
      return {
        respondeu: true,
        loggedIn: Boolean(corpo.LoggedIn),
        socketAberto: Boolean(corpo.Connected),
        jid: typeof corpo.JID === "string" && corpo.JID ? corpo.JID : void 0
      };
    } catch {
      return mudo;
    }
  }
  /**
   * Aplica o webhook (e a assinatura) no Evolution Go via `/instance/connect`.
   *
   * É o único lugar onde o webhook é definido — e ele **não sobrevive ao
   * restart** do contêiner (mora na requisição, não no banco; medido
   * 2026-10-22). Por isso não serve só à reconexão de socket caído: o contêiner
   * também re-aplica ao subir (ver `rearmarWebhook`/`ronda`). Em sessão logada,
   * reemitir o connect re-arma o webhook sem derrubar a sessão (medido).
   */
  async armarWebhook() {
    const token = await this.garantirInstancia();
    await this.containerFetch("http://localhost/instance/connect", {
      method: "POST",
      headers: { apikey: token, "content-type": "application/json" },
      body: JSON.stringify({
        immediate: true,
        webhookUrl: await this.webhook(),
        subscribe: EVENTOS_ASSINADOS
      })
    });
  }
  async reconectar() {
    try {
      await this.armarWebhook();
    } catch (erro) {
      await this.registrar("reconex\xE3o falhou", String(erro));
    }
  }
  /**
   * O webhook carrega o segredo no caminho.
   *
   * O Evolution Go não manda cabeçalho de autenticação nos webhooks, então o
   * único lugar onde um segredo caberia é a URL. Não é ideal — URL vaza em
   * log —, mas a alternativa é um endpoint público que aceita evento de
   * qualquer um, e na POC ele dispara reinício de contêiner.
   */
  async webhook() {
    const sala = await this.ctx.storage.get(CHAVE.SALA) ?? this.ctx.id.toString();
    return `${this.env.WEBHOOK_BASE_URL}/entrada/${this.env.POC_TOKEN}/${sala}`;
  }
  // ----------------------------------------------------------- roteamento
  /**
   * Toda exceção vira linha de diário antes de virar resposta.
   *
   * `wrangler tail` não conecta desta máquina (o WebSocket cai antes de
   * estabelecer), então o diário no armazenamento do objeto é a única
   * observabilidade que a POC tem de perto. Engolir a exceção aqui seria
   * cegueira; registrá-la e devolvê-la ao chamador já autenticado é o que
   * permite diagnosticar sem `tail`.
   */
  async fetch(pedido) {
    try {
      return await this.rotear(pedido);
    } catch (erro) {
      const detalhe = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
      await this.registrar("exce\xE7\xE3o na rota", detalhe);
      return Response.json({ erro: detalhe }, { status: 500 });
    }
  }
  async rotear(pedido) {
    const url = new URL(pedido.url);
    if (url.pathname === "/poc/estado") {
      const [pareado, ultimo, falhas, pareouEm] = await Promise.all([
        this.ctx.storage.get(CHAVE.PAREADO),
        this.ctx.storage.get(CHAVE.ULTIMO_REINICIO),
        this.ctx.storage.get(CHAVE.FALHAS),
        this.ctx.storage.get(CHAVE.PAREOU_EM)
      ]);
      return Response.json({
        cont\u00EAiner: await this.getState(),
        inst\u00E2ncia: await this.consultarInstancia(),
        pareado: Boolean(pareado),
        pareandoDesde: pareouEm ? new Date(pareouEm).toISOString() : null,
        \u00FAltimoRein\u00EDcio: ultimo ? new Date(ultimo).toISOString() : null,
        falhasSeguidas: falhas ?? 0
      });
    }
    if (url.pathname === "/poc/diario") {
      return Response.json(await this.ctx.storage.get(CHAVE.DIARIO) ?? []);
    }
    if (url.pathname === "/poc/pareou" && pedido.method === "POST") {
      await this.pareou();
      return Response.json({ ok: true });
    }
    const salaHeader = pedido.headers.get("x-evo-sala");
    if (salaHeader && !await this.ctx.storage.get(CHAVE.SALA)) {
      await this.ctx.storage.put(CHAVE.SALA, salaHeader);
    }
    if (url.pathname === "/instance/connect" && pedido.method === "POST") {
      const corpo = await pedido.json().catch(() => ({}));
      corpo.webhookUrl = await this.webhook();
      corpo.subscribe = EVENTOS_ASSINADOS;
      corpo.immediate = corpo.immediate ?? true;
      return this.containerFetch("http://localhost/instance/connect", {
        method: "POST",
        headers: { apikey: pedido.headers.get("apikey") ?? "", "content-type": "application/json" },
        body: JSON.stringify(corpo)
      });
    }
    if (url.pathname === "/instance/create" && pedido.method === "POST") {
      const r = await this.containerFetch(pedido);
      try {
        const corpo = await r.clone().json();
        if (corpo.data?.token) {
          await this.ctx.storage.put(CHAVE.TOKEN, corpo.data.token);
          await this.ctx.storage.put(CHAVE.INSTANCIA, corpo.data.name ?? "");
          await this.registrar("inst\xE2ncia adotada", corpo.data.name ?? "");
        }
      } catch {
      }
      return r;
    }
    return this.containerFetch(pedido);
  }
};

// src/roteamento.ts
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}
__name(iguais, "iguais");
function classificarRota(pathname) {
  return pathname.startsWith("/entrada/") ? "webhook" : "api";
}
__name(classificarRota, "classificarRota");
function partesDaEntrada(pathname) {
  const partes = pathname.split("/").filter(Boolean);
  if (partes.length < 3 || partes[0] !== "entrada") return null;
  const [, segredo, sala] = partes;
  if (!segredo || !sala) return null;
  return { segredo, sala };
}
__name(partesDaEntrada, "partesDaEntrada");
function salaValida(sala) {
  return /^[a-z0-9]{20,40}$/i.test(sala);
}
__name(salaValida, "salaValida");
function eventoDisparaReciclo(evento) {
  return evento === "PairSuccess";
}
__name(eventoDisparaReciclo, "eventoDisparaReciclo");
var CABECALHO = {
  /** Prova de que a chamada é do nosso app: o valor é a chave global. */
  GATEWAY: "x-evo-gateway",
  /** A sala (id da integração) para a qual rotear. */
  SALA: "x-evo-sala"
};

// src/index.ts
var NAO_ENCONTRADO = /* @__PURE__ */ __name(() => new Response("n\xE3o encontrado", { status: 404 }), "NAO_ENCONTRADO");
var SALA_DA_LICENCA = "licencacompartilhada00";
var index_default = {
  async fetch(pedido, env, ctx) {
    const url = new URL(pedido.url);
    if (classificarRota(url.pathname) === "webhook") {
      const partes = partesDaEntrada(url.pathname);
      if (!partes || !iguais(partes.segredo, env.POC_TOKEN) || !salaValida(partes.sala)) {
        return NAO_ENCONTRADO();
      }
      const corpo = await pedido.text();
      let evento = "desconhecido";
      try {
        evento = JSON.parse(corpo).event ?? "desconhecido";
      } catch {
      }
      console.log(`[entrada] ${partes.sala.slice(0, 8)} ${evento}`);
      if (eventoDisparaReciclo(evento)) {
        ctx.waitUntil(
          getContainer(env.CANAL, partes.sala).fetch(new Request("http://canal/poc/pareou", { method: "POST" })).then(() => void 0).catch((erro) => console.error("[entrada] reciclo falhou", erro))
        );
      }
      if (env.APP_WEBHOOK_URL) {
        const destino = `${env.APP_WEBHOOK_URL}?sala=${encodeURIComponent(partes.sala)}`;
        const req = new Request(destino, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: corpo
        });
        const enviar = env.APP ? env.APP.fetch(req) : fetch(req);
        ctx.waitUntil(
          enviar.then(async (r) => {
            if (!r.ok) console.error(`[entrada] app respondeu ${r.status}`);
          }).catch((erro) => console.error("[entrada] repasse ao app falhou", erro))
        );
      }
      return Response.json({ ok: true });
    }
    const gateway = pedido.headers.get(CABECALHO.GATEWAY) ?? "";
    if (!gateway || !env.EVOLUTION_GO_API_KEY || !iguais(gateway, env.EVOLUTION_GO_API_KEY)) {
      return NAO_ENCONTRADO();
    }
    const sala = url.pathname.startsWith("/license/") ? SALA_DA_LICENCA : pedido.headers.get(CABECALHO.SALA) ?? "";
    if (!salaValida(sala)) {
      return new Response("sala ausente ou inv\xE1lida", { status: 400 });
    }
    const interno = new Request("http://canal" + url.pathname + url.search, pedido);
    interno.headers.set(CABECALHO.SALA, sala);
    return getContainer(env.CANAL, sala).fetch(interno);
  }
};
export {
  CanalWhatsApp,
  index_default as default
};
//# sourceMappingURL=index.js.map
