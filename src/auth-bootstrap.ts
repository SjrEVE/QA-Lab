import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page, type Request } from 'playwright';
import { z } from 'zod';
import { assertAllowedBrowserUrl, decideBrowserRequest, type BrowserTargetPolicy } from './browser-policy.js';
import { loadConfig, type QaConfig } from './config.js';
import { assertPrivatePath, loadStagingProfile, type StagingProfile } from './staging-profile.js';

const expectedEmailSchema = z.string().trim().email().max(254);
export const authVerificationSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  identityHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  verifiedAt: z.string().datetime({ offset: true }),
  verifiedInFreshBrowser: z.literal(true),
}).strict();
export type AuthVerification = z.infer<typeof authVerificationSchema>;
type IdentitySource = StagingProfile['auth']['accountIdentitySource'];

export interface AuthBrowserLaunchOptions {
  readonly profileDirectory: string;
  readonly policy: BrowserTargetPolicy;
  readonly timeoutMs: number;
  readonly headed: boolean;
}

export interface AuthBrowserSession {
  navigate(url: string): Promise<void>;
  waitForVisible(selector: string): Promise<void>;
  readIdentity(selector: string, source: IdentitySource): Promise<string>;
  close(): Promise<void>;
}

export interface AuthBrowserLauncher {
  launch(options: AuthBrowserLaunchOptions): Promise<AuthBrowserSession>;
}

export interface AuthBootstrapResult {
  readonly status: 'VERIFIED' | 'BLOCKED';
  readonly reason: string;
  readonly identityHash?: string;
  readonly verifiedInFreshBrowser: boolean;
}

export interface AuthBootstrapOptions {
  readonly cwd?: string;
  readonly config: QaConfig;
  readonly profile: StagingProfile;
  readonly expectedEmail?: string;
  readonly launcher?: AuthBrowserLauncher;
}

export interface ConfiguredAuthBootstrapOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly loadEnvFile?: boolean;
  readonly launcher?: AuthBrowserLauncher;
}

function requestKind(request: Request): 'navigation' | 'redirect' | 'subresource' {
  if (!request.isNavigationRequest()) return 'subresource';
  return request.redirectedFrom() === null ? 'navigation' : 'redirect';
}

export function normalizeAccountEmail(value: string): string {
  return expectedEmailSchema.parse(value.normalize('NFKC')).toLowerCase();
}

export function hashAccountIdentity(email: string): string {
  return `sha256:${createHash('sha256').update(email).digest('hex')}`;
}

export async function loadAuthVerification(cwd: string, profile: StagingProfile): Promise<AuthVerification> {
  const filename = await assertPrivatePath(cwd, profile.privatePaths.authStatePath);
  return authVerificationSchema.parse(JSON.parse(await readFile(filename, 'utf8')) as unknown);
}

class PlaywrightAuthSession implements AuthBrowserSession {
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #policy: BrowserTargetPolicy;
  #closed = false;

  public constructor(context: BrowserContext, page: Page, policy: BrowserTargetPolicy) {
    this.#context = context;
    this.#page = page;
    this.#policy = policy;
  }

