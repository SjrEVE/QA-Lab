import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type ConsoleMessage, type Page, type Request } from 'playwright';
import { decideBrowserRequest, type BrowserPolicyDecision, type BrowserTargetPolicy } from './browser-policy.js';
import { redactSecrets } from './redaction.js';
import { TargetDeniedError } from './security.js';

export interface LoginAdapter {
  readonly name: string;
  login(controller: BrowserController): Promise<void>;
}

export type BrowserAction =
  | { readonly type: 'navigate'; readonly url: string }
  | { readonly type: 'screenshot'; readonly name: string }
  | { readonly type: 'wait'; readonly durationMs: number };

export interface BrowserEvent {
  readonly timestamp: string;
  readonly event: 'request-denied' | 'console' | 'request-failed' | 'page-error' | 'navigated';
  readonly data: unknown;
}

export interface BrowserControllerOptions {
  readonly policy: BrowserTargetPolicy;
  readonly artifactDirectory: string;
  readonly profileDirectory: string;
  readonly timeoutMs?: number;
  readonly headless?: boolean;
  readonly preserveProfile?: boolean;
  readonly recordVideoDirectory?: string;
  readonly voice?: {
    readonly enabled: boolean;
    readonly audible?: boolean;
    readonly permissions?: readonly ['microphone'];
    readonly args?: readonly string[];
  };
}

export interface BrowserController {
  open(): Promise<void>;
  perform(action: BrowserAction): Promise<string | void>;
  navigate(url: string): Promise<void>;
  screenshot(name: string): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserRuntimeSnapshot {
  readonly page: Page;
  readonly events: readonly BrowserEvent[];
}

function safeArtifactName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') throw new Error('Unsafe artifact name.');
  return name;
}

function requestKind(request: Request): 'navigation' | 'redirect' | 'subresource' {
  if (!request.isNavigationRequest()) return 'subresource';
  return request.redirectedFrom() === null ? 'navigation' : 'redirect';
}

export class GuardedBrowserController implements BrowserController {
  readonly #options: BrowserControllerOptions;
  #context: BrowserContext | undefined;
  #page: Page | undefined;
  #events: BrowserEvent[] = [];
  #closed = false;

  public constructor(options: BrowserControllerOptions) {
    this.#options = options;
  }

  public async open(): Promise<void> {
    if (this.#context) throw new Error('Browser controller is already open.');
    await mkdir(this.#options.artifactDirectory, { recursive: true });
    await mkdir(path.dirname(this.#options.profileDirectory), { recursive: true });
    this.#context = await chromium.launchPersistentContext(this.#options.profileDirectory, {
      headless: this.#options.headless ?? true,
      acceptDownloads: false,
      serviceWorkers: 'block',
      ...(this.#options.voice?.audible ? { ignoreDefaultArgs: ['--mute-audio'] } : {}),
      ...(this.#options.recordVideoDirectory ? { recordVideo: { dir: this.#options.recordVideoDirectory } } : {}),
      ...(this.#options.voice?.enabled && this.#options.voice.args ? { args: [...this.#options.voice.args] } : {}),
    });
    if (this.#options.voice?.enabled && this.#options.voice.permissions) {
      await this.#context.grantPermissions([...this.#options.voice.permissions]);
    }
    this.#context.setDefaultTimeout(this.#options.timeoutMs ?? 10_000);
    this.#context.setDefaultNavigationTimeout(this.#options.timeoutMs ?? 10_000);
    await this.#context.route('**/*', async (route) => {
      const request = route.request();
      const decision = decideBrowserRequest(request.url(), requestKind(request), this.#options.policy);
      if (!decision.allowed) {
        this.#recordDenied(decision);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    this.#page = this.#context.pages()[0] ?? await this.#context.newPage();
    this.#bindPage(this.#page);
  }

  public async perform(action: BrowserAction): Promise<string | void> {
    switch (action.type) {
      case 'navigate': return this.navigate(action.url);
      case 'screenshot': return this.screenshot(action.name);
      case 'wait': await new Promise((resolve) => setTimeout(resolve, action.durationMs)); return;
    }
  }

  public async navigate(url: string): Promise<void> {
    const decision = decideBrowserRequest(url, 'navigation', this.#options.policy);
    if (!decision.allowed) {
      this.#recordDenied(decision);
      throw new TargetDeniedError(decision.reason);
    }
    const response = await this.#requirePage().goto(url, { waitUntil: 'load' });
    const finalUrl = this.#requirePage().url();
    const finalDecision = decideBrowserRequest(finalUrl, response?.request().redirectedFrom() ? 'redirect' : 'navigation', this.#options.policy);
    if (!finalDecision.allowed) {
      this.#recordDenied(finalDecision);
      throw new TargetDeniedError(finalDecision.reason);
    }
    this.#record('navigated', { url: finalUrl, status: response?.status() });
  }

  public async screenshot(name: string): Promise<string> {
    const filename = `${safeArtifactName(name)}.png`;
    const target = path.join(this.#options.artifactDirectory, filename);
    await this.#requirePage().screenshot({ path: target, fullPage: true });
    return target;
  }

  public runtime(): BrowserRuntimeSnapshot {
    return { page: this.#requirePage(), events: this.#events };
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#flushEvents();
      await this.#context?.close();
    } finally {
      this.#context = undefined;
      this.#page = undefined;
      if (!(this.#options.preserveProfile ?? false)) {
        await rm(this.#options.profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  }

  #bindPage(page: Page): void {
    page.on('console', (message: ConsoleMessage) => this.#record('console', { type: message.type(), text: message.text(), url: message.location().url }));
    page.on('requestfailed', (request) => this.#record('request-failed', { url: request.url(), method: request.method(), error: request.failure()?.errorText }));
    page.on('pageerror', (error) => this.#record('page-error', { name: error.name, message: error.message }));
    page.on('websocket', (socket) => {
      const decision = decideBrowserRequest(socket.url(), 'websocket', this.#options.policy);
      if (!decision.allowed) this.#recordDenied(decision);
    });
  }

  #recordDenied(decision: BrowserPolicyDecision): void {
    this.#record('request-denied', decision);
  }

  #record(event: BrowserEvent['event'], data: unknown): void {
    this.#events.push({ timestamp: new Date().toISOString(), event, data: redactSecrets(data) });
  }

  async #flushEvents(): Promise<void> {
    if (this.#events.length === 0) return;
    const target = path.join(this.#options.artifactDirectory, 'browser-events.jsonl');
    await writeFile(target, `${this.#events.map((event) => JSON.stringify(event)).join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
  }

  #requirePage(): Page {
    if (!this.#page || this.#closed) throw new Error('Browser controller is not open.');
    return this.#page;
  }
}