  public async navigate(url: string): Promise<void> {
    assertAllowedBrowserUrl(url, this.#policy);
    await this.#page.goto(url, { waitUntil: 'load' });
    assertAllowedBrowserUrl(this.#page.url(), this.#policy);
  }

  public async waitForVisible(selector: string): Promise<void> {
    await this.#page.locator(selector).waitFor({ state: 'visible' });
  }

  public async readIdentity(selector: string, source: IdentitySource): Promise<string> {
    const locator = this.#page.locator(selector).first();
    switch (source) {
      case 'textContent': return (await locator.textContent()) ?? '';
      case 'value': return locator.inputValue();
      case 'data-email': return (await locator.getAttribute('data-email')) ?? '';
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#context.close();
  }
}

export class PlaywrightAuthBrowserLauncher implements AuthBrowserLauncher {
  public async launch(options: AuthBrowserLaunchOptions): Promise<AuthBrowserSession> {
    const context = await chromium.launchPersistentContext(options.profileDirectory, {
      headless: !options.headed,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    try {
      context.setDefaultTimeout(options.timeoutMs);
      context.setDefaultNavigationTimeout(options.timeoutMs);
      await context.route('**/*', async (route) => {
        const request = route.request();
        const decision = decideBrowserRequest(request.url(), requestKind(request), options.policy);
        if (!decision.allowed) {
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });
      const page = context.pages()[0] ?? await context.newPage();
      return new PlaywrightAuthSession(context, page, options.policy);
    } catch (error) {
      await context.close();
      throw error;
    }
  }
}

async function existingDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Persistent browser profile is malformed or unsafe.');
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readVerifiedIdentity(
  session: AuthBrowserSession,
  profile: StagingProfile,
  expectedEmail: string,
): Promise<string> {
  await session.waitForVisible(profile.auth.authenticatedSelector);
  await session.waitForVisible(profile.auth.accountIdentitySelector);
  const observed = normalizeAccountEmail(await session.readIdentity(
    profile.auth.accountIdentitySelector,
    profile.auth.accountIdentitySource,
  ));
  if (observed !== expectedEmail) throw new Error('Authenticated account does not match QA_EXPECTED_TEST_EMAIL.');
  return observed;
}

async function launchAndVerify(
  launcher: AuthBrowserLauncher,
  launchOptions: AuthBrowserLaunchOptions,
  url: string,
  profile: StagingProfile,
  expectedEmail: string,
): Promise<string> {
  const session = await launcher.launch(launchOptions);
  try {
    await session.navigate(url);
    return await readVerifiedIdentity(session, profile, expectedEmail);
  } finally {
    await session.close();
  }
}

function blocked(reason: string): AuthBootstrapResult {
  return { status: 'BLOCKED', reason, verifiedInFreshBrowser: false };
}

export async function bootstrapStagingAuth(options: AuthBootstrapOptions): Promise<AuthBootstrapResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let expectedEmail: string;
  try {
    expectedEmail = normalizeAccountEmail(options.expectedEmail ?? '');
  } catch {
    return blocked('QA_EXPECTED_TEST_EMAIL is missing or invalid.');
  }

  const baseUrl = options.config.staging.baseUrl;
  if (!baseUrl) return blocked('Typed staging target is not configured.');
  const policy: BrowserTargetPolicy = {
    allowedHosts: [...new Set([...options.config.staging.allowedHosts, ...options.profile.auth.allowedHosts])],
  };
  try {
    const target = assertAllowedBrowserUrl(baseUrl, policy);
    if (target.hostname.toLowerCase() !== options.profile.target.expectedHost) throw new Error('profile host mismatch');
  } catch {
    return blocked('Typed staging target failed the exact-host policy.');
  }

  let profileDirectory: string;
  let verificationPath: string;
  try {
    profileDirectory = await assertPrivatePath(cwd, options.profile.privatePaths.browserProfileDirectory);
    verificationPath = await assertPrivatePath(cwd, options.profile.privatePaths.authStatePath);
    if (!(await existingDirectory(profileDirectory))) await mkdir(profileDirectory, { recursive: true });
  } catch {
    return blocked('Persistent browser profile is missing, malformed, or unsafe.');
  }

  const launcher = options.launcher ?? new PlaywrightAuthBrowserLauncher();
  const common = { profileDirectory, policy, timeoutMs: options.profile.auth.bootstrapTimeoutMs };
  let identity: string;
  try {
    identity = await launchAndVerify(
      launcher,
      { ...common, headed: true },
      new URL(options.profile.target.loginPath, baseUrl).href,
      options.profile,
      expectedEmail,
    );
  } catch {
    return blocked('Login did not produce the expected authenticated account identity.');
  }

  if (!(await existingDirectory(profileDirectory))) return blocked('Persistent browser profile was not created.');
  try {
    const verifiedIdentity = await launchAndVerify(
      launcher,
      { ...common, headed: false },
      new URL(options.profile.target.authenticatedPath, baseUrl).href,
      options.profile,
      expectedEmail,
    );
    if (verifiedIdentity !== identity) return blocked('Fresh-browser account identity changed.');
  } catch {
    return blocked('Persisted session was not authenticated in a fresh browser process.');
  }

  const identityHash = hashAccountIdentity(identity);
  await mkdir(path.dirname(verificationPath), { recursive: true });
  await writeFile(verificationPath, `${JSON.stringify({
    schemaVersion: 1,
    profileId: options.profile.id,
    identityHash,
    verifiedAt: new Date().toISOString(),
    verifiedInFreshBrowser: true,
  }, null, 2)}\n`, { encoding: 'utf8' });
  return { status: 'VERIFIED', reason: 'Dedicated staging account verified in a fresh browser process.', identityHash, verifiedInFreshBrowser: true };
}

export async function runConfiguredAuthBootstrap(
  options: ConfiguredAuthBootstrapOptions = {},
): Promise<AuthBootstrapResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  try {
    const config = await loadConfig({
      cwd,
      env,
      ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }),
    });
    const profile = await loadStagingProfile({ config, cwd, env });
    return bootstrapStagingAuth({
      cwd,
      config,
      profile,
      ...(env.QA_EXPECTED_TEST_EMAIL ? { expectedEmail: env.QA_EXPECTED_TEST_EMAIL } : {}),
      ...(options.launcher ? { launcher: options.launcher } : {}),
    });
  } catch {
    return blocked('Typed staging configuration or staging profile is missing, malformed, or unsafe.');
  }
}
